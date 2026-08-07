/**
 * ゲームシーン — core の GameWorld を駆動し、結果を描画・発音するだけの薄い層（CLAUDE.md 規約）。
 * ロジック（移動・跳弾・AI・地雷・当たり判定・ミッション進行）はすべて src/core/ にあり、ここには置かない。
 * 描画はすべて Phaser Graphics のコード描画（外部アセット禁止・オリジナル配色）。
 * 効果音は src/audio/sfx.ts（Web Audio 自作合成）。ワールドのイベントを音に変換する。
 *
 * 入力（GDD §3・§12.5）：
 *   1P … WASD 移動＋マウス照準＋左クリック射撃＋スペース/右クリック地雷（従来どおり）。
 *   2P … ゲームパッド優先（毎フレーム接続確認・随時切替）。未接続時はキーボード分割：
 *         矢印キー移動・IJKL 8方向照準・Enter 射撃・右Shift 地雷。
 *   入力はすべて core の PlayerInput 型に正規化して GameWorld に渡す。
 */
import Phaser from "phaser";
import { SFX } from "../audio/sfx";
import { BALANCE, COLORS } from "../config/balance";
import { eightWayAngle, type PlayerInput } from "../core/input";
import type { TankBody } from "../core/types";
import { GameWorld } from "../core/world";
import { GamepadPoller } from "../input/gamepad";
import { ALL_MISSIONS } from "../stages/allMissions";

/** 爆発フラッシュ演出（見た目のみ） */
interface ExplosionFx {
  x: number;
  y: number;
  age: number; // 経過時間 [s]
}

export class GameScene extends Phaser.Scene {
  private world!: GameWorld;
  private playerCount = 1; // TitleScene から渡されるモード（1 or 2）
  private paused = false; // ポーズはシーン側の責務（ポーズ中は world.update を呼ばない）
  private fireRequested = false; // 1P：1クリック1発の発射要求フラグ
  private mineRequested = false; // 1P：1押下1設置の地雷要求フラグ
  private fire2Requested = false; // 2P（キーボード Enter）
  private mine2Requested = false; // 2P（キーボード 右Shift）
  private gamepad = new GamepadPoller(); // 2P パッド（毎フレーム接続確認）
  private explosionsFx: ExplosionFx[] = [];
  private lastStageVersion = -1; // 盤面描画キャッシュの版（X 破壊・ミッション切替で再描画）

