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
import { portraitBandHeight } from "../core/portraitLayout";

/** 盤面の大きさ（常に一定。ゲームロジックの座標はすべてこの中に収まる） */
export const BOARD_W = BALANCE.TILE * BALANCE.COLS;
export const BOARD_H = BALANCE.TILE * BALANCE.ROWS;

/**
 * 縦持ちレイアウト（GDD §3.6 v0.23・§14 の E2）。
 *
 * 盤面は横長（25×17）なので、スマホの縦持ちでは画面の上下に大きな余白ができ、
 * そのうえ仮想コントロールが盤面に重なって見づらい。
 * 縦持ちのときだけ **canvas を下へ伸ばし、伸ばした帯にコントロールを追い出す**。
 * 盤面そのものは 800×544 のまま（レベルデザインも当たり判定も一切変えない）。
 *
 * 判定は起動時に一度だけ。途中で回転しても作り直さない（canvas を作り直すことになるため）。
 * タッチ環境でのみ有効にする（PC で細いウィンドウにしたときに帯を出しても意味がないため）。
 */
function detectPortrait(): boolean {
  if (typeof window === "undefined") return false;
  const touch = typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;
  return touch && window.innerHeight > window.innerWidth;
}

/** 縦持ちレイアウトか（起動時に確定） */
export const IS_PORTRAIT = detectPortrait();

/**
 * 操作帯の高さを求める（計算そのものは core/portraitLayout.ts の純粋関数）。
 * 横持ち・PC では 0＝従来どおり canvas は盤面と同じ大きさ。
 */
function computeTouchBand(): number {
  if (!IS_PORTRAIT) return 0;
  const c = BALANCE.TOUCH;
  return portraitBandHeight(
    BOARD_W,
    BOARD_H,
    window.innerWidth,
    window.innerHeight,
    c.PORTRAIT_BAND_MIN,
    c.PORTRAIT_BAND_MAX,
  );
}

/** 操作帯の高さ [px]（横持ち・PC では 0＝従来どおり） */
export const TOUCH_BAND_H = computeTouchBand();

/** 論理解像度（canvas の座標系。縦持ちでは操作帯のぶんだけ縦に長い） */
export const VIEW_W = BOARD_W;
export const VIEW_H = BOARD_H + TOUCH_BAND_H;

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
export function applyRenderScale(scene: Phaser.Scene, options: { centerBoard?: boolean } = {}): void {
  // 縦持ちでは canvas が盤面より縦に長い（操作帯のぶん。GDD §3.6）。
  // ゲーム画面は盤面を上に置きたいので canvas の中心に合わせるが、
  // メニュー系の画面は操作帯を使わないので、盤面の中心が画面の中心に来るようずらす
  // （そうしないと文字が画面の上寄りに寄って下が丸ごと空く）。
  const centerY = options.centerBoard ? BOARD_H / 2 : VIEW_H / 2;
  scene.cameras.main.setZoom(RENDER_SCALE).centerOn(VIEW_W / 2, centerY);
}

/**
 * Text に渡す解像度。カメラズームで拡大される前提なので、
 * 文字テクスチャも同じ倍率で焼かないと文字だけぼやける。
 */
export const TEXT_RESOLUTION = RENDER_SCALE;
