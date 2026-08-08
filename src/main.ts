/**
 * エントリポイント — Phaser ゲームの起動とシーン登録。
 */
import Phaser from "phaser";
import { COLORS } from "./config/balance";
import { AchievementsScene } from "./scenes/AchievementsScene";
import { EditorScene } from "./scenes/EditorScene";
import { GameScene } from "./scenes/GameScene";
import { MissionSelectScene } from "./scenes/MissionSelectScene";
import { RENDER_SCALE, VIEW_H, VIEW_W } from "./scenes/renderScale";
import { TitleScene } from "./scenes/TitleScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  // canvas は RENDER_SCALE 倍で作る（＝描画バッファを実表示ピクセルに近づけて輪郭を締める）。
  // 各シーンは applyRenderScale() でカメラを同じ倍率にズームし、
  // ゲーム側の座標は従来どおり 800×544 のまま扱う（renderScale.ts の説明を参照）。
  width: VIEW_W * RENDER_SCALE,
  height: VIEW_H * RENDER_SCALE,
  backgroundColor: COLORS.FLOOR_CSS,
  render: { antialias: true }, // 図形描画なのでアンチエイリアスは有効（ドット絵ではない）
  // 音は自前の Web Audio（src/audio/）で鳴らしており Phaser の音機能は使わない。
  // 既定のままだと Phaser も AudioContext を1つ作って遊ばせておくことになるので止める。
  audio: { noAudio: true },
  scale: {
    // ウィンドウに合わせて拡大表示（v0.10。アスペクト比維持・中央寄せ。入力座標は Phaser が逆変換する）
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // expandParent は親を基準サイズまで広げてしまい、それより狭い画面で
    // canvas が画面外へはみ出す。親（#app）は CSS で画面いっぱいにしてあるので不要。
    expandParent: false,
  },
  scene: [TitleScene, GameScene, EditorScene, MissionSelectScene, AchievementsScene],
  // ゲームロジックは core 側でデルタタイム更新するため物理エンジンは使わない
});
