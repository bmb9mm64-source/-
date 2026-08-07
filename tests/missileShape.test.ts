/**
 * 弾のミサイル描画の形状テスト（GDD §5「弾の見た目」v0.16）。
 * 見た目の変更が当たり判定と食い違わないこと＝
 *   ① 弾頭の先端が当たり判定の円の縁（+radius）にちょうど一致する
 *   ② どの頂点も前方へは radius を超えない（＝「当たったように見えるのに当たらない」を作らない）
 *   ③ 胴体・尾翼・噴射炎はすべて後方に伸びる（＝弾頭が進行方向を向いている）
 * を機械的に担保する。
 */
import { describe, expect, it } from "vitest";
import { BALANCE } from "../src/config/balance";
import { missileShape, missileVertices } from "../src/core/missileShape";

const R = BALANCE.BULLET.RADIUS;

describe("ミサイル形状（進行方向は +X）", () => {
  it("弾頭の先端が当たり判定の円の縁（+radius）に一致する", () => {
    const s = missileShape(R, 0.5);
    expect(s.noseTri[4]).toBeCloseTo(R, 6); // 先端の x
    expect(s.noseTri[5]).toBeCloseTo(0, 6); // 先端は中心線上
  });

  it("どの頂点も前方へ radius を超えない（見た目が当たり判定より前に出ない）", () => {
    for (const flicker of [0, 0.5, 1]) {
      const verts = missileVertices(missileShape(R, flicker));
      const maxX = Math.max(...verts.map((v) => v[0]));
      expect(maxX).toBeLessThanOrEqual(R + 1e-9);
    }
  });

  it("先端だけが最前で、胴体・尾翼・噴射炎はすべてその後方にある", () => {
    const s = missileShape(R, 0.5);
    const behind = [
      s.bodyRect.x + s.bodyRect.w, // 胴体の前端
      ...s.finTris.flatMap((t) => [t[0], t[2], t[4]]),
      ...[s.flameTri, s.flameCoreTri].flatMap((t) => [t[0], t[2], t[4]]),
    ];
    for (const x of behind) expect(x).toBeLessThan(s.noseTri[4]);
  });

  it("噴射炎は最後尾にあり、明滅で伸縮する（前方へは動かない）", () => {
    const short = missileShape(R, 0);
    const long = missileShape(R, 1);
    const tailOf = (sh: ReturnType<typeof missileShape>): number => sh.flameTri[4];
    expect(tailOf(long)).toBeLessThan(tailOf(short)); // 長いほど後ろへ伸びる
    // 噴射炎は尾翼より後ろ
    expect(tailOf(short)).toBeLessThan(short.finTris[0]![2]);
  });

  it("形状は radius に比例する（当たり判定半径を変えても比率が崩れない）", () => {
    const a = missileShape(R, 0.5);
    const b = missileShape(R * 3, 0.5);
    expect(b.noseTri[4]).toBeCloseTo(a.noseTri[4] * 3, 6);
    expect(b.bodyRect.w).toBeCloseTo(a.bodyRect.w * 3, 6);
    expect(b.flameTri[4]).toBeCloseTo(a.flameTri[4] * 3, 6);
  });

  it("上下対称（尾翼は中心線をはさんで対称）", () => {
    const s = missileShape(R, 0.5);
    const [up, down] = s.finTris;
    expect(up[1]).toBeCloseTo(-down[1]!, 6);
    expect(up[3]).toBeCloseTo(-down[3]!, 6);
  });
});
