/**
 * ベスト記録（src/core/records.ts）のテスト（GDD §8.5）。
 * localStorage への依存は注入式のため、ここではメモリ実装（memoryStore）で検証する。
 * - ベスト更新判定：初回→更新、速い→更新、遅い・同タイム→非更新
 * - 壊れた保存値（NaN・負数・非数値文字列・空文字）は「記録なし」として安全に上書き可能
 * - 通しトータルベストも同じ判定
 * - 保存キーは難易度別：hanedan.best.<難易度>.mission.<n> / hanedan.best.<難易度>.total
 *   （GDD §8.3 v0.9。Records の難易度は省略時 normal＝既存呼び出しの互換維持）
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
    expect(store.get("hanedan.best.normal.mission.1")).toBe("12.5"); // GDD §8.3 の難易度別キー（既定 normal）
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
    store.set(RECORD_KEYS.mission("normal", 1), broken);
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

  it("通しトータルベスト：初回→更新、速い→更新、遅い→非更新。キーは hanedan.best.<難易度>.total", () => {
    const store = memoryStore();
    const records = new Records(store);
    expect(records.totalBest()).toBeNull();
    expect(records.submitTotalTime(300.5)).toBe(true); // 初回
    expect(store.get(RECORD_KEYS.total("normal"))).toBe("300.5");
    expect(store.get("hanedan.best.normal.total")).toBe("300.5"); // GDD §8.3 の難易度別キー
    expect(records.submitTotalTime(250.0)).toBe(true); // 速い
    expect(records.submitTotalTime(280.0)).toBe(false); // 遅い
    expect(records.totalBest()).toBe(250.0);
  });

  it("トータルベストの壊れた保存値も安全に上書きできる", () => {
    const store = memoryStore();
    store.set(RECORD_KEYS.total("normal"), "not-a-number");
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

describe("ベスト記録の難易度別化（GDD §8.3 v0.9）", () => {
  it("難易度ごとにキーが分かれる：easy の記録は normal・hard に影響しない", () => {
    const store = memoryStore();
    const easy = new Records(store, "easy");
    const normal = new Records(store, "normal");
    const hard = new Records(store, "hard");
    expect(easy.submitMissionTime(1, 10.0)).toBe(true);
    expect(store.get("hanedan.best.easy.mission.1")).toBe("10");
    expect(normal.missionBest(1)).toBeNull(); // easy の記録は normal に見えない
    expect(hard.missionBest(1)).toBeNull();
    // normal で遅いタイムを出しても easy とは独立に「初回更新」になる
    expect(normal.submitMissionTime(1, 99.0)).toBe(true);
    expect(easy.missionBest(1)).toBe(10.0); // easy 側は保持
    expect(normal.missionBest(1)).toBe(99.0);
  });

  it("通しトータルベストも難易度ごとに独立する", () => {
    const store = memoryStore();
    const easy = new Records(store, "easy");
    const hard = new Records(store, "hard");
    expect(easy.submitTotalTime(200.0)).toBe(true);
    expect(hard.totalBest()).toBeNull();
    expect(hard.submitTotalTime(300.0)).toBe(true); // easy より遅くても hard では初回更新
    expect(store.get(RECORD_KEYS.total("easy"))).toBe("200");
    expect(store.get(RECORD_KEYS.total("hard"))).toBe("300");
  });

  it("旧キー（難易度なし）の記録は参照しない", () => {
    const store = memoryStore();
    store.set("hanedan.best.mission.1", "5"); // 旧形式の残骸
    store.set("hanedan.best.total", "100");
    const records = new Records(store, "normal");
    expect(records.missionBest(1)).toBeNull(); // 移行せず無視（GDD §8.3）
    expect(records.totalBest()).toBeNull();
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
