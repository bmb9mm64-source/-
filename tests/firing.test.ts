/**
 * 発射制御のテスト — 発射間隔（0.3s）と同時発射数上限（5発）。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { Bullet } from "../src/core/bullet";
import { type FireOptions, tryFire } from "../src/core/firing";

const OPTS: FireOptions = {
  fireInterval: BALANCE.PLAYER.FIRE_INTERVAL,
  maxBullets: BALANCE.PLAYER.MAX_BULLETS,
};

describe("発射制御", () => {
  it("発射に成功するとクールダウンが発射間隔に設定される", () => {
    const shooter = { x: 80, y: 80, cooldown: 0 };
    const bullets: Bullet[] = [];
    expect(tryFire(shooter, bullets, 0, OPTS)).toBe(true);
    expect(bullets).toHaveLength(1);
    expect(shooter.cooldown).toBeCloseTo(BALANCE.PLAYER.FIRE_INTERVAL);
  });

  it("クールダウン中は発射できない（発射間隔0.3s）", () => {
    const shooter = { x: 80, y: 80, cooldown: 0 };
    const bullets: Bullet[] = [];
    expect(tryFire(shooter, bullets, 0, OPTS)).toBe(true);
    expect(tryFire(shooter, bullets, 0, OPTS)).toBe(false); // 直後は不発
    expect(bullets).toHaveLength(1);
    shooter.cooldown = 0; // 間隔消化後は再発射できる
    expect(tryFire(shooter, bullets, 0, OPTS)).toBe(true);
    expect(bullets).toHaveLength(2);
  });

  it("場に自分の弾が5発あると6発目は撃てない", () => {
    const shooter = { x: 80, y: 80, cooldown: 0 };
    const bullets: Bullet[] = [];
    for (let i = 0; i < BALANCE.PLAYER.MAX_BULLETS; i++) {
      shooter.cooldown = 0;
      expect(tryFire(shooter, bullets, 0, OPTS)).toBe(true);
    }
    expect(bullets).toHaveLength(5);
    shooter.cooldown = 0;
    expect(tryFire(shooter, bullets, 0, OPTS)).toBe(false); // 6発目は不発
    expect(bullets).toHaveLength(5);
  });

  it("自分の弾が消滅すれば再び撃てる（他人の弾はカウントしない）", () => {
    const shooter = { x: 80, y: 80, cooldown: 0 };
    const other = { x: 100, y: 100, cooldown: 0 };
    const bullets: Bullet[] = [];
    for (let i = 0; i < BALANCE.PLAYER.MAX_BULLETS; i++) {
      shooter.cooldown = 0;
      tryFire(shooter, bullets, 0, OPTS);
    }
    // 他人の弾が場にあっても自分の上限には影響しない
    tryFire(other, bullets, 0, OPTS);
    expect(bullets).toHaveLength(6);
    shooter.cooldown = 0;
    expect(tryFire(shooter, bullets, 0, OPTS)).toBe(false);
    bullets[0]!.dead = true; // 自分の弾が1発消滅
    expect(tryFire(shooter, bullets, 0, OPTS)).toBe(true);
  });
});
