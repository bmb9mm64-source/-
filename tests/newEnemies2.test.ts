/**
 * v0.24 で追加した敵3種のテスト（GDD §6）。
 *
 * この3種は「数値違い」ではなく**対処法が変わる**ことを狙って設計してある。
 * そこで各テストは、その敵の**対処法が成立すること**を機械検証する形にしてある：
 *   ・敵T「トラッカー」… まっすぐ走ると読まれ、止まっていれば読まれない
 *   ・敵L「ランサー」  … 突進は直線で曲がれない／壁に激突すると硬直する（＝反撃の窓）
 *   ・敵Y「ミラー」    … 正面から撃つと**返ってくる**／側面から撃てば倒せる
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { Bullet } from "../src/core/bullet";
import { createLancer, type LancerUpdateContext, updateLancer } from "../src/core/lancer";
import {
  armorReflects,
  createMirror,
  type MirrorUpdateContext,
  reflectBullet,
  updateMirror,
} from "../src/core/mirror";
import { createTracker, leadPoint, observeTarget, updateTracker } from "../src/core/tracker";
import { makeBullet, makeStage } from "./helpers";

const T = BALANCE.TILE;

/** 全面床の広い盤面（20×14） */
const OPEN = [
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

const rngHalf = (): number => 0.5;

// ============================================================
describe("敵T「トラッカー」（偏差射撃型）", () => {
  const stage = makeStage(OPEN);

  it("止まっている標的は現在位置をそのまま狙う（出会い頭に見当違いを撃たない）", () => {
    const e = createTracker(5 * T, 5 * T, rngHalf);
    const target = { x: 12 * T, y: 5 * T, alive: true };
    for (let i = 0; i < 10; i++) observeTarget(e, target, 1 / 60);
    const aim = leadPoint(e, target, BALANCE.BULLET.TRACKER_BULLET_SPEED);
    expect(aim.x).toBeCloseTo(target.x, 3);
    expect(aim.y).toBeCloseTo(target.y, 3);
  });

  it("まっすぐ走る標的は**進行方向の先**を狙われる（等速直線移動は読まれる）", () => {
    const e = createTracker(5 * T, 5 * T, rngHalf);
    const target = { x: 12 * T, y: 5 * T, alive: true };
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      target.y += BALANCE.PLAYER.SPEED * dt; // 下へ等速
      observeTarget(e, target, dt);
    }
    const aim = leadPoint(e, target, BALANCE.BULLET.TRACKER_BULLET_SPEED);
    expect(aim.y, "標的の進む先（下）を狙う").toBeGreaterThan(target.y);
    expect(aim.x).toBeCloseTo(target.x, 3); // 横には動いていないのでずらさない
  });

  it("予測のずらし幅には上限がある（遠距離で盤外を狙って永久に当たらないのを防ぐ）", () => {
    const e = createTracker(1 * T, 1 * T, rngHalf);
    const target = { x: 18 * T, y: 12 * T, alive: true };
    // ありえない速さで動かして上限に張り付かせる
    e.estVx = 5000;
    e.estVy = 5000;
    const aim = leadPoint(e, target, BALANCE.BULLET.TRACKER_BULLET_SPEED);
    const lead = Math.hypot(aim.x - target.x, aim.y - target.y);
    expect(lead).toBeLessThanOrEqual(BALANCE.TRACKER.LEAD_MAX_TILES * T + 1e-6);
  });

  it("向きを切り返すと狙いがすぐには追従しない（＝蛇行が対処法になる）", () => {
    const e = createTracker(5 * T, 5 * T, rngHalf);
    const target = { x: 12 * T, y: 5 * T, alive: true };
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      target.y += BALANCE.PLAYER.SPEED * dt; // まず下へ
      observeTarget(e, target, dt);
    }
    for (let i = 0; i < 3; i++) {
      target.y -= BALANCE.PLAYER.SPEED * dt; // 切り返して上へ（3フレームぶん）
      observeTarget(e, target, dt);
    }
    const aim = leadPoint(e, target, BALANCE.BULLET.TRACKER_BULLET_SPEED);
    expect(aim.y, "切り返した直後はまだ「下」を狙っている＝外れる").toBeGreaterThan(target.y);
  });

  it("撃った弾は 250px/s で飛ぶ（GDD §6 の値）", () => {
    const e = createTracker(5 * T, 5 * T, rngHalf);
    e.state = "AIM";
    e.fireTimer = 0;
    const target = { x: 12 * T, y: 5 * T, alive: true };
    const bullets: Bullet[] = [];
    const ctx = { players: [target], bullets, stage, grace: 0, rng: rngHalf };
    for (let i = 0; i < 200 && bullets.length === 0; i++) updateTracker(e, 1 / 60, ctx);
    expect(bullets).toHaveLength(1);
    expect(Math.hypot(bullets[0]!.vx, bullets[0]!.vy)).toBeCloseTo(
      BALANCE.BULLET.TRACKER_BULLET_SPEED,
      6,
    );
  });
});

