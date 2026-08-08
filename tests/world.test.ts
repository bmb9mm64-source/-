/**
 * GameWorld のミッション進行のテスト（GDD §8）。
 * バナー2秒→開始、クリアで次ミッション、被弾で現ミッションリセット（残機持ち越し）、
 * 残機0でゲームオーバー、全ミッションクリアで allclear、撃破数の累積、地雷設置入力。
 * ※1人プレイのセマンティクス（挙動）は2P対応後も不変であることをここで担保する。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import type { PlayerInput } from "../src/core/input";
import { GameWorld, type MissionDef } from "../src/core/world";
import { makeBullet } from "./helpers";

const rngHalf = (): number => 0.5;

// テスト用の小さな2ミッション（サイズは自動判定される）
// P(1,1)=(48,48)・A(3,1)=(112,48)。5×3 の全周壁つき盤面
const MISSION_A: MissionDef = { name: "TEST-A", grid: ["#####", "#P.A#", "#####"] };
const MISSION_B: MissionDef = { name: "TEST-B", grid: ["#####", "#P.A#", "#####"] };
const MISSIONS2 = [MISSION_A, MISSION_B];

function idleInput(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    aim: { mode: "cursor", x: 48, y: 48 },
    fire: false,
    placeMine: false,
    ...overrides,
  };
}

/** バナー（2秒）を消化してプレイ状態にする */
function skipBanner(world: GameWorld): void {
  world.update(BALANCE.GAME.BANNER_TIME + 0.01, [idleInput()]);
  expect(world.status).toBe("playing");
}

/** 現ミッションの敵を弾で全滅させる（敵位置に弾を置いて1フレーム回す） */
function killAllEnemies(world: GameWorld): void {
  for (const e of world.enemies) {
    if (e.alive) world.bullets.push(makeBullet({ x: e.x, y: e.y, ownerIsPlayer: true }));
  }
  world.update(0.016, [idleInput()]);
}

