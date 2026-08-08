/**
 * 敵E「リフレクター」（反射砲台型）のAI（GDD §6 v0.9）。
 * 手順は固定砲台4種で共通のため turretAi.ts に集約してあり、ここは仕様の宣言だけを持つ。
 *   - 照準 100°/s・ブレ±1°
 *   - 弾：300px/s・**反射上限2回**（この敵の弾だけ2回跳ねる。REFLECTOR_BULLET_CFG）・同時2発
 *   - 発射間隔 平均 2.5±0.8 s（難易度倍率の対象）
 *   - **跳弾狙撃は難易度によらず常時使用（"always"＝抽選なし）**。直接射線があれば直接射撃を優先
 * 弾速には難易度の敵弾速倍率を適用する（GDD §8.3 の表は敵弾全般）。
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { REFLECTOR_BULLET_CFG } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { createEnemyBody, rollFireInterval } from "./enemyAi";
import type { Rng } from "./mathUtils";
import {
  createTurretState,
  type TurretTank,
  type TurretUpdateContext,
  updateTurretAi,
} from "./turretAi";

/** リフレクター戦車 */
export interface ReflectorTank extends TurretTank {
  kind: "reflector";
}

/** updateReflector に渡す周辺情報 */
export type ReflectorUpdateContext = TurretUpdateContext;

/** リフレクターを生成する（初期は下向き。mods 省略時は NORMAL 相当） */
export function createReflector(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): ReflectorTank {
  return {
    ...createEnemyBody("reflector", x, y, BALANCE.REFLECTOR),
    ...createTurretState(rollFireInterval(rng, BALANCE.REFLECTOR, mods.fireIntervalMult)),
  };
}

/** リフレクターの更新（1フレーム分。dt は秒） */
export function updateReflector(e: ReflectorTank, dt: number, ctx: ReflectorUpdateContext): void {
  updateTurretAi(e, dt, ctx, BALANCE.REFLECTOR, REFLECTOR_BULLET_CFG, "always");
}
