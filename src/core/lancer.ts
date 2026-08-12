/**
 * 敵L「ランサー」（突進型）のAI（GDD §6 v0.24）。
 *
 * 「距離を取る」が正解にならない唯一の敵。普段はゆっくり寄ってくるだけだが、
 * 一定間隔で**プレイヤー方向へ高速直進**し、突進を撃ち切った直後に至近から1発撃つ。
 *
 *   APPROACH … 60px/s でプレイヤーへ寄りつつ砲塔を向ける。通常の射撃もする
 *   DASH     … 突進開始時の向きへ 330px/s で直進。**曲がれない・撃たない**
 *   STUN     … 突進中に壁や戦車へぶつかったときの硬直。動かない・撃たない・砲塔も回らない
 *
 * 対処法は「突進の線から横へ1歩ずれる」こと。避けると壁に激突して硬直するので、
 * そこが反撃の窓になる。離れるほど助走が伸びて突進が速く届くため、
 * 距離を取るだけでは解決しない。
 *
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, ENEMY_BULLET_CFG, LANCER_BULLET_CFG, scaleBulletSpeed } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { createEnemyBody, rollFireInterval, tryEnemyFire } from "./enemyAi";
import { type Rng, rotateToward } from "./mathUtils";
import type { ParsedStage } from "./stage";
import { moveTank, type TankBlocker } from "./tank";
import type { TankBody } from "./types";
import { nearestAlive, selectTarget, type TargetInfo } from "./targeting";

/** ランサーの状態名 */
export type LancerFsmState = "APPROACH" | "DASH" | "STUN";

/** ランサー戦車 */
export interface LancerTank extends TankBody {
  kind: "lancer";
  state: LancerFsmState;
  fireTimer: number; // 通常射撃の残り時間 [s]
  dashTimer: number; // 次の突進までの残り時間 [s]（APPROACH 中に減る）
  dashLeft: number; // 突進の残り時間 [s]（DASH 中に減る）
  dashAngle: number; // 突進の向き [rad]（開始時に固定＝途中で曲がれない）
  stunLeft: number; // 硬直の残り時間 [s]
}

/** 次回突進までの間隔（平均±ゆらぎ）を引く */
export function lancerNextDashInterval(rng: Rng): number {
  const c = BALANCE.LANCER;
  return c.DASH_INTERVAL_MEAN + (rng() * 2 - 1) * c.DASH_INTERVAL_VAR;
}

/** ランサーを生成する（初期は下向き・APPROACH から始まる） */
export function createLancer(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): LancerTank {
  return {
    ...createEnemyBody("lancer", x, y, BALANCE.LANCER),
    kind: "lancer",
    state: "APPROACH",
    fireTimer: rollFireInterval(rng, BALANCE.LANCER, mods.fireIntervalMult),
    dashTimer: lancerNextDashInterval(rng),
    dashLeft: 0,
    dashAngle: 0,
    stunLeft: 0,
  };
}

/** updateLancer に渡す周辺情報 */
export interface LancerUpdateContext {
  players: readonly TargetInfo[];
  bullets: Bullet[];
  blockers: readonly TankBlocker[];
  stage: ParsedStage;
  grace: number;
  rng: Rng;
  mods?: DifficultyMods;
}

/** ランサーの更新（1フレーム分。dt は秒） */
export function updateLancer(e: LancerTank, dt: number, ctx: LancerUpdateContext): void {
  const c = BALANCE.LANCER;
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 硬直：何もしない（砲塔も回らない＝ここが反撃の窓） ---
  if (e.state === "STUN") {
    e.stunLeft -= dt;
    if (e.stunLeft <= 0) {
      e.stunLeft = 0;
      e.state = "APPROACH";
      e.dashTimer = lancerNextDashInterval(ctx.rng);
    }
    return;
  }

  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);
  if (!pick) return; // 生存者なし（同フレーム内でリセットされる）
  const p = pick.target;
  const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);

  // --- 突進中：開始時の向きへ直進する。曲がれない・撃たない ---
  if (e.state === "DASH") {
    const beforeX = e.x;
    const beforeY = e.y;
    const step = c.DASH_SPEED * dt;
    moveTank(e, Math.cos(e.dashAngle) * step, Math.sin(e.dashAngle) * step, ctx.blockers, ctx.stage);
    const moved = Math.hypot(e.x - beforeX, e.y - beforeY);
    e.dashLeft -= dt;
    // ほとんど進めていない＝壁か戦車にぶつかった → 硬直（GDD §6 v0.24）
    if (moved < c.DASH_SPEED * dt * c.DASH_BLOCKED_RATIO) {
      e.state = "STUN";
      e.stunLeft = c.STUN_TIME;
      return;
    }
    if (e.dashLeft <= 0) {
      // 突進を撃ち切ったら至近から1発。撃てない状況（同時発射数超過）なら空振りでよい
      e.turretAngle = toPlayer;
      tryEnemyFire(
        e,
        0,
        ctx,
        toPlayer,
        pick.hasLos,
        c,
        scaleBulletSpeed(LANCER_BULLET_CFG, mods.bulletSpeedMult),
        mods.fireIntervalMult,
      );
      e.state = "APPROACH";
      e.dashTimer = lancerNextDashInterval(ctx.rng);
    }
    return;
  }

  // --- 接近：ゆっくり寄りながら砲塔を向け、通常射撃もする ---
  e.turretAngle = rotateToward(e.turretAngle, toPlayer, c.TURN_SPEED * dt);
  e.bodyAngle = rotateToward(e.bodyAngle, toPlayer, c.BODY_TURN_SPEED * dt);
  const anchor = nearestAlive(e.x, e.y, ctx.players);
  if (anchor) {
    const angle = Math.atan2(anchor.y - e.y, anchor.x - e.x);
    const step = c.SPEED * dt;
    moveTank(e, Math.cos(angle) * step, Math.sin(angle) * step, ctx.blockers, ctx.stage);
  }
  tryEnemyFire(
    e,
    dt,
    ctx,
    toPlayer,
    pick.hasLos,
    c,
    scaleBulletSpeed(ENEMY_BULLET_CFG, mods.bulletSpeedMult),
    mods.fireIntervalMult,
  );

  // --- 突進の開始（グレース中は突進しない＝開幕即突進で理不尽にしない） ---
  if (ctx.grace > 0) return;
  e.dashTimer -= dt;
  if (e.dashTimer <= 0) {
    e.state = "DASH";
    e.dashAngle = toPlayer; // ここで固定＝突進中は曲がれない
    e.bodyAngle = toPlayer;
    e.dashLeft = c.DASH_TIME;
  }
}
