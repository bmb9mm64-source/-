/**
 * 射線判定（レイキャスト）のテスト — `#` は遮蔽、`H`（穴）は非遮蔽。
 */
import { describe, expect, it } from "vitest";
import { hasLineOfSight } from "../src/core/los";
import { makeStage } from "./helpers";

// 7×4：row1 は途中に恒久壁 #、row2 は途中に穴 H がある
const stage = makeStage([
  "#######",
  "#..#..#",
  "#P.H..#",
  "#######",
]);

describe("射線判定（LOS）", () => {
  it("恒久壁 # を挟むと射線は通らない", () => {
    // (1,1)中心 (48,48) → (5,1)中心 (176,48)：途中の (3,1) が #
    expect(hasLineOfSight(stage, 48, 48, 176, 48)).toBe(false);
  });

  it("穴 H は弾が上を通過するため射線を遮らない", () => {
    // (1,2)中心 (48,80) → (5,2)中心 (176,80)：途中の (3,2) が H
    expect(hasLineOfSight(stage, 48, 80, 176, 80)).toBe(true);
  });

  it("障害物のない2点間は射線が通る", () => {
    expect(hasLineOfSight(stage, 48, 48, 80, 48)).toBe(true);
  });

  it("盤面の範囲外は壁扱いとして遮蔽される", () => {
    expect(hasLineOfSight(stage, 48, 48, 48, -100)).toBe(false);
  });
});