  private keys!: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
  };
  private keys2!: {
    up: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    i: Phaser.Input.Keyboard.Key;
    j: Phaser.Input.Keyboard.Key;
    k: Phaser.Input.Keyboard.Key;
    l: Phaser.Input.Keyboard.Key;
  };

  private stageGfx!: Phaser.GameObjects.Graphics; // 盤面（版が変わった時のみ描き直し）
  private dynGfx!: Phaser.GameObjects.Graphics; // 戦車・弾・地雷・爆発（毎フレーム描き直し）
  private crosshairGfx!: Phaser.GameObjects.Graphics; // 十字カーソル（最前面）
  private hudLeft!: Phaser.GameObjects.Text;
  private hudRight!: Phaser.GameObjects.Text;
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlaySub!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "GameScene" });
  }

  create(data: { playerCount?: number } = {}): void {
    const w = BALANCE.TILE * BALANCE.COLS;
    const h = BALANCE.TILE * BALANCE.ROWS;

    this.playerCount = data.playerCount === 2 ? 2 : 1;
    this.world = new GameWorld(ALL_MISSIONS, Math.random, this.playerCount);
    // デバッグ・プレイテスト用：URL の ?m=N（1始まり）で任意ミッションから開始できる
    const mParam = Number(new URLSearchParams(window.location.search).get("m"));
    if (Number.isInteger(mParam) && mParam >= 1 && mParam <= ALL_MISSIONS.length) {
      this.world.loadMission(mParam - 1);
    }
    this.paused = false;
    this.fireRequested = false;
    this.mineRequested = false;
    this.fire2Requested = false;
    this.mine2Requested = false;
    this.gamepad = new GamepadPoller();
    this.explosionsFx = [];
    this.lastStageVersion = -1;

    this.input.setDefaultCursor("none"); // 自前の十字カーソルを描くため OS カーソルは隠す
    this.input.mouse?.disableContextMenu(); // 右クリック＝地雷設置のためコンテキストメニューを抑止

    // --- 盤面レイヤー（版が変わった時のみ描き直す） ---
    this.stageGfx = this.add.graphics().setDepth(0);

    // --- 動的レイヤー ---
    this.dynGfx = this.add.graphics().setDepth(1);
    this.crosshairGfx = this.add.graphics().setDepth(20);

    // --- HUD（ミッション番号・残機・撃破数＋2P 時は P1/P2 の生存状態。GDD §8・§12.5） ---
    const hudStyle = {
      fontFamily: "sans-serif",
      fontSize: "15px",
      fontStyle: "bold",
      color: COLORS.HUD_CSS,
    };
    this.hudLeft = this.add.text(10, 16, "", hudStyle).setOrigin(0, 0.5).setDepth(5);
    this.hudRight = this.add.text(w - 10, 16, "", hudStyle).setOrigin(1, 0.5).setDepth(5);

    // --- オーバーレイ（バナー・ポーズ・ゲームオーバー・全クリア） ---
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
    // 2P キーボード分割（パッド未接続時のフォールバック。GDD §12.5）
    this.keys2 = {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      i: kb.addKey(Phaser.Input.Keyboard.KeyCodes.I),
      j: kb.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      k: kb.addKey(Phaser.Input.Keyboard.KeyCodes.K),
      l: kb.addKey(Phaser.Input.Keyboard.KeyCodes.L),
    };
    // ポーズ切り替え（Esc / P）：プレイ中のみ有効
    const togglePause = (): void => {
      if (this.world.status === "playing") this.paused = !this.paused;
    };
    kb.on("keydown-ESC", togglePause);
    kb.on("keydown-P", togglePause);
    // R：全クリア画面ではタイトルへ、それ以外はゲーム全体をリスタート（M1・残機3）
    kb.on("keydown-R", () => {
      SFX.unlock();
      if (this.world.status === "allclear") {
        this.scene.start("TitleScene");
        return;
      }
      this.world.resetGame();
      this.paused = false;
    });
    // スペース：1P 地雷設置（1押下1設置）
    kb.on("keydown-SPACE", () => {
      SFX.unlock();
      this.mineRequested = true;
    });
    // Enter：2P 射撃（1押下1発。2人プレイ時のみ）
    kb.on("keydown-ENTER", () => {
      if (this.playerCount !== 2) return;
      SFX.unlock();
      this.fire2Requested = true;
    });
    // 右Shift：2P 地雷設置（location===2 が右側の Shift。2人プレイ時のみ）
    kb.on("keydown-SHIFT", (event: KeyboardEvent) => {
      if (this.playerCount !== 2 || event.location !== 2) return;
      SFX.unlock();
      this.mine2Requested = true;
    });
    // M：効果音のミュート切替
    kb.on("keydown-M", () => {
      SFX.unlock();
      SFX.toggleMute();
    });

    // クリック：1P 射撃（左）／地雷（右）。終了画面では再開操作
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      SFX.unlock(); // 自動再生制限の解除（ユーザー操作後の初期化）
      if (this.world.status === "gameover") {
        this.world.resetGame(); // クリックで M1 から再スタート（残機3）
        this.paused = false;
        return;
      }
      if (this.world.status === "allclear") {
        this.scene.start("TitleScene");
        return;
      }
      if (pointer.button === 0) this.fireRequested = true;
      else if (pointer.button === 2) this.mineRequested = true;
    });
  }

  /** 2P の入力を構築（パッド優先＋キーボード分割フォールバック。毎フレーム接続確認。GDD §12.5） */
  private buildP2Input(): PlayerInput {
    const pad = this.gamepad.poll();
    if (pad.connected) {
      return {
        moveX: pad.moveX,
        moveY: pad.moveY,
        aim: pad.aimAngle !== null ? { mode: "angle", angle: pad.aimAngle, instant: true } : { mode: "none" },
        fire: pad.firePressed,
        placeMine: pad.minePressed,
      };
    }
    // キーボードフォールバック：矢印移動＋IJKL 8方向照準（回転追従）＋Enter/右Shift
    const k = this.keys2;
    const aimAngle = eightWayAngle(k.i.isDown, k.j.isDown, k.k.isDown, k.l.isDown);
    return {
      moveX: (k.right.isDown ? 1 : 0) - (k.left.isDown ? 1 : 0),
      moveY: (k.down.isDown ? 1 : 0) - (k.up.isDown ? 1 : 0),
      aim: aimAngle !== null ? { mode: "angle", angle: aimAngle, instant: false } : { mode: "none" },
      fire: this.fire2Requested,
      placeMine: this.mine2Requested,
    };
  }

  override update(_time: number, deltaMs: number): void {
    // デルタタイム算出＋上限クランプ（フレームレート非依存・タブ復帰時の吹っ飛び防止）
    const dt = Math.min(deltaMs / 1000, BALANCE.DT_MAX);
    const pointer = this.input.activePointer;

    if (!this.paused) {
      const input1: PlayerInput = {
        moveX: (this.keys.d.isDown ? 1 : 0) - (this.keys.a.isDown ? 1 : 0),
        moveY: (this.keys.s.isDown ? 1 : 0) - (this.keys.w.isDown ? 1 : 0),
        aim: { mode: "cursor", x: pointer.worldX, y: pointer.worldY },
        fire: this.fireRequested,
        placeMine: this.mineRequested,
      };
      const inputs: PlayerInput[] = [input1];
      if (this.playerCount === 2) inputs.push(this.buildP2Input());
      this.world.update(dt, inputs);

      // ワールドの出来事を効果音・爆発演出に変換する
      for (const ev of this.world.events) SFX.play(ev);
      for (const ex of this.world.lastExplosions) {
        this.explosionsFx.push({ x: ex.x, y: ex.y, age: 0 });
      }
    }
    // 押下エッジ要求は毎フレーム消費（不発・ポーズ中・パッド切替時も持ち越さない）
    this.fireRequested = false;
    this.mineRequested = false;
    this.fire2Requested = false;
    this.mine2Requested = false;

    // 爆発フラッシュの経過（ポーズ中は進めない）
    if (!this.paused) {
      for (const fx of this.explosionsFx) fx.age += dt;
      this.explosionsFx = this.explosionsFx.filter((fx) => fx.age < BALANCE.FX.EXPLOSION_TIME);
    }

    this.redraw(pointer);
  }

  /** 盤面（床・グリッド・壁・破壊可能壁・穴）の描画。X 破壊やミッション切替時に呼び直す */
  private drawStage(): void {
    const t = BALANCE.TILE;
    const w = t * BALANCE.COLS;
    const h = t * BALANCE.ROWS;
    const gfx = this.stageGfx;
    gfx.clear();

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

    // 壁・破壊可能壁・穴
    const stage = this.world.stage;
    for (let r = 0; r < stage.rows; r++) {
      for (let c = 0; c < stage.cols; c++) {
        const ch = stage.grid[r]![c]!;
        const x = c * t;
        const y = r * t;
        if (ch === "#") {
          gfx.fillStyle(COLORS.WALL, 1);
          gfx.fillRect(x, y, t, t);
          gfx.fillStyle(COLORS.WALL_EDGE, 1); // 上面ハイライトでブロック感を出す
          gfx.fillRect(x + 2, y + 2, t - 4, 5);
        } else if (ch === "X") {
          // 破壊可能壁：茶系の土嚢風（恒久壁と色で区別。地雷の爆風で消える）
          gfx.fillStyle(COLORS.WALL_X, 1);
          gfx.fillRect(x, y, t, t);
          gfx.fillStyle(COLORS.WALL_X_EDGE, 1);
          gfx.fillRect(x + 2, y + 2, t - 4, 5);
          gfx.fillRect(x + 2, y + t / 2, t - 4, 4);
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

  /** 毎フレームの動的描画（盤面キャッシュ・戦車・弾・地雷・爆発・HUD・オーバーレイ・カーソル） */
  private redraw(pointer: Phaser.Input.Pointer): void {
    const world = this.world;

    // 盤面はワールドの版が変わった時のみ描き直す（ミッション切替・X 破壊）
    if (world.stageVersion !== this.lastStageVersion) {
      this.drawStage();
      this.lastStageVersion = world.stageVersion;
    }

    this.dynGfx.clear();

    // 地雷（本体＋点滅ランプ。起爆が近いことは点滅で伝える。
    // 形は共通で、プレイヤー設置＝従来色／敵（マインレイヤー）設置＝琥珀ランプの配色差で識別）
    for (const m of world.mines) {
      const isPlayerMine = (world.players as readonly object[]).includes(m.owner);
      this.dynGfx.fillStyle(isPlayerMine ? COLORS.MINE : COLORS.ENEMY_MINE, 1);
      this.dynGfx.fillCircle(m.x, m.y, BALANCE.MINE.RADIUS);
      const blinkOn = Math.floor(m.fuse * BALANCE.FX.MINE_BLINK_HZ * 2) % 2 === 0;
      if (blinkOn) {
        this.dynGfx.fillStyle(isPlayerMine ? COLORS.MINE_LAMP : COLORS.ENEMY_MINE_LAMP, 1);
        this.dynGfx.fillCircle(m.x, m.y, BALANCE.MINE.RADIUS / 2);
      }
    }

    // 戦車（セントリー＝橙／ローバー＝赤／スナイパー＝紫／マインレイヤー＝黄／1P＝青／2P＝緑。退場者は描かない）
    for (const e of world.enemies) {
      if (!e.alive) continue;
      switch (e.kind) {
        case "sentry":
          this.drawTank(e, COLORS.ENEMY_BODY, COLORS.ENEMY_TRACK, COLORS.ENEMY_TURRET);
          break;
        case "rover":
          this.drawTank(e, COLORS.ROVER_BODY, COLORS.ROVER_TRACK, COLORS.ROVER_TURRET);
          break;
        case "sniper":
          this.drawTank(e, COLORS.SNIPER_BODY, COLORS.SNIPER_TRACK, COLORS.SNIPER_TURRET);
          break;
        case "minelayer":
          this.drawTank(e, COLORS.MINELAYER_BODY, COLORS.MINELAYER_TRACK, COLORS.MINELAYER_TURRET);
          break;
      }
    }
    for (const p of world.players) {
      if (!p.alive) continue;
      if (p.index === 0) {
        this.drawTank(p, COLORS.PLAYER_BODY, COLORS.PLAYER_TRACK, COLORS.PLAYER_TURRET);
      } else {
        this.drawTank(p, COLORS.P2_BODY, COLORS.P2_TRACK, COLORS.P2_TURRET);
      }
    }

    // 弾
    for (const b of world.bullets) {
      this.dynGfx.fillStyle(COLORS.BULLET, 1);
      this.dynGfx.fillCircle(b.x, b.y, b.radius);
      this.dynGfx.lineStyle(1, COLORS.BULLET_EDGE, 1);
      this.dynGfx.strokeCircle(b.x, b.y, b.radius);
    }

    // 爆発フラッシュ（地雷半径→爆風半径へ拡大しながらフェードアウト）
    for (const fx of this.explosionsFx) {
      const k = fx.age / BALANCE.FX.EXPLOSION_TIME; // 0→1
      const radius = BALANCE.MINE.RADIUS + (BALANCE.MINE.BLAST_RADIUS - BALANCE.MINE.RADIUS) * k;
      this.dynGfx.fillStyle(COLORS.EXPLOSION, 1 - k);
      this.dynGfx.fillCircle(fx.x, fx.y, radius);
    }

    // HUD（ミッション番号・残機・撃破数。2P 時は P1/P2 の生存状態も表示。GDD §8・§12.5）
    let left = `MISSION ${world.missionIndex + 1}/${world.missions.length}　残機: ${world.lives}`;
    if (this.playerCount === 2) {
      const stateOf = (i: number): string => (world.players[i]?.alive ? "生存" : "退場");
      left += `　P1: ${stateOf(0)}　P2: ${stateOf(1)}`;
    }
    this.hudLeft.setText(left);
    this.hudRight.setText(`撃破: ${world.kills}　敵: ${world.enemiesLeft()}${SFX.muted ? "　[消音]" : ""}`);

    // オーバーレイ
    let title = "";
    let sub = "";
    if (this.paused) {
      title = "PAUSED";
      sub = "Esc / P で再開";
    } else if (world.status === "banner") {
      title = `MISSION ${world.missionIndex + 1}`;
      sub = world.missions[world.missionIndex]!.name;
    } else if (world.status === "gameover") {
      title = "GAME OVER";
      sub = "R またはクリックで M1 から再スタート";
    } else if (world.status === "allclear") {
      title = "ALL CLEAR!";
      sub = `全ミッション制覇！ 撃破: ${world.kills}　R またはクリックでタイトルへ`;
    }
    const showOverlay = title !== "";
    this.overlayGfx.setVisible(showOverlay);
    this.overlayTitle.setVisible(showOverlay).setText(title);
    this.overlaySub.setVisible(showOverlay).setText(sub);

    // 十字カーソル（1P マウス照準。オーバーレイより前面）
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
