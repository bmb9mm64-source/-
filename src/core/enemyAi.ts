/**
 * 敵AI 10種で共通する部品（Phaser 非依存の純粋 TS）。
 *
 * 各敵モジュール（sentry / rover / …）に同じ形で書かれていた次の5つをここへ集約する。
 * 挙動は完全に不変で、**乱数（Rng）の消費順序も元の実装と同一**（回帰テストの前提）。
 *   1. 発射間隔の抽選            … rollFireInterval
 *   2. 敵戦車の共通初期状態      … createEnemyBody
 *   3. 照準ブレの引き直し        … rollAimJitter
 *   4. 発射判定＋発射            … tryEnemyFire
 *   5. 目標へ直進する移動        … stepToTarget（徘徊・追跡で共用）
 *   6. プレイヤー弾からの回避    … tryStartDodge / stepDodge
 *
 * 調整値（BALANCE.SENTRY など）はそのまま渡せるよう、必要なキーだけを要求する
 * 構造的な型で受ける（CLAUDE.md「調整値は balance.ts に集約」を崩さないため）。
 */
import type { Bullet, BulletSpawnConfig } from "./bullet";
import { liveBulletCount, spawnBullet } from "./bullet";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import type { ParsedStage } from "./stage";
import { moveTank, type TankBlocker } from "./tank";
import type { TargetInfo } from "./targeting";
import type { TankBody, Vec2 } from "./types";

// --- 1. 発射間隔 ----------------------------------------------------------

/** 「平均±ゆらぎ」の間隔を持つ調整値 */
export interface IntervalConfig {
  FIRE_INTERVAL_MEAN: number;
  FIRE_INTERVAL_VAR: number;
}

/**
 * 次回発射間隔（平均±ゆらぎ）×難易度倍率 を引く（GDD §8.3：EASY×1.4／HARD×0.75）。
 * 敵10種すべてがこの式を使う。
 */
export function rollFireInterval(rng: Rng, cfg: IntervalConfig, intervalMult = 1): number {
  return (
    (cfg.FIRE_INTERVAL_MEAN + randRange(rng, -cfg.FIRE_INTERVAL_VAR, cfg.FIRE_INTERVAL_VAR)) *
    intervalMult
  );
}

// --- 2. 共通初期状態 ------------------------------------------------------

/** 車体サイズを持つ調整値 */
export interface BodyConfig {
  SIZE: number;
  RADIUS: number;
}

/**
 * 敵戦車の共通初期状態（車体・砲塔とも初期は下向き＝GDD の既定）。
 * 各 create* はこれを展開してから固有のタイマー・状態を足す。
 */
export function createEnemyBody<K extends string>(
  kind: K,
  x: number,
  y: number,
  cfg: BodyConfig,
): TankBody & { kind: K } {
  return {
    kind,
    x,
    y,
    bodyAngle: Math.PI / 2, // 車体の向き（固定砲台では見た目のみ）
    turretAngle: Math.PI / 2,
    half: cfg.SIZE / 2,
    radius: cfg.RADIUS,
    alive: true,
  };
}

// --- 3. 照準ブレ ----------------------------------------------------------

/** 照準ブレの調整値（持たない敵＝精密照準は cfg ごと渡さない） */
export interface JitterConfig {
  JITTER_MAX: number;
  JITTER_INTERVAL_MIN: number;
  JITTER_INTERVAL_MAX: number;
}

/** 照準ブレを持つ敵の状態 */
export interface JitterState {
  jitter: number; // 現在の照準ブレ [rad]
  jitterTimer: number; // 引き直しまでの残り時間 [s]
}

/** 引き直し時間が来ていればブレ量を引き直す（rng を2回消費：ブレ量→次回間隔） */
export function rollAimJitter(e: JitterState, dt: number, cfg: JitterConfig, rng: Rng): void {
  e.jitterTimer -= dt;
  if (e.jitterTimer <= 0) {
    e.jitter = randRange(rng, -cfg.JITTER_MAX, cfg.JITTER_MAX);
    e.jitterTimer = randRange(rng, cfg.JITTER_INTERVAL_MIN, cfg.JITTER_INTERVAL_MAX);
  }
}

