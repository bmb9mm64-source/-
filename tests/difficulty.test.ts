/**
 * 難易度システム（src/core/difficulty.ts）のテスト（GDD §8.3 v0.9）。
 * - 各難易度の値解決（残機・発射間隔倍率・敵弾速倍率・跳弾狙撃確率・ローバー回避成功率）
 * - 選択の保存/読込（メモリストア・キー hanedan.difficulty）・既定 normal・壊れた値の安全化
 */
import { describe, expect, it } from "vitest";
import {
  DIFFICULTIES,
  DIFFICULTY_STORE_KEY,
  isDifficulty,
  loadDifficulty,
  NORMAL_MODS,
  resolveDifficulty,
  saveDifficulty,
} from "../src/core/difficulty";
import { memoryStore } from "../src/core/records";

describe("難易度の値解決（GDD §8.3 の表）", () => {
  it("EASY：残機5・発射間隔×1.4・敵弾速×0.9・跳弾狙撃40%・回避35%", () => {
    expect(resolveDifficulty("easy")).toEqual({
      lives: 5,
      fireIntervalMult: 1.4,
      bulletSpeedMult: 0.9,
      turretRicochetChance: 0.4,
      roverDodgeChance: 0.35,
    });
  });

  it("NORMAL：残機3・各倍率×1.0・跳弾狙撃75%・回避50%", () => {
    expect(resolveDifficulty("normal")).toEqual({
      lives: 3,
      fireIntervalMult: 1.0,
      bulletSpeedMult: 1.0,
      turretRicochetChance: 0.75,
      roverDodgeChance: 0.5,
    });
  });

  it("HARD：残機3・発射間隔×0.75・敵弾速×1.1・跳弾狙撃100%・回避65%", () => {
    expect(resolveDifficulty("hard")).toEqual({
      lives: 3,
      fireIntervalMult: 0.75,
      bulletSpeedMult: 1.1,
      turretRicochetChance: 1.0,
      roverDodgeChance: 0.65,
    });
  });

  it("NORMAL_MODS（未注入時の既定）は resolveDifficulty('normal') と一致する", () => {
    expect(NORMAL_MODS).toEqual(resolveDifficulty("normal"));
  });

  it("難易度は easy / normal / hard の3種（UI 表示順も同じ）", () => {
    expect(DIFFICULTIES).toEqual(["easy", "normal", "hard"]);
    expect(isDifficulty("easy")).toBe(true);
    expect(isDifficulty("normal")).toBe(true);
    expect(isDifficulty("hard")).toBe(true);
    expect(isDifficulty("lunatic")).toBe(false);
    expect(isDifficulty(null)).toBe(false);
  });
});

describe("難易度選択の保存/読込（注入式ストア）", () => {
  it("未保存なら既定の normal を返す", () => {
    expect(loadDifficulty(memoryStore())).toBe("normal");
  });

  it("保存→読込の往復ができ、キーは hanedan.difficulty（GDD §8.3「ローカル保存し次回も維持」）", () => {
    const store = memoryStore();
    saveDifficulty(store, "hard");
    expect(store.get(DIFFICULTY_STORE_KEY)).toBe("hard");
    expect(store.get("hanedan.difficulty")).toBe("hard");
    expect(loadDifficulty(store)).toBe("hard");
    saveDifficulty(store, "easy");
    expect(loadDifficulty(store)).toBe("easy");
  });

  it("壊れた保存値は既定の normal として安全に扱う", () => {
    const store = memoryStore();
    store.set(DIFFICULTY_STORE_KEY, "very-hard"); // 不正な値
    expect(loadDifficulty(store)).toBe("normal");
    store.set(DIFFICULTY_STORE_KEY, "");
    expect(loadDifficulty(store)).toBe("normal");
  });
});
