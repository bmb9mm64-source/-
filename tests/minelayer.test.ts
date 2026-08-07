/**
 * 敵D「マインレイヤー」のテスト（決定的な乱数を注入。GDD §6 v0.6）。
 * 徘徊70px/s・回避なし・敷設間隔（平均5.0±2.0s）・同時3個上限（自分の生存地雷のみ）・
 * 160px 近接時の敷設禁止・敵地雷の誘爆連鎖参加を検証する。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { Bullet } from "../src/core/bullet";
import type { Mine } from "../src/core/mine";
import { updateMines } from "../src/core/mine";
import {
  createMinelayer,
  minelayerNextFireInterval,
  minelayerNextMineInterval,
  type MinelayerUpdateContext,
  updateMinelayer,
} from "../src/core/minelayer";
import { makeBullet, makeStage } from "./helpers";

// 16×8 の全面床（外周のみ壁）。rng=0.5 の徘徊目標はタイル (8,4) = (272,144) になる
const FLOOR_16X8: readonly string[] = [
  "################",
  "#P.............#",
  "#..............#",
  "#..............#",
  "#..............#",
  "#..............#",
  "#..............#",
  "################",
];
const stage = makeStage(FLOOR_16X8);
// rng=0.5 固定：発射間隔=2.5s・敷設間隔=5.0s・徘徊目標=(272,144)
const rngHalf = (): number => 0.5;

function makeCtx(overrides: Partial<MinelayerUpdateContext> = {}): MinelayerUpdateContext {
  return {
    players: [{ x: 48, y: 48, alive: true }], // 左上（160px 以上離れた位置）
    bullets: [] as Bullet[],
    blockers: [],
    mines: [] as Mine[],
    stage,
    grace: 0,
    rng: rngHalf,
    ...overrides,
  };
}

/** テスト用の地雷を直接生成する */
function makeMine(partial: Partial<Mine>): Mine {
  return {
    x: 0,
    y: 0,
    owner: {},
    ownerIsPlayer: false,
    fuse: 10,
    ownerClear: false,
    dead: false,
    ...partial,
  };
}

