/**
 * ゲームワールド — MVP 全体（ミッション進行・戦車・弾・地雷・敵AI 2種）の
 * ゲーム状態と更新ロジック（Phaser 非依存の純粋 TS）。
 * シーン（Phaser 側）は入力を渡して結果を描画・発音するだけの薄い層にする（CLAUDE.md 規約）。
 *
 * 進行（GDD §8）：banner（「MISSION n」2秒表示）→ playing（開始後1秒は敵射撃グレース）
 *   → 全滅でクリア → 次ミッションの banner → … → 最終ミッションクリアで allclear。
 *   被弾で残機-1し現ミッションを banner からやり直し。残機0で gameover。
 *   残機・撃破数はミッションをまたいで持ち越す（撃破数は累積）。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, bulletHitsTank, resolveBulletVsBullet, updateBullet } from "./bullet";
import { tryFire } from "./firing";
import { type Rng, rotateToward } from "./mathUtils";
import { type Explosion, type Mine, tryPlaceMine, updateMines } from "./mine";
import { createRover, type RoverTank, updateRover } from "./rover";
import { createSentry, type SentryTank, updateSentry } from "./sentry";
import { type ParsedStage, parseStage } from "./stage";
import { moveTank } from "./tank";
import type { PlayerTank } from "./types";

/** 1フレーム分のプレイヤー入力（シーンから渡す） */
export interface WorldInput {
  moveX: number; // -1 / 0 / +1（A・D）
  moveY: number; // -1 / 0 / +1（W・S）
  aimX: number; // 照準位置（ワールド座標 px）
  aimY: number;
  fire: boolean; // このフレームに発射要求があるか（1クリック1発）
  placeMine: boolean; // このフレームに地雷設置要求があるか（1押下1設置）
}

/** ワールドの進行状態（ポーズはシーン側の責務なので含まない） */
export type GameStatus = "banner" | "playing" | "gameover" | "allclear";

/** 敵戦車（セントリー／ローバー） */
export type EnemyTank = SentryTank | RoverTank;

/** ミッション定義（src/stages/missions.ts の要素と互換） */
export interface MissionDef {
  name: string;
  grid: readonly string[];
}

/** 1フレーム中に起きた出来事（シーンが効果音・演出に使う） */
export type WorldEvent =
  | "fire" // 射撃（プレイヤー・敵共通）
  | "bounce" // 跳弾反射
  | "cancel" // 弾同士の相殺
  | "tankDestroyed" // 敵戦車の撃破
  | "playerHit" // プレイヤー被弾
  | "minePlaced" // 地雷設置
  | "mineExploded" // 地雷起爆
  | "missionClear" // ミッションクリア
  | "gameOver" // ゲームオーバー
  | "allClear"; // 全ミッションクリア

function createPlayer(x: number, y: number): PlayerTank {
  return {
    kind: "player",
    x,
    y,
    bodyAngle: 0,
    turretAngle: 0,
    half: BALANCE.PLAYER.SIZE / 2,
    radius: BALANCE.PLAYER.RADIUS,
    cooldown: 0,
    alive: true,
  };
}

/** ゲームワールド */
export class GameWorld {
  readonly missions: readonly MissionDef[];
  missionIndex = 0;
  stage!: ParsedStage; // 現ミッションの盤面（X 破壊で書き換わるためミッション開始ごとに再解析）
  stageVersion = 0; // 盤面の描画キャッシュ更新用（ミッション切替・X 破壊で増える）
  status: GameStatus = "banner";
  bannerTimer = 0; // 「MISSION n」表示の残り時間 [s]
  lives: number = BALANCE.GAME.LIVES;
  kills = 0; // 撃破数（累積。ミッション・被弾をまたいで持ち越し）
  grace: number = BALANCE.GAME.START_GRACE; // 敵が撃たない残り時間 [s]
  player!: PlayerTank;
  enemies: EnemyTank[] = [];
  bullets: Bullet[] = [];
  mines: Mine[] = [];
  events: WorldEvent[] = []; // 直近の update で起きた出来事
  lastExplosions: Explosion[] = []; // 直近の update で起きた爆発の座標（演出用）

