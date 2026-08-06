/**
 * ゲームワールド — MVP 全体（ミッション進行・戦車・弾・地雷・敵AI 2種）の
 * ゲーム状態と更新ロジック（Phaser 非依存の純粋 TS）。
 * シーン（Phaser 側）は入力を渡して結果を描画・発音するだけの薄い層にする（CLAUDE.md 規約）。
 *
 * 進行（GDD §8）：banner（「MISSION n」2秒表示）→ playing（開始後1秒は敵射撃グレース）
 *   → 全滅でクリア → 次ミッションの banner → … → 最終ミッションクリアで allclear。
 *   被弾で残機-1し現ミッションを banner からやり直し。残機0で gameover。
 *   残機・撃破数はミッションをまたいで持ち越す（撃破数は累積）。
 *
 * ローカル2P協力（GDD §12.5）：
 *   - players は 1〜2 人。弾5発・地雷2個の上限はプレイヤーごとに独立（owner 単位のカウント）。
 *   - 残機は共有。被弾したプレイヤーはそのミッション中退場（alive=false）し、
 *     全員退場した時点で残機-1＋現ミッションをリセット。片方生存のままクリアすれば
 *     次ミッションで全員復帰（loadMission が全員を作り直す）。
 *   - 2P の初期位置は GDD 未記載のため P1 の隣接床タイル（stage.findNearbyFloor の暫定解釈）。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, bulletHitsTank, resolveBulletVsBullet, updateBullet } from "./bullet";
import { tryFire } from "./firing";
import { idlePlayerInput, type PlayerInput } from "./input";
import { type Rng, rotateToward } from "./mathUtils";
import { type Explosion, type Mine, tryPlaceMine, updateMines } from "./mine";
import { createRover, type RoverTank, updateRover } from "./rover";
import { createSentry, type SentryTank, updateSentry } from "./sentry";
import { findNearbyFloor, type ParsedStage, parseStage } from "./stage";
import { moveTank } from "./tank";
import type { PlayerTank } from "./types";

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
  | "playerHit" // プレイヤー被弾（2P では被弾した人数ぶん発生）
  | "minePlaced" // 地雷設置
  | "mineExploded" // 地雷起爆
  | "missionClear" // ミッションクリア
  | "gameOver" // ゲームオーバー
  | "allClear"; // 全ミッションクリア

function createPlayer(x: number, y: number, index: number): PlayerTank {
  return {
    kind: "player",
    index,
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
  readonly playerCount: number; // 1（従来）または 2（ローカル協力。GDD §12.5）
  missionIndex = 0;
  stage!: ParsedStage; // 現ミッションの盤面（X 破壊で書き換わるためミッション開始ごとに再解析）
  stageVersion = 0; // 盤面の描画キャッシュ更新用（ミッション切替・X 破壊で増える）
  status: GameStatus = "banner";
  bannerTimer = 0; // 「MISSION n」表示の残り時間 [s]
  lives: number = BALANCE.GAME.LIVES; // 残機（2P でも共有。GDD §12.5）
  kills = 0; // 撃破数（累積。ミッション・被弾をまたいで持ち越し）
  grace: number = BALANCE.GAME.START_GRACE; // 敵が撃たない残り時間 [s]
  players: PlayerTank[] = [];
  enemies: EnemyTank[] = [];
  bullets: Bullet[] = [];
  mines: Mine[] = [];
  events: WorldEvent[] = []; // 直近の update で起きた出来事
  lastExplosions: Explosion[] = []; // 直近の update で起きた爆発の座標（演出用）

  private readonly rng: Rng;

  constructor(missions: readonly MissionDef[], rng: Rng = Math.random, playerCount = 1) {
    if (missions.length === 0) throw new Error("ミッションが1つもありません");
    this.missions = missions;
    this.rng = rng;
    this.playerCount = Math.min(Math.max(1, Math.floor(playerCount)), BALANCE.GAME.MAX_PLAYERS);
    this.resetGame();
  }

  /** 1P（後方互換用の別名。1人プレイのコード・テストはこれを参照してよい） */
  get player(): PlayerTank {
    return this.players[0]!;
  }

  /** 指定ミッションを読み込み、「MISSION n」バナー状態から開始する。全プレイヤーが復帰する */
  loadMission(index: number): void {
    this.missionIndex = index;
    const def = this.missions[index]!;
    // 盤面サイズはデータから自動判定（正規サイズの検証は missions のテストで行う）
    this.stage = parseStage(def.grid, {
      cols: def.grid[0]!.length,
      rows: def.grid.length,
    });
    this.stageVersion++;
    // P1 はステージの P、2P 以降は隣接床タイルに湧く（GDD §12.5 未記載の暫定解釈）
    this.players = [];
    let spawn = this.stage.playerSpawn;
    for (let i = 0; i < this.playerCount; i++) {
      if (i > 0) spawn = findNearbyFloor(this.stage, this.stage.playerSpawn);
      this.players.push(createPlayer(spawn.x, spawn.y, i));
    }
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

  /**
   * 全プレイヤー退場：残機-1（残機は共有。GDD §12.5）。
   * 0でゲームオーバー、残っていれば現ミッションをやり直し（全員復帰）。
   */
  private onAllPlayersDown(): void {
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

  /**
   * 1フレーム分の更新（dt は秒。フレームレート非依存）。
   * inputs はプレイヤー番号順（[0]=1P、[1]=2P）。不足分は入力なしとして扱う。
   */
  update(dt: number, inputs: readonly PlayerInput[]): void {
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

    // --- グレースタイマー ---
    if (this.grace > 0) this.grace -= dt;

    // --- プレイヤー入力の処理（退場中のプレイヤーは受け付けない） ---
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      if (!p.alive) continue;
      const input = inputs[i] ?? idlePlayerInput();

      // 移動（8方向・斜めは正規化）。他プレイヤー・敵は通り抜け不可（GDD §5.5）
      const mx = input.moveX;
      const my = input.moveY;
      if (mx !== 0 || my !== 0) {
        const len = Math.hypot(mx, my); // 斜め入力の速度正規化
        const dx = (mx / len) * BALANCE.PLAYER.SPEED * dt;
        const dy = (my / len) * BALANCE.PLAYER.SPEED * dt;
        const blockers = [...this.players.filter((o) => o !== p), ...this.enemies];
        moveTank(p, dx, dy, blockers, this.stage);
        // 車体を移動方向へ滑らかに回転（演出。移動速度には影響しない）
        const moveAngle = Math.atan2(my, mx);
        p.bodyAngle = rotateToward(p.bodyAngle, moveAngle, BALANCE.PLAYER.BODY_TURN_SPEED * dt);
      }

      // 砲塔照準（GDD §3・§12.5。方式は PlayerAim を参照）
      const aim = input.aim;
      if (aim.mode === "cursor") {
        p.turretAngle = Math.atan2(aim.y - p.y, aim.x - p.x); // マウス：即時追従
      } else if (aim.mode === "angle") {
        p.turretAngle = aim.instant
          ? aim.angle // パッド右スティック：傾けた方向へ即応
          : rotateToward(p.turretAngle, aim.angle, BALANCE.PLAYER.TURRET_TURN_SPEED_KEYS * dt); // IJKL：回転追従
      } // "none"：現在の向きを維持

      // 射撃（1押下1発。弾上限はプレイヤーごとに独立＝owner 単位）
      if (p.cooldown > 0) p.cooldown -= dt;
      if (input.fire) {
        const fired = tryFire(p, this.bullets, p.turretAngle, {
          fireInterval: BALANCE.PLAYER.FIRE_INTERVAL,
          maxBullets: BALANCE.PLAYER.MAX_BULLETS,
        });
        if (fired) this.events.push("fire");
      }

      // 地雷設置（同時2個まで。上限はプレイヤーごとに独立＝owner 単位）
      if (input.placeMine) {
        if (tryPlaceMine(this.mines, p) !== null) this.events.push("minePlaced");
      }
    }

    // --- 敵AI（発射数は前後差分で数えて効果音イベントにする） ---
    const bulletsBeforeAI = this.bullets.length;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.kind === "sentry") {
        updateSentry(e, dt, {
          players: this.players,
          bullets: this.bullets,
          stage: this.stage,
          grace: this.grace,
          rng: this.rng,
        });
      } else {
        updateRover(e, dt, {
          players: this.players,
          bullets: this.bullets,
          blockers: [...this.players, ...this.enemies.filter((o) => o !== e)],
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

    // --- 被弾検出用スナップショット（地雷・弾での死亡をまとめて差分で数える） ---
    const playersAliveBefore = this.players.map((p) => p.alive);

    // --- 地雷（起爆・誘爆・爆風による戦車/弾/X壁の破壊） ---
    const enemiesAliveBefore = this.enemiesLeft();
    const mineResult = updateMines(
      this.mines,
      dt,
      [...this.players, ...this.enemies],
      this.bullets,
      this.stage,
    );
    for (let i = 0; i < mineResult.explosions.length; i++) this.events.push("mineExploded");
    this.lastExplosions = mineResult.explosions;
    if (mineResult.wallsDestroyed > 0) this.stageVersion++; // 盤面が変わった（描画更新用）
    this.mines = this.mines.filter((m) => !m.dead);

    // --- 弾 vs 戦車（弾は発射者を問わず全戦車に当たる＝フレンドリーファイアあり。GDD §5・§12.5） ---
    for (const b of this.bullets) {
      if (b.dead) continue;
      let consumed = false;
      for (const p of this.players) {
        if (p.alive && bulletHitsTank(b, p)) {
          b.dead = true;
          p.alive = false; // 被弾したプレイヤーはそのミッション中退場
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
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

    // --- プレイヤー被弾イベント（このフレームで倒れた人数ぶん） ---
    for (let i = 0; i < this.players.length; i++) {
      if (playersAliveBefore[i] && !this.players[i]!.alive) this.events.push("playerHit");
    }

    // --- 勝敗判定（全員退場を優先処理。片方生存なら続行。GDD §12.5） ---
    if (!this.players.some((p) => p.alive)) {
      this.onAllPlayersDown();
      return;
    }
    if (enemiesAliveAfter === 0) {
      if (this.missionIndex + 1 >= this.missions.length) {
        this.status = "allclear"; // 全ミッションクリア
        this.events.push("allClear");
      } else {
        this.events.push("missionClear");
        this.loadMission(this.missionIndex + 1); // 次ミッションのバナーへ（退場者も復帰）
      }
    }
  }
}
