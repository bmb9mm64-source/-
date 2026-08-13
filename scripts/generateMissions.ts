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

/** 指定の矩形を塗る（盤面の内側にはみ出さないようクリップする） */
function fillRect(g: Grid, c0: number, r0: number, w: number, h: number, ch: string): void {
  for (let r = Math.max(1, r0); r < Math.min(ROWS - 1, r0 + h); r++) {
    for (let c = Math.max(1, c0); c < Math.min(COLS - 1, c0 + w); c++) g[r]![c] = ch;
  }
}

/**
 * 地形の型（GDD §7 v0.24）。
 *
 * v0.23 までは「ランダムな矩形ブロックを4〜8個置く」だけだったため、
 * 34面が全部同じ顔になっていた（オーナー指摘「ステージが単調」）。
 * 面ごとに型を選び、その型に沿って地形を組み立てる。
 *
 * どの型も**通路の幅を1タイル以上**確保する。生成後の検証（到達範囲・攻撃手段・
 * 安全地帯・移動域）は型によらず全て通すので、型が増えても保証は変わらない。
 */
export type TerrainKind =
  | "open"
  | "corridor"
  | "rooms"
  | "pillars"
  | "fortress"
  | "serpentine"
  | "moat"
  | "cages";

/** 型の巡回順（隣り合う面が同じ型にならないよう、この順で回す） */
export const TERRAIN_CYCLE: readonly TerrainKind[] = [
  "corridor",
  "pillars",
  "rooms",
  "open",
  "fortress",
  "moat",
  "serpentine",
  "cages",
];

/** ミッション番号から地形の型を決める（M50 は総仕上げの要塞で固定） */
export function terrainFor(n: number): TerrainKind {
  if (n === 50) return "fortress";
  return TERRAIN_CYCLE[(n - 17) % TERRAIN_CYCLE.length]!;
}

