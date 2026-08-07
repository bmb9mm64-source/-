/**
 * 敵M「ボマー」（榴弾型）のAI（GDD §6 v0.14）。
 * 固定砲台（移動なし）。差分は**撃つ弾が榴弾**であること：
 *   反射せず直進し、1.1 秒後または壁に当たった時点で炸裂して爆風（半径44px）を出す。
 *   爆風はプレイヤーには当たるが敵には当たらない（§5.2 の自滅禁止の原則）。
 *   遮蔽の裏に隠れても爆風が回り込むため、「隠れる」だけでは安全でないのが役割。
 * Phaser 非依存の純粋 TS。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, liveBulletCount, scaleBulletSpeed, SHELL_CFG, spawnBullet } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import type { ParsedStage } from "./stage";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody } from "./types";

/** ボマー戦車 */
export interface MortarTank extends TankBody {
  kind: "mortar";
  fireTimer: number;
  jitter: number;
  jitterTimer: number;
}

/** 次回発射間隔（平均±ゆらぎ）×難易度倍率 */
export function mortarNextInterval(rng: Rng, intervalMult = 1): number {
  const c = BALANCE.MORTAR;
  return (c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR)) * intervalMult;
}

/** ボマーを生成する（初期は下向き） */
export function createMortar(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): MortarTank {
  return {
    kind: "mortar",
    x,
    y,
    bodyAngle: Math.PI / 2,
    turretAngle: Math.PI / 2,
    half: BALANCE.MORTAR.SIZE / 2,
    radius: BALANCE.MORTAR.RADIUS,
    alive: true,
    fireTimer: mortarNextInterval(rng, mods.fireIntervalMult),
    jitter: 0,
    jitterTimer: 0,
  };
}

/** updateMortar に渡す周辺情報 */
export interface MortarUpdateContext {
  players: readonly TargetInfo[];
  bullets: Bullet[];
  stage: ParsedStage;
  grace: number;
  rng: Rng;
  mods?: DifficultyMods;
}

/** ボマーの更新（1フレーム分。dt は秒） */
export function updateMortar(e: MortarTank, dt: number, ctx: MortarUpdateContext): void {
  const c = BALANCE.MORTAR;
  const mods = ctx.mods ?? NORMAL_MODS;

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
  const ready =
    ctx.grace <= 0 &&
    e.fireTimer <= 0 &&
    pick.hasLos &&
    liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS &&
    Math.abs(angleDiff(toPlayer, e.turretAngle)) < c.FIRE_ANGLE_TOL;
  if (ready) {
    spawnBullet(ctx.bullets, e, e.turretAngle, scaleBulletSpeed(SHELL_CFG, mods.bulletSpeedMult), ctx.stage);
    e.fireTimer = mortarNextInterval(ctx.rng, mods.fireIntervalMult);
  }
}
