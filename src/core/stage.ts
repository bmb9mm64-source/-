/**
 * ステージ文字列グリッドのパーサとタイル参照（Phaser 非依存の純粋 TS）。
 * タイル種別（GDD §7）：
 *   . 床（通行可・弾通過）   # 恒久壁（通行不可・弾反射）
 *   X 破壊可能壁（通行不可・弾は消滅＝反射しない）
 *   H 穴（戦車不可・弾は上を通過）
 *   P プレイヤー初期位置（床扱い）   A 敵A「セントリー」（床扱い）
 */
import { BALANCE } from "../config/balance";
import type { Vec2 } from "./types";

/** 解析済みステージ */
export interface ParsedStage {
  grid: string[][]; // grid[row][col] のタイル文字（P/A は '.' に置換済み）
  cols: number;
  rows: number;
  tile: number; // 1タイルの辺長 [px]
  playerSpawn: Vec2; // プレイヤー初期位置（タイル中心の px 座標）
  sentrySpawns: Vec2[]; // 敵A「セントリー」の初期位置
}

/** パーサのオプション（省略時は GDD §7 の正規サイズ。テストでは小さい盤面を渡せる） */
export interface StageParseOptions {
  cols?: number;
  rows?: number;
  tile?: number;
}

/** ステージ文字列グリッドを解析して ParsedStage を返す。不正なデータは例外を投げる */
export function parseStage(lines: readonly string[], options: StageParseOptions = {}): ParsedStage {
  const cols = options.cols ?? BALANCE.COLS;
  const rows = options.rows ?? BALANCE.ROWS;
  const tile = options.tile ?? BALANCE.TILE;

  if (lines.length !== rows) {
    throw new Error(`ステージの行数が不正: ${lines.length} (期待値 ${rows})`);
  }
  const grid: string[][] = [];
  let playerSpawn: Vec2 | null = null;
  const sentrySpawns: Vec2[] = [];

  for (let r = 0; r < lines.length; r++) {
    const rowStr = lines[r]!;
    if (rowStr.length !== cols) {
      throw new Error(`ステージ ${r} 行目の列数が不正: ${rowStr.length} (期待値 ${cols})`);
    }
    const line: string[] = [];
    for (let c = 0; c < rowStr.length; c++) {
      let ch = rowStr[c]!;
      const cx = c * tile + tile / 2; // タイル中心座標
      const cy = r * tile + tile / 2;
      if (ch === "P") {
        playerSpawn = { x: cx, y: cy };
        ch = ".";
      } else if (ch === "A") {
        sentrySpawns.push({ x: cx, y: cy });
        ch = ".";
      }
      line.push(ch);
    }
    grid.push(line);
  }
  if (!playerSpawn) throw new Error("ステージに P（プレイヤー初期位置）がありません");
  return { grid, cols, rows, tile, playerSpawn, sentrySpawns };
}

/** タイル参照（範囲外は壁扱い） */
export function tileAt(stage: ParsedStage, col: number, row: number): string {
  if (col < 0 || col >= stage.cols || row < 0 || row >= stage.rows) return "#";
  return stage.grid[row]![col]!;
}

/** 戦車にとって通行不可のタイルか（恒久壁・破壊可能壁・穴。GDD §5.5） */
export function solidForTank(ch: string): boolean {
  return ch === "#" || ch === "X" || ch === "H";
}

/** 弾を止めるタイルか（恒久壁＝反射・破壊可能壁＝消滅。穴 H は弾が上を通過） */
export function stopsBullet(ch: string): boolean {
  return ch === "#" || ch === "X";
}

/** 弾が反射するタイルか（恒久壁のみ。X は反射せず消滅：GDD §5） */
export function reflectsBullet(ch: string): boolean {
  return ch === "#";
}
