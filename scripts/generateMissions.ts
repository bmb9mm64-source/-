/**
 * 拡張ミッション M17〜M50 の生成ツール（開発時のみ実行。ゲーム本体からは import しない）。
 *
 * 手作業では担保しきれない量のステージを、**全条件を機械検証したうえで**生成する。
 * 出力先は src/stages/missionsGen.ts（静的データとしてコミットし、実行時に生成はしない）。
 *
 * 生成物が満たす条件（すべて自動検証。1つでも欠ければ作り直す）：
 *   1. 25×17・外周は全て `#`
 *   2. `P` がちょうど1つ／`P` の隣に床がある（2P の出現位置）
 *   3. 開幕時、P と 2P の位置から全敵への**直接射線が通らない**（開幕即死の防止）
 *   4. 敵E・敵G（跳弾狙撃を常時使用）は、開幕時に P・2P への**外周壁1回反射の射線も持たない**
 *   5. プレイヤーが到達できる全マスから見て、**各敵に攻撃手段がある**（直射または跳弾）
 *   6. 敵E・敵G に対して**安全に立てるマスが1割以上**残っている（逃げ場の確保）
 *   7. プレイヤーの到達範囲が十分広い（閉じ込め防止）
 *   8. 移動する敵（B・D・F）の周囲に動ける床がある（袋小路の禁止）
 *
 * 実行方法： npx vitest run scripts/generateMissions.ts
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { allEnemySpawns } from "../src/core/enemyKinds";
import { hasLineOfSight } from "../src/core/los";
import { findOuterWallRicochet } from "../src/core/ricochetAim";
import { findNearbyFloor, parseStage, solidForTank } from "../src/core/stage";

const COLS = BALANCE.COLS;
const ROWS = BALANCE.ROWS;
const T = BALANCE.TILE;

/** 決定的な擬似乱数（同じ種なら常に同じステージが出る） */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Grid = string[][];

/** 内側が床・外周が壁の空盤面 */
function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) =>
      r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1 ? "#" : ".",
    ),
  );
}

const gridToLines = (g: Grid): string[] => g.map((row) => row.join(""));
const randInt = (rand: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rand() * (hi - lo + 1));

/** 矩形ブロックを置く（内側1マスの余白は残す） */
function placeBlock(g: Grid, rand: () => number, ch: string): void {
  const w = randInt(rand, 1, 5);
  const h = randInt(rand, 1, 4);
  const c0 = randInt(rand, 2, COLS - 2 - w);
  const r0 = randInt(rand, 2, ROWS - 2 - h);
  for (let r = r0; r < r0 + h; r++) {
    for (let c = c0; c < c0 + w; c++) g[r]![c] = ch;
  }
}

/** 盤面の地形を作る（左右対称にすると「設計された」印象になりやすい） */
function buildTerrain(rand: () => number, blocks: number, symmetric: boolean): Grid {
  const g = emptyGrid();
  for (let i = 0; i < blocks; i++) placeBlock(g, rand, "#");
  if (rand() < 0.5) placeBlock(g, rand, "X"); // 破壊可能壁
  if (rand() < 0.4) {
    // 弾だけが通る堀（H）を1本
    const r = randInt(rand, 3, ROWS - 4);
    const c0 = randInt(rand, 3, COLS - 8);
    const len = randInt(rand, 3, 6);
    for (let c = c0; c < c0 + len; c++) if (g[r]![c] === ".") g[r]![c] = "H";
  }
  if (symmetric) {
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < Math.floor(COLS / 2); c++) g[r]![COLS - 1 - c] = g[r]![c]!;
    }
  }
  return g;
}

/** 床タイルの一覧 */
function floorTiles(g: Grid): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) if (g[r]![c] === ".") out.push([c, r]);
  }
  return out;
}

