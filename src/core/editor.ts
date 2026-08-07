/**
 * ステージエディタのデータ層（GDD §12.7。Phaser 非依存の純粋 TS）。
 * - グリッド編集（外周は常に `#` 固定・P は常に1つ・敵は合計12体まで）
 * - 検証（エラー＝プレイ開始を止める／警告＝表示のみ）
 * - JSON エクスポート／インポート（コピペ共有。不正データは日本語の理由付きで拒否）
 * - スロット保存（RecordStore 抽象を再利用した注入式。キー `hanedan.editor.slot.<n>`）
 */
import { BALANCE } from "../config/balance";
import { hasLineOfSight } from "./los";
import type { RecordStore } from "./records";
import { findNearbyFloor, parseStage } from "./stage";

/** エディタで扱えるタイル記号（パレットの並び順） */
export const EDITOR_TILES = [".", "#", "X", "H", "P", "A", "B", "C", "D"] as const;
export type EditorTile = (typeof EDITOR_TILES)[number];

/** 敵記号 */
const ENEMY_CHARS = new Set(["A", "B", "C", "D"]);

/** 敵の合計配置上限（GDD §12.7：性能と難易度の上限） */
export const EDITOR_MAX_ENEMIES = 12;

/** スロット数（GDD §12.7） */
export const EDITOR_SLOT_COUNT = 3;

/** スロット保存キー */
export function editorSlotKey(n: number): string {
  return `hanedan.editor.slot.${n}`;
}

/** 空のステージ（内側は全て床・外周は恒久壁）を作る */
export function emptyGrid(cols = BALANCE.COLS, rows = BALANCE.ROWS): string[][] {
  const grid: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(r === 0 || r === rows - 1 || c === 0 || c === cols - 1 ? "#" : ".");
    }
    grid.push(row);
  }
  return grid;
}

/** グリッド（2次元配列）→ ステージ文字列配列 */
export function gridToLines(grid: readonly string[][]): string[] {
  return grid.map((row) => row.join(""));
}

/** ステージ文字列配列 → グリッド（2次元配列） */
export function linesToGrid(lines: readonly string[]): string[][] {
  return lines.map((row) => row.split(""));
}

/** グリッド中の敵の合計数 */
export function countEnemies(grid: readonly string[][]): number {
  let n = 0;
  for (const row of grid) for (const ch of row) if (ENEMY_CHARS.has(ch)) n++;
  return n;
}

/**
 * タイルを設置する。適用したら true、拒否したら false。
 * 拒否条件：範囲外／外周（常に `#` 固定）／不明な記号／敵の合計12体超過。
 * `P` は常に1つ：新しく置くと既存の P は床に戻る。
 */
export function setTile(grid: string[][], col: number, row: number, ch: EditorTile): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
  if (row === 0 || row === rows - 1 || col === 0 || col === cols - 1) return false; // 外周は編集不可
  if (!(EDITOR_TILES as readonly string[]).includes(ch)) return false;
  const current = grid[row]![col]!;
  if (current === ch) return true; // 既に同じ（適用扱い）
  if (ENEMY_CHARS.has(ch) && !ENEMY_CHARS.has(current) && countEnemies(grid) >= EDITOR_MAX_ENEMIES) {
    return false; // 敵の上限（既存の敵の置き換えは可）
  }
  if (ch === "P") {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r]![c] === "P") grid[r]![c] = "."; // 既存の P を床へ（P の一意性）
      }
    }
  }
  grid[row]![col] = ch;
  return true;
}

/** 検証結果（GDD §12.7：エラーは開始を止める／警告は表示のみ） */
export interface StageValidation {
  errors: string[];
  warnings: string[];
}

