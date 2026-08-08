/**
 * 固定砲台型の敵（敵A セントリー／敵C スナイパー／敵E リフレクター／敵G プリズム）に
 * 共通する更新処理（Phaser 非依存の純粋 TS）。
 *
 * 4種はいずれも「移動なし・IDLE → AIM → RELOAD のステートマシン」で、実行される手順は同一：
 *   1. 照準ブレの引き直し（持たない敵＝スナイパーの精密照準は cfg.JITTER_MAX を持たないだけ）
 *   2. 標的選択（生存プレイヤーのうち射線が通る最も近い1体。GDD §12.5）
 *   3. 狙いの決定（直接射線があれば標的、塞がれていれば跳弾の反射点）
 *   4. 砲塔追従
 *   5. 発射条件（間隔・同時発射数・照準許容角・射線）が揃えば発射
 * 差分は「調整値・撃つ弾・跳弾狙撃のポリシー」の3点だけなので、すべて引数に落としてある。
 *
 * 跳弾狙撃のポリシー（GDD §6）：
 *   "roll"   … 直接射線が塞がれているとき、AIM 突入ごとに1回だけ抽選（確率は難易度連動）。敵A・C
 *   "always" … 抽選なしで常に反射点を狙う（100%）。敵E・G
 */
import { BALANCE } from "../config/balance";
import type { Bullet, BulletSpawnConfig } from "./bullet";
import { liveBulletCount, scaleBulletSpeed, spawnBullet } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import {
  type FireConfig,
  type JitterConfig,
  rollAimJitter,
  rollFireInterval,
} from "./enemyAi";
import { angleDiff, type Rng, rotateToward } from "./mathUtils";
import { findOuterWallRicochet, type RicochetShot } from "./ricochetAim";
import type { ParsedStage } from "./stage";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody } from "./types";

/** 固定砲台の状態名（4種で共通） */
export type TurretFsmState = "IDLE" | "AIM" | "RELOAD";

/** 跳弾狙撃のポリシー */
export type RicochetPolicy = "roll" | "always";

/** 固定砲台の共通状態（各 *Tank はこれを継承する） */
export interface TurretTank extends TankBody {
  state: TurretFsmState;
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  jitter: number; // 現在の照準ブレ [rad]（ブレなしの敵は常に 0）
  jitterTimer: number; // ブレ引き直しまでの残り時間 [s]
  ricochetRolled: boolean; // この AIM サイクルで跳弾狙撃の抽選を消化したか（"roll" のみ使用）
  ricochetMode: boolean; // 抽選に当たり跳弾狙撃を試みているか（"roll" のみ使用）
  /** 直近に求めた反射点（GDD §6 v0.23。毎フレームではなく一定間隔で計算し直して使い回す） */
  ricochetShot: RicochetShot | null;
  ricochetRecalcTimer: number; // 次に計算し直すまでの残り時間 [s]
  ricochetAimX: number; // 計算に使った標的の位置（大きく動いたら間隔を待たず引き直す）
  ricochetAimY: number;
}

/**
 * 固定砲台の調整値（BALANCE.SENTRY などをそのまま渡せる形）。
 * JITTER_* を持たない調整値＝ブレなし（敵C スナイパーの精密照準を分岐でなく型で表す）。
 */
export type TurretConfig = FireConfig & { TURN_SPEED: number } & Partial<JitterConfig>;

/** updateTurretAi に渡す周辺情報（4種の *UpdateContext と同一） */
export interface TurretUpdateContext {
  players: readonly TargetInfo[]; // 全プレイヤー（標的選択に使う。GDD §12.5）
  bullets: Bullet[]; // 場の弾（発射先・同時発射数カウント）
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
  mods?: DifficultyMods; // 難易度の実効調整値（省略時は NORMAL 相当。GDD §8.3）
}

/** 照準ブレを持つ調整値か（型ガード） */
function hasJitter(cfg: TurretConfig): cfg is TurretConfig & JitterConfig {
  return cfg.JITTER_MAX !== undefined;
}

