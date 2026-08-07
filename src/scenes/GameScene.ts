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
import { BGM } from "../audio/bgm";
import { SFX } from "../audio/sfx";
import { BALANCE, COLORS } from "../config/balance";
import { type Difficulty, DIFFICULTY_LABELS, loadDifficulty } from "../core/difficulty";
import { eightWayAngle, type PlayerInput } from "../core/input";
import { formatTime, Records, safeLocalStorageStore } from "../core/records";
import type { TankBody } from "../core/types";
import { GameWorld } from "../core/world";
import { GamepadPoller } from "../input/gamepad";
import {
  mineButtonRect,
  pauseButtonRect,
  TouchController,
  type TouchPointInput,
  type TouchResolved,
} from "../core/touch";
import { ALL_MISSIONS } from "../stages/allMissions";

/** タイム表示用の等幅フォント（tabular＝桁幅が揃う描画にして桁ブレを防ぐ） */
const MONO_FONT = '"Consolas", "Menlo", "Courier New", monospace';

/** 爆発フラッシュ演出（見た目のみ。fromRadius→toRadius へ拡大しながらフェードアウト） */
interface ExplosionFx {
  x: number;
  y: number;
  age: number; // 経過時間 [s]
  fromRadius: number; // 開始半径 [px]
  toRadius: number; // 最終半径 [px]（地雷＝爆風半径／戦車撃破＝一回り小さい）
}

/** 撃破破片パーティクル（コード描画の矩形破片。見た目のみ。GDD §8.5） */
interface Particle {
  x: number;
  y: number;
  vx: number; // 速度 [px/s]
  vy: number;
  age: number; // 経過時間 [s]
  size: number; // 辺長 [px]
  color: number;
}

/** ミッションクリア演出の表示状態（GDD §8.5：タイム＋ベスト更新なら NEW RECORD!） */
interface ClearFx {
  time: number; // 確定クリアタイム [s]
  newRecord: boolean;
  timer: number; // 残り表示時間 [s]
}

