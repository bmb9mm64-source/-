/**
 * ベスト記録（src/core/records.ts）のテスト（GDD §8.5）。
 * localStorage への依存は注入式のため、ここではメモリ実装（memoryStore）で検証する。
 * - ベスト更新判定：初回→更新、速い→更新、遅い・同タイム→非更新
 * - 壊れた保存値（NaN・負数・非数値文字列・空文字）は「記録なし」として安全に上書き可能
 * - 通しトータルベストも同じ判定
 * - 保存キーは hanedan.best.mission.<n> / hanedan.best.total
 */
import { describe, expect, it } from "vitest";
import {
  formatTime,
  memoryStore,
  RECORD_KEYS,
  Records,
  type RecordStore,
} from "../src/core/records";

describe("ベスト記録（Records）", () => {
  it("初回クリアはベスト更新（true）になり、保存される", () => {
    const store = memoryStore();
    const records = new Records(store);
    expect(records.missionBest(1)).toBeNull(); // 記録なし
    expect(records.submitMissionTime(1, 12.5)).toBe(true);
    expect(records.missionBest(1)).toBe(12.5);
    expect(store.get("hanedan.best.mission.1")).toBe("12.5"); // GDD §8.5 のキー
  });

  it("より速いタイムはベスト更新、遅いタイムは非更新で記録を保持する", () => {
    const records = new Records(memoryStore());
    records.submitMissionTime(3, 20.0);
    expect(records.submitMissionTime(3, 15.3)).toBe(true); // 速い→更新
    expect(records.missionBest(3)).toBe(15.3);
    expect(records.submitMissionTime(3, 18.0)).toBe(false); // 遅い→非更新
    expect(records.missionBest(3)).toBe(15.3); // 記録は保持
  });

  it("同タイムはベスト更新にならない", () => {
    const records = new Records(memoryStore());
    records.submitMissionTime(2, 10.0);
    expect(records.submitMissionTime(2, 10.0)).toBe(false);
  });

  it("ミッション番号ごとに独立した記録になる", () => {
    const records = new Records(memoryStore());
    records.submitMissionTime(1, 10.0);
    records.submitMissionTime(2, 30.0);
    expect(records.missionBest(1)).toBe(10.0);
    expect(records.missionBest(2)).toBe(30.0);
    expect(records.missionBest(10)).toBeNull();
  });

  it.each([
    ["非数値文字列", "abc"],
    ["NaN", "NaN"],
    ["負数", "-5"],
    ["空文字", ""],
    ["空白のみ", "   "],
    ["無限大", "Infinity"],
  ])("壊れた保存値（%s）は記録なし扱いになり、初回として上書きできる", (_label, broken) => {
    const store = memoryStore();
    store.set(RECORD_KEYS.mission(1), broken);
    const records = new Records(store);
    expect(records.missionBest(1)).toBeNull(); // 壊れた値は無視（安全に初期化）
    expect(records.submitMissionTime(1, 42.0)).toBe(true); // 初回扱いで更新
    expect(records.missionBest(1)).toBe(42.0);
  });

  it("不正なタイム（NaN・負数・無限大）の提出は保存されず false を返す", () => {
    const records = new Records(memoryStore());
    expect(records.submitMissionTime(1, Number.NaN)).toBe(false);
    expect(records.submitMissionTime(1, -1)).toBe(false);
    expect(records.submitMissionTime(1, Number.POSITIVE_INFINITY)).toBe(false);
    expect(records.missionBest(1)).toBeNull();
  });

  it("通しトータルベスト：初回→更新、速い→更新、遅い→非更新。キーは hanedan.best.total", () => {
    const store = memoryStore();
    const records = new Records(store);
    expect(records.totalBest()).toBeNull();
    expect(records.submitTotalTime(300.5)).toBe(true); // 初回
    expect(store.get(RECORD_KEYS.total)).toBe("300.5");
    expect(store.get("hanedan.best.total")).toBe("300.5"); // GDD §8.5 のキー
    expect(records.submitTotalTime(250.0)).toBe(true); // 速い
    expect(records.submitTotalTime(280.0)).toBe(false); // 遅い
    expect(records.totalBest()).toBe(250.0);
  });

  it("トータルベストの壊れた保存値も安全に上書きできる", () => {
    const store = memoryStore();
    store.set(RECORD_KEYS.total, "not-a-number");
    const records = new Records(store);
    expect(records.totalBest()).toBeNull();
    expect(records.submitTotalTime(99.9)).toBe(true);
    expect(records.totalBest()).toBe(99.9);
  });

  it("読み書きが例外を投げるストアでも Records 経由の呼び出しは値の破壊なく動く（注入式の抽象確認）", () => {
    // Storage 互換の抽象を満たす別実装の例：常に null を返す壊れたストア
    const brokenStore: RecordStore = {
      get: () => null,
      set: () => {
        /* 書き込みが効かないストア */
      },
    };
    const records = new Records(brokenStore);
    expect(records.missionBest(1)).toBeNull();
    expect(records.submitMissionTime(1, 10)).toBe(true); // 更新判定は行われる（保存はストア次第）
  });
});

describe("タイム表示の整形（formatTime）", () => {
  it("0.1秒単位・切り捨てで整形する", () => {
    expect(formatTime(0)).toBe("0.0");
    expect(formatTime(12.34)).toBe("12.3");
    expect(formatTime(12.39)).toBe("12.3"); // 切り捨て
    expect(formatTime(100)).toBe("100.0");
  });

  it("不正値は 0.0 として表示する（表示層を落とさない）", () => {
    expect(formatTime(Number.NaN)).toBe("0.0");
    expect(formatTime(-3)).toBe("0.0");
  });
});