// --- 4. 発射判定 ----------------------------------------------------------

/** 発射判定の調整値 */
export interface FireConfig extends IntervalConfig {
  MAX_BULLETS: number; // 同時発射数上限
  FIRE_ANGLE_TOL: number; // 発射許可の照準許容角 [rad]
}

/** 発射タイマーを持つ敵の状態 */
export interface FireState extends TankBody {
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
}

/** tryEnemyFire が参照する周辺情報（各敵の UpdateContext がそのまま渡せる形） */
export interface FireContext {
  bullets: Bullet[];
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
}

/**
 * 移動型の敵に共通する「発射判定＋発射」（GDD §6）。
 * 条件：開幕グレース明け・発射間隔消化・同時発射数に空きあり・標的への射線あり・
 *       砲塔が狙い方向 ±FIRE_ANGLE_TOL 以内。撃てば次回間隔を引き直して true を返す。
 */
export function tryEnemyFire(
  e: FireState,
  dt: number,
  ctx: FireContext,
  aimAngle: number,
  hasLos: boolean,
  cfg: FireConfig,
  bulletCfg: BulletSpawnConfig,
  intervalMult: number,
): boolean {
  e.fireTimer -= dt;
  if (e.fireTimer < 0) e.fireTimer = 0;
  const ready =
    ctx.grace <= 0 &&
    e.fireTimer <= 0 &&
    liveBulletCount(ctx.bullets, e) < cfg.MAX_BULLETS &&
    hasLos &&
    Math.abs(angleDiff(aimAngle, e.turretAngle)) < cfg.FIRE_ANGLE_TOL;
  if (!ready) return false;
  spawnBullet(ctx.bullets, e, e.turretAngle, bulletCfg, ctx.stage);
  e.fireTimer = rollFireInterval(ctx.rng, cfg, intervalMult);
  return true;
}

// --- 5. 目標へ直進する移動（徘徊・追跡で共用） ------------------------------

/** 目標追従移動の調整値 */
export interface MoveConfig {
  SPEED: number;
  BODY_TURN_SPEED: number;
  ARRIVE_DIST: number; // 目標到達とみなす距離 [px]
  STUCK_TIME: number; // 行き詰まりと判断するまでの時間 [s]
  RETARGET_INTERVAL_MIN: number;
  RETARGET_INTERVAL_MAX: number;
}

/** 目標追従移動を行う敵の状態 */
export interface MoveState extends TankBody {
  target: Vec2; // 現在の移動目標点（px）
  retargetTimer: number; // 目標を引き直すまでの残り時間 [s]
  stuckTimer: number; // 行き詰まり継続時間 [s]
}

/**
 * 目標点へ直進する移動（敵B・D・F・S 共通）。
 * 到達時・引き直し時間切れ・行き詰まり継続時に pickTarget() で目標を引き直す。
 * pickTarget が null を返した場合は引き直しを見送る（チェイサーで生存者がいないとき）。
 */
export function stepToTarget(
  e: MoveState,
  dt: number,
  cfg: MoveConfig,
  blockers: readonly TankBlocker[],
  stage: ParsedStage,
  rng: Rng,
  pickTarget: () => Vec2 | null,
): void {
  const retarget = (): void => {
    const next = pickTarget();
    if (!next) return;
    e.target = next;
    e.retargetTimer = randRange(rng, cfg.RETARGET_INTERVAL_MIN, cfg.RETARGET_INTERVAL_MAX);
  };

  e.retargetTimer -= dt;
  const distToTarget = Math.hypot(e.target.x - e.x, e.target.y - e.y);
  if (e.retargetTimer <= 0 || distToTarget < cfg.ARRIVE_DIST) retarget();

  const dx = e.target.x - e.x;
  const dy = e.target.y - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= cfg.ARRIVE_DIST) return;

  const step = Math.min(cfg.SPEED * dt, dist);
  const prevX = e.x;
  const prevY = e.y;
  moveTank(e, (dx / dist) * step, (dy / dist) * step, blockers, stage);
  e.bodyAngle = rotateToward(e.bodyAngle, Math.atan2(dy, dx), cfg.BODY_TURN_SPEED * dt);

  // 壁・他戦車に阻まれてほとんど進めない状態が続いたら目標を引き直す
  if (Math.hypot(e.x - prevX, e.y - prevY) < step * 0.5) {
    e.stuckTimer += dt;
    if (e.stuckTimer >= cfg.STUCK_TIME) {
      const before = e.retargetTimer;
      retarget();
      if (e.retargetTimer !== before) e.stuckTimer = 0; // 引き直せたときだけ計測をリセット
    }
  } else {
    e.stuckTimer = 0;
  }
}

