/**
 * 地雷のテスト — 設置上限・自動起爆・接近起爆・誘爆連鎖・爆風による破壊（戦車・弾・X壁）。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import {
  liveMineCount,
  type Mine,
  type MineTarget,
  tryPlaceMine,
  updateMines,
} from "../src/core/mine";
import { tileAt } from "../src/core/stage";
import { FLOOR_5X5, makeBullet, makeStage } from "./helpers";

/** テスト用の戦車（爆風・接近起爆の対象） */
function makeTank(x: number, y: number): MineTarget {
  return { x, y, radius: 14, alive: true };
}

describe("地雷（設置）", () => {
  it("同時2個まで設置でき、3個目は不発になる", () => {
    const mines: Mine[] = [];
    const owner = { x: 48, y: 48 };
    expect(tryPlaceMine(mines, owner)).not.toBeNull();
    expect(tryPlaceMine(mines, owner)).not.toBeNull();
    expect(tryPlaceMine(mines, owner)).toBeNull(); // 上限（GDD §4：同時2個）
    expect(mines).toHaveLength(2);
  });

  it("地雷が消滅すれば再設置できる", () => {
    const mines: Mine[] = [];
    const owner = { x: 48, y: 48 };
    tryPlaceMine(mines, owner);
    tryPlaceMine(mines, owner);
    mines[0]!.dead = true; // 1個目が爆発済み
    expect(liveMineCount(mines, owner)).toBe(1);
    expect(tryPlaceMine(mines, owner)).not.toBeNull();
  });

  it("設置位置は設置者の現在位置・信管は10秒", () => {
    const mines: Mine[] = [];
    const m = tryPlaceMine(mines, { x: 70, y: 90 })!;
    expect(m.x).toBe(70);
    expect(m.y).toBe(90);
    expect(m.fuse).toBe(BALANCE.MINE.FUSE_TIME);
  });
});

