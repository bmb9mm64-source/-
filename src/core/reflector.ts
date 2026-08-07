/**
 * 敵E「リフレクター」（反射砲台型）のAI（GDD §6 v0.9）。
 * 構造は敵A「セントリー」の再利用（移動なし・IDLE → AIM → RELOAD のステートマシン）。差分：
 *   - 照準 100°/s・ブレ±1°
 *   - 弾：300px/s・**反射上限2回**（この敵の弾だけ2回跳ねる。REFLECTOR_BULLET_CFG）・同時2発
 *   - 発射間隔 平均 2.5±0.8 s（難易度倍率の対象）
 *   - **跳弾狙撃は難易度によらず常時使用（100%＝抽選なし）**。直接射線があれば直接射撃を優先
 * 弾速には難易度の敵弾速倍率を適用する（GDD §8.3 の表は敵弾全般）。
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, liveBulletCount, REFLECTOR_BULLET_CFG, scaleBulletSpeed, spawnBullet } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import { findOuterWallRicochet } from "./ricochetAim";
import type { ParsedStage } from "./stage";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody } from "./types";

/** リフレクターの状態名 */
export type ReflectorFsmState = "IDLE" | "AIM" | "RELOAD";

/** リフレクター戦車 */
export interface ReflectorTank extends TankBody {
  kind: "reflector";
  state: ReflectorFsmState;
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  jitter: number; // 現在の照準ブレ [rad]（±1°）
  jitterTimer: number; // ブレ引き直しまでの残り時間 [s]
}

/** 次回発射間隔（平均±ゆらぎ）×難易度倍率 を引く（GDD §8.3） */
export function reflectorNextInterval(rng: Rng, intervalMult = 1): number {
  const c = BALANCE.REFLECTOR;
  return (c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR)) * intervalMult;
}

/** リフレクターを生成する（初期は下向き。mods 省略時は NORMAL 相当） */
export function createReflector(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): ReflectorTank {
  return {
    kind: "reflector",
    x,
    y,
    bodyAngle: Math.PI / 2, // 車体は固定（見た目のみ）
    turretAngle: Math.PI / 2,
    half: BALANCE.REFLECTOR.SIZE / 2,
    radius: BALANCE.REFLECTOR.RADIUS,
    alive: true,
    state: "IDLE",
    fireTimer: reflectorNextInterval(rng, mods.fireIntervalMult),
    jitter: 0,
    jitterTimer: 0,
  };
}

/** updateReflector に渡す周辺情報 */
export interface ReflectorUpdateContext {
  players: readonly TargetInfo[]; // 全プレイヤー（標的選択に使う。GDD §12.5）
  bullets: Bullet[]; // 場の弾（発射先・同時発射数カウント）
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
  mods?: DifficultyMods; // 難易度の実効調整値（省略時は NORMAL 相当。発射間隔・弾速に適用）
}

/**
 * リフレクターの更新。
 * 標的は「生存プレイヤーのうち射線が通る最も近い1体」（GDD §12.5。セントリーと同じ）。
 * 狙いの決定：直接射線があれば標的（直接射撃を優先）。塞がれていれば**常に**外周壁1回反射の
 * 射線を毎フレーム再計算して反射点を狙う（抽選なし＝常時100%。GDD §6 v0.9）。
 * 発射条件：発射間隔消化・同時2発未満・砲塔が狙い方向 ±0.15rad 以内・射線（直接 or 跳弾）が成立。
 * 撃つ弾は反射上限2回（プレイヤーから見ると「2回跳ねてから消える」弾。REFLECTOR_BULLET_CFG）。
 */
export function updateReflector(e: ReflectorTank, dt: number, ctx: ReflectorUpdateContext): void {
  const c = BALANCE.REFLECTOR;
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 照準ブレの引き直し（全状態共通。±1°） ---
  e.jitterTimer -= dt;
  if (e.jitterTimer <= 0) {
    e.jitter = randRange(ctx.rng, -c.JITTER_MAX, c.JITTER_MAX);
    e.jitterTimer = randRange(ctx.rng, c.JITTER_INTERVAL_MIN, c.JITTER_INTERVAL_MAX);
  }

  // --- 標的選択（GDD §12.5）。生存者がいなければ何もしない（同フレーム内でリセットされる） ---
  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);
  if (!pick) return;
  const p = pick.target;

  // --- 狙いの決定：直接射線があれば標的、なければ常に跳弾の反射点（抽選なし。GDD §6 v0.9） ---
  const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
  const direct = pick.hasLos;
  const shot = !direct ? findOuterWallRicochet(ctx.stage, e.x, e.y, p.x, p.y) : null;
  const aimTarget = shot ? shot.aimAngle : toPlayer;
  e.turretAngle = rotateToward(e.turretAngle, aimTarget + e.jitter, c.TURN_SPEED * dt);

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
        liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS && // 同時2発（GDD §6 v0.9）
        Math.abs(angleDiff(aimTarget, e.turretAngle)) < c.FIRE_ANGLE_TOL && // 砲塔がほぼ狙い通り
        (direct || shot !== null); // 直接射線 or 跳弾射線のどちらかが成立
      if (ready) {
        // 300px/s・反射上限2回 ×難易度弾速倍率
        spawnBullet(ctx.bullets, e, e.turretAngle, scaleBulletSpeed(REFLECTOR_BULLET_CFG, mods.bulletSpeedMult), ctx.stage);
        e.fireTimer = reflectorNextInterval(ctx.rng, mods.fireIntervalMult);
        e.state = "RELOAD";
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
