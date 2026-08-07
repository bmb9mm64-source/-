/**
 * ステージエディタのデータ層（GDD §12.7）のテスト。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import {
  EDITOR_MAX_ENEMIES,
  EditorSlots,
  editorSlotKey,
  emptyGrid,
  exportStage,
  gridToLines,
  importStage,
  setTile,
  validateStage,
} from "../src/core/editor";
import { memoryStore } from "../src/core/records";

describe("エディタ：グリッド編集", () => {
  it("空グリッドは内側が床・外周が # である", () => {
    const g = emptyGrid();
    expect(g).toHaveLength(BALANCE.ROWS);
    expect(g[0]!.every((ch) => ch === "#")).toBe(true);
    expect(g[BALANCE.ROWS - 1]!.every((ch) => ch === "#")).toBe(true);
    expect(g[5]![0]).toBe("#");
    expect(g[5]![BALANCE.COLS - 1]).toBe("#");
    expect(g[5]![5]).toBe(".");
  });

  it("外周と範囲外への設置は拒否される", () => {
    const g = emptyGrid();
    expect(setTile(g, 0, 5, ".")).toBe(false); // 左端
    expect(setTile(g, 5, 0, ".")).toBe(false); // 上端
    expect(setTile(g, -1, 5, "#")).toBe(false);
    expect(setTile(g, 5, BALANCE.ROWS, "#")).toBe(false);
    expect(g[0]![5]).toBe("#"); // 変化していない
  });

  it("P は常に1つ（新しく置くと既存の P は床に戻る）", () => {
    const g = emptyGrid();
    expect(setTile(g, 3, 3, "P")).toBe(true);
    expect(setTile(g, 10, 8, "P")).toBe(true);
    expect(g[3]![3]).toBe(".");
    expect(g[8]![10]).toBe("P");
  });

  it("敵は合計12体まで（上限で設置拒否・既存敵の置き換えは可）", () => {
    const g = emptyGrid();
    for (let i = 0; i < EDITOR_MAX_ENEMIES; i++) {
      expect(setTile(g, 1 + i, 1 + Math.floor(i / 8), i % 2 === 0 ? "A" : "B")).toBe(true);
    }
    expect(setTile(g, 20, 10, "C")).toBe(false); // 13体目は拒否
    expect(setTile(g, 1, 1, "D")).toBe(true); // 既存の敵タイルの置き換えは可
    expect(g[1]![1]).toBe("D");
  });

  it("敵E/F を設置でき、合計12体の上限カウントに含まれる（GDD §7 v0.9・§12.7）", () => {
    const g = emptyGrid();
    expect(setTile(g, 3, 3, "E")).toBe(true);
    expect(setTile(g, 5, 3, "F")).toBe(true);
    expect(g[3]![3]).toBe("E");
    expect(g[3]![5]).toBe("F");
    // E/F 込みで12体まで埋める → 13体目（種別を問わず）は拒否
    for (let i = 0; i < EDITOR_MAX_ENEMIES - 2; i++) {
      expect(setTile(g, 1 + i, 5, i % 2 === 0 ? "E" : "F")).toBe(true);
    }
    expect(setTile(g, 20, 10, "A")).toBe(false); // E/F も上限カウントに含まれている
    expect(setTile(g, 3, 3, "F")).toBe(true); // 既存の敵タイルの置き換えは可
  });
});

describe("エディタ：検証", () => {
  it("P なし・敵なしはエラー", () => {
    const g = emptyGrid();
    let v = validateStage(g);
    expect(v.errors.some((e) => e.includes("P"))).toBe(true);
    expect(v.errors.some((e) => e.includes("敵"))).toBe(true);
    setTile(g, 3, 3, "P");
    v = validateStage(g);
    expect(v.errors.some((e) => e.includes("敵"))).toBe(true);
  });

  it("P の周囲に床がないとエラー", () => {
    const g = emptyGrid();
    setTile(g, 3, 3, "P");
    setTile(g, 20, 8, "A");
    // P の距離2までの近傍（2P出現候補）を全て壁で塞ぐ
    for (let r = 1; r <= 5; r++) {
      for (let c = 1; c <= 5; c++) {
        if (r === 3 && c === 3) continue;
        setTile(g, c, r, "#");
      }
    }
    const v = validateStage(g);
    expect(v.errors.some((e) => e.includes("床"))).toBe(true);
  });

  it("開幕射線が通ると警告（エラーではない）・遮蔽されていれば正常", () => {
    const g = emptyGrid();
    setTile(g, 3, 8, "P");
    setTile(g, 20, 8, "A"); // 同じ行＝射線が通る
    let v = validateStage(g);
    expect(v.errors).toHaveLength(0);
    expect(v.warnings.some((w) => w.includes("射線"))).toBe(true);
    for (let r = 1; r < BALANCE.ROWS - 1; r++) setTile(g, 12, r, "#"); // 縦壁で遮蔽
    v = validateStage(g);
    expect(v.errors).toHaveLength(0);
    expect(v.warnings).toHaveLength(0);
  });
});

describe("エディタ：エクスポート／インポート", () => {
  it("往復で内容が保たれる（名前付き。E/F 込み）", () => {
    const g = emptyGrid();
    setTile(g, 3, 3, "P");
    setTile(g, 20, 8, "A");
    setTile(g, 18, 4, "E");
    setTile(g, 6, 10, "F");
    setTile(g, 10, 5, "X");
    const json = exportStage(g, "テスト面");
    const back = importStage(json);
    expect(back.name).toBe("テスト面");
    expect(gridToLines(back.grid)).toEqual(gridToLines(g));
  });

  it.each([
    ["JSONでない", "これはJSONではない"],
    ["バージョン違い", JSON.stringify({ v: 2, grid: [] })],
    ["gridが配列でない", JSON.stringify({ v: 1, grid: "x" })],
    ["行数不足", JSON.stringify({ v: 1, grid: ["#########################"] })],
    [
      "不明な記号",
      JSON.stringify({ v: 1, grid: gridToLines(emptyGrid()).map((r, i) => (i === 5 ? `${r.slice(0, 5)}Z${r.slice(6)}` : r)) }),
    ],
    [
      "外周破れ",
      JSON.stringify({ v: 1, grid: gridToLines(emptyGrid()).map((r, i) => (i === 0 ? `.${r.slice(1)}` : r)) }),
    ],
  ])("不正データを拒否する：%s", (_label, json) => {
    expect(() => importStage(json)).toThrow();
  });

  it("P が複数ある JSON を拒否する", () => {
    const g = emptyGrid();
    g[3]![3] = "P";
    g[5]![5] = "P"; // setTile を通さず不正データを直接作る
    expect(() => importStage(exportStage(g))).toThrow(/P/);
  });
});

describe("エディタ：スロット保存", () => {
  it("保存→読込の往復と、壊れた保存値の空き扱い", () => {
    const store = memoryStore();
    const slots = new EditorSlots(store);
    const g = emptyGrid();
    setTile(g, 3, 3, "P");
    setTile(g, 20, 8, "B");
    slots.save(2, g, "スロット2");
    const back = slots.load(2);
    expect(back).not.toBeNull();
    expect(back!.name).toBe("スロット2");
    expect(gridToLines(back!.grid)).toEqual(gridToLines(g));
    expect(slots.load(1)).toBeNull(); // 未保存
    store.set(editorSlotKey(3), "{壊れたデータ");
    expect(slots.load(3)).toBeNull(); // 壊れた保存値は空き扱い
  });
});
