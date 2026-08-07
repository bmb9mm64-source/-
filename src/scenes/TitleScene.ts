/**
 * タイトルシーン — タイトル・操作説明を表示し、「1人で出撃／2人で出撃」を選んでゲーム開始
 * （クリックまたは 1 / 2 キー。GDD §12.5）。
 * 描画はすべてコード描画（外部アセット禁止・オリジナル配色）。
 */
import Phaser from "phaser";
import { SFX } from "../audio/sfx";
import { BALANCE, COLORS } from "../config/balance";
import { formatTime, Records, safeLocalStorageStore } from "../core/records";

export class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: "TitleScene" });
  }

  create(): void {
    const w = BALANCE.TILE * BALANCE.COLS;
    const h = BALANCE.TILE * BALANCE.ROWS;
    this.input.setDefaultCursor("default"); // タイトルでは OS カーソルを表示

    // 背景（床色＋薄いグリッドで盤面の雰囲気を出す）
    const bg = this.add.graphics();
    bg.fillStyle(COLORS.FLOOR, 1);
    bg.fillRect(0, 0, w, h);
    bg.lineStyle(1, COLORS.FLOOR_GRID, 1);
    for (let c = 1; c < BALANCE.COLS; c++) {
      bg.lineBetween(c * BALANCE.TILE + 0.5, 0, c * BALANCE.TILE + 0.5, h);
    }
    for (let r = 1; r < BALANCE.ROWS; r++) {
      bg.lineBetween(0, r * BALANCE.TILE + 0.5, w, r * BALANCE.TILE + 0.5);
    }

    // 装飾：1P（青）と2P（緑）の戦車風シンボルを並べる（矩形＋円のコード描画）
    const deco = this.add.graphics();
    const cy = h / 2 - 148;
    const drawSymbol = (cx: number, body: number, track: number, turret: number): void => {
      deco.fillStyle(track, 1);
      deco.fillRect(cx - 24, cy - 24, 48, 12);
      deco.fillRect(cx - 24, cy + 12, 48, 12);
      deco.fillStyle(body, 1);
      deco.fillRect(cx - 24, cy - 12, 48, 24);
      deco.fillStyle(turret, 1);
      deco.fillRect(cx - 5, cy - 52, 10, 40);
      deco.fillCircle(cx, cy, 15);
      deco.fillStyle(body, 1);
      deco.fillCircle(cx, cy, 8);
    };
    drawSymbol(w / 2 - 46, COLORS.PLAYER_BODY, COLORS.PLAYER_TRACK, COLORS.PLAYER_TURRET);
    drawSymbol(w / 2 + 46, COLORS.P2_BODY, COLORS.P2_TRACK, COLORS.P2_TURRET);

    const textStyle = { fontFamily: "sans-serif", color: COLORS.HUD_CSS };

    this.add
      .text(w / 2, h / 2 - 56, "ハネダン！", {
        ...textStyle,
        fontSize: "44px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(w / 2, h / 2 - 16, "壁に弾を反射させて敵戦車を撃ち抜け", {
        ...textStyle,
        fontSize: "15px",
      })
      .setOrigin(0.5);

    // 操作説明（1P／2P。GDD §3・§12.5）
    this.add
      .text(
        w / 2,
        h / 2 + 44,
        "【1P】WASD: 移動 ／ マウス: 照準 ／ 左クリック: 射撃 ／ スペース・右クリック: 地雷\n" +
          "【2P】パッド: 左スティック移動・右スティック照準・RB射撃・LB地雷\n" +
          "　　　（パッド未接続時: 矢印キー移動・IJKL照準・Enter射撃・右Shift地雷）\n" +
          "共通: Esc・P: ポーズ ／ R: リスタート ／ M: 消音",
        { ...textStyle, fontSize: "14px", align: "center", lineSpacing: 6 },
      )
      .setOrigin(0.5);

    // モード選択（クリックまたは 1 / 2 キー）
    const start = (playerCount: number): void => {
      SFX.unlock(); // AudioContext はユーザー操作後に初期化（自動再生制限対策）
      this.scene.start("GameScene", { playerCount });
    };
    const buttonStyle = {
      ...textStyle,
      fontSize: "22px",
      fontStyle: "bold",
      backgroundColor: "#343b4d",
      padding: { x: 18, y: 8 },
    };
    this.add
      .text(w / 2 - 130, h / 2 + 140, "[1] 1人で出撃", buttonStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => start(1));
    this.add
      .text(w / 2 + 130, h / 2 + 140, "[2] 2人で出撃", buttonStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => start(2));

    const kb = this.input.keyboard;
    kb?.on("keydown-ONE", () => start(1));
    kb?.on("keydown-TWO", () => start(2));

    const prompt = this.add
      .text(w / 2, h / 2 + 196, "クリックまたは 1 / 2 キーで選択", {
        ...textStyle,
        fontSize: "15px",
      })
      .setOrigin(0.5);

    // 点滅演出（トゥイーン＝値の自動補間アニメーション）
    this.tweens.add({
      targets: prompt,
      alpha: 0.25,
      duration: 700,
      yoyo: true,
      repeat: -1,
    });

    // 通しトータルベスト（記録があれば小さく表示。localStorage 読み出し。GDD §8.5）
    const totalBest = new Records(safeLocalStorageStore()).totalBest();
    if (totalBest !== null) {
      this.add
        .text(w / 2, h - 22, `通しベスト: ${formatTime(totalBest)}s（全ミッション合計）`, {
          fontFamily: "sans-serif",
          fontSize: "13px",
          color: COLORS.RECORD_CSS,
        })
        .setOrigin(0.5);
    }
  }
}
