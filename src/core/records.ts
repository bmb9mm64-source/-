/**
 * ベスト記録の読み書き（GDD §8.5。Phaser 非依存の純粋 TS）。
 *
 * - localStorage（ブラウザ内保存。サーバ送信なし）への依存は注入式：
 *   Storage 互換の get/set を持つ薄い抽象 RecordStore を受け取り、core を純粋に保つ。
 *   テストではメモリ実装（memoryStore）、実行時は safeLocalStorageStore を使う。
 * - ベスト記録は難易度別（GDD §8.3 v0.9）。保存キー：
 *   `hanedan.best.<難易度>.mission.<n>`（n はミッション番号。1始まり）と `hanedan.best.<難易度>.total`。
 *   旧キー（難易度なし）の記録は移行せず参照しない。
 * - 壊れた保存値（NaN・負数・非数値文字列・空文字）は「記録なし」として無視し、上書き可能にする。
 * - タイムは秒単位の数値を文字列で保存する（表示丸めはせず全精度で比較する）。
 */
import type { Difficulty } from "./difficulty";

/** Storage 互換の薄い抽象（localStorage の getItem/setItem に対応） */
export interface RecordStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** 保存キー（GDD §8.3・§8.5：`hanedan.best.<難易度>.*`） */
export const RECORD_KEYS = {
  /** ミッション別ベストタイム（missionNumber は1始まり） */
  mission: (difficulty: Difficulty, missionNumber: number): string =>
    `hanedan.best.${difficulty}.mission.${missionNumber}`,
  /** 通しトータルタイムのベスト */
  total: (difficulty: Difficulty): string => `hanedan.best.${difficulty}.total`,
  /** 到達済みの最高ミッション番号（GDD §8.6 v0.13：「続きから」用） */
  reached: (difficulty: Difficulty): string => `hanedan.reached.${difficulty}`,
  /** サバイバルの最高クリア数（GDD §8.7 v0.23） */
  survival: (difficulty: Difficulty): string => `hanedan.best.${difficulty}.survival`,
} as const;

/** メモリ実装（テスト・localStorage 不可時のフォールバック。保存はセッション限り） */
export function memoryStore(): RecordStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

/**
 * localStorage を安全に包む RecordStore。
 * localStorage 自体が使えない環境（プライベートモード等で例外になる場合）はメモリ実装へ
 * フォールバックし、個々の読み書きの例外も握りつぶす（記録機能の不調でゲームを止めない）。
 */
export function safeLocalStorageStore(): RecordStore {
  try {
    const ls = globalThis.localStorage; // アクセス自体が例外になる環境がある
    if (!ls) return memoryStore();
    return {
      get: (key) => {
        try {
          return ls.getItem(key);
        } catch {
          return null;
        }
      },
      set: (key, value) => {
        try {
          ls.setItem(key, value);
        } catch {
          /* 容量超過・書き込み禁止などは無視（記録されないだけ） */
        }
      },
    };
  } catch {
    return memoryStore();
  }
}

/** タイムとして妥当な値か（有限・0以上。NaN・負数・無限大は不正） */
function isValidTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** 保存文字列をタイムとして解釈する。壊れた値は null（＝記録なし扱いで上書き可能） */
function parseStoredTime(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null; // Number("") は 0 になってしまうため空文字は先に弾く
  const n = Number(trimmed);
  return isValidTime(n) ? n : null;
}

/** タイム表示の整形（0.1秒単位・切り捨て。HUD・クリア演出・記録表示で共通に使う） */
export function formatTime(seconds: number): string {
  const t = isValidTime(seconds) ? Math.floor(seconds * 10) / 10 : 0;
  return t.toFixed(1);
}

/** ベスト記録の読み書きと更新判定（GDD §8.5。難易度別に保存：GDD §8.3） */
export class Records {
  private readonly store: RecordStore;
  private readonly difficulty: Difficulty;

  constructor(store: RecordStore, difficulty: Difficulty = "normal") {
    this.store = store;
    this.difficulty = difficulty;
  }

  /** ミッション別ベストタイム [s]（missionNumber は1始まり。記録なし・壊れた値は null） */
  missionBest(missionNumber: number): number | null {
    return parseStoredTime(this.store.get(RECORD_KEYS.mission(this.difficulty, missionNumber)));
  }

  /** 通しトータルタイムのベスト [s]（記録なし・壊れた値は null） */
  totalBest(): number | null {
    return parseStoredTime(this.store.get(RECORD_KEYS.total(this.difficulty)));
  }

  /**
   * ミッションクリアタイムを提出し、ベスト更新なら保存して true を返す。
   * 初回（記録なし・壊れた記録）は必ず更新。同タイムは更新しない（厳密により速い時のみ）。
   * 不正なタイム（NaN・負数）は保存せず false。
   */
  submitMissionTime(missionNumber: number, time: number): boolean {
    if (!isValidTime(time)) return false;
    const best = this.missionBest(missionNumber);
    if (best !== null && time >= best) return false;
    this.store.set(RECORD_KEYS.mission(this.difficulty, missionNumber), String(time));
    return true;
  }

  /** 通しトータルタイムを提出し、ベスト更新なら保存して true を返す（判定は submitMissionTime と同様） */
  submitTotalTime(time: number): boolean {
    if (!isValidTime(time)) return false;
    const best = this.totalBest();
    if (best !== null && time >= best) return false;
    this.store.set(RECORD_KEYS.total(this.difficulty), String(time));
    return true;
  }

  /**
   * 到達済みの最高ミッション番号（1始まり。記録なし・壊れた値は 1＝最初から）。
   * 全50ミッションを毎回 M1 からやり直すのは現実的でないため、続きから始められるようにする（GDD §8.6）。
   */
  reachedBest(): number {
    const raw = this.store.get(RECORD_KEYS.reached(this.difficulty));
    const n = parseStoredTime(raw);
    if (n === null) return 1;
    const i = Math.floor(n);
    return i >= 1 ? i : 1;
  }

  /**
   * サバイバルの最高クリア数（GDD §8.7）。記録なし・壊れた値は 0。
   * タイムと違い「大きいほど良い」ので、提出の判定も向きが逆になる。
   */
  survivalBest(): number {
    const n = parseStoredTime(this.store.get(RECORD_KEYS.survival(this.difficulty)));
    return n === null ? 0 : Math.floor(n);
  }

  /** サバイバルのクリア数を提出し、記録更新なら保存して true を返す */
  submitSurvival(clearedCount: number): boolean {
    if (!Number.isFinite(clearedCount) || clearedCount < 0) return false;
    const n = Math.floor(clearedCount);
    if (n <= this.survivalBest()) return false;
    this.store.set(RECORD_KEYS.survival(this.difficulty), String(n));
    return true;
  }

  /** 到達したミッション番号を提出する（より奥に進んだときだけ更新） */
  submitReached(missionNumber: number): void {
    if (!Number.isFinite(missionNumber) || missionNumber < 1) return;
    const n = Math.floor(missionNumber);
    if (n <= this.reachedBest()) return;
    this.store.set(RECORD_KEYS.reached(this.difficulty), String(n));
  }
}
