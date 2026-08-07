/**
 * 弾の跳弾（反射）・反射上限・相殺のテスト。
 * 盤面：5×5（タイル32px）。内側の床は x,y ∈ [32,128]、右外周壁は x ∈ [128,160]。
 */
import { describe, expect, it } from "vitest";
import { resolveBulletVsBullet, updateBullet } from "../src/core/bullet";
import { FLOOR_5X5, makeBullet, makeStage } from "./helpers";

const stage = makeStage(FLOOR_5X5);

describe("跳弾（入射角＝反射角）", () => {
  it("壁に当たると該当軸の速度が反転し、反射回数が1増える", () => {
    // 右壁（x=128）へ向けて水平に飛ぶ弾。dt=0.05 で 130 まで進み衝突する
    const b = makeBullet({ x: 120, y: 80, vx: 200, vy: 0 });
    updateBullet(b, 0.05, stage);
    expect(b.vx).toBe(-200); // X軸速度が反転
    expect(b.vy).toBe(0); // Y軸速度は不変
    expect(b.bounces).toBe(1);
    expect(b.dead).toBe(false); // 反射上限1回以内なので生存
    expect(b.x).toBeLessThanOrEqual(124); // 壁の外へ押し戻されている（128 - 半径4）
  });

  it("角で同フレームに両軸が反射しても反射回数は1回と数える", () => {
    // 右上の角へ 45° で突入：X軸で右壁、Y軸で上壁に同フレームで衝突する
    const b = makeBullet({ x: 124, y: 38, vx: 200, vy: -200 });
    updateBullet(b, 0.05, stage);
    expect(b.vx).toBe(-200); // 両軸とも反転
    expect(b.vy).toBe(200);
    expect(b.bounces).toBe(1); // 同時反射は1回カウント
    expect(b.dead).toBe(false);
  });

  it("反射上限を超えると消滅する（2回目の壁接触）", () => {
    const b = makeBullet({ x: 120, y: 80, vx: 200, vy: 0, bounces: 1 });
    updateBullet(b, 0.05, stage);
    expect(b.bounces).toBe(2);
    expect(b.dead).toBe(true);
  });

  it("壁に触れないフレームでは直進するだけで反射しない", () => {
    const b = makeBullet({ x: 80, y: 80, vx: 200, vy: 0 });
    updateBullet(b, 0.05, stage);
    expect(b.x).toBeCloseTo(90);
    expect(b.bounces).toBe(0);
    expect(b.dead).toBe(false);
  });
});

describe("弾同士の相殺", () => {
  it("接触した2発は両方消滅する", () => {
    const b1 = makeBullet({ x: 100, y: 100 });
    const b2 = makeBullet({ x: 105, y: 100 }); // 距離5 < 半径和8
    resolveBulletVsBullet([b1, b2]);
    expect(b1.dead).toBe(true);
    expect(b2.dead).toBe(true);
  });

  it("離れている弾は消滅しない", () => {
    const b1 = makeBullet({ x: 100, y: 100 });
    const b2 = makeBullet({ x: 120, y: 100 }); // 距離20 > 半径和8
    resolveBulletVsBullet([b1, b2]);
    expect(b1.dead).toBe(false);
    expect(b2.dead).toBe(false);
  });
});
