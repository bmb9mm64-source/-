/**
 * ベスト記録の読み書き（GDD §8.5。Phaser 非依存の純粋 TS）。
 *
 * - localStorage（ブラウザ内保存。サーバ送信なし）への依存は注入式：
 *   Storage 互換の get/set を持つ薄い抽象 RecordStore を受け取り、core を純粋に保つ。
 *   テストではメモリ実装（memoryStore）、実行時は safeLocalStorageStore を使う。
 * - 保存キー：`hanedan.best.mission.<n>`（n はミッション番号。1始まり）と `hanedan.best.total`。
 * - 壊れた保存値（NaN・負数・非数値文字列・空文字）は「記録なし」として無視し、上書き可能にする。
 * - タイムは秒単位の数値を文字列で保存する（表示丸めはせず全精度で比較する）。
 */

/** Storage 互換の薄い抽象（localStorage の getItem/setItem に対応） */
export interface RecordStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** 保存キー（GDD §8.5：`hanedan.best.*`） */
export const RECORD_KEYS = {
  /** ミッション別ベストタイム（missionNumber は1始まり） */
  mission: (missionNumber: number): string => `hanedan.best.mission.${missionNumber}`,
  /** 通しトータルタイムのベスト */
  total: "hanedan.best.total",
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

/** ベスト記録の読み書きと更新判定（GDD §8.5） */
export class Records {
  private readonly store: RecordStore;

  constructor(store: RecordStore) {
    this.store = store;
  }

  /** ミッション別ベストタイム [s]（missionNumber は1始まり。記録なし・壊れた値は null） */
  missionBest(missionNumber: number): number | null {
    return parseStoredTime(this.store.get(RECORD_KEYS.mission(missionNumber)));
  }

  /** 通しトータルタイムのベスト [s]（記録なし・壊れた値は null） */
  totalBest(): number | null {
    return parseStoredTime(this.store.get(RECORD_KEYS.total));
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
    this.store.set(RECORD_KEYS.mission(missionNumber), String(time));
    return true;
  }

  /** 通しトータルタイムを提出し、ベスト更新なら保存して true を返す（判定は submitMissionTime と同様） */
  submitTotalTime(time: number): boolean {
    if (!isValidTime(time)) return false;
    const best = this.totalBest();
    if (best !== null && time >= best) return false;
    this.store.set(RECORD_KEYS.total, String(time));
    return true;
  }
}
