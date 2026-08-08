/**
 * 画面表示の組み立て（GDD §8・§8.5・§12.7・§14 の E7。Phaser 非依存の純粋 TS）。
 *
 * これまでシーン層（src/scenes/）に直接書かれていた「文字列や座標を組み立てるだけ」の処理を
 * ここへ押し出した。シーン層はテストが書けず、実際に見つかった不具合
 * （UI のはみ出し・一覧の桁ズレ）はすべてこの種の計算だった。
 * 描画そのもの（Phaser への指示）はシーンに残し、**計算だけ**をここに置く。
 */

/** 残量を ● ○ で表す（●＝まだ使える／○＝場に出ていて使えない。GDD §8 v0.17） */
export function ammoPips(used: number, max: number): string {
  const u = Math.min(Math.max(0, Math.floor(used)), Math.max(0, Math.floor(max)));
  const m = Math.max(0, Math.floor(max));
  return "●".repeat(m - u) + "○".repeat(u);
}

/** オーバーレイの版組（GDD §8.5・§8 v0.17。文の長さで置き方を変える） */
export type OverlayLayout = "normal" | "paused" | "allclear";

/**
 * オーバーレイの版組を選ぶ。
 *   allclear … タイム一覧が最大52行になるので上寄せ・等幅小フォント
 *   paused   … 操作一覧が複数行なので、中央寄せだと見出しに食い込む。見出しの下へ上寄せ
 *   normal   … 1行の短い文なので中央寄せ
 */
export function chooseOverlayLayout(paused: boolean, status: string): OverlayLayout {
  if (paused) return "paused";
  return status === "allclear" ? "allclear" : "normal";
}

/** 全クリア一覧の1行ぶんの材料 */
export interface ClearRow {
  missionNumber: number;
  time: number;
  best: number | null;
  isNewRecord: boolean;
}

/**
 * 全クリア画面のタイム一覧を組み立てる（GDD §8.5）。
 * 等幅フォントで桁をそろえるため、タイムは右詰めの固定幅にする。
 * @param rows クリアしたミッションの行（クリアしていないミッションは呼び出し側で除く）
 * @param format タイムの整形（records.ts の formatTime を渡す）
 */
export function formatClearRows(rows: readonly ClearRow[], format: (t: number) => string): string[] {
  return rows.map((r) => {
    const best = r.best !== null ? format(r.best).padStart(6, " ") : "  --.-";
    const mark = r.isNewRecord ? " ★NEW!" : "";
    return `M${String(r.missionNumber).padEnd(2, " ")} ${format(r.time).padStart(6, " ")}s / ベスト ${best}s${mark}`;
  });
}

/** 合計行（一覧の最後に置く。GDD §8.5） */
export function formatTotalRow(
  total: number,
  best: number | null,
  isNewRecord: boolean,
  format: (t: number) => string,
): string {
  const bestStr = best !== null ? format(best).padStart(6, " ") : "  --.-";
  return `合計 ${format(total).padStart(6, " ")}s / ベスト ${bestStr}s${isNewRecord ? " ★NEW!" : ""}`;
}

/**
 * 横一列のボタンを**実際の文字幅**で並べたときの左端 x を返す（GDD §12.7 v0.17）。
 *
 * 等分割にすると長いラベルが枠からはみ出し、端のボタンが画面外へ切れる（v0.17 で実際に発生）。
 * 全体が収まらないときも左端から詰めることで、**どのボタンも消えない**ことを保証する。
 * @param widths 各ボタンの幅
 * @param areaW 並べる領域の幅
 * @param gap ボタン間の余白
 */
export function packRowByWidth(
  widths: readonly number[],
  areaW: number,
  gap: number,
): number[] {
  if (widths.length === 0) return [];
  const totalW = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  let x = Math.max(gap, (areaW - totalW) / 2);
  const xs: number[] = [];
  for (const w of widths) {
    xs.push(x);
    x += w + gap;
  }
  return xs;
}
