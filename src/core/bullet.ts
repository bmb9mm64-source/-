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
  maxBounces?: number; // この弾固有の反射上限（未設定＝BALANCE.BULLET.MAX_BOUNCES。敵E弾は2。GDD §6 v0.9）
  owner: BulletOwner; // 発射者（同時発射数のカウントと、発射直後の自弾判定に使う）
  ownerIsPlayer: boolean; // 発射者がプレイヤー側か（v0.12：敵弾は敵に当たらない。GDD §5.2）
  armed: boolean; // 発射者から一度離れたか（GDD §5.3 v0.12：離れるまで発射者には当たらない）
  fuse?: number; // 榴弾の炸裂までの残り時間 [s]（敵M「ボマー」の弾のみ。GDD §6 v0.14）
  blastRadius?: number; // 炸裂時の爆風半径 [px]（fuse を持つ弾のみ）
  detonated?: boolean; // このフレームで炸裂したか（world が爆風処理に使う）
  dead: boolean;
}

/** 弾の発射者（戦車。参照の同一性で「自分の弾か」を判定する） */
export interface BulletOwner {
  x: number;
  y: number;
  radius?: number; // 対弾用の円近似半径 [px]（省略時はプレイヤー相当）
  kind?: string; // "player" ならプレイヤー側（GDD §5.2）
}

/** 弾が発射者から離れたら「発射者にも当たる」状態にする（GDD §5.3 v0.12） */
export function updateBulletArming(b: Bullet): void {
  if (b.armed) return;
  const o = b.owner;
  const clear = (o.radius ?? BALANCE.PLAYER.RADIUS) + b.radius;
  if (Math.hypot(b.x - o.x, b.y - o.y) > clear) b.armed = true;
}

/** 弾生成の調整値 */
export interface BulletSpawnConfig {
  SPEED: number;
  RADIUS: number;
  MUZZLE_OFFSET: number;
  MAX_BOUNCES?: number; // 弾固有の反射上限（省略時は共通の BALANCE.BULLET.MAX_BOUNCES）
  FUSE?: number; // 榴弾：炸裂までの時間 [s]（設定すると反射せず、時間切れ／壁接触で炸裂する）
  BLAST_RADIUS?: number; // 榴弾：炸裂時の爆風半径 [px]
}

/**
 * 砲口位置を壁に入らない範囲へ補正する（GDD §5.3 v0.12）。
 * 砲口オフセット（22px）は車体半辺（14px）より外側にあるため、壁に密着して壁の方向へ撃つと
 * 弾が壁タイルの内部に生成され、押し戻しで自機に即命中する／壁をすり抜ける／横へ瞬間移動する。
 * 発射者中心から砲口へ向かって、壁に入らない最も遠い距離を探して返す。
 */
function safeMuzzleOffset(
  stage: ParsedStage,
  ox: number,
  oy: number,
  cos: number,
  sin: number,
  cfg: BulletSpawnConfig,
): number {
  const step = 2; // 探索の刻み [px]（細かすぎると無駄・粗すぎると壁際で弾が出ない）
  for (let d = cfg.MUZZLE_OFFSET; d > 0; d -= step) {
    if (!circleHitsWall(stage, ox + cos * d, oy + sin * d, cfg.RADIUS)) return d;
  }
  return 0; // 中心まで戻す（戦車の中心が壁に入ることはないため必ず安全）
}

/**
 * 弾の生成。owner の砲口位置から angle 方向へ発射し、bullets に追加する。
 * stage を渡すと砲口位置を壁に入らないよう補正する（GDD §5.3）。
 */
