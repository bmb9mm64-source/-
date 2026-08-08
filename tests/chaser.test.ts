/**
 * 敵F「チェイサー」のテスト（決定的な乱数を注入。GDD §6 v0.9）。
 * - 追跡目標は最寄り生存プレイヤーの周辺（±3タイル以内）の床タイルから選ばれる
 * - 追跡によりプレイヤーとの距離が縮む（110px/s・フレームレート非依存）
 * - 発射間隔 平均 1.0±0.3 s・同時1発・弾 225px/s
 * - 回避はローバーと同方式・成功率50%固定（難易度対象外）
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { Bullet } from "../src/core/bullet";
import {
  type ChaserUpdateContext,
  chaserNextInterval,
  createChaser,
  pickChaseTarget,
  updateChaser,
} from "../src/core/chaser";
import { resolveDifficulty } from "../src/core/difficulty";
import { makeBullet, makeStage } from "./helpers";

const T = 32;
// rng=0.5 固定：発射間隔は常に平均値（1.0s）。追跡目標はアンカー（プレイヤー）自身のタイルになる
const rngHalf = (): number => 0.5;

/** 横長の回廊（12×3）：P(1,1)=(48,48)。内側は全て床 */
const CORRIDOR_12X3 = ["############", "#P.........#", "############"];

/** 広め（12×8）の全面床ステージ */
const OPEN_12X8 = [
  "############",
  "#P.........#",
  "#..........#",
  "#..........#",
  "#..........#",
  "#..........#",
  "#..........#",
  "############",
];

function makeCtx(overrides: Partial<ChaserUpdateContext> = {}): ChaserUpdateContext {
  return {
    players: [{ x: 80, y: 112, alive: true }],
    bullets: [] as Bullet[],
    blockers: [],
    stage: makeStage(OPEN_12X8),
    grace: 0,
    rng: rngHalf,
    ...overrides,
  };
}

describe("チェイサーの追跡目標（pickChaseTarget）", () => {
  it("目標は最寄り生存プレイヤーのタイル±3タイル以内の床タイル中心から選ばれる", () => {
    const stage = makeStage(OPEN_12X8);
    const anchor = { x: 5.5 * T, y: 4.5 * T }; // タイル (5,4)
    // 乱数を散らして何度も引き、全て ±3 タイル以内・床タイル中心であることを確認する
    const values = [0.0, 0.99, 0.3, 0.7, 0.15, 0.85, 0.45, 0.6, 0.05, 0.95];
    let i = 0;
    const rng = (): number => values[i++ % values.length]!;
    for (let n = 0; n < 20; n++) {
      const target = pickChaseTarget(stage, rng, anchor);
      const col = Math.floor(target.x / T);
      const row = Math.floor(target.y / T);
      expect(Math.abs(col - 5)).toBeLessThanOrEqual(BALANCE.CHASER.CHASE_RANGE_TILES);
      expect(Math.abs(row - 4)).toBeLessThanOrEqual(BALANCE.CHASER.CHASE_RANGE_TILES);
      expect(stage.grid[row]![col]).toBe("."); // 床タイルのみ
      expect(target.x % T).toBeCloseTo(T / 2, 6); // タイル中心
      expect(target.y % T).toBeCloseTo(T / 2, 6);
    }
  });

  it("床が引けないときはアンカー（プレイヤー位置）そのものを返す（保険）", () => {
    // 固定乱数で常に範囲外（壁扱い）の左上オフセットを引き続けさせ、全試行を外させる
    const stage = makeStage(CORRIDOR_12X3);
    const anchor = { x: 5.5 * T, y: 1.5 * T };
    const rngWall = (): number => 0.0; // col-3, row-3 → 回廊の外＝壁扱い
    const target = pickChaseTarget(stage, rngWall, anchor, 3, 5);
    expect(target).toEqual({ x: anchor.x, y: anchor.y });
  });
});

