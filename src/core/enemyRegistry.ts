/**
 * 敵10種のレジストリ（Phaser 非依存の純粋 TS）。
 *
 * 「この敵はどう生成し・どう更新し・何色で描くか」を敵ごとに1エントリで持つ。
 * world.ts の生成／更新、GameScene の描画、エディタのパレット配色はすべてここを引くので、
 * 敵を1種増やすときに触るのは「enemyKinds.ts に記号を1行」＋「AI モジュール1本」＋
 * 「本ファイルに1エントリ」＋「balance.ts に調整値と色」だけで済む。
 * Record<EnemyKind, …> にしてあるため、追加時の書き忘れは型エラーになる。
 */
import { COLORS } from "../config/balance";
import type { Bullet } from "./bullet";
import { createChaser, type ChaserTank, updateChaser } from "./chaser";
import type { DifficultyMods } from "./difficulty";
import type { EnemyChar, EnemyKind } from "./enemyKinds";
import type { Rng } from "./mathUtils";
import type { Mine } from "./mine";
import { createMinelayer, type MinelayerTank, updateMinelayer } from "./minelayer";
import { createMortar, type MortarTank, updateMortar } from "./mortar";
import { createPrism, type PrismTank, updatePrism } from "./prism";
import { createReflector, type ReflectorTank, updateReflector } from "./reflector";
import { createRover, type RoverTank, updateRover } from "./rover";
import { createSentry, type SentryTank, updateSentry } from "./sentry";
import { createShielder, type ShielderTank, updateShielder } from "./shielder";
import { createSniper, type SniperTank, updateSniper } from "./sniper";
import type { ParsedStage } from "./stage";
import type { TankBlocker } from "./tank";
import type { TargetInfo } from "./targeting";
import { createVolley, type VolleyTank, updateVolley } from "./volley";

/** 敵戦車（10種の判別可能なユニオン） */
export type EnemyTank =
  | SentryTank
  | RoverTank
  | SniperTank
  | MinelayerTank
  | ReflectorTank
  | ChaserTank
  | PrismTank
  | ShielderTank
  | VolleyTank
  | MortarTank;

/**
 * 敵AIに渡す周辺情報（10種ぶんを1つに統合したもの）。
 * blockers・mines は使わない敵が無視するだけなので、world 側は1つ作って全員に使い回せる。
 */
export interface EnemyUpdateContext {
  players: readonly TargetInfo[];
  bullets: Bullet[];
  blockers: readonly TankBlocker[]; // 全戦車（自分自身が含まれていてもよい。moveTank が無視する）
  mines: Mine[];
  stage: ParsedStage;
  grace: number;
  rng: Rng;
  mods: DifficultyMods;
}

/** 戦車の配色（本体・履帯・砲塔） */
export interface EnemyColors {
  body: number;
  track: number;
  turret: number;
}

/** 敵1種の定義 */
export interface EnemyDef {
  char: EnemyChar; // ステージ記号
  colors: EnemyColors;
  create(x: number, y: number, rng: Rng, mods: DifficultyMods): EnemyTank;
  update(e: EnemyTank, dt: number, ctx: EnemyUpdateContext): void;
}

/** 1エントリを作る（update の引数を各敵の具体型へ絞るためのヘルパ） */
function def<T extends EnemyTank>(
  char: EnemyChar,
  colors: EnemyColors,
  create: (x: number, y: number, rng: Rng, mods: DifficultyMods) => T,
  update: (e: T, dt: number, ctx: EnemyUpdateContext) => void,
): EnemyDef {
  return { char, colors, create, update: (e, dt, ctx) => update(e as T, dt, ctx) };
}

/** 敵の種類ごとの定義（配色は balance.ts の COLORS。GDD §9：すべてオリジナル配色） */
export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  sentry: def(
    "A",
    { body: COLORS.ENEMY_BODY, track: COLORS.ENEMY_TRACK, turret: COLORS.ENEMY_TURRET },
    createSentry,
    updateSentry,
  ),
  rover: def(
    "B",
    { body: COLORS.ROVER_BODY, track: COLORS.ROVER_TRACK, turret: COLORS.ROVER_TURRET },
    createRover,
    updateRover,
  ),
  sniper: def(
    "C",
    { body: COLORS.SNIPER_BODY, track: COLORS.SNIPER_TRACK, turret: COLORS.SNIPER_TURRET },
    createSniper,
    updateSniper,
  ),
  minelayer: def(
    "D",
    {
      body: COLORS.MINELAYER_BODY,
      track: COLORS.MINELAYER_TRACK,
      turret: COLORS.MINELAYER_TURRET,
    },
    createMinelayer,
    updateMinelayer,
  ),
  reflector: def(
    "E",
    {
      body: COLORS.REFLECTOR_BODY,
      track: COLORS.REFLECTOR_TRACK,
      turret: COLORS.REFLECTOR_TURRET,
    },
    createReflector,
    updateReflector,
  ),
  chaser: def(
    "F",
    { body: COLORS.CHASER_BODY, track: COLORS.CHASER_TRACK, turret: COLORS.CHASER_TURRET },
    createChaser,
    updateChaser,
  ),
  prism: def(
    "G",
    { body: COLORS.PRISM_BODY, track: COLORS.PRISM_TRACK, turret: COLORS.PRISM_TURRET },
    createPrism,
    updatePrism,
  ),
  shielder: def(
    "S",
    { body: COLORS.SHIELDER_BODY, track: COLORS.SHIELDER_TRACK, turret: COLORS.SHIELDER_TURRET },
    createShielder,
    updateShielder,
  ),
  volley: def(
    "V",
    { body: COLORS.VOLLEY_BODY, track: COLORS.VOLLEY_TRACK, turret: COLORS.VOLLEY_TURRET },
    createVolley,
    updateVolley,
  ),
  mortar: def(
    "M",
    { body: COLORS.MORTAR_BODY, track: COLORS.MORTAR_TRACK, turret: COLORS.MORTAR_TURRET },
    createMortar,
    updateMortar,
  ),
};

/** ステージ記号 → 定義（エディタのパレット配色に使う） */
export const ENEMY_DEF_BY_CHAR: Readonly<Record<EnemyChar, EnemyDef>> = Object.fromEntries(
  Object.values(ENEMY_DEFS).map((d) => [d.char, d]),
) as Record<EnemyChar, EnemyDef>;
