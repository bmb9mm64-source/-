/**
 * 本編ミッションの結合リスト（M1〜M5＝missions.ts、M6〜M10＝missionsExt.ts）。
 * ゲーム本編・テストはこのモジュールを参照する（データ本体は各ファイルが一次ソース）。
 */
import { MISSIONS } from "./missions";
import { MISSIONS_EXT } from "./missionsExt";

export const ALL_MISSIONS: { name: string; grid: string[] }[] = [...MISSIONS, ...MISSIONS_EXT];