// --- 6. プレイヤー弾からの回避 --------------------------------------------

/** 回避行動の調整値 */
export interface DodgeConfig {
  SPEED: number;
  DODGE_DETECT_RADIUS: number; // プレイヤー弾の接近を検知する半径 [px]
  DODGE_TIME: number; // 回避移動の継続時間 [s]
  DODGE_COOLDOWN: number; // 回避判定のクールダウン [s]（毎フレーム抽選しない）
}

/** 回避行動を行う敵の状態 */
export interface DodgeState extends TankBody {
  dodgeTimer: number;
  dodgeDir: Vec2; // 回避方向（単位ベクトル）
  dodgeCooldown: number;
}

/** 弾がいずれかのプレイヤーの発射した弾か（参照比較。GDD §12.5：2P の弾も回避対象） */
function isPlayerBullet(b: Bullet, players: readonly TargetInfo[]): boolean {
  for (const p of players) if ((p as object) === b.owner) return true;
  return false;
}

/** 接近中のプレイヤー弾（回避のきっかけ）を探す。なければ null */
export function findThreatBullet(
  e: Vec2,
  bullets: readonly Bullet[],
  players: readonly TargetInfo[],
  detectRadius: number,
): Bullet | null {
  for (const b of bullets) {
    if (b.dead || !isPlayerBullet(b, players)) continue; // プレイヤーの弾のみ警戒（GDD §6）
    const dx = e.x - b.x;
    const dy = e.y - b.y;
    if (dx * dx + dy * dy > detectRadius * detectRadius) continue;
    if (dx * b.vx + dy * b.vy > 0) return b; // 弾がこちらへ向かっている
  }
  return null;
}

/**
 * 回避判定（敵B・F 共通。GDD §6）。クールダウンの消化もここで行う。
 * canStart が false（回避中など）ならクールダウンを進めるだけ。
 * 接近弾を見つけたら成否に関わらずクールダウンを置き、chance の抽選に当たれば
 * 弾道と垂直方向（左右ランダム）へ逃げる向きを決めて true を返す。
 */
export function tryStartDodge(
  e: DodgeState,
  dt: number,
  bullets: readonly Bullet[],
  players: readonly TargetInfo[],
  cfg: DodgeConfig,
  chance: number,
  rng: Rng,
  canStart: boolean,
): boolean {
  if (e.dodgeCooldown > 0) e.dodgeCooldown -= dt;
  if (!canStart || e.dodgeCooldown > 0) return false;
  const threat = findThreatBullet(e, bullets, players, cfg.DODGE_DETECT_RADIUS);
  if (!threat) return false;
  e.dodgeCooldown = cfg.DODGE_COOLDOWN; // 成功・失敗に関わらず判定間隔を空ける
  if (rng() >= chance) return false;
  const len = Math.hypot(threat.vx, threat.vy) || 1;
  const sign = rng() < 0.5 ? 1 : -1;
  e.dodgeDir = { x: (-threat.vy / len) * sign, y: (threat.vx / len) * sign };
  e.dodgeTimer = cfg.DODGE_TIME;
  return true;
}

/** 回避中の移動（1フレーム分）。回避時間が尽きたら true（呼び出し側が状態を戻す） */
export function stepDodge(
  e: DodgeState,
  dt: number,
  cfg: DodgeConfig,
  blockers: readonly TankBlocker[],
  stage: ParsedStage,
): boolean {
  moveTank(e, e.dodgeDir.x * cfg.SPEED * dt, e.dodgeDir.y * cfg.SPEED * dt, blockers, stage);
  e.dodgeTimer -= dt;
  return e.dodgeTimer <= 0;
}
