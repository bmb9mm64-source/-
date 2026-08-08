/**
 * ミッション選択シーン（GDD §8.7・§14 の E6）— タイムアタックの入口。
 *
 * 到達済みのミッションを一覧で見せ、選んだ1面だけを**残機1**で遊べるようにする。
 * ミッション別ベストタイムをその場に出すので、「どこを詰めるか」を選ぶ画面にもなる。
 * 未到達のミッションは押せない（キャンペーンで進めた範囲だけが遊べる＝進行の意味を保つ）。
 *
 * 描画はすべてコード描画（外部アセット禁止）。ロジック（記録・実績）は core にある。
 */
import Phaser from "phaser";
import { SFX } from "../audio/sfx";
import { COLORS } from "../config/balance";
import { AchievementStore } from "../core/achievements";
import { type Difficulty, DIFFICULTY_LABELS, loadDifficulty } from "../core/difficulty";
import { formatTime, Records, type RecordStore, safeLocalStorageStore } from "../core/records";
import { ALL_MISSIONS } from "../stages/allMissions";
import { applyRenderScale, TEXT_RESOLUTION, VIEW_H, VIEW_W } from "./renderScale";
import { bindSceneAudio } from "./sceneAudio";
import { drawFloorGrid, textButton } from "./sceneUi";

/** 一覧の並べ方（10列×5行で全50面がちょうど1画面に収まる） */
const COLUMNS = 10;
const CELL_W = 70;
const CELL_H = 62;
const TOP = 116;

export class MissionSelectScene extends Phaser.Scene {
  private store: RecordStore = safeLocalStorageStore();
  private difficulty: Difficulty = "normal";

  constructor() {
    super({ key: "MissionSelectScene" });
  }

  create(): void {
    applyRenderScale(this);
    this.input.setDefaultCursor("default");
    drawFloorGrid(this.add.graphics());

    this.difficulty = loadDifficulty(this.store);
    const records = new Records(this.store, this.difficulty);
    const reached = records.reachedBest();

    const label = { fontFamily: "sans-serif", color: "#e8ecf5", resolution: TEXT_RESOLUTION };
    this.add
      .text(VIEW_W / 2, 40, "タイムアタック — ミッション選択", { ...label, fontSize: "26px" })
      .setOrigin(0.5);
    this.add
      .text(
        VIEW_W / 2,
        72,
        `[${DIFFICULTY_LABELS[this.difficulty]}]　残機1で1面だけ遊びます　到達済み: M1〜M${reached}`,
        { ...label, fontSize: "14px", color: "#9aa3b5" },
      )
      .setOrigin(0.5);

    const gridW = COLUMNS * CELL_W;
    const left = (VIEW_W - gridW) / 2 + CELL_W / 2;
    ALL_MISSIONS.forEach((_m, i) => {
      const n = i + 1;
      const x = left + (i % COLUMNS) * CELL_W;
      const y = TOP + Math.floor(i / COLUMNS) * CELL_H;
      const playable = n <= reached;
      const best = records.missionBest(n);
      const style = {
        ...label,
        fontSize: "16px",
        fontStyle: "bold",
        color: playable ? "#ffffff" : "#5a6274",
        backgroundColor: playable ? "#343b4d" : "#242938",
        padding: { x: 8, y: 4 },
      };
      if (playable) {
        textButton(this, x, y, `M${n}`, style, () => {
          SFX.unlock();
          this.scene.start("GameScene", { mode: "timeAttack", startMission: n });
        });
      } else {
        this.add.text(x, y, `M${n}`, style).setOrigin(0.5);
      }
      // ベストタイム（無ければ「—」。ここが「詰める余地」の目印になる）
      this.add
        .text(x, y + 20, best !== null ? `${formatTime(best)}s` : "—", {
          ...label,
          fontSize: "11px",
          color: best !== null ? COLORS.RECORD_CSS : "#5a6274",
        })
        .setOrigin(0.5);
    });

    const unlocked = new AchievementStore(this.store).unlockedCount();
    textButton(
      this,
      VIEW_W / 2 - 110,
      VIEW_H - 34,
      `実績（${unlocked}）`,
      { ...label, fontSize: "16px", backgroundColor: "#2b3040", padding: { x: 12, y: 5 } },
      () => this.scene.start("AchievementsScene"),
    );
    textButton(
      this,
      VIEW_W / 2 + 110,
      VIEW_H - 34,
      "[T] タイトルへ",
      { ...label, fontSize: "16px", backgroundColor: "#2b3040", padding: { x: 12, y: 5 } },
      () => this.scene.start("TitleScene"),
    );
    this.input.keyboard?.on("keydown-T", () => this.scene.start("TitleScene"));
    this.input.keyboard?.on("keydown-ESC", () => this.scene.start("TitleScene"));

    bindSceneAudio(this, "title");
  }
}