describe("マインレイヤーAI", () => {
  it("敷設・発射間隔は平均±ゆらぎ（敷設 5.0±2.0s・発射 2.5±1.0s）", () => {
    expect(minelayerNextMineInterval(() => 0.5)).toBeCloseTo(5.0, 9);
    expect(minelayerNextMineInterval(() => 0)).toBeCloseTo(3.0, 9);
    expect(minelayerNextFireInterval(() => 0.5)).toBeCloseTo(2.5, 9);
    expect(minelayerNextFireInterval(() => 0)).toBeCloseTo(1.5, 9);
  });

  it("徘徊はローバーと同方式で、移動速度は 70px/s（フレームレート非依存）", () => {
    const e = createMinelayer(272, 48, rngHalf);
    const ctx = makeCtx();
    // rng=0.5 の徘徊目標は (272,144)（真下）→ 0.25s で 70×0.25 = 17.5px 進む
    for (let i = 0; i < 5; i++) updateMinelayer(e, 0.05, ctx);
    expect(e.target).toEqual({ x: 272, y: 144 });
    expect(e.x).toBe(272);
    expect(e.y).toBeCloseTo(48 + BALANCE.MINELAYER.SPEED * 0.25, 5);
  });

  it("プレイヤー弾が接近しても回避行動はとらない（脅威の有無で挙動が変わらない）", () => {
    const player = { x: 48, y: 48, alive: true };
    const calm = createMinelayer(272, 48, rngHalf);
    const threatened = createMinelayer(272, 48, rngHalf);
    const calmCtx = makeCtx({ players: [player] });
    // ローバーなら回避判定の対象になる「接近中のプレイヤー弾」を場に置く
    const threat = makeBullet({ x: 272, y: 120, vx: 0, vy: -200, owner: player });
    const threatenedCtx = makeCtx({ players: [player], bullets: [threat] });
    for (let i = 0; i < 20; i++) {
      updateMinelayer(calm, 0.05, calmCtx);
      updateMinelayer(threatened, 0.05, threatenedCtx);
    }
    expect(threatened.x).toBe(calm.x); // 回避なし＝軌道は完全一致
    expect(threatened.y).toBe(calm.y);
  });

  it("敷設間隔（平均5.0s）を消化すると自位置に地雷を敷設し、間隔を引き直す", () => {
    const e = createMinelayer(272, 144, rngHalf); // 目標と同位置 → その場に留まる
    const ctx = makeCtx(); // プレイヤーは (48,48)：距離約244 ≥ 160
    for (let i = 0; i < 99; i++) updateMinelayer(e, 0.05, ctx); // 4.95s：まだ敷設しない
    expect(ctx.mines).toHaveLength(0);
    for (let i = 0; i < 3; i++) updateMinelayer(e, 0.05, ctx); // 5.1s：敷設済み
    expect(ctx.mines).toHaveLength(1);
    expect(ctx.mines[0]!.owner).toBe(e);
    expect(ctx.mines[0]!.x).toBe(272);
    expect(ctx.mines[0]!.y).toBe(144);
    expect(e.mineTimer).toBeGreaterThan(4); // 次回間隔（5.0s）が引き直された
  });

  it("最寄りの生存プレイヤーが 160px 未満にいる間は敷設しない", () => {
    const e = createMinelayer(272, 144, rngHalf);
    const ctx = makeCtx({ players: [{ x: 272, y: 208, alive: true }] }); // 距離 64 < 160
    for (let i = 0; i < 140; i++) updateMinelayer(e, 0.05, ctx); // 7s 回しても…
    expect(ctx.mines).toHaveLength(0);
  });

  it("プレイヤーが退場（alive=false）していれば距離に関係なく敷設しない（生存者のみ数える）", () => {
    const e = createMinelayer(272, 144, rngHalf);
    e.mineTimer = 0;
    const ctx = makeCtx({ players: [{ x: 272, y: 208, alive: false }] });
    updateMinelayer(e, 0.016, ctx);
    expect(ctx.mines).toHaveLength(0); // 生存プレイヤーがいない → 敷設保留
  });

  it("同時3個上限：自分が敷設した生存地雷が3個ある間は敷設せず、1個消えると再開する", () => {
    const e = createMinelayer(272, 144, rngHalf);
    e.mineTimer = 0;
    const mines = [
      makeMine({ owner: e }),
      makeMine({ owner: e }),
      makeMine({ owner: e }),
    ];
    const ctx = makeCtx({ mines });
    updateMinelayer(e, 0.016, ctx);
    expect(ctx.mines).toHaveLength(3); // 上限で不発（タイマーは 0 のまま保留）
    ctx.mines[0]!.dead = true; // 1個が起爆で消えた
    updateMinelayer(e, 0.016, ctx);
    expect(ctx.mines).toHaveLength(4); // 生存3個未満になったので敷設
    expect(ctx.mines[3]!.owner).toBe(e);
  });

  it("他者（プレイヤー等）の地雷は自分の上限に数えない", () => {
    const e = createMinelayer(272, 144, rngHalf);
    e.mineTimer = 0;
    const other = {};
    const mines = [
      makeMine({ owner: other }),
      makeMine({ owner: other }),
      makeMine({ owner: other }),
    ];
    const ctx = makeCtx({ mines });
    updateMinelayer(e, 0.016, ctx);
    expect(ctx.mines).toHaveLength(4); // 他者の3個は無関係に敷設できる
  });

  it("発射間隔（平均2.5s）を消化し照準・射線が揃うと 225px/s の弾を撃つ（同時1発）", () => {
    const e = createMinelayer(272, 144, rngHalf);
    const ctx = makeCtx({ players: [{ x: 272, y: 208, alive: true }] }); // 真下（初期砲塔角と一致）
    for (let i = 0; i < 60; i++) updateMinelayer(e, 0.05, ctx); // 3s
    expect(ctx.bullets).toHaveLength(1);
    const b = ctx.bullets[0]!;
    expect(b.owner).toBe(e);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BALANCE.BULLET.ENEMY_BULLET_SPEED, 6);
    // 自弾が場に残っている限り撃たない（同時1発）
    for (let i = 0; i < 200; i++) updateMinelayer(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1);
  });

  it("開幕グレース中は移動はするが射撃しない", () => {
    const e = createMinelayer(272, 48, rngHalf);
    e.fireTimer = 0; // 間隔は消化済みでも…
    const ctx = makeCtx({ players: [{ x: 272, y: 208, alive: true }], grace: 1.0 });
    updateMinelayer(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(0); // グレース中は撃たない
    expect(e.y).toBeGreaterThan(48); // 移動はしている
  });

  it("敵（マインレイヤー）の地雷も誘爆の連鎖に参加する（mine.ts の共通挙動）", () => {
    const e = createMinelayer(272, 144, rngHalf);
    const playerObj = {};
    const mines = [
      makeMine({ x: 100, y: 100, owner: playerObj, fuse: 0.01 }), // まもなく自動起爆
      makeMine({ x: 140, y: 100, owner: e }), // 40px 先の敵地雷（爆風48+本体8の範囲内）
    ];
    const result = updateMines(mines, 0.02, [], [], makeStage(FLOOR_16X8));
    expect(result.explosions).toHaveLength(2); // 連鎖して両方爆発
    expect(mines.every((m) => m.dead)).toBe(true);
  });
});
