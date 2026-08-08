/**
 * 敵G「プリズム」（多重反射砲台型）のAI（GDD §6 v0.10）。
 * 手順は固定砲台4種で共通のため turretAi.ts に集約してあり、ここは仕様の宣言だけを持つ。
 * 構造は敵E「リフレクター」と同一で、撃つ弾と調整値だけが違う：
 *   - 照準 90°/s・ブレ±1°
 *   - 弾：280px/s・**反射上限3回**（盤面を長く飛び回る。PRISM_BULLET_CFG）・同時1発
 *   - 発射間隔 平均 3.0±1.0 s（難易度倍率の対象）
 *   - 跳弾狙撃は難易度によらず常時使用（"always"）。直接射線があれば直接射撃を優先
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { PRISM_BULLET_CFG } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { createEnemyBody, rollFireInterval } from "./enemyAi";
import type { Rng } from "./mathUtils";
import {
  createTurretState,
  type TurretTank,
  type TurretUpdateContext,
  updateTurretAi,
} from "./turretAi";

/** プリズム戦車 */
export interface PrismTank extends TurretTank {
  kind: "prism";
}

/** updatePrism に渡す周辺情報 */
export type PrismUpdateContext = TurretUpdateContext;

/** プリズムを生成する（初期は下向き。mods 省略時は NORMAL 相当） */
export function createPrism(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): PrismTank {
  return {
    ...createEnemyBody("prism", x, y, BALANCE.PRISM),
    ...createTurretState(rollFireInterval(rng, BALANCE.PRISM, mods.fireIntervalMult)),
  };
}

/** プリズムの更新（1フレーム分。dt は秒） */
export function updatePrism(e: PrismTank, dt: number, ctx: PrismUpdateContext): void {
  updateTurretAi(e, dt, ctx, BALANCE.PRISM, PRISM_BULLET_CFG, "always");
}