/** 型ごとの地形を組み立てる */
function buildTerrainOf(kind: TerrainKind, rand: () => number): Grid {
  const g = emptyGrid();
  switch (kind) {
    case "open": {
      // 従来の形。まばらな島を置くだけ
      for (let i = 0; i < randInt(rand, 4, 7); i++) placeBlock(g, rand, "#");
      break;
    }
    case "corridor": {
      // 縦横の隔壁を等間隔に並べ、1マスずつ開けて格子状の通路にする。
      // 曲がり角が多く、**幅1の通路＝地雷が効く**
      const stepC = randInt(rand, 4, 6);
      const stepR = randInt(rand, 4, 5);
      for (let c = 2 + randInt(rand, 0, 1); c < COLS - 2; c += stepC) {
        fillRect(g, c, 1, 1, ROWS - 2, "#");
        const gap = randInt(rand, 1, ROWS - 3); // 通り抜けの穴を2つ開ける
        const gap2 = randInt(rand, 1, ROWS - 3);
        g[gap]![c] = ".";
        g[gap2]![c] = ".";
      }
      for (let r = 2 + randInt(rand, 0, 1); r < ROWS - 2; r += stepR) {
        fillRect(g, 1, r, COLS - 2, 1, "#");
        g[r]![randInt(rand, 1, COLS - 2)] = ".";
        g[r]![randInt(rand, 1, COLS - 2)] = ".";
      }
      break;
    }
    case "rooms": {
      // 十字の隔壁で4部屋に分け、各壁に1つずつ出入口を開ける。
      // **出入口が必ず幅1の隘路になる＝地雷が最も効く型**
      const midC = Math.floor(COLS / 2) + randInt(rand, -2, 2);
      const midR = Math.floor(ROWS / 2) + randInt(rand, -1, 1);
      fillRect(g, midC, 1, 1, ROWS - 2, "#");
      fillRect(g, 1, midR, COLS - 2, 1, "#");
      g[randInt(rand, 1, midR - 1)]![midC] = "."; // 上半分の出入口
      g[randInt(rand, midR + 1, ROWS - 2)]![midC] = "."; // 下半分の出入口
      g[midR]![randInt(rand, 1, midC - 1)] = "."; // 左半分の出入口
      g[midR]![randInt(rand, midC + 1, COLS - 2)] = "."; // 右半分の出入口
      // 各部屋の中にも遮蔽物を置く。何も無いと部屋がただの広場になり、
      // 隘路が出入口の4マスしか無くなって「地雷が活きる」条件を満たせない
      for (let i = 0; i < randInt(rand, 3, 5); i++) placeBlock(g, rand, "#");
      break;
    }
    case "pillars": {
      // 1×1 の柱を散らす。直射がほとんど通らず**跳弾の宝庫**になる
      const stepC = randInt(rand, 3, 4);
      const stepR = randInt(rand, 3, 4);
      for (let r = 2; r < ROWS - 2; r += stepR) {
        for (let c = 2; c < COLS - 2; c += stepC) {
          if (rand() < 0.8) g[r]![c] = "#";
        }
      }
      break;
    }
    case "fortress": {
      // 中央に壁で囲った小部屋。四方に1マスずつ入口を開ける。
      // 中に置かれた敵は跳弾でしか狙えない
      const w = randInt(rand, 6, 9);
      const h = randInt(rand, 4, 5);
      const c0 = Math.floor((COLS - w) / 2);
      const r0 = Math.floor((ROWS - h) / 2);
      fillRect(g, c0, r0, w, 1, "#");
      fillRect(g, c0, r0 + h - 1, w, 1, "#");
      fillRect(g, c0, r0, 1, h, "#");
      fillRect(g, c0 + w - 1, r0, 1, h, "#");
      g[r0]![c0 + randInt(rand, 1, w - 2)] = ".";
      g[r0 + h - 1]![c0 + randInt(rand, 1, w - 2)] = ".";
      g[r0 + randInt(rand, 1, h - 2)]![c0] = ".";
      g[r0 + randInt(rand, 1, h - 2)]![c0 + w - 1] = ".";
      for (let i = 0; i < randInt(rand, 2, 3); i++) placeBlock(g, rand, "#");
      break;
    }
    case "serpentine": {
      // 左右交互に伸びる長い隔壁。一本道を押し上げていく形になる
      const stepR = randInt(rand, 3, 4);
      let fromLeft = rand() < 0.5;
      for (let r = 2 + randInt(rand, 0, 1); r < ROWS - 2; r += stepR) {
        const len = randInt(rand, COLS - 8, COLS - 5);
        if (fromLeft) fillRect(g, 1, r, len, 1, "#");
        else fillRect(g, COLS - 1 - len, r, len, 1, "#");
        fromLeft = !fromLeft;
      }
      break;
    }
    case "moat": {
      // 穴 H の帯で盤面を分断する（戦車は渡れず弾だけが通る）。撃ち合い専用の間合い
      const vertical = rand() < 0.5;
      if (vertical) {
        const c = Math.floor(COLS / 2) + randInt(rand, -3, 3);
        fillRect(g, c, 1, 1, ROWS - 2, "H");
        fillRect(g, c, randInt(rand, 1, ROWS - 4), 1, 2, "."); // 1箇所だけ渡れる
      } else {
        const r = Math.floor(ROWS / 2) + randInt(rand, -2, 2);
        fillRect(g, 1, r, COLS - 2, 1, "H");
        fillRect(g, randInt(rand, 1, COLS - 4), r, 2, 1, ".");
      }
      for (let i = 0; i < randInt(rand, 3, 5); i++) placeBlock(g, rand, "#");
      break;
    }
    case "cages": {
      // 敵を囲う小さな檻をいくつか置く（1辺に隙間を作らないので跳弾必須の的になる）
      for (let i = 0; i < randInt(rand, 2, 3); i++) {
        const w = 3;
        const h = 3;
        const c0 = randInt(rand, 2, COLS - 2 - w);
        const r0 = randInt(rand, 2, ROWS - 2 - h);
        fillRect(g, c0, r0, w, 1, "#");
        fillRect(g, c0, r0 + h - 1, w, 1, "#");
        fillRect(g, c0, r0, 1, h, "#");
        fillRect(g, c0 + w - 1, r0, 1, h, "#");
        g[r0 + 1]![c0 + 1] = "."; // 中は床（ここに敵が入ると跳弾でしか狙えない）
      }
      for (let i = 0; i < randInt(rand, 2, 4); i++) placeBlock(g, rand, "#");
      break;
    }
  }

  // --- 地雷が活きる条件（GDD §7 v0.24）：破壊可能壁 X を必ず2箇所以上置く ---
  // 従来は「50%の確率で1つ」だったので、ほとんどの面で地雷を使う理由がなかった。
  // 壁の一部を X に差し替える形にすると、爆破でルートが短縮できる位置に自然に入る。
  const wallCells: [number, number][] = [];
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) if (g[r]![c] === "#") wallCells.push([c, r]);
  }
  const xCount = Math.min(wallCells.length, randInt(rand, 2, 4));
  for (let i = 0; i < xCount; i++) {
    const [c, r] = wallCells[randInt(rand, 0, wallCells.length - 1)]!;
    g[r]![c] = "X";
  }
  return g;
}

