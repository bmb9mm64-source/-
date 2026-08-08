/**
 * 遊び方のモードと実績（GDD §8.7・§14 の E6）のテスト。
 *
 * 守りたいのは次の3点：
 *   ① タイムアタック・サバイバルは難易度によらず残機1（記録の意味が難易度で変わらない）
 *   ② シャッフルは中身を落とさない（50面が49面になったり同じ面が2回出たりしない）
 *   ③ 実績は条件を満たしたときだけ・**はじめて**満たしたときだけ解除される
 */
import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  AchievementStore,
  buildRunSnapshot,
  evaluateAchievements,
  QUICK_DRAW_SECONDS,
  type RunSnapshot,
} from "../src/core/achievements";
import { MODE_LIVES, shuffleMissions } from "../src/core/gameModes";
import { memoryStore, Records } from "../src/core/records";
import { GameWorld, type MissionDef } from "../src/core/world";
import { FLOOR_5X5 } from "./helpers";

/** 敵を1体だけ置いた最小ミッション（盤面の中身はここでは問わない） */
function mission(name: string): MissionDef {
  return { name, grid: [...FLOOR_5X5] };
}

describe("モードごとの残機（GDD §8.7）", () => {
  it("キャンペーンは難易度どおりの残機", () => {
    expect(MODE_LIVES.campaign).toBeNull();
    const easy = new GameWorld([mission("m")], () => 0.5, 1, "easy", MODE_LIVES.campaign);
    const hard = new GameWorld([mission("m")], () => 0.5, 1, "hard", MODE_LIVES.campaign);
    expect(easy.lives).toBeGreaterThan(hard.lives); // EASY のほうが多い（GDD §8.3）
  });

  it("タイムアタック・サバイバルは難易度によらず1機", () => {
    for (const mode of ["timeAttack", "survival"] as const) {
      for (const d of ["easy", "normal", "hard"] as const) {
        const w = new GameWorld([mission("m")], () => 0.5, 1, d, MODE_LIVES[mode]);
        expect(w.lives, `${mode}/${d}`).toBe(1);
      }
    }
  });

  it("残機を使い切ったあとのやり直しでも1機のまま", () => {
    const w = new GameWorld([mission("m")], () => 0.5, 1, "easy", MODE_LIVES.survival);
    w.resetGame();
    expect(w.lives).toBe(1);
  });
});

describe("ミッションのシャッフル（サバイバル用）", () => {
  const src = Array.from({ length: 50 }, (_, i) => mission(`M${i + 1}`));

  it("元の配列を変えず、同じ顔ぶれを過不足なく返す", () => {
    const before = src.map((m) => m.name);
    const out = shuffleMissions(src, () => 0.5);
    expect(out).toHaveLength(src.length);
    expect([...out.map((m) => m.name)].sort()).toEqual([...before].sort());
    expect(src.map((m) => m.name)).toEqual(before); // 元は不変
  });

  it("乱数が同じなら並びも同じ（再現できる）", () => {
    let seed = 1;
    const rng = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const a = shuffleMissions(src, rng);
    seed = 1;
    const b = shuffleMissions(src, rng);
    expect(a.map((m) => m.name)).toEqual(b.map((m) => m.name));
  });

  it("並びは実際に変わる（そのまま返していない）", () => {
    let i = 0;
    const rng = (): number => [0.9, 0.1, 0.8, 0.2, 0.7][i++ % 5]!;
    const out = shuffleMissions(src, rng);
    expect(out.map((m) => m.name)).not.toEqual(src.map((m) => m.name));
  });
});

/** 何も達成していないランの雛形 */
function run(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    mode: "campaign",
    difficulty: "normal",
    playerCount: 1,
    clearedCount: 0,
    reachedMission: 1,
    allCleared: false,
    noMiss: true,
    lastClearTime: null,
    ...overrides,
  };
}

