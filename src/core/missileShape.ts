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
