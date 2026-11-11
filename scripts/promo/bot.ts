/**
 * 紹介動画の撮影用ボット（開発用ツール。ゲーム本体からは import しない）。
 *
 * 人の代わりに 1P を操作する。ゲームのルールには一切手を入れず、
 * 「移動の向き・カーソル位置・射撃するか」という**入力だけ**を返す
 * （＝映っているのは本物のゲームを NORMAL のまま遊んだ結果）。
 *
 * 考え方は2つだけ：
 *   - 射撃 … 全方位へ試し撃ちを頭の中で転がし（core の弾の更新をそのまま使う）、
 *            敵に当たる角度を探す。跳弾で当たる角度を少し優先する（このゲームの見せ場なので）
 *   - 移動 … 8方向＋停止の9通りについて少し先まで弾を進め、当たらない動きを選ぶ
 */
import { BALANCE } from "../../src/config/balance";
import {
  type Bullet,
  bulletHitsTank,
  spawnBullet,
  updateBullet,
  updateBulletArming,
} from "../../src/core/bullet";
import { armorReflects } from "../../src/core/mirror";
import { shieldBlocks } from "../../src/core/shielder";
import { solidForTank, tileAt } from "../../src/core/stage";
import { moveTank } from "../../src/core/tank";
import type { EnemyTank, GameWorld } from "../../src/core/world";

/** ボットの調整値（撮影用。ゲームバランスではないので balance.ts には置かない） */
const BOT = {
  SHOT_ANGLES: 360, // 試し撃ちの本数（1°刻み）
  SHOT_DT: 1 / 40, // 試し撃ちの時間刻み [s]
  SHOT_HORIZON: 3.2, // 試し撃ちを追う時間 [s]
  RICOCHET_BONUS: 1.2, // 跳弾で当たる角度の優先度（秒換算）
  LEAD_MAX: 1.2, // 敵の移動先読みの上限 [s]
  CLICK_INTERVAL: 0.34, // 人のクリック間隔に見せるための最短間隔 [s]
  MAX_SHOTS_PER_ENEMY: 2, // 同じ敵へ同時に飛ばす弾の上限
  AIM_RATE: 16, // カーソルが狙いへ寄る速さ [1/s]
  AIM_SNAP: 0.06, // これより角度差が小さければ撃つ [rad]
  DODGE_DT: 1 / 30, // 回避の先読みの時間刻み [s]
  DODGE_STEPS: 26, // 回避の先読み歩数（≒0.87秒）
  DODGE_MARGIN: 9, // 弾との余裕 [px]
  MINE_KEEPOUT: 84, // 地雷に近づかない距離 [px]
  KEEP_DIST: 150, // 敵に寄りすぎない距離 [px]
  REPATH_FRAMES: 12, // 経路を引き直す間隔 [フレーム]
  VANTAGE_ANGLES: 120, // 撃てる場所探しの試し撃ちの本数（3°刻み）
} as const;

/** ボットが返す1フレーム分の操作 */
export interface BotOutput {
  moveX: number; // -1 / 0 / +1
  moveY: number;
  cursorX: number; // カーソル位置（ゲーム座標 px）
  cursorY: number;
  fire: boolean;
}

interface Shot {
  angle: number;
  enemy: EnemyTank;
  time: number; // 命中までの時間 [s]
  bounces: number;
  aimDist: number; // カーソルを置く距離（最初の反射点または目標まで）
}

