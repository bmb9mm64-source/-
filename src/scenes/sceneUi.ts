/**
 * シーン層の共通部品（GDD §14 の E3）。
 *
 * タイトル・ゲーム・エディタの3シーンで同じ書き方が繰り返されていたものをここへ集める。
 * 集めたのは「見た目と当たり判定が揃っていないと不具合になる」ものだけで、
 * シーン固有の描画（戦車・弾・HUD）は各シーンに残す。
 *
 *   drawFloorGrid  … 床のベタ塗り＋グリッド線（3シーンで同じ絵を別々に描いていた）
 *   textButton     … 押せる文字ボタン（`setOrigin → setInteractive → on("pointerdown")` の定型が8か所）
 *
 * 盤面の画素サイズは renderScale.ts の VIEW_W / VIEW_H が唯一の定義（各シーンで
 * `BALANCE.TILE * BALANCE.COLS` を再計算しない）。
 */
import { BALANCE, COLORS } from "../config/balance";
import { BOARD_H, TEXT_RESOLUTION, VIEW_H, VIEW_W } from "./renderScale";

/** グリッド線の描き方 */
export interface FloorGridOptions {
  /** 床を塗るか（false ならグリッド線だけ重ねる。エディタは自前でタイルを塗るため false） */
  fill?: boolean;
  /** グリッド線の不透明度 */
  gridAlpha?: number;
  /**
   * 線を半ピクセルずらすか。1px の線は整数座標に引くと2px に滲むので、
   * 等倍で見せる背景では 0.5 ずらす。タイルの境界と厳密に一致させたい
   * エディタでは falseにする（ずらすと塗ったタイルとの境目が見える）。
   */
  halfPixel?: boolean;
}

/**
 * 床＋グリッド線を描く。盤面の「地」はどのシーンでも同じ絵でなければならない
 * （タイトルとゲームで目地の位置がずれると画面遷移でガタつく）。
 */
export function drawFloorGrid(
  g: Phaser.GameObjects.Graphics,
  options: FloorGridOptions = {},
): void {
  const { fill = true, gridAlpha = 1, halfPixel = true } = options;
  const t = BALANCE.TILE;
  const off = halfPixel ? 0.5 : 0;
  // 縦持ちでは canvas が盤面より縦に長い（操作帯のぶん。GDD §3.6）。
  // 塗りは canvas 全体に、目地は盤面の範囲にだけ引く（帯に盤面の目地を延ばすと盤面の続きに見える）。
  if (fill) {
    // カメラを縦にずらす画面（メニュー系。renderScale の centerBoard）でも
    // 下地が途切れないよう、表示範囲より広めに塗る
    g.fillStyle(COLORS.FLOOR, 1);
    g.fillRect(0, -VIEW_H, VIEW_W, VIEW_H * 3);
  }
  g.lineStyle(1, COLORS.FLOOR_GRID, gridAlpha);
  for (let c = 1; c < BALANCE.COLS; c++) g.lineBetween(c * t + off, 0, c * t + off, BOARD_H);
  for (let r = 1; r < BALANCE.ROWS; r++) g.lineBetween(0, r * t + off, VIEW_W, r * t + off);
}

/**
 * 押せる文字ボタンを作る。
 * `resolution` の指定漏れ（文字だけぼやける）と `useHandCursor` の付け忘れ（押せると分からない）を
 * 1か所にまとめて防ぐのが目的。戻り値は通常の Text なので、位置の微調整は呼び出し側で続けられる。
 */
export function textButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  style: Phaser.Types.GameObjects.Text.TextStyle,
  onClick: (pointer: Phaser.Input.Pointer) => void,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, label, { resolution: TEXT_RESOLUTION, ...style })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true })
    .on("pointerdown", onClick);
}
