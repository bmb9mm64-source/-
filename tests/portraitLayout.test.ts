/**
 * 縦持ちレイアウトの寸法計算（GDD §3.6・§14 の E2）のテスト。
 *
 * この計算が狂うと「画面に黒い余白が残る」か「盤面が画面からはみ出す」のどちらかになる。
 * 守りたいのは次の3点：
 *   ① 帯を足した canvas の縦横比が画面の縦横比と一致する（＝余白が出ない）
 *   ② 帯は上下限で挟まれる（極端な画面でも破綻しない）
 *   ③ 盤面そのものの大きさは変わらない（帯は「余白の置き換え」であって盤面を削らない）
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { portraitBandHeight } from "../src/core/portraitLayout";

const BOARD_W = BALANCE.TILE * BALANCE.COLS; // 800
const BOARD_H = BALANCE.TILE * BALANCE.ROWS; // 544
const MIN = BALANCE.TOUCH.PORTRAIT_BAND_MIN;
const MAX = BALANCE.TOUCH.PORTRAIT_BAND_MAX;

/** 実機でよくある縦持ちの画面サイズ（CSS px） */
const PHONES: [string, number, number][] = [
  ["iPhone 14 相当 390×844", 390, 844],
  ["小さめ 360×640", 360, 640],
  ["iPad 相当 820×1180", 820, 1180],
];

function band(w: number, h: number): number {
  return portraitBandHeight(BOARD_W, BOARD_H, w, h, MIN, MAX);
}

describe("縦持ちの操作帯の高さ", () => {
  it.each(PHONES)("%s：canvas の縦横比が画面と一致する（余白が出ない）", (_name, w, h) => {
    const viewH = BOARD_H + band(w, h);
    expect(BOARD_W / viewH).toBeCloseTo(w / h, 6);
  });

  it.each(PHONES)("%s：盤面は画面の幅いっぱいに出る（表示倍率は幅で決まる）", (_name, w, h) => {
    const viewH = BOARD_H + band(w, h);
    const scale = Math.min(w / BOARD_W, h / viewH); // FIT の倍率
    expect(scale).toBeCloseTo(w / BOARD_W, 6);
  });

  it("極端に縦長でも上限で止まる", () => {
    expect(band(300, 3000)).toBe(MAX);
  });

  it("ほぼ正方形の画面でも下限を割らない（親指の可動域を確保する）", () => {
    expect(band(800, 600)).toBe(MIN);
  });

  it("横持ち相当（横長）でも下限を返す＝負の帯にはならない", () => {
    expect(band(844, 390)).toBe(MIN);
    expect(band(844, 390)).toBeGreaterThan(0);
  });

  it("画面サイズが取れないときも下限を返す（0除算にしない）", () => {
    expect(band(0, 0)).toBe(MIN);
    expect(band(390, 0)).toBe(MIN);
  });

  it("帯を足しても盤面の大きさは変わらない（帯は余白の置き換え）", () => {
    // 帯なしのときの表示倍率と、帯ありのときの表示倍率を比べる
    const [w, h] = [390, 844];
    const noBand = Math.min(w / BOARD_W, h / BOARD_H);
    const viewH = BOARD_H + band(w, h);
    const withBand = Math.min(w / BOARD_W, h / viewH);
    expect(withBand).toBeCloseTo(noBand, 6); // 縦持ちでは倍率は幅で決まるので変わらない
  });
});
