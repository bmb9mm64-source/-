/**
 * 本編ミッション M1〜M10 の機械的検証（level-designer からの申し送り）。
 * 各ミッションについて：
 *   1. グリッドが正規サイズ（25×17）で外周が全て恒久壁 # であること
 *   2. P・全敵の初期位置が床であること（パース成功＝スポーンタイルが '.' になる）
 *   3. 開幕時に P から全敵への射線（hasLineOfSight）が通らないこと（開幕即撃ち抜き防止）
 * 加えて GDD §7 の敵構成（MVP表＋拡張 M6〜M10 表）を確認する。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { hasLineOfSight } from "../src/core/los";
import { findOuterWallRicochet } from "../src/core/ricochetAim";
import { findNearbyFloor, parseStage, tileAt } from "../src/core/stage";
import { ALL_MISSIONS } from "../src/stages/allMissions";

describe("本編ミッション構成", () => {
  it("ミッションは16面ある（MVP 5面＋第2弾 5面＋Phase 5 5面＋M16）", () => {
    expect(ALL_MISSIONS).toHaveLength(16);
  });

  it("敵構成が GDD §7 の表と一致する", () => {
    const expected: {
      sentries: number;
      rovers: number;
      snipers: number;
      minelayers: number;
      reflectors: number;
      chasers: number;
      prisms?: number;
    }[] = [
      { sentries: 1, rovers: 0, snipers: 0, minelayers: 0, reflectors: 0, chasers: 0 }, // M1
      { sentries: 2, rovers: 0, snipers: 0, minelayers: 0, reflectors: 0, chasers: 0 }, // M2
      { sentries: 0, rovers: 1, snipers: 0, minelayers: 0, reflectors: 0, chasers: 0 }, // M3
      { sentries: 1, rovers: 1, snipers: 0, minelayers: 0, reflectors: 0, chasers: 0 }, // M4
      { sentries: 2, rovers: 2, snipers: 0, minelayers: 0, reflectors: 0, chasers: 0 }, // M5
      { sentries: 1, rovers: 0, snipers: 1, minelayers: 0, reflectors: 0, chasers: 0 }, // M6
      { sentries: 0, rovers: 1, snipers: 0, minelayers: 1, reflectors: 0, chasers: 0 }, // M7
      { sentries: 0, rovers: 2, snipers: 1, minelayers: 0, reflectors: 0, chasers: 0 }, // M8
      { sentries: 2, rovers: 1, snipers: 0, minelayers: 1, reflectors: 0, chasers: 0 }, // M9
      { sentries: 0, rovers: 2, snipers: 2, minelayers: 1, reflectors: 0, chasers: 0 }, // M10
      { sentries: 1, rovers: 0, snipers: 0, minelayers: 0, reflectors: 1, chasers: 0 }, // M11
      { sentries: 0, rovers: 1, snipers: 0, minelayers: 0, reflectors: 0, chasers: 1 }, // M12
      { sentries: 0, rovers: 1, snipers: 1, minelayers: 0, reflectors: 1, chasers: 0 }, // M13
      { sentries: 2, rovers: 0, snipers: 0, minelayers: 1, reflectors: 0, chasers: 1 }, // M14
      { sentries: 0, rovers: 1, snipers: 1, minelayers: 1, reflectors: 1, chasers: 1 }, // M15
      { sentries: 1, rovers: 1, snipers: 0, minelayers: 0, reflectors: 0, chasers: 0, prisms: 1 }, // M16
    ];
    ALL_MISSIONS.forEach((m, i) => {
      const stage = parseStage(m.grid);
      expect(stage.sentrySpawns, `${m.name} のセントリー数`).toHaveLength(expected[i]!.sentries);
      expect(stage.roverSpawns, `${m.name} のローバー数`).toHaveLength(expected[i]!.rovers);
      expect(stage.sniperSpawns, `${m.name} のスナイパー数`).toHaveLength(expected[i]!.snipers);
      expect(stage.minelayerSpawns, `${m.name} のマインレイヤー数`).toHaveLength(
        expected[i]!.minelayers,
      );
      expect(stage.reflectorSpawns, `${m.name} のリフレクター数`).toHaveLength(
        expected[i]!.reflectors,
      );
      expect(stage.chaserSpawns, `${m.name} のチェイサー数`).toHaveLength(expected[i]!.chasers);
      expect(stage.prismSpawns, `${m.name} のプリズム数`).toHaveLength(expected[i]!.prisms ?? 0);
    });
  });

  it("E・G（常時跳弾狙撃の砲台）は開幕時、P と 2P 位置への外周壁1回反射の射線も持たない（GDD §7 v0.9/v0.10）", () => {
    // E/G は跳弾狙撃を常時100%使うため、開幕グレース明けの即狙撃を防ぐ設計基準
    for (const m of ALL_MISSIONS) {
      const stage = parseStage(m.grid);
      const p1 = stage.playerSpawn;
      const p2 = findNearbyFloor(stage, p1);
      for (const e of [...stage.reflectorSpawns, ...stage.prismSpawns]) {
        for (const p of [p1, p2]) {
          expect(
            findOuterWallRicochet(stage, e.x, e.y, p.x, p.y),
            `${m.name}: E/G(${e.x},${e.y})→(${p.x},${p.y}) の反射射線`,
          ).toBeNull();
        }
      }
    }
  });
});

for (const mission of ALL_MISSIONS) {
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
      const spawns = [
        stage.playerSpawn,
        ...stage.sentrySpawns,
        ...stage.roverSpawns,
        ...stage.sniperSpawns,
        ...stage.minelayerSpawns,
        ...stage.reflectorSpawns,
        ...stage.chaserSpawns,
      ];
      for (const sp of spawns) {
        const col = Math.floor(sp.x / stage.tile);
        const row = Math.floor(sp.y / stage.tile);
        expect(tileAt(stage, col, row), `(${col},${row})`).toBe(".");
      }
    });

    it("開幕時に P から全敵への射線が通らない（開幕即撃ち抜き防止）", () => {
      const stage = parseStage(mission.grid);
      const p = stage.playerSpawn;
      const enemies = [
        ...stage.sentrySpawns,
        ...stage.roverSpawns,
        ...stage.sniperSpawns,
        ...stage.minelayerSpawns,
        ...stage.reflectorSpawns,
        ...stage.chaserSpawns,
      ];
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
