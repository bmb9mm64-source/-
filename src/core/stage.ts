/**
 * ステージ文字列グリッドのパーサとタイル参照（Phaser 非依存の純粋 TS）。
 * タイル種別（GDD §7）：
 *   . 床（通行可・弾通過）   # 恒久壁（通行不可・弾反射）
 *   X 破壊可能壁（通行不可・弾は消滅＝反射しない）
 *   H 穴（戦車不可・弾は上を通過）
 *   P プレイヤー初期位置（床扱い）   A 敵A「セントリー」（床扱い）
 *   B 敵B「ローバー」（床扱い）      C 敵C「スナイパー」（床扱い）
 *   D 敵D「マインレイヤー」（床扱い）
 *   E 敵E「リフレクター」（床扱い）  F 敵F「チェイサー」（床扱い）（GDD §7 v0.9）
 */
import { BALANCE } from "../config/balance";
import type { Vec2 } from "./types";

/** 解析済みステージ */
export interface ParsedStage {
  grid: string[][]; // grid[row][col] のタイル文字（P/A/B/C/D/E/F は '.' に置換済み）
  cols: number;
  rows: number;
  tile: number; // 1タイルの辺長 [px]
  playerSpawn: Vec2; // プレイヤー初期位置（タイル中心の px 座標）
  sentrySpawns: Vec2[]; // 敵A「セントリー」の初期位置
  roverSpawns: Vec2[]; // 敵B「ローバー」の初期位置
  sniperSpawns: Vec2[]; // 敵C「スナイパー」の初期位置（GDD §7 v0.6）
  minelayerSpawns: Vec2[]; // 敵D「マインレイヤー」の初期位置（GDD §7 v0.6）
  reflectorSpawns: Vec2[]; // 敵E「リフレクター」の初期位置（GDD §7 v0.9）
  chaserSpawns: Vec2[]; // 敵F「チェイサー」の初期位置（GDD §7 v0.9）
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
  const roverSpawns: Vec2[] = [];
  const sniperSpawns: Vec2[] = [];
  const minelayerSpawns: Vec2[] = [];
  const reflectorSpawns: Vec2[] = [];
  const chaserSpawns: Vec2[] = [];

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
      } else if (ch === "B") {
        roverSpawns.push({ x: cx, y: cy });
        ch = ".";
      } else if (ch === "C") {
        sniperSpawns.push({ x: cx, y: cy });
        ch = ".";
      } else if (ch === "D") {
        minelayerSpawns.push({ x: cx, y: cy });
        ch = ".";
      } else if (ch === "E") {
        reflectorSpawns.push({ x: cx, y: cy });
        ch = ".";
      } else if (ch === "F") {
        chaserSpawns.push({ x: cx, y: cy });
        ch = ".";
      }
      line.push(ch);
    }
    grid.push(line);
  }
  if (!playerSpawn) throw new Error("ステージに P（プレイヤー初期位置）がありません");
  return {
    grid,
    cols,
    rows,
    tile,
    playerSpawn,
    sentrySpawns,
    roverSpawns,
    sniperSpawns,
    minelayerSpawns,
    reflectorSpawns,
    chaserSpawns,
  };
}

/**
 * 2P の初期位置探索で調べる近傍タイルの順序（右・左・下・上→斜め→距離2の直交）。
 * GDD §12.5 に 2P の湧き位置の明記がないための暫定解釈：
 * ステージデータ（P は1つ）を変更せず、P1 の隣の床タイルに 2P を湧かせる。
 */
const COOP_SPAWN_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
];

/**
 * origin（px 座標）のタイルの近傍から床 '.' タイルの中心を探す（2P 初期位置用）。
 * 全ミッションで P の隣に床があることは missions のテストで担保する。
 * 万一見つからなければ origin をそのまま返す（保険）。
 */
export function findNearbyFloor(stage: ParsedStage, origin: Vec2): Vec2 {
  const t = stage.tile;
  const c0 = Math.floor(origin.x / t);
  const r0 = Math.floor(origin.y / t);
  for (const [dc, dr] of COOP_SPAWN_OFFSETS) {
    if (tileAt(stage, c0 + dc, r0 + dr) === ".") {
      return { x: (c0 + dc) * t + t / 2, y: (r0 + dr) * t + t / 2 };
    }
  }
  return { x: origin.x, y: origin.y };
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
