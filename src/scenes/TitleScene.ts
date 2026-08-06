/**
 * タイトルシーン — タイトル・操作説明を表示し、クリックでゲーム開始。
 * 描画はすべてコード描画（外部アセット禁止・オリジナル配色）。
 */
import Phaser from "phaser";
import { SFX } from "../audio/sfx";
import { BALANCE, COLORS } from "../config/balance";

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

    // 装飾：プレイヤー戦車風のシンボル（矩形＋円のコード描画）
    const deco = this.add.graphics();
    const cx = w / 2;
    const cy = h / 2 - 130;
    deco.fillStyle(COLORS.PLAYER_TRACK, 1);
    deco.fillRect(cx - 28, cy - 28, 56, 14);
    deco.fillRect(cx - 28, cy + 14, 56, 14);
    deco.fillStyle(COLORS.PLAYER_BODY, 1);
    deco.fillRect(cx - 28, cy - 14, 56, 28);
    deco.fillStyle(COLORS.PLAYER_TURRET, 1);
    deco.fillRect(cx - 6, cy - 60, 12, 46);
    deco.fillCircle(cx, cy, 18);
    deco.fillStyle(COLORS.PLAYER_BODY, 1);
    deco.fillCircle(cx, cy, 10);

    const textStyle = { fontFamily: "sans-serif", color: COLORS.HUD_CSS };

    this.add
      .text(w / 2, h / 2 - 30, "BLOCK TANKS（仮）", {
        ...textStyle,
        fontSize: "48px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(w / 2, h / 2 + 16, "壁に弾を反射させて敵戦車を撃ち抜け", {
        ...textStyle,
        fontSize: "16px",
      })
      .setOrigin(0.5);

    this.add
      .text(
        w / 2,
        h / 2 + 78,
        "WASD: 移動 ／ マウス: 照準 ／ 左クリック: 射撃\nスペース・右クリック: 地雷 ／ Esc・P: ポーズ ／ R: リスタート ／ M: 消音",
        { ...textStyle, fontSize: "15px", align: "center", lineSpacing: 8 },
      )
      .setOrigin(0.5);

    const prompt = this.add
      .text(w / 2, h / 2 + 150, "クリックで開始", {
        ...textStyle,
        fontSize: "20px",
        fontStyle: "bold",
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

    this.input.once("pointerdown", () => {
      SFX.unlock(); // AudioContext はユーザー操作後に初期化（自動再生制限対策）
      this.scene.start("GameScene");
    });
  }
}
