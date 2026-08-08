/**
 * BGM のミュート（GDD §9・v0.17 修正）の回帰テスト。
 * M（効果音と共通）と B（BGM だけ）は別々の意思なので、状態も別々に持って合成する必要がある。
 * 1つの真偽値で持っていたころは「B で BGM を消したあと M を2回押すと BGM が復活する」
 * ＝ M の解除が B の指定を上書きしてしまう不具合があった。
 * AudioContext の無い環境（Node）でも、play() が早期 return するだけで状態遷移は再現できる。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { BGM } from "../src/audio/bgm";

/** どちらのミュートも解除された初期状態に戻す */
function resetMute(): void {
  BGM.setMuted(false); // M 由来を解除
  if (BGM.muted) BGM.toggleMute(); // B 由来が残っていれば解除
}

describe("BGM のミュートは M と B を別々に覚える", () => {
  beforeEach(resetMute);

  it("B だけで消せる／もう一度 B で戻る", () => {
    expect(BGM.muted).toBe(false);
    BGM.toggleMute();
    expect(BGM.muted).toBe(true);
    BGM.toggleMute();
    expect(BGM.muted).toBe(false);
  });

  it("B で消したあと M を2回押しても BGM は消えたまま（回帰）", () => {
    BGM.toggleMute(); // B：BGM だけ消す
    expect(BGM.muted).toBe(true);
    BGM.setMuted(true); // M：全体を消す
    expect(BGM.muted).toBe(true);
    BGM.setMuted(false); // M：全体の消音を解除
    expect(BGM.muted).toBe(true); // B の指定が生きているので鳴らない
    BGM.toggleMute(); // B：ここで初めて鳴る
    expect(BGM.muted).toBe(false);
  });

  it("M で消している間は、B を切り替えても鳴らない", () => {
    BGM.setMuted(true); // M：全体を消す
    expect(BGM.muted).toBe(true);
    BGM.toggleMute(); // B：BGM だけ消す → 実効は変わらず消音
    expect(BGM.muted).toBe(true);
    BGM.toggleMute(); // B：戻す → それでも M が生きているので消音のまま
    expect(BGM.muted).toBe(true);
    BGM.setMuted(false); // M：解除してようやく鳴る
    expect(BGM.muted).toBe(false);
  });

  it("toggleMute の戻り値は「B 由来のミュート状態」", () => {
    expect(BGM.toggleMute()).toBe(true);
    expect(BGM.toggleMute()).toBe(false);
  });
});