const MOVES: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export class Bot {
  private cursorX = 400;
  private cursorY = 272;
  private clickTimer = 0;
  private moveIdx = 0;
  private frame = 0;
  private goal: { x: number; y: number } | null = null;
  private vantage: number | null = null; // 撃てる場所（タイル番号）。見つけたら着くまで覚えておく
  private vantageAge = 0;
  private prevPos = new Map<EnemyTank, { x: number; y: number; vx: number; vy: number }>();
  /** 自分の弾がどの敵を狙って撃ったものか（同じ敵への撃ちすぎ防止） */
  private pending = new Map<Bullet, EnemyTank>();

  /** ミッション開始時に呼ぶ（カーソルを自機の前方に置き直す） */
  reset(world: GameWorld): void {
    const p = world.player;
    this.cursorX = p.x + 120;
    this.cursorY = p.y;
    this.clickTimer = 0.25;
    this.moveIdx = 0;
    this.frame = 0;
    this.goal = null;
    this.vantage = null;
    this.prevPos.clear();
    this.pending.clear();
  }

  decide(world: GameWorld, dt: number): BotOutput {
    const p = world.player;
    this.frame++;
    this.clickTimer = Math.max(0, this.clickTimer - dt);
    const idle: BotOutput = { moveX: 0, moveY: 0, cursorX: this.cursorX, cursorY: this.cursorY, fire: false };
    if (world.status !== "playing" || !p.alive) return idle;

    this.trackEnemies(world, dt);
    for (const b of this.pending.keys()) if (b.dead || !world.bullets.includes(b)) this.pending.delete(b);

    // --- 射撃：当たる角度を探す ---
    const shot = this.findShot(world);
    let fire = false;
    let tx: number;
    let ty: number;
    if (shot) {
      tx = p.x + Math.cos(shot.angle) * shot.aimDist;
      ty = p.y + Math.sin(shot.angle) * shot.aimDist;
    } else {
      const e = this.nearestEnemy(world);
      tx = e ? e.x : this.cursorX;
      ty = e ? e.y : this.cursorY;
    }
    const k = Math.min(1, BOT.AIM_RATE * dt);
    this.cursorX += (tx - this.cursorX) * k;
    this.cursorY += (ty - this.cursorY) * k;
    if (shot && this.clickTimer <= 0 && p.cooldown <= 0) {
      const cur = Math.atan2(this.cursorY - p.y, this.cursorX - p.x);
      const diff = Math.abs(Math.atan2(Math.sin(cur - shot.angle), Math.cos(cur - shot.angle)));
      if (diff < BOT.AIM_SNAP) {
        // 撃つ瞬間だけ狙いの角度にぴったり合わせる（数 px の補正。見た目には分からない）
        const d = Math.max(40, Math.hypot(this.cursorX - p.x, this.cursorY - p.y));
        this.cursorX = p.x + Math.cos(shot.angle) * d;
        this.cursorY = p.y + Math.sin(shot.angle) * d;
        fire = true;
        this.clickTimer = BOT.CLICK_INTERVAL;
        this.pendingEnemy = shot.enemy;
      }
    }

    // --- 移動：当たらない動きを選ぶ ---
    if (shot) {
      this.goal = null;
      this.vantage = null;
    } else if (this.frame % BOT.REPATH_FRAMES === 1) {
      this.goal = this.pathStep(world);
    }
    let gx = 0;
    let gy = 0;
    if (this.goal) {
      const d = Math.hypot(this.goal.x - p.x, this.goal.y - p.y);
      if (d > 4) {
        gx = (this.goal.x - p.x) / d;
        gy = (this.goal.y - p.y) / d;
      }
    }
    let best = 0;
    let bestCost = Infinity;
    for (let i = 0; i < MOVES.length; i++) {
      const [mx, my] = MOVES[i]!;
      let cost = this.danger(world, mx, my);
      const len = Math.hypot(mx, my);
      if (len > 0) cost -= 2 * ((mx / len) * gx + (my / len) * gy);
      else if (!this.goal) cost -= 1; // 行き先が無いときは止まって狙う
      if (i === this.moveIdx) cost -= 0.4; // 向きを小刻みに変えない
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    this.moveIdx = best;
    const [moveX, moveY] = MOVES[best]!;
    return { moveX, moveY, cursorX: this.cursorX, cursorY: this.cursorY, fire };
  }

  /** 直前に撃った弾を「どの敵を狙ったか」と結び付ける（world.update の後に呼ぶ） */
  private pendingEnemy: EnemyTank | null = null;
  afterStep(world: GameWorld): void {
    if (!this.pendingEnemy) return;
    for (let i = world.bullets.length - 1; i >= 0; i--) {
      const b = world.bullets[i]!;
      if (b.owner === world.player && !this.pending.has(b)) {
        this.pending.set(b, this.pendingEnemy);
        break;
      }
    }
    this.pendingEnemy = null;
  }

  private nearestEnemy(world: GameWorld): EnemyTank | null {
    const p = world.player;
    let best: EnemyTank | null = null;
    let bd = Infinity;
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** 敵の速度を前フレームとの差から見積もる（移動する敵への偏差射撃用） */
  private trackEnemies(world: GameWorld, dt: number): void {
    for (const e of world.enemies) {
      const prev = this.prevPos.get(e);
      if (prev && dt > 0) {
        const a = 0.2; // なめらかにする係数
        prev.vx += ((e.x - prev.x) / dt - prev.vx) * a;
        prev.vy += ((e.y - prev.y) / dt - prev.vy) * a;
        prev.x = e.x;
        prev.y = e.y;
      } else {
        this.prevPos.set(e, { x: e.x, y: e.y, vx: 0, vy: 0 });
      }
    }
  }

  private findShot(world: GameWorld): Shot | null {
    const shotsOn = new Map<EnemyTank, number>();
    for (const e of this.pending.values()) shotsOn.set(e, (shotsOn.get(e) ?? 0) + 1);
    const hits: (Shot | null)[] = [];
    for (let i = 0; i < BOT.SHOT_ANGLES; i++) {
      hits.push(this.simulateShot(world, (i / BOT.SHOT_ANGLES) * Math.PI * 2));
    }
    let best: Shot | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < hits.length; i++) {
      const s = hits[i];
      if (!s) continue;
      if ((shotsOn.get(s.enemy) ?? 0) >= BOT.MAX_SHOTS_PER_ENEMY) continue;
      // 両隣の角度でも同じ敵に当たる＝少しずれても当たる、安定した射線だけを選ぶ
      const l = hits[(i + hits.length - 1) % hits.length];
      const r = hits[(i + 1) % hits.length];
      if (l?.enemy !== s.enemy || r?.enemy !== s.enemy) continue;
      const score = -s.time + (s.bounces > 0 ? BOT.RICOCHET_BONUS : 0);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  /** angle へ撃ったら何に当たるかを、core の弾の更新をそのまま使って先読みする */
  private simulateShot(world: GameWorld, angle: number, from?: { x: number; y: number }): Shot | null {
    // from を渡すと「そこに立って撃ったら」の先読みになる（撃てる場所探し用）
    const p = from
      ? { x: from.x, y: from.y, radius: world.player.radius, kind: "player" }
      : world.player;
    const b = spawnBullet([], p, angle, BALANCE.BULLET, world.stage);
    let aimDist = 0;
    for (let t = 0; t < BOT.SHOT_HORIZON; t += BOT.SHOT_DT) {
      const before = b.bounces;
      updateBullet(b, BOT.SHOT_DT, world.stage);
      updateBulletArming(b);
      if (b.dead) return null;
      if (b.bounces > before && aimDist === 0) aimDist = Math.hypot(b.x - p.x, b.y - p.y);
      if (b.armed && bulletHitsTank(b, p)) return null; // 自分に返ってくる角度は撃たない
      for (const e of world.enemies) {
        if (!e.alive) continue;
        const v = this.prevPos.get(e);
        const lead = Math.min(t, BOT.LEAD_MAX);
        const ex = e.x + (v ? v.vx * lead : 0);
        const ey = e.y + (v ? v.vy * lead : 0);
        if (!bulletHitsTank(b, { x: ex, y: ey, radius: e.radius })) continue;
        if (e.kind === "shielder" && shieldBlocks(e, b)) return null; // 盾の正面は無駄弾
        if (e.kind === "mirror" && armorReflects(e, b)) return null; // 反射装甲の正面は自分に返る
        if (aimDist === 0) aimDist = Math.hypot(ex - p.x, ey - p.y);
        return {
          angle,
          enemy: e,
          time: t,
          bounces: b.bounces,
          aimDist: Math.min(Math.max(aimDist, 70), 280),
        };
      }
    }
    return null;
  }

  /** この向きへ動き続けたときの危なさ（大きいほど危険） */
  private danger(world: GameWorld, mx: number, my: number): number {
    const real = world.player;
    const p = { x: real.x, y: real.y, half: real.half };
    const len = Math.hypot(mx, my);
    const step = BALANCE.PLAYER.SPEED * BOT.DODGE_DT;
    const dx = len > 0 ? (mx / len) * step : 0;
    const dy = len > 0 ? (my / len) * step : 0;
    const clones = world.bullets.filter((b) => !b.dead).map((b) => ({ ...b }));
    let cost = 0;
    for (let s = 0; s < BOT.DODGE_STEPS; s++) {
      if (len > 0) {
        const ox = p.x;
        const oy = p.y;
        moveTank(p, dx, dy, world.enemies, world.stage);
        if (s === 0 && Math.hypot(p.x - ox, p.y - oy) < step * 0.3) cost += 1.5; // 壁に向かって進むだけの動き
      }
      for (const c of clones) {
        if (c.dead) continue;
        updateBullet(c, BOT.DODGE_DT, world.stage);
        if (c.detonated) {
          const rr = (c.blastRadius ?? BALANCE.BULLET.SHELL_BLAST_RADIUS) + real.radius + BOT.DODGE_MARGIN;
          if (Math.hypot(c.x - p.x, c.y - p.y) < rr) return 1000 - s * 20;
          continue;
        }
        if (c.dead) continue;
        if (c.owner === real && !c.armed) {
          // 撃った直後の自弾は当たらない。離れたら当たるようになる（先読み中は元の位置で判定）
          if (Math.hypot(c.x - real.x, c.y - real.y) > real.radius + c.radius) c.armed = true;
          continue;
        }
        const gap = Math.hypot(c.x - p.x, c.y - p.y) - (c.radius + real.radius);
        if (gap < 0) return 1000 - s * 20; // 早く当たるほど悪い
        if (gap < BOT.DODGE_MARGIN) cost += (BOT.DODGE_MARGIN - gap) * 0.4;
      }
    }
    for (const m of world.mines) {
      if (m.dead || m.ownerIsPlayer) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < BOT.MINE_KEEPOUT) cost += (BOT.MINE_KEEPOUT - d) * 0.5;
    }
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < BOT.KEEP_DIST) cost += (BOT.KEEP_DIST - d) * 0.03;
    }
    return cost;
  }

  /**
   * いまの位置から撃てる角度が無いときの行き先を決め、そこへ向かう経路の「次の1マス」を返す。
   * 歩いて行けるマスを近い順に調べ、「そこに立てば敵に当たる角度がある」最初のマスを目指す
   * （敵が壁と穴で囲まれていて近づけない盤面でも、跳弾の通る場所を探して回り込める）。
   */
  private pathStep(world: GameWorld): { x: number; y: number } | null {
    const st = world.stage;
    const t = st.tile;
    const p = world.player;
    const start = Math.floor(p.y / t) * st.cols + Math.floor(p.x / t);
    const center = (id: number): { x: number; y: number } => ({
      x: ((id % st.cols) + 0.5) * t,
      y: (Math.floor(id / st.cols) + 0.5) * t,
    });

    // 幅優先探索：歩いて行けるマスを近い順に並べる
    const prev = new Map<number, number>([[start, -1]]);
    const order = [start];
    for (let head = 0; head < order.length; head++) {
      const cur = order[head]!;
      const c = cur % st.cols;
      const r = Math.floor(cur / st.cols);
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const id = (r + dr) * st.cols + (c + dc);
        if (prev.has(id) || solidForTank(tileAt(st, c + dc, r + dr))) continue;
        prev.set(id, cur);
        order.push(id);
      }
    }

    this.vantageAge++;
    if (this.vantage === start || this.vantageAge > 8 || (this.vantage !== null && !prev.has(this.vantage))) {
      this.vantage = null;
    }
    if (this.vantage === null) {
      this.vantageAge = 0;
      for (const id of order) {
        if (id === start) continue;
        const pos = center(id);
        let ok = false;
        for (let i = 0; i < BOT.VANTAGE_ANGLES && !ok; i++) {
          ok = this.simulateShot(world, (i / BOT.VANTAGE_ANGLES) * Math.PI * 2, pos) !== null;
        }
        if (ok) {
          this.vantage = id;
          break;
        }
      }
    }
    if (this.vantage === null) return null;
    let node = this.vantage;
    while (prev.get(node) !== start && prev.get(node) !== -1) node = prev.get(node)!;
    return center(node);
  }
}
