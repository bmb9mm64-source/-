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

/** 円環（3〜6タイル）が丸ごと入る広さ（20×14）の全面床ステージ */
const OPEN_20X14 = [
  "####################",
  "#P.................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "####################",
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

describe("チェイサーの追跡目標（pickChaseTarget・GDD §6 v0.24）", () => {
  it("目標はプレイヤーを中心とする円環（3〜6タイル）の床タイル中心から選ばれる", () => {
    const stage = makeStage(OPEN_20X14);
    const anchor = { x: 9.5 * T, y: 6.5 * T }; // タイル (9,6)
    // 乱数を散らして何度も引き、全て円環の内側・床タイル中心であることを確認する
    const values = [0.0, 0.99, 0.3, 0.7, 0.15, 0.85, 0.45, 0.6, 0.05, 0.95];
    let i = 0;
    const rng = (): number => values[i++ % values.length]!;
    const { CHASE_MIN_TILES: MIN, CHASE_MAX_TILES: MAX } = BALANCE.CHASER;
    let picked = 0;
    for (let n = 0; n < 40; n++) {
      const target = pickChaseTarget(stage, rng, anchor);
      if (target.x === anchor.x && target.y === anchor.y) continue; // 全試行が外れた保険の戻り値
      picked++;
      const col = Math.floor(target.x / T);
      const row = Math.floor(target.y / T);
      const dist = Math.hypot(col - 9, row - 6);
      // 丸めのぶん半タイルの誤差を許容する（cos/sin の結果を最寄りタイルへ丸めているため）
      expect(dist).toBeGreaterThanOrEqual(MIN - 0.75);
      expect(dist).toBeLessThanOrEqual(MAX + 0.75);
      expect(stage.grid[row]![col]).toBe("."); // 床タイルのみ
      expect(target.x % T).toBeCloseTo(T / 2, 6); // タイル中心
      expect(target.y % T).toBeCloseTo(T / 2, 6);
    }
    expect(picked, "少なくとも1回は円環から引けているはず").toBeGreaterThan(0);
  });

  it("**至近距離は選ばない**（詰めきって的にならないための強化点）", () => {
    const stage = makeStage(OPEN_20X14);
    const anchor = { x: 9.5 * T, y: 6.5 * T };
    let i = 0;
    const values = [0.0, 0.1, 0.25, 0.4, 0.5, 0.66, 0.75, 0.9, 0.99, 0.33];
    const rng = (): number => values[i++ % values.length]!;
    for (let n = 0; n < 40; n++) {
      const target = pickChaseTarget(stage, rng, anchor);
      if (target.x === anchor.x && target.y === anchor.y) continue;
      const dist = Math.hypot(Math.floor(target.x / T) - 9, Math.floor(target.y / T) - 6);
      expect(dist, "プレイヤーに重なる位置は目標にしない").toBeGreaterThan(1);
    }
  });

  it("床が引けないときはアンカー（プレイヤー位置）そのものを返す（保険）", () => {
    // 細い回廊なので、円環上のタイルはほぼ全て壁＝全試行を外させる
    const stage = makeStage(CORRIDOR_12X3);
    const anchor = { x: 5.5 * T, y: 1.5 * T };
    const rngWall = (): number => 0.25; // 角度 π/2＝真下、距離は最小 → 回廊の外＝壁扱い
    const target = pickChaseTarget(stage, rngWall, anchor, 3, 6, 5);
    expect(target).toEqual({ x: anchor.x, y: anchor.y });
  });
});

describe("チェイサーAI（GDD §6 v0.9／v0.24 強化）", () => {
  it("プレイヤーへ寄るが、**詰めきらない**（GDD §6 v0.24 の強化点）", () => {
    const stage = makeStage(OPEN_20X14);
    const player = { x: 13.5 * T, y: 6.5 * T, alive: true };
    const e = createChaser(1.5 * T, 1.5 * T, rngHalf);
    e.fireTimer = 99; // 射撃は起こさない（移動だけを見る）
    const ctx = makeCtx({ players: [player], stage });
    const dist0 = Math.hypot(player.x - e.x, player.y - e.y);
    for (let i = 0; i < 20; i++) updateChaser(e, 0.05, ctx); // 1.0s
    expect(Math.hypot(player.x - e.x, player.y - e.y)).toBeLessThan(dist0); // 接近はする
    for (let i = 0; i < 400; i++) updateChaser(e, 0.05, ctx); // さらに20秒
    const settled = Math.hypot(player.x - e.x, player.y - e.y);
    // 至近距離まで詰めない＝「近づいて処理する」が通じない。円環の内半径付近で落ち着く
    expect(settled).toBeGreaterThan((BALANCE.CHASER.CHASE_MIN_TILES - 1) * T);
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

  it("発射間隔は平均0.85s（rng=0.5）：間隔消化後に発射し、同時2発を守る（v0.24）", () => {
    const MEAN = BALANCE.CHASER.FIRE_INTERVAL_MEAN;
    expect(chaserNextInterval(rngHalf)).toBeCloseTo(MEAN, 6);
    const stage = makeStage(CORRIDOR_12X3);
    const player = { x: 10.5 * T, y: 1.5 * T, alive: true };
    const e = createChaser(2.5 * T, 1.5 * T, rngHalf);
    expect(e.fireTimer).toBeCloseTo(MEAN, 6); // 生成時の初期間隔も平均値
    const ctx = makeCtx({ players: [player], stage });
    for (let i = 0; i < 16; i++) updateChaser(e, 0.05, ctx); // 0.80s：まだ間隔を消化していない
    expect(ctx.bullets).toHaveLength(0);
    for (let i = 0; i < 3; i++) updateChaser(e, 0.05, ctx); // 0.95s まで
    expect(ctx.bullets).toHaveLength(1); // 間隔消化後に発射
    expect(ctx.bullets[0]!.owner).toBe(e);
    expect(Math.hypot(ctx.bullets[0]!.vx, ctx.bullets[0]!.vy)).toBeCloseTo(
      BALANCE.BULLET.ENEMY_BULLET_SPEED,
      6,
    ); // 225px/s（NORMAL）
    expect(e.fireTimer).toBeGreaterThan(0); // 次回間隔が再設定された
    // 同時2発までは撃てるが、それ以上は自弾が消えるまで撃たない
    for (let i = 0; i < 200; i++) updateChaser(e, 0.05, ctx);
    expect(ctx.bullets.length).toBeLessThanOrEqual(BALANCE.CHASER.MAX_BULLETS);
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