describe("ミッション進行（GameWorld）", () => {
  it("開始直後は「MISSION n」バナーで、2秒経過後にプレイ開始・グレース1秒が始まる", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    expect(world.status).toBe("banner");
    expect(world.missionIndex).toBe(0);
    world.update(1.0, [idleInput()]);
    expect(world.status).toBe("banner"); // まだ1秒
    world.update(1.01, [idleInput()]);
    expect(world.status).toBe("playing");
    expect(world.grace).toBe(BALANCE.GAME.START_GRACE); // 開始後1秒は敵が撃たない
  });

  it("1人プレイでは players は1人だけで、player は players[0] を指す", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    expect(world.players).toHaveLength(1);
    expect(world.player).toBe(world.players[0]);
    expect(world.player.index).toBe(0);
  });

  it("敵を全滅させると次ミッションのバナーへ進み、撃破数が累積する", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    killAllEnemies(world);
    expect(world.events).toContain("missionClear");
    expect(world.status).toBe("banner"); // 次ミッションのバナー
    expect(world.missionIndex).toBe(1);
    expect(world.kills).toBe(1); // 撃破数は累積
    expect(world.lives).toBe(BALANCE.GAME.LIVES); // 残機は持ち越し
  });

  it("最終ミッションをクリアすると allclear になる", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    killAllEnemies(world); // M1 クリア
    skipBanner(world);
    killAllEnemies(world); // M2（最終）クリア
    expect(world.status).toBe("allclear");
    expect(world.events).toContain("allClear");
    expect(world.kills).toBe(2);
  });

  it("被弾すると残機-1で現ミッションをバナーからやり直す（撃破数は維持）", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    killAllEnemies(world); // M1 クリア（kills=1）
    skipBanner(world); // M2 開始
    world.bullets.push(makeBullet({ x: world.player.x, y: world.player.y }));
    world.update(0.016, [idleInput()]);
    expect(world.events).toContain("playerHit");
    expect(world.lives).toBe(BALANCE.GAME.LIVES - 1);
    expect(world.status).toBe("banner"); // 現ミッションのやり直し
    expect(world.missionIndex).toBe(1); // M1 には戻らない
    expect(world.kills).toBe(1); // 撃破数は維持
  });

  it("残機0でゲームオーバーになり、resetGame で M1・残機3・撃破0 に戻る", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    world.kills = 4;
    world.lives = 1;
    world.bullets.push(makeBullet({ x: world.player.x, y: world.player.y }));
    world.update(0.016, [idleInput()]);
    expect(world.status).toBe("gameover");
    expect(world.events).toContain("gameOver");
    world.resetGame(); // R またはクリック
    expect(world.status).toBe("banner");
    expect(world.missionIndex).toBe(0);
    expect(world.lives).toBe(BALANCE.GAME.LIVES);
    expect(world.kills).toBe(0);
  });

  it("バナー表示中はプレイヤー入力（移動・射撃・地雷）を受け付けない", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    const x0 = world.player.x;
    world.update(0.5, [idleInput({ moveX: 1, fire: true, placeMine: true })]);
    expect(world.status).toBe("banner");
    expect(world.player.x).toBe(x0);
    expect(world.bullets).toHaveLength(0);
    expect(world.mines).toHaveLength(0);
  });

  it("地雷設置入力で自位置に設置され、同時2個までに制限される", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    world.update(0.016, [idleInput({ placeMine: true })]);
    expect(world.events).toContain("minePlaced");
    world.update(0.016, [idleInput({ placeMine: true })]);
    world.update(0.016, [idleInput({ placeMine: true })]); // 3個目は不発
    expect(world.mines).toHaveLength(2);
    expect(world.mines[0]!.x).toBe(world.player.x);
  });

  it("C/D 入りミッション：スナイパー・マインレイヤーが生成され、全滅でクリアになる", () => {
    // C(3,1)=(112,48)・D(4,1)=(144,48) の1ミッション構成
    const missionCD: MissionDef = { name: "TEST-CD", grid: ["######", "#P.CD#", "######"] };
    const world = new GameWorld([missionCD], rngHalf);
    skipBanner(world);
    expect(world.enemies.map((e) => e.kind).sort()).toEqual(["minelayer", "sniper"]);
    expect(world.enemiesLeft()).toBe(2); // 敵残数に含まれる
    killAllEnemies(world);
    expect(world.status).toBe("allclear"); // 撃破がクリア判定に数えられる
    expect(world.kills).toBe(2); // 撃破数に計上される
  });

  it("マインレイヤーの地雷は世界の地雷リストに入り minePlaced イベントを発生させる", () => {
    // 中央縦壁で射線を遮った回廊。D(10,1)=(336,48) は rng=0.5 の徘徊目標 (6,2)=(208,80) へ
    // 移動して留まり、プレイヤー (48,48) から約163px ≥ 160px なので5秒後に敷設する
    const missionMine: MissionDef = {
      name: "TEST-MINE",
      grid: ["############", "#P...#....D#", "#....#.....#", "############"],
    };
    const world = new GameWorld([missionMine], rngHalf);
    skipBanner(world);
    let placedEvent = false;
    for (let i = 0; i < 130; i++) {
      world.update(0.05, [idleInput()]); // 6.5秒
      if (world.events.includes("minePlaced")) placedEvent = true;
    }
    expect(placedEvent).toBe(true); // 効果音イベントが出た
    expect(world.mines).toHaveLength(1); // 世界の地雷リストに入った（起爆・誘爆・描画の対象）
    expect(world.mines[0]!.owner).toBe(world.enemies[0]); // 設置者＝マインレイヤー（設置者除外の適用先）
    expect(world.player.alive).toBe(true); // 射線は遮られており撃たれていない
  });

  it("砲塔の角度指定照準：instant=true は即応、instant=false は回転追従する", () => {
    const world = new GameWorld(MISSIONS2, rngHalf);
    skipBanner(world);
    // 即応（パッド右スティック相当）
    world.update(0.016, [idleInput({ aim: { mode: "angle", angle: Math.PI / 2, instant: true } })]);
    expect(world.player.turretAngle).toBe(Math.PI / 2);
    // 回転追従（IJKL 相当）：1フレームでは目標まで届かず、途中の角度になる
    world.update(0.016, [idleInput({ aim: { mode: "angle", angle: -Math.PI / 2, instant: false } })]);
    const maxStep = BALANCE.PLAYER.TURRET_TURN_SPEED_KEYS * 0.016;
    expect(world.player.turretAngle).not.toBe(-Math.PI / 2);
    expect(Math.abs(world.player.turretAngle - Math.PI / 2)).toBeLessThanOrEqual(maxStep + 1e-9);
    // aim=none では現在の向きを維持する
    const before = world.player.turretAngle;
    world.update(0.016, [idleInput({ aim: { mode: "none" } })]);
    expect(world.player.turretAngle).toBe(before);
  });
});
