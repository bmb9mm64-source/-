/**
 * MVP ミッション M1〜M5 の機械的検証（level-designer からの申し送り）。
 * 各ミッションについて：
 *   1. グリッドが正規サイズ（25×17）で外周が全て恒久壁 # であること
 *   2. P・全敵の初期位置が床であること（パース成功＝スポーンタイルが '.' になる）
 *   3. 開幕時に P から全敵への射線（hasLineOfSight）が通らないこと（開幕即撃ち抜き防止）
 * 加えて GDD §7 の敵構成（M1:A1 / M2:A2 / M3:B1 / M4:A1+B1 / M5:A2+B2）を確認する。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { hasLineOfSight } from "../src/core/los";
import { parseStage, tileAt } from "../src/core/stage";
import { MISSIONS } from "../src/stages/missions";

describe("MVP ミッション構成", () => {
  it("ミッションは5面ある（GDD §1：MVP規模）", () => {
    expect(MISSIONS).toHaveLength(5);
  });

  it("敵構成が GDD §7 の表と一致する", () => {
    const expected = [
      { sentries: 1, rovers: 0 }, // M1
      { sentries: 2, rovers: 0 }, // M2
      { sentries: 0, rovers: 1 }, // M3
      { sentries: 1, rovers: 1 }, // M4
      { sentries: 2, rovers: 2 }, // M5
    ];
    MISSIONS.forEach((m, i) => {
      const stage = parseStage(m.grid);
      expect(stage.sentrySpawns, `${m.name} のセントリー数`).toHaveLength(expected[i]!.sentries);
      expect(stage.roverSpawns, `${m.name} のローバー数`).toHaveLength(expected[i]!.rovers);
    });
  });
});

for (const mission of MISSIONS) {
  describe(`ミッション検証: ${mission.name}`, () => {
    it("グリッドは 25×17 の正規サイズである", () => {
      expect(mission.grid).toHaveLength(BALANCE.ROWS);
      for (const row of mission.grid) {
        expect(row).toHaveLength(BALANCE.COLS);
      }
    });

    it("外周は全て恒久壁 # である", () => {
      const last = BALANCE.ROWS - 1;
      for (let c = 0; c < BALANCE.COLS; c++) {
        expect(mission.grid[0]![c], `上端 col=${c}`).toBe("#");
        expect(mission.grid[last]![c], `下端 col=${c}`).toBe("#");
      }
      for (let r = 0; r < BALANCE.ROWS; r++) {
        expect(mission.grid[r]![0], `左端 row=${r}`).toBe("#");
        expect(mission.grid[r]![BALANCE.COLS - 1], `右端 row=${r}`).toBe("#");
      }
    });

    it("P・全敵の初期位置は床である", () => {
      const stage = parseStage(mission.grid); // パース成功自体が P 存在の検証を兼ねる
      const spawns = [stage.playerSpawn, ...stage.sentrySpawns, ...stage.roverSpawns];
      for (const sp of spawns) {
        const col = Math.floor(sp.x / stage.tile);
        const row = Math.floor(sp.y / stage.tile);
        expect(tileAt(stage, col, row), `(${col},${row})`).toBe(".");
      }
    });

    it("開幕時に P から全敵への射線が通らない（開幕即撃ち抜き防止）", () => {
      const stage = parseStage(mission.grid);
      const p = stage.playerSpawn;
      const enemies = [...stage.sentrySpawns, ...stage.roverSpawns];
      expect(enemies.length).toBeGreaterThan(0);
      for (const e of enemies) {
        expect(
          hasLineOfSight(stage, p.x, p.y, e.x, e.y),
          `P(${p.x},${p.y})→敵(${e.x},${e.y}) の射線`,
        ).toBe(false);
      }
    });
  });
}
