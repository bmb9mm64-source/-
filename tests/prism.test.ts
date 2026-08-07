/**
 * 敵G「プリズム」（GDD §6 v0.10）のテスト。
 * 弾の3回反射と、リフレクター同様の「跳弾狙撃を常時使用」を検証する。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { type Bullet, PRISM_BULLET_CFG, spawnBullet, updateBullet } from "../src/core/bullet";
import { createPrism, updatePrism } from "../src/core/prism";
import { makeStage } from "./helpers";

const T = 32;

const OPEN_10X8 = [
  "##########",
  "#P.......#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "#........#",
  "##########",
];

/** 中央縦壁の下半分が壁（上は開いている）：直接射線は塞がれ、上外周壁の1回反射なら届く */
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

describe("プリズム弾（3回反射）", () => {
  it("弾速280px/s・3回反射し、4回目の壁接触で消滅する", () => {
    const stage = makeStage(OPEN_10X8);
    const bullets: Bullet[] = [];
    // 水平に撃つ → 左右外周壁の間を反射し続ける
    const b = spawnBullet(bullets, { x: 5 * T, y: 4 * T }, 0, PRISM_BULLET_CFG);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BALANCE.BULLET.PRISM_BULLET_SPEED, 6);
    expect(b.maxBounces).toBe(BALANCE.BULLET.PRISM_MAX_BOUNCES);
    const dt = 1 / 60;
    let maxObservedBounces = 0;
    for (let t = 0; t < 20 && !b.dead; t += dt) {
      updateBullet(b, dt, stage);
      maxObservedBounces = Math.max(maxObservedBounces, b.bounces);
    }
    expect(b.dead).toBe(true); // いつかは消える
    expect(maxObservedBounces).toBeGreaterThanOrEqual(3); // 3回は反射して生存していた
    expect(b.bounces).toBe(4); // 4回目の接触で消滅
  });
});

describe("プリズムAI", () => {
  const player = { x: 7.5 * T, y: 5 * T, alive: true };
  const pos = { x: 2.5 * T, y: 5 * T };

  function runFrames(
    s: ReturnType<typeof createPrism>,
    bullets: Bullet[],
    stage: ReturnType<typeof makeStage>,
    rng: () => number,
    seconds: number,
  ): void {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      updatePrism(s, dt, { players: [{ ...player }], bullets, stage, grace: 0, rng });
    }
  }

  it("直接射線が塞がれていても常時（抽選なしで）外周反射を狙って撃つ", () => {
    const stage = makeStage(BLOCKED_MID_10X8);
    const rng = () => 0.99; // 抽選があれば必ず外れる値 → それでも撃つ＝常時使用の検証
    const s = createPrism(pos.x, pos.y, rng);
    s.state = "AIM";
    s.fireTimer = 0;
    const bullets: Bullet[] = [];
    runFrames(s, bullets, stage, rng, 6);
    expect(bullets.length).toBeGreaterThan(0);
    const b = bullets[0]!;
    expect(b.vy).toBeLessThan(0); // 上外周壁の反射点を狙っている
    expect(b.maxBounces).toBe(3); // 撃つ弾は3回反射
  });

  it("同時1発：場に自分の弾が生きている間は撃たない", () => {
    const stage = makeStage(OPEN_10X8);
    const rng = () => 0.5;
    const s = createPrism(pos.x, pos.y, rng);
    s.state = "AIM";
    s.fireTimer = 0;
    s.turretAngle = 0; // プレイヤーは真横
    const bullets: Bullet[] = [];
    runFrames(s, bullets, stage, rng, 8); // 弾を更新しない＝最初の弾が生き続ける
    expect(bullets.length).toBe(1);
  });
});
