/**
 * 角度・乱数のユーティリティ（Phaser 非依存の純粋 TS）。
 * 角度の単位はすべてラジアン。
 */

/** 角度を (-PI, PI] に正規化する */
export function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** 角度差 target - current を最短方向で返す */
export function angleDiff(target: number, current: number): number {
  return normalizeAngle(target - current);
}

/** current を target に向けて最大 maxStep だけ回す（最短方向） */
export function rotateToward(current: number, target: number, maxStep: number): number {
  const d = angleDiff(target, current);
  if (Math.abs(d) <= maxStep) return target;
  return normalizeAngle(current + Math.sign(d) * maxStep);
}

/** 乱数源（テストで決定的な乱数に差し替えるための型。0以上1未満を返す） */
export type Rng = () => number;

/** min〜max の一様乱数（rng を注入してテスト可能にする） */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}
