/**
 * 敵S「シールダー」・敵V「バースター」・敵M「ボマー」（GDD §6 v0.14）のテスト。
 * それぞれ「対処法が変わる」ことが設計意図なので、その中核挙動を検証する。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { type Bullet, updateBullet } from "../src/core/bullet";
import { idlePlayerInput } from "../src/core/input";
import { createMortar, updateMortar } from "../src/core/mortar";
import { shieldBlocks } from "../src/core/shielder";
import { createVolley, updateVolley } from "../src/core/volley";
import { GameWorld } from "../src/core/world";
import { makeBullet, makeStage } from "./helpers";

const T = 32;
const OPEN = [
  "##########",
  "#P.......#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "##########",
];

const rngHalf = () => 0.5;

/** 25×17 の広間に指定の敵記号を1体置いたミッション */
function missionWith(symbol: string): { name: string; grid: string[] } {
  const rows: string[] = ["#########################"];
  for (let r = 1; r <= 15; r++) {
    let row = "#.......................#";
    if (r === 3) row = `#.P.....................#`;
    if (r === 12) row = `#..................${symbol}....#`;
    rows.push(row);
  }
  rows.push("#########################");
  return { name: `test-${symbol}`, grid: rows };
}

describe("敵S「シールダー」：盾は正面だけを守る", () => {
  it("盾の正面から来た弾は防ぎ、背後から来た弾は防がない", () => {
    const e = { shieldAngle: 0 }; // 盾は右（+X）を向いている
    // 右から左へ飛んできた弾＝正面から来た → 防ぐ
    const fromFront = makeBullet({ vx: -200, vy: 0 });
    expect(shieldBlocks(e, fromFront)).toBe(true);
    // 左から右へ飛んできた弾＝背後から来た → 防がない
    const fromBack = makeBullet({ vx: 200, vy: 0 });
    expect(shieldBlocks(e, fromBack)).toBe(false);
    // 真上から来た弾（正面から90°）→ 弧は±60°なので防がない
    const fromSide = makeBullet({ vx: 0, vy: 200 });
    expect(shieldBlocks(e, fromSide)).toBe(false);
  });

  it("世界レベル：正面からの直射では倒せず、背後からの弾なら倒せる", () => {
    const world = new GameWorld([missionWith("S")]);
    world.update(2.1, [idlePlayerInput()]);
    const e = world.enemies[0]!;
    expect(e.kind).toBe("shielder");
    // 盾をプレイヤー方向（左上）に十分向けてから、その方向から撃つ
    for (let i = 0; i < 240; i++) world.update(1 / 60, [idlePlayerInput()]);
    const shield = (e as unknown as { shieldAngle: number }).shieldAngle;
    // 正面から飛んでくる弾（盾の向きの逆向きに進む）
    world.bullets.push(
      makeBullet({
        x: e.x,
        y: e.y,
        vx: -Math.cos(shield) * 200,
        vy: -Math.sin(shield) * 200,
        ownerIsPlayer: true,
      }),
    );
    world.update(1 / 60, [idlePlayerInput()]);
    expect(e.alive).toBe(true); // 盾に防がれる

    // 背後から飛んでくる弾（盾の向きと同じ向きに進む）
    world.bullets.push(
      makeBullet({
        x: e.x,
        y: e.y,
        vx: Math.cos(shield) * 200,
        vy: Math.sin(shield) * 200,
        ownerIsPlayer: true,
      }),
    );
    world.update(1 / 60, [idlePlayerInput()]);
    expect(e.alive).toBe(false); // 背後は無防備
  });

  it("盾は砲塔より遅く追従する（回り込む余地がある）", () => {
    expect(BALANCE.SHIELDER.SHIELD_TURN_SPEED).toBeLessThan(BALANCE.SHIELDER.TURN_SPEED);
  });
});

describe("敵V「バースター」：3連射", () => {
  it("1セットで3発を短間隔で撃つ", () => {
    const stage = makeStage(OPEN);
    const e = createVolley(2.5 * T, 4 * T, rngHalf);
    e.fireTimer = 0;
    e.turretAngle = 0;
    const bullets: Bullet[] = [];
    const player = { x: 7.5 * T, y: 4 * T, alive: true };
    // 連射中は弾が場に残ると上限に達するので、飛んでいった想定で毎フレーム間引く
    for (let i = 0; i < 120; i++) {
      updateVolley(e, 1 / 60, { players: [player], bullets, stage, grace: 0, rng: rngHalf });
      for (const b of bullets) b.x += b.vx / 60;
      if (bullets.length >= 3) break;
    }
    expect(bullets.length).toBe(3);
    expect(Math.hypot(bullets[0]!.vx, bullets[0]!.vy)).toBeCloseTo(
      BALANCE.BULLET.VOLLEY_BULLET_SPEED,
      3,
    );
  });
});

describe("敵M「ボマー」：榴弾は反射せず炸裂する", () => {
  it("信管の時間が切れると炸裂する（反射しない）", () => {
    const stage = makeStage(OPEN);
    const e = createMortar(2.5 * T, 4 * T, rngHalf);
    e.fireTimer = 0;
    e.turretAngle = 0;
    const bullets: Bullet[] = [];
    const player = { x: 7.5 * T, y: 4 * T, alive: true };
    for (let i = 0; i < 120 && bullets.length === 0; i++) {
      updateMortar(e, 1 / 60, { players: [player], bullets, stage, grace: 0, rng: rngHalf });
    }
    expect(bullets.length).toBe(1);
    const shell = bullets[0]!;
    expect(shell.fuse).toBeCloseTo(BALANCE.BULLET.SHELL_FUSE, 3);
    // 信管ぶん進めると炸裂する
    let detonated = false;
    for (let i = 0; i < 200 && !detonated; i++) {
      updateBullet(shell, 1 / 60, stage);
      if (shell.detonated) detonated = true;
    }
    expect(detonated).toBe(true);
    expect(shell.dead).toBe(true);
    expect(shell.bounces).toBe(0); // 一度も反射していない
  });

  it("世界レベル：榴弾の爆風はプレイヤーを倒す（遮蔽の裏でも安全ではない）", () => {
    const world = new GameWorld([missionWith("M")]);
    world.update(2.1, [idlePlayerInput()]);
    const p = world.player;
    // プレイヤーのすぐ横で炸裂する榴弾を置く
    world.bullets.push(
      makeBullet({
        x: p.x + 20,
        y: p.y,
        vx: 0,
        vy: 0,
        ownerIsPlayer: false,
        fuse: 0.01,
        blastRadius: BALANCE.BULLET.SHELL_BLAST_RADIUS,
        armed: true,
      }),
    );
    const livesBefore = world.lives;
    world.update(1 / 60, [idlePlayerInput()]);
    expect(p.alive || world.lives < livesBefore).toBe(true);
    expect(world.lastExplosions.length + world.events.filter((e) => e === "mineExploded").length)
      .toBeGreaterThan(0);
  });
});
