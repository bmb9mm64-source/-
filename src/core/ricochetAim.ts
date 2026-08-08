/**
 * 跳弾狙撃（GDD §6 v0.4）：外周壁で反射1回して目標に当たる射線を探す。
 * 目標位置を外周壁の内面線で鏡映（ミラー）した仮想点を4辺ぶん作り、
 * 射手→仮想点の直線と壁面の交点を反射点とする。次の2条件を満たせば成立：
 *   (a) 反射点が当該外周壁の内面のうち盤面内側の区間に載っている
 *   (b) 射手→反射点・反射点→目標の両区間の射線が `#`/`X` で遮られない
 * 内周の壁での反射は対象外（実装を単純に保つ。GDD §6 のとおり外周4辺のみ）。
 * Phaser 非依存の純粋 TS。
 */
import { hasLineOfSight } from "./los";
import type { ParsedStage } from "./stage";

/** 成立した跳弾狙撃の射線 */
export interface RicochetShot {
  aimAngle: number; // 反射点へ向けた発射角 [rad]
  px: number; // 反射点（盤面内側へ僅かに寄せた位置）
  py: number;
}

/**
 * (sx,sy) から外周壁1回反射で (tx,ty) に当たる射線を探す。
 * 見つからなければ null。複数成立する場合は 左→右→上→下 の順で最初の1本を返す。
 */
export function findOuterWallRicochet(
  stage: ParsedStage,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): RicochetShot | null {
  const t = stage.tile;
  const left = t; // 外周壁（1タイル厚）の内面線
  const right = (stage.cols - 1) * t;
  const top = t;
  const bottom = (stage.rows - 1) * t;
  const inset = 0.5; // 反射点を盤面内側へ僅かに寄せ、射線サンプルが壁タイルに入らないようにする

  // 候補：目標を各壁面で鏡映した仮想点（vertical=縦の壁面か、line=壁面の座標）
  const candidates = [
    { mx: 2 * left - tx, my: ty, vertical: true, line: left },
    { mx: 2 * right - tx, my: ty, vertical: true, line: right },
    { mx: tx, my: 2 * top - ty, vertical: false, line: top },
    { mx: tx, my: 2 * bottom - ty, vertical: false, line: bottom },
  ];

  for (const cand of candidates) {
    const dx = cand.mx - sx;
    const dy = cand.my - sy;
    // 射手→仮想点の直線が壁面に達するパラメータ u（0<u<1 でないと反射にならない）
    const u = cand.vertical ? (cand.line - sx) / dx : (cand.line - sy) / dy;
    if (!Number.isFinite(u) || u <= 0 || u >= 1) continue;
    let px = sx + dx * u;
    let py = sy + dy * u;
    // 反射点が壁面の盤面内側の区間に載っているか（角の外周タイルは除外）
    if (cand.vertical) {
      if (py <= top || py >= bottom) continue;
      px = cand.line + (cand.line === left ? inset : -inset);
    } else {
      if (px <= left || px >= right) continue;
      py = cand.line + (cand.line === top ? inset : -inset);
    }
    if (!hasLineOfSight(stage, sx, sy, px, py)) continue;
    if (!hasLineOfSight(stage, px, py, tx, ty)) continue;
    return { aimAngle: Math.atan2(py - sy, px - sx), px, py };
  }
  return null;
}
