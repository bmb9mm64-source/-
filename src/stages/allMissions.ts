/**
 * 本編ミッションの結合リスト
 * （M1〜M5＝missions.ts、M6〜M10＝missionsExt.ts、M11〜M15＝missionsExt2.ts）。
 * ゲーム本編・テストはこのモジュールを参照する（データ本体は各ファイルが一次ソース）。
 */
import { MISSIONS } from "./missions";
import { MISSIONS_EXT } from "./missionsExt";
import { MISSIONS_EXT2 } from "./missionsExt2";
import { MISSIONS_EXT3 } from "./missionsExt3";
import { MISSIONS_GEN } from "./missionsGen";

export const ALL_MISSIONS: { name: string; grid: string[] }[] = [
  ...MISSIONS, // M1〜M5（手設計）
  ...MISSIONS_EXT, // M6〜M10（手設計）
  ...MISSIONS_EXT2, // M11〜M15（手設計）
  ...MISSIONS_EXT3, // M16（手設計）
  ...MISSIONS_GEN, // M17〜M50（scripts/generateMissions.ts が生成・全条件を機械検証済み）
];
