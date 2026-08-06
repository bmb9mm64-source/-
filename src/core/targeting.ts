/**
 * 敵AIの標的選択（GDD §12.5。Phaser 非依存の純粋 TS）。
 * セントリー・ローバー共通：「生存中のプレイヤーのうち、射線が通る最も近い1体」を狙う。
 * 全員に射線が通らなければ最も近い生存者を返す（照準追従のみ＝射撃は許可しない）。
 * 1人プレイでは従来（唯一のプレイヤーを狙い、射線の有無で射撃可否が決まる）と同じ挙動になる。
 */
import { hasLineOfSight } from "./los";
import type { ParsedStage } from "./stage";

/** 標的候補の最小情報（PlayerTank をそのまま渡せる） */
export interface TargetInfo {
  x: number;
  y: number;
  alive: boolean;
}

/** 標的選択の結果 */
export interface TargetPick<T extends TargetInfo> {
  target: T; // 選ばれた標的
  hasLos: boolean; // 標的への射線が通っているか（false なら照準追従のみで射撃禁止）
}

/**
 * (sx,sy) の射手から見た標的を選ぶ。
 * 1) 生存中かつ射線が通る候補のうち最も近い1体（hasLos=true）
 * 2) いなければ生存中で最も近い1体（hasLos=false。照準追従のみ）
 * 3) 生存者がいなければ null
 */
export function selectTarget<T extends TargetInfo>(
  stage: ParsedStage,
  sx: number,
  sy: number,
  candidates: readonly T[],
): TargetPick<T> | null {
  let bestLos: T | null = null;
  let bestLosDistSq = Infinity;
  let bestAny: T | null = null;
  let bestAnyDistSq = Infinity;

  for (const c of candidates) {
    if (!c.alive) continue; // 退場者は無視（GDD §12.5）
    const dx = c.x - sx;
    const dy = c.y - sy;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestAnyDistSq) {
      bestAny = c;
      bestAnyDistSq = distSq;
    }
    if (distSq < bestLosDistSq && hasLineOfSight(stage, sx, sy, c.x, c.y)) {
      bestLos = c;
      bestLosDistSq = distSq;
    }
  }

  if (bestLos) return { target: bestLos, hasLos: true };
  if (bestAny) return { target: bestAny, hasLos: false };
  return null;
}
