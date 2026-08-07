/**
 * タイトルシーン — タイトル・操作説明・難易度選択を表示し、「1人で出撃／2人で出撃」を選んでゲーム開始
 * （クリックまたは 1 / 2 キー。GDD §8.3・§12.5）。
 * 難易度は EASY / NORMAL / HARD のトグルボタン（選択は localStorage に保存し次回も維持。既定 NORMAL）。
 * 描画はすべてコード描画（外部アセット禁止・オリジナル配色）。
 */
import Phaser from "phaser";
import { BGM } from "../audio/bgm";
import { SFX } from "../audio/sfx";
import { BALANCE, COLORS } from "../config/balance";
import {
  DIFFICULTIES,
  type Difficulty,
  DIFFICULTY_LABELS,
  loadDifficulty,
  saveDifficulty,
} from "../core/difficulty";
import { formatTime, Records, type RecordStore, safeLocalStorageStore } from "../core/records";

export class TitleScene extends Phaser.Scene {
  private store: RecordStore = safeLocalStorageStore();
  private difficulty: Difficulty = "normal";
  private diffButtons = new Map<Difficulty, Phaser.GameObjects.Text>();
  private bestText!: Phaser.GameObjects.Text;

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
      .text(w / 2, h / 2 - 72, "ハネダン！", {
        ...textStyle,
        fontSize: "44px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(w / 2, h / 2 - 34, "壁に弾を反射させて敵戦車を撃ち抜け", {
        ...textStyle,
        fontSize: "15px",
      })
      .setOrigin(0.5);

    // 操作説明（GDD §3・§12.5・§3.5 v0.17）。
    // 全環境ぶんを常に並べると初見の情報量が過大になるため、入力環境で出し分ける。
    // タッチ環境の判定は「細かいポインタが無い＝マウスが無い」＝ CSS の hover/pointer メディア特性。
    const touchOnly =
      typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;
    const help = touchOnly
      ? "画面の左半分をなぞって移動\n右半分をタッチして照準・連射\n右下のボタンで地雷 ／ 右上でポーズ"
      : "【1P】WASD: 移動 ／ マウス: 照準 ／ 左クリック: 射撃 ／ スペース・右クリック: 地雷\n" +
        "【2P】パッド: 左スティック移動・右スティック照準・RB射撃・LB地雷\n" +
        "　　　（パッド未接続時: 矢印キー移動・IJKL照準・Enter射撃・右Shift地雷）\n" +
        "共通: Esc・P: ポーズ ／ T: タイトルへ ／ R: やり直し ／ M: 消音 ／ B: BGM";
    this.add
      .text(w / 2, h / 2 + 28, help, {
        ...textStyle,
        fontSize: "14px",
        align: "center",
        lineSpacing: 6,
      })
      .setOrigin(0.5);

