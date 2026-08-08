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
import {
  type Bullet,
  type BulletSpawnConfig,
  ENEMY_BULLET_CFG,
  PRISM_BULLET_CFG,
  REFLECTOR_BULLET_CFG,
  SHELL_CFG,
  SNIPER_BULLET_CFG,
  spawnBullet,
} from "../src/core/bullet";
import {
  missileShape,
  missileVertices,
  prismShape,
  sniperShape,
} from "../src/core/missileShape";

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

describe("敵C「スナイパー」弾の形状", () => {
  it("先端が当たり判定の円の縁に一致し、前方へはみ出さない", () => {
    const s = sniperShape(R);
    expect(s.tipTri[4]).toBeCloseTo(R, 6); // 先端の x
    expect(s.tipTri[5]).toBeCloseTo(0, 6);
    const xs = [
      s.bodyRect.x,
      s.bodyRect.x + s.bodyRect.w,
      s.tipTri[0],
      s.tipTri[2],
      s.tipTri[4],
      s.trailTri[0],
      s.trailTri[2],
      s.trailTri[4],
    ];
    expect(Math.max(...xs)).toBeLessThanOrEqual(R + 1e-9);
  });

  it("通常弾より細長い（速さが見た目で伝わる）", () => {
    const missile = missileShape(R, 0.5);
    const sniper = sniperShape(R);
    expect(sniper.bodyRect.h).toBeLessThan(missile.bodyRect.h); // 細い
    const missileLen = missile.noseTri[4] - missile.bodyRect.x;
    const sniperLen = sniper.tipTri[4] - sniper.bodyRect.x;
    expect(sniperLen).toBeGreaterThan(missileLen); // 長い
  });

  it("曳光は必ず後方へ伸びる", () => {
    const s = sniperShape(R);
    expect(s.trailTri[4]).toBeLessThan(s.bodyRect.x); // 曳光の先端は弾体の後端より後ろ
  });
});

describe("敵G「プリズム」弾の形状", () => {
  it("結晶の実体は当たり判定の円と同じ大きさ（判定より大きく見せない）", () => {
    const s = prismShape(R, 0, 3);
    for (const [x, y] of s.crystal) {
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(R + 1e-9);
    }
  });

  it("残り反射回数だけ輪が出る（あと何回跳ねるか読める）", () => {
    expect(prismShape(R, 0, 3).ringRadii).toHaveLength(3);
    expect(prismShape(R, 0, 1).ringRadii).toHaveLength(1);
    expect(prismShape(R, 0, 0).ringRadii).toHaveLength(0);
    // 輪は結晶の外側にあり、外側ほど残りが多いことを示す
    const rings = prismShape(R, 0, 3).ringRadii;
    expect(rings[0]).toBeGreaterThan(R);
    expect(rings[1]).toBeGreaterThan(rings[0]!);
    expect(rings[2]).toBeGreaterThan(rings[1]!);
  });

  it("自転しても大きさは変わらない（角度だけが変わる）", () => {
    const a = prismShape(R, 0, 2);
    const b = prismShape(R, 1.234, 2);
    const rad = (s: typeof a): number[] => s.crystal.map(([x, y]) => +Math.hypot(x, y).toFixed(9));
    expect(rad(b)).toEqual(rad(a));
    expect(b.crystal[0]).not.toEqual(a.crystal[0]); // 向きは変わっている
  });
});

describe("弾の見た目の種別が発射設定から正しく伝わる", () => {
  it("各弾種の設定で撃つと、弾に対応する style が入る", () => {
    const cases: [BulletSpawnConfig, string][] = [
      [ENEMY_BULLET_CFG, "normal"],
      [SNIPER_BULLET_CFG, "sniper"],
      [PRISM_BULLET_CFG, "prism"],
      [SHELL_CFG, "shell"],
      [REFLECTOR_BULLET_CFG, "normal"], // 敵E弾は反射回数だけが違う（見た目は通常弾）
    ];
    for (const [cfg, expected] of cases) {
      const bullets: Bullet[] = [];
      spawnBullet(bullets, { x: 100, y: 100 }, 0, cfg);
      expect(bullets[0]!.style, `${expected} になるはず`).toBe(expected);
    }
  });
});
