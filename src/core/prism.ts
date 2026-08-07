/**
 * 敵G「プリズム」（多重反射砲台型）のAI（GDD §6 v0.10）。
 * 構造は敵E「リフレクター」と同一（移動なし・IDLE → AIM → RELOAD・跳弾狙撃を常時使用）。差分：
 *   - 照準 90°/s・ブレ±1°
 *   - 弾：280px/s・**反射上限3回**（盤面を長く飛び回る。PRISM_BULLET_CFG）・同時1発
 *   - 発射間隔 平均 3.0±1.0 s（難易度倍率の対象）
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, liveBulletCount, PRISM_BULLET_CFG, scaleBulletSpeed, spawnBullet } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import { findOuterWallRicochet } from "./ricochetAim";
import type { ParsedStage } from "./stage";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody } from "./types";

/** プリズムの状態名 */
export type PrismFsmState = "IDLE" | "AIM" | "RELOAD";

/** プリズム戦車 */
export interface PrismTank extends TankBody {
  kind: "prism";
  state: PrismFsmState;
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  jitter: number; // 現在の照準ブレ [rad]（±1°）
  jitterTimer: number; // ブレ引き直しまでの残り時間 [s]
}

/** 次回発射間隔（平均±ゆらぎ）×難易度倍率 を引く（GDD §8.3） */
export function prismNextInterval(rng: Rng, intervalMult = 1): number {
  const c = BALANCE.PRISM;
  return (c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR)) * intervalMult;
}

/** プリズムを生成する（初期は下向き。mods 省略時は NORMAL 相当） */
export function createPrism(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): PrismTank {
  return {
    kind: "prism",
    x,
    y,
    bodyAngle: Math.PI / 2, // 車体は固定（見た目のみ）
    turretAngle: Math.PI / 2,
    half: BALANCE.PRISM.SIZE / 2,
    radius: BALANCE.PRISM.RADIUS,
    alive: true,
    state: "IDLE",
    fireTimer: prismNextInterval(rng, mods.fireIntervalMult),
    jitter: 0,
    jitterTimer: 0,
  };
}

/** updatePrism に渡す周辺情報 */
export interface PrismUpdateContext {
  players: readonly TargetInfo[]; // 全プレイヤー（標的選択に使う。GDD §12.5）
  bullets: Bullet[]; // 場の弾（発射先・同時発射数カウント）
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
  mods?: DifficultyMods; // 難易度の実効調整値（省略時は NORMAL 相当。発射間隔・弾速に適用）
}

/**
 * プリズムの更新。挙動はリフレクターと同一で、撃つ弾だけが「280px/s・反射上限3回」。
 * 直接射線があれば直接射撃を優先し、塞がれていれば常に外周壁1回反射の射線を狙う（GDD §6 v0.10）。
 */
export function updatePrism(e: PrismTank, dt: number, ctx: PrismUpdateContext): void {
  const c = BALANCE.PRISM;
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 照準ブレの引き直し（全状態共通。±1°） ---
  e.jitterTimer -= dt;
  if (e.jitterTimer <= 0) {
    e.jitter = randRange(ctx.rng, -c.JITTER_MAX, c.JITTER_MAX);
    e.jitterTimer = randRange(ctx.rng, c.JITTER_INTERVAL_MIN, c.JITTER_INTERVAL_MAX);
  }

  // --- 標的選択（GDD §12.5）。生存者がいなければ何もしない ---
  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);
  if (!pick) return;
  const p = pick.target;

  // --- 狙いの決定：直接射線があれば標的、なければ常に跳弾の反射点（抽選なし） ---
  const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
  const direct = pick.hasLos;
  const shot = !direct ? findOuterWallRicochet(ctx.stage, e.x, e.y, p.x, p.y) : null;
  const aimTarget = shot ? shot.aimAngle : toPlayer;
  e.turretAngle = rotateToward(e.turretAngle, aimTarget + e.jitter, c.TURN_SPEED * dt);

  // --- 状態遷移 ---
  switch (e.state) {
    case "IDLE": // 開幕グレース：照準のみ、射撃しない
      if (ctx.grace <= 0) e.state = "AIM";
      break;

    case "AIM": {
      e.fireTimer -= dt;
      const ready =
        e.fireTimer <= 0 &&
        liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS && // 同時1発
        Math.abs(angleDiff(aimTarget, e.turretAngle)) < c.FIRE_ANGLE_TOL && // 砲塔がほぼ狙い通り
        (direct || shot !== null); // 直接射線 or 跳弾射線のどちらかが成立
      if (ready) {
        // 280px/s・反射上限3回 ×難易度弾速倍率
        spawnBullet(ctx.bullets, e, e.turretAngle, scaleBulletSpeed(PRISM_BULLET_CFG, mods.bulletSpeedMult));
        e.fireTimer = prismNextInterval(ctx.rng, mods.fireIntervalMult);
        e.state = "RELOAD";
      }
      break;
    }

    case "RELOAD": // 発射間隔の消化を待つ
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        e.fireTimer = 0;
        e.state = "AIM";
      }
      break;
  }
}
