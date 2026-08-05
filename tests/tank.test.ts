/**
 * 戦車移動のテスト — 壁・穴の通行不可と戦車同士の衝突（重なり防止。GDD §5.5）。
 * 盤面：5×5（タイル32px）。半辺14の戦車の中心可動域は x,y ∈ [46,114]。
 */
import { describe, expect, it } from "vitest";
import { moveTank, tanksOverlap } from "../src/core/tank";
import { FLOOR_5X5, makeStage } from "./helpers";

const stage = makeStage(FLOOR_5X5);
const HALF = 14;

function makeTank(x: number, y: number) {
  return { x, y, half: HALF, alive: true };
}

describe("戦車の移動と衝突", () => {
  it("壁に向かって移動すると壁境界でスナップして止まる", () => {
    const tank = makeTank(48, 80);
    moveTank(tank, -10, 0, [], stage); // 左壁（x=32）へ突進
    expect(tank.x).toBeGreaterThanOrEqual(32 + HALF); // 壁にめり込まない
    expect(tank.x).toBeCloseTo(32 + HALF, 0); // 境界近くで停止
    expect(tank.y).toBe(80);
  });

  it("穴 H には進入できない", () => {
    const holeStage = makeStage([
      "#####",
      "#P..#",
      "#.H.#",
      "#...#",
      "#####",
    ]);
    // 穴タイル (2,2) は x,y ∈ [64,96]。上から下へ突進する
    const tank = makeTank(80, 48);
    moveTank(tank, 0, 10, [], holeStage);
    expect(tank.y).toBeLessThanOrEqual(64 - HALF + 0.01); // 穴の縁で停止
  });

  it("他の戦車に向かって移動しても重ならない", () => {
    const tank = makeTank(60, 80);
    const blocker = makeTank(100, 80);
    moveTank(tank, 20, 0, [blocker], stage); // 重なる位置（x=80）への移動はブロック
    expect(tank.x).toBe(60); // その場に留まる
    expect(tanksOverlap(tank.x, tank.y, tank.half, blocker)).toBe(false);
  });

  it("重ならない範囲までは他の戦車へ接近できる", () => {
    const tank = makeTank(60, 80);
    const blocker = makeTank(100, 80);
    moveTank(tank, 5, 0, [blocker], stage); // x=65：|65-100|=35 ≥ 28 なので通る
    expect(tank.x).toBe(65);
    expect(tanksOverlap(tank.x, tank.y, tank.half, blocker)).toBe(false);
  });

  it("死亡した戦車は通行を妨げない", () => {
    const tank = makeTank(60, 80);
    const dead = { ...makeTank(100, 80), alive: false };
    moveTank(tank, 20, 0, [dead], stage);
    expect(tank.x).toBe(80); // 死亡車体はすり抜け可
  });
});
