/**
 * 遊び方のモード（GDD §8.7・§14 の E6。Phaser 非依存の純粋 TS）。
 *
 * 50面をクリアしたあとに戻ってくる理由が無かったので、同じ盤面を別のルールで遊べるようにする。
 * **盤面は増やさない**（新しいミッションを作るのではなく、既存50面の遊び方を変えるだけ）。
 *
 *   campaign … 従来どおり M1 から順に、難易度ぶんの残機で通す
 *   tutorial … 跳弾を段階的に教える3面（本編とは別立て。GDD §8.8）
 *   timeAttack … 選んだ1面だけを残機1で遊ぶ。クリアしたらミッション選択へ戻る＝記録を詰める遊び
 *   survival … 全50面をシャッフルして残機1で連続。どこまで行けたかが記録
 *
 * survival を「無限に自動生成し続ける」形にしなかったのは、面の生成器
 * （scripts/generateMissions.ts）をゲーム本体から import しない設計にしているため
 * （生成物は全条件を機械検証してからミッション表に取り込む、という手順を崩さない）。
 * 50面をシャッフルして残機1なら、実質的に「どこまで耐えられるか」の遊びとして成立する。
 */
import type { Rng } from "./mathUtils";
import type { MissionDef } from "./world";

/** チュートリアルの残機（教え切る前に終わらせないため多め） */
export const TUTORIAL_LIVES = 9;

/** 遊び方のモード */
export type GameMode = "campaign" | "tutorial" | "timeAttack" | "survival";

/** 画面に出す名前 */
export const MODE_LABELS: Record<GameMode, string> = {
  campaign: "キャンペーン",
  tutorial: "れんしゅう",
  timeAttack: "タイムアタック",
  survival: "サバイバル",
};

/**
 * そのモードの残機。null は「難易度どおり（＝GameWorld の既定）」。
 * timeAttack と survival は1機固定＝難易度を変えても記録の意味が変わらないようにする。
 */
export const MODE_LIVES: Record<GameMode, number | null> = {
  campaign: null,
  // 練習で残機切れになると教える前に終わってしまうので多めに固定する
  tutorial: TUTORIAL_LIVES,
  timeAttack: 1,
  survival: 1,
};

/**
 * ミッションの並びをシャッフルした新しい配列を返す（Fisher–Yates。元の配列は変えない）。
 * 乱数は注入式なので、テストでは決定的な並びを作れる。
 */
export function shuffleMissions(
  missions: readonly MissionDef[],
  rng: Rng,
): MissionDef[] {
  const out = missions.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}
