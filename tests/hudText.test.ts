/**
 * 画面表示の組み立て（GDD §14 の E7）のテスト。
 *
 * これまでシーン層に直接書かれていて**テストが書けなかった**計算を core へ押し出し、
 * ここで機械検証する。対象は「実際に不具合が出た種類」に絞ってある：
 *   ・残量ピップ（GDD §8 v0.17。同時5発・地雷2個の駆け引きを可視化する要）
 *   ・全クリア一覧の桁そろえ（等幅で並べるので1文字ずれると全体が崩れる）
 *   ・オーバーレイの版組選択（ポーズの操作一覧が見出しに食い込む不具合があった）
 *   ・エディタ下バーの並べ方（等分割にしてボタンが画面外へ切れる不具合があった）
 */
import { describe, expect, it } from "vitest";
import {
  ammoPips,
  chooseOverlayLayout,
  type ClearRow,
  formatClearRows,
  formatTotalRow,
  packRowByWidth,
} from "../src/core/hudText";
import { formatTime } from "../src/core/records";

describe("残量ピップ（●＝使える／○＝場に出ている）", () => {
  it("未使用は全て ●、使い切ると全て ○", () => {
    expect(ammoPips(0, 5)).toBe("●●●●●");
    expect(ammoPips(5, 5)).toBe("○○○○○");
  });

  it("使った数だけ ○ に変わり、総数は常に max のまま", () => {
    expect(ammoPips(2, 5)).toBe("●●●○○");
    for (let used = 0; used <= 5; used++) expect([...ammoPips(used, 5)]).toHaveLength(5);
  });

  it("範囲外の値でも壊れない（総数は max のまま）", () => {
    expect(ammoPips(-3, 2)).toBe("●●");
    expect(ammoPips(99, 2)).toBe("○○");
    expect(ammoPips(1, 0)).toBe("");
  });
});

describe("全クリア一覧の整形", () => {
  const rows: ClearRow[] = [
    { missionNumber: 1, time: 8.42, best: 7.1, isNewRecord: false },
    { missionNumber: 10, time: 123.456, best: null, isNewRecord: true },
  ];

  it("等幅で桁がそろう（全行が同じ長さの枠に収まる）", () => {
    const lines = formatClearRows(rows, formatTime);
    // 「Mnn」「タイム」「ベスト」の位置が行によってずれない
    const posOfSlash = lines.map((l) => l.indexOf("/"));
    expect(new Set(posOfSlash).size, "スラッシュの位置は全行そろう").toBe(1);
  });

  it("ベスト記録が無い行は --.- を出す（空欄にしない）", () => {
    expect(formatClearRows(rows, formatTime)[1]).toContain("--.-");
  });

  it("ベスト更新した行にだけ ★NEW! が付く", () => {
    const lines = formatClearRows(rows, formatTime);
    expect(lines[0]).not.toContain("★NEW!");
    expect(lines[1]).toContain("★NEW!");
  });

  it("合計行も同じ書式で、更新時だけ ★NEW! が付く", () => {
    expect(formatTotalRow(100, 90, false, formatTime)).toContain("/ ベスト");
    expect(formatTotalRow(100, 90, false, formatTime)).not.toContain("★NEW!");
    expect(formatTotalRow(100, null, true, formatTime)).toContain("★NEW!");
    expect(formatTotalRow(100, null, true, formatTime)).toContain("--.-");
  });

  it("行が無ければ空の配列（全クリア以外で呼んでも壊れない）", () => {
    expect(formatClearRows([], formatTime)).toEqual([]);
  });
});

describe("オーバーレイの版組選択", () => {
  it("ポーズ中は paused（他の状態より優先する）", () => {
    expect(chooseOverlayLayout(true, "playing")).toBe("paused");
    expect(chooseOverlayLayout(true, "allclear"), "全クリア中でもポーズが優先").toBe("paused");
  });

  it("全クリアは allclear、それ以外は normal", () => {
    expect(chooseOverlayLayout(false, "allclear")).toBe("allclear");
    expect(chooseOverlayLayout(false, "gameover")).toBe("normal");
    expect(chooseOverlayLayout(false, "banner")).toBe("normal");
  });
});

describe("横一列のボタン配置（実際の文字幅で詰める）", () => {
  it("全体が収まるときは中央に寄る", () => {
    const xs = packRowByWidth([100, 100], 400, 20);
    // 合計 220 → 左端は (400-220)/2 = 90
    expect(xs).toEqual([90, 210]);
  });

  it("ボタン同士は必ず gap ぶん離れる（重ならない）", () => {
    const widths = [40, 90, 30, 120];
    const xs = packRowByWidth(widths, 500, 8);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - (xs[i - 1]! + widths[i - 1]!)).toBe(8);
    }
  });

  it("収まりきらなくても左端から詰める＝どのボタンも消えない", () => {
    const widths = [200, 200, 200];
    const xs = packRowByWidth(widths, 300, 10);
    expect(xs[0]).toBe(10); // 左へはみ出さない（gap ぶんの余白は残す）
    expect(xs).toHaveLength(3); // 3つとも位置を持つ
  });

  it("幅の違うボタンでも1つ前の右端から始まる（等分割にしない）", () => {
    const widths = [30, 300];
    const xs = packRowByWidth(widths, 1000, 4);
    expect(xs[1]! - xs[0]!).toBe(34); // 等分割なら 500 になってしまう
  });

  it("ボタンが無ければ空（呼び出し側で分岐しなくてよい）", () => {
    expect(packRowByWidth([], 500, 4)).toEqual([]);
  });
});
