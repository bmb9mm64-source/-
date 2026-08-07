/**
 * Phase 5 の統合テスト（GDD §6・§7・§8.3 v0.9）。
 * - パーサ：記号 E（リフレクター）／F（チェイサー）の解釈
 * - world 統合：生成・敵残数・撃破・クリア判定
 * - 難易度適用：残機（EASY=5）・発射間隔（HARD で短縮）・敵弾速倍率・
 *   セントリー跳弾狙撃確率の難易度差・既定 normal の互換
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { Bullet } from "../src/core/bullet";
import { resolveDifficulty } from "../src/core/difficulty";
import type { PlayerInput } from "../src/core/input";
import { createSentry, type SentryUpdateContext, updateSentry } from "../src/core/sentry";
import { parseStage } from "../src/core/stage";
import { GameWorld, type MissionDef } from "../src/core/world";
import { FLOOR_5X5, makeBullet, makeStage } from "./helpers";

const rngHalf = (): number => 0.5;
const T = 32;

function idleInput(): PlayerInput {
  return { moveX: 0, moveY: 0, aim: { mode: "none" }, fire: false, placeMine: false };
}

/** バナー（2秒）を消化してプレイ状態にする */
function skipBanner(world: GameWorld): void {
  world.update(BALANCE.GAME.BANNER_TIME + 0.01, [idleInput()]);
  expect(world.status).toBe("playing");
}

describe("パーサ：記号 E / F（GDD §7 v0.9）", () => {
  it("E はリフレクター・F はチェイサーの初期位置として解釈され、タイルは床に置換される", () => {
    const stage = parseStage(["#######", "#P.E.F#", "#######"], { cols: 7, rows: 3 });
    expect(stage.reflectorSpawns).toEqual([{ x: 3 * T + T / 2, y: T + T / 2 }]);
    expect(stage.chaserSpawns).toEqual([{ x: 5 * T + T / 2, y: T + T / 2 }]);
    expect(stage.grid[1]![3]).toBe("."); // E は床扱い
    expect(stage.grid[1]![5]).toBe("."); // F は床扱い
  });

  it("E / F が無いステージでは空配列になる（既存ステージの互換）", () => {
    const stage = parseStage(["#####", "#P.A#", "#####"], { cols: 5, rows: 3 });
    expect(stage.reflectorSpawns).toEqual([]);
    expect(stage.chaserSpawns).toEqual([]);
  });
});

describe("world 統合：敵E/F の生成・撃破・クリア（GDD §6 v0.9）", () => {
  it("E/F 入りミッション：リフレクター・チェイサーが生成され、敵残数に数えられ、全滅でクリアになる", () => {
    const missionEF: MissionDef = { name: "TEST-EF", grid: ["######", "#P.EF#", "######"] };
    const world = new GameWorld([missionEF], rngHalf);
    skipBanner(world);
    expect(world.enemies.map((e) => e.kind).sort()).toEqual(["chaser", "reflector"]);
    expect(world.enemiesLeft()).toBe(2); // 敵残数に含まれる
    for (const e of world.enemies) world.bullets.push(makeBullet({ x: e.x, y: e.y, ownerIsPlayer: true }));
    world.update(0.016, [idleInput()]);
    expect(world.status).toBe("allclear"); // 撃破がクリア判定に数えられる
    expect(world.kills).toBe(2); // 撃破数に計上される
  });

  it("リフレクターが world 内で撃った弾は反射上限2回を持つ（updateBullet が弾固有の上限を使う）", () => {
    // E の真下にプレイヤー：直接射線あり → 発射間隔（2.5s）消化後に直接射撃する
    const missionE: MissionDef = {
      name: "TEST-E",
      grid: ["#####", "#.E.#", "#...#", "#P..#", "#####"],
    };
    const world = new GameWorld([missionE], rngHalf);
    skipBanner(world);
    let bullet: Bullet | null = null;
    for (let i = 0; i < 100 && !bullet; i++) {
      world.update(0.05, [idleInput()]);
      const b = world.bullets.find((x) => x.owner === world.enemies[0]);
      if (b) bullet = b;
    }
    expect(bullet).not.toBeNull();
    expect(bullet!.maxBounces).toBe(BALANCE.BULLET.REFLECTOR_MAX_BOUNCES); // 2回反射弾
  });
});

