/**
 * 縦持ちレイアウトの寸法計算（GDD §3.6・§14 の E2。Phaser 非依存の純粋 TS）。
 *
 * 盤面は横長（25×17）なので、スマホの縦持ちでは画面の上下に大きな余白ができ、
 * さらに仮想コントロールが盤面に重なって見づらい。
 * そこで **canvas を下へ伸ばし、伸ばした帯にコントロールを追い出す**。
 *
 * 肝は「帯の高さを画面の縦横比にぴったり合わせる」こと。表示は縦横比を保って
 * 画面に収める（FIT）ので、canvas の比が画面と違えばその差はそのまま黒い余白になる。
 * 帯を画面の比になるまで伸ばせば、**余白だったところがそのまま操作面積に変わる**
 * （盤面の表示サイズは変わらない＝小さくなるわけではない）。
 */

/**
 * 盤面の下へ足す操作帯の高さ [px]（論理座標）を求める。
 * @param boardW 盤面の幅
 * @param boardH 盤面の高さ
 * @param screenW 画面の幅（CSS px）
 * @param screenH 画面の高さ（CSS px）
 * @param min 帯の下限（これ未満だと親指の可動域に足りない）
 * @param max 帯の上限（極端に縦長な画面で伸びすぎないように）
 */
export function portraitBandHeight(
  boardW: number,
  boardH: number,
  screenW: number,
  screenH: number,
  min: number,
  max: number,
): number {
  if (screenW <= 0 || screenH <= 0) return min;
  // 画面と同じ縦横比にするために必要な canvas の高さ
  const wanted = boardW * (screenH / screenW) - boardH;
  return Math.min(Math.max(wanted, min), max);
}
