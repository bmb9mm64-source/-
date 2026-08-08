/**
 * 跳弾狙撃の反射点を毎フレーム計算し直さないこと（GDD §6 v0.23・§14 の E1）のテスト。
 *
 * 反射点の探索は1回あたり最大4候補×2本の射線判定と重く、固定砲台が毎フレーム呼ぶと
 * 射線判定の呼び出しの大半がここ由来になっていた。そこで
 *   ・RICOCHET_RECALC_INTERVAL ごとに計算し直し、間は前回の結果を使い回す
 *   ・標的が RICOCHET_RETARGET_DIST 以上動いたら間隔を待たず引き直す
 *   ・跳弾狙撃をやめたら結果を捨てる（次に必要になったら即座に計算する）
 * という約束にした。ここではその3点を機械的に確かめる。
 *
 * 「使い回している」ことはオブジェクトの同一性（toBe）で見る。値が同じでも
 * 計算し直していれば別オブジェクトになるため、呼び出し回数を数えなくても判別できる。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { Bullet } from "../src/core/bullet";
import { createReflector, type ReflectorUpdateContext, updateReflector } from "../src/core/reflector";
import { makeStage } from "./helpers";

/** 中央の縦壁で直接射線が塞がれ、外周壁の反射なら届く盤面 */
const stage = makeStage([
  "##########",
  "#........#",
  "#........#",
  "#....#...#",
  "#....#...#",
  "#....#...#",
  "#P...#...#",
  "##########",
]);

const R = BALANCE.TURRET;
const HALF = R.RICOCHET_RECALC_INTERVAL / 2;

/** 壁の右側に置いた砲台（左側の標的へは直接射線が通らない） */
function readyTurret() {
  const e = createReflector(240, 144, () => 0.5);
  e.state = "AIM";
  e.fireTimer = 999; // 撃たせない（撃つと跳弾狙撃をやめてしまうため）
  return e;
}

function ctx(px: number, py: number): ReflectorUpdateContext {
  return {
    players: [{ x: px, y: py, alive: true }],
    bullets: [] as Bullet[],
    stage,
    grace: 0,
    rng: () => 0.5,
  };
}

describe("跳弾狙撃の反射点は毎フレーム計算し直さない", () => {
  it("最初のフレームで反射点を求める", () => {
    const e = readyTurret();
    updateReflector(e, HALF, ctx(48, 208));
    expect(e.ricochetShot, "直接射線が無いので反射点を探しているはず").not.toBeNull();
  });

  it("間隔の内側では前回の結果を使い回す（同じオブジェクトのまま）", () => {
    const e = readyTurret();
    updateReflector(e, HALF, ctx(48, 208));
    const first = e.ricochetShot;
    updateReflector(e, HALF / 2, ctx(50, 208)); // 標的が少し動いても引き直さない
    expect(e.ricochetShot).toBe(first);
  });

  it("間隔を過ぎたら計算し直す（別オブジェクトになる）", () => {
    const e = readyTurret();
    updateReflector(e, HALF, ctx(48, 208));
    const first = e.ricochetShot;
    updateReflector(e, R.RICOCHET_RECALC_INTERVAL, ctx(48, 208));
    expect(e.ricochetShot).not.toBe(first);
    expect(e.ricochetShot).not.toBeNull(); // 同じ狙いなので結果自体は成立したまま
  });

  it("標的が大きく動いたら間隔を待たずに計算し直す", () => {
    const e = readyTurret();
    updateReflector(e, HALF, ctx(48, 208));
    const first = e.ricochetShot;
    const far = 48 + R.RICOCHET_RETARGET_DIST;
    updateReflector(e, HALF / 2, ctx(far, 208));
    expect(e.ricochetShot).not.toBe(first);
  });

  it("直接射線が通る位置へ移ったら使い回しの結果を捨てる", () => {
    const e = readyTurret();
    updateReflector(e, HALF, ctx(48, 208));
    expect(e.ricochetShot).not.toBeNull();
    updateReflector(e, HALF, ctx(240, 208)); // 砲台と同じ列＝壁を挟まない
    expect(e.ricochetShot, "跳弾狙撃をやめたら捨てる").toBeNull();
    expect(e.ricochetRecalcTimer, "次に必要になったら即座に計算する").toBe(0);
  });
});