describe("実績の判定（純粋関数）", () => {
  it("何もしていないランでは1つも解除されない", () => {
    expect(evaluateAchievements(run())).toEqual([]);
  });

  it("1面クリアで「初出撃」", () => {
    expect(evaluateAchievements(run({ clearedCount: 1 }))).toContain("first_clear");
  });

  it("到達ミッションで段階的に解除される", () => {
    expect(evaluateAchievements(run({ reachedMission: 9 }))).not.toContain("reach_10");
    expect(evaluateAchievements(run({ reachedMission: 10 }))).toContain("reach_10");
    expect(evaluateAchievements(run({ reachedMission: 10 }))).not.toContain("reach_25");
    expect(evaluateAchievements(run({ reachedMission: 25 }))).toContain("reach_25");
  });

  it("「無傷の帰還」は全クリアかつ無被弾のときだけ", () => {
    expect(evaluateAchievements(run({ allCleared: true, noMiss: true }))).toContain("no_miss");
    expect(evaluateAchievements(run({ allCleared: true, noMiss: false }))).not.toContain("no_miss");
    expect(evaluateAchievements(run({ allCleared: false, noMiss: true }))).not.toContain("no_miss");
  });

  it("「難関突破」は HARD の全クリアだけ", () => {
    const hard = run({ allCleared: true, difficulty: "hard" });
    expect(evaluateAchievements(hard)).toContain("hard_clear");
    expect(evaluateAchievements({ ...hard, difficulty: "normal" })).not.toContain("hard_clear");
  });

  it("「二人三脚」は2人プレイでクリアしたときだけ", () => {
    expect(evaluateAchievements(run({ clearedCount: 1, playerCount: 2 }))).toContain("coop_clear");
    expect(evaluateAchievements(run({ clearedCount: 0, playerCount: 2 }))).not.toContain(
      "coop_clear",
    );
  });

  it("「早撃ち」はタイムアタックで基準タイム以内のときだけ", () => {
    const fast = run({ mode: "timeAttack", clearedCount: 1, lastClearTime: QUICK_DRAW_SECONDS });
    expect(evaluateAchievements(fast)).toContain("quick_draw");
    expect(evaluateAchievements({ ...fast, lastClearTime: QUICK_DRAW_SECONDS + 0.1 })).not.toContain(
      "quick_draw",
    );
    // キャンペーンで速くクリアしても対象外（残機が多く条件が違うため）
    expect(evaluateAchievements({ ...fast, mode: "campaign" })).not.toContain("quick_draw");
  });

  it("サバイバルの実績はクリア数で決まる", () => {
    expect(evaluateAchievements(run({ mode: "survival", clearedCount: 9 }))).not.toContain(
      "survivor_10",
    );
    expect(evaluateAchievements(run({ mode: "survival", clearedCount: 10 }))).toContain(
      "survivor_10",
    );
    expect(evaluateAchievements(run({ mode: "survival", clearedCount: 25 }))).toContain(
      "survivor_25",
    );
    // 同じクリア数でもキャンペーンでは解除しない
    expect(evaluateAchievements(run({ mode: "campaign", clearedCount: 25 }))).not.toContain(
      "survivor_10",
    );
  });

  it("判定が返す id はすべて一覧に実在する", () => {
    const all = new Set(ACHIEVEMENTS.map((a) => a.id));
    const everything = evaluateAchievements(
      run({
        mode: "survival",
        difficulty: "hard",
        playerCount: 2,
        clearedCount: 50,
        reachedMission: 50,
        allCleared: true,
        lastClearTime: 1,
      }),
    );
    for (const id of everything) expect(all.has(id), id).toBe(true);
  });

  it("id は重複しない", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe("実績の保存", () => {
  it("はじめて達成したときだけ解除として返す", () => {
    const store = new AchievementStore(memoryStore());
    const first = store.submit(run({ clearedCount: 1 }));
    expect(first.map((a) => a.id)).toEqual(["first_clear"]);
    const second = store.submit(run({ clearedCount: 1 }));
    expect(second, "2回目は「新たに解除」ではない").toEqual([]);
    expect(store.isUnlocked("first_clear")).toBe(true);
  });

  it("一覧は全件を解除状態つきで返す", () => {
    const store = new AchievementStore(memoryStore());
    expect(store.list()).toHaveLength(ACHIEVEMENTS.length);
    expect(store.unlockedCount()).toBe(0);
    store.unlock("first_clear");
    expect(store.unlockedCount()).toBe(1);
    expect(store.list().find((e) => e.def.id === "first_clear")!.unlocked).toBe(true);
  });
});

describe("サバイバルの記録（大きいほど良い）", () => {
  it("記録なしは 0、より多くクリアしたときだけ更新する", () => {
    const r = new Records(memoryStore(), "normal");
    expect(r.survivalBest()).toBe(0);
    expect(r.submitSurvival(5)).toBe(true);
    expect(r.survivalBest()).toBe(5);
    expect(r.submitSurvival(5), "同数は更新しない").toBe(false);
    expect(r.submitSurvival(4), "下回るときは更新しない").toBe(false);
    expect(r.submitSurvival(6)).toBe(true);
    expect(r.survivalBest()).toBe(6);
  });

  it("不正な値は保存しない", () => {
    const r = new Records(memoryStore(), "normal");
    expect(r.submitSurvival(Number.NaN)).toBe(false);
    expect(r.submitSurvival(-1)).toBe(false);
    expect(r.survivalBest()).toBe(0);
  });

  it("難易度ごとに別の記録になる", () => {
    const store = memoryStore();
    new Records(store, "easy").submitSurvival(9);
    expect(new Records(store, "hard").survivalBest()).toBe(0);
    expect(new Records(store, "easy").survivalBest()).toBe(9);
  });
});

describe("ランの結果の組み立て（buildRunSnapshot・GDD §14 の E7）", () => {
  const base = {
    clearedTimes: [1.5, 2.5, undefined, 4.0] as (number | undefined)[],
    missionIndex: 3,
    lives: 2,
    livesAtStart: 3,
    lastClearTime: 4.0,
    timeAttackMission: 12,
  };

  it("クリア数は「タイムが入っている数」（途中の欠けを数えない）", () => {
    const snap = buildRunSnapshot("campaign", "normal", 1, false, base);
    expect(snap.clearedCount).toBe(3);
  });

  it("キャンペーンの到達ミッションは添字＋1", () => {
    expect(buildRunSnapshot("campaign", "normal", 1, false, base).reachedMission).toBe(4);
  });

  it("キャンペーン以外は選んだ面の番号を使う（並びを組み替えているため）", () => {
    for (const mode of ["timeAttack", "survival", "tutorial"] as const) {
      expect(buildRunSnapshot(mode, "normal", 1, false, base).reachedMission, mode).toBe(12);
    }
  });

  it("全クリアの扱いはキャンペーンだけ（1面だけ遊んで全制覇にはしない）", () => {
    expect(buildRunSnapshot("campaign", "normal", 1, true, base).allCleared).toBe(true);
    expect(buildRunSnapshot("timeAttack", "normal", 1, true, base).allCleared).toBe(false);
    expect(buildRunSnapshot("survival", "normal", 1, true, base).allCleared).toBe(false);
  });

  it("無被弾は「残機が減っていないこと」", () => {
    expect(buildRunSnapshot("campaign", "normal", 1, false, base).noMiss).toBe(false);
    const intact = { ...base, lives: 3 };
    expect(buildRunSnapshot("campaign", "normal", 1, false, intact).noMiss).toBe(true);
  });

  it("難易度・人数・直近タイムはそのまま引き継ぐ", () => {
    const snap = buildRunSnapshot("campaign", "hard", 2, false, base);
    expect(snap.difficulty).toBe("hard");
    expect(snap.playerCount).toBe(2);
    expect(snap.lastClearTime).toBe(4.0);
  });

  it("1つもクリアしていないランは clearedCount 0 で実績も出ない", () => {
    const none = { ...base, clearedTimes: [undefined, undefined], missionIndex: 0 };
    const snap = buildRunSnapshot("campaign", "normal", 1, false, none);
    expect(snap.clearedCount).toBe(0);
    expect(evaluateAchievements(snap)).toEqual([]);
  });
});
