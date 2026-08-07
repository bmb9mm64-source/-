/**
 * エントリポイント — Phaser ゲームの起動とシーン登録。
 */
import Phaser from "phaser";
import { BALANCE, COLORS } from "./config/balance";
import { EditorScene } from "./scenes/EditorScene";
import { GameScene } from "./scenes/GameScene";
import { TitleScene } from "./scenes/TitleScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: BALANCE.TILE * BALANCE.COLS, // 800px（論理解像度。座標系は従来のまま）
  height: BALANCE.TILE * BALANCE.ROWS, // 544px
  backgroundColor: COLORS.FLOOR_CSS,
  scale: {
    // ウィンドウに合わせて拡大表示（v0.10。アスペクト比維持・中央寄せ。入力座標は Phaser が逆変換する）
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // expandParent は親を基準サイズ（800px）まで広げてしまい、それより狭い画面で
    // canvas が画面外へはみ出す。親（#app）は CSS で画面いっぱいにしてあるので不要。
    expandParent: false,
  },
  scene: [TitleScene, GameScene, EditorScene],
  // ゲームロジックは core 側でデルタタイム更新するため物理エンジンは使わない
});
