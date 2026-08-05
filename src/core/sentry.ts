/**
 * 敵A「セントリー」（固定砲台型）のAI。ステートマシン（状態機械）で実装（GDD §6）。
 * 状態遷移：IDLE（開幕グレース中）→ AIM（照準・発射判断）→ RELOAD（装填待ち）→ AIM …
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, liveBulletCount, spawnBullet } from "./bullet";
import { hasLineOfSight } from "./los";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import type { ParsedStage } from "./stage";
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
  };
}

/** updateSentry に渡す周辺情報 */
export interface SentryUpdateContext {
  player: { x: number; y: number }; // プレイヤー位置
  bullets: Bullet[]; // 場の弾（発射先・同時発射数カウント）
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
}

/**
 * セントリーの更新。
 * どの状態でも砲塔はプレイヤーへ 90°/s で追従し、±数度のブレを載せる。
 * 発射条件（GDD v0.2 §6）：発射間隔消化・同時1発・砲塔がプレイヤー方向 ±0.15rad 以内・射線が通る。
 */
export function updateSentry(e: SentryTank, dt: number, ctx: SentryUpdateContext): void {
  const c = BALANCE.SENTRY;
  const p = ctx.player;

  // --- 照準（全状態共通）：ブレの引き直しと砲塔回転 ---
  e.jitterTimer -= dt;
  if (e.jitterTimer <= 0) {
    e.jitter = randRange(ctx.rng, -c.JITTER_MAX, c.JITTER_MAX);
    e.jitterTimer = randRange(ctx.rng, c.JITTER_INTERVAL_MIN, c.JITTER_INTERVAL_MAX);
  }
  const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
  e.turretAngle = rotateToward(e.turretAngle, toPlayer + e.jitter, c.TURN_SPEED * dt);

  // --- 状態遷移 ---
  switch (e.state) {
    case "IDLE": // 開幕グレース：照準のみ、射撃しない
      if (ctx.grace <= 0) e.state = "AIM";
      break;

    case "AIM": {
      // 発射条件が揃ったら撃つ
      e.fireTimer -= dt;
      const ready =
        e.fireTimer <= 0 &&
        liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS && // 同時1発
        Math.abs(angleDiff(toPlayer, e.turretAngle)) < c.FIRE_ANGLE_TOL && // 砲塔がほぼ狙い通り
        hasLineOfSight(ctx.stage, e.x, e.y, p.x, p.y); // 射線が通っている
      if (ready) {
        spawnBullet(ctx.bullets, e, e.turretAngle);
        e.fireTimer = sentryNextInterval(ctx.rng);
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
