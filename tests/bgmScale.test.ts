/**
 * BGM の「明るさ」を機械的に守るテスト（GDD §9 v0.20.1）。
 *
 * v0.20 の BGM は「マイナーキー＋マイナー7th」で不気味に聞こえたため、
 * C メジャーの王道ポップへ作り替えた。ここでは耳では検証できない代わりに、
 * 音程データが次の約束を満たすことを機械的に確かめる：
 *   ① すべての音（リード・ベース・パッド）が C メジャー音階に入っている
 *      ＝ 音階外の音（♭が付く音）が混ざって不穏に響くことがない
 *   ② コードは長三和音か短三和音だけ＝7th を積まない（7th が不安定さの主因だった）
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";

/** 休符を表す値（balance.ts の音程データと同じ約束） */
const REST = -99;

/**
 * 基準音 A3 からの半音数のうち、C メジャー音階に含まれるもの（オクターブ内）。
 * A=0, B=2, C=3, D=5, E=7, F=8, G=10。
 */
const C_MAJOR = new Set([0, 2, 3, 5, 7, 8, 10]);

/** 半音数が C メジャー音階に入っているか（オクターブは問わない） */
function inCMajor(semitone: number): boolean {
  return C_MAJOR.has(((semitone % 12) + 12) % 12);
}

const TRACKS = Object.entries(BALANCE.BGM.TRACKS);

describe("BGM は C メジャーのポップに保たれている", () => {
  it.each(TRACKS)("%s：コードは長三和音か短三和音だけ（7th を積まない）", (_name, track) => {
    for (const chord of track.PROG) {
      // 長三和音 [0,4,7,12] か短三和音 [0,3,7,12] のどちらか
      const third = chord.TONES[1];
      expect([3, 4], `第3音は短3度か長3度`).toContain(third);
      expect(chord.TONES.slice(1), `7th（10 or 11 半音）は含めない`).not.toContain(10);
      expect(chord.TONES.slice(1)).not.toContain(11);
    }
  });

  it.each(TRACKS)("%s：コードの構成音がすべて C メジャー音階に入っている", (_name, track) => {
    for (const chord of track.PROG) {
      for (const iv of chord.TONES) {
        expect(inCMajor(chord.ROOT + iv), `${chord.ROOT}+${iv} は音階外`).toBe(true);
      }
    }
  });

  it.each(TRACKS)("%s：リードの音がすべて C メジャー音階に入っている", (_name, track) => {
    for (const note of [...track.LEAD_A, ...track.LEAD_B]) {
      if (note === REST) continue;
      expect(inCMajor(note), `リードの ${note} は音階外`).toBe(true);
    }
  });

  it.each(TRACKS)("%s：ベースの音がすべて C メジャー音階に入っている", (_name, track) => {
    for (const chord of track.PROG) {
      for (const note of track.BASS) {
        if (note === REST) continue;
        expect(inCMajor(chord.ROOT + note), `${chord.ROOT}+${note} は音階外`).toBe(true);
      }
    }
  });
});
