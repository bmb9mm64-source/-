/**
 * ゲームシーン — core の GameWorld を駆動し、結果を描画するだけの薄い層（CLAUDE.md 規約）。
 * ロジック（移動・跳弾・AI・当たり判定）はすべて src/core/ にあり、ここには置かない。
 * 描画はすべて Phaser Graphics のコード描画（外部アセット禁止・オリジナル配色）。
 */
import Phaser from "phaser";
import { BALANCE, COLORS } from "../config/balance";
import { parseStage } from "../core/stage";
import type { TankBody } from "../core/types";
import { GameWorld, type WorldInput } from "../core/world";
import { STAGE_TEST } from "../stages/testStage";

export class GameScene extends Phaser.Scene {
  private world!: GameWorld;
  private paused = false; // ポーズはシーン側の責務（ポーズ中は world.update を呼ばない）
  private fireRequested = false; // 1クリック1発の発射要求フラグ

  private keys!: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
  };

  private dynGfx!: Phaser.GameObjects.Graphics; // 戦車・弾（毎フレーム描き直し）
  private crosshairGfx!: Phaser.GameObjects.Graphics; // 十字カーソル（最前面）
  private hudLeft!: Phaser.GameObjects.Text;
  private hudRight!: Phaser.GameObjects.Text;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlaySub!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "GameScene" });
  }

  create(): void {
    const w = BALANCE.TILE * BALANCE.COLS;
    const h = BALANCE.TILE * BALANCE.ROWS;

    this.world = new GameWorld(parseStage(STAGE_TEST));
    this.paused = false;
    this.fireRequested = false;

    this.input.setDefaultCursor("none"); // 自前の十字カーソルを描くため OS カーソルは隠す

    // --- 静的な盤面（床・グリッド・壁・穴）は一度だけ描く ---
    this.drawStage();

    // --- 動的レイヤー ---
    this.dynGfx = this.add.graphics().setDepth(1);
    this.crosshairGfx = this.add.graphics().setDepth(20);

    // --- HUD（残機・敵残数。上端の外周壁上に重ねて表示） ---
    const hudStyle = {
      fontFamily: "sans-serif",
      fontSize: "15px",
      fontStyle: "bold",
      color: COLORS.HUD_CSS,
    };
    this.hudLeft = this.add.text(10, 16, "", hudStyle).setOrigin(0, 0.5).setDepth(5);
    this.hudRight = this.add.text(w - 10, 16, "", hudStyle).setOrigin(1, 0.5).setDepth(5);

    // --- オーバーレイ（ポーズ・ゲームオーバー・クリア） ---
    this.overlayGfx = this.add.graphics().setDepth(10).setVisible(false);
    this.overlayGfx.fillStyle(COLORS.OVERLAY, COLORS.OVERLAY_ALPHA);
    this.overlayGfx.fillRect(0, 0, w, h);
    this.overlayTitle = this.add
      .text(w / 2, h / 2 - 18, "", {
        fontFamily: "sans-serif",
        fontSize: "42px",
        fontStyle: "bold",
        color: COLORS.HUD_CSS,
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setVisible(false);
    this.overlaySub = this.add
      .text(w / 2, h / 2 + 26, "", {
        fontFamily: "sans-serif",
        fontSize: "16px",
        color: COLORS.HUD_CSS,
      })
      .setOrigin(0.5)
      .setDepth(11)
      .setVisible(false);

    // --- 入力 ---
    const kb = this.input.keyboard;
    if (!kb) throw new Error("キーボード入力が利用できません");
    this.keys = {
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    // ポーズ切り替え（Esc / P）：プレイ中のみ有効（Phase 1 と同じ挙動）
    const togglePause = (): void => {
      if (this.world.status === "playing") this.paused = !this.paused;
    };
    kb.on("keydown-ESC", togglePause);
    kb.on("keydown-P", togglePause);
    // R でゲーム全体をリスタート
    kb.on("keydown-R", () => {
      this.world.resetGame();
      this.paused = false;
    });

    // 左クリックのみ発射要求（押しっぱなし連射はしない）
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0) this.fireRequested = true;
    });
  }

  override update(_time: number, deltaMs: number): void {
    // デルタタイム算出＋上限クランプ（フレームレート非依存・タブ復帰時の吹っ飛び防止）
    const dt = Math.min(deltaMs / 1000, BALANCE.DT_MAX);
    const pointer = this.input.activePointer;

    if (!this.paused && this.world.status === "playing") {
      const input: WorldInput = {
        moveX: (this.keys.d.isDown ? 1 : 0) - (this.keys.a.isDown ? 1 : 0),
        moveY: (this.keys.s.isDown ? 1 : 0) - (this.keys.w.isDown ? 1 : 0),
        aimX: pointer.worldX,
        aimY: pointer.worldY,
        fire: this.fireRequested,
      };
      this.world.update(dt, input);
      this.fireRequested = false; // 更新で消費（不発でもクリックは消費：Phase 1 と同じ）
    }

    this.redraw(pointer);
  }

  /** 静的な盤面（床・グリッド・壁・穴）の描画 */
  private drawStage(): void {
    const t = BALANCE.TILE;
    const w = t * BALANCE.COLS;
    const h = t * BALANCE.ROWS;
    const gfx = this.add.graphics().setDepth(0);

    // 床
    gfx.fillStyle(COLORS.FLOOR, 1);
    gfx.fillRect(0, 0, w, h);

    // 薄いグリッド線（盤面の視認性向上）
    gfx.lineStyle(1, COLORS.FLOOR_GRID, 1);
    for (let c = 1; c < BALANCE.COLS; c++) {
      gfx.lineBetween(c * t + 0.5, 0, c * t + 0.5, h);
    }
    for (let r = 1; r < BALANCE.ROWS; r++) {
      gfx.lineBetween(0, r * t + 0.5, w, r * t + 0.5);
    }

    // 壁と穴（X 破壊可能壁は Phase 3 で専用の見た目を用意。当面は壁と同描画）
    const stage = this.world.stage;
    for (let r = 0; r < stage.rows; r++) {
      for (let c = 0; c < stage.cols; c++) {
        const ch = stage.grid[r]![c]!;
        const x = c * t;
        const y = r * t;
        if (ch === "#" || ch === "X") {
          gfx.fillStyle(COLORS.WALL, 1);
          gfx.fillRect(x, y, t, t);
          gfx.fillStyle(COLORS.WALL_EDGE, 1); // 上面ハイライトでブロック感を出す
          gfx.fillRect(x + 2, y + 2, t - 4, 5);
        } else if (ch === "H") {
          gfx.fillStyle(COLORS.HOLE_EDGE, 1);
          gfx.fillRect(x, y, t, t);
          gfx.fillStyle(COLORS.HOLE, 1);
          gfx.fillRect(x + 3, y + 3, t - 6, t - 6);
        }
      }
    }
  }

  /** 戦車1台の描画（車体矩形＋キャタピラ＋砲塔円＋砲身矩形） */
  private drawTank(tank: TankBody, body: number, track: number, turret: number): void {
    const gfx = this.dynGfx;
    const s = tank.half * 2;

    // 車体（bodyAngle で回転）
    gfx.save();
    gfx.translateCanvas(tank.x, tank.y);
    gfx.rotateCanvas(tank.bodyAngle);
    gfx.fillStyle(track, 1); // キャタピラ（左右の帯）
    gfx.fillRect(-s / 2, -s / 2, s, 7);
    gfx.fillRect(-s / 2, s / 2 - 7, s, 7);
    gfx.fillStyle(body, 1); // 車体中央
    gfx.fillRect(-s / 2, -s / 2 + 7, s, s - 14);
    gfx.restore();

    // 砲塔（turretAngle で回転）
    gfx.save();
    gfx.translateCanvas(tank.x, tank.y);
    gfx.rotateCanvas(tank.turretAngle);
    gfx.fillStyle(turret, 1);
    gfx.fillRect(0, -3, tank.half + 8, 6); // 砲身
    gfx.fillCircle(0, 0, 9); // 砲塔リング
    gfx.fillStyle(body, 1);
    gfx.fillCircle(0, 0, 5); // 砲塔中心
    gfx.restore();
  }

  /** 毎フレームの動的描画（戦車・弾・HUD・オーバーレイ・十字カーソル） */
  private redraw(pointer: Phaser.Input.Pointer): void {
    const world = this.world;
    this.dynGfx.clear();

    for (const e of world.enemies) {
      if (e.alive) this.drawTank(e, COLORS.ENEMY_BODY, COLORS.ENEMY_TRACK, COLORS.ENEMY_TURRET);
    }
    this.drawTank(world.player, COLORS.PLAYER_BODY, COLORS.PLAYER_TRACK, COLORS.PLAYER_TURRET);

    // 弾
    for (const b of world.bullets) {
      this.dynGfx.fillStyle(COLORS.BULLET, 1);
      this.dynGfx.fillCircle(b.x, b.y, b.radius);
      this.dynGfx.lineStyle(1, COLORS.BULLET_EDGE, 1);
      this.dynGfx.strokeCircle(b.x, b.y, b.radius);
    }

    // HUD
    this.hudLeft.setText(`残機: ${world.lives}`);
    this.hudRight.setText(`敵: ${world.enemiesLeft()}`);

    // オーバーレイ
    let title = "";
    let sub = "";
    if (this.paused) {
      title = "PAUSED";
      sub = "Esc / P で再開";
    } else if (world.status === "gameover") {
      title = "GAME OVER";
      sub = "R でリスタート";
    } else if (world.status === "clear") {
      title = "MISSION CLEAR";
      sub = "R でリスタート";
    }
    const showOverlay = title !== "";
    this.overlayGfx.setVisible(showOverlay);
    this.overlayTitle.setVisible(showOverlay).setText(title);
    this.overlaySub.setVisible(showOverlay).setText(sub);

    // 十字カーソル（オーバーレイより前面）
    const gfx = this.crosshairGfx;
    const x = pointer.worldX;
    const y = pointer.worldY;
    gfx.clear();
    gfx.lineStyle(1.5, COLORS.CROSSHAIR, 1);
    gfx.beginPath();
    gfx.moveTo(x - 10, y);
    gfx.lineTo(x - 4, y);
    gfx.moveTo(x + 4, y);
    gfx.lineTo(x + 10, y);
    gfx.moveTo(x, y - 10);
    gfx.lineTo(x, y - 4);
    gfx.moveTo(x, y + 4);
    gfx.lineTo(x, y + 10);
    gfx.strokePath();
    gfx.strokeCircle(x, y, 2);
  }
}