/** 固定砲台の更新（1フレーム分。dt は秒） */
export function updateTurretAi(
  e: TurretTank,
  dt: number,
  ctx: TurretUpdateContext,
  cfg: TurretConfig,
  bulletCfg: BulletSpawnConfig,
  policy: RicochetPolicy,
): void {
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 照準ブレの引き直し（全状態共通。ブレなしの敵は e.jitter が 0 のまま） ---
  if (hasJitter(cfg)) rollAimJitter(e, dt, cfg, ctx.rng);

  // --- 標的選択（GDD §12.5）。生存者がいなければ何もしない（同フレーム内でリセットされる） ---
  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);
  if (!pick) return;
  const p = pick.target;
  const direct = pick.hasLos;

  // --- 跳弾狙撃の抽選（"roll" のみ。AIM 突入後の初回フレームで1回だけ消化＝リロードごと） ---
  if (policy === "roll" && e.state === "AIM" && !e.ricochetRolled) {
    e.ricochetRolled = true;
    e.ricochetMode = !direct && ctx.rng() < mods.turretRicochetChance; // 難易度連動（GDD §6 v0.9）
  }

  // --- 狙いの決定：直接射線があれば標的、なければ跳弾の反射点 ---
  const tryRicochet =
    policy === "always" ? !direct : e.state === "AIM" && !direct && e.ricochetMode;
  const shot = tryRicochet ? refreshRicochet(e, dt, ctx.stage, p) : clearRicochet(e);
  const aimTarget = shot ? shot.aimAngle : Math.atan2(p.y - e.y, p.x - e.x);
  e.turretAngle = rotateToward(e.turretAngle, aimTarget + e.jitter, cfg.TURN_SPEED * dt);

  // --- 状態遷移 ---
  switch (e.state) {
    case "IDLE": // 開幕グレース：照準のみ、射撃しない
      if (ctx.grace <= 0) e.state = "AIM";
      break;

    case "AIM": {
      // 発射条件が揃ったら撃つ（通常＝直接射線あり／跳弾狙撃＝反射射線が成立）
      e.fireTimer -= dt;
      const ready =
        e.fireTimer <= 0 &&
        liveBulletCount(ctx.bullets, e) < cfg.MAX_BULLETS &&
        Math.abs(angleDiff(aimTarget, e.turretAngle)) < cfg.FIRE_ANGLE_TOL && // 砲塔がほぼ狙い通り
        (direct || shot !== null); // 直接射線 or 跳弾射線のどちらかが成立
      if (ready) {
        spawnBullet(
          ctx.bullets,
          e,
          e.turretAngle,
          scaleBulletSpeed(bulletCfg, mods.bulletSpeedMult),
          ctx.stage,
        );
        e.fireTimer = rollFireInterval(ctx.rng, cfg, mods.fireIntervalMult);
        e.state = "RELOAD";
        e.ricochetRolled = false; // 次の AIM サイクルで再抽選
        e.ricochetMode = false;
      }
      break;
    }

    case "RELOAD": // 発射間隔の消化を待つ
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        e.fireTimer = 0;
        e.state = "AIM";
      }
      break;
  }
}

/**
 * 反射点を求め直す（GDD §6 v0.23）。反射点の探索は最大4候補×2本の射線判定と重いので、
 * 毎フレームではなく RICOCHET_RECALC_INTERVAL ごとに計算し、間は前回の結果を使い回す。
 * 標的が RICOCHET_RETARGET_DIST 以上動いた（＝別のプレイヤーに切り替わった等）ときは
 * 間隔を待たずに引き直す。
 */
function refreshRicochet(
  e: TurretTank,
  dt: number,
  stage: ParsedStage,
  p: TargetInfo,
): RicochetShot | null {
  const t = BALANCE.TURRET;
  e.ricochetRecalcTimer -= dt;
  const moved = Math.hypot(p.x - e.ricochetAimX, p.y - e.ricochetAimY);
  if (e.ricochetRecalcTimer <= 0 || moved >= t.RICOCHET_RETARGET_DIST) {
    e.ricochetShot = findOuterWallRicochet(stage, e.x, e.y, p.x, p.y);
    e.ricochetRecalcTimer = t.RICOCHET_RECALC_INTERVAL;
    e.ricochetAimX = p.x;
    e.ricochetAimY = p.y;
  }
  return e.ricochetShot;
}

/** 跳弾狙撃をやめたときに使い回しの結果を捨てる（次に必要になったら即座に計算し直す） */
function clearRicochet(e: TurretTank): null {
  e.ricochetShot = null;
  e.ricochetRecalcTimer = 0;
  return null;
}

/** 固定砲台の共通初期状態（create* から使う。ブレなしの敵も jitter は 0 で持つ） */
export function createTurretState(fireTimer: number): Omit<TurretTank, keyof TankBody> {
  return {
    state: "IDLE",
    fireTimer,
    jitter: 0,
    jitterTimer: 0,
    ricochetRolled: false,
    ricochetMode: false,
    ricochetShot: null,
    ricochetRecalcTimer: 0,
    ricochetAimX: Number.NaN, // 初回は必ず計算する（NaN との比較で moved は NaN → 条件は timer 側で成立）
    ricochetAimY: Number.NaN,
  };
}
