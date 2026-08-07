/**
 * テスト用ヘルパー — 小さな盤面の生成と決定的な乱数。
 */
import type { Bullet } from "../src/core/bullet";
import { parseStage, type ParsedStage } from "../src/core/stage";

/** 任意サイズの文字列グリッドを解析する（行・列数は自動判定） */
export function makeStage(lines: readonly string[]): ParsedStage {
  return parseStage(lines, { cols: lines[0]!.length, rows: lines.length });
}

/** テスト用の弾を直接生成する */
export function makeBullet(partial: Partial<Bullet>): Bullet {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: 4,
    bounces: 0,
    owner: { x: 0, y: 0 }, // 実体の戦車ではないダミーの発射者
    ownerIsPlayer: false,
    armed: true,
    dead: false,
    ...partial,
  };
}

/**
 * 5×5 の全面床ステージ（外周のみ壁）。内側の床は x,y ∈ [32,128]。
 * P はパーサ必須のため置くが、座標はテストでは使わない。
 */
export const FLOOR_5X5: readonly string[] = [
  "#####",
  "#P..#",
  "#...#",
  "#...#",
  "#####",
];
