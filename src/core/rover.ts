/**
 * 敵B「ローバー」（遊撃型）のAI。ステートマシン（状態機械）で実装（GDD §6）。
 * 状態遷移：WANDER（徘徊：数秒ごとにランダムな床タイルを目標に直進）⇄ DODGE（短い回避移動）。
 * 砲塔追従（120°/s）と射撃判断は全状態共通。発射条件はセントリーと同様
 * （発射間隔消化・同時1発・照準許容角 ±0.15rad・射線が通る・開幕グレース明け）。
 * Phaser 非依存の純粋 TS。乱数は Rng を注入して決定的テスト可能。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, ENEMY_BULLET_CFG, liveBulletCount, spawnBullet } from "./bullet";
import { hasLineOfSight } from "./los";
import { angleDiff, randRange, type Rng, rotateToward } from "./mathUtils";
import { type ParsedStage, tileAt } from "./stage";
import { moveTank, type TankBlocker } from "./tank";
import type { TankBody, Vec2 } from "./types";

/** ローバーの状態名 */
export type RoverFsmState = "WANDER" | "DODGE";

/** ローバー戦車 */
export interface RoverTank extends TankBody {
  kind: "rover";
  state: RoverFsmState;
  fireTimer: number; // 次に撃てるまでの残り時間 [s]
  target: Vec2; // 現在の移動目標点（px）
  retargetTimer: number; // 目標を引き直すまでの残り時間 [s]
  stuckTimer: number; // 行き詰まり（壁・戦車）継続時間 [s]
  dodgeTimer: number; // DODGE の残り時間 [s]
  dodgeDir: Vec2; // 回避方向（単位ベクトル）
  dodgeCooldown: number; // 次の回避判定までの残り時間 [s]
}

/** 次回発射間隔（平均±ゆらぎ）を引く */
export function roverNextInterval(rng: Rng): number {
  const c = BALANCE.ROVER;
  return c.FIRE_INTERVAL_MEAN + randRange(rng, -c.FIRE_INTERVAL_VAR, c.FIRE_INTERVAL_VAR);
}

/** ローバーを生成する（初期は下向き。目標は自位置＝初回更新で引き直される） */
export function createRover(x: number, y: number, rng: Rng): RoverTank {
  return {
    kind: "rover",
    x,
    y,
    bodyAngle: Math.PI / 2,
    turretAngle: Math.PI / 2,
    half: BALANCE.ROVER.SIZE / 2,
    radius: BALANCE.ROVER.RADIUS,
    alive: true,
    state: "WANDER",
    fireTimer: roverNextInterval(rng),
    target: { x, y },
    retargetTimer: 0,
    stuckTimer: 0,
    dodgeTimer: 0,
    dodgeDir: { x: 0, y: 0 },
    dodgeCooldown: 0,
  };
}

/**
 * ランダムな床タイルの中心を徘徊目標として抽選する。
 * 一定回数試して床が引けなければ fallback（現在位置＝その場に留まる）を返す。
 * 壁・穴タイルは選ばない（GDD「壁は回避」。移動中の衝突は moveTank ＋行き詰まり検知で解決）。
 */
export function pickWanderTarget(stage: ParsedStage, rng: Rng, fallback: Vec2): Vec2 {
  const c = BALANCE.ROVER;
  for (let i = 0; i < c.WANDER_PICK_TRIES; i++) {
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
  player: Vec2; // プレイヤー（弾の owner 識別にも同一オブジェクトを渡すこと）
  bullets: Bullet[];
  blockers: readonly TankBlocker[]; // 自分以外の全戦車（通り抜け不可・回避対象）
  stage: ParsedStage;
  grace: number; // 開幕グレースの残り時間 [s]（>0 の間は撃たない）
  rng: Rng;
}

/** 接近中のプレイヤー弾（回避のきっかけ）を探す。なければ null */
function findThreatBullet(e: RoverTank, ctx: RoverUpdateContext): Bullet | null {
  const c = BALANCE.ROVER;
  for (const b of ctx.bullets) {
    if (b.dead || b.owner !== ctx.player) continue; // プレイヤーの弾のみ警戒（GDD §6）
    const dx = e.x - b.x;
    const dy = e.y - b.y;
    if (dx * dx + dy * dy > c.DODGE_DETECT_RADIUS * c.DODGE_DETECT_RADIUS) continue;
    if (dx * b.vx + dy * b.vy > 0) return b; // 弾がこちらへ向かっている
  }
  return null;
}

/** ローバーの更新（1フレーム分。dt は秒） */
export function updateRover(e: RoverTank, dt: number, ctx: RoverUpdateContext): void {
  const c = BALANCE.ROVER;
  const p = ctx.player;

  // --- 砲塔照準（全状態共通）：プレイヤーへ 120°/s で追従 ---
  const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
  e.turretAngle = rotateToward(e.turretAngle, toPlayer, c.TURN_SPEED * dt);

  // --- 回避判定：プレイヤー弾の接近を検知したら低確率で DODGE へ遷移 ---
  if (e.dodgeCooldown > 0) e.dodgeCooldown -= dt;
  if (e.state === "WANDER" && e.dodgeCooldown <= 0) {
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
      e.state = "WANDER";
      e.retargetTimer = 0; // 回避後は目標を引き直す
    }
  } else {
    // WANDER：数秒ごと（到達時・行き詰まり時も）に目標を引き直し、目標へ直進する
    e.retargetTimer -= dt;
    const distToTarget = Math.hypot(e.target.x - e.x, e.target.y - e.y);
    if (e.retargetTimer <= 0 || distToTarget < c.ARRIVE_DIST) {
      e.target = pickWanderTarget(ctx.stage, ctx.rng, e);
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
          e.target = pickWanderTarget(ctx.stage, ctx.rng, e);
          e.retargetTimer = randRange(ctx.rng, c.RETARGET_INTERVAL_MIN, c.RETARGET_INTERVAL_MAX);
          e.stuckTimer = 0;
        }
      } else {
        e.stuckTimer = 0;
      }
    }
  }

  // --- 射撃（セントリーと同条件。GDD §6） ---
  e.fireTimer -= dt;
  if (e.fireTimer < 0) e.fireTimer = 0;
  const ready =
    ctx.grace <= 0 && // 開幕グレース明け
    e.fireTimer <= 0 && // 発射間隔を消化済み
    liveBulletCount(ctx.bullets, e) < c.MAX_BULLETS && // 同時1発
    Math.abs(angleDiff(toPlayer, e.turretAngle)) < c.FIRE_ANGLE_TOL && // 砲塔がほぼ狙い通り
    hasLineOfSight(ctx.stage, e.x, e.y, p.x, p.y); // 射線が通っている
  if (ready) {
    spawnBullet(ctx.bullets, e, e.turretAngle, ENEMY_BULLET_CFG);
    e.fireTimer = roverNextInterval(ctx.rng);
  }
}
