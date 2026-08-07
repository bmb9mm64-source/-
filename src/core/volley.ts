/**
 * 敵V「バースター」（連射型）のAI（GDD §6 v0.14）。
 * 固定砲台（移動なし）。差分は**3連射**：
 *   撃てる条件が揃うと 0.18 秒間隔で3発を撃ち、その後セット間隔（平均3.2±1.0s）を待つ。
 *   弾はやや遅い 200px/s で、プレイヤーが弾同士の相殺で撃ち落とす余地を残す。
 * Phaser 非依存の純粋 TS。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, liveBulletCount, scaleBulletSpeed, spawnBullet, VOLLEY_BULLET_CFG } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import type { ParsedStage } from "./stage";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody } from "./types";

/** バースター戦車 */
export interface VolleyTank extends TankBody {
  kind: "volley";
  fireTimer: number; // 次のセット／次の連射までの残り時間 [s]
  burstLeft: number; // このセットで残り何発撃つか（0 なら次のセット待ち）
  jitter: number;
  jitterTimer: number;
}

/** 次回セット間隔（平均±ゆらぎ）×難易度倍率 */
export function volleyNextInterval(rng: Rng, intervalMult = 1): number {
  const c = BALANCE.VOLLEY;
  return (c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR)) * intervalMult;
}

/** バースターを生成する（初期は下向き） */
export function createVolley(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): VolleyTank {
  return {
    kind: "volley",
    x,
    y,
    bodyAngle: Math.PI / 2,
    turretAngle: Math.PI / 2,
    half: BALANCE.VOLLEY.SIZE / 2,
    radius: BALANCE.VOLLEY.RADIUS,
    alive: true,
    fireTimer: volleyNextInterval(rng, mods.fireIntervalMult),
    burstLeft: 0,
    jitter: 0,
    jitterTimer: 0,
  };
}

/** updateVolley に渡す周辺情報 */
export interface VolleyUpdateContext {
  players: readonly TargetInfo[];
  bullets: Bullet[];
  stage: ParsedStage;
  grace: number;
  rng: Rng;
  mods?: DifficultyMods;
}

/** バースターの更新（1フレーム分。dt は秒） */
export function updateVolley(e: VolleyTank, dt: number, ctx: VolleyUpdateContext): void {
  const c = BALANCE.VOLLEY;
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 照準ブレの引き直し ---
  e.jitterTimer -= dt;
  if (e.jitterTimer <= 0) {
    e.jitter = randRange(ctx.rng, -c.JITTER_MAX, c.JITTER_MAX);
    e.jitterTimer = randRange(ctx.rng, c.JITTER_INTERVAL_MIN, c.JITTER_INTERVAL_MAX);
  }

  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);
  if (!pick) return;
  const toPlayer = Math.atan2(pick.target.y - e.y, pick.target.x - e.x);
  e.turretAngle = rotateToward(e.turretAngle, toPlayer + e.jitter, c.TURN_SPEED * dt);

  e.fireTimer -= dt;
  if (ctx.grace > 0 || e.fireTimer > 0) return;

  if (e.burstLeft > 0) {
    // 連射中：同時発射数に空きがあれば次弾を撃つ（射線が切れたらセットを中断）
    if (!pick.hasLos || liveBulletCount(ctx.bullets, e) >= c.MAX_BULLETS) {
      e.burstLeft = 0;
      e.fireTimer = volleyNextInterval(ctx.rng, mods.fireIntervalMult);
      return;
    }
    spawnBullet(
      ctx.bullets,
      e,
      e.turretAngle,
      scaleBulletSpeed(VOLLEY_BULLET_CFG, mods.bulletSpeedMult),
      ctx.stage,
    );
    e.burstLeft--;
    e.fireTimer = e.burstLeft > 0 ? c.BURST_GAP : volleyNextInterval(ctx.rng, mods.fireIntervalMult);
    return;
  }

  // セット開始の条件（射線・照準・弾数）
  const ready =
    pick.hasLos &&
    liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS &&
    Math.abs(angleDiff(toPlayer, e.turretAngle)) < c.FIRE_ANGLE_TOL;
  if (ready) {
    spawnBullet(
      ctx.bullets,
      e,
      e.turretAngle,
      scaleBulletSpeed(VOLLEY_BULLET_CFG, mods.bulletSpeedMult),
      ctx.stage,
    );
    e.burstLeft = c.BURST_COUNT - 1; // 残り2発
    e.fireTimer = c.BURST_GAP;
  }
}