describe("難易度の適用（GDD §8.3 v0.9）", () => {
  const MISSION_A: MissionDef = { name: "TEST-A", grid: ["#####", "#P.A#", "#####"] };

  it("初期残機：EASY=5・NORMAL=3・HARD=3。既定（引数省略）は normal＝3", () => {
    expect(new GameWorld([MISSION_A], rngHalf, 1, "easy").lives).toBe(5);
    expect(new GameWorld([MISSION_A], rngHalf, 1, "normal").lives).toBe(3);
    expect(new GameWorld([MISSION_A], rngHalf, 1, "hard").lives).toBe(3);
    expect(new GameWorld([MISSION_A], rngHalf).lives).toBe(BALANCE.GAME.LIVES); // 互換：既定 normal
  });

  it("敵の発射間隔：HARD は×0.75 で短く、EASY は×1.4 で長い（セントリー初期値で確認）", () => {
    const mean = BALANCE.SENTRY.FIRE_INTERVAL_MEAN; // rng=0.5 でゆらぎ0＝平均値
    const timerOf = (d: "easy" | "normal" | "hard"): number => {
      const world = new GameWorld([MISSION_A], rngHalf, 1, d);
      const sentry = world.enemies[0]!;
      if (sentry.kind !== "sentry") throw new Error("セントリーが生成されていない");
      return sentry.fireTimer;
    };
    expect(timerOf("normal")).toBeCloseTo(mean, 6);
    expect(timerOf("hard")).toBeCloseTo(mean * 0.75, 6);
    expect(timerOf("easy")).toBeCloseTo(mean * 1.4, 6);
    expect(timerOf("hard")).toBeLessThan(timerOf("normal")); // HARD は矢継ぎ早
  });

  it("敵弾速の倍率：HARD のセントリー弾は 225×1.1 px/s、EASY は 225×0.9 px/s", () => {
    const speedOf = (mods: ReturnType<typeof resolveDifficulty>): number => {
      const stage = makeStage(FLOOR_5X5);
      const e = createSentry(80, 48, rngHalf, mods);
      e.state = "AIM";
      e.fireTimer = 0;
      const ctx: SentryUpdateContext = {
        players: [{ x: 80, y: 112, alive: true }], // 真下＝初期砲塔角と一致
        bullets: [],
        stage,
        grace: 0,
        rng: rngHalf,
        mods,
      };
      for (let i = 0; i < 10 && ctx.bullets.length === 0; i++) updateSentry(e, 0.05, ctx);
      expect(ctx.bullets).toHaveLength(1);
      return Math.hypot(ctx.bullets[0]!.vx, ctx.bullets[0]!.vy);
    };
    const base = BALANCE.BULLET.ENEMY_BULLET_SPEED;
    expect(speedOf(resolveDifficulty("normal"))).toBeCloseTo(base, 6);
    expect(speedOf(resolveDifficulty("hard"))).toBeCloseTo(base * 1.1, 6);
    expect(speedOf(resolveDifficulty("easy"))).toBeCloseTo(base * 0.9, 6);
  });

  it("セントリーの跳弾狙撃確率は難易度連動：rng=0.5 は EASY(40%) で外れ、NORMAL(75%) で成立する", () => {
    // 中央縦壁で直接射線を塞ぎ、上外周壁の1回反射なら届く盤面（sniper.test.ts と同形）
    const blocked = makeStage([
      "##########",
      "#P.......#",
      "#........#",
      "#....#...#",
      "#....#...#",
      "#....#...#",
      "#....#...#",
      "##########",
    ]);
    const shoot = (mods: ReturnType<typeof resolveDifficulty>): number => {
      const e = createSentry(2.5 * T, 5 * T, rngHalf, mods);
      e.state = "AIM";
      e.fireTimer = 0;
      const ctx: SentryUpdateContext = {
        players: [{ x: 7.5 * T, y: 5 * T, alive: true }],
        bullets: [],
        stage: blocked,
        grace: 0,
        rng: rngHalf,
        mods,
      };
      for (let i = 0; i < 120; i++) updateSentry(e, 0.05, ctx); // 6秒
      return ctx.bullets.length;
    };
    expect(shoot(resolveDifficulty("easy"))).toBe(0); // 0.5 >= 0.4 → 撃たない
    expect(shoot(resolveDifficulty("normal"))).toBeGreaterThan(0); // 0.5 < 0.75 → 跳弾狙撃で撃つ
    expect(shoot(resolveDifficulty("hard"))).toBeGreaterThan(0); // 100% → 必ず撃つ
  });

  it("プレイヤー性能は難易度で不変（弾速200px/s のまま）", () => {
    const world = new GameWorld([MISSION_A], rngHalf, 1, "hard");
    skipBanner(world);
    world.update(0.016, [
      { moveX: 0, moveY: 0, aim: { mode: "angle", angle: 0, instant: true }, fire: true, placeMine: false },
    ]);
    const playerBullet = world.bullets.find((b) => b.owner === world.player);
    expect(playerBullet).toBeDefined();
    expect(Math.hypot(playerBullet!.vx, playerBullet!.vy)).toBeCloseTo(BALANCE.BULLET.SPEED, 6); // 200 のまま
  });
});