// ============================================================
describe("敵L「ランサー」（突進型）", () => {
  function ctxFor(stage: ReturnType<typeof makeStage>, target: { x: number; y: number }) {
    const bullets: Bullet[] = [];
    const ctx: LancerUpdateContext = {
      players: [{ ...target, alive: true }],
      bullets,
      blockers: [],
      stage,
      grace: 0,
      rng: rngHalf,
    };
    return { ctx, bullets };
  }

  it("普段はゆっくり寄る（通常速度は突進速度よりずっと遅い）", () => {
    const stage = makeStage(OPEN);
    const e = createLancer(3 * T, 5 * T, rngHalf);
    const { ctx } = ctxFor(stage, { x: 15 * T, y: 5 * T });
    const x0 = e.x;
    for (let i = 0; i < 10; i++) updateLancer(e, 1 / 60, ctx); // 突進前の 0.17s
    const moved = e.x - x0;
    expect(moved).toBeGreaterThan(0); // 寄ってはいる
    expect(moved).toBeLessThan(BALANCE.LANCER.DASH_SPEED * (10 / 60)); // でも突進ほど速くない
  });

  it("突進は開始時の向きへ直進し、途中で曲がらない", () => {
    const stage = makeStage(OPEN);
    const e = createLancer(3 * T, 5 * T, rngHalf);
    const target = { x: 15 * T, y: 5 * T };
    const { ctx } = ctxFor(stage, target);
    e.dashTimer = 0; // すぐ突進させる
    updateLancer(e, 1 / 60, ctx);
    expect(e.state).toBe("DASH");
    const dashAngle = e.dashAngle;
    // 突進中に標的が真上へ移動しても、突進の向きは変わらない
    ctx.players = [{ x: 15 * T, y: 1 * T, alive: true }];
    const y0 = e.y;
    for (let i = 0; i < 10; i++) updateLancer(e, 1 / 60, ctx);
    expect(e.dashAngle).toBe(dashAngle);
    expect(e.y).toBeCloseTo(y0, 3); // 横（この場合は縦）へは曲がらない
  });

  it("突進中は撃たない（撃ちながら突っ込んでこない）", () => {
    const stage = makeStage(OPEN);
    const e = createLancer(3 * T, 5 * T, rngHalf);
    const { ctx, bullets } = ctxFor(stage, { x: 15 * T, y: 5 * T });
    e.dashTimer = 0;
    e.fireTimer = 0;
    updateLancer(e, 1 / 60, ctx);
    expect(e.state).toBe("DASH");
    const before = bullets.length;
    for (let i = 0; i < 20; i++) {
      if (e.state !== "DASH") break;
      updateLancer(e, 1 / 60, ctx);
    }
    // DASH を抜ける瞬間の一撃は許すが、突進の最中に増えてはいけない
    expect(bullets.length).toBeLessThanOrEqual(before + 1);
  });

  it("壁に激突すると硬直する（＝反撃の窓ができる）", () => {
    // 右端が壁のすぐ手前に置いて、右へ突進させる
    const stage = makeStage(OPEN);
    const e = createLancer(17 * T, 5 * T, rngHalf);
    const { ctx } = ctxFor(stage, { x: 19 * T, y: 5 * T });
    e.dashTimer = 0;
    for (let i = 0; i < 60 && e.state !== "STUN"; i++) updateLancer(e, 1 / 60, ctx);
    expect(e.state, "壁にぶつかったら硬直する").toBe("STUN");
    expect(e.stunLeft).toBeGreaterThan(0);
    // 硬直中は動かない
    const x0 = e.x;
    updateLancer(e, 1 / 60, ctx);
    expect(e.x).toBeCloseTo(x0, 6);
  });

  it("硬直が明けたら接近に戻る", () => {
    const stage = makeStage(OPEN);
    const e = createLancer(17 * T, 5 * T, rngHalf);
    const { ctx } = ctxFor(stage, { x: 19 * T, y: 5 * T });
    e.dashTimer = 0;
    for (let i = 0; i < 60 && e.state !== "STUN"; i++) updateLancer(e, 1 / 60, ctx);
    expect(e.state).toBe("STUN");
    const steps = Math.ceil(BALANCE.LANCER.STUN_TIME * 60) + 2;
    for (let i = 0; i < steps; i++) updateLancer(e, 1 / 60, ctx);
    expect(e.state).toBe("APPROACH");
  });

  it("開幕グレース中は突進しない（開幕即突進で理不尽にしない）", () => {
    const stage = makeStage(OPEN);
    const e = createLancer(3 * T, 5 * T, rngHalf);
    const { ctx } = ctxFor(stage, { x: 15 * T, y: 5 * T });
    ctx.grace = 1.0;
    e.dashTimer = 0;
    for (let i = 0; i < 30; i++) updateLancer(e, 1 / 60, ctx);
    expect(e.state).toBe("APPROACH");
  });
});

