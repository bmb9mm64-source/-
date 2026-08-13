/**
 * 敵の種類とステージ記号の対応表（Phaser 非依存・他モジュールに依存しない純粋 TS）。
 *
 * 「敵は13種類ある」という事実の**唯一の定義**。ステージのパース（stage.ts）・
 * エディタのパレット（editor.ts）・生成と描画のレジストリ（enemyRegistry.ts）は
 * すべてここから導出する。敵を1種増やすときに最初に触るのがこのファイル。
 * AI 実装への依存を持たないため、stage.ts から安全に import できる（循環参照の回避）。
 */
import type { Vec2 } from "./types";

/** ステージ記号 → 敵の種類（GDD §6・§7） */
export const ENEMY_KIND_BY_CHAR = {
  A: "sentry", // 敵A「セントリー」（固定砲台型）
  B: "rover", // 敵B「ローバー」（遊撃型）
  C: "sniper", // 敵C「スナイパー」（狙撃型）
  D: "minelayer", // 敵D「マインレイヤー」（地雷敷設型）
  E: "reflector", // 敵E「リフレクター」（反射砲台型）
  F: "chaser", // 敵F「チェイサー」（追跡型）
  G: "prism", // 敵G「プリズム」（多重反射砲台型）
  S: "shielder", // 敵S「シールダー」（盾持ち型）
  V: "volley", // 敵V「バースター」（連射型）
  M: "mortar", // 敵M「ボマー」（榴弾型）
  T: "tracker", // 敵T「トラッカー」（偏差射撃型。GDD §6 v0.24）
  L: "lancer", // 敵L「ランサー」（突進型。GDD §6 v0.24）
  Y: "mirror", // 敵Y「ミラー」（反射装甲型。GDD §6 v0.24）
} as const;

/** 敵のステージ記号 */
export type EnemyChar = keyof typeof ENEMY_KIND_BY_CHAR;

/** 敵の種類（各 *Tank の kind と一致） */
export type EnemyKind = (typeof ENEMY_KIND_BY_CHAR)[EnemyChar];

/** 敵のステージ記号一覧（パレットの並び順＝A〜G・S・V・M・T・L・Y） */
export const ENEMY_CHARS = Object.keys(ENEMY_KIND_BY_CHAR) as EnemyChar[];

/** 敵の種類一覧 */
export const ENEMY_KINDS = ENEMY_CHARS.map((c) => ENEMY_KIND_BY_CHAR[c]);

/** その文字が敵記号か（型ガード） */
export function isEnemyChar(ch: string): ch is EnemyChar {
  return ch in ENEMY_KIND_BY_CHAR;
}

/** 敵の種類ごとの初期位置（ParsedStage.spawns の形） */
export type EnemySpawns = Record<EnemyKind, Vec2[]>;

/** 全種類を空配列で持つ EnemySpawns を作る */
export function emptyEnemySpawns(): EnemySpawns {
  const spawns = {} as EnemySpawns;
  for (const kind of ENEMY_KINDS) spawns[kind] = [];
  return spawns;
}

/** 種類を問わず全敵の初期位置を1本の配列にする（配置数の検証・射線チェック用） */
export function allEnemySpawns(spawns: EnemySpawns): Vec2[] {
  const all: Vec2[] = [];
  for (const kind of ENEMY_KINDS) all.push(...spawns[kind]);
  return all;
}