export function spawnBullet(
  bullets: Bullet[],
  owner: BulletOwner,
  angle: number,
  cfg: BulletSpawnConfig = BALANCE.BULLET,
  stage?: ParsedStage,
): Bullet {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const offset = stage ? safeMuzzleOffset(stage, owner.x, owner.y, cos, sin, cfg) : cfg.MUZZLE_OFFSET;
  const b: Bullet = {
    x: owner.x + cos * offset,
    y: owner.y + sin * offset,
    vx: cos * cfg.SPEED,
    vy: sin * cfg.SPEED,
    radius: cfg.RADIUS,
    bounces: 0,
    owner,
    ownerIsPlayer: owner.kind === "player", // GDD §5.2：敵弾は敵に当たらない
    // 砲口が壁補正で発射者の内側に寄った場合に備え、発射者から離れるまでは発射者に当てない
    armed: false,
    dead: false,
  };
  if (cfg.MAX_BOUNCES !== undefined) b.maxBounces = cfg.MAX_BOUNCES; // 弾固有の反射上限（敵E弾）
  if (cfg.FUSE !== undefined) {
    b.fuse = cfg.FUSE; // 榴弾（敵M弾）：時間切れ／壁接触で炸裂する
    b.blastRadius = cfg.BLAST_RADIUS ?? BALANCE.BULLET.SHELL_BLAST_RADIUS;
  }
  bullets.push(b);
  return b;
}

/** 敵弾の生成設定（GDD §6 v0.4：敵弾のみ 225px/s に強化。プレイヤー弾は BALANCE.BULLET のまま） */
export const ENEMY_BULLET_CFG: BulletSpawnConfig = {
  SPEED: BALANCE.BULLET.ENEMY_BULLET_SPEED,
  RADIUS: BALANCE.BULLET.RADIUS,
  MUZZLE_OFFSET: BALANCE.BULLET.MUZZLE_OFFSET,
};

/** 敵C「スナイパー」弾の生成設定（GDD §6 v0.6：340px/s。反射上限は共通の1回） */
export const SNIPER_BULLET_CFG: BulletSpawnConfig = {
  SPEED: BALANCE.BULLET.SNIPER_BULLET_SPEED,
  RADIUS: BALANCE.BULLET.RADIUS,
  MUZZLE_OFFSET: BALANCE.BULLET.MUZZLE_OFFSET,
};

/** 敵E「リフレクター」弾の生成設定（GDD §6 v0.9：300px/s・この弾だけ反射上限2回） */
export const REFLECTOR_BULLET_CFG: BulletSpawnConfig = {
  SPEED: BALANCE.BULLET.REFLECTOR_BULLET_SPEED,
  RADIUS: BALANCE.BULLET.RADIUS,
  MUZZLE_OFFSET: BALANCE.BULLET.MUZZLE_OFFSET,
  MAX_BOUNCES: BALANCE.BULLET.REFLECTOR_MAX_BOUNCES,
};

/** 敵G「プリズム」弾の生成設定（GDD §6 v0.10：280px/s・この弾だけ反射上限3回） */
export const PRISM_BULLET_CFG: BulletSpawnConfig = {
  SPEED: BALANCE.BULLET.PRISM_BULLET_SPEED,
  RADIUS: BALANCE.BULLET.RADIUS,
  MUZZLE_OFFSET: BALANCE.BULLET.MUZZLE_OFFSET,
  MAX_BOUNCES: BALANCE.BULLET.PRISM_MAX_BOUNCES,
};

/** 敵V「バースター」弾の生成設定（GDD §6 v0.14：200px/s・反射1回） */
export const VOLLEY_BULLET_CFG: BulletSpawnConfig = {
  SPEED: BALANCE.BULLET.VOLLEY_BULLET_SPEED,
  RADIUS: BALANCE.BULLET.RADIUS,
  MUZZLE_OFFSET: BALANCE.BULLET.MUZZLE_OFFSET,
};

/** 敵M「ボマー」の榴弾（GDD §6 v0.14：190px/s・反射せず 1.1 秒で炸裂） */
export const SHELL_CFG: BulletSpawnConfig = {
  SPEED: BALANCE.BULLET.SHELL_SPEED,
  RADIUS: BALANCE.BULLET.RADIUS,
  MUZZLE_OFFSET: BALANCE.BULLET.MUZZLE_OFFSET,
  FUSE: BALANCE.BULLET.SHELL_FUSE,
  BLAST_RADIUS: BALANCE.BULLET.SHELL_BLAST_RADIUS,
};

