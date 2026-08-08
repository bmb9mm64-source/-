/**
 * 敵B「ローバー」のステートマシンのテスト（決定的な乱数を注入）。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { Bullet } from "../src/core/bullet";
import { createRover, type RoverUpdateContext, updateRover } from "../src/core/rover";
import { FLOOR_5X5, makeBullet, makeStage } from "./helpers";

const stage = makeStage(FLOOR_5X5);
// rng=0.5 固定：発射間隔は常に平均値（2.0s）、徘徊目標は盤面中央 (2,2)=(80,80) になる
const rngHalf = (): number => 0.5;

/** プレイヤーは弾の owner 識別にも使うため、同一オブジェクトを ctx に渡す */
function makeCtx(overrides: Partial<RoverUpdateContext> = {}): RoverUpdateContext {
  return {
    players: [{ x: 80, y: 112, alive: true }], // ローバーの真下 → 初期砲塔角（下向き）と一致
    bullets: [] as Bullet[],
    blockers: [],
    stage,
    grace: 0,
    rng: rngHalf,
    ...overrides,
  };
}

describe("ローバーAI（ステートマシン）", () => {
  it("初期状態は WANDER で、目標へ向かって移動する", () => {
    const e = createRover(80, 48, rngHalf);
    const ctx = makeCtx();
    expect(e.state).toBe("WANDER");
    const y0 = e.y;
    // rng=0.5 の徘徊目標は (80,80)（真下）→ y が増える
    for (let i = 0; i < 10; i++) updateRover(e, 0.05, ctx);
    expect(e.target).toEqual({ x: 80, y: 80 });
    expect(e.y).toBeGreaterThan(y0);
    expect(e.x).toBe(80); // 真下への直進なので x は変わらない
  });

  it("移動速度はフレームレートに依存せず 60px/s になる", () => {
    const e = createRover(80, 48, rngHalf);
    const ctx = makeCtx();
    // 目標 (80,80) まで 32px。0.25s 更新 → 15px 進む
    for (let i = 0; i < 5; i++) updateRover(e, 0.05, ctx);
    expect(e.y).toBeCloseTo(48 + BALANCE.ROVER.SPEED * 0.25, 5);
  });

  it("開幕グレース中は移動はするが射撃しない", () => {
    const e = createRover(80, 48, rngHalf);
    e.fireTimer = 0; // 間隔は消化済みでも…
    const ctx = makeCtx({ grace: 1.0 });
    updateRover(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(0); // グレース中は撃たない
    expect(e.y).toBeGreaterThan(48); // 移動はしている
  });

  it("発射間隔を消化し照準・射線が揃うと発射する（同時1発）", () => {
    const e = createRover(80, 48, rngHalf);
    const ctx = makeCtx();
    // fireTimer（平均2.0s）を消化するまで更新（砲塔は最初から真下＝プレイヤー方向）
    for (let i = 0; i < 50; i++) updateRover(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1);
    expect(ctx.bullets[0]!.owner).toBe(e);
    // 自弾が場に残っている限り、さらに回しても撃たない（同時1発）
    for (let i = 0; i < 200; i++) updateRover(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1);
  });

  it("射線が壁で遮られていると発射しない", () => {
    const blockedStage = makeStage([
      "#####",
      "#P..#",
      "###.#", // ローバーとプレイヤーの間に壁
      "#...#",
      "#####",
    ]);
    const e = createRover(48, 48, rngHalf);
    const ctx = makeCtx({ players: [{ x: 48, y: 112, alive: true }], stage: blockedStage });
    for (let i = 0; i < 200; i++) updateRover(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(0);
  });

  it("壁に行き詰まると徘徊目標を引き直す", () => {
    const wallStage = makeStage([
      "#####",
      "#P..#",
      "#.#.#", // (2,2) が壁
      "#...#",
      "#####",
    ]);
    const e = createRover(80, 48, rngHalf);
    e.target = { x: 80, y: 112 }; // 真下だが (2,2) の壁に阻まれる目標
    e.retargetTimer = 99; // 時間経過での引き直しは起きないようにする
    const ctx = makeCtx({ stage: wallStage });
    // 壁に到達 → STUCK_TIME 経過で目標が引き直される
    for (let i = 0; i < 30; i++) updateRover(e, 0.05, ctx);
    expect(e.target.y).not.toBe(112);
  });

  it("プレイヤーの弾が接近すると DODGE に遷移し、時間経過で WANDER に戻る", () => {
    const player = { x: 80, y: 140, alive: true };
    // rng=0.2：回避判定 0.2 < 回避成功率（NORMAL=50%。GDD §8.3）→ 回避成功
    const rngLow = (): number => 0.2;
    const e = createRover(80, 48, rngLow);
    const threat = makeBullet({ x: 80, y: 110, vx: 0, vy: -200, owner: player });
    const ctx = makeCtx({ players: [player], bullets: [threat], rng: rngLow });
    updateRover(e, 0.01, ctx);
    expect(e.state).toBe("DODGE");
    // DODGE_TIME（0.3s）経過で WANDER に戻る
    for (let i = 0; i < 10; i++) updateRover(e, 0.05, ctx);
    expect(e.state).toBe("WANDER");
  });

  it("回避の成功率は確率制：乱数が成功率を超えると回避しない", () => {
    const player = { x: 80, y: 140, alive: true };
    // rng=0.9：0.9 > 回避成功率（NORMAL=50%）→ 回避失敗（WANDER のまま）
    const rngHigh = (): number => 0.9;
    const e = createRover(80, 48, rngHigh);
    const threat = makeBullet({ x: 80, y: 110, vx: 0, vy: -200, owner: player });
    const ctx = makeCtx({ players: [player], bullets: [threat], rng: rngHigh });
    updateRover(e, 0.01, ctx);
    expect(e.state).toBe("WANDER");
    expect(e.dodgeCooldown).toBeGreaterThan(0); // 判定は消費（毎フレーム抽選しない）
  });

  it("敵（自分）の弾では回避しない（プレイヤー弾のみ警戒）", () => {
    const rngLow = (): number => 0.2;
    const e = createRover(80, 48, rngLow);
    const ownBullet = makeBullet({ x: 80, y: 110, vx: 0, vy: -200, owner: e });
    const ctx = makeCtx({ bullets: [ownBullet], rng: rngLow });
    updateRover(e, 0.01, ctx);
    expect(e.state).toBe("WANDER");
  });

  it("遠ざかる弾では回避しない", () => {
    const player = { x: 80, y: 140, alive: true };
    const rngLow = (): number => 0.2;
    const e = createRover(80, 48, rngLow);
    // ローバーの近くだが下向き（離れていく）弾
    const leaving = makeBullet({ x: 80, y: 80, vx: 0, vy: 200, owner: player });
    const ctx = makeCtx({ players: [player], bullets: [leaving], rng: rngLow });
    updateRover(e, 0.01, ctx);
    expect(e.state).toBe("WANDER");
  });

  it("2P の弾でも回避する（プレイヤー弾は全員分を警戒。GDD §12.5）", () => {
    const p1 = { x: 80, y: 140, alive: true };
    const p2 = { x: 48, y: 140, alive: true };
    const rngLow = (): number => 0.2;
    const e = createRover(80, 48, rngLow);
    // 2P（players[1]）所有の接近弾
    const threat = makeBullet({ x: 80, y: 110, vx: 0, vy: -200, owner: p2 });
    const ctx = makeCtx({ players: [p1, p2], bullets: [threat], rng: rngLow });
    updateRover(e, 0.01, ctx);
    expect(e.state).toBe("DODGE");
  });
});
