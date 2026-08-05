/**
 * 戦車の移動と衝突（Phaser 非依存の純粋 TS）。
 * 当たり判定は AABB（軸に平行な矩形）で、軸ごと（X→Y）に移動・解決する。
 */
import { BALANCE } from "../config/balance";
import { type ParsedStage, solidForTank, tileAt } from "./stage";

/** moveTank が必要とする最小の戦車情報 */
export interface MovableTank {
  x: number;
  y: number;
  half: number; // 半辺長 [px]
}

/** 通行を妨げる他戦車の最小情報 */
export interface TankBlocker {
  x: number;
  y: number;
  half: number;
  alive: boolean;
}

/** 矩形（中心 x,y・半辺 half）が戦車通行不可タイルと重なるか */
export function rectHitsTile(stage: ParsedStage, x: number, y: number, half: number): boolean {
  const t = stage.tile;
  const eps = BALANCE.EPS;
  const c0 = Math.floor((x - half) / t);
  const c1 = Math.floor((x + half - eps) / t);
  const r0 = Math.floor((y - half) / t);
  const r1 = Math.floor((y + half - eps) / t);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (solidForTank(tileAt(stage, c, r))) return true;
    }
  }
  return false;
}

/** 2つの戦車（AABB）が重なっているか */
export function tanksOverlap(ax: number, ay: number, aHalf: number, b: TankBlocker): boolean {
  return Math.abs(ax - b.x) < aHalf + b.half && Math.abs(ay - b.y) < aHalf + b.half;
}

/**
 * 戦車を軸ごとに移動させる（X→Y の順。壁・穴タイルおよび blockers（他戦車）と衝突判定）。
 * タイルに当たった場合はタイル境界へスナップ（めり込み防止）。
 * 戦車同士は通り抜け不可（GDD §5.5）。
 */
export function moveTank(
  tank: MovableTank,
  dx: number,
  dy: number,
  blockers: readonly TankBlocker[],
  stage: ParsedStage,
): void {
  const t = stage.tile;
  const eps = BALANCE.EPS;

  // --- X軸 ---
  if (dx !== 0) {
    let nx = tank.x + dx;
    if (rectHitsTile(stage, nx, tank.y, tank.half)) {
      if (dx > 0) nx = Math.floor((nx + tank.half) / t) * t - tank.half - eps;
      else nx = (Math.floor((nx - tank.half) / t) + 1) * t + tank.half + eps;
    }
    let blocked = false;
    for (const o of blockers) {
      if (o.alive && tanksOverlap(nx, tank.y, tank.half, o)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) tank.x = nx;
  }

  // --- Y軸 ---
  if (dy !== 0) {
    let ny = tank.y + dy;
    if (rectHitsTile(stage, tank.x, ny, tank.half)) {
      if (dy > 0) ny = Math.floor((ny + tank.half) / t) * t - tank.half - eps;
      else ny = (Math.floor((ny - tank.half) / t) + 1) * t + tank.half + eps;
    }
    let blocked = false;
    for (const o of blockers) {
      if (o.alive && tanksOverlap(tank.x, ny, tank.half, o)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) tank.y = ny;
  }
}