describe("チェイサーAI（GDD §6 v0.9）", () => {
  it("プレイヤーを追跡して距離が縮む（rng=0.5 では目標＝プレイヤーのタイル）", () => {
    const stage = makeStage(OPEN_12X8);
    const player = { x: 9.5 * T, y: 5.5 * T, alive: true };
    const e = createChaser(1.5 * T, 1.5 * T, rngHalf);
    e.fireTimer = 99; // 射撃は起こさない（移動だけを見る）
    const ctx = makeCtx({ players: [player], stage });
    const dist0 = Math.hypot(player.x - e.x, player.y - e.y);
    for (let i = 0; i < 20; i++) updateChaser(e, 0.05, ctx); // 1.0s
    const dist1 = Math.hypot(player.x - e.x, player.y - e.y);
    expect(dist1).toBeLessThan(dist0); // 追跡で接近している
    expect(dist0 - dist1).toBeCloseTo(BALANCE.CHASER.SPEED * 1.0, 0); // 110px/s で直進
  });

  it("移動速度はフレームレートに依存しない（dt 分割でも同じ距離）", () => {
    const stage = makeStage(OPEN_12X8);
    const player = { x: 9.5 * T, y: 1.5 * T, alive: true };
    const run = (dt: number, steps: number): number => {
      const e = createChaser(1.5 * T, 1.5 * T, rngHalf);
      e.fireTimer = 99;
      const ctx = makeCtx({ players: [player], stage });
      for (let i = 0; i < steps; i++) updateChaser(e, dt, ctx);
      return e.x;
    };
    expect(run(0.05, 10)).toBeCloseTo(run(0.01, 50), 5); // 合計0.5秒ぶんの移動距離が一致
  });

  it("発射間隔は平均1.0s（rng=0.5）：間隔消化後に発射し、同時1発を守る", () => {
    expect(chaserNextInterval(rngHalf)).toBeCloseTo(BALANCE.CHASER.FIRE_INTERVAL_MEAN, 6);
    const stage = makeStage(CORRIDOR_12X3);
    const player = { x: 10.5 * T, y: 1.5 * T, alive: true };
    const e = createChaser(2.5 * T, 1.5 * T, rngHalf);
    expect(e.fireTimer).toBeCloseTo(1.0, 6); // 生成時の初期間隔も平均1.0s
    const ctx = makeCtx({ players: [player], stage });
    for (let i = 0; i < 19; i++) updateChaser(e, 0.05, ctx); // 0.95s：まだ間隔を消化していない
    expect(ctx.bullets).toHaveLength(0);
    for (let i = 0; i < 6; i++) updateChaser(e, 0.05, ctx); // 1.25s まで
    expect(ctx.bullets).toHaveLength(1); // 間隔消化後に発射
    expect(ctx.bullets[0]!.owner).toBe(e);
    expect(Math.hypot(ctx.bullets[0]!.vx, ctx.bullets[0]!.vy)).toBeCloseTo(
      BALANCE.BULLET.ENEMY_BULLET_SPEED,
      6,
    ); // 225px/s（NORMAL）
    expect(e.fireTimer).toBeGreaterThan(0); // 次回間隔が再設定された
    // 自弾が場に残っている限り、さらに回しても撃たない（同時1発）
    for (let i = 0; i < 60; i++) updateChaser(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1);
  });

  it("プレイヤー弾の接近で DODGE に遷移する（成功率50%：rng=0.4 で成功）", () => {
    const stage = makeStage(OPEN_12X8);
    const player = { x: 2.5 * T, y: 6.5 * T, alive: true };
    const rng = (): number => 0.4; // 0.4 < 0.5 → 回避成功
    const e = createChaser(2.5 * T, 1.5 * T, rng);
    e.fireTimer = 99;
    const threat = makeBullet({ x: e.x, y: e.y + 60, vx: 0, vy: -200, owner: player });
    const ctx = makeCtx({ players: [player], bullets: [threat], stage, rng });
    updateChaser(e, 0.01, ctx);
    expect(e.state).toBe("DODGE");
  });

  it("回避成功率は難易度対象外の50%固定：EASY の mods（ローバーなら35%）でも rng=0.4 で回避する", () => {
    const stage = makeStage(OPEN_12X8);
    const player = { x: 2.5 * T, y: 6.5 * T, alive: true };
    const rng = (): number => 0.4; // ローバー（EASY=35%）なら失敗する値
    const e = createChaser(2.5 * T, 1.5 * T, rng);
    e.fireTimer = 99;
    const threat = makeBullet({ x: e.x, y: e.y + 60, vx: 0, vy: -200, owner: player });
    const ctx = makeCtx({
      players: [player],
      bullets: [threat],
      stage,
      rng,
      mods: resolveDifficulty("easy"),
    });
    updateChaser(e, 0.01, ctx);
    expect(e.state).toBe("DODGE"); // チェイサーは難易度によらず50%固定（GDD §6 v0.9）
  });
});
