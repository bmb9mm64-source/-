/**
 * 敵S「シールダー」（盾持ち型）のAI（GDD §6 v0.14）。
 * 移動はローバーと同じ徘徊方式（低速）。差分は**盾**：
 *   - 盾は常にプレイヤー（標的）の方を向く（追従 60°/s ＝ 砲塔より遅い）
 *   - 盾の正面 ±60°（計120°）から飛んできた弾は完全に無効化する（本体は無傷）
 *   - よって正面からの直射では絶対に倒せず、**跳弾で側面・背面から当てる**のが正解
 * 盾の判定そのものは shieldBlocks() として公開し、world の命中判定から呼ぶ。
 * Phaser 非依存の純粋 TS。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, ENEMY_BULLET_CFG, liveBulletCount, scaleBulletSpeed, spawnBullet } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import { pickWanderTarget } from "./rover";
import type { ParsedStage } from "./stage";
import { moveTank, type TankBlocker } from "./tank";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody, Vec2 } from "./types";

/** シールダー戦車 */
export interface ShielderTank extends TankBody {
  kind: "shielder";
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  shieldAngle: number; // 盾が向いている方向 [rad]
  target: Vec2; // 徘徊の目標点
  retargetTimer: number;
  stuckTimer: number;
}

/** 次回発射間隔（平均±ゆらぎ）×難易度倍率 */
export function shielderNextInterval(rng: Rng, intervalMult = 1): number {
  const c = BALANCE.SHIELDER;
  return (c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR)) * intervalMult;
}

/** シールダーを生成する（初期は下向き。盾も同じ向きから始まる） */
export function createShielder(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): ShielderTank {
  return {
    kind: "shielder",
    x,
    y,
    bodyAngle: Math.PI / 2,
    turretAngle: Math.PI / 2,
    half: BALANCE.SHIELDER.SIZE / 2,
    radius: BALANCE.SHIELDER.RADIUS,
    alive: true,
    fireTimer: shielderNextInterval(rng, mods.fireIntervalMult),
    shieldAngle: Math.PI / 2,
    target: { x, y },
    retargetTimer: 0,
    stuckTimer: 0,
  };
}

/**
 * 盾がこの弾を防ぐか（GDD §6 v0.14）。
 * 弾が「どちらから飛んできたか」＝弾の進行方向の逆向きが、盾の正面から ±SHIELD_ARC 以内なら防ぐ。
 */
export function shieldBlocks(e: { shieldAngle: number }, b: Bullet): boolean {
  const incoming = Math.atan2(-b.vy, -b.vx); // 弾が来た方向（弾から見た発射元の側）
  return Math.abs(angleDiff(incoming, e.shieldAngle)) <= BALANCE.SHIELDER.SHIELD_ARC;
}

/** updateShielder に渡す周辺情報 */
export interface ShielderUpdateContext {
  players: readonly TargetInfo[];
  bullets: Bullet[];
  blockers: readonly TankBlocker[];
  stage: ParsedStage;
  grace: number;
  rng: Rng;
  mods?: DifficultyMods;
}

/** シールダーの更新（1フレーム分。dt は秒） */
export function updateShielder(e: ShielderTank, dt: number, ctx: ShielderUpdateContext): void {
  const c = BALANCE.SHIELDER;
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 標的選択（GDD §12.5） ---
  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);
  const toPlayer = pick ? Math.atan2(pick.target.y - e.y, pick.target.x - e.x) : e.turretAngle;
  if (pick) {
    e.turretAngle = rotateToward(e.turretAngle, toPlayer, c.TURN_SPEED * dt);
    // 盾は砲塔より遅く追従する＝素早く回り込めば側面を晒せる
    e.shieldAngle = rotateToward(e.shieldAngle, toPlayer, c.SHIELD_TURN_SPEED * dt);
  }

  // --- 徘徊（ローバーと同方式・低速） ---
  e.retargetTimer -= dt;
  const distToTarget = Math.hypot(e.target.x - e.x, e.target.y - e.y);
  if (e.retargetTimer <= 0 || distToTarget < c.ARRIVE_DIST) {
    e.target = pickWanderTarget(ctx.stage, ctx.rng, e, c.WANDER_PICK_TRIES);
    e.retargetTimer = randRange(ctx.rng, c.RETARGET_INTERVAL_MIN, c.RETARGET_INTERVAL_MAX);
  }
  const dx = e.target.x - e.x;
  const dy = e.target.y - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist > c.ARRIVE_DIST) {
    const step = Math.min(c.SPEED * dt, dist);
    const prevX = e.x;
    const prevY = e.y;
    moveTank(e, (dx / dist) * step, (dy / dist) * step, ctx.blockers, ctx.stage);
    e.bodyAngle = rotateToward(e.bodyAngle, Math.atan2(dy, dx), c.BODY_TURN_SPEED * dt);
    if (Math.hypot(e.x - prevX, e.y - prevY) < step * 0.5) {
      e.stuckTimer += dt;
      if (e.stuckTimer >= c.STUCK_TIME) {
        e.target = pickWanderTarget(ctx.stage, ctx.rng, e, c.WANDER_PICK_TRIES);
        e.retargetTimer = randRange(ctx.rng, c.RETARGET_INTERVAL_MIN, c.RETARGET_INTERVAL_MAX);
        e.stuckTimer = 0;
      }
    } else {
      e.stuckTimer = 0;
    }
  }

  // --- 射撃（他の移動型と同条件） ---
  e.fireTimer -= dt;
  if (e.fireTimer < 0) e.fireTimer = 0;
  const ready =
    ctx.grace <= 0 &&
    e.fireTimer <= 0 &&
    liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS &&
    pick !== null &&
    pick.hasLos &&
    Math.abs(angleDiff(toPlayer, e.turretAngle)) < c.FIRE_ANGLE_TOL;
  if (ready) {
    spawnBullet(
      ctx.bullets,
      e,
      e.turretAngle,
      scaleBulletSpeed(ENEMY_BULLET_CFG, mods.bulletSpeedMult),
      ctx.stage,
    );
    e.fireTimer = shielderNextInterval(ctx.rng, mods.fireIntervalMult);
  }
}
