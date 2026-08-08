/**
 * 描画解像度の引き上げ（GDD §9 v0.20）。
 *
 * 論理解像度は 800×544 のままにしたい（ゲームロジックの座標・速度・半径が全てこの単位で
 * 書かれているため）。しかし canvas をその大きさで作ると、フルHDの画面では約1.9倍、
 * HiDPI では約3.8倍に引き伸ばされて輪郭がぼやける。
 *
 * Phaser の `scale.zoom` は FIT モードでは効かない（実測：描画バッファは基準サイズのまま）。
 * そこで **canvas 自体を RENDER_SCALE 倍で作り、カメラを同じ倍率でズームして
 * 論理座標へ戻す**。こうすると：
 *   - 描画バッファ … 800×RENDER_SCALE 相当（＝実際に表示されるピクセル数に近づく）
 *   - ゲーム側の座標 … 0〜800 / 0〜544 のまま（既存コードを一切変えなくてよい）
 *
 * 画面上の座標（ポインタ）は canvas 座標＝論理座標×RENDER_SCALE で来るので、
 * ゲーム座標に直すときは toGameCoord() を通す。
 */
import { BALANCE } from "../config/balance";

/** 論理解像度（座標系） */
export const VIEW_W = BALANCE.TILE * BALANCE.COLS;
export const VIEW_H = BALANCE.TILE * BALANCE.ROWS;

/**
 * 実際に表示されるデバイスピクセル数に合わせた描画倍率。
 * 起動時に一度だけ決める（途中で変えると canvas を作り直すことになるため）。
 */
function computeRenderScale(): number {
  if (typeof window === "undefined") return 1;
  const dpr = window.devicePixelRatio || 1;
  // FIT 後の表示幅（CSS px）＝アスペクト比を保って画面に収めたときの幅
  const displayW = Math.min(window.innerWidth, window.innerHeight * (VIEW_W / VIEW_H));
  const wanted = (displayW * dpr) / VIEW_W;
  return Math.min(Math.max(wanted, 1), BALANCE.MAX_RENDER_ZOOM);
}

/** 描画倍率（起動時に確定。1 なら従来どおり等倍） */
export const RENDER_SCALE = computeRenderScale();

/** canvas 座標（ポインタ等）をゲーム座標へ直す */
export function toGameCoord(v: number): number {
  return v / RENDER_SCALE;
}

/**
 * シーンのカメラを論理座標系に合わせる。各シーンの create() の先頭で呼ぶ。
 * これを呼ばないと、シーンは RENDER_SCALE 倍に広がった座標系のまま描かれてしまう。
 */
export function applyRenderScale(scene: Phaser.Scene): void {
  if (RENDER_SCALE === 1) return;
  scene.cameras.main.setZoom(RENDER_SCALE).centerOn(VIEW_W / 2, VIEW_H / 2);
}

/**
 * Text に渡す解像度。カメラズームで拡大される前提なので、
 * 文字テクスチャも同じ倍率で焼かないと文字だけぼやける。
 */
export const TEXT_RESOLUTION = RENDER_SCALE;
