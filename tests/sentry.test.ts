/**
 * 敵A「セントリー」のステートマシンのテスト（決定的な乱数を注入）。
 */
import { describe, expect, it } from "vitest";
import type { Bullet } from "../src/core/bullet";
import { createSentry, type SentryUpdateContext, updateSentry } from "../src/core/sentry";
import { FLOOR_5X5, makeStage } from "./helpers";

const stage = makeStage(FLOOR_5X5);
// rng=0.5 固定：ブレ jitter=0、発射間隔は常に平均値（3.0s）になる
const rngHalf = (): number => 0.5;

function makeCtx(overrides: Partial<SentryUpdateContext> = {}): SentryUpdateContext {
  return {
    player: { x: 80, y: 112 }, // セントリーの真下 → 初期砲塔角（下向き）と一致
    bullets: [] as Bullet[],
    stage,
    grace: 0,
    rng: rngHalf,
    ...overrides,
  };
}

describe("セントリーAI（ステートマシン）", () => {
  it("開幕グレース中は IDLE のまま射撃しない", () => {
    const e = createSentry(80, 48, rngHalf);
    const ctx = makeCtx({ grace: 1.0 });
    updateSentry(e, 0.05, ctx);
    expect(e.state).toBe("IDLE");
    expect(ctx.bullets).toHaveLength(0);
  });

  it("グレース終了で AIM に遷移し、条件が揃うと発射して RELOAD に遷移する", () => {
    const e = createSentry(80, 48, rngHalf);
    const ctx = makeCtx();
    // fireTimer（3.0s）を消化するまで更新する（浮動小数点誤差を考慮して余裕を持たせる）。
    // 砲塔は最初から真下＝プレイヤー方向
    for (let i = 0; i < 70; i++) updateSentry(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1); // 発射された
    expect(ctx.bullets[0]!.owner).toBe(e);
    expect(e.state).toBe("RELOAD");
    expect(e.fireTimer).toBeGreaterThan(0); // 次回間隔が再設定された
  });

  it("同時発射数上限（1発）：自弾が場にある間は再発射しない", () => {
    const e = createSentry(80, 48, rngHalf);
    const ctx = makeCtx();
    for (let i = 0; i < 70; i++) updateSentry(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1);
    // さらに RELOAD 消化 + AIM で発射条件を満たすまで回しても、弾が生きている限り撃たない
    for (let i = 0; i < 200; i++) updateSentry(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(1);
    expect(e.state).toBe("AIM"); // RELOAD は消化済みで AIM 待機
  });

  it("射線が壁で遮られていると発射しない", () => {
    const blockedStage = makeStage([
      "#####",
      "#P..#",
      "###.#", // セントリーとプレイヤーの間に壁
      "#...#",
      "#####",
    ]);
    const e = createSentry(48, 48, rngHalf);
    const ctx = makeCtx({ player: { x: 48, y: 112 }, stage: blockedStage });
    for (let i = 0; i < 200; i++) updateSentry(e, 0.05, ctx);
    expect(ctx.bullets).toHaveLength(0); // 撃たない（跳弾専用の的：GDD v0.2 §6 補足）
  });

  it("砲塔がプレイヤー方向 ±0.15rad を向くまでは発射しない", () => {
    const e = createSentry(80, 48, rngHalf);
    e.turretAngle = -Math.PI / 2; // 真上（プレイヤーの反対）を向かせる
    const ctx = makeCtx();
    e.fireTimer = 0; // 間隔は消化済みでも…
    updateSentry(e, 0.01, ctx);
    expect(ctx.bullets).toHaveLength(0); // 向きが合うまで撃たない
  });
});
