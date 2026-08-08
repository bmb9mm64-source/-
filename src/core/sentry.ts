/**
 * 敵A「セントリー」（固定砲台型）のAI（GDD §6）。
 * 手順は固定砲台4種で共通のため turretAi.ts に集約してあり、ここは仕様の宣言だけを持つ。
 *   - 照準 115°/s・ブレ±2°
 *   - 弾：225px/s・反射上限1回（共通の ENEMY_BULLET_CFG）・同時1発
 *   - 発射間隔 平均 2.2±0.8 s（難易度倍率の対象）
 *   - 跳弾狙撃は直接射線が塞がれているときに AIM 突入ごとの抽選（確率は難易度連動。GDD §6 v0.9）
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { ENEMY_BULLET_CFG } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { createEnemyBody, rollFireInterval } from "./enemyAi";
import type { Rng } from "./mathUtils";
import {
  createTurretState,
  type TurretTank,
  type TurretUpdateContext,
  updateTurretAi,
} from "./turretAi";

/** セントリー戦車 */
export interface SentryTank extends TurretTank {
  kind: "sentry";
}

/** updateSentry に渡す周辺情報 */
export type SentryUpdateContext = TurretUpdateContext;

/** セントリーを生成する（初期は下向き。mods 省略時は NORMAL 相当） */
export function createSentry(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): SentryTank {
  return {
    ...createEnemyBody("sentry", x, y, BALANCE.SENTRY),
    ...createTurretState(rollFireInterval(rng, BALANCE.SENTRY, mods.fireIntervalMult)),
  };
}

/** セントリーの更新（1フレーム分。dt は秒） */
export function updateSentry(e: SentryTank, dt: number, ctx: SentryUpdateContext): void {
  updateTurretAi(e, dt, ctx, BALANCE.SENTRY, ENEMY_BULLET_CFG, "roll");
}
