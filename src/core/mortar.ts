/**
 * 敵M「ボマー」（榴弾型）のAI（GDD §6 v0.14）。
 * 固定砲台（移動なし）。差分は**撃つ弾が榴弾**であること：
 *   反射せず直進し、1.1 秒後または壁に当たった時点で炸裂して爆風（半径44px）を出す。
 *   爆風はプレイヤーには当たるが敵には当たらない（§5.2 の自滅禁止の原則）。
 *   遮蔽の裏に隠れても爆風が回り込むため、「隠れる」だけでは安全でないのが役割。
 * 跳弾狙撃を持たない（榴弾は反射しない）ため turretAi.ts には載せず、
 * 共通部品（照準ブレ・発射判定）だけを enemyAi.ts から使う。
 * Phaser 非依存の純粋 TS。
 */
import { type Bullet, scaleBulletSpeed, SHELL_CFG } from "./bullet";
import { BALANCE } from "../config/balance";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import {
  createEnemyBody,
  type JitterState,
  rollAimJitter,
  rollFireInterval,
  tryEnemyFire,
} from "./enemyAi";
import { type Rng, rotateToward } from "./mathUtils";
import type { ParsedStage } from "./stage";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody } from "./types";

/** ボマー戦車 */
export interface MortarTank extends TankBody, JitterState {
  kind: "mortar";
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
}

/** ボマーを生成する（初期は下向き） */
export function createMortar(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): MortarTank {
  return {
    ...createEnemyBody("mortar", x, y, BALANCE.MORTAR),
    fireTimer: rollFireInterval(rng, BALANCE.MORTAR, mods.fireIntervalMult),
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

  rollAimJitter(e, dt, c, ctx.rng);

  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);
  if (!pick) return;
  const toPlayer = Math.atan2(pick.target.y - e.y, pick.target.x - e.x);
  e.turretAngle = rotateToward(e.turretAngle, toPlayer + e.jitter, c.TURN_SPEED * dt);

  tryEnemyFire(
    e,
    dt,
    ctx,
    toPlayer,
    pick.hasLos,
    c,
    scaleBulletSpeed(SHELL_CFG, mods.bulletSpeedMult),
    mods.fireIntervalMult,
  );
}
