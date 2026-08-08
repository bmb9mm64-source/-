/**
 * シーン共通の音まわりの結線（GDD §9）。
 *
 * 3シーン（タイトル・ゲーム・エディタ）がどれも同じ手順を必要とするのでここに集約する：
 *   - ブラウザの自動再生制限があるため、最初のユーザー操作で AudioContext を初期化して BGM を鳴らす
 *   - M：効果音と BGM をまとめてミュート切替／B：BGM だけミュート切替
 * v0.17 まで M・B の登録はゲームシーンにしか無く、タイトルとエディタでは BGM が鳴っているのに
 * 消せなかった（どちらの画面でも BGM は再生される）ので、全シーンで同じ結線にする。
 */
import type Phaser from "phaser";
import type { BgmTrack } from "../audio/bgm";
import { BGM } from "../audio/bgm";
import { SFX } from "../audio/sfx";

/**
 * このシーンの BGM を鳴らし始め、ミュート操作のキーを登録する。
 * @param track このシーンで鳴らす曲
 */
export function bindSceneAudio(scene: Phaser.Scene, track: BgmTrack): void {
  const startAudio = (): void => {
    SFX.unlock();
    BGM.play(track);
  };
  scene.input.on("pointerdown", startAudio);
  scene.input.keyboard?.on("keydown", startAudio);
  BGM.play(track); // 初期化済み（別シーンから戻ってきた場合）なら即座に切り替わる

  // キーの押しっぱなしによる連続発火を弾く（Phaser は未登録キーのオートリピートを抑制しない）
  const onKeyPress = (name: string, fn: () => void): void => {
    scene.input.keyboard?.on(`keydown-${name}`, (event: KeyboardEvent) => {
      if (event.repeat) return;
      fn();
    });
  };

  // M：効果音と BGM をまとめてミュート切替
  onKeyPress("M", () => {
    SFX.unlock();
    BGM.setMuted(SFX.toggleMute());
    BGM.play(track); // 解除された場合に鳴り始める（ミュート中の play は無視される）
  });
  // B：BGM だけのミュート切替
  onKeyPress("B", () => {
    SFX.unlock();
    BGM.toggleMute();
    BGM.play(track);
  });
}
