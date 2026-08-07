/**
 * 敵E「リフレクター」のテスト（決定的な乱数を注入。GDD §6 v0.9）。
 * - 専用弾：300px/s・反射上限2回（2回跳ねて生存・3回目の壁接触で消滅）
 * - 同時2発
 * - 跳弾狙撃は難易度によらず常時（抽選なし。rng が大きくても撃つ）
 * - 直接射線があれば直接射撃を優先
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { type Bullet, REFLECTOR_BULLET_CFG, spawnBullet, updateBullet } from "../src/core/bullet";
import {
  createReflector,
  type ReflectorUpdateContext,
  updateReflector,
} from "../src/core/reflector";
import { FLOOR_5X5, makeStage } from "./helpers";

const stage = makeStage(FLOOR_5X5);
// rng=0.5 固定：ブレ jitter=0、発射間隔は常に平均値（2.5s）
const rngHalf = (): number => 0.5;

const T = 32;

/** 跳弾狙撃テスト用の盤面（sniper.test.ts と同形）：中央縦壁で直接射線は塞がれ、上外周壁の反射なら届く */
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

function makeCtx(overrides: Partial<ReflectorUpdateContext> = {}): ReflectorUpdateContext {
  return {
    players: [{ x: 80, y: 112, alive: true }], // リフレクターの真下 → 初期砲塔角（下向き）と一致
    bullets: [] as Bullet[],
    stage,
    grace: 0,
    rng: rngHalf,
    ...overrides,
  };
}

/** グレース明け・装填済みのリフレクターを作る */
function readyReflector(x: number, y: number, rng: () => number) {
  const e = createReflector(x, y, rng);
  e.state = "AIM";
  e.fireTimer = 0;
  return e;
}

describe("リフレクターの弾（反射上限2回。GDD §6 v0.9）", () => {
  it("生成設定は 300px/s・反射上限2回で、弾自身が maxBounces=2 を持つ", () => {
    const bullets: Bullet[] = [];
    const b = spawnBullet(bullets, { x: 80, y: 48 }, Math.PI / 2, REFLECTOR_BULLET_CFG);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BALANCE.BULLET.REFLECTOR_BULLET_SPEED, 6);
    expect(b.maxBounces).toBe(2);
  });

  it("2回反射しても生存し、3回目の壁接触で消滅する（updateBullet が弾固有の上限を使う）", () => {
    // 縦1タイルの回廊：上下の外周壁の間を弾が往復し、接触のたびに反射する
    const corridor = makeStage(["#####", "#P..#", "#####"]);
    const bullets: Bullet[] = [];
    const b = spawnBullet(bullets, { x: 80, y: 48 }, 0, REFLECTOR_BULLET_CFG);
    b.vx = 0;
    b.vy = -BALANCE.BULLET.REFLECTOR_BULLET_SPEED; // 真上へ（上下の壁で反射を繰り返す）
    b.x = 80;
    b.y = 48;
    const seen: { bounces: number; dead: boolean }[] = [];
    for (let i = 0; i < 200 && !b.dead; i++) {
      const prev = b.bounces;
      updateBullet(b, 0.01, corridor); // 反射上限は弾自身が持つ（敵E弾＝2回）
      if (b.bounces > prev) seen.push({ bounces: b.bounces, dead: b.dead });
    }
    expect(seen).toEqual([
      { bounces: 1, dead: false }, // 1回目：反射して生存
      { bounces: 2, dead: false }, // 2回目：反射して生存（プレイヤー弾なら消えている）
      { bounces: 3, dead: true }, // 3回目の壁接触：上限2回を超過して消滅
    ]);
  });

  it("プレイヤー相当の通常弾（上限1回）は同じ回廊で2回目の接触で消える（回帰確認）", () => {
    const corridor = makeStage(["#####", "#P..#", "#####"]);
    const bullets: Bullet[] = [];
    const b = spawnBullet(bullets, { x: 80, y: 48 }, 0); // 既定 cfg＝maxBounces なし
    b.vx = 0;
    b.vy = -BALANCE.BULLET.SPEED;
    b.x = 80;
    b.y = 48;
    for (let i = 0; i < 200 && !b.dead; i++) updateBullet(b, 0.01, corridor);
    expect(b.dead).toBe(true);
    expect(b.bounces).toBe(2); // 2回目の接触＝上限1回超過で消滅
  });
});