/** プレイ開始前の検証 */
export function validateStage(grid: readonly string[][]): StageValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = gridToLines(grid);

  const pCount = lines.join("").split("P").length - 1;
  if (pCount !== 1) {
    errors.push("自機 P を1つ配置してください");
  }
  if (countEnemies(grid) === 0) {
    errors.push("敵（A〜D）を1体以上配置してください");
  }
  if (errors.length > 0) return { errors, warnings };

  const stage = parseStage(lines);
  const near = findNearbyFloor(stage, stage.playerSpawn);
  if (near.x === stage.playerSpawn.x && near.y === stage.playerSpawn.y) {
    errors.push("P の周囲に床がありません（2人プレイの2P出現位置が必要です）");
  }
  const enemies = [
    ...stage.sentrySpawns,
    ...stage.roverSpawns,
    ...stage.sniperSpawns,
    ...stage.minelayerSpawns,
  ];
  for (const e of enemies) {
    if (hasLineOfSight(stage, stage.playerSpawn.x, stage.playerSpawn.y, e.x, e.y)) {
      warnings.push("開幕時に P から敵への射線が通っています（開幕即撃たれる可能性）");
      break;
    }
  }
  return { errors, warnings };
}

/** 保存・共有用のファイル形式 */
export interface EditorStageFile {
  v: 1;
  name?: string;
  grid: string[];
}

/** グリッドを JSON テキストに書き出す（コピペ共有用） */
export function exportStage(grid: readonly string[][], name?: string): string {
  const file: EditorStageFile = { v: 1, grid: gridToLines(grid) };
  if (name) file.name = name;
  return JSON.stringify(file);
}

/**
 * JSON テキストを読み込んでグリッドを返す。不正なデータは日本語の理由付きで例外を投げる。
 * 検証：形式・バージョン・サイズ（25×17）・使用記号・外周が全て `#`・P は最大1つ・敵は12体以下。
 */
export function importStage(json: string): { grid: string[][]; name?: string } {
  let file: unknown;
  try {
    file = JSON.parse(json);
  } catch {
    throw new Error("JSON として読み取れません");
  }
  if (typeof file !== "object" || file === null) throw new Error("形式が不正です");
  const f = file as { v?: unknown; grid?: unknown; name?: unknown };
  if (f.v !== 1) throw new Error("対応していないバージョンです（v:1 のみ）");
  if (!Array.isArray(f.grid) || !f.grid.every((row) => typeof row === "string")) {
    throw new Error("grid が文字列の配列ではありません");
  }
  const lines = f.grid as string[];
  if (lines.length !== BALANCE.ROWS) {
    throw new Error(`行数が不正です（${lines.length} 行。期待値 ${BALANCE.ROWS}）`);
  }
  let pCount = 0;
  for (let r = 0; r < lines.length; r++) {
    const row = lines[r]!;
    if (row.length !== BALANCE.COLS) {
      throw new Error(`${r + 1} 行目の列数が不正です（${row.length} 文字。期待値 ${BALANCE.COLS}）`);
    }
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]!;
      if (!(EDITOR_TILES as readonly string[]).includes(ch)) {
        throw new Error(`使用できない記号があります: 「${ch}」`);
      }
      const outer = r === 0 || r === lines.length - 1 || c === 0 || c === row.length - 1;
      if (outer && ch !== "#") throw new Error("外周は全て # である必要があります");
      if (ch === "P") pCount++;
    }
  }
  if (pCount > 1) throw new Error("自機 P が複数あります");
  const grid = linesToGrid(lines);
  if (countEnemies(grid) > EDITOR_MAX_ENEMIES) {
    throw new Error(`敵が多すぎます（上限 ${EDITOR_MAX_ENEMIES} 体）`);
  }
  return typeof f.name === "string" ? { grid, name: f.name } : { grid };
}

/** スロット保存（注入式ストレージ。壊れた保存値は null＝空きスロット扱い） */
export class EditorSlots {
  constructor(private store: RecordStore) {}

  save(n: number, grid: readonly string[][], name?: string): void {
    this.store.set(editorSlotKey(n), exportStage(grid, name));
  }

  load(n: number): { grid: string[][]; name?: string } | null {
    const raw = this.store.get(editorSlotKey(n));
    if (raw === null) return null;
    try {
      return importStage(raw);
    } catch {
      return null; // 壊れた保存値は空き扱い（上書き可能）
    }
  }
}

/**
 * 編集中グリッドのセッション保持（シーン間の受け渡し用）。
 * テストプレイから EditorScene へ戻ったときに編集内容を復元する。
 */
export const editorSession: { grid: string[][] | null } = { grid: null };
