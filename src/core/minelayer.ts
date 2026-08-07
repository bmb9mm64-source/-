/**
 * 敵D「マインレイヤー」（地雷敷設型）のAI（GDD §6 v0.6）。
 * 移動・射撃は敵B「ローバー」の WANDER と同方式（構造の再利用）。差分：
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
import { type Bullet, ENEMY_BULLET_CFG, liveBulletCount, scaleBulletSpeed, spawnBullet } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import { type Mine, type MineConfig, tryPlaceMine } from "./mine";
import { pickWanderTarget } from "./rover";
import type { ParsedStage } from "./stage";
import { moveTank, type TankBlocker } from "./tank";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody, Vec2 } from "./types";

/**
 * 敵Dの地雷設定：挙動（起爆・誘爆・爆風・設置者除外）はプレイヤー地雷と同一で、
 * 敷設した敵自身の同時上限のみ 3 個（GDD §6 v0.6。プレイヤーの上限2個とは別管理＝owner 単位）。
 */
export const MINELAYER_MINE_CFG: MineConfig = {
  ...BALANCE.MINE,
  MAX_PER_OWNER: BALANCE.MINELAYER.MINE_MAX,
};

/** マインレイヤー戦車 */
export interface MinelayerTank extends TankBody {
  kind: "minelayer";
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  mineTimer: number; // 次に地雷を敷設できるまでの残り時間 [s]（0 のまま条件成立を待つ）
  target: Vec2; // 現在の移動目標点（px）
  retargetTimer: number; // 目標を引き直すまでの残り時間 [s]
  stuckTimer: number; // 行き詰まり（壁・戦車）継続時間 [s]
}

/** 次回発射間隔（平均±ゆらぎ）×難易度倍率 を引く（GDD §8.3。敷設間隔は「発射」でないため対象外） */
export function minelayerNextFireInterval(rng: Rng, intervalMult = 1): number {
  const c = BALANCE.MINELAYER;
  return (c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR)) * intervalMult;
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
    kind: "minelayer",
    x,
    y,
    bodyAngle: Math.PI / 2,
    turretAngle: Math.PI / 2,
    half: BALANCE.MINELAYER.SIZE / 2,
    radius: BALANCE.MINELAYER.RADIUS,
    alive: true,
    fireTimer: minelayerNextFireInterval(rng, mods.fireIntervalMult),
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

/** 全生存プレイヤーが safeDist 以上離れているか（生存者がいなければ false＝敷設しない） */
function playersFarEnough(
  e: MinelayerTank,
  players: readonly TargetInfo[],
  safeDist: number,
): boolean {
  let anyAlive = false;
  for (const p of players) {
    if (!p.alive) continue;
    anyAlive = true;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    if (dx * dx + dy * dy < safeDist * safeDist) return false; // 最寄りが 160px 未満
  }
  return anyAlive;
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
  e.retargetTimer -= dt;
  const distToTarget = Math.hypot(e.target.x - e.x, e.target.y - e.y);
  if (e.retargetTimer <= 0 || distToTarget < c.ARRIVE_DIST) {
    e.target = pickWanderTarget(ctx.stage, ctx.rng, e, c.WANDER_PICK_TRIES);
    e.retargetTimer = randRange(ctx.rng, c.RETARGET_INTERVAL_MIN, c.RETARGET_INTERVAL_MAX);
  }
  const dx = e.target.x - e.x;
  const dy = e.target.y - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist > c.ARRIVE_DIST) {
    const step = Math.min(c.SPEED * dt, dist);
    const prevX = e.x;
    const prevY = e.y;
    moveTank(e, (dx / dist) * step, (dy / dist) * step, ctx.blockers, ctx.stage);
    e.bodyAngle = rotateToward(e.bodyAngle, Math.atan2(dy, dx), c.BODY_TURN_SPEED * dt);
    // 壁・他戦車に阻まれてほとんど進めない状態が続いたら目標を引き直す
    const moved = Math.hypot(e.x - prevX, e.y - prevY);
    if (moved < step * 0.5) {
      e.stuckTimer += dt;
      if (e.stuckTimer >= c.STUCK_TIME) {
        e.target = pickWanderTarget(ctx.stage, ctx.rng, e, c.WANDER_PICK_TRIES);
        e.retargetTimer = randRange(ctx.rng, c.RETARGET_INTERVAL_MIN, c.RETARGET_INTERVAL_MAX);
        e.stuckTimer = 0;
      }
    } else {
      e.stuckTimer = 0;
    }
  }

  // --- 地雷敷設（GDD §6 v0.6）：間隔消化済み・生存地雷3個未満・最寄り生存プレイヤーが160px以上 ---
  e.mineTimer -= dt;
  if (e.mineTimer < 0) e.mineTimer = 0; // 条件を満たすまで 0 で保留（冒頭の暫定解釈）
  if (e.mineTimer <= 0 && playersFarEnough(e, ctx.players, c.MINE_SAFE_DIST)) {
    // tryPlaceMine が上限（MAX_PER_OWNER=3。自分が敷設した生存地雷のみ数える）を判定する
    if (tryPlaceMine(ctx.mines, e, MINELAYER_MINE_CFG) !== null) {
      e.mineTimer = minelayerNextMineInterval(ctx.rng);
    }
  }

  // --- 射撃（ローバーと同条件。GDD §6 v0.6） ---
  e.fireTimer -= dt;
  if (e.fireTimer < 0) e.fireTimer = 0;
  const ready =
    ctx.grace <= 0 && // 開幕グレース明け
    e.fireTimer <= 0 && // 発射間隔を消化済み
    liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS && // 同時1発
    pick !== null &&
    pick.hasLos && // 標的への射線が通っている（全員遮蔽なら照準追従のみ。GDD §12.5）
    Math.abs(angleDiff(toPlayer, e.turretAngle)) < c.FIRE_ANGLE_TOL; // 砲塔がほぼ狙い通り
  if (ready) {
    // 225px/s ×難易度弾速倍率（GDD §6 v0.6・§8.3）
    spawnBullet(ctx.bullets, e, e.turretAngle, scaleBulletSpeed(ENEMY_BULLET_CFG, mods.bulletSpeedMult), ctx.stage);
    e.fireTimer = minelayerNextFireInterval(ctx.rng, mods.fireIntervalMult);
  }
}