/**
 * 敵弾速の難易度倍率を適用した生成設定を返す（GDD §8.3。倍率1.0はそのまま共有して割り当てを避ける）。
 * プレイヤー弾には使わない（プレイヤー性能は難易度で不変）。
 */
export function scaleBulletSpeed(cfg: BulletSpawnConfig, mult: number): BulletSpawnConfig {
  return mult === 1 ? cfg : { ...cfg, SPEED: cfg.SPEED * mult };
}

/** owner が場に出している生存弾の数 */
export function liveBulletCount(bullets: readonly Bullet[], owner: BulletOwner): number {
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
 * 反射上限は弾自身が持つ（b.maxBounces。未設定なら共通既定 BALANCE.BULLET.MAX_BOUNCES）。
 * ※最大弾速374px/s（スナイパー弾×難易度1.1） × dt上限0.05s = 最大18.7px/フレーム < タイル32px なので突き抜けは起きない。
 */
export function updateBullet(b: Bullet, dt: number, stage: ParsedStage): void {
  if (b.fuse !== undefined) {
    updateShell(b, dt, stage); // 榴弾（敵M弾）は反射せず、時間切れ／壁接触で炸裂する
    return;
  }
  const eps = BALANCE.EPS;
  const bounceLimit = b.maxBounces ?? BALANCE.BULLET.MAX_BOUNCES; // 敵E弾=2・敵G弾=3
  let bounced = false;

  // --- X軸移動 ---
  // 速度が実質ゼロの軸は処理しない（真上・真下撃ちで cos が 1e-17 になり、
  // 押し戻し方向が浮動小数の符号で決まって横へ瞬間移動する不具合を防ぐ。GDD §5.3 v0.12）
  const EPS_V = 1e-6;
  b.x += b.vx * dt;
  let hit = Math.abs(b.vx) > EPS_V ? circleHitsWall(stage, b.x, b.y, b.radius) : null;
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
  hit = Math.abs(b.vy) > EPS_V ? circleHitsWall(stage, b.x, b.y, b.radius) : null;
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
    if (b.bounces > bounceLimit) b.dead = true; // 反射上限超過（上限+1回目の壁接触）で消滅
  }
}

/**
 * 榴弾の更新（GDD §6 v0.14）。反射せず直進し、
 *   - 信管の時間切れ、または
 *   - 壁（`#`・`X`）への接触
 * で炸裂する。炸裂したフレームだけ detonated=true になり、爆風処理は world が行う。
 */
function updateShell(b: Bullet, dt: number, stage: ParsedStage): void {
  b.fuse = (b.fuse ?? 0) - dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const hitWall = circleHitsWall(stage, b.x, b.y, b.radius) !== null;
  if (b.fuse <= 0 || hitWall) {
    if (hitWall) {
      // 壁の内部で炸裂しないよう、1フレーム分だけ手前に戻す（爆風の中心を盤面内に保つ）
      b.x -= b.vx * dt;
      b.y -= b.vy * dt;
    }
    b.detonated = true;
    b.dead = true;
  }
}

/** 弾同士の相殺：接触した2発を両方消滅させる（GDD §5）。戻り値は相殺した組数 */
export function resolveBulletVsBullet(bullets: Bullet[]): number {
  let pairs = 0;
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
        pairs++;
        break; // 1発は1発としか相殺しない（GDD §5「接触した2発が両方消滅」）
      }
    }
  }
  return pairs;
}

/** 弾 vs 戦車（円近似）。弾は発射者を問わず全戦車に当たる（自分の跳ね返り弾で自爆あり） */
export function bulletHitsTank(b: Bullet, tank: { x: number; y: number; radius: number }): boolean {
  const dx = b.x - tank.x;
  const dy = b.y - tank.y;
  const rr = b.radius + tank.radius;
  return dx * dx + dy * dy < rr * rr;
}