/** 戦車が到達できるタイル（塗りつぶし探索） */
function reachable(g: Grid, c0: number, r0: number): Set<string> {
  const seen = new Set<string>([`${c0},${r0}`]);
  const queue: [number, number][] = [[c0, r0]];
  while (queue.length) {
    const [c, r] = queue.shift()!;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc;
      const nr = r + dr;
      const key = `${nc},${nr}`;
      if (seen.has(key) || nr < 1 || nr >= ROWS - 1 || nc < 1 || nc >= COLS - 1) continue;
      if (solidForTank(g[nr]![nc]!)) continue;
      seen.add(key);
      queue.push([nc, nr]);
    }
  }
  return seen;
}

const center = (c: number, r: number) => ({ x: c * T + T / 2, y: r * T + T / 2 });

/** 生成した盤面が全条件を満たすか検証する */
function validate(g: Grid, kinds: string[]): boolean {
  const lines = gridToLines(g);
  let stage: ReturnType<typeof parseStage>;
  try {
    stage = parseStage(lines);
  } catch {
    return false;
  }
  const p1 = stage.playerSpawn;
  const p2 = findNearbyFloor(stage, p1);
  if (p2.x === p1.x && p2.y === p1.y) return false; // 2P の出現位置がない

  const enemies = allEnemySpawns(stage.spawns);
  if (enemies.length !== kinds.length) return false;

  // 開幕：全敵への直接射線が通らない
  for (const e of enemies) {
    for (const p of [p1, p2]) if (hasLineOfSight(stage, p.x, p.y, e.x, e.y)) return false;
  }
  // 開幕：E・G は反射射線も持たない
  const alwaysRicochet = [...stage.spawns.reflector, ...stage.spawns.prism];
  for (const e of alwaysRicochet) {
    for (const p of [p1, p2]) if (findOuterWallRicochet(stage, e.x, e.y, p.x, p.y)) return false;
  }

  // プレイヤーの到達範囲
  const reach = reachable(g, Math.floor(p1.x / T), Math.floor(p1.y / T));
  if (reach.size < 110) return false; // 閉じ込め防止
  const reachPts = [...reach].map((k) => {
    const [c, r] = k.split(",").map(Number);
    return center(c!, r!);
  });

  // 各敵に攻撃手段があるか／E・G には逃げ場が残っているか
  for (const e of enemies) {
    const canHit = reachPts.some(
      (p) => hasLineOfSight(stage, p.x, p.y, e.x, e.y) || findOuterWallRicochet(stage, p.x, p.y, e.x, e.y),
    );
    if (!canHit) return false;
  }
  for (const e of alwaysRicochet) {
    const safe = reachPts.filter(
      (p) => !hasLineOfSight(stage, e.x, e.y, p.x, p.y) && !findOuterWallRicochet(stage, e.x, e.y, p.x, p.y),
    ).length;
    if (safe < reachPts.length * 0.1) return false; // 逃げ場が1割未満なら没
  }

  // 敵S「シールダー」は正面からの直射では絶対に倒せないため、
  // **跳弾で当てられる位置が必ず存在すること**を必須条件にする（GDD §6 v0.14）
  for (const e of stage.spawns.shielder) {
    const canRicochet = reachPts.some((p) => findOuterWallRicochet(stage, p.x, p.y, e.x, e.y));
    if (!canRicochet) return false;
  }

  // 移動する敵（B・D・F・S）は動ける床の広がりが必要
  const movers = [
    ...stage.spawns.rover,
    ...stage.spawns.minelayer,
    ...stage.spawns.chaser,
    ...stage.spawns.shielder,
  ];
  for (const m of movers) {
    const area = reachable(g, Math.floor(m.x / T), Math.floor(m.y / T));
    if (area.size < 30) return false;
  }
  return true;
}

