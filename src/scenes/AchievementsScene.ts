/**
 * 実績シーン（GDD §8.7・§14 の E6）— 達成済み／未達成の一覧。
 *
 * 「まだ達成していないこと」が見えることが目的なので、**未達成でも条件を隠さない**
 * （隠すと何をすればよいか分からず、遊び直す理由にならない）。
 * 判定と保存は core/achievements.ts にあり、ここは並べるだけ。
 */
import Phaser from "phaser";
import { AchievementStore, ACHIEVEMENTS } from "../core/achievements";
import { type RecordStore, safeLocalStorageStore } from "../core/records";
import { applyRenderScale, TEXT_RESOLUTION, VIEW_H, VIEW_W } from "./renderScale";
import { bindSceneAudio } from "./sceneAudio";
import { drawFloorGrid, textButton } from "./sceneUi";

const TOP = 104;
const ROW_H = 38;

export class AchievementsScene extends Phaser.Scene {
  private store: RecordStore = safeLocalStorageStore();

  constructor() {
    super({ key: "AchievementsScene" });
  }

  create(): void {
    applyRenderScale(this);
    this.input.setDefaultCursor("default");
    drawFloorGrid(this.add.graphics());

    const label = { fontFamily: "sans-serif", color: "#e8ecf5", resolution: TEXT_RESOLUTION };
    const achievements = new AchievementStore(this.store);
    const list = achievements.list();

    this.add
      .text(VIEW_W / 2, 40, "実績", { ...label, fontSize: "26px" })
      .setOrigin(0.5);
    this.add
      .text(VIEW_W / 2, 70, `${achievements.unlockedCount()} / ${ACHIEVEMENTS.length} 達成`, {
        ...label,
        fontSize: "14px",
        color: "#9aa3b5",
      })
      .setOrigin(0.5);

    const left = 130;
    list.forEach(({ def, unlocked }, i) => {
      const y = TOP + i * ROW_H;
      this.add
        .text(left - 26, y, unlocked ? "★" : "☆", {
          ...label,
          fontSize: "20px",
          color: unlocked ? "#f2c14e" : "#4a5163",
        })
        .setOrigin(0.5);
      this.add.text(left, y, def.name, {
        ...label,
        fontSize: "17px",
        fontStyle: "bold",
        color: unlocked ? "#ffffff" : "#6b7488",
      }).setOrigin(0, 0.5);
      this.add.text(left + 170, y, def.desc, {
        ...label,
        fontSize: "14px",
        color: unlocked ? "#9aa3b5" : "#5a6274",
      }).setOrigin(0, 0.5);
    });

    textButton(
      this,
      VIEW_W / 2,
      VIEW_H - 34,
      "[T] もどる",
      { ...label, fontSize: "16px", backgroundColor: "#2b3040", padding: { x: 12, y: 5 } },
      () => this.scene.start("MissionSelectScene"),
    );
    this.input.keyboard?.on("keydown-T", () => this.scene.start("MissionSelectScene"));
    this.input.keyboard?.on("keydown-ESC", () => this.scene.start("MissionSelectScene"));

    bindSceneAudio(this, "title");
  }
}
