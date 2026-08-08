/**
 * 実績（GDD §8.7・§14 の E6。Phaser 非依存の純粋 TS）。
 *
 * 「まだ達成していないこと」が一覧で見えると、50面クリア後にもう一度触る理由になる。
 * 判定は**このランの結果だけを見る純粋関数**（evaluateAchievements）に閉じ込め、
 * 保存は Records と同じ RecordStore 注入で行う（core を localStorage に依存させない）。
 *
 * 条件は「いま持っているデータだけで判定できるもの」に絞った。
 * 跳弾での撃破数のような新しい計測が要るものは足していない
 * （計測を増やすと GameWorld に統計用の状態が増え、テストの対象が広がるため）。
 */
import type { Difficulty } from "./difficulty";
import type { GameMode } from "./gameModes";

/** 実績1件の定義 */
export interface AchievementDef {
  id: string;
  name: string;
  /** 達成条件の説明（そのまま画面に出す） */
  desc: string;
}

/** 実績の一覧（この順で画面に並べる） */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: "first_clear", name: "初出撃", desc: "ミッションを1つクリアする" },
  { id: "reach_10", name: "十番勝負", desc: "M10 に到達する" },
  { id: "reach_25", name: "折り返し", desc: "M25 に到達する" },
  { id: "all_clear", name: "全50制覇", desc: "全ミッションをクリアする" },
  { id: "no_miss", name: "無傷の帰還", desc: "残機を1つも失わずに全ミッションをクリアする" },
  { id: "hard_clear", name: "難関突破", desc: "HARD で全ミッションをクリアする" },
  { id: "coop_clear", name: "二人三脚", desc: "2人プレイでミッションをクリアする" },
  { id: "quick_draw", name: "早撃ち", desc: "タイムアタックで 10 秒以内にクリアする" },
  { id: "survivor_10", name: "生存者", desc: "サバイバルで10面クリアする" },
  { id: "survivor_25", name: "不死身", desc: "サバイバルで25面クリアする" },
] as const;

/** 実績の保存キー */
export const ACHIEVEMENT_KEY = (id: string): string => `hanedan.achievement.${id}`;

/** 判定に使うランの結果（GameScene が組み立てて渡す） */
export interface RunSnapshot {
  mode: GameMode;
  difficulty: Difficulty;
  playerCount: number;
  /** このランでクリアしたミッションの数（0 なら1つもクリアしていない） */
  clearedCount: number;
  /** 到達したミッション番号（1始まり。キャンペーンの進捗表示と同じ意味） */
  reachedMission: number;
  /** 全ミッションをクリアしたか */
  allCleared: boolean;
  /** 残機を1つも失っていないか */
  noMiss: boolean;
  /** 直近にクリアしたミッションのタイム [s]（クリアしていなければ null） */
  lastClearTime: number | null;
}

/** 「早撃ち」の基準タイム [s] */
export const QUICK_DRAW_SECONDS = 10;

/**
 * このランで満たした実績の id を返す（既に解除済みかは見ない＝呼び出し側が保存時に判定する）。
 * 純粋関数なので、条件を足すときはここだけをテストすればよい。
 */
export function evaluateAchievements(run: RunSnapshot): string[] {
  const got: string[] = [];
  const cleared = run.clearedCount > 0;
  if (cleared) got.push("first_clear");
  if (run.reachedMission >= 10) got.push("reach_10");
  if (run.reachedMission >= 25) got.push("reach_25");
  if (run.allCleared) got.push("all_clear");
  if (run.allCleared && run.noMiss) got.push("no_miss");
  if (run.allCleared && run.difficulty === "hard") got.push("hard_clear");
  if (cleared && run.playerCount >= 2) got.push("coop_clear");
  if (
    run.mode === "timeAttack" &&
    cleared &&
    run.lastClearTime !== null &&
    run.lastClearTime <= QUICK_DRAW_SECONDS
  ) {
    got.push("quick_draw");
  }
  if (run.mode === "survival" && run.clearedCount >= 10) got.push("survivor_10");
  if (run.mode === "survival" && run.clearedCount >= 25) got.push("survivor_25");
  return got;
}

/** ランの終了時にワールドから読み取る値（GameScene が渡す） */
export interface RunEndState {
  /** クリアしたミッションのタイム（未クリアは undefined。world.clearedTimes をそのまま渡す） */
  clearedTimes: readonly (number | undefined)[];
  /** 現在のミッションの添字（0始まり） */
  missionIndex: number;
  /** 残りの残機 */
  lives: number;
  /** ラン開始時の残機 */
  livesAtStart: number;
  /** 直近にクリアしたミッションのタイム [s] */
  lastClearTime: number | null;
  /** タイムアタックで遊んでいるミッション番号（1始まり） */
  timeAttackMission: number;
}

/**
 * ワールドの状態から実績判定用のランの結果を組み立てる（GDD §8.7・§14 の E7）。
 *
 * モードによって「到達ミッション」の意味が変わるのがややこしいところ。
 *   campaign … 並びが本編どおりなので添字＋1がそのままミッション番号
 *   それ以外 … 並びを組み替えている（タイムアタックは1面だけ、サバイバルはシャッフル）ので
 *              添字は本編のミッション番号にならない。選んだ面の番号を使う
 * 全クリアの実績もキャンペーンだけが対象（1面だけ遊んで「全50制覇」にはならない）。
 */
export function buildRunSnapshot(
  mode: GameMode,
  difficulty: Difficulty,
  playerCount: number,
  allCleared: boolean,
  state: RunEndState,
): RunSnapshot {
  const clearedCount = state.clearedTimes.filter((t) => t !== undefined).length;
  return {
    mode,
    difficulty,
    playerCount,
    clearedCount,
    reachedMission: mode === "campaign" ? state.missionIndex + 1 : state.timeAttackMission,
    allCleared: allCleared && mode === "campaign",
    noMiss: state.lives >= state.livesAtStart,
    lastClearTime: state.lastClearTime,
  };
}

/** 実績の保存・読み出し（Records と同じ RecordStore を使う） */
export class AchievementStore {
  private readonly store: { get(key: string): string | null; set(key: string, value: string): void };

  constructor(store: { get(key: string): string | null; set(key: string, value: string): void }) {
    this.store = store;
  }

  /** 解除済みか */
  isUnlocked(id: string): boolean {
    return this.store.get(ACHIEVEMENT_KEY(id)) === "1";
  }

  /** 解除する。**新たに**解除したときだけ true（既に解除済みなら false） */
  unlock(id: string): boolean {
    if (this.isUnlocked(id)) return false;
    this.store.set(ACHIEVEMENT_KEY(id), "1");
    return true;
  }

  /**
   * ランの結果を提出し、**今回はじめて**解除された実績の定義を返す。
   * 画面に「実績解除！」を出すのは、この戻り値が空でないときだけ。
   */
  submit(run: RunSnapshot): AchievementDef[] {
    const ids = new Set(evaluateAchievements(run));
    return ACHIEVEMENTS.filter((a) => ids.has(a.id) && this.unlock(a.id));
  }

  /** 一覧（解除状態つき）。画面はこれをそのまま並べる */
  list(): { def: AchievementDef; unlocked: boolean }[] {
    return ACHIEVEMENTS.map((def) => ({ def, unlocked: this.isUnlocked(def.id) }));
  }

  /** 解除数 */
  unlockedCount(): number {
    return ACHIEVEMENTS.reduce((n, a) => n + (this.isUnlocked(a.id) ? 1 : 0), 0);
  }
}
