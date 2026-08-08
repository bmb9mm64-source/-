/**
 * 射線判定（LOS＝Line of Sight。レイキャスト）。Phaser 非依存の純粋 TS。
 * 恒久壁 `#`（と破壊可能壁 `X`）は遮蔽、穴 `H` は弾が上を通過するため遮蔽にしない。
 */
import { BALANCE } from "../config/balance";
import { type ParsedStage, stopsBullet, tileAt } from "./stage";

/** 2点間の射線が壁で遮られていないか（一定間隔でサンプリング。端点は含めない） */
export function hasLineOfSight(
  stage: ParsedStage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number = BALANCE.LOS_STEP,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / step));
  // サンプル間隔（6px）はタイル（32px）より細かいので、連続するサンプルの大半は同じタイルを指す。
  // 直前に調べたタイルを覚えて再判定を省く（サンプル位置も判定結果も従来と完全に同一）。
  let prevCol = -1;
  let prevRow = -1;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const col = Math.floor((x0 + dx * t) / stage.tile);
    const row = Math.floor((y0 + dy * t) / stage.tile);
    if (col === prevCol && row === prevRow) continue;
    prevCol = col;
    prevRow = row;
    if (stopsBullet(tileAt(stage, col, row))) return false;
  }
  return true;
}
