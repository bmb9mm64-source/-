/**
 * 2P の湧き位置（GDD §12.5・v0.17 修正）の回帰テスト。
 * パース時に敵の記号は '.' に置き換わるため、床かどうかだけを見て隣接タイルを選ぶと
 * 敵の初期位置に 2P が重なって湧く（戦車同士は通り抜け不可なので身動きが取れなくなる）。
 */
import { describe, expect, it } from "vitest";
import { allEnemySpawns } from "../src/core/enemyKinds";
import { findNearbyFloor, parseStage } from "../src/core/stage";
import { GameWorld } from "../src/core/world";
import { ALL_MISSIONS } from "../src/stages/allMissions";

/** 25×17 の盤面を組む（P の右隣に敵、その次の候補は床） */
function gridWith(row3: string): { name: string; grid: string[] } {
  const rows: string[] = ["#########################"];
  for (let r = 1; r <= 15; r++) {
    rows.push(r === 3 ? row3 : "#.......................#");
  }
  rows.push("#########################");
  return { name: "test", grid: rows };
}

describe("2P の湧き位置は敵と重ならない", () => {
  it("P の右隣が敵なら、その次の候補（敵のいない床）を選ぶ", () => {
    const def = gridWith("#.PA....................#");
    const stage = parseStage(def.grid);
    const p2 = findNearbyFloor(stage, stage.playerSpawn);
    const enemyTiles = allEnemySpawns(stage.spawns).map((e) => `${e.x},${e.y}`);
    expect(enemyTiles).not.toContain(`${p2.x},${p2.y}`);
    expect(`${p2.x},${p2.y}`).not.toBe(`${stage.playerSpawn.x},${stage.playerSpawn.y}`);
  });

  it("世界レベル：2人プレイで 2P が敵と同じ座標に生成されない（全50ミッション）", () => {
    for (const mission of ALL_MISSIONS) {
      const world = new GameWorld([mission], Math.random, 2);
      const p2 = world.players[1]!;
      for (const e of world.enemies) {
        expect(
          p2.x === e.x && p2.y === e.y,
          `${mission.name} で 2P が ${e.kind} と重なっている`,
        ).toBe(false);
      }
      // 1P とも重ならない
      expect(p2.x === world.player.x && p2.y === world.player.y).toBe(false);
    }
  });
});
