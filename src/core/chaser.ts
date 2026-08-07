/**
 * 敵F「チェイサー」（追跡型）のAI（GDD §6 v0.9）。
 * 移動・回避は敵B「ローバー」の WANDER/DODGE 構造の流用。差分：
 *   - 移動 110px/s。徘徊ではなく**プレイヤー追跡**＝最寄り生存プレイヤーの周辺
 *     （±3タイル以内）の床タイルを目標に選び、1.0〜2.0 s ごとに引き直し続ける
 *   - 照準 200°/s
 *   - 弾 225px/s（難易度弾速倍率の対象）・反射1回・同時1発・発射間隔 平均 1.0±0.3 s（難易度倍率対象）
 *   - 回避はローバーと同方式だが**成功率50%固定**（難易度対象外。GDD §6 v0.9）
 * Phaser 非依存の純粋 TS。乱数は Rng を注入して決定的テスト可能。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, ENEMY_BULLET_CFG, liveBulletCount, scaleBulletSpeed, spawnBullet } from "./bullet";
import { type DifficultyMods, NORMAL_MODS } from "./difficulty";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import { type ParsedStage, tileAt } from "./stage";
import { moveTank, type TankBlocker } from "./tank";
import { selectTarget, type TargetInfo } from "./targeting";
import type { TankBody, Vec2 } from "./types";

/** チェイサーの状態名（CHASE＝追跡移動。ローバーの WANDER に相当） */
export type ChaserFsmState = "CHASE" | "DODGE";

/** チェイサー戦車 */
export interface ChaserTank extends TankBody {
  kind: "chaser";
  state: ChaserFsmState;
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  target: Vec2; // 現在の移動目標点（px。最寄り生存プレイヤー周辺の床タイル中心）
  retargetTimer: number; // 目標を引き直すまでの残り時間 [s]（1.0〜2.0 s）
  stuckTimer: number; // 行き詰まり（壁・戦車）継続時間 [s]
  dodgeTimer: number; // DODGE の残り時間 [s]
  dodgeDir: Vec2; // 回避方向（単位ベクトル）
  dodgeCooldown: number; // 次の回避判定までの残り時間 [s]
}

/** 次回発射間隔（平均±ゆらぎ）×難易度倍率 を引く（GDD §8.3） */
export function chaserNextInterval(rng: Rng, intervalMult = 1): number {
  const c = BALANCE.CHASER;
  return (c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR)) * intervalMult;
}

/** チェイサーを生成する（初期は下向き。目標は自位置＝初回更新で引き直される。mods 省略時は NORMAL 相当） */
export function createChaser(x: number, y: number, rng: Rng, mods: DifficultyMods = NORMAL_MODS): ChaserTank {
  return {
    kind: "chaser",
    x,
    y,
    bodyAngle: Math.PI / 2,
    turretAngle: Math.PI / 2,
    half: BALANCE.CHASER.SIZE / 2,
    radius: BALANCE.CHASER.RADIUS,
    alive: true,
    state: "CHASE",
    fireTimer: chaserNextInterval(rng, mods.fireIntervalMult),
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

/** 最寄りの生存プレイヤー（追跡のアンカー。いなければ null） */
function nearestAlivePlayer(e: ChaserTank, players: readonly TargetInfo[]): TargetInfo | null {
  let best: TargetInfo | null = null;
  let bestDistSq = Infinity;
  for (const p of players) {
    if (!p.alive) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      best = p;
      bestDistSq = distSq;
    }
  }
  return best;
}

/** 弾がいずれかのプレイヤーの発射した弾か（参照比較。ローバーと同方式） */
function isPlayerBullet(b: Bullet, players: readonly TargetInfo[]): boolean {
  for (const p of players) if ((p as object) === b.owner) return true;
  return false;
}

/** 接近中のプレイヤー弾（回避のきっかけ）を探す。なければ null */
function findThreatBullet(e: ChaserTank, ctx: ChaserUpdateContext): Bullet | null {
  const c = BALANCE.CHASER;
  for (const b of ctx.bullets) {
    if (b.dead || !isPlayerBullet(b, ctx.players)) continue;
    const dx = e.x - b.x;
    const dy = e.y - b.y;
    if (dx * dx + dy * dy > c.DODGE_DETECT_RADIUS * c.DODGE_DETECT_RADIUS) continue;
    if (dx * b.vx + dy * b.vy > 0) return b; // 弾がこちらへ向かっている
  }
  return null;
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

  // --- 回避判定：プレイヤー弾の接近を検知したら 50% 固定で DODGE へ遷移（ローバーと同方式） ---
  if (e.dodgeCooldown > 0) e.dodgeCooldown -= dt;
  if (e.state === "CHASE" && e.dodgeCooldown <= 0) {
    const threat = findThreatBullet(e, ctx);
    if (threat) {
      e.dodgeCooldown = c.DODGE_COOLDOWN; // 成功・失敗に関わらず判定間隔を空ける
      if (ctx.rng() < c.DODGE_CHANCE) {
        // 弾道と垂直方向へ短く逃げる（左右はランダム）
        const len = Math.hypot(threat.vx, threat.vy) || 1;
        const sign = ctx.rng() < 0.5 ? 1 : -1;
        e.dodgeDir = { x: (-threat.vy / len) * sign, y: (threat.vx / len) * sign };
        e.dodgeTimer = c.DODGE_TIME;
        e.state = "DODGE";
      }
    }
  }

  // --- 移動（状態別） ---
  if (e.state === "DODGE") {
    moveTank(e, e.dodgeDir.x * c.SPEED * dt, e.dodgeDir.y * c.SPEED * dt, ctx.blockers, ctx.stage);
    e.dodgeTimer -= dt;
    if (e.dodgeTimer <= 0) {
      e.state = "CHASE";
      e.retargetTimer = 0; // 回避後は追跡目標を引き直す
    }
  } else {
    // CHASE：1.0〜2.0 s ごと（到達時・行き詰まり時も）に最寄り生存プレイヤー周辺の床タイルを
    // 目標に引き直し、目標へ直進する（GDD §6 v0.9「プレイヤー周辺の床タイルを目標に選び直し続ける」）
    const anchor = nearestAlivePlayer(e, ctx.players);
    e.retargetTimer -= dt;
    const distToTarget = Math.hypot(e.target.x - e.x, e.target.y - e.y);
    if (anchor && (e.retargetTimer <= 0 || distToTarget < c.ARRIVE_DIST)) {
      e.target = pickChaseTarget(ctx.stage, ctx.rng, anchor);
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
        if (e.stuckTimer >= c.STUCK_TIME && anchor) {
          e.target = pickChaseTarget(ctx.stage, ctx.rng, anchor);
          e.retargetTimer = randRange(ctx.rng, c.RETARGET_INTERVAL_MIN, c.RETARGET_INTERVAL_MAX);
          e.stuckTimer = 0;
        }
      } else {
        e.stuckTimer = 0;
      }
    }
  }

  // --- 射撃（ローバーと同条件。GDD §6 v0.9） ---
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
    spawnBullet(ctx.bullets, e, e.turretAngle, scaleBulletSpeed(ENEMY_BULLET_CFG, mods.bulletSpeedMult), ctx.stage);
    e.fireTimer = chaserNextInterval(ctx.rng, mods.fireIntervalMult);
  }
}
