/**
 * 敵AIの標的選択（GDD §12.5）のテスト。
 * 「生存プレイヤーのうち射線が通る最も近い1体」を選ぶ／全員遮蔽なら最も近い生存者
 * （hasLos=false＝照準追従のみ）／退場者（alive=false）は無視／生存者なしは null。
 */
import { describe, expect, it } from "vitest";
import { selectTarget } from "../src/core/targeting";
import { makeStage } from "./helpers";

/**
 * 9×5 盤面：col4（x=128..160）の縦壁が rows1-3 を分断。
 * 射手は壁の右側 (176,80)。壁の左側の候補への射線は必ず遮られる。
 */
const stage = makeStage([
  "#########",
  "#P..#...#",
  "#...#...#",
  "#...#...#",
  "#########",
]);
const SX = 176; // 射手（col5, row2 の中心）
const SY = 80;

describe("敵AIの標的選択（selectTarget）", () => {
  it("近くても遮蔽されている候補より、射線が通る遠い候補を選ぶ（hasLos=true）", () => {
    const blockedNear = { x: 112, y: 80, alive: true }; // 壁の左（距離64・遮蔽）
    const visibleFar = { x: 240, y: 112, alive: true }; // 右下（距離約72・射線あり）
    const pick = selectTarget(stage, SX, SY, [blockedNear, visibleFar]);
    expect(pick).not.toBeNull();
    expect(pick!.target).toBe(visibleFar);
    expect(pick!.hasLos).toBe(true);
  });

  it("両方に射線が通るなら最も近い1体を選ぶ", () => {
    const visibleNear = { x: 208, y: 80, alive: true }; // 距離32
    const visibleFar = { x: 240, y: 112, alive: true }; // 距離約72
    const pick = selectTarget(stage, SX, SY, [visibleFar, visibleNear]);
    expect(pick!.target).toBe(visibleNear);
    expect(pick!.hasLos).toBe(true);
  });

  it("全員遮蔽なら最も近い生存者を返す（hasLos=false＝照準追従のみ）", () => {
    const blockedNear = { x: 112, y: 80, alive: true }; // 距離64
    const blockedFar = { x: 48, y: 48, alive: true }; // 距離約132
    const pick = selectTarget(stage, SX, SY, [blockedFar, blockedNear]);
    expect(pick!.target).toBe(blockedNear);
    expect(pick!.hasLos).toBe(false);
  });

  it("退場者（alive=false）は無視する：射線が通る近い退場者より、遠い生存者を選ぶ", () => {
    const deadNear = { x: 208, y: 80, alive: false }; // 距離32・射線あり・だが退場
    const aliveFar = { x: 240, y: 112, alive: true };
    const pick = selectTarget(stage, SX, SY, [deadNear, aliveFar]);
    expect(pick!.target).toBe(aliveFar);
    expect(pick!.hasLos).toBe(true);
  });

  it("生存者が遮蔽者のみでも、退場者ではなく生存者を返す", () => {
    const deadVisible = { x: 208, y: 80, alive: false };
    const aliveBlocked = { x: 112, y: 80, alive: true };
    const pick = selectTarget(stage, SX, SY, [deadVisible, aliveBlocked]);
    expect(pick!.target).toBe(aliveBlocked);
    expect(pick!.hasLos).toBe(false);
  });

  it("生存者がいなければ null（全員退場・候補なし）", () => {
    expect(selectTarget(stage, SX, SY, [{ x: 208, y: 80, alive: false }])).toBeNull();
    expect(selectTarget(stage, SX, SY, [])).toBeNull();
  });
});
