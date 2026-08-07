/**
 * レビューで見つかった同時成立まわりの回帰テスト（GDD §5・§8 v0.15）。
 *   ① 敵全滅とプレイヤー全員退場が同フレームなら、クリアを優先する
 *      （逆だとクリアが破棄され、加算済みの撃破数だけ残って二重計上できてしまう）
 *   ② 弾の相殺は「接触した2発」で完結する（1発が3発以上を巻き込まない）
 */
import { describe, expect, it } from "vitest";
import { type Bullet, resolveBulletVsBullet } from "../src/core/bullet";
import { idlePlayerInput } from "../src/core/input";
import { GameWorld } from "../src/core/world";
import { makeBullet } from "./helpers";

/** 敵1体の広間ミッション（M1相当・2面構成にして「次ミッションへ進む」ことを見る） */
function room(symbol: string, name: string): { name: string; grid: string[] } {
  const rows: string[] = ["#########################"];
  for (let r = 1; r <= 15; r++) {
    let row = "#.......................#";
    if (r === 3) row = "#.P.....................#";
    if (r === 12) row = `#..................${symbol}....#`;
    rows.push(row);
  }
  rows.push("#########################");
  return { name, grid: rows };
}

describe("敵全滅とプレイヤー全員退場の同時成立", () => {
  it("クリアを優先する：残機は減らず、次ミッションへ進む", () => {
    const world = new GameWorld([room("A", "m1"), room("A", "m2")]);
    world.update(2.1, [idlePlayerInput()]); // バナー消化
    const e = world.enemies[0]!;
    const p = world.player;
    const livesBefore = world.lives;
    // 同じフレームで「敵に当たるプレイヤー弾」と「プレイヤーに当たる敵弾」を置く
    world.bullets.push(makeBullet({ x: e.x, y: e.y, ownerIsPlayer: true }));
    world.bullets.push(makeBullet({ x: p.x, y: p.y, ownerIsPlayer: false }));
    world.update(1 / 60, [idlePlayerInput()]);

    expect(e.alive).toBe(false);
    expect(p.alive).toBe(false);
    expect(world.lives).toBe(livesBefore); // 残機は減らない（クリア優先）
    expect(world.missionIndex).toBe(1); // 次ミッションへ進んでいる
    expect(world.kills).toBe(1); // 撃破数は1のまま（やり直しによる二重計上がない）
    expect(world.clearedTimes[0]).not.toBeUndefined(); // クリアタイムも確定している
  });

  it("敵が残っていれば従来どおり全員退場で残機-1・同ミッションやり直し", () => {
    const world = new GameWorld([room("A", "m1"), room("A", "m2")]);
    world.update(2.1, [idlePlayerInput()]);
    const p = world.player;
    const livesBefore = world.lives;
    world.bullets.push(makeBullet({ x: p.x, y: p.y, ownerIsPlayer: false }));
    world.update(1 / 60, [idlePlayerInput()]);
    expect(world.lives).toBe(livesBefore - 1);
    expect(world.missionIndex).toBe(0);
  });
});

describe("弾の相殺は2発で完結する", () => {
  it("中央の弾に2発が重なっても、消えるのは接触した2発だけ", () => {
    const mk = (x: number): Bullet =>
      makeBullet({ x, y: 0, vx: 0, vy: 0, radius: 4, ownerIsPlayer: true });
    const a = mk(0);
    const c1 = mk(7); // a と接触（距離7 < 半径和8）
    const c2 = mk(-7); // a と接触するが c1 とは非接触（距離14）
    resolveBulletVsBullet([a, c1, c2]);
    expect(a.dead).toBe(true);
    expect(c1.dead).toBe(true);
    expect(c2.dead).toBe(false); // 3発目は巻き込まれない
  });

  it("2発だけの通常ケースは従来どおり両方消える", () => {
    const a = makeBullet({ x: 0, y: 0, radius: 4 });
    const b = makeBullet({ x: 5, y: 0, radius: 4 });
    resolveBulletVsBullet([a, b]);
    expect(a.dead).toBe(true);
    expect(b.dead).toBe(true);
  });
});
