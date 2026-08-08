/**
 * 弾（ミサイル）の見た目の形状計算（GDD §5「弾の見た目」v0.16。Phaser 非依存の純粋 TS）。
 *
 * **見た目だけの計算で、当たり判定には一切関与しない**（判定は bullet.ts の
 * 「中心 (x,y)・半径 radius の円」のまま）。それでも core に置いてテスト可能にしているのは、
 * 「弾頭の先端が当たり判定の円の縁に一致し、前方へはみ出さない」という約束を
 * 機械的に検証したいから（はみ出すと「当たったように見えるのに当たらない」が起きる）。
 *
 * 座標系：ローカル座標では +X が進行方向。呼び出し側が弾の位置へ平行移動し、
 * 進行方向（atan2(vy, vx)）へ回転させて描く。
 */
import { BALANCE } from "../config/balance";

/** 三角形（頂点3つ。ローカル座標 [x, y] の並び） */
export type Triangle = readonly [number, number, number, number, number, number];

/** 矩形（ローカル座標。x,y は左上） */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ミサイルの形状（ローカル座標・進行方向は +X） */
export interface MissileShape {
  bodyRect: Rect; // 胴体
  noseTri: Triangle; // 弾頭（円錐部）
  finTris: readonly [Triangle, Triangle]; // 尾翼（上下）
  flameTri: Triangle; // 噴射炎（外側）
  flameCoreTri: Triangle; // 噴射炎の芯
}

/**
 * ミサイルの形状を組み立てる。
 * @param radius 弾の当たり判定半径 [px]（形状はすべてこの倍率で決まる）
 * @param flicker 噴射炎の伸縮 0〜1（0＝最短・1＝最長）
 */
export function missileShape(radius: number, flicker: number): MissileShape {
  const f = BALANCE.FX;
  const r = radius;
  const hw = f.MISSILE_HALF_WIDTH * r; // 胴体の半幅
  const fin = f.MISSILE_FIN_HALF_WIDTH * r; // 尾翼の張り出し
  const fw = f.MISSILE_FLAME_HALF_WIDTH * r; // 噴射炎の付け根の半幅
  const back = f.MISSILE_BODY_BACK * r;
  const front = f.MISSILE_BODY_FRONT * r;
  const finBack = f.MISSILE_FIN_BACK * r;
  const k = Math.min(1, Math.max(0, flicker));
  const flameBack = (f.MISSILE_FLAME_MIN + (f.MISSILE_FLAME_MAX - f.MISSILE_FLAME_MIN) * k) * r;

  return {
    bodyRect: { x: back, y: -hw, w: front - back, h: hw * 2 },
    // 弾頭：胴体の前端から先端（+radius＝当たり判定の円の縁）へ絞り込む
    noseTri: [front, -hw, front, hw, f.MISSILE_NOSE * r, 0],
    finTris: [
      [back, -hw, finBack, -fin, finBack, 0],
      [back, hw, finBack, fin, finBack, 0],
    ],
    flameTri: [finBack, -fw, finBack, fw, flameBack, 0],
    flameCoreTri: [finBack, -fw / 2, finBack, fw / 2, (finBack + flameBack) / 2, 0],
  };
}

/** 形状のローカル頂点をすべて列挙する（検証・描画順に依存しない用途） */
export function missileVertices(shape: MissileShape): [number, number][] {
  const { bodyRect: b } = shape;
  const pts: [number, number][] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ];
  const tris = [shape.noseTri, ...shape.finTris, shape.flameTri, shape.flameCoreTri];
  for (const t of tris) {
    pts.push([t[0], t[1]], [t[2], t[3]], [t[4], t[5]]);
  }
  return pts;
}

// --- 敵C「スナイパー」弾：細長い徹甲弾＋後方の曳光（GDD §5 v0.20） ---

/** スナイパー弾の形状（ローカル座標・進行方向は +X） */
export interface SniperShape {
  bodyRect: Rect; // 弾体の胴（後端〜円錐の付け根）
  tipTri: Triangle; // 弾体の先端（円錐部。先端は +radius＝当たり判定の縁）
  trailTri: Triangle; // 曳光（後方へ細く伸びる）
}

/** スナイパー弾の形状を組み立てる */
export function sniperShape(radius: number): SniperShape {
  const f = BALANCE.FX;
  const r = radius;
  const hw = f.SNIPER_HALF_WIDTH * r;
  const nose = f.MISSILE_NOSE * r; // 先端＝当たり判定の縁
  const back = nose - f.SNIPER_LEN * r; // 弾体の後端
  const shoulder = nose - f.SNIPER_LEN * 0.25 * r; // 円錐の付け根
  return {
    bodyRect: { x: back, y: -hw, w: shoulder - back, h: hw * 2 },
    tipTri: [shoulder, -hw, shoulder, hw, nose, 0],
    trailTri: [back, -hw, back, hw, -f.SNIPER_TRAIL * r, 0],
  };
}

// --- 敵G「プリズム」弾：自転する結晶＋残り反射回数の輪（GDD §5 v0.20） ---

/** プリズム弾の形状（ローカル座標。進行方向は持たず自転する） */
export interface PrismShape {
  /** 結晶（6角形）の頂点 [x, y] の並び。外接半径は当たり判定半径と同じ */
  crystal: [number, number][];
  /** 中心から引く稜線の終点 */
  edges: [number, number][];
  /** 残り反射回数を示す輪の半径（外側ほど残りが多い）。当たり判定の外側に薄く描く */
  ringRadii: number[];
}

/**
 * プリズム弾の形状を組み立てる。
 * @param radius 当たり判定半径 [px]
 * @param spin 自転角 [rad]
 * @param bouncesLeft 残り反射回数（輪の本数になる）
 */
export function prismShape(radius: number, spin: number, bouncesLeft: number): PrismShape {
  const f = BALANCE.FX;
  const outer = f.PRISM_RADIUS * radius; // 実体は当たり判定と同じ大きさ
  const crystal: [number, number][] = [];
  const edges: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = spin + (i * Math.PI) / 3;
    crystal.push([Math.cos(a) * outer, Math.sin(a) * outer]);
    if (i % 2 === 0) edges.push([Math.cos(a) * outer, Math.sin(a) * outer]);
  }
  const ringRadii: number[] = [];
  for (let i = 0; i < Math.max(0, bouncesLeft); i++) {
    ringRadii.push(outer + (i + 1) * f.PRISM_RING_GAP * radius);
  }
  return { crystal, edges, ringRadii };
}