describe("地雷（起爆）", () => {
  const stage = () => makeStage(FLOOR_5X5);

  it("設置後10秒で自動起爆する", () => {
    const mines: Mine[] = [];
    tryPlaceMine(mines, { x: 48, y: 48 });
    let res = updateMines(mines, 5.0, [], [], stage());
    expect(res.explosions).toHaveLength(0); // まだ5秒
    res = updateMines(mines, 5.01, [], [], stage());
    expect(res.explosions).toHaveLength(1); // 10秒経過で起爆
    expect(res.explosions[0]).toEqual({ x: 48, y: 48 });
    expect(mines[0]!.dead).toBe(true);
  });

  it("敵対側の戦車が半径40px内に接近すると起爆し、爆風で撃破する（kind未指定は敵対扱い）", () => {
    const mines: Mine[] = [];
    tryPlaceMine(mines, { x: 48, y: 48 }); // 設置者は tanks に含めない（遠くにいる想定）
    const enemy = makeTank(120, 48); // 距離72：範囲外
    let res = updateMines(mines, 0.05, [enemy], [], stage());
    expect(res.explosions).toHaveLength(0);
    enemy.x = 80; // 距離32 < 40：接近
    res = updateMines(mines, 0.05, [enemy], [], stage());
    expect(res.explosions).toHaveLength(1);
    expect(enemy.alive).toBe(false); // 距離32 < 爆風48+車体14
  });

  it("設置者は一度トリガー半径の外へ出るまで接近起爆させない（出て戻ると起爆＝自爆あり）", () => {
    const mines: Mine[] = [];
    const owner = makeTank(48, 48);
    tryPlaceMine(mines, owner);
    // 設置直後：足元にいるが起爆しない
    let res = updateMines(mines, 0.05, [owner], [], stage());
    expect(res.explosions).toHaveLength(0);
    // 半径外（距離72）へ離脱
    owner.x = 120;
    res = updateMines(mines, 0.05, [owner], [], stage());
    expect(res.explosions).toHaveLength(0);
    expect(mines[0]!.ownerClear).toBe(true);
    // 戻ってきたら起爆し、自分も爆風で倒れる（自爆）
    owner.x = 60;
    res = updateMines(mines, 0.05, [owner], [], stage());
    expect(res.explosions).toHaveLength(1);
    expect(owner.alive).toBe(false);
  });

  it("敵の地雷は同陣営の敵では起爆せず、プレイヤーの接近で起爆する（v0.6.1）", () => {
    const mines: Mine[] = [];
    const layer = { ...makeTank(48, 48), kind: "minelayer" };
    tryPlaceMine(mines, layer); // 敵側の地雷
    // 同陣営の敵（ローバー）が踏んでも起爆しない
    const ally = { ...makeTank(60, 48), kind: "rover" }; // 距離12 < 40
    let res = updateMines(mines, 0.05, [ally], [], stage());
    expect(res.explosions).toHaveLength(0);
    expect(ally.alive).toBe(true);
    // プレイヤーが近づくと起爆する
    const player = { ...makeTank(76, 48), kind: "player" }; // 距離28 < 40
    res = updateMines(mines, 0.05, [ally, player], [], stage());
    expect(res.explosions).toHaveLength(1);
    // 爆風は敵味方の区別なく巻き込む（同陣営の敵も倒れる）
    expect(player.alive).toBe(false);
    expect(ally.alive).toBe(false);
  });

  it("プレイヤーの地雷は2P（同陣営）では起爆しない（v0.6.1）", () => {
    const mines: Mine[] = [];
    const p1 = { ...makeTank(48, 48), kind: "player" };
    tryPlaceMine(mines, p1);
    p1.x = 120; // 設置者は離脱
    const p2 = { ...makeTank(60, 48), kind: "player" }; // 相方が踏んでも起爆しない
    const res = updateMines(mines, 0.05, [p1, p2], [], stage());
    expect(res.explosions).toHaveLength(0);
  });

  it("弾が触れると誘爆し、その弾も爆風で消滅する", () => {
    const mines: Mine[] = [];
    tryPlaceMine(mines, { x: 48, y: 48 });
    const b = makeBullet({ x: 52, y: 48 }); // 距離4 < 地雷8+弾4
    const res = updateMines(mines, 0.05, [], [b], stage());
    expect(res.explosions).toHaveLength(1);
    expect(b.dead).toBe(true);
  });

  it("爆風は範囲内の弾を消滅させ、範囲外の弾は残す", () => {
    const mines: Mine[] = [];
    tryPlaceMine(mines, { x: 48, y: 48 });
    mines[0]!.fuse = 0.01; // すぐ自動起爆
    const near = makeBullet({ x: 88, y: 48 }); // 距離40 < 48+4
    const far = makeBullet({ x: 148, y: 48 }); // 距離100 > 48+4
    updateMines(mines, 0.05, [], [near, far], stage());
    expect(near.dead).toBe(true);
    expect(far.dead).toBe(false);
  });

  it("爆風が別の地雷に届くと同フレームで連鎖誘爆する", () => {
    const mines: Mine[] = [];
    tryPlaceMine(mines, { x: 48, y: 48 });
    tryPlaceMine(mines, { x: 88, y: 48 }); // 距離40 < 爆風48+地雷8
    mines[0]!.fuse = 0.01; // 1個目だけ時間切れ
    const res = updateMines(mines, 0.05, [], [], stage());
    expect(res.explosions).toHaveLength(2); // 連鎖して両方爆発
    expect(mines.every((m) => m.dead)).toBe(true);
  });

  it("爆風は破壊可能壁 X を床に変え、届かない X は残す", () => {
    const s = makeStage([
      "#####",
      "#PX.#", // X(2,1)：爆心 (48,48) から最近点 (64,48)＝距離16 < 48
      "#...#",
      "#..X#", // X(3,3)：最近点 (96,96)＝距離約68 > 48
      "#####",
    ]);
    const mines: Mine[] = [];
    tryPlaceMine(mines, { x: 48, y: 48 });
    mines[0]!.fuse = 0.01;
    const res = updateMines(mines, 0.05, [], [], s);
    expect(res.wallsDestroyed).toBe(1);
    expect(tileAt(s, 2, 1)).toBe("."); // 破壊されて床になった（GDD §7）
    expect(tileAt(s, 3, 3)).toBe("X"); // 爆風の届かない X は残る
  });

  it("爆風は範囲内の全戦車を巻き込む（敵味方の区別なし）", () => {
    const mines: Mine[] = [];
    tryPlaceMine(mines, { x: 80, y: 80 });
    mines[0]!.fuse = 0.01;
    const a = makeTank(48, 80); // 距離32 < 48+14
    const b = makeTank(80, 48); // 距離32 < 48+14
    const c = makeTank(80, 145); // 距離65 > 48+14
    updateMines(mines, 0.05, [a, b, c], [], stage());
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);
    expect(c.alive).toBe(true);
  });
});
