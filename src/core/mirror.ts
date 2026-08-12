/**
 * 敵Y「ミラー」（反射装甲型）のAI（GDD §6 v0.24）。
 *
 * 敵S「シールダー」が弾を**吸収**する（弾が消えるだけ）のに対し、
 * こちらは**反射**する（弾が向きを変えて返ってくる＝撃ち方を誤ると自滅する）。
 * 装甲の追従は 35°/s とシールダーの 60°/s より遅く、移動もしない。
 * したがって正解は「跳弾で背後から」ではなく **自分が横へ動いて側面を晒させる** こと。
 *
 * 射撃の手順は固定砲台と同じなので turretAi.ts を使う。
 * 装甲の向きの更新と反射判定だけがこのモジュール固有。
 *
 * Phaser 非依存の純粋 TS。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, ENEMY_BULLET_CFG } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { createEnemyBody, rollFireInterval } from "./enemyAi";
import { angleDiff, type Rng, rotateToward } from "./mathUtils";
import { nearestAlive } from "./targeting";
import {
  createTurretState,
  type TurretTank,
  type TurretUpdateContext,
  updateTurretAi,
} from "./turretAi";

/** ミラー戦車 */
export interface MirrorTank extends TurretTank {
  kind: "mirror";
  /** 反射装甲が向いている角度 [rad]（プレイヤー方向へゆっくり追従する） */
  armorAngle: number;
}

/** updateMirror に渡す周辺情報 */
export type MirrorUpdateContext = TurretUpdateContext;

/** ミラーを生成する（初期は下向き。装甲も同じ向きから始まる） */
export function createMirror(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): MirrorTank {
  const body = createEnemyBody("mirror", x, y, BALANCE.MIRROR);
  return {
    ...body,
    ...createTurretState(rollFireInterval(rng, BALANCE.MIRROR, mods.fireIntervalMult)),
    kind: "mirror",
    armorAngle: body.turretAngle,
  };
}

/**
 * その弾が反射装甲の正面（±ARMOR_ARC）から来たか。
 * 判定はシールダーと同じ「弾が来た方向」で行う（弾の進行方向の逆＝発射元がある側）。
 */
export function armorReflects(e: { armorAngle: number }, b: Bullet): boolean {
  const incoming = Math.atan2(-b.vy, -b.vx);
  return Math.abs(angleDiff(incoming, e.armorAngle)) <= BALANCE.MIRROR.ARMOR_ARC;
}

/**
 * 弾を反射させる（GDD §6 v0.24）。
 *
 * 進行方向を反転し、装甲の外側へ押し出してから返す。押し出さないと、同じフレームのうちに
 * もう一度この敵と重なったままになり、反射を繰り返して弾がその場に貼り付いてしまう。
 * **発射者は変えない**ので、返った弾はプレイヤー自身に当たる（自滅する）。
 * 反射回数（bounces）は増やさない＝壁で跳ねる余力を奪わない。
 */
export function reflectBullet(e: { x: number; y: number; radius: number }, b: Bullet): void {
  b.vx = -b.vx;
  b.vy = -b.vy;
  const speed = Math.hypot(b.vx, b.vy);
  if (speed <= 0) return;
  const push = e.radius + b.radius + BALANCE.MIRROR.REFLECT_PUSH;
  b.x = e.x + (b.vx / speed) * push;
  b.y = e.y + (b.vy / speed) * push;
}

/** ミラーの更新（1フレーム分。dt は秒） */
export function updateMirror(e: MirrorTank, dt: number, ctx: MirrorUpdateContext): void {
  const c = BALANCE.MIRROR;
  // 装甲は最寄りの生存プレイヤーへゆっくり追従する（遅いので回り込みが間に合う）
  const anchor = nearestAlive(e.x, e.y, ctx.players);
  if (anchor) {
    const toPlayer = Math.atan2(anchor.y - e.y, anchor.x - e.x);
    e.armorAngle = rotateToward(e.armorAngle, toPlayer, c.ARMOR_TURN_SPEED * dt);
  }
  updateTurretAi(e, dt, ctx, c, ENEMY_BULLET_CFG, "roll");
}
