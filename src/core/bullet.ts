/**
 * 弾の移動・跳弾（入射角＝反射角）・相殺・対戦車命中判定（Phaser 非依存の純粋 TS）。
 */
import { BALANCE } from "../config/balance";
import { type ParsedStage, reflectsBullet, stopsBullet, tileAt } from "./stage";

/** 弾 */
export interface Bullet {
  x: number;
  y: number;
  vx: number; // 速度 [px/s]
  vy: number;
  radius: number;
  bounces: number; // これまでの反射回数
  owner: object; // 同時発射数のカウント用（弾自体は発射者を問わず全戦車に当たる）
  dead: boolean;
}

/** 弾生成の調整値 */
export interface BulletSpawnConfig {
  SPEED: number;
  RADIUS: number;
  MUZZLE_OFFSET: number;
}

/** 弾の生成。owner の砲口位置から angle 方向へ発射し、bullets に追加する */
export function spawnBullet(
  bullets: Bullet[],
  owner: { x: number; y: number },
  angle: number,
  cfg: BulletSpawnConfig = BALANCE.BULLET,
): Bullet {
  const b: Bullet = {
    x: owner.x + Math.cos(angle) * cfg.MUZZLE_OFFSET,
    y: owner.y + Math.sin(angle) * cfg.MUZZLE_OFFSET,
    vx: Math.cos(angle) * cfg.SPEED,
    vy: Math.sin(angle) * cfg.SPEED,
    radius: cfg.RADIUS,
    bounces: 0,
    owner,
    dead: false,
  };
  bullets.push(b);
  return b;
}

/** owner が場に出している生存弾の数 */
export function liveBulletCount(bullets: readonly Bullet[], owner: object): number {
  let n = 0;
  for (const b of bullets) if (!b.dead && b.owner === owner) n++;
  return n;
}

/** 円と重なる「弾を止めるタイル」の矩形とタイル文字（なければ null） */
interface WallHit {
  left: number;
  top: number;
  right: number;
  bottom: number;
  ch: string;
}

function circleHitsWall(stage: ParsedStage, x: number, y: number, rad: number): WallHit | null {
  const t = stage.tile;
  const c0 = Math.floor((x - rad) / t);
  const c1 = Math.floor((x + rad) / t);
  const r0 = Math.floor((y - rad) / t);
  const r1 = Math.floor((y + rad) / t);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const ch = tileAt(stage, c, r);
      if (!stopsBullet(ch)) continue;
      const left = c * t;
      const top = r * t;
      // 円と矩形（AABB）の判定：円中心を矩形にクランプして距離を比較
      const nx = Math.max(left, Math.min(x, left + t));
      const ny = Math.max(top, Math.min(y, top + t));
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < rad * rad) {
        return { left, top, right: left + t, bottom: top + t, ch };
      }
    }
  }
  return null;
}

/**
 * 弾の移動と跳弾（入射角＝反射角）。
 * 軸ごとに移動→衝突判定→該当軸の速度反転＋押し戻し。
 * 角で同フレームに両軸が反射しても反射回数は「1回」と数える。
 * 破壊可能壁 X に触れた弾は反射せず消滅する（GDD §5。壁は壊れない）。
 * ※弾速200px/s × dt上限0.05s = 最大10px/フレーム < タイル32px なので突き抜けは起きない。
 */
export function updateBullet(
  b: Bullet,
  dt: number,
  stage: ParsedStage,
  maxBounces: number = BALANCE.BULLET.MAX_BOUNCES,
): void {
  const eps = BALANCE.EPS;
  let bounced = false;

  // --- X軸移動 ---
  b.x += b.vx * dt;
  let hit = circleHitsWall(stage, b.x, b.y, b.radius);
  if (hit) {
    if (!reflectsBullet(hit.ch)) {
      b.dead = true; // 破壊可能壁：反射せず消滅
      return;
    }
    if (b.vx > 0) b.x = hit.left - b.radius - eps;
    else b.x = hit.right + b.radius + eps;
    b.vx = -b.vx; // X面での反射（入射角＝反射角）
    bounced = true;
  }

  // --- Y軸移動 ---
  b.y += b.vy * dt;
  hit = circleHitsWall(stage, b.x, b.y, b.radius);
  if (hit) {
    if (!reflectsBullet(hit.ch)) {
      b.dead = true;
      return;
    }
    if (b.vy > 0) b.y = hit.top - b.radius - eps;
    else b.y = hit.bottom + b.radius + eps;
    b.vy = -b.vy; // Y面での反射
    bounced = true;
  }

  if (bounced) {
    b.bounces++;
    if (b.bounces > maxBounces) b.dead = true; // 反射上限超過（2回目の壁接触）で消滅
  }
}

/** 弾同士の相殺：接触した2発を両方消滅させる（GDD §5） */
export function resolveBulletVsBullet(bullets: Bullet[]): void {
  for (let i = 0; i < bullets.length; i++) {
    const a = bullets[i]!;
    if (a.dead) continue;
    for (let j = i + 1; j < bullets.length; j++) {
      const c = bullets[j]!;
      if (c.dead) continue;
      const dx = a.x - c.x;
      const dy = a.y - c.y;
      const rr = a.radius + c.radius;
      if (dx * dx + dy * dy < rr * rr) {
        a.dead = true;
        c.dead = true;
      }
    }
  }
}

/** 弾 vs 戦車（円近似）。弾は発射者を問わず全戦車に当たる（自分の跳ね返り弾で自爆あり） */
export function bulletHitsTank(b: Bullet, tank: { x: number; y: number; radius: number }): boolean {
  const dx = b.x - tank.x;
  const dy = b.y - tank.y;
  const rr = b.radius + tank.radius;
  return dx * dx + dy * dy < rr * rr;
}
