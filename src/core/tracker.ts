/**
 * 敵T「トラッカー」（偏差射撃型）のAI（GDD §6 v0.24）。
 *
 * 手順は固定砲台と同じなので turretAi.ts を使い、**狙い点だけを差し替える**。
 * 狙うのは標的の現在位置ではなく、**弾が届く時点の予測位置**：
 *   予測位置 = 現在位置 + 推定速度 × (距離 ÷ 弾速)
 *
 * この敵だけは「射線を切る」以外に**動き方で無効化できる**：
 * 等速直線移動は必ず読まれるので、蛇行するか撃たれた瞬間に切り返すのが正解。
 * 逆にまっすぐ逃げると当たる＝プレイヤーの移動そのものが対処法になる。
 *
 * 速度の推定は「前フレームからの移動量」を平滑化したもの。生の差分をそのまま使うと
 * 1フレームの揺れで狙いが飛ぶので、時定数 LEAD_SMOOTH で均す。
 * さらに予測のずらし幅に上限（LEAD_MAX_TILES）を置く。上限が無いと、遠距離で
 * 標的が速く動いた瞬間に盤外を狙って永久に当たらなくなる。
 *
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { TRACKER_BULLET_CFG } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { createEnemyBody, rollFireInterval } from "./enemyAi";
import type { Rng } from "./mathUtils";
import type { TargetInfo } from "./targeting";
import {
  createTurretState,
  type TurretTank,
  type TurretUpdateContext,
  updateTurretAi,
} from "./turretAi";

/** トラッカー戦車 */
export interface TrackerTank extends TurretTank {
  kind: "tracker";
  /** 直前に観測した標的の位置（初回は NaN＝速度0として扱う） */
  seenX: number;
  seenY: number;
  /** 平滑化した標的の推定速度 [px/s] */
  estVx: number;
  estVy: number;
}

/** updateTracker に渡す周辺情報 */
export type TrackerUpdateContext = TurretUpdateContext;

/** トラッカーを生成する（初期は下向き。mods 省略時は NORMAL 相当） */
export function createTracker(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): TrackerTank {
  return {
    ...createEnemyBody("tracker", x, y, BALANCE.TRACKER),
    ...createTurretState(rollFireInterval(rng, BALANCE.TRACKER, mods.fireIntervalMult)),
    kind: "tracker",
    seenX: Number.NaN,
    seenY: Number.NaN,
    estVx: 0,
    estVy: 0,
  };
}

/**
 * 標的の速度を観測し、平滑化した推定値を更新する。
 * 初回（seen が NaN）は速度0のまま位置だけ覚える＝出会い頭に見当違いを撃たない。
 */
export function observeTarget(e: TrackerTank, target: TargetInfo, dt: number): void {
  const c = BALANCE.TRACKER;
  if (dt <= 0) return;
  if (Number.isFinite(e.seenX) && Number.isFinite(e.seenY)) {
    const rawVx = (target.x - e.seenX) / dt;
    const rawVy = (target.y - e.seenY) / dt;
    // 指数平滑（時定数 LEAD_SMOOTH 秒）。dt が大きいフレームでも 1 を超えないよう clamp する
    const k = Math.min(1, dt / c.LEAD_SMOOTH);
    e.estVx += (rawVx - e.estVx) * k;
    e.estVy += (rawVy - e.estVy) * k;
  }
  e.seenX = target.x;
  e.seenY = target.y;
}

/**
 * 偏差射撃の狙い点を求める（GDD §6 v0.24）。
 * ずらし幅は LEAD_MAX_TILES タイルで頭打ちにする。
 */
export function leadPoint(
  e: TrackerTank,
  target: TargetInfo,
  bulletSpeed: number,
): { x: number; y: number } {
  const c = BALANCE.TRACKER;
  if (bulletSpeed <= 0) return { x: target.x, y: target.y };
  const flight = Math.hypot(target.x - e.x, target.y - e.y) / bulletSpeed;
  let dx = e.estVx * flight;
  let dy = e.estVy * flight;
  const maxLead = c.LEAD_MAX_TILES * BALANCE.TILE;
  const len = Math.hypot(dx, dy);
  if (len > maxLead) {
    dx = (dx / len) * maxLead;
    dy = (dy / len) * maxLead;
  }
  return { x: target.x + dx, y: target.y + dy };
}

/** トラッカーの更新（1フレーム分。dt は秒） */
export function updateTracker(e: TrackerTank, dt: number, ctx: TrackerUpdateContext): void {
  const mods = ctx.mods ?? NORMAL_MODS;
  const bulletSpeed = BALANCE.BULLET.TRACKER_BULLET_SPEED * mods.bulletSpeedMult;
  updateTurretAi(e, dt, ctx, BALANCE.TRACKER, TRACKER_BULLET_CFG, "roll", (self, target, frame) => {
    const t = self as TrackerTank;
    observeTarget(t, target, frame);
    return leadPoint(t, target, bulletSpeed);
  });
}
