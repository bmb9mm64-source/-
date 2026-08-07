/**
 * 難易度選択（GDD §8.3 v0.9。Phaser 非依存の純粋 TS）。
 * - 数値そのもの（残機・各倍率・確率）は BALANCE.DIFFICULTY に集約し、
 *   本モジュールは「選択の保存/読込」と「選択→調整値の解決」だけを担う。
 * - 保存は RecordStore 抽象（records.ts）を再利用した注入式。キーは `hanedan.difficulty`。
 * - 難易度は敵の脅威度のみを変える。プレイヤー性能・ステージ地形・敵配置は不変。
 */
import { BALANCE } from "../config/balance";
import type { RecordStore } from "./records";

/** 難易度（GDD §8.3：EASY / NORMAL / HARD。既定は normal） */
export type Difficulty = "easy" | "normal" | "hard";

/** 全難易度（UI のトグル表示順） */
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/** UI 表示ラベル */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "EASY",
  normal: "NORMAL",
  hard: "HARD",
};

/** 難易度選択の保存キー（localStorage。GDD §8.3「選択はローカル保存し次回も維持」） */
export const DIFFICULTY_STORE_KEY = "hanedan.difficulty";

/** 値が難易度として妥当か（保存値の検証に使う） */
export function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "normal" || value === "hard";
}

/** 難易度から解決した実効調整値（敵AI・ワールドが参照する形） */
export interface DifficultyMods {
  lives: number; // 初期残機
  fireIntervalMult: number; // 敵の発射間隔倍率
  bulletSpeedMult: number; // 敵弾速の倍率（スナイパー弾含む全敵弾）
  turretRicochetChance: number; // 固定砲台（A・C）の跳弾狙撃確率（E は常時100%で対象外）
  roverDodgeChance: number; // ローバーの回避成功率
}

/** 難易度を実効調整値に解決する（数値の出所は BALANCE.DIFFICULTY） */
export function resolveDifficulty(difficulty: Difficulty): DifficultyMods {
  const c = BALANCE.DIFFICULTY[difficulty];
  return {
    lives: c.LIVES,
    fireIntervalMult: c.FIRE_INTERVAL_MULT,
    bulletSpeedMult: c.BULLET_SPEED_MULT,
    turretRicochetChance: c.TURRET_RICOCHET_CHANCE,
    roverDodgeChance: c.ROVER_DODGE_CHANCE,
  };
}

/**
 * 既定（NORMAL）の実効調整値。
 * 敵AIの更新コンテキストで mods が未注入のとき（既存テスト・単体利用）の互換用。
 */
export const NORMAL_MODS: DifficultyMods = resolveDifficulty("normal");

/** 保存済みの難易度選択を読む。未保存・壊れた値は既定の normal（GDD §8.3） */
export function loadDifficulty(store: RecordStore): Difficulty {
  const raw = store.get(DIFFICULTY_STORE_KEY);
  return isDifficulty(raw) ? raw : "normal";
}

/** 難易度選択を保存する */
export function saveDifficulty(store: RecordStore, difficulty: Difficulty): void {
  store.set(DIFFICULTY_STORE_KEY, difficulty);
}
