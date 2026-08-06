/**
 * 入力抽象化（src/core/input.ts）のテスト。
 * 2P キーボード 8方向照準（IJKL）のベクトル→角度変換と、スティックのデッドゾーン処理。
 * 座標系は画面系（Y 下向きが正）、角度はラジアン。
 */
import { describe, expect, it } from "vitest";
import { applyStickDeadzone, eightWayAngle, idlePlayerInput } from "../src/core/input";

describe("eightWayAngle（IJKL 8方向照準の角度変換）", () => {
  // 引数の順序は (上 I, 左 J, 下 K, 右 L)
  it("単押し4方向：L=右=0、K=下=+PI/2、J=左=PI、I=上=-PI/2", () => {
    expect(eightWayAngle(false, false, false, true)).toBe(0);
    expect(eightWayAngle(false, false, true, false)).toBeCloseTo(Math.PI / 2, 10);
    expect(eightWayAngle(false, true, false, false)).toBeCloseTo(Math.PI, 10);
    expect(eightWayAngle(true, false, false, false)).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("同時押しで斜め4方向：右上=-PI/4、右下=+PI/4、左下=+3PI/4、左上=-3PI/4", () => {
    expect(eightWayAngle(true, false, false, true)).toBeCloseTo(-Math.PI / 4, 10);
    expect(eightWayAngle(false, false, true, true)).toBeCloseTo(Math.PI / 4, 10);
    expect(eightWayAngle(false, true, true, false)).toBeCloseTo((3 * Math.PI) / 4, 10);
    expect(eightWayAngle(true, true, false, false)).toBeCloseTo((-3 * Math.PI) / 4, 10);
  });

  it("未入力・上下同時・左右同時（打ち消し）は null（照準入力なし）", () => {
    expect(eightWayAngle(false, false, false, false)).toBeNull();
    expect(eightWayAngle(true, false, true, false)).toBeNull(); // 上+下
    expect(eightWayAngle(false, true, false, true)).toBeNull(); // 左+右
    expect(eightWayAngle(true, true, true, true)).toBeNull(); // 全部
  });
});

describe("applyStickDeadzone（スティックのデッドゾーン）", () => {
  it("傾きの大きさがデッドゾーン未満なら null（入力なし）", () => {
    expect(applyStickDeadzone(0.1, 0.1, 0.25)).toBeNull();
    expect(applyStickDeadzone(0, 0, 0.25)).toBeNull();
  });

  it("デッドゾーン以上ならベクトルをそのまま返す（境界値は入力あり）", () => {
    expect(applyStickDeadzone(0.5, 0, 0.25)).toEqual({ x: 0.5, y: 0 });
    expect(applyStickDeadzone(0.25, 0, 0.25)).toEqual({ x: 0.25, y: 0 });
    expect(applyStickDeadzone(-0.3, 0.4, 0.25)).toEqual({ x: -0.3, y: 0.4 });
  });
});

describe("idlePlayerInput", () => {
  it("移動・射撃・地雷なし、照準は none（現在の向きを維持）", () => {
    const input = idlePlayerInput();
    expect(input.moveX).toBe(0);
    expect(input.moveY).toBe(0);
    expect(input.aim).toEqual({ mode: "none" });
    expect(input.fire).toBe(false);
    expect(input.placeMine).toBe(false);
  });
});