/** ミッション番号に応じた敵構成（難易度曲線） */
function compositionFor(n: number): string[] {
  const pools: [number, string[]][] = [
    [22, ["A", "B", "C", "D"]], // M17-22：既知の4種で3体
    [30, ["A", "B", "C", "D", "E", "F", "V", "M"]], // M23-30：E/F と新種 V/M が混ざる4体
    [40, ["A", "B", "C", "D", "E", "F", "G", "S", "V", "M"]], // M31-40：全10種から5体
    [49, ["A", "B", "C", "D", "E", "F", "G", "S", "V", "M"]], // M41-49：6体
  ];
  const count = n <= 22 ? 3 : n <= 30 ? 4 : n <= 40 ? 5 : 6;
  if (n === 50) return ["A", "B", "C", "D", "E", "F", "G", "S", "V", "M"]; // 最終面は全10種
  const pool = pools.find(([hi]) => n <= hi)![1];
  const rand = rng(n * 7919);
  const out: string[] = [];
  // 種類が偏らないよう、プールを一巡させてから残りを埋める
  const shuffled = [...pool].sort(() => rand() - 0.5);
  for (let i = 0; i < count; i++) out.push(shuffled[i % shuffled.length]!);
  return out;
}

/** 1ミッションを生成する（条件を満たすまで種を変えて試行） */
function generateMission(n: number): { name: string; grid: string[] } | null {
  const kinds = compositionFor(n);
  for (let attempt = 0; attempt < 4000; attempt++) {
    const rand = rng(n * 100003 + attempt);
    const g = buildTerrain(rand, randInt(rand, 4, 8), rand() < 0.35);
    const spots = floorTiles(g);
    if (spots.length < 140) continue;

    // プレイヤーは盤面の端寄り、敵は離れた位置に置く
    const pIdx = randInt(rand, 0, spots.length - 1);
    const [pc, pr] = spots[pIdx]!;
    g[pr]![pc] = "P";
    const placed: [number, number][] = [[pc, pr]];
    let ok = true;
    for (const kind of kinds) {
      const candidates = spots.filter(([c, r]) => {
        if (g[r]![c] !== ".") return false;
        const far = Math.hypot(c - pc, r - pr) >= 7; // 自機から十分離す
        const spaced = placed.every(([oc, or]) => Math.hypot(c - oc, r - or) >= 3);
        return far && spaced;
      });
      if (candidates.length === 0) {
        ok = false;
        break;
      }
      const [c, r] = candidates[randInt(rand, 0, candidates.length - 1)]!;
      g[r]![c] = kind;
      placed.push([c, r]);
    }
    if (!ok) continue;
    if (!validate(g, kinds)) continue;
    return { name: `M${n}: 第${n}層`, grid: gridToLines(g) };
  }
  return null;
}

describe("拡張ミッションの生成", () => {
  it("M17〜M50 を生成して src/stages/missionsGen.ts に書き出す", () => {
    const missions: { name: string; grid: string[] }[] = [];
    const failed: number[] = [];
    for (let n = 17; n <= 50; n++) {
      const m = generateMission(n);
      if (m) missions.push(m);
      else failed.push(n);
    }
    console.log(`生成成功 ${missions.length}/34　失敗: ${failed.join(",") || "なし"}`);
    expect(failed).toEqual([]);

    const body = missions
      .map(
        (m) =>
          `  {\n    name: ${JSON.stringify(m.name)},\n    grid: [\n${m.grid
            .map((row) => `      ${JSON.stringify(row)},`)
            .join("\n")}\n    ],\n  },`,
      )
      .join("\n");
    const out = `/**
 * 拡張ミッション M17〜M50（GDD §7 v0.13）。
 *
 * **このファイルは scripts/generateMissions.ts が生成した静的データです。手で編集しないでください。**
 * 生成時に以下をすべて機械検証済み：25×17・外周壁／P と 2P 出現位置／開幕の直接射線が全敵に対し
 * 遮蔽されていること／敵E・G は開幕の外周1回反射の射線も持たないこと／全敵に攻撃手段があること／
 * 敵E・G に対する安全地帯が到達範囲の1割以上あること／移動する敵の可動域があること。
 */
export const MISSIONS_GEN: { name: string; grid: string[] }[] = [
${body}
];
`;
    writeFileSync(new URL("../src/stages/missionsGen.ts", import.meta.url), out);
  }, 600000);
});
