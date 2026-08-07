/**
 * 敵F「チェイサー」（追跡型）のAI（GDD §6 v0.9）。
 * 移動・回避は敵B「ローバー」の WANDER/DODGE 構造の流用（手順は enemyAi.ts に集約）。差分：
 *   - 移動 110px/s。徘徊ではなく**プレイヤー追跡**＝最寄り生存プレイヤーの周辺
 *     （±3タイル以内）の床タイルを目標に選び、1.0〜2.0 s ごとに引き直し続ける
 *   - 照準 200°/s
 *   - 弾 225px/s（難易度弾速倍率の対象）・反射1回・同時1発・発射間隔 平均 1.0±0.3 s（難易度倍率対象）
 *   - 回避はローバーと同方式だが**成功率50%固定**（難易度対象外。GDD §6 v0.9）
 * Phaser 非依存の純粋 TS。乱数は Rng を注入して決定的テスト可能。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, ENEMY_BULLET_CFG, scaleBulletSpeed } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import {
  createEnemyBody,
  type DodgeState,
  type MoveState,
  rollFireInterval,
  stepDodge,
  stepToTarget,
  tryEnemyFire,
  tryStartDodge,
} from "./enemyAi";
import { type Rng, rotateToward } from "./mathUtils";
import { type ParsedStage, tileAt } from "./stage";
import type { TankBlocker } from "./tank";
import { nearestAlive, selectTarget, type TargetInfo } from "./targeting";
import type { Vec2 } from "./types";

/** チェイサーの状態名（CHASE＝追跡移動。ローバーの WANDER に相当） */
export type ChaserFsmState = "CHASE" | "DODGE";

/** チェイサー戦車 */
export interface ChaserTank extends MoveState, DodgeState {
  kind: "chaser";
  state: ChaserFsmState;
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
}

/** 次回発射間隔（平均±ゆらぎ）×難易度倍率 を引く（GDD §8.3） */
export function chaserNextInterval(rng: Rng, intervalMult = 1): number {
  return rollFireInterval(rng, BALANCE.CHASER, intervalMult);
}

/** チェイサーを生成する（初期は下向き。目標は自位置＝初回更新で引き直される。mods 省略時は NORMAL 相当） */
export function createChaser(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): ChaserTank {
  return {
    ...createEnemyBody("chaser", x, y, BALANCE.CHASER),
    state: "CHASE",
    fireTimer: rollFireInterval(rng, BALANCE.CHASER, mods.fireIntervalMult),
    target: { x, y },
    retargetTimer: 0,
    stuckTimer: 0,
    dodgeTimer: 0,
    dodgeDir: { x: 0, y: 0 },
    dodgeCooldown: 0,
  };
}

/**
 * 追跡目標の抽選（GDD §6 v0.9）：anchor（最寄り生存プレイヤー）のタイル±rangeTiles の範囲から
 * ランダムに床タイルを引き、その中心を返す。一定回数試して床が引けなければ anchor の位置そのもの
 * （＝プレイヤーへ直進。壁は moveTank ＋行き詰まり検知で解決）を返す。
 */
export function pickChaseTarget(
  stage: ParsedStage,
  rng: Rng,
  anchor: Vec2,
  rangeTiles: number = BALANCE.CHASER.CHASE_RANGE_TILES,
  tries: number = BALANCE.CHASER.CHASE_PICK_TRIES,
): Vec2 {
  const anchorCol = Math.floor(anchor.x / stage.tile);
  const anchorRow = Math.floor(anchor.y / stage.tile);
  const span = rangeTiles * 2 + 1; // ±rangeTiles → 一辺のタイル数
  for (let i = 0; i < tries; i++) {
    const col = anchorCol - rangeTiles + Math.floor(rng() * span);
    const row = anchorRow - rangeTiles + Math.floor(rng() * span);
    if (tileAt(stage, col, row) === ".") {
      return {
        x: col * stage.tile + stage.tile / 2,
        y: row * stage.tile + stage.tile / 2,
      };
    }
  }
  return { x: anchor.x, y: anchor.y };
}

/** updateChaser に渡す周辺情報 */
export interface ChaserUpdateContext {
  players: readonly TargetInfo[]; // 全プレイヤー（標的選択・追跡先・弾の owner 識別。実体の PlayerTank を渡すこと）
  bullets: Bullet[];
  blockers: readonly TankBlocker[]; // 自分以外の全戦車（通り抜け不可・回避対象）
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
  mods?: DifficultyMods; // 難易度の実効調整値（省略時は NORMAL 相当。発射間隔・弾速のみ。回避50%は固定）
}

/** チェイサーの更新（1フレーム分。dt は秒） */
export function updateChaser(e: ChaserTank, dt: number, ctx: ChaserUpdateContext): void {
  const c = BALANCE.CHASER;
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 標的選択（射撃用。GDD §12.5）：射線が通る最も近い生存者。全員遮蔽なら最も近い生存者（照準のみ） ---
  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);

  // --- 砲塔照準（全状態共通）：標的へ 200°/s で追従 ---
  const toPlayer = pick ? Math.atan2(pick.target.y - e.y, pick.target.x - e.x) : e.turretAngle;
  if (pick) e.turretAngle = rotateToward(e.turretAngle, toPlayer, c.TURN_SPEED * dt);

  // --- 回避判定：ローバーと同方式だが成功率は50%固定（GDD §6 v0.9） ---
  const dodging = tryStartDodge(
    e,
    dt,
    ctx.bullets,
    ctx.players,
    c,
    c.DODGE_CHANCE,
    ctx.rng,
    e.state === "CHASE",
  );
  if (dodging) e.state = "DODGE";

  // --- 移動（状態別） ---
  if (e.state === "DODGE") {
    if (stepDodge(e, dt, c, ctx.blockers, ctx.stage)) {
      e.state = "CHASE";
      e.retargetTimer = 0; // 回避後は追跡目標を引き直す
    }
  } else {
    // CHASE：1.0〜2.0 s ごと（到達時・行き詰まり時も）に最寄り生存プレイヤー周辺の床タイルを
    // 目標に引き直し、目標へ直進する（生存者がいなければ引き直しを見送る）
    const anchor = nearestAlive(e.x, e.y, ctx.players);
    stepToTarget(e, dt, c, ctx.blockers, ctx.stage, ctx.rng, () =>
      anchor ? pickChaseTarget(ctx.stage, ctx.rng, anchor) : null,
    );
  }

  // --- 射撃（ローバーと同条件。GDD §6 v0.9） ---
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