    // 難易度選択（EASY / NORMAL / HARD のトグル。選択は保存して次回も維持。GDD §8.3）
    this.store = safeLocalStorageStore();
    this.difficulty = loadDifficulty(this.store);
    this.add
      .text(w / 2 - 208, h / 2 + 100, "難易度:", { ...textStyle, fontSize: "15px" })
      .setOrigin(0.5);
    this.diffButtons.clear();
    DIFFICULTIES.forEach((d, i) => {
      const btn = this.add
        .text(w / 2 - 110 + i * 110, h / 2 + 100, DIFFICULTY_LABELS[d], {
          ...textStyle,
          fontSize: "15px",
          fontStyle: "bold",
          padding: { x: 12, y: 5 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => {
          SFX.unlock();
          this.selectDifficulty(d);
        });
      this.diffButtons.set(d, btn);
    });

    // 通しトータルベスト（選択中難易度のもの。記録があれば小さく表示。GDD §8.3・§8.5）
    this.bestText = this.add
      .text(w / 2, h - 22, "", {
        fontFamily: "sans-serif",
        fontSize: "13px",
        color: COLORS.RECORD_CSS,
      })
      .setOrigin(0.5);
    this.refreshDifficultyUi();

    // モード選択（クリックまたは 1 / 2 キー）
    // 最初のユーザー操作で音を初期化し、タイトルBGMを鳴らす（自動再生制限対策。GDD §9 v0.11）
    const startAudio = (): void => {
      SFX.unlock();
      BGM.play("title");
    };
    this.input.on("pointerdown", startAudio);
    this.input.keyboard?.on("keydown", startAudio);
    BGM.play("title"); // 既に初期化済み（別シーンから戻ってきた場合）なら即座に切り替わる

    const start = (playerCount: number, startMission?: number): void => {
      SFX.unlock(); // AudioContext はユーザー操作後に初期化（自動再生制限対策）
      this.scene.start("GameScene", { playerCount, startMission });
    };

    // 「続きから」（到達済みの最高ミッションから開始。全50面を毎回1面からやり直さないため。GDD §8.6）
    const reached = new Records(this.store, this.difficulty).reachedBest();
    const hasContinue = reached > 1;
    if (hasContinue) {
      this.add
        .text(w / 2, h / 2 + 178, `${touchOnly ? "" : "[3] "}続きから（M${reached}）`, {
          ...textStyle,
          fontSize: "16px",
          backgroundColor: "#2b3040",
          padding: { x: 12, y: 5 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => start(1, reached));
      this.input.keyboard?.on("keydown-THREE", () => start(1, reached));
    }
    const buttonStyle = {
      ...textStyle,
      fontSize: "22px",
      fontStyle: "bold",
      backgroundColor: "#343b4d",
      padding: { x: 18, y: 8 },
    };
    this.add
      .text(w / 2 - 130, h / 2 + 140, touchOnly ? "1人で出撃" : "[1] 1人で出撃", buttonStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => start(1));
    this.add
      .text(w / 2 + 130, h / 2 + 140, touchOnly ? "2人で出撃" : "[2] 2人で出撃", buttonStyle)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => start(2));

    // ステージエディタへの入口（GDD §12.7）
    this.add
      .text(w / 2, h / 2 + 208, touchOnly ? "ステージエディタ" : "[E] ステージエディタ", {
        ...textStyle,
        fontSize: "15px",
        backgroundColor: "#2b3040",
        padding: { x: 12, y: 5 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => this.scene.start("EditorScene"));

    const kb = this.input.keyboard;
    kb?.on("keydown-ONE", () => start(1));
    kb?.on("keydown-TWO", () => start(2));
    kb?.on("keydown-E", () => this.scene.start("EditorScene"));

    // 実際に押せるキーだけを案内する（「続きから」が無いときに 3 を案内しない。v0.17）
    const keyHint = touchOnly
      ? "ボタンをタップして選択"
      : `クリックまたは ${hasContinue ? "1 / 2 / 3 / E" : "1 / 2 / E"} キーで選択`;
    const prompt = this.add
      .text(w / 2, h / 2 + 236, keyHint, {
        ...textStyle,
        fontSize: "14px",
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
  }

  /** 難易度を選択し、保存して表示を更新する（GDD §8.3） */
  private selectDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    saveDifficulty(this.store, difficulty);
    this.refreshDifficultyUi();
  }

  /** 難易度トグルの強調表示と、選択中難易度の通しベスト表示を更新する */
  private refreshDifficultyUi(): void {
    for (const [d, btn] of this.diffButtons) {
      const selected = d === this.difficulty;
      btn.setBackgroundColor(selected ? "#4c6fd0" : "#2b3040");
      btn.setColor(selected ? "#ffffff" : "#9aa3b5");
    }
    // 通しトータルベストは難易度別（旧キー＝難易度なしは参照しない。GDD §8.3）
    const totalBest = new Records(this.store, this.difficulty).totalBest();
    this.bestText.setText(
      totalBest !== null
        ? `通しベスト（${DIFFICULTY_LABELS[this.difficulty]}）: ${formatTime(totalBest)}s（全ミッション合計）`
        : "",
    );
  }
}
