/**
 * 敵B「ローバー」（遊撃型）のAI。ステートマシン（状態機械）で実装（GDD §6）。
 * 状態遷移：WANDER（徘徊：数秒ごとにランダムな床タイルを目標に直進）⇄ DODGE（短い回避移動）。
 * 砲塔追従（150°/s）と射撃判断は全状態共通。発射条件はセントリーと同様
 * （発射間隔消化・同時1発・照準許容角 ±0.15rad・射線が通る・開幕グレース明け）。
 * 徘徊移動・回避・発射判定の手順は移動型4種で共通のため enemyAi.ts に集約してある。
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
import { selectTarget, type TargetInfo } from "./targeting";
import type { Vec2 } from "./types";

/** ローバーの状態名 */
export type RoverFsmState = "WANDER" | "DODGE";

/** ローバー戦車 */
export interface RoverTank extends MoveState, DodgeState {
  kind: "rover";
  state: RoverFsmState;
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
}

/** ローバーを生成する（初期は下向き。目標は自位置＝初回更新で引き直される。mods 省略時は NORMAL 相当） */
export function createRover(
  x: number,
  y: number,
  rng: Rng,
  mods: DifficultyMods = NORMAL_MODS,
): RoverTank {
  return {
    ...createEnemyBody("rover", x, y, BALANCE.ROVER),
    state: "WANDER",
    fireTimer: rollFireInterval(rng, BALANCE.ROVER, mods.fireIntervalMult),
    target: { x, y },
    retargetTimer: 0,
    stuckTimer: 0,
    dodgeTimer: 0,
    dodgeDir: { x: 0, y: 0 },
    dodgeCooldown: 0,
  };
}

/**
 * ランダムな床タイルの中心を徘徊目標として抽選する（ローバー・マインレイヤー・シールダーで共用）。
 * 一定回数（tries）試して床が引けなければ fallback（現在位置＝その場に留まる）を返す。
 * 壁・穴タイルは選ばない（GDD「壁は回避」。移動中の衝突は moveTank ＋行き詰まり検知で解決）。
 */
export function pickWanderTarget(
  stage: ParsedStage,
  rng: Rng,
  fallback: Vec2,
  tries: number = BALANCE.ROVER.WANDER_PICK_TRIES,
): Vec2 {
  for (let i = 0; i < tries; i++) {
    const col = 1 + Math.floor(rng() * (stage.cols - 2));
    const row = 1 + Math.floor(rng() * (stage.rows - 2));
    if (tileAt(stage, col, row) === ".") {
      return {
        x: col * stage.tile + stage.tile / 2,
        y: row * stage.tile + stage.tile / 2,
      };
    }
  }
  return { x: fallback.x, y: fallback.y };
}

/** updateRover に渡す周辺情報 */
export interface RoverUpdateContext {
  players: readonly TargetInfo[]; // 全プレイヤー（標的選択と弾の owner 識別に使う。実体の PlayerTank を渡すこと）
  bullets: Bullet[];
  blockers: readonly TankBlocker[]; // 自分以外の全戦車（通り抜け不可・回避対象）
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
  mods?: DifficultyMods; // 難易度の実効調整値（省略時は NORMAL 相当。GDD §8.3）
}

/** ローバーの更新（1フレーム分。dt は秒） */
export function updateRover(e: RoverTank, dt: number, ctx: RoverUpdateContext): void {
  const c = BALANCE.ROVER;
  const mods = ctx.mods ?? NORMAL_MODS;

  // --- 標的選択（GDD §12.5）：射線が通る最も近い生存者。全員遮蔽なら最も近い生存者（照準のみ） ---
  const pick = selectTarget(ctx.stage, e.x, e.y, ctx.players);

  // --- 砲塔照準（全状態共通）：標的へ追従 ---
  const toPlayer = pick ? Math.atan2(pick.target.y - e.y, pick.target.x - e.x) : e.turretAngle;
  if (pick) e.turretAngle = rotateToward(e.turretAngle, toPlayer, c.TURN_SPEED * dt);

  // --- 回避判定：プレイヤー弾の接近を検知したら難易度連動の確率で DODGE へ遷移
  //     （EASY35%／NORMAL50%／HARD65%。GDD §8.3 v0.9） ---
  const dodging = tryStartDodge(
    e,
    dt,
    ctx.bullets,
    ctx.players,
    c,
    mods.roverDodgeChance,
    ctx.rng,
    e.state === "WANDER",
  );
  if (dodging) e.state = "DODGE";

  // --- 移動（状態別） ---
  if (e.state === "DODGE") {
    if (stepDodge(e, dt, c, ctx.blockers, ctx.stage)) {
      e.state = "WANDER";
      e.retargetTimer = 0; // 回避後は目標を引き直す
    }
  } else {
    // WANDER：数秒ごと（到達時・行き詰まり時も）に目標を引き直し、目標へ直進する
    stepToTarget(e, dt, c, ctx.blockers, ctx.stage, ctx.rng, () =>
      pickWanderTarget(ctx.stage, ctx.rng, e),
    );
  }

  // --- 射撃（セントリーと同条件。GDD §6） ---
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
