/**
 * 敵C「スナイパー」（狙撃型）のAI（GDD §6 v0.6）。
 * 手順は固定砲台4種で共通のため turretAi.ts に集約してあり、ここは仕様の宣言だけを持つ。
 *   - 照準はゆっくり（70°/s）だが**ブレなし**（精密照準＝BALANCE.SNIPER が JITTER_* を持たない）
 *   - 弾速 340px/s（SNIPER_BULLET_CFG。反射上限は共通の1回）・同時1発
 *   - 発射間隔 平均 4.0±1.0 s（難易度倍率の対象）
 *   - 跳弾狙撃は AIM 突入ごとの抽選（確率は難易度連動。GDD §6 v0.9 で個別値35%を廃止）
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { SNIPER_BULLET_CFG } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { createEnemyBody, rollFireInterval } from "./enemyAi";
import type { Rng } from "./mathUtils";
import {
  createTurretState,
  type TurretTank,
  type TurretUpdateContext,
  updateTurretAi,
} from "./turretAi";

/** スナイパー戦車 */
export interface SniperTank extends TurretTank {
  kind: "sniper";
}

/** updateSniper に渡す周辺情報 */
export type SniperUpdateContext = TurretUpdateContext;

/** スナイパーを生成する（初期は下向き。mods 省略時は NORMAL 相当） */
export function createSniper(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): SniperTank {
  return {
    ...createEnemyBody("sniper", x, y, BALANCE.SNIPER),
    ...createTurretState(rollFireInterval(rng, BALANCE.SNIPER, mods.fireIntervalMult)),
  };
}

/** スナイパーの更新（1フレーム分。dt は秒） */
export function updateSniper(e: SniperTank, dt: number, ctx: SniperUpdateContext): void {
  updateTurretAi(e, dt, ctx, BALANCE.SNIPER, SNIPER_BULLET_CFG, "roll");
}
