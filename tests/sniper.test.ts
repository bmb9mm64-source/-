/**
 * 敵C「スナイパー」のテスト（決定的な乱数を注入。GDD §6 v0.6・v0.9）。
 * ブレなしの精密照準・弾速340px/s・砲塔回転70°/s・跳弾狙撃（難易度連動。既定 NORMAL=75%）を検証する。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { Bullet } from "../src/core/bullet";
import { createSniper, type SniperUpdateContext, updateSniper } from "../src/core/sniper";
import { FLOOR_5X5, makeStage } from "./helpers";

const stage = makeStage(FLOOR_5X5);
// rng=0.5 固定：発射間隔は常に平均値（4.0s）になる
const rngHalf = (): number => 0.5;

function makeCtx(overrides: Partial<SniperUpdateContext> = {}): SniperUpdateContext {
  return {
    players: [{ x: 80, y: 112, alive: true }], // スナイパーの真下 → 初期砲塔角（下向き）と一致
    bullets: [] as Bullet[],
    stage,
    grace: 0,
    rng: rngHalf,
    ...overrides,
  };
}

const T = 32;

/**
 * 跳弾狙撃テスト用の盤面（ricochetAim.test.ts と同形）：
 * 中央縦壁の下半分だけ壁 → 直接射線は塞がれ、上外周壁の1回反射なら届く。
 */
const BLOCKED_MID_10X8 = [
  "##########",
  "#P.......#",
  "#........#",
  "#....#...#",
  "#....#...#",
  "#....#...#",
  "#....#...#",
  "##########",
];

/** グレース明け・装填済みのスナイパーを作る */
function readySniper(x: number, y: number, rng: () => number) {
  const s = createSniper(x, y, rng);
  s.state = "AIM";
  s.fireTimer = 0;
  return s;
}

describe("スナイパーAI（ステートマシン）", () => {
  it("開幕グレース中は IDLE のまま射撃しない", () => {
    const e = createSniper(80, 48, rngHalf);
    const ctx = makeCtx({ grace: 1.0 });
    updateSniper(e, 0.05, ctx);
    expect(e.state).toBe("IDLE");
    expect(ctx.bullets).toHaveLength(0);
  });

  it("ブレなしの精密照準：乱数が極端でも砲塔は標的方向に完全一致し、弾はまっすぐ飛ぶ", () => {
    // セントリーなら jitter を引く rng=0.99（最大ブレ側）でも、スナイパーはブレを載せない
    const rngHigh = (): number => 0.99;
    const e = createSniper(80, 48, rngHigh); // fireTimer = 4.0 + 0.98 = 4.98s
    const ctx = makeCtx({ rng: rngHigh });
    for (let i = 0; i < 130; i++) updateSniper(e, 0.05, ctx);
    expect(e.turretAngle).toBe(Math.PI / 2); // 真下にピッタリ一致（ブレなし）
    expect(ctx.bullets).toHaveLength(1);
    const b = ctx.bullets[0]!;
    expect(Math.abs(b.vx)).toBeLessThan(1e-9); // 横ズレなし
    expect(b.vy).toBeCloseTo(BALANCE.BULLET.SNIPER_BULLET_SPEED, 6);
  });

  it("弾速は 340px/s（専用設定）で、発射後は RELOAD に遷移し同時1発を守る", () => {
    const e = createSniper(80, 48, rngHalf);
    const ctx = makeCtx();
    // fireTimer（平均4.0s）を消化するまで更新（砲塔は最初から真下＝プレイヤー方向）
    for (let i = 0; i < 100; i++) updateSniper(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1);
    const b = ctx.bullets[0]!;
    expect(b.owner).toBe(e);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BALANCE.BULLET.SNIPER_BULLET_SPEED, 6);
    expect(e.state).toBe("RELOAD");
    // 自弾が場に残っている限り、さらに回しても撃たない（同時1発）
    for (let i = 0; i < 300; i++) updateSniper(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1);
  });

  it("砲塔の回転速度は 70°/s（フレームレート非依存）", () => {
    const e = createSniper(80, 48, rngHalf);
    e.turretAngle = 0; // 真横（標的は真下 = +90°）
    const ctx = makeCtx();
    updateSniper(e, 0.1, ctx);
    expect(e.turretAngle).toBeCloseTo(BALANCE.SNIPER.TURN_SPEED * 0.1, 6); // 7°ぶんだけ回る
  });

  it("射線が壁で遮られ跳弾抽選にも外れる（rng≥難易度確率）と一切撃たない", () => {
    const blocked = makeStage(BLOCKED_MID_10X8);
    const rng = (): number => 0.8; // 0.8 >= 0.75（NORMAL の跳弾狙撃確率。GDD §6 v0.9）→ 跳弾狙撃モードに入らない
    const e = readySniper(2.5 * T, 5 * T, rng);
    const ctx = makeCtx({ players: [{ x: 7.5 * T, y: 5 * T, alive: true }], stage: blocked, rng });
    for (let i = 0; i < 120; i++) updateSniper(e, 0.05, ctx); // 6秒
    expect(ctx.bullets).toHaveLength(0);
  });

  it("跳弾狙撃の抽選は難易度連動（既定 NORMAL=75%）：rng=0.3 で外周反射弾を撃つ", () => {
    const blocked = makeStage(BLOCKED_MID_10X8);
    const rng = (): number => 0.3; // 0.3 < 0.75 → 跳弾狙撃モード（GDD §6 v0.9。旧個別値35%は廃止）
    const e = readySniper(2.5 * T, 5 * T, rng);
    const ctx = makeCtx({ players: [{ x: 7.5 * T, y: 5 * T, alive: true }], stage: blocked, rng });
    for (let i = 0; i < 120; i++) updateSniper(e, 0.05, ctx); // 6秒（70°/s の旋回時間を含む）
    expect(ctx.bullets.length).toBeGreaterThan(0);
    const b = ctx.bullets[0]!;
    expect(b.vy).toBeLessThan(0); // 上の外周壁の反射点を狙って撃っている（上向き）
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BALANCE.BULLET.SNIPER_BULLET_SPEED, 6);
  });
});
