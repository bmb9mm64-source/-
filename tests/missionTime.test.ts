/**
 * ミッションタイム計時（GameWorld）のテスト（GDD §8.5）。
 * - バナー表示中は計時しない（ポーズはシーン側が update を呼ばない設計のため core では playing 中のみ加算）
 * - プレイ中は dt ぶん進む
 * - 被弾リセットでそのミッションのタイムは 0 に戻る
 * - クリア時に確定タイム（lastClearTime / clearedTimes）が公開される
 * - 全クリア時に通しトータル（totalTime）が公開される。途中開始のランでは null
 * - 撃破戦車の座標（lastDestroyedTanks）が演出用に公開される
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { PlayerInput } from "../src/core/input";
import { GameWorld, type MissionDef } from "../src/core/world";
import { makeBullet } from "./helpers";

const rngHalf = (): number => 0.5;

// P(1,1)=(48,48)・A(3,1)=(112,48) の5×3全周壁つき盤面（world.test.ts と同型）
const MISSION_A: MissionDef = { name: "TEST-A", grid: ["#####", "#P.A#", "#####"] };
const MISSION_B: MissionDef = { name: "TEST-B", grid: ["#####", "#P.A#", "#####"] };
const MISSIONS2 = [MISSION_A, MISSION_B];

function idleInput(): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    aim: { mode: "cursor", x: 48, y: 48 },
    fire: false,
    placeMine: false,
  };
}

/** バナー（2秒）を消化してプレイ状態にする */
function skipBanner(world: GameWorld): void {
  world.update(BALANCE.GAME.BANNER_TIME + 0.01, [idleInput()]);
  expect(world.status).toBe("playing");
}

/** 現ミッションの敵を弾で全滅させる（敵位置に弾を置いて1フレーム＝dt 回す） */
function killAllEnemies(world: GameWorld, dt = 0.016): void {
  for (const e of world.enemies) {
    if (e.alive) world.bullets.push(makeBullet({ x: e.x, y: e.y, ownerIsPlayer: true }));
  }
  world.update(dt, [idleInput()]);
}

describe("ミッションタイム計時（GDD §8.5）", () => {
  it("バナー表示中はタイムが進まない", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    expect(world.missionTime).toBe(0);
    world.update(1.0, [idleInput()]); // まだバナー中
    expect(world.status).toBe("banner");
    expect(world.missionTime).toBe(0);
    world.update(1.01, [idleInput()]); // バナー消化フレーム（この dt も計時しない）
    expect(world.status).toBe("playing");
    expect(world.missionTime).toBe(0);
  });

  it("プレイ中は dt のぶんだけタイムが進む（フレームレート非依存）", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    world.update(0.5, [idleInput()]);
    world.update(0.25, [idleInput()]);
    expect(world.missionTime).toBeCloseTo(0.75, 10);
  });

  it("被弾リセットでそのミッションのタイムは 0 に戻る", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    world.update(1.5, [idleInput()]);
    expect(world.missionTime).toBeCloseTo(1.5, 10);
    world.bullets.push(makeBullet({ x: world.player.x, y: world.player.y }));
    world.update(0.016, [idleInput()]); // 被弾→残機-1・バナーからやり直し
    expect(world.status).toBe("banner");
    expect(world.missionTime).toBe(0);
  });

  it("クリア時に確定タイムが公開される（lastClearTime / clearedTimes。クリアフレームの dt も含む）", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    world.update(2.0, [idleInput()]);
    killAllEnemies(world, 0.016); // M1 クリア
    expect(world.events).toContain("missionClear");
    expect(world.lastClearIndex).toBe(0);
    expect(world.lastClearTime).toBeCloseTo(2.016, 10);
    expect(world.clearedTimes[0]).toBeCloseTo(2.016, 10);
    expect(world.missionTime).toBe(0); // 次ミッションはバナーから 0 で再スタート
  });

  it("全クリア時に M1〜最終の合計（totalTime）が公開される", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    world.update(1.0, [idleInput()]);
    killAllEnemies(world, 0.016); // M1: 1.016s
    expect(world.totalTime).toBeNull(); // まだ全ミッション揃っていない
    skipBanner(world);
    world.update(0.5, [idleInput()]);
    killAllEnemies(world, 0.016); // M2（最終）: 0.516s
    expect(world.status).toBe("allclear");
    expect(world.lastClearIndex).toBe(1);
    expect(world.lastClearTime).toBeCloseTo(0.516, 10);
    expect(world.clearedTimes).toHaveLength(2);
    expect(world.totalTime).toBeCloseTo(1.532, 10);
  });

  it("途中ミッション開始のラン（デバッグ用 ?m 相当）では totalTime は null のまま", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    world.loadMission(1); // M2 から開始
    skipBanner(world);
    killAllEnemies(world); // M2（最終）クリア → allclear
    expect(world.status).toBe("allclear");
    expect(world.clearedTimes[0]).toBeUndefined(); // M1 のタイムがない
    expect(world.totalTime).toBeNull(); // 通しベストの対象にしない
  });

  it("resetGame でタイム記録（clearedTimes・lastClear*）もリセットされる", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    killAllEnemies(world); // M1 クリア
    expect(world.clearedTimes[0]).toBeDefined();
    world.resetGame();
    expect(world.clearedTimes).toHaveLength(0);
    expect(world.lastClearIndex).toBeNull();
    expect(world.lastClearTime).toBeNull();
    expect(world.missionTime).toBe(0);
  });

  it("撃破された戦車の座標が lastDestroyedTanks に公開される（撃破演出用）", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    const enemy = world.enemies[0]!;
    const ex = enemy.x;
    const ey = enemy.y;
    killAllEnemies(world);
    expect(world.lastDestroyedTanks).toEqual([{ x: ex, y: ey }]);
    // 次のフレームではクリアされている（events と同じ1フレーム限りの公開）
    world.update(0.016, [idleInput()]);
    expect(world.lastDestroyedTanks).toHaveLength(0);
  });

  it("プレイヤー被弾時も座標が lastDestroyedTanks に公開される", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    const px = world.player.x;
    const py = world.player.y;
    world.bullets.push(makeBullet({ x: px, y: py }));
    world.update(0.016, [idleInput()]);
    expect(world.events).toContain("playerHit");
    expect(world.lastDestroyedTanks).toContainEqual({ x: px, y: py });
  });
});
