/**
 * タッチ操作の入力モデル（GDD §3.5 v0.11）のテスト。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { mineButtonRect, pauseButtonRect, TouchController, type TouchPointInput } from "../src/core/touch";

const W = BALANCE.TILE * BALANCE.COLS; // 800
const H = BALANCE.TILE * BALANCE.ROWS; // 544

/** 触れ始めた位置＝現在位置の指 */
function tap(id: number, x: number, y: number): TouchPointInput {
  return { id, x, y, startX: x, startY: y };
}

/** 基点から (dx,dy) だけずらした指 */
function drag(id: number, x: number, y: number, dx: number, dy: number): TouchPointInput {
  return { id, x: x + dx, y: y + dy, startX: x, startY: y };
}

describe("タッチ：仮想スティック（左半分）", () => {
  let tc: TouchController;
  beforeEach(() => {
    tc = new TouchController();
  });

  it("不感帯の内側では移動しない", () => {
    const r = tc.resolve([drag(1, 150, 300, BALANCE.TOUCH.STICK_DEADZONE - 1, 0)], W, H);
    expect(r.moveX).toBe(0);
    expect(r.moveY).toBe(0);
    expect(r.stick).not.toBeNull(); // スティック自体は表示される
  });

  it("最大半径で頭打ちになり、方向が入力になる", () => {
    const far = BALANCE.TOUCH.STICK_MAX_RADIUS * 3;
    const r = tc.resolve([drag(1, 150, 300, far, 0)], W, H);
    expect(r.moveX).toBeCloseTo(1, 6); // 右いっぱい
    expect(r.moveY).toBeCloseTo(0, 6);
    // つまみは最大半径の位置に留まる（描画用）
    expect(r.stick!.tipX - r.stick!.baseX).toBeCloseTo(BALANCE.TOUCH.STICK_MAX_RADIUS, 6);
  });

  it("斜め入力は正規化された比率になる", () => {
    const d = BALANCE.TOUCH.STICK_MAX_RADIUS;
    const r = tc.resolve([drag(1, 150, 300, d, d)], W, H);
    expect(Math.hypot(r.moveX, r.moveY)).toBeCloseTo(1, 6);
    expect(r.moveX).toBeCloseTo(r.moveY, 6);
  });
});

describe("タッチ：照準・射撃（右半分）", () => {
  it("右側に触れている間は照準が定まり連射する", () => {
    const tc = new TouchController();
    const r = tc.resolve([tap(1, 600, 200)], W, H);
    expect(r.aim).toEqual({ x: 600, y: 200 });
    expect(r.fire).toBe(true);
  });

  it("指を離すと射撃が止まる", () => {
    const tc = new TouchController();
    tc.resolve([tap(1, 600, 200)], W, H);
    const r = tc.resolve([], W, H);
    expect(r.fire).toBe(false);
    expect(r.aim).toBeNull();
  });

  it("移動と照準を同時に扱える（マルチタッチ）", () => {
    const tc = new TouchController();
    const r = tc.resolve(
      [drag(1, 150, 300, BALANCE.TOUCH.STICK_MAX_RADIUS, 0), tap(2, 640, 180)],
      W,
      H,
    );
    expect(r.moveX).toBeCloseTo(1, 6);
    expect(r.aim).toEqual({ x: 640, y: 180 });
    expect(r.fire).toBe(true);
  });
});

describe("タッチ：ボタン", () => {
  it("地雷ボタンは押下の立ち上がりで1回だけ発火する", () => {
    const tc = new TouchController();
    const rect = mineButtonRect(W, H);
    const p = tap(1, rect.x + rect.w / 2, rect.y + rect.h / 2);
    expect(tc.resolve([p], W, H).minePressed).toBe(true);
    expect(tc.resolve([p], W, H).minePressed).toBe(false); // 押しっぱなしでは連続設置しない
    tc.resolve([], W, H); // 離す
    expect(tc.resolve([p], W, H).minePressed).toBe(true); // 押し直せば発火
  });

  it("ポーズボタンも押下の立ち上がりで発火する", () => {
    const tc = new TouchController();
    const rect = pauseButtonRect(W, H);
    const p = tap(1, rect.x + rect.w / 2, rect.y + rect.h / 2);
    expect(tc.resolve([p], W, H).pausePressed).toBe(true);
    expect(tc.resolve([p], W, H).pausePressed).toBe(false);
  });

  it("ボタンは右半分にあるが、照準として扱われない（役割は触れ始めた位置で決まる）", () => {
    const tc = new TouchController();
    const rect = mineButtonRect(W, H);
    const r = tc.resolve([tap(1, rect.x + 5, rect.y + 5)], W, H);
    expect(r.aim).toBeNull();
    expect(r.fire).toBe(false);
  });

  it("指が画面中央をまたいでも役割は変わらない", () => {
    const tc = new TouchController();
    // 左半分で触れ始め、右半分まで大きくドラッグ → 依然としてスティック（照準にならない）
    const r = tc.resolve([drag(1, 100, 300, 500, 0)], W, H);
    expect(r.aim).toBeNull();
    expect(r.moveX).toBeCloseTo(1, 6);
  });
});
