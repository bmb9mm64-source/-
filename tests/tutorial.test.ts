/**
 * チュートリアル T1〜T3 の機械的検証（GDD §8.8・§14 の E8）。
 *
 * 本編ミッションと同じ基準（正規サイズ・外周は全て恒久壁・湧き位置は床・開幕射線なし）に加え、
 * チュートリアル固有の約束を確かめる：
 *   ・3面とも一言（hint）を持つ（教える文が無ければチュートリアルとして成立しない）
 *   ・T2 は**直接射線が無く、外周壁1回反射なら届く**（＝跳弾を教える面として機能する）
 *   ・本編のミッションは hint を持たない（通常プレイの画面に余計なものを出さない）
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { allEnemySpawns } from "../src/core/enemyKinds";
import { hasLineOfSight } from "../src/core/los";
import { findOuterWallRicochet } from "../src/core/ricochetAim";
import { parseStage, tileAt } from "../src/core/stage";
import { ALL_MISSIONS } from "../src/stages/allMissions";
import { TUTORIAL_MISSIONS } from "../src/stages/tutorial";

describe("チュートリアルの盤面", () => {
  it("3面ある", () => {
    expect(TUTORIAL_MISSIONS).toHaveLength(3);
  });

  it.each(TUTORIAL_MISSIONS.map((m) => [m.name, m] as const))(
    "%s：正規サイズ（25×17）で外周は全て恒久壁",
    (_name, m) => {
      expect(m.grid).toHaveLength(BALANCE.ROWS);
      for (const row of m.grid) expect(row).toHaveLength(BALANCE.COLS);
      for (let c = 0; c < BALANCE.COLS; c++) {
        expect(m.grid[0]![c]).toBe("#");
        expect(m.grid[BALANCE.ROWS - 1]![c]).toBe("#");
      }
      for (let r = 0; r < BALANCE.ROWS; r++) {
        expect(m.grid[r]![0]).toBe("#");
        expect(m.grid[r]![BALANCE.COLS - 1]).toBe("#");
      }
    },
  );

  it.each(TUTORIAL_MISSIONS.map((m) => [m.name, m] as const))(
    "%s：自機と敵の湧き位置が床で、敵が1体以上いる",
    (_name, m) => {
      const stage = parseStage(m.grid);
      // 湧き位置はピクセル座標なのでタイル座標へ直してから盤面を引く
      const at = (v: { x: number; y: number }): string =>
        tileAt(stage, Math.floor(v.x / stage.tile), Math.floor(v.y / stage.tile));
      expect(at(stage.playerSpawn)).toBe(".");
      const enemies = allEnemySpawns(stage.spawns);
      expect(enemies.length).toBeGreaterThan(0);
      for (const e of enemies) expect(at(e)).toBe(".");
    },
  );

  it.each(TUTORIAL_MISSIONS.map((m) => [m.name, m] as const))(
    "%s：開幕時に自機から敵への直接射線が通らない（開幕即撃ち合いにしない）",
    (_name, m) => {
      const stage = parseStage(m.grid);
      const p = stage.playerSpawn;
      for (const e of allEnemySpawns(stage.spawns)) {
        expect(hasLineOfSight(stage, p.x, p.y, e.x, e.y)).toBe(false);
      }
    },
  );

  it.each(TUTORIAL_MISSIONS.map((m) => [m.name, m] as const))(
    "%s：教える文（hint）を持つ",
    (_name, m) => {
      expect(m.hint, "チュートリアルは必ず一言を出す").toBeTruthy();
    },
  );

  it("T2 は跳弾でしか届かない（直接射線なし・外周壁1回反射なら成立する）", () => {
    const t2 = TUTORIAL_MISSIONS[1]!;
    const stage = parseStage(t2.grid);
    const p = stage.playerSpawn;
    const enemy = allEnemySpawns(stage.spawns)[0]!;
    expect(hasLineOfSight(stage, p.x, p.y, enemy.x, enemy.y), "直接は通らない").toBe(false);
    expect(
      findOuterWallRicochet(stage, p.x, p.y, enemy.x, enemy.y),
      "初期位置から動かなくても跳弾なら届く＝跳弾を教える面として成立する",
    ).not.toBeNull();
  });

  it("T1 は少し動けば直接狙える（跳弾を知らなくてもクリアできる）", () => {
    const t1 = TUTORIAL_MISSIONS[0]!;
    const stage = parseStage(t1.grid);
    const enemy = allEnemySpawns(stage.spawns)[0]!;
    const t = BALANCE.TILE;
    // 盤面内の床タイルのうち、敵への直接射線が通る場所が存在するか
    let reachable = false;
    for (let r = 1; r < BALANCE.ROWS - 1 && !reachable; r++) {
      for (let c = 1; c < BALANCE.COLS - 1; c++) {
        const x = c * t + t / 2;
        const y = r * t + t / 2;
        if (tileAt(stage, c, r) !== ".") continue;
        if (hasLineOfSight(stage, x, y, enemy.x, enemy.y)) {
          reachable = true;
          break;
        }
      }
    }
    expect(reachable).toBe(true);
  });

  it("本編のミッションは hint を持たない（通常プレイの画面を変えない）", () => {
    for (const m of ALL_MISSIONS) expect(m.hint, m.name).toBeUndefined();
  });
});