/**
 * 左右対称にしてよい型（GDD §7 v0.24）。
 *
 * 回廊・四部屋・要塞・堀は「隔壁に開けた1マスの出入口」で通行を成立させているので、
 * 左半分を右へ写すと**右側の出入口が塞がってしまう**（実際に、生成した回廊の1行が
 * 丸ごと壁になって上部が孤立した）。出入口に依存しない型だけ対称化する。
 */
const SYMMETRIC_OK: readonly TerrainKind[] = ["open", "pillars", "cages"];

/** 盤面の地形を作る（型に沿って組み立て、許される型だけ左右対称にする） */
function buildTerrain(kind: TerrainKind, rand: () => number, symmetric: boolean): Grid {
  const g = buildTerrainOf(kind, rand);
  if (symmetric && SYMMETRIC_OK.includes(kind)) {
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

  // 敵Y「ミラー」は正面からの直射が返ってくるため、**側面・背面から当てられる位置**が要る。
  // 装甲は常にプレイヤーの方を向くので、「装甲の正面 ±ARMOR_ARC の外から届く射線」を探す。
  for (const e of stage.spawns.mirror) {
    const canFlank = reachPts.some((p) => {
      if (!hasLineOfSight(stage, p.x, p.y, e.x, e.y)) return false;
      // その位置から撃つと装甲は自分の方を向くので必ず正面になる＝跳弾でしか抜けない。
      // よって「跳弾で届くか」を側面攻撃の成立条件とする
      return findOuterWallRicochet(stage, p.x, p.y, e.x, e.y) !== null;
    });
    const canRicochet = reachPts.some((p) => findOuterWallRicochet(stage, p.x, p.y, e.x, e.y));
    if (!canFlank && !canRicochet) return false;
  }

  // 移動する敵（B・D・F・S・L）は動ける床の広がりが必要
  const movers = [
    ...stage.spawns.rover,
    ...stage.spawns.minelayer,
    ...stage.spawns.chaser,
    ...stage.spawns.shielder,
    ...stage.spawns.lancer,
  ];
  for (const m of movers) {
    const area = reachable(g, Math.floor(m.x / T), Math.floor(m.y / T));
    if (area.size < 30) return false;
  }

  // --- 地雷が活きる条件（GDD §7 v0.24） ---
  // 1. 移動する敵が1体以上（置いた地雷を踏む相手がいなければ接近起爆は死に機能）
  if (movers.length === 0) return false;
  // 2. 破壊可能壁 X が2箇所以上（爆風で開通させる価値をつくる）
  if (countTiles(g, "X") < 2) return false;
  // 3. 幅1の隘路が一定数ある（敵が必ず通る場所＝地雷を置く価値のある地形）
  if (countNarrowCells(g, reach) < MIN_NARROW_CELLS) return false;
  return true;
}

/** 盤面に含まれる指定タイルの数 */
function countTiles(g: Grid, ch: string): number {
  let n = 0;
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) if (g[r]![c] === ch) n++;
  }
  return n;
}

