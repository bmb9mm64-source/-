/**
 * 自滅・同士討ちの禁止（GDD §5.2 v0.12）と砲口位置の壁補正（GDD §5.3 v0.12）の回帰テスト。
 * レビューで判明した2種類の「自滅」を再発させないための守り：
 *   ① プレイヤーが壁際で撃つと自弾が壁内に湧いて即死する
 *   ② 敵が自分の弾・味方の地雷で勝手に全滅し、無操作でミッションがクリアされる
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { type Bullet, spawnBullet, updateBullet } from "../src/core/bullet";
import { type Mine, type MineTarget, tryPlaceMine, updateMines } from "../src/core/mine";
import { idlePlayerInput } from "../src/core/input";
import { GameWorld } from "../src/core/world";
import { makeBullet, makeStage } from "./helpers";

const ROOM = [
  "##########",
  "#P.......#",
  "#........#",
  "#........#",
  "#........#",
  "##########",
];

/** 敵1体のミッション（プレイヤーは左上、敵は右下） */
const ONE_ENEMY = [
  "#########################",
  "#P.......................#".slice(0, 25),
  ...Array.from({ length: 13 }, () => "#.......................#"),
  "#....................A..#",
  "#########################",
];

describe("砲口位置の壁補正（GDD §5.3）", () => {
  it("壁に密着して壁の方向へ撃っても、弾は壁の内部に生成されない", () => {
    const stage = makeStage(ROOM);
    const px = 32 + BALANCE.PLAYER.SIZE / 2; // 左壁に密着した中心 x=46
    const py = 3 * 32;
    const bullets: Bullet[] = [];
    const b = spawnBullet(bullets, { x: px, y: py, kind: "player" }, Math.PI, BALANCE.BULLET, stage);
    expect(b.x).toBeGreaterThanOrEqual(32 + b.radius - 1); // 壁（x<32）の外側にある
  });

  it("壁に密着して撃っても即死しない（世界レベル：残機が減らない）", () => {
    // 左壁に密着した状態で真左へ撃つ。修正前は同一フレームで自弾に当たり残機が減っていた
    const world = new GameWorld([{ name: "t", grid: ONE_ENEMY }]);
    world.update(2.1, [idlePlayerInput()]);
    const p = world.player;
    p.x = 32 + BALANCE.PLAYER.SIZE / 2; // 左壁に密着
    p.turretAngle = Math.PI; // 真左（壁の方向）
    const livesBefore = world.lives;
    for (let i = 0; i < 30; i++) {
      world.update(1 / 60, [{ ...idlePlayerInput(), fire: i === 0 }]);
    }
    expect(world.lives).toBe(livesBefore);
    expect(p.alive).toBe(true);
  });

  it("真上に撃った弾が横方向へ瞬間移動しない（速度ゼロ軸の押し戻し防止）", () => {
    const stage = makeStage(ROOM);
    const px = 5 * 32;
    const py = 32 + BALANCE.PLAYER.SIZE / 2; // 天井に密着
    const bullets: Bullet[] = [];
    const b = spawnBullet(bullets, { x: px, y: py, kind: "player" }, -Math.PI / 2, BALANCE.BULLET, stage);
    const x0 = b.x;
    for (let i = 0; i < 5; i++) updateBullet(b, 1 / 60, stage);
    expect(Math.abs(b.x - x0)).toBeLessThan(1); // 横ズレなし
  });
});

describe("敵の自滅・同士討ちの禁止（GDD §5.2）", () => {
  const enemyTank = (): MineTarget & { kind: string } => ({
    x: 100,
    y: 100,
    radius: 14,
    alive: true,
    kind: "rover",
  });

  it("敵の弾は敵に当たらない（自弾自爆・同士討ちとも発生しない）", () => {
    const world = new GameWorld([{ name: "t", grid: ONE_ENEMY }]);
    world.update(2.1, [idlePlayerInput()]); // バナー消化
    const e = world.enemies[0]!;
    world.bullets.push(makeBullet({ x: e.x, y: e.y, ownerIsPlayer: false }));
    world.update(0.016, [idlePlayerInput()]);
    expect(e.alive).toBe(true); // 敵弾では倒れない
    expect(world.kills).toBe(0);
  });

  it("プレイヤーの弾は従来どおり敵に当たる", () => {
    const world = new GameWorld([{ name: "t", grid: ONE_ENEMY }]);
    world.update(2.1, [idlePlayerInput()]);
    const e = world.enemies[0]!;
    world.bullets.push(makeBullet({ x: e.x, y: e.y, ownerIsPlayer: true }));
    world.update(0.016, [idlePlayerInput()]);
    expect(e.alive).toBe(false);
  });

  it("敵が置いた地雷の時限爆発は、敵を巻き込まない（プレイヤーは巻き込む）", () => {
    const stage = makeStage(ROOM);
    const layer = { x: 48, y: 48, radius: 14, alive: true, kind: "minelayer" };
    const mines: Mine[] = [];
    tryPlaceMine(mines, layer);
    const otherEnemy = { ...enemyTank(), x: 60, y: 48 }; // 爆風圏内
    const player = { x: 70, y: 48, radius: 14, alive: true, kind: "player" }; // 爆風圏内
    layer.x = 300; // 設置者は離脱（時限起爆だけを見る）
    const res = updateMines(mines, 11, [layer, otherEnemy, player], [], stage);
    expect(res.explosions).toHaveLength(1);
    expect(otherEnemy.alive).toBe(true); // 味方の地雷では死なない
    expect(player.alive).toBe(false); // プレイヤーには効く
  });

  it("プレイヤーの弾で誘爆させた敵の地雷は、敵を巻き込む（戦術は維持）", () => {
    const stage = makeStage(ROOM);
    const layer = { x: 48, y: 48, radius: 14, alive: true, kind: "minelayer" };
    const mines: Mine[] = [];
    tryPlaceMine(mines, layer);
    layer.x = 300;
    const otherEnemy = { ...enemyTank(), x: 60, y: 48 };
    const playerBullet = makeBullet({ x: 50, y: 48, ownerIsPlayer: true }); // 地雷に接触
    const res = updateMines(mines, 0.016, [layer, otherEnemy], [playerBullet], stage);
    expect(res.explosions).toHaveLength(1);
    expect(otherEnemy.alive).toBe(false); // プレイヤー起因なので敵を破壊できる
  });

  it("プレイヤーが置いた地雷は、時限爆発でも敵を巻き込む", () => {
    const stage = makeStage(ROOM);
    const player = { x: 48, y: 48, radius: 14, alive: true, kind: "player" };
    const mines: Mine[] = [];
    tryPlaceMine(mines, player);
    player.x = 300; // 設置者は離脱
    const target = { ...enemyTank(), x: 60, y: 48 };
    const res = updateMines(mines, 11, [player, target], [], stage);
    expect(res.explosions).toHaveLength(1);
    expect(target.alive).toBe(false);
  });
});