describe("リフレクターAI（ステートマシン。GDD §6 v0.9）", () => {
  it("開幕グレース中は IDLE のまま射撃しない", () => {
    const e = createReflector(80, 48, rngHalf);
    const ctx = makeCtx({ grace: 1.0 });
    updateReflector(e, 0.05, ctx);
    expect(e.state).toBe("IDLE");
    expect(ctx.bullets).toHaveLength(0);
  });

  it("発射間隔は平均2.5s（rng=0.5）で、条件が揃うと発射して RELOAD に遷移する", () => {
    const e = createReflector(80, 48, rngHalf);
    expect(e.fireTimer).toBeCloseTo(BALANCE.REFLECTOR.FIRE_INTERVAL_MEAN, 6);
    const ctx = makeCtx();
    for (let i = 0; i < 55; i++) updateReflector(e, 0.05, ctx); // 2.75s
    expect(ctx.bullets).toHaveLength(1);
    expect(ctx.bullets[0]!.owner).toBe(e);
    expect(ctx.bullets[0]!.maxBounces).toBe(2); // 撃った弾は2回反射弾
    expect(e.state).toBe("RELOAD");
  });

  it("同時発射数上限は2発：自弾2発が場にある間は撃たず、1発なら撃てる", () => {
    const e = readyReflector(80, 48, rngHalf);
    const own1: Bullet = { x: 400, y: 400, vx: 0, vy: 0, radius: 4, bounces: 0, owner: e, ownerIsPlayer: false, armed: true, dead: false };
    const own2: Bullet = { x: 420, y: 400, vx: 0, vy: 0, radius: 4, bounces: 0, owner: e, ownerIsPlayer: false, armed: true, dead: false };
    const ctx = makeCtx({ bullets: [own1, own2] });
    for (let i = 0; i < 40; i++) updateReflector(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(2); // 上限2発で撃てない
    own2.dead = true; // 1発消えると…
    for (let i = 0; i < 40; i++) updateReflector(e, 0.05, ctx);
    expect(ctx.bullets.filter((b) => !b.dead && b.owner === e)).toHaveLength(2); // 2発目を撃てる
  });

  it("跳弾狙撃は常時使用（難易度によらず抽選なし）：rng が大きくても外周反射で撃つ", () => {
    const blocked = makeStage(BLOCKED_MID_10X8);
    const rngHigh = (): number => 0.9; // 確率抽選なら（HARD 100% 以外）外れる値
    const e = readyReflector(2.5 * T, 5 * T, rngHigh);
    const ctx = makeCtx({ players: [{ x: 7.5 * T, y: 5 * T, alive: true }], stage: blocked, rng: rngHigh });
    for (let i = 0; i < 120; i++) updateReflector(e, 0.05, ctx); // 6秒（100°/s の旋回時間を含む）
    expect(ctx.bullets.length).toBeGreaterThan(0);
    const b = ctx.bullets[0]!;
    expect(b.vy).toBeLessThan(0); // 上の外周壁の反射点を狙って撃っている（上向き）
    expect(b.maxBounces).toBe(2);
  });

  it("直接射線があれば直接射撃を優先する（反射点ではなく標的方向へ撃つ）", () => {
    const e = readyReflector(80, 48, rngHalf);
    const ctx = makeCtx(); // プレイヤーは真下・射線は開けている
    for (let i = 0; i < 10; i++) updateReflector(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1);
    const b = ctx.bullets[0]!;
    expect(b.vy).toBeGreaterThan(0); // 真下（プレイヤー方向）へ
    expect(Math.abs(b.vx)).toBeLessThan(Math.abs(b.vy) * 0.2); // ほぼ真下＝直接射撃
  });
});
