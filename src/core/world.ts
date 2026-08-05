/**
 * ゲームワールド — 1ステージ分のゲーム状態と更新ロジック（Phaser 非依存の純粋 TS）。
 * シーン（Phaser 側）は入力を渡して結果を描画するだけの薄い層にする（CLAUDE.md 規約）。
 * 更新順序は Phase 1 プロトタイプ（prototype/index.html の update()）と同一。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, bulletHitsTank, resolveBulletVsBullet, updateBullet } from "./bullet";
import { tryFire } from "./firing";
import { type Rng, rotateToward } from "./mathUtils";
import { createSentry, type SentryTank, updateSentry } from "./sentry";
import type { ParsedStage } from "./stage";
import { moveTank } from "./tank";
import type { PlayerTank } from "./types";

/** 1フレーム分のプレイヤー入力（シーンから渡す） */
export interface WorldInput {
  moveX: number; // -1 / 0 / +1（A・D）
  moveY: number; // -1 / 0 / +1（W・S）
  aimX: number; // 照準位置（ワールド座標 px）
  aimY: number;
  fire: boolean; // このフレームに発射要求があるか（1クリック1発）
}

/** ワールドの進行状態（ポーズはシーン側の責務なので含まない） */
export type GameStatus = "playing" | "clear" | "gameover";

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
  readonly stage: ParsedStage;
  status: GameStatus = "playing";
  lives: number = BALANCE.GAME.LIVES;
  grace: number = BALANCE.GAME.START_GRACE; // 敵が撃たない残り時間 [s]
  player!: PlayerTank;
  enemies: SentryTank[] = [];
  bullets: Bullet[] = [];

  private readonly rng: Rng;

  constructor(stage: ParsedStage, rng: Rng = Math.random) {
    this.stage = stage;
    this.rng = rng;
    this.resetGame();
  }

  /** ステージを初期状態に戻す（敵・弾・プレイヤー位置。残機は維持） */
  resetStage(): void {
    const s = this.stage;
    this.player = createPlayer(s.playerSpawn.x, s.playerSpawn.y);
    this.enemies = s.sentrySpawns.map((sp) => createSentry(sp.x, sp.y, this.rng));
    this.bullets = [];
    this.grace = BALANCE.GAME.START_GRACE;
  }

  /** ゲーム全体を最初からやり直す（Rキー） */
  resetGame(): void {
    this.lives = BALANCE.GAME.LIVES;
    this.status = "playing";
    this.resetStage();
  }

  /** プレイヤー被弾：残機-1。0でゲームオーバー、残っていればステージリセット */
  private onPlayerHit(): void {
    this.lives--;
    if (this.lives <= 0) {
      this.status = "gameover";
    } else {
      this.resetStage();
    }
  }

  /** 生存している敵の数 */
  enemiesLeft(): number {
    return this.enemies.filter((e) => e.alive).length;
  }

  /** 1フレーム分の更新（dt は秒。フレームレート非依存） */
  update(dt: number, input: WorldInput): void {
    if (this.status !== "playing") return;
    const p = this.player;

    // --- グレースタイマー（開始後1秒は敵が撃たない） ---
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
      tryFire(p, this.bullets, p.turretAngle, {
        fireInterval: BALANCE.PLAYER.FIRE_INTERVAL,
        maxBullets: BALANCE.PLAYER.MAX_BULLETS,
      });
    }

    // --- 敵AI ---
    for (const e of this.enemies) {
      if (e.alive) {
        updateSentry(e, dt, {
          player: p,
          bullets: this.bullets,
          stage: this.stage,
          grace: this.grace,
          rng: this.rng,
        });
      }
    }

    // --- 弾の移動と跳弾 ---
    for (const b of this.bullets) {
      if (!b.dead) updateBullet(b, dt, this.stage);
    }

    // --- 弾同士の相殺 ---
    resolveBulletVsBullet(this.bullets);

    // --- 弾 vs 戦車 ---
    let playerWasHit = false;
    for (const b of this.bullets) {
      if (b.dead) continue;
      if (bulletHitsTank(b, p)) {
        // 自分の弾でも当たる（自爆あり）
        b.dead = true;
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

    // --- 勝敗判定（被弾を優先処理） ---
    if (playerWasHit) {
      this.onPlayerHit();
      return;
    }
    if (this.enemies.every((e) => !e.alive)) {
      this.status = "clear";
    }
  }
}
