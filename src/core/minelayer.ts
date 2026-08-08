/**
 * 敵D「マインレイヤー」（地雷敷設型）のAI（GDD §6 v0.6）。
 * 移動・射撃は敵B「ローバー」の WANDER と同方式（手順は enemyAi.ts に集約）。差分：
 *   - 移動 70px/s・照準 120°/s・発射間隔 平均 2.5±1.0 s（弾はローバーと同じ 225px/s・反射1回・同時1発）
 *   - プレイヤー弾への回避行動は**なし**（状態は WANDER のみ＝状態変数を持たない）
 *   - 地雷敷設：自分が敷設した生存地雷が同時3個まで。敷設間隔 平均 5.0±2.0 s。
 *     最寄りの生存プレイヤーから 160px 以上離れているときのみ敷設（目の前に置く自爆行為の防止）。
 * 敵の地雷は仕組みごとプレイヤー地雷と同一（mine.ts を共用。10秒自動起爆・接近起爆40px・
 * 誘爆・X壁破壊・設置者除外。同時上限のみ MINELAYER_MINE_CFG で 3 個に差し替え）。
 *
 * 暫定解釈（GDD §6 v0.6 に明記なし・要 game-designer 確認）：
 *   敷設間隔を消化しても条件（距離160px・上限3個）を満たさない間は敷設を保留し、
 *   条件を満たした時点で敷設して次の間隔を引き直す（保留中に間隔の再抽選はしない）。
 * Phaser 非依存の純粋 TS。乱数は Rng を注入して決定的テスト可能。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, ENEMY_BULLET_CFG, scaleBulletSpeed } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import {
  createEnemyBody,
  type MoveState,
  rollFireInterval,
  stepToTarget,
  tryEnemyFire,
} from "./enemyAi";
import { randRange, type Rng, rotateToward } from "./mathUtils";
import { type Mine, type MineConfig, tryPlaceMine } from "./mine";
import { pickWanderTarget } from "./rover";
import type { ParsedStage } from "./stage";
import type { TankBlocker } from "./tank";
import { nearestAlive, selectTarget, type TargetInfo } from "./targeting";

/**
 * 敵Dの地雷設定：挙動（起爆・誘爆・爆風・設置者除外）はプレイヤー地雷と同一で、
 * 敷設した敵自身の同時上限のみ 3 個（GDD §6 v0.6。プレイヤーの上限2個とは別管理＝owner 単位）。
 */
export const MINELAYER_MINE_CFG: MineConfig = {
  ...BALANCE.MINE,
  MAX_PER_OWNER: BALANCE.MINELAYER.MINE_MAX,
};

/** マインレイヤー戦車 */
export interface MinelayerTank extends MoveState {
  kind: "minelayer";
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  mineTimer: number; // 次に地雷を敷設できるまでの残り時間 [s]（0 のまま条件成立を待つ）
}

/** 次回発射間隔（平均±ゆらぎ）×難易度倍率 を引く（GDD §8.3。敷設間隔は「発射」でないため対象外） */
export function minelayerNextFireInterval(rng: Rng, intervalMult = 1): number {
  return rollFireInterval(rng, BALANCE.MINELAYER, intervalMult);
}

/** 次回敷設間隔（平均±ゆらぎ）を引く */
export function minelayerNextMineInterval(rng: Rng): number {
  const c = BALANCE.MINELAYER;
  return c.MINE_INTERVAL_MEAN + randRange(rng, -c.MINE_INTERVAL_VAR, c.MINE_INTERVAL_VAR);
}

/** マインレイヤーを生成する（初期は下向き。目標は自位置＝初回更新で引き直される。mods 省略時は NORMAL 相当） */
export function createMinelayer(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): MinelayerTank {
  return {
    ...createEnemyBody("minelayer", x, y, BALANCE.MINELAYER),
    fireTimer: rollFireInterval(rng, BALANCE.MINELAYER, mods.fireIntervalMult),
    mineTimer: minelayerNextMineInterval(rng),
    target: { x, y },
    retargetTimer: 0,
    stuckTimer: 0,
  };
}

/** updateMinelayer に渡す周辺情報 */
export interface MinelayerUpdateContext {
  players: readonly TargetInfo[]; // 全プレイヤー（標的選択と敷設可否の距離判定に使う）
  bullets: Bullet[];
  blockers: readonly TankBlocker[]; // 自分以外の全戦車（通り抜け不可）
  mines: Mine[]; // 世界の地雷リスト（敵の地雷もここに入れて共通の起爆・誘爆に乗せる）
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
  mods?: DifficultyMods; // 難易度の実効調整値（省略時は NORMAL 相当。GDD §8.3）
}

/** 最寄りの生存プレイヤーが safeDist 以上離れているか（生存者がいなければ false＝敷設しない） */
function playersFarEnough(
  e: MinelayerTank,
  players: readonly TargetInfo[],
  safeDist: number,
): boolean {
  const nearest = nearestAlive(e.x, e.y, players);
  if (!nearest) return false;
  return (nearest.x - e.x) ** 2 + (nearest.y - e.y) ** 2 >= safeDist * safeDist;
}

/** マインレイヤーの更新（1フレーム分。dt は秒） */
export function updateMinelayer(e: MinelayerTank, dt: number, ctx: MinelayerUpdateContext): void {
  const c = BALANCE.MINELAYER;
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 標的選択（GDD §12.5）：射線が通る最も近い生存者。全員遮蔽なら最も近い生存者（照準のみ） ---
  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);

  // --- 砲塔照準：標的へ 120°/s で追従 ---
  const toPlayer = pick ? Math.atan2(pick.target.y - e.y, pick.target.x - e.x) : e.turretAngle;
  if (pick) e.turretAngle = rotateToward(e.turretAngle, toPlayer, c.TURN_SPEED * dt);

  // --- 徘徊移動（ローバーの WANDER と同方式。回避行動はなし：GDD §6 v0.6） ---
  stepToTarget(e, dt, c, ctx.blockers, ctx.stage, ctx.rng, () =>
    pickWanderTarget(ctx.stage, ctx.rng, e, c.WANDER_PICK_TRIES),
  );

  // --- 地雷敷設（GDD §6 v0.6）：間隔消化済み・生存地雷3個未満・最寄り生存プレイヤーが160px以上 ---
  e.mineTimer -= dt;
  if (e.mineTimer < 0) e.mineTimer = 0; // 条件を満たすまで 0 で保留（冒頭の暫定解釈）
  if (e.mineTimer <= 0 && playersFarEnough(e, ctx.players, c.MINE_SAFE_DIST)) {
    // tryPlaceMine が上限（MAX_PER_OWNER=3。自分が敷設した生存地雷のみ数える）を判定する
    if (tryPlaceMine(ctx.mines, e, MINELAYER_MINE_CFG) !== null) {
      e.mineTimer = minelayerNextMineInterval(ctx.rng);
    }
  }

  // --- 射撃（ローバーと同条件。GDD §6 v0.6。225px/s ×難易度弾速倍率） ---
  tryEnemyFire(
    e,
    dt,
    ctx,
    toPlayer,
    pick !== null && pick.hasLos,
    c,
    scaleBulletSpeed(ENEMY_BULLET_CFG, mods.bulletSpeedMult),
    mods.fireIntervalMult,
  );
}