  private readonly rng: Rng;

  constructor(missions: readonly MissionDef[], rng: Rng = Math.random) {
    if (missions.length === 0) throw new Error("ミッションが1つもありません");
    this.missions = missions;
    this.rng = rng;
    this.resetGame();
  }

  /** 指定ミッションを読み込み、「MISSION n」バナー状態から開始する */
  loadMission(index: number): void {
    this.missionIndex = index;
    const def = this.missions[index]!;
    // 盤面サイズはデータから自動判定（正規サイズの検証は missions のテストで行う）
    this.stage = parseStage(def.grid, {
      cols: def.grid[0]!.length,
      rows: def.grid.length,
    });
    this.stageVersion++;
    this.player = createPlayer(this.stage.playerSpawn.x, this.stage.playerSpawn.y);
    this.enemies = [
      ...this.stage.sentrySpawns.map((sp) => createSentry(sp.x, sp.y, this.rng)),
      ...this.stage.roverSpawns.map((sp) => createRover(sp.x, sp.y, this.rng)),
    ];
    this.bullets = [];
    this.mines = [];
    this.grace = BALANCE.GAME.START_GRACE;
    this.status = "banner";
    this.bannerTimer = BALANCE.GAME.BANNER_TIME;
  }

  /** ゲーム全体を最初からやり直す（Rキー・ゲームオーバー後の再開） */
  resetGame(): void {
    this.lives = BALANCE.GAME.LIVES;
    this.kills = 0;
    this.loadMission(0);
  }

  /** プレイヤー被弾：残機-1。0でゲームオーバー、残っていれば現ミッションをやり直し */
  private onPlayerHit(): void {
    this.events.push("playerHit");
    this.lives--;
    if (this.lives <= 0) {
      this.status = "gameover";
      this.events.push("gameOver");
    } else {
      this.loadMission(this.missionIndex); // 残機・撃破数は維持（GDD §8）
    }
  }

  /** 生存している敵の数 */
  enemiesLeft(): number {
    return this.enemies.filter((e) => e.alive).length;
  }

  /** 1フレーム分の更新（dt は秒。フレームレート非依存） */
  update(dt: number, input: WorldInput): void {
    this.events = [];
    this.lastExplosions = [];

    // --- 「MISSION n」バナー表示中（GDD §8：2秒表示→開始） ---
    if (this.status === "banner") {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.status = "playing";
        this.grace = BALANCE.GAME.START_GRACE; // 開始後1秒は敵が撃たない
      }
      return;
    }
    if (this.status !== "playing") return;

    const p = this.player;

    // --- グレースタイマー ---
    if (this.grace > 0) this.grace -= dt;

