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
  width: BALANCE.TILE * BALANCE.COLS, // 800px
  height: BALANCE.TILE * BALANCE.ROWS, // 544px
  backgroundColor: COLORS.FLOOR_CSS,
  scene: [TitleScene, GameScene, EditorScene],
  // ゲームロジックは core 側でデルタタイム更新するため物理エンジンは使わない
});
