/**
 * BGM の「明るさ」と「長く聴いていられること」を機械的に守るテスト（GDD §9 v0.20.1／v0.21）。
 *
 * 曲の良し悪しは耳で確かめるしかないが、**壊れると必ず不快になる条件**は
 * データの形として検査できる。ここで守っているのは次の4点：
 *   ① すべての音（リード・ベース・パッドの和音）が C メジャー音階に入っている
 *      ＝ 音階外の音が混ざって不穏に響くことがない（v0.20.1 の「不気味」対策）
 *   ② コードは長三和音か短三和音だけ＝7th を積まない（7th の濁りが不穏さの主因だった）
 *   ③ 旋律は4小節フレーズで、ループ内に必ず別のフレーズが現れる
 *      ＝ 同じ旋律が延々と繰り返されない（v0.21 の「単調・耳に付く」対策）
 *   ④ ループ長が 30〜120 秒に収まる（ゲーム音楽の定石。短すぎると飽き、長すぎると散漫）
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";

/** 休符／前の音を伸ばす記号（balance.ts・bgm.ts と同じ約束） */
const REST = -99;
const HOLD = -98;

/**
 * 基準音 A3 からの半音数のうち、C メジャー音階に含まれるもの（オクターブ内）。
 * A=0, B=2, C=3, D=5, E=7, F=8, G=10。
 */
const C_MAJOR = new Set([0, 2, 3, 5, 7, 8, 10]);

/** 半音数が C メジャー音階に入っているか（オクターブは問わない） */
function inCMajor(semitone: number): boolean {
  return C_MAJOR.has(((semitone % 12) + 12) % 12);
}

const B = BALANCE.BGM;
const TRACKS = Object.entries(B.TRACKS);
/** 1フレーズのステップ数（4小節 × 8分音符8個 = 32） */
const STEPS_PER_PHRASE = B.STEPS_PER_BAR * B.BARS_PER_PHRASE;

describe("BGM は C メジャーのポップに保たれている", () => {
  it.each(TRACKS)("%s：コードは長三和音か短三和音だけ（7th を積まない）", (_name, track) => {
    for (const chord of track.PROG) {
      // 長三和音 [0,4,7,12] か短三和音 [0,3,7,12] のどちらか
      expect([3, 4], "第3音は短3度か長3度").toContain(chord.TONES[1]);
      const upper: readonly number[] = chord.TONES.slice(1);
      expect(upper, "7th（10・11 半音）は含めない").not.toContain(10);
      expect(upper).not.toContain(11);
    }
  });

  it.each(TRACKS)("%s：コードの構成音がすべて C メジャー音階に入っている", (_name, track) => {
    for (const chord of track.PROG) {
      for (const iv of chord.TONES) {
        expect(inCMajor(chord.ROOT + iv), `${chord.ROOT}+${iv} は音階外`).toBe(true);
      }
    }
  });

  it.each(TRACKS)("%s：旋律の音がすべて C メジャー音階に入っている", (_name, track) => {
    for (const phrase of track.PHRASES) {
      for (const note of phrase) {
        if (note === REST || note === HOLD) continue;
        expect(inCMajor(note), `旋律の ${note} は音階外`).toBe(true);
      }
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

describe("BGM は長く聴いていられる形になっている", () => {
  it.each(TRACKS)("%s：フレーズはちょうど4小節ぶん（32音）", (_name, track) => {
    for (const phrase of track.PHRASES) {
      expect(phrase).toHaveLength(STEPS_PER_PHRASE);
      // 先頭が HOLD だと「伸ばす対象の音」が無いままループの頭に戻る
      expect(phrase[0], "フレーズの先頭は HOLD にしない").not.toBe(HOLD);
    }
  });

  it.each(TRACKS)("%s：FORM は実在するフレーズだけを指し、ループ全体を埋める", (_name, track) => {
    expect(track.FORM).toHaveLength(B.BARS_PER_LOOP / B.BARS_PER_PHRASE);
    for (const i of track.FORM) {
      expect(track.PHRASES[i], `FORM の ${i} 番のフレーズが無い`).toBeDefined();
    }
  });

  it.each(TRACKS)("%s：ループ内に2種類以上のフレーズが現れる（同じ旋律の連呼を防ぐ）", (_name, track) => {
    expect(new Set(track.FORM).size).toBeGreaterThanOrEqual(2);
  });

  it.each(TRACKS)("%s：ループ長が 30〜120 秒に収まる", (_name, track) => {
    const stepDur = 60 / track.TEMPO / 2; // 8分音符の長さ [s]
    const loopSec = stepDur * B.STEPS_PER_BAR * B.BARS_PER_LOOP;
    expect(loopSec).toBeGreaterThanOrEqual(30);
    expect(loopSec).toBeLessThanOrEqual(120);
  });

  it.each(TRACKS)("%s：スウィングは裏拍が次の拍を追い越さない範囲", (_name, track) => {
    expect(track.SWING).toBeGreaterThanOrEqual(0);
    expect(track.SWING).toBeLessThan(0.5);
  });

  it.each(TRACKS)("%s：ドラムは小節内の実在するステップだけを叩く", (_name, track) => {
    if (!track.DRUMS) return; // 静かな曲はドラムなし
    for (const step of [...track.DRUMS.KICK, ...track.DRUMS.SNARE]) {
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(B.STEPS_PER_BAR);
    }
  });
});