/**
 * 「幅1の隘路」の数（GDD §7 v0.24）。
 * 左右が塞がっている（縦の通路）か、上下が塞がっている（横の通路）床タイルを数える。
 * ここが多いほど敵の通り道が絞られ、地雷を置く価値が出る。
 * プレイヤーが到達できる範囲だけを数える（届かない場所の隘路は意味がない）。
 */
function countNarrowCells(g: Grid, reach: Set<string>): number {
  let n = 0;
  for (const key of reach) {
    const [c, r] = key.split(",").map(Number) as [number, number];
    if (g[r]![c] !== ".") continue;
    const blocked = (cc: number, rr: number): boolean => solidForTank(g[rr]?.[cc] ?? "#");
    const vertical = blocked(c - 1, r) && blocked(c + 1, r);
    const horizontal = blocked(c, r - 1) && blocked(c, r + 1);
    if (vertical || horizontal) n++;
  }
  return n;
}

/** 到達範囲に必要な隘路の数（GDD §7 v0.24。少なすぎると地雷を置く場所が無い） */
const MIN_NARROW_CELLS = 6;

/** 移動する敵（地雷の接近起爆を成立させるために必ず1体入れる。GDD §7 v0.24） */
const MOVERS = ["B", "D", "F", "S", "L"];

/** ミッション番号に応じた敵構成（難易度曲線） */
function compositionFor(n: number): string[] {
  const ALL = ["A", "B", "C", "D", "E", "F", "G", "S", "V", "M", "T", "L", "Y"];
  const pools: [number, string[]][] = [
    [22, ["A", "B", "C", "D"]], // M17-22：既知の4種で3体
    [26, ["A", "B", "C", "D", "E", "F", "V", "M"]], // M23-26：E/F・V/M が混ざる4体
    [30, ["A", "B", "C", "D", "E", "F", "V", "M", "T", "L"]], // M27-30：新種 T/L のお披露目
    [40, ALL], // M31-40：全13種から5体
    [49, ALL], // M41-49：6体
  ];
  const count = n <= 22 ? 3 : n <= 30 ? 4 : n <= 40 ? 5 : 6;
  if (n === 50) return ALL; // 最終面は全13種が1体ずつ
  const pool = pools.find(([hi]) => n <= hi)![1];
  const rand = rng(n * 7919);
  // 種類が偏らないよう、プールを一巡させてから残りを埋める
  const shuffled = [...pool].sort(() => rand() - 0.5);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(shuffled[i % shuffled.length]!);
  // 移動する敵が1体も入らなかったら1枠を差し替える（地雷が死に機能にならないように）
  if (!out.some((k) => MOVERS.includes(k))) {
    const candidates = pool.filter((k) => MOVERS.includes(k));
    if (candidates.length > 0) out[out.length - 1] = candidates[randInt(rand, 0, candidates.length - 1)]!;
  }
  return out;
}

/** 1ミッションを生成する（地形の型は番号で決まる。条件を満たすまで種を変えて試行） */
function generateMission(n: number): { name: string; grid: string[] } | null {
  const kinds = compositionFor(n);
  for (let attempt = 0; attempt < 4000; attempt++) {
    const rand = rng(n * 100003 + attempt);
    const g = buildTerrain(terrainFor(n), rand, rand() < 0.3);
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