    // --- プレイヤー移動（8方向・斜めは正規化） ---
    const mx = input.moveX;
    const my = input.moveY;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my); // 斜め入力の速度正規化
      const dx = (mx / len) * BALANCE.PLAYER.SPEED * dt;
      const dy = (my / len) * BALANCE.PLAYER.SPEED * dt;
      moveTank(p, dx, dy, this.enemies, this.stage);
      // 車体を移動方向へ滑らかに回転（演出。移動速度には影響しない）
      const moveAngle = Math.atan2(my, mx);
      p.bodyAngle = rotateToward(p.bodyAngle, moveAngle, BALANCE.PLAYER.BODY_TURN_SPEED * dt);
    }

    // --- 砲塔照準（マウスへ常時追従）と射撃 ---
    p.turretAngle = Math.atan2(input.aimY - p.y, input.aimX - p.x);
    if (p.cooldown > 0) p.cooldown -= dt;
    if (input.fire) {
      // 1クリック1発（条件を満たさなければ不発）
      const fired = tryFire(p, this.bullets, p.turretAngle, {
        fireInterval: BALANCE.PLAYER.FIRE_INTERVAL,
        maxBullets: BALANCE.PLAYER.MAX_BULLETS,
      });
      if (fired) this.events.push("fire");
    }

    // --- 地雷設置（スペース／右クリック。同時2個まで） ---
    if (input.placeMine) {
      if (tryPlaceMine(this.mines, p) !== null) this.events.push("minePlaced");
    }

    // --- 敵AI（発射数は前後差分で数えて効果音イベントにする） ---
    const bulletsBeforeAI = this.bullets.length;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.kind === "sentry") {
        updateSentry(e, dt, {
          player: p,
          bullets: this.bullets,
          stage: this.stage,
          grace: this.grace,
          rng: this.rng,
        });
      } else {
        updateRover(e, dt, {
          player: p,
          bullets: this.bullets,
          blockers: [p, ...this.enemies.filter((o) => o !== e)],
          stage: this.stage,
          grace: this.grace,
          rng: this.rng,
        });
      }
    }
    for (let i = this.bullets.length - bulletsBeforeAI; i > 0; i--) this.events.push("fire");

    // --- 弾の移動と跳弾（反射回数が増えたら反射イベント） ---
    for (const b of this.bullets) {
      if (b.dead) continue;
      const prevBounces = b.bounces;
      updateBullet(b, dt, this.stage);
      if (b.bounces > prevBounces) this.events.push("bounce");
    }

    // --- 弾同士の相殺（消えた数の前後差分から相殺回数＝2発1組を数える） ---
    const aliveBulletsBefore = this.bullets.filter((b) => !b.dead).length;
    resolveBulletVsBullet(this.bullets);
    const cancelledCount = aliveBulletsBefore - this.bullets.filter((b) => !b.dead).length;
    for (let i = 0; i < cancelledCount; i += 2) this.events.push("cancel");

    // --- 地雷（起爆・誘爆・爆風による戦車/弾/X壁の破壊） ---
    const enemiesAliveBefore = this.enemiesLeft();
    const mineResult = updateMines(this.mines, dt, [p, ...this.enemies], this.bullets, this.stage);
    for (let i = 0; i < mineResult.explosions.length; i++) this.events.push("mineExploded");
    this.lastExplosions = mineResult.explosions;
    if (mineResult.wallsDestroyed > 0) this.stageVersion++; // 盤面が変わった（描画更新用）
    this.mines = this.mines.filter((m) => !m.dead);

    // --- 弾 vs 戦車 ---
    let playerWasHit = !p.alive; // 爆風で既に倒れている場合
    for (const b of this.bullets) {
      if (b.dead) continue;
      if (p.alive && bulletHitsTank(b, p)) {
        // 自分の弾でも当たる（自爆あり）
        b.dead = true;
        p.alive = false;
        playerWasHit = true;
        continue;
      }
      for (const e of this.enemies) {
        if (e.alive && bulletHitsTank(b, e)) {
          b.dead = true;
          e.alive = false; // 耐久1：即撃破
          break;
        }
      }
    }

    // --- 消滅した弾を配列から除去 ---
    this.bullets = this.bullets.filter((b) => !b.dead);

    // --- 撃破数の集計（弾・爆風の両方をまとめて前後差分で数える） ---
    const enemiesAliveAfter = this.enemiesLeft();
    const killed = enemiesAliveBefore - enemiesAliveAfter;
    this.kills += killed;
    for (let i = 0; i < killed; i++) this.events.push("tankDestroyed");

    // --- 勝敗判定（被弾を優先処理） ---
    if (playerWasHit) {
      this.onPlayerHit();
      return;
    }
    if (enemiesAliveAfter === 0) {
      if (this.missionIndex + 1 >= this.missions.length) {
        this.status = "allclear"; // 全ミッションクリア
        this.events.push("allClear");
      } else {
        this.events.push("missionClear");
        this.loadMission(this.missionIndex + 1); // 次ミッションのバナーへ
      }
    }
  }
}