export class GameScene extends Phaser.Scene {
  private world!: GameWorld;
  private playerCount = 1; // TitleScene から渡されるモード（1 or 2）
  private difficulty: Difficulty = "normal"; // 選択中の難易度（localStorage から復元。GDD §8.3）
  private customPlay = false; // エディタからのテストプレイ（記録対象外・終了後はエディタへ。GDD §12.7）
  private paused = false; // ポーズはシーン側の責務（ポーズ中は world.update を呼ばない）
  private fireRequested = false; // 1P：1クリック1発の発射要求フラグ
  private fireBuffer1 = 0; // 1P：射撃の先行入力バッファ残り時間 [s]（GDD §3 v0.10）
  private fireBuffer2 = 0; // 2P：同上（キーボード/パッド共通）
  private touch = new TouchController(); // タッチ操作（GDD §3.5 v0.11）
  private touchMode = false; // タッチ入力を検知したら true（以後、仮想コントロールを表示）
  private touchGfx!: Phaser.GameObjects.Graphics; // 仮想スティック・ボタンの描画
  private lastTouch: TouchResolved | null = null; // 直近フレームのタッチ解決結果（描画用）
  private mineRequested = false; // 1P：1押下1設置の地雷要求フラグ
  private fire2Requested = false; // 2P（キーボード Enter）
  private mine2Requested = false; // 2P（キーボード 右Shift）
  private gamepad = new GamepadPoller(); // 2P パッド（毎フレーム接続確認）
  private explosionsFx: ExplosionFx[] = [];
  private particles: Particle[] = []; // 撃破破片パーティクル（GDD §8.5）
  private lastStageVersion = -1; // 盤面描画キャッシュの版（X 破壊・ミッション切替で再描画）
  private records = new Records(safeLocalStorageStore()); // ベスト記録（localStorage。GDD §8.5）
  private newRecordMissions = new Set<number>(); // このランでベスト更新したミッション番号（1始まり。全クリア一覧の ★NEW! 表示用）
  private clearFx: ClearFx | null = null; // ミッションクリア演出（バナー中に CLEAR! を表示）
  private allClearText = ""; // 全クリア画面のタイム一覧（allClear イベント時に構築）

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
  private hudTime!: Phaser.GameObjects.Text; // 現ミッションの経過タイム（GDD §8.5）
  private overlayGfx!: Phaser.GameObjects.Graphics;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlaySub!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "GameScene" });
  }

  create(
    data: {
      playerCount?: number;
      customStage?: string[];
      returnTo?: "editor";
      startMission?: number; // 「続きから」で開始するミッション番号（1始まり。GDD §8.6）
    } = {},
  ): void {
    const w = BALANCE.TILE * BALANCE.COLS;
    const h = BALANCE.TILE * BALANCE.ROWS;

    this.playerCount = data.playerCount === 2 ? 2 : 1;
    // エディタからのテストプレイ（GDD §12.7）：カスタム1ミッション構成・ベスト記録は対象外
    this.customPlay = data.returnTo === "editor" && Array.isArray(data.customStage);
    const missions = this.customPlay
      ? [{ name: "カスタムステージ", grid: data.customStage! }]
      : ALL_MISSIONS;
    // 選択中の難易度でワールドを生成（エディタのテストプレイにも適用。GDD §8.3）
    this.difficulty = loadDifficulty(safeLocalStorageStore());
    this.world = new GameWorld(missions, Math.random, this.playerCount, this.difficulty);
    // デバッグ・プレイテスト用：URL の ?m=N（1始まり）で任意ミッションから開始できる（本編のみ）
    const mParam = Number(new URLSearchParams(window.location.search).get("m"));
    const start = Number.isInteger(data.startMission) ? data.startMission! : mParam;
    if (!this.customPlay && Number.isInteger(start) && start >= 1 && start <= ALL_MISSIONS.length) {
      this.world.loadMission(start - 1);
    }
    this.paused = false;
    this.fireRequested = false;
    this.mineRequested = false;
    this.fire2Requested = false;
    this.mine2Requested = false;
    this.fireBuffer1 = 0;
    this.fireBuffer2 = 0;
    this.gamepad = new GamepadPoller();
    this.touch.reset();
    this.touchMode = false;
    this.lastTouch = null;
    // マルチタッチ（移動＋照準＋ボタン）。addPointer はグローバルな InputManager に積まれ
    // シーン終了で戻らないため、必要数に足りないときだけ足す（再入場のたびに増やさない）
    if (this.input.manager.pointersTotal < BALANCE.TOUCH.MAX_POINTERS) {
      this.input.addPointer(BALANCE.TOUCH.MAX_POINTERS - this.input.manager.pointersTotal);
    }
    BGM.play("game"); // AudioContext 未初期化なら無音（後述の unlock 時に鳴り始める）
    this.explosionsFx = [];
    this.particles = [];
    this.lastStageVersion = -1;
    this.records = new Records(safeLocalStorageStore(), this.difficulty); // ベスト記録は難易度別（GDD §8.3）
    this.newRecordMissions = new Set();
    this.clearFx = null;
    this.allClearText = "";

    this.input.setDefaultCursor("none"); // 自前の十字カーソルを描くため OS カーソルは隠す
    this.input.mouse?.disableContextMenu(); // 右クリック＝地雷設置のためコンテキストメニューを抑止

    // --- 盤面レイヤー（版が変わった時のみ描き直す） ---
    this.stageGfx = this.add.graphics().setDepth(0);

    // --- 動的レイヤー ---
    this.dynGfx = this.add.graphics().setDepth(1);
    this.crosshairGfx = this.add.graphics().setDepth(20);
    this.touchGfx = this.add.graphics().setDepth(15); // 仮想コントロール（HUD より下・十字より下）

    // --- HUD（ミッション番号・残機・撃破数＋2P 時は P1/P2 の生存状態。GDD §8・§12.5） ---
    const hudStyle = {
      fontFamily: "sans-serif",
      fontSize: "15px",
      fontStyle: "bold",
      color: COLORS.HUD_CSS,
    };
    this.hudLeft = this.add.text(10, 16, "", hudStyle).setOrigin(0, 0.5).setDepth(5);
    this.hudRight = this.add.text(w - 10, 16, "", hudStyle).setOrigin(1, 0.5).setDepth(5);
    // 経過タイム（0.1秒単位。等幅フォント＝tabular 描画で桁ブレを防ぐ。GDD §8.5）
    this.hudTime = this.add
      .text(w / 2, 16, "", { ...hudStyle, fontFamily: MONO_FONT })
      .setOrigin(0.5, 0.5)
      .setDepth(5);

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
    // キーの「1押下1回」を保証するヘルパ。
    // Phaser は Key 登録していないキーのオートリピートを抑制しないため、
    // 押しっぱなしで地雷が連続設置される／ポーズが高速トグルする等が起きる。
    // ネイティブの KeyboardEvent.repeat を見て弾く。
    const onKeyPress = (name: string, fn: (event: KeyboardEvent) => void): void => {
      kb.on(`keydown-${name}`, (event: KeyboardEvent) => {
        if (event.repeat) return;
        fn(event);
      });
    };

    // ポーズ切り替え（Esc / P）：プレイ中のみ有効
    const togglePause = (): void => {
      if (this.world.status === "playing") this.paused = !this.paused;
    };
    onKeyPress("ESC", togglePause);
    onKeyPress("P", togglePause);
    // R：全クリア画面ではタイトルへ、それ以外はゲーム全体をリスタート（M1・残機3）。
    // テストプレイ中はクリア/ゲームオーバーからエディタへ戻る（GDD §12.7）
    onKeyPress("R", () => {
      SFX.unlock();
      if (this.customPlay && (this.world.status === "allclear" || this.world.status === "gameover")) {
        this.scene.start("EditorScene");
        return;
      }
      if (this.world.status === "allclear") {
        this.scene.start("TitleScene");
        return;
      }
      this.world.resetGame();
      this.paused = false;
      this.newRecordMissions.clear(); // ランのやり直し＝NEW 表示もリセット
      this.clearFx = null;
    });
    // スペース：1P 地雷設置（1押下1設置）
    onKeyPress("SPACE", () => {
      SFX.unlock();
      this.mineRequested = true;
    });
    // Enter：2P 射撃（1押下1発。2人プレイ時のみ）
    onKeyPress("ENTER", () => {
      if (this.playerCount !== 2) return;
      SFX.unlock();
      this.fire2Requested = true;
    });
    // 右Shift：2P 地雷設置（location===2 が右側の Shift。2人プレイ時のみ）
    onKeyPress("SHIFT", (event: KeyboardEvent) => {
      if (this.playerCount !== 2 || event.location !== 2) return;
      SFX.unlock();
      this.mine2Requested = true;
    });
    // M：効果音とBGMのミュート切替（共通。GDD §9 v0.11）
    onKeyPress("M", () => {
      SFX.unlock();
      const muted = SFX.toggleMute();
      BGM.setMuted(muted);
      if (!muted) BGM.play("game");
    });
    // B：BGM だけのミュート切替（GDD §9 v0.11）
    onKeyPress("B", () => {
      SFX.unlock();
      if (!BGM.toggleMute()) BGM.play("game");
    });
    // 最初のユーザー操作で音を初期化して BGM を鳴らし始める（ブラウザの自動再生制限対策）
    const startAudio = (): void => {
      SFX.unlock();
      BGM.play("game");
    };
    kb.on("keydown", startAudio);
    this.input.on("pointerdown", startAudio);

    // クリック：1P 射撃（左）／地雷（右）。終了画面では再開操作
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      SFX.unlock(); // 自動再生制限の解除（ユーザー操作後の初期化）
      if (this.customPlay && (this.world.status === "allclear" || this.world.status === "gameover")) {
        this.scene.start("EditorScene"); // テストプレイ終了 → エディタへ戻る（GDD §12.7）
        return;
      }
      if (this.world.status === "gameover") {
        this.world.resetGame(); // クリックで M1 から再スタート（残機3）
        this.paused = false;
        this.newRecordMissions.clear(); // ランのやり直し＝NEW 表示もリセット
        this.clearFx = null;
        return;
      }
      if (this.world.status === "allclear") {
        this.scene.start("TitleScene");
        return;
      }
      // タッチは TouchController が扱う（仮想スティック・ボタンと二重に反応させない）
      if (pointer.wasTouch) {
        this.touchMode = true;
        return;
      }
      if (pointer.button === 0) {
        this.fireRequested = true;
        this.fireBuffer1 = BALANCE.PLAYER.FIRE_BUFFER; // クールダウン中でも短時間予約（先行入力。GDD §3 v0.10）
      } else if (pointer.button === 2) this.mineRequested = true;
    });
  }

  /**
   * タッチ入力を解決する（GDD §3.5 v0.11）。
   * タッチを未検知（PC）なら null を返し、従来の操作・描画に一切影響しない。
   * 座標は pointer.x/y（ゲーム内座標）を使う：カメラ揺れの影響を受けず、Scale.FIT の拡大も加味済み。
   */
  private resolveTouch(): TouchResolved | null {
    const points: TouchPointInput[] = [];
    for (const p of this.input.manager.pointers) {
      if (!p.isDown || !p.wasTouch) continue;
      this.touchMode = true;
      points.push({ id: p.id, x: p.x, y: p.y, startX: p.downX, startY: p.downY });
    }
    if (!this.touchMode) return null;
    const w = BALANCE.TILE * BALANCE.COLS;
    const h = BALANCE.TILE * BALANCE.ROWS;
    this.lastTouch = this.touch.resolve(points, w, h);
    return this.lastTouch;
  }

  /** 仮想コントロール（スティック・地雷ボタン・ポーズボタン）を描く。タッチ検知時のみ */
  private drawTouchUi(): void {
    const g = this.touchGfx;
    g.clear();
    if (!this.touchMode) return;
    const c = BALANCE.TOUCH;
    const w = BALANCE.TILE * BALANCE.COLS;
    const h = BALANCE.TILE * BALANCE.ROWS;

    // 地雷・ポーズボタン（常時表示。押しやすさのため大きめ）
    const mine = mineButtonRect(w, h);
    g.fillStyle(COLORS.MINE, c.UI_ALPHA);
    g.fillRoundedRect(mine.x, mine.y, mine.w, mine.h, 12);
    g.lineStyle(2, COLORS.MINE_LAMP, c.UI_ALPHA + 0.25);
    g.strokeRoundedRect(mine.x, mine.y, mine.w, mine.h, 12);
    g.fillStyle(COLORS.MINE_LAMP, c.UI_ALPHA + 0.3);
    g.fillCircle(mine.x + mine.w / 2, mine.y + mine.h / 2, 13);

    const pause = pauseButtonRect(w, h);
    g.fillStyle(COLORS.WALL, c.UI_ALPHA);
    g.fillRoundedRect(pause.x, pause.y, pause.w, pause.h, 8);
    g.fillStyle(COLORS.CROSSHAIR, c.UI_ALPHA + 0.3);
    g.fillRect(pause.x + pause.w * 0.32, pause.y + pause.h * 0.28, 5, pause.h * 0.44);
    g.fillRect(pause.x + pause.w * 0.55, pause.y + pause.h * 0.28, 5, pause.h * 0.44);

    // 仮想スティック（指を置いている間だけ、その位置に出す）
    const stick = this.lastTouch?.stick;
    if (stick) {
      g.lineStyle(2, COLORS.CROSSHAIR, c.UI_ALPHA);
      g.strokeCircle(stick.baseX, stick.baseY, c.STICK_MAX_RADIUS);
      g.fillStyle(COLORS.PLAYER_TURRET, c.UI_ALPHA + 0.2);
      g.fillCircle(stick.tipX, stick.tipY, 22);
    }
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

    // タッチ操作の解決（GDD §3.5）。仮想スティック・照準・ボタンをキーボード入力に上書き合成する
    const touch = this.resolveTouch();
    if (touch?.pausePressed && this.world.status === "playing") this.paused = !this.paused;

    if (!this.paused) {
      const keyX = (this.keys.d.isDown ? 1 : 0) - (this.keys.a.isDown ? 1 : 0);
      const keyY = (this.keys.s.isDown ? 1 : 0) - (this.keys.w.isDown ? 1 : 0);
      const input1: PlayerInput = {
        moveX: touch && (touch.moveX !== 0 || touch.moveY !== 0) ? touch.moveX : keyX,
        moveY: touch && (touch.moveX !== 0 || touch.moveY !== 0) ? touch.moveY : keyY,
        aim: touch?.aim
          ? { mode: "cursor", x: touch.aim.x, y: touch.aim.y }
          : { mode: "cursor", x: pointer.x, y: pointer.y }, // 揺れの影響を受けない画面座標
        fire: this.fireRequested || this.fireBuffer1 > 0 || (touch?.fire ?? false), // 先行入力バッファ（GDD §3 v0.10）
        placeMine: this.mineRequested || (touch?.minePressed ?? false),
      };
      const inputs: PlayerInput[] = [input1];
      if (this.playerCount === 2) {
        const input2 = this.buildP2Input();
        if (input2.fire) this.fireBuffer2 = BALANCE.PLAYER.FIRE_BUFFER; // パッド/キーボード共通で予約
        input2.fire = input2.fire || this.fireBuffer2 > 0;
        inputs.push(input2);
      }
      this.world.update(dt, inputs);
      // 先行入力バッファの消化（FIRE_INTERVAL 未満なので1クリックで2発は出ない）
      this.fireBuffer1 = Math.max(0, this.fireBuffer1 - dt);
      this.fireBuffer2 = Math.max(0, this.fireBuffer2 - dt);

      // ワールドの出来事を効果音・演出・記録更新に変換する
      for (const ev of this.world.events) {
        SFX.play(ev);
        if (ev === "missionClear" || ev === "allClear") this.onMissionCleared(ev === "allClear");
      }
      // 戦車撃破：破片パーティクル＋小フラッシュ（GDD §8.5）
      for (const d of this.world.lastDestroyedTanks) this.spawnDestroyFx(d.x, d.y);
      // 地雷爆発：爆風フラッシュ（地雷半径→爆風半径）
      for (const ex of this.world.lastExplosions) {
        this.explosionsFx.push({
          x: ex.x,
          y: ex.y,
          age: 0,
          fromRadius: BALANCE.MINE.RADIUS,
          toRadius: BALANCE.MINE.BLAST_RADIUS,
        });
      }
      // 画面揺れ：地雷爆発＝一回り大きい（優先・強制上書き）／撃破＝軽い揺れ（GDD §8.5）
      if (this.world.lastExplosions.length > 0) {
        this.cameras.main.shake(
          BALANCE.FX.SHAKE_MINE_DURATION * 1000,
          BALANCE.FX.SHAKE_MINE_INTENSITY,
          true,
        );
      } else if (this.world.lastDestroyedTanks.length > 0) {
        this.cameras.main.shake(
          BALANCE.FX.SHAKE_DESTROY_DURATION * 1000,
          BALANCE.FX.SHAKE_DESTROY_INTENSITY,
          false,
        );
      }
    }
    // 押下エッジ要求は毎フレーム消費（不発・ポーズ中・パッド切替時も持ち越さない）
    this.fireRequested = false;
    this.mineRequested = false;
    this.fire2Requested = false;
    this.mine2Requested = false;

    // 爆発フラッシュ・破片・クリア演出の経過（ポーズ中は進めない）
    if (!this.paused) {
      for (const fx of this.explosionsFx) fx.age += dt;
      this.explosionsFx = this.explosionsFx.filter((fx) => fx.age < BALANCE.FX.EXPLOSION_TIME);
      for (const p of this.particles) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.particles = this.particles.filter((p) => p.age < BALANCE.FX.PARTICLE_LIFE);
      if (this.clearFx) {
        this.clearFx.timer -= dt;
        // 表示時間終了か、バナーを抜けたら消す（残り時間で次の「MISSION n」バナーを見せる）
        if (this.clearFx.timer <= 0 || this.world.status !== "banner") this.clearFx = null;
      }
    }

    this.redraw(pointer);
  }

  /**
   * ミッションクリア時の記録更新と演出準備（GDD §8.5）。
   * ベスト更新判定は records（localStorage）へ提出して行い、
   * 通常クリアは CLEAR! 演出、全クリアはタイム一覧テキストを構築する。
   */
  private onMissionCleared(isAllClear: boolean): void {
    const idx = this.world.lastClearIndex;
    const time = this.world.lastClearTime;
    if (idx === null || time === null) return;
    // テストプレイはベスト記録の対象外（GDD §12.7）
    const newRecord = this.customPlay ? false : this.records.submitMissionTime(idx + 1, time);
    // 到達記録の更新（次のミッションから「続きから」始められるようにする。GDD §8.6）
    if (!this.customPlay) this.records.submitReached(idx + 2);
    if (newRecord) this.newRecordMissions.add(idx + 1);
    if (isAllClear) {
      this.buildAllClearText();
    } else {
      this.clearFx = { time, newRecord, timer: BALANCE.FX.CLEAR_BANNER_TIME };
    }
  }

  /** 全クリア画面のタイム一覧（各ミッション・合計・ベスト比較）を構築する（GDD §8.5） */
  private buildAllClearText(): void {
    const world = this.world;
    if (this.customPlay) {
      // テストプレイ：タイム表示のみ（ベスト比較・記録提出なし。GDD §12.7）
      const t = world.clearedTimes[0];
      this.allClearText = t !== undefined ? `タイム ${formatTime(t)}s（記録対象外）` : "";
      return;
    }
    const lines: string[] = [];
    for (let i = 0; i < world.missions.length; i++) {
      const t = world.clearedTimes[i];
      if (t === undefined) continue; // 途中ミッション開始のデバッグランでは一部欠ける
      const best = this.records.missionBest(i + 1);
      const bestStr = best !== null ? formatTime(best).padStart(6, " ") : "  --.-";
      const mark = this.newRecordMissions.has(i + 1) ? " ★NEW!" : "";
      lines.push(
        `M${String(i + 1).padEnd(2, " ")} ${formatTime(t).padStart(6, " ")}s / ベスト ${bestStr}s${mark}`,
      );
    }
    const total = world.totalTime;
    if (total !== null) {
      // 通しトータルベストは M1 から全ミッションを通したランのみ対象（GDD §8.5）
      const totalNewRecord = this.records.submitTotalTime(total);
      const best = this.records.totalBest();
      const bestStr = best !== null ? formatTime(best).padStart(6, " ") : "  --.-";
      lines.push("");
      lines.push(
        `合計 ${formatTime(total).padStart(6, " ")}s / ベスト ${bestStr}s${totalNewRecord ? " ★NEW!" : ""}`,
      );
    }
    this.allClearText = lines.join("\n");
  }

  /** 戦車撃破の演出：破片パーティクル＋小フラッシュを発生させる（コード描画のみ。GDD §8.5） */
  private spawnDestroyFx(x: number, y: number): void {
    const F = BALANCE.FX;
    this.explosionsFx.push({
      x,
      y,
      age: 0,
      fromRadius: BALANCE.BULLET.RADIUS,
      toRadius: F.DESTROY_FLASH_RADIUS,
    });
    for (let i = 0; i < F.DESTROY_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = F.PARTICLE_SPEED_MIN + Math.random() * (F.PARTICLE_SPEED_MAX - F.PARTICLE_SPEED_MIN);
      const size = F.PARTICLE_SIZE_MIN + Math.random() * (F.PARTICLE_SIZE_MAX - F.PARTICLE_SIZE_MIN);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        size,
        color: COLORS.DEBRIS[Math.floor(Math.random() * COLORS.DEBRIS.length)]!,
      });
    }
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

    // 戦車（セントリー＝橙／ローバー＝赤／スナイパー＝紫／マインレイヤー＝黄／
    // リフレクター＝青緑／チェイサー＝白銀／1P＝青／2P＝緑。退場者は描かない）
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
        case "reflector": // 敵E：青緑（シアン）系（GDD §6 v0.9）
          this.drawTank(e, COLORS.REFLECTOR_BODY, COLORS.REFLECTOR_TRACK, COLORS.REFLECTOR_TURRET);
          break;
        case "prism": // 敵G：マゼンタ（赤紫）系（GDD §6 v0.10）
          this.drawTank(e, COLORS.PRISM_BODY, COLORS.PRISM_TRACK, COLORS.PRISM_TURRET);
          break;
        case "chaser": // 敵F：白銀系（GDD §6 v0.9）
          this.drawTank(e, COLORS.CHASER_BODY, COLORS.CHASER_TRACK, COLORS.CHASER_TURRET);
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

    // 爆発フラッシュ（開始半径→最終半径へ拡大しながらフェードアウト。地雷＝爆風大／撃破＝小）
    for (const fx of this.explosionsFx) {
      const k = fx.age / BALANCE.FX.EXPLOSION_TIME; // 0→1
      const radius = fx.fromRadius + (fx.toRadius - fx.fromRadius) * k;
      this.dynGfx.fillStyle(COLORS.EXPLOSION, 1 - k);
      this.dynGfx.fillCircle(fx.x, fx.y, radius);
    }

    // 撃破破片パーティクル（矩形破片が飛び散りフェードアウト。GDD §8.5）
    for (const p of this.particles) {
      const alpha = 1 - p.age / BALANCE.FX.PARTICLE_LIFE;
      this.dynGfx.fillStyle(p.color, alpha);
      this.dynGfx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }

    // HUD（ミッション番号・難易度・残機・撃破数。2P 時は P1/P2 の生存状態も表示。GDD §8・§8.3・§12.5）
    let left = `MISSION ${world.missionIndex + 1}/${world.missions.length}　[${DIFFICULTY_LABELS[this.difficulty]}]　残機: ${world.lives}`;
    if (this.playerCount === 2) {
      // 中央のタイム表示と重ならないよう短い記号で示す（◆=生存 ✕=退場）
      const stateOf = (i: number): string => (world.players[i]?.alive ? "◆" : "✕");
      left += `　P1${stateOf(0)} P2${stateOf(1)}`;
    }
    this.hudLeft.setText(left);
    this.hudRight.setText(`撃破: ${world.kills}　敵: ${world.enemiesLeft()}${SFX.muted ? "　[消音]" : ""}`);
    // 現ミッションの経過タイム（0.1秒単位。固定幅にそろえて桁ブレを防ぐ。GDD §8.5）
    this.hudTime.setText(`TIME ${formatTime(world.missionTime).padStart(6, " ")}`);

    // オーバーレイ
    const h = BALANCE.TILE * BALANCE.ROWS;
    let title = "";
    let sub = "";
    let subColor: string = COLORS.HUD_CSS;
    if (this.paused) {
      title = "PAUSED";
      sub = "Esc / P で再開";
    } else if (world.status === "banner") {
      if (this.clearFx) {
        // ミッションクリア演出：タイム＋ベスト更新なら NEW RECORD!（GDD §8.5）
        title = "CLEAR!";
        sub = `タイム ${formatTime(this.clearFx.time)}s${this.clearFx.newRecord ? "　NEW RECORD!" : ""}`;
        if (this.clearFx.newRecord) subColor = COLORS.RECORD_CSS;
      } else {
        title = `MISSION ${world.missionIndex + 1}`;
        sub = world.missions[world.missionIndex]!.name;
      }
    } else if (world.status === "gameover") {
      title = "GAME OVER";
      sub = this.customPlay
        ? "R またはクリックでエディタへ戻る"
        : "R またはクリックで M1 から再スタート";
    } else if (world.status === "allclear") {
      title = this.customPlay ? "CLEAR!" : "ALL CLEAR!";
      sub = this.customPlay
        ? `${this.allClearText}\n\nR またはクリックでエディタへ戻る`
        : `全ミッション制覇！ 撃破: ${world.kills}\n\n` +
          `${this.allClearText}\n\n` +
          "R またはクリックでタイトルへ";
    }
    const showOverlay = title !== "";
    // 全クリア画面はタイム一覧が長いため上寄せ・等幅小フォントに切り替える（GDD §8.5）
    const isAllClearScreen = !this.paused && world.status === "allclear";
    if (isAllClearScreen) {
      this.overlayTitle.setY(64);
      this.overlaySub
        .setY(104)
        .setOrigin(0.5, 0)
        .setFontFamily(MONO_FONT)
        .setFontSize(15)
        .setLineSpacing(5);
    } else {
      this.overlayTitle.setY(h / 2 - 18);
      this.overlaySub
        .setY(h / 2 + 26)
        .setOrigin(0.5, 0.5)
        .setFontFamily("sans-serif")
        .setFontSize(16)
        .setLineSpacing(0);
    }
    this.overlayGfx.setVisible(showOverlay);
    this.overlayTitle.setVisible(showOverlay).setText(title);
    this.overlaySub.setVisible(showOverlay).setText(sub).setColor(subColor);

    // 仮想コントロール（タッチ検知時のみ。GDD §3.5）
    this.drawTouchUi();

    // 十字カーソル（照準位置。タッチ中はタッチ点、それ以外はマウス。オーバーレイより前面）
    const gfx = this.crosshairGfx;
    const aim = this.lastTouch?.aim;
    const x = aim ? aim.x : pointer.x;
    const y = aim ? aim.y : pointer.y;
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