// ============================================================
describe("敵Y「ミラー」（反射装甲型）", () => {
  it("装甲の正面から来た弾だけを反射する", () => {
    const e = createMirror(10 * T, 5 * T, rngHalf);
    e.armorAngle = 0; // 装甲は右を向いている
    // 右から左へ飛んでくる弾＝装甲の正面から来ている
    expect(armorReflects(e, makeBullet({ vx: -200, vy: 0 }))).toBe(true);
    // 左から右へ飛ぶ弾＝背面から来ている
    expect(armorReflects(e, makeBullet({ vx: 200, vy: 0 }))).toBe(false);
    // 真上から降ってくる弾＝側面（90°）は守備範囲（±50°）の外
    expect(armorReflects(e, makeBullet({ vx: 0, vy: 200 }))).toBe(false);
  });

  it("反射すると弾は**消えずに**向きが反転し、装甲の外へ押し出される", () => {
    const e = createMirror(10 * T, 5 * T, rngHalf);
    const b = makeBullet({ x: e.x - e.radius, y: e.y, vx: 200, vy: 0 });
    reflectBullet(e, b);
    expect(b.dead, "消えない＝返ってくる").toBe(false);
    expect(b.vx).toBe(-200);
    expect(b.vy).toBe(-0);
    // 押し出されて、もう本体と重なっていない
    expect(Math.hypot(b.x - e.x, b.y - e.y)).toBeGreaterThan(e.radius + b.radius);
  });

  it("反射しても発射者は変わらない＝正面から撃つと自分に返ってくる", () => {
    const e = createMirror(10 * T, 5 * T, rngHalf);
    const owner = { x: 0, y: 0 };
    const b = makeBullet({ x: e.x, y: e.y, vx: 200, vy: 0, owner, ownerIsPlayer: true });
    reflectBullet(e, b);
    expect(b.owner).toBe(owner);
    expect(b.ownerIsPlayer).toBe(true);
  });

  it("反射で壁の反射回数は消費しない（跳ねる余力を奪わない）", () => {
    const e = createMirror(10 * T, 5 * T, rngHalf);
    const b = makeBullet({ x: e.x, y: e.y, vx: 200, vy: 0, bounces: 0 });
    reflectBullet(e, b);
    expect(b.bounces).toBe(0);
  });

  it("装甲はシールダーより遅く追従する（＝横へ回り込む時間がある）", () => {
    expect(BALANCE.MIRROR.ARMOR_TURN_SPEED).toBeLessThan(BALANCE.SHIELDER.SHIELD_TURN_SPEED);
  });

  it("装甲はプレイヤー方向へ追従するが、1フレームでは向ききらない", () => {
    const stage = makeStage(OPEN);
    const e = createMirror(10 * T, 5 * T, rngHalf);
    e.armorAngle = Math.PI; // 左を向いている
    const bullets: Bullet[] = [];
    const ctx: MirrorUpdateContext = {
      players: [{ x: 18 * T, y: 5 * T, alive: true }], // 右にいる
      bullets,
      stage,
      grace: 99, // 撃たせない（装甲の向きだけを見る）
      rng: rngHalf,
    };
    updateMirror(e, 1 / 60, ctx);
    expect(Math.abs(e.armorAngle)).toBeLessThan(Math.PI); // 右へ向き始めた
    expect(Math.abs(e.armorAngle)).toBeGreaterThan(0.1); // でもまだ向ききっていない
  });
});

// ============================================================
describe("新しい敵もステージ記号から生成できる", () => {
  it("記号 T / L / Y が敵として解釈される", () => {
    const stage = makeStage([
      "##########",
      "#P.......#",
      "#..T.....#",
      "#....L...#",
      "#......Y.#",
      "##########",
    ]);
    expect(stage.spawns.tracker).toHaveLength(1);
    expect(stage.spawns.lancer).toHaveLength(1);
    expect(stage.spawns.mirror).toHaveLength(1);
    // 敵の湧きタイルは床に置き換わる（既存の仕様）
    expect(stage.grid[2]![3]).toBe(".");
  });
});
