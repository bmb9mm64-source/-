/**
 * 跳弾狙撃（GDD §6 v0.4）のテスト。
 * 幾何（入射角＝反射角・遮蔽時の不成立）と、セントリーへの統合
 * （抽選20%・直接射線の優先・敵弾速225px/s）を検証する。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { Bullet } from "../src/core/bullet";
import { createSentry, updateSentry } from "../src/core/sentry";
import { findOuterWallRicochet } from "../src/core/ricochetAim";
import { makeStage } from "./helpers";

const T = 32;

/** 内側が全て床の 10×8 盤面 */
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

/**
 * 中央の縦壁で左右が完全に分断され、上下の外周反射も内壁で塞がれた盤面。
 * 左の部屋 (2,2)〜右の部屋 (7,2) の間は反射1回では届かない。
 */
const SEALED_10X8 = [
  "##########",
  "#P...#...#",
  "#....#...#",
  "#....#...#",
  "#....#...#",
  "#....#...#",
  "#....#...#",
  "##########",
];

describe("findOuterWallRicochet（幾何）", () => {
  it("開けた盤面で反射1回の射線が見つかり、反射点で入射角＝反射角が成り立つ", () => {
    const stage = makeStage(OPEN_10X8);
    const sx = 2.5 * T;
    const sy = 4 * T;
    const tx = 6.5 * T;
    const ty = 4 * T;
    const shot = findOuterWallRicochet(stage, sx, sy, tx, ty);
    expect(shot).not.toBeNull();
    const { px, py } = shot!;
    // 反射点は外周壁の内面（左右 x=T/(cols-1)T か 上下 y=T/(rows-1)T）近傍にある
    const onVertical = Math.abs(px - T) < 1 || Math.abs(px - 9 * T) < 1;
    const onHorizontal = Math.abs(py - T) < 1 || Math.abs(py - 7 * T) < 1;
    expect(onVertical || onHorizontal).toBe(true);
    // 入射角＝反射角：反射面に平行な成分の変化率が入射・反射で一致する
    if (onHorizontal) {
      const slopeIn = (px - sx) / (py - sy);
      const slopeOut = (tx - px) / (ty - py);
      expect(slopeIn).toBeCloseTo(-slopeOut, 3);
    } else {
      const slopeIn = (py - sy) / (px - sx);
      const slopeOut = (ty - py) / (tx - px);
      expect(slopeIn).toBeCloseTo(-slopeOut, 3);
    }
  });

  it("反射経路が壁で遮られる盤面では成立しない", () => {
    const stage = makeStage(SEALED_10X8);
    const shot = findOuterWallRicochet(stage, 2.5 * T, 4 * T, 7.5 * T, 4 * T);
    expect(shot).toBeNull();
  });
});

/**
 * セントリー統合テスト用の盤面：
 * 中央縦壁の下半分だけ壁（上は開いている）→ 直接射線は塞がれ、
 * 上外周壁での1回反射なら届く。
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

/** グレース明け・装填済みのセントリーを作る */
function readySentry(x: number, y: number, rng: () => number) {
  const s = createSentry(x, y, rng);
  s.state = "AIM";
  s.fireTimer = 0;
  return s;
}

function runFrames(
  s: ReturnType<typeof createSentry>,
  bullets: Bullet[],
  stage: ReturnType<typeof makeStage>,
  player: { x: number; y: number },
  rng: () => number,
  seconds: number,
): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    updateSentry(s, dt, { players: [{ ...player, alive: true }], bullets, stage, grace: 0, rng });
  }
}

describe("セントリーの跳弾狙撃（統合）", () => {
  const player = { x: 7.5 * T, y: 5 * T };
  const pos = { x: 2.5 * T, y: 5 * T };

  it("直接射線が塞がれていても、抽選成立（rng<難易度確率）なら外周反射で撃つ。敵弾速は225px/s", () => {
    const stage = makeStage(BLOCKED_MID_10X8);
    const rng = () => 0.1; // 抽選 0.1 < 0.75（NORMAL の跳弾狙撃確率。GDD §6 v0.9）→ 跳弾狙撃モード
    const s = readySentry(pos.x, pos.y, rng);
    const bullets: Bullet[] = [];
    runFrames(s, bullets, stage, player, rng, 5);
    expect(bullets.length).toBeGreaterThan(0);
    const b = bullets[0]!;
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(BALANCE.BULLET.ENEMY_BULLET_SPEED, 3);
    expect(b.vy).toBeLessThan(0); // 上の外周壁を狙って撃っている（上向き）
  });

  it("抽選に外れ続ける（rng≥難易度確率）と、直接射線が塞がれている間は一切撃たない", () => {
    const stage = makeStage(BLOCKED_MID_10X8);
    const rng = () => 0.9; // 抽選 0.9 >= 0.75（NORMAL）→ 通常照準のまま
    const s = readySentry(pos.x, pos.y, rng);
    const bullets: Bullet[] = [];
    runFrames(s, bullets, stage, player, rng, 5);
    expect(bullets.length).toBe(0);
  });

  it("直接射線があるときは抽選に関係なく通常射撃する（跳弾狙撃より優先）", () => {
    const stage = makeStage(OPEN_10X8);
    const rng = () => 0.1;
    const s = readySentry(pos.x, pos.y, rng);
    s.turretAngle = 0; // プレイヤーは真横（+X）：即座に許容角内
    const bullets: Bullet[] = [];
    runFrames(s, bullets, stage, { x: 7.5 * T, y: 5 * T }, rng, 1);
    expect(bullets.length).toBeGreaterThan(0);
    const b = bullets[0]!;
    expect(Math.abs(b.vy)).toBeLessThan(Math.abs(b.vx) * 0.2); // ほぼ真横＝プレイヤー方向
  });
});
