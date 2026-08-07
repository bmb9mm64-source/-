/**
 * ステージパーサのテスト — サイズ検証・外周壁・P/A 配置の抽出。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { parseStage, solidForTank, stopsBullet, tileAt } from "../src/core/stage";
import { STAGE_TEST } from "../src/stages/testStage";

describe("ステージパーサ", () => {
  const stage = parseStage(STAGE_TEST);

  it("正規サイズ（25×17）を受理し grid を構築する", () => {
    expect(stage.cols).toBe(BALANCE.COLS);
    expect(stage.rows).toBe(BALANCE.ROWS);
    expect(stage.grid).toHaveLength(BALANCE.ROWS);
    expect(stage.grid[0]).toHaveLength(BALANCE.COLS);
  });

  it("外周は全て恒久壁 # である", () => {
    for (let c = 0; c < stage.cols; c++) {
      expect(tileAt(stage, c, 0)).toBe("#");
      expect(tileAt(stage, c, stage.rows - 1)).toBe("#");
    }
    for (let r = 0; r < stage.rows; r++) {
      expect(tileAt(stage, 0, r)).toBe("#");
      expect(tileAt(stage, stage.cols - 1, r)).toBe("#");
    }
  });

  it("P（プレイヤー初期位置）をタイル中心座標として抽出し床に置換する", () => {
    // P はタイル (3,13) → 中心 (3×32+16, 13×32+16) = (112, 432)
    expect(stage.playerSpawn).toEqual({ x: 112, y: 432 });
    expect(tileAt(stage, 3, 13)).toBe(".");
  });

  it("A（セントリー）を全て抽出し床に置換する", () => {
    // A はタイル (7,3) と (20,3) → 中心 (240,112)・(656,112)
    expect(stage.sentrySpawns).toEqual([
      { x: 240, y: 112 },
      { x: 656, y: 112 },
    ]);
    expect(tileAt(stage, 7, 3)).toBe(".");
    expect(tileAt(stage, 20, 3)).toBe(".");
  });

  it("B（ローバー）を全て抽出し床に置換する", () => {
    const s = parseStage(
      ["#####", "#P.B#", "#B..#", "#####"],
      { cols: 5, rows: 4 },
    );
    // B はタイル (3,1) と (1,2) → 中心 (112,48)・(48,80)
    expect(s.roverSpawns).toEqual([
      { x: 112, y: 48 },
      { x: 48, y: 80 },
    ]);
    expect(tileAt(s, 3, 1)).toBe(".");
    expect(tileAt(s, 1, 2)).toBe(".");
  });

  it("B が無いステージでは roverSpawns は空配列になる", () => {
    expect(stage.roverSpawns).toEqual([]);
  });

  it("C（スナイパー）・D（マインレイヤー）を全て抽出し床に置換する（GDD §7 v0.6）", () => {
    const s = parseStage(
      ["#####", "#P.C#", "#D.C#", "#.D.#", "#####"],
      { cols: 5, rows: 5 },
    );
    // C はタイル (3,1)・(3,2) → 中心 (112,48)・(112,80)
    expect(s.sniperSpawns).toEqual([
      { x: 112, y: 48 },
      { x: 112, y: 80 },
    ]);
    // D はタイル (1,2)・(2,3) → 中心 (48,80)・(80,112)
    expect(s.minelayerSpawns).toEqual([
      { x: 48, y: 80 },
      { x: 80, y: 112 },
    ]);
    expect(tileAt(s, 3, 1)).toBe(".");
    expect(tileAt(s, 3, 2)).toBe(".");
    expect(tileAt(s, 1, 2)).toBe(".");
    expect(tileAt(s, 2, 3)).toBe(".");
  });

  it("C/D が無いステージでは sniperSpawns / minelayerSpawns は空配列になる", () => {
    expect(stage.sniperSpawns).toEqual([]);
    expect(stage.minelayerSpawns).toEqual([]);
  });

  it("行数・列数が不正なら例外を投げる", () => {
    expect(() => parseStage(["###", "#P#", "###"])).toThrow(/行数が不正/);
    const bad = [...STAGE_TEST];
    bad[5] = "#..."; // 列数不足
    expect(() => parseStage(bad)).toThrow(/列数が不正/);
  });

  it("P が無いステージは例外を投げる", () => {
    expect(() =>
      parseStage(["####", "#..#", "####"], { cols: 4, rows: 3 }),
    ).toThrow(/P（プレイヤー初期位置）/);
  });

  it("範囲外のタイル参照は壁扱いになる", () => {
    expect(tileAt(stage, -1, 0)).toBe("#");
    expect(tileAt(stage, stage.cols, 0)).toBe("#");
  });

  it("タイル属性：戦車は #・X・H に進入不可、弾は # と X で止まり H は通過", () => {
    expect(solidForTank("#")).toBe(true);
    expect(solidForTank("X")).toBe(true);
    expect(solidForTank("H")).toBe(true);
    expect(solidForTank(".")).toBe(false);
    expect(stopsBullet("#")).toBe(true);
    expect(stopsBullet("X")).toBe(true);
    expect(stopsBullet("H")).toBe(false);
    expect(stopsBullet(".")).toBe(false);
  });
});
