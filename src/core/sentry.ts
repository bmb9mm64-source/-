/**
 * 敵A「セントリー」（固定砲台型）のAI。ステートマシン（状態機械）で実装（GDD §6）。
 * 状態遷移：IDLE（開幕グレース中）→ AIM（照準・発射判断）→ RELOAD（装填待ち）→ AIM …
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, ENEMY_BULLET_CFG, liveBulletCount, spawnBullet } from "./bullet";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import { findOuterWallRicochet } from "./ricochetAim";
import type { ParsedStage } from "./stage";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody } from "./types";

/** セントリーの状態名 */
export type SentryFsmState = "IDLE" | "AIM" | "RELOAD";

/** セントリー戦車 */
export interface SentryTank extends TankBody {
  kind: "sentry";
  state: SentryFsmState;
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  jitter: number; // 現在の照準ブレ [rad]
  jitterTimer: number; // ブレ引き直しまでの残り時間 [s]
  ricochetRolled: boolean; // このAIMサイクルで跳弾狙撃の抽選を消化したか
  ricochetMode: boolean; // 抽選に当たり跳弾狙撃を試みているか（GDD §6 v0.4）
}

/** 次回発射間隔（平均±ゆらぎ）を引く */
export function sentryNextInterval(rng: Rng): number {
  const c = BALANCE.SENTRY;
  return c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR);
}

/** セントリーを生成する（初期は下向き） */
export function createSentry(x: number, y: number, rng: Rng): SentryTank {
  return {
    kind: "sentry",
    x,
    y,
    bodyAngle: Math.PI / 2, // 車体は固定（見た目のみ）
    turretAngle: Math.PI / 2,
    half: BALANCE.SENTRY.SIZE / 2,
    radius: BALANCE.SENTRY.RADIUS,
    alive: true,
    state: "IDLE",
    fireTimer: sentryNextInterval(rng),
    jitter: 0,
    jitterTimer: 0,
    ricochetRolled: false,
    ricochetMode: false,
  };
}

/** updateSentry に渡す周辺情報 */
export interface SentryUpdateContext {
  players: readonly TargetInfo[]; // 全プレイヤー（生存判定を含む。標的選択に使う。GDD §12.5）
  bullets: Bullet[]; // 場の弾（発射先・同時発射数カウント）
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
}

/**
 * セントリーの更新。
 * 標的は「生存プレイヤーのうち射線が通る最も近い1体」。全員遮蔽なら最も近い生存者を照準追従のみ
 * （GDD §12.5。1人プレイでは従来と同じ挙動）。
 * どの状態でも砲塔は狙い（通常は標的、跳弾狙撃中は反射点）へ追従し、±数度のブレを載せる。
 * 発射条件（GDD v0.2 §6）：発射間隔消化・同時1発・砲塔が狙い方向 ±0.15rad 以内・射線が通る。
 * 跳弾狙撃（GDD §6 v0.4）：標的への直接射線が塞がれているとき、AIM 突入ごとに1回だけ抽選（20%）し、
 * 当たれば外周壁1回反射の射線を毎フレーム再計算して反射点方向へ撃つ。直接射線があれば常に通常射撃を優先。
 */
export function updateSentry(e: SentryTank, dt: number, ctx: SentryUpdateContext): void {
  const c = BALANCE.SENTRY;

  // --- 照準ブレの引き直し（全状態共通） ---
  e.jitterTimer -= dt;
  if (e.jitterTimer <= 0) {
    e.jitter = randRange(ctx.rng, -c.JITTER_MAX, c.JITTER_MAX);
    e.jitterTimer = randRange(ctx.rng, c.JITTER_INTERVAL_MIN, c.JITTER_INTERVAL_MAX);
  }

  // --- 標的選択（GDD §12.5）。生存者がいなければ何もしない（同フレーム内でリセットされる） ---
  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);
  if (!pick) return;
  const p = pick.target;

  // --- 狙いの決定：直接射線があれば標的、なければ（抽選成立時のみ）跳弾の反射点 ---
  const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
  const direct = pick.hasLos;
  if (e.state === "AIM" && !e.ricochetRolled) {
    // AIM 突入後の初回フレームで抽選を1回だけ消化（リロードごと）
    e.ricochetRolled = true;
    e.ricochetMode = !direct && ctx.rng() < c.RICOCHET_AIM_CHANCE;
  }
  const shot =
    e.state === "AIM" && !direct && e.ricochetMode
      ? findOuterWallRicochet(ctx.stage, e.x, e.y, p.x, p.y)
      : null;
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
        liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS && // 同時1発
        Math.abs(angleDiff(aimTarget, e.turretAngle)) < c.FIRE_ANGLE_TOL && // 砲塔がほぼ狙い通り
        (direct || shot !== null); // 直接射線 or 跳弾射線のどちらかが成立
      if (ready) {
        spawnBullet(ctx.bullets, e, e.turretAngle, ENEMY_BULLET_CFG);
        e.fireTimer = sentryNextInterval(ctx.rng);
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
        e.ricochetRolled = false; // AIM 復帰時に抽選をリセット
        e.ricochetMode = false;
      }
      break;
  }
}
