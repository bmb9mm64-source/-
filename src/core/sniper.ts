/**
 * 敵C「スナイパー」（狙撃型）のAI。ステートマシン（状態機械）で実装（GDD §6 v0.6）。
 * 構造は敵A「セントリー」の再利用（移動なし・IDLE → AIM → RELOAD）。差分：
 *   - 照準はゆっくり（70°/s）だが**ブレなし**（精密照準。セントリーの ±2° ジッターを持たない）
 *   - 弾速 340px/s（SNIPER_BULLET_CFG。反射上限は共通の1回）
 *   - 発射間隔 平均 4.0±1.0 s
 *   - 跳弾狙撃（直接射線が塞がれているときの外周壁1回反射）の確率は難易度連動
 *     （EASY40%／NORMAL75%／HARD100%。GDD §6 v0.9 で個別値35%を廃止）
 * Phaser 非依存の純粋 TS。乱数は Rng を注入してテスト可能にする。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, liveBulletCount, scaleBulletSpeed, SNIPER_BULLET_CFG, spawnBullet } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import { findOuterWallRicochet } from "./ricochetAim";
import type { ParsedStage } from "./stage";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody } from "./types";

/** スナイパーの状態名 */
export type SniperFsmState = "IDLE" | "AIM" | "RELOAD";

/** スナイパー戦車 */
export interface SniperTank extends TankBody {
  kind: "sniper";
  state: SniperFsmState;
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  ricochetRolled: boolean; // このAIMサイクルで跳弾狙撃の抽選を消化したか
  ricochetMode: boolean; // 抽選に当たり跳弾狙撃を試みているか（確率は難易度連動。GDD §6 v0.9）
}

/** 次回発射間隔（平均±ゆらぎ）×難易度倍率 を引く（GDD §8.3） */
export function sniperNextInterval(rng: Rng, intervalMult = 1): number {
  const c = BALANCE.SNIPER;
  return (c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR)) * intervalMult;
}

/** スナイパーを生成する（初期は下向き。mods 省略時は NORMAL 相当） */
export function createSniper(x: number, y: number, rng: Rng, mods: DifficultyMods = NORMAL_MODS): SniperTank {
  return {
    kind: "sniper",
    x,
    y,
    bodyAngle: Math.PI / 2, // 車体は固定（見た目のみ）
    turretAngle: Math.PI / 2,
    half: BALANCE.SNIPER.SIZE / 2,
    radius: BALANCE.SNIPER.RADIUS,
    alive: true,
    state: "IDLE",
    fireTimer: sniperNextInterval(rng, mods.fireIntervalMult),
    ricochetRolled: false,
    ricochetMode: false,
  };
}

/** updateSniper に渡す周辺情報 */
export interface SniperUpdateContext {
  players: readonly TargetInfo[]; // 全プレイヤー（標的選択に使う。GDD §12.5）
  bullets: Bullet[]; // 場の弾（発射先・同時発射数カウント)
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
  mods?: DifficultyMods; // 難易度の実効調整値（省略時は NORMAL 相当。GDD §8.3）
}

/**
 * スナイパーの更新。
 * 標的は「生存プレイヤーのうち射線が通る最も近い1体」（GDD §12.5。セントリーと同じ）。
 * どの状態でも砲塔は狙い（通常は標的、跳弾狙撃中は反射点）へ 70°/s で追従する。
 * セントリーと異なりブレを一切載せない（精密照準。GDD §6 v0.6）。
 * 発射条件：発射間隔消化・同時1発・砲塔が狙い方向 ±0.15rad 以内・射線（直接 or 跳弾）が成立。
 * 跳弾狙撃：直接射線が塞がれているとき、AIM 突入ごとに1回だけ抽選（難易度連動：GDD §6 v0.9）し、
 * 当たれば外周壁1回反射の射線を毎フレーム再計算して反射点方向へ撃つ。直接射線があれば常に通常射撃を優先。
 */
export function updateSniper(e: SniperTank, dt: number, ctx: SniperUpdateContext): void {
  const c = BALANCE.SNIPER;
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 標的選択（GDD §12.5）。生存者がいなければ何もしない（同フレーム内でリセットされる） ---
  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);
  if (!pick) return;
  const p = pick.target;

  // --- 狙いの決定：直接射線があれば標的、なければ（抽選成立時のみ）跳弾の反射点 ---
  const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
  const direct = pick.hasLos;
  if (e.state === "AIM" && !e.ricochetRolled) {
    // AIM 突入後の初回フレームで抽選を1回だけ消化（リロードごと）
    e.ricochetRolled = true;
    e.ricochetMode = !direct && ctx.rng() < mods.turretRicochetChance; // 難易度連動（GDD §6 v0.9）
  }
  const shot =
    e.state === "AIM" && !direct && e.ricochetMode
      ? findOuterWallRicochet(ctx.stage, e.x, e.y, p.x, p.y)
      : null;
  const aimTarget = shot ? shot.aimAngle : toPlayer;
  e.turretAngle = rotateToward(e.turretAngle, aimTarget, c.TURN_SPEED * dt); // ブレなし

  // --- 状態遷移 ---
  switch (e.state) {
    case "IDLE": // 開幕グレース：照準のみ、射撃しない
      if (ctx.grace <= 0) e.state = "AIM";
      break;

    case "AIM": {
      // 発射条件が揃ったら撃つ（通常＝直接射線あり／跳弾狙撃＝反射射線が成立）
      e.fireTimer -= dt;
      const ready =
        e.fireTimer <= 0 &&
        liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS && // 同時1発
        Math.abs(angleDiff(aimTarget, e.turretAngle)) < c.FIRE_ANGLE_TOL && // 砲塔がほぼ狙い通り
        (direct || shot !== null); // 直接射線 or 跳弾射線のどちらかが成立
      if (ready) {
        // 340px/s ×難易度弾速倍率（「スナイパー弾にも適用」GDD §8.3）
        spawnBullet(ctx.bullets, e, e.turretAngle, scaleBulletSpeed(SNIPER_BULLET_CFG, mods.bulletSpeedMult));
        e.fireTimer = sniperNextInterval(ctx.rng, mods.fireIntervalMult);
        e.state = "RELOAD";
        e.ricochetRolled = false; // 次の AIM サイクルで再抽選
        e.ricochetMode = false;
      }
      break;
    }

    case "RELOAD": // 発射間隔の消化を待つ
      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        e.fireTimer = 0;
        e.state = "AIM";
        e.ricochetRolled = false; // AIM 復帰時に抽選をリセット
        e.ricochetMode = false;
      }
      break;
  }
}
