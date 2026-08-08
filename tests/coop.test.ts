/**
 * ローカル2P協力（GDD §12.5）のテスト。
 * 2P の生成（隣接床タイル）、弾・地雷上限のプレイヤーごとの独立、
 * ダウンと復帰（片方退場では残機を減らさない／全員退場で残機-1＋リセット／クリアで復帰）。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { liveBulletCount } from "../src/core/bullet";
import type { PlayerInput } from "../src/core/input";
import { liveMineCount } from "../src/core/mine";
import { findNearbyFloor, parseStage } from "../src/core/stage";
import { GameWorld, type MissionDef } from "../src/core/world";
import { MISSIONS } from "../src/stages/missions";
import { makeBullet } from "./helpers";

const rngHalf = (): number => 0.5;

// 7×5 盤面：P(1,1)=(48,48)。2P は隣接床 (2,1)=(80,48) に湧く。A(3,2)=(112,80)
const GRID = ["#######", "#P....#", "#..A..#", "#.....#", "#######"];
const MISSIONS2: MissionDef[] = [
  { name: "COOP-A", grid: GRID },
  { name: "COOP-B", grid: GRID },
];

function idleInput(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return { moveX: 0, moveY: 0, aim: { mode: "none" }, fire: false, placeMine: false, ...overrides };
}

function makeCoopWorld(): GameWorld {
  const world = new GameWorld(MISSIONS2, rngHalf, 2);
  world.update(BALANCE.GAME.BANNER_TIME + 0.01, [idleInput(), idleInput()]); // バナー消化
  expect(world.status).toBe("playing");
  return world;
}

describe("ローカル2P協力（GameWorld）", () => {
  it("2人プレイでは2機生成され、2P は P1 の隣の床タイルに緑側（index=1）として湧く", () => {
    const world = new GameWorld(MISSIONS2, rngHalf, 2);
    expect(world.playerCount).toBe(2);
    expect(world.players).toHaveLength(2);
    expect(world.players[0]!.index).toBe(0);
    expect(world.players[1]!.index).toBe(1);
    expect(world.players[0]).toMatchObject({ x: 48, y: 48, alive: true });
    expect(world.players[1]).toMatchObject({ x: 80, y: 48, alive: true }); // 右隣の床タイル
  });

  it("弾の上限（5発）はプレイヤーごとに独立：P1 が上限でも P2 は撃てる", () => {
    const world = makeCoopWorld();
    const [p1, p2] = [world.players[0]!, world.players[1]!];
    // P1 の弾5発を空き床（row3）に並べる（重なり相殺・命中が起きない間隔）
    for (let i = 0; i < BALANCE.PLAYER.MAX_BULLETS; i++) {
      world.bullets.push(makeBullet({ x: 44 + i * 20, y: 112, owner: p1 }));
    }
    world.update(0.016, [idleInput({ fire: true }), idleInput({ fire: true })]);
    expect(liveBulletCount(world.bullets, p1)).toBe(BALANCE.PLAYER.MAX_BULLETS); // P1 は不発
    expect(liveBulletCount(world.bullets, p2)).toBe(1); // P2 は独立に発射できる
  });

  it("地雷の上限（2個）はプレイヤーごとに独立：P1 が上限でも P2 は置ける", () => {
    const world = makeCoopWorld();
    const [p1, p2] = [world.players[0]!, world.players[1]!];
    // 接近起爆（半径40px）が互いに・敵に届かない位置へ離す
    p1.x = 48;
    p1.y = 112;
    p2.x = 176;
    p2.y = 112;
    world.update(0.016, [idleInput({ placeMine: true }), idleInput()]);
    world.update(0.016, [idleInput({ placeMine: true }), idleInput()]);
    world.update(0.016, [idleInput({ placeMine: true }), idleInput()]); // P1 の3個目は不発
    expect(liveMineCount(world.mines, p1)).toBe(BALANCE.MINE.MAX_PER_OWNER);
    world.update(0.016, [idleInput(), idleInput({ placeMine: true })]);
    world.update(0.016, [idleInput(), idleInput({ placeMine: true })]);
    expect(liveMineCount(world.mines, p2)).toBe(BALANCE.MINE.MAX_PER_OWNER); // P2 は独立に設置できる
    expect(world.mines).toHaveLength(BALANCE.MINE.MAX_PER_OWNER * 2);
  });

  it("片方だけ被弾しても残機は減らず、ミッションは継続する（被弾側は退場）", () => {
    const world = makeCoopWorld();
    world.bullets.push(makeBullet({ x: world.players[1]!.x, y: world.players[1]!.y }));
    world.update(0.016, [idleInput(), idleInput()]);
    expect(world.events.filter((e) => e === "playerHit")).toHaveLength(1);
    expect(world.lives).toBe(BALANCE.GAME.LIVES); // 残機は減らない
    expect(world.status).toBe("playing"); // リセットもされない
    expect(world.players[0]!.alive).toBe(true);
    expect(world.players[1]!.alive).toBe(false); // このミッション中は退場
  });

  it("退場したプレイヤーの入力（移動・射撃・地雷）は受け付けない", () => {
    const world = makeCoopWorld();
    const p2 = world.players[1]!;
    p2.alive = false;
    const x0 = p2.x;
    world.update(0.016, [idleInput(), idleInput({ moveX: 1, fire: true, placeMine: true })]);
    expect(p2.x).toBe(x0);
    expect(world.bullets).toHaveLength(0);
    expect(world.mines).toHaveLength(0);
  });

  it("全員退場した時点で残機-1し、現ミッションをバナーからやり直す（全員復帰）", () => {
    const world = makeCoopWorld();
    for (const p of world.players) {
      world.bullets.push(makeBullet({ x: p.x, y: p.y }));
    }
    world.update(0.016, [idleInput(), idleInput()]);
    expect(world.events.filter((e) => e === "playerHit")).toHaveLength(2);
    expect(world.lives).toBe(BALANCE.GAME.LIVES - 1); // 共有残機が1減る
    expect(world.status).toBe("banner"); // 現ミッションのやり直し
    expect(world.players).toHaveLength(2);
    expect(world.players.every((p) => p.alive)).toBe(true); // 全員復帰
  });

  it("片方が生存したままクリアすれば、退場側もペナルティなしで次ミッションから復帰する", () => {
    const world = makeCoopWorld();
    world.players[1]!.alive = false; // 2P は退場中
    for (const e of world.enemies) {
      world.bullets.push(makeBullet({ x: e.x, y: e.y, ownerIsPlayer: true }));
    }
    world.update(0.016, [idleInput(), idleInput()]);
    expect(world.events).toContain("missionClear");
    expect(world.lives).toBe(BALANCE.GAME.LIVES); // ペナルティなし
    expect(world.missionIndex).toBe(1); // 次ミッションへ
    expect(world.players.every((p) => p.alive)).toBe(true); // 退場側も復帰
  });

  it("実ミッション M1〜M5 のすべてで、2P の湧き位置（P1 の隣接床）が P1 と重ならずに確保できる", () => {
    for (const def of MISSIONS) {
      const stage = parseStage(def.grid);
      const p2 = findNearbyFloor(stage, stage.playerSpawn);
      expect(
        p2.x !== stage.playerSpawn.x || p2.y !== stage.playerSpawn.y,
        `${def.name}: 2P の湧き位置が見つからない`,
      ).toBe(true);
    }
  });

  it("残機1で全員退場するとゲームオーバーになる", () => {
    const world = makeCoopWorld();
    world.lives = 1;
    for (const p of world.players) {
      world.bullets.push(makeBullet({ x: p.x, y: p.y }));
    }
    world.update(0.016, [idleInput(), idleInput()]);
    expect(world.status).toBe("gameover");
    expect(world.events).toContain("gameOver");
  });
});
