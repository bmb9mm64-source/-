/**
 * ステージエディタシーン（GDD §12.7）。
 * ロジック（編集・検証・保存・共有）はすべて src/core/editor.ts にあり、
 * ここはグリッド描画とマウス/ボタンUIだけの薄い層（CLAUDE.md 規約）。
 * - 盤面：クリック/ドラッグで選択中タイルを塗る。右クリック/右ドラッグで床に戻す。
 *   パレットは `.`床／`#`壁／`X`破壊可能壁／`H`穴／`P`自機／`A`〜`F`敵6種（GDD §7 v0.9）。
 * - 上バー（外周 row0 の上）：タイルパレット。下バー（外周 row16 の上）：操作ボタン。
 *   どちらも外周タイル（編集不可）に重ねるため、編集領域は隠れない。
 * - 書き出し/読み込みは prompt()（コピペ共有。GDD §12.7）。
 */
import Phaser from "phaser";
import { SFX } from "../audio/sfx";
import { BALANCE, COLORS } from "../config/balance";
import {
  EDITOR_SLOT_COUNT,
  EDITOR_TILES,
  EditorSlots,
  type EditorTile,
  editorSession,
  emptyGrid,
  exportStage,
  gridToLines,
  importStage,
  setTile,
  validateStage,
} from "../core/editor";
import type { EnemyChar } from "../core/enemyKinds";
import { ENEMY_DEF_BY_CHAR } from "../core/enemyRegistry";
import { safeLocalStorageStore } from "../core/records";
import { bindSceneAudio } from "./sceneAudio";

/** 非敵タイルの表示ラベル（敵は記号から「敵A」…を機械的に作る） */
const BASE_LABELS: Record<string, string> = {
  ".": "床",
  "#": "壁",
  X: "X壁",
  H: "穴",
  P: "自機",
};

/** 非敵タイルの塗り色（敵は enemyRegistry の本体色をそのまま使う） */
const BASE_COLORS: Record<string, number> = {
  ".": COLORS.FLOOR,
  "#": COLORS.WALL,
  X: COLORS.WALL_X,
  H: COLORS.HOLE,
  P: COLORS.PLAYER_BODY,
};

/** パレットの表示ラベル（タイル記号と同順） */
const TILE_LABELS = Object.fromEntries(
  EDITOR_TILES.map((t) => [t, BASE_LABELS[t] ?? `敵${t}`]),
) as Record<EditorTile, string>;

/** タイルの塗り色（盤面・パレット共通。戦車系は本体色で示す） */
const TILE_COLORS = Object.fromEntries(
  EDITOR_TILES.map((t) => [t, BASE_COLORS[t] ?? ENEMY_DEF_BY_CHAR[t as EnemyChar].colors.body]),
) as Record<EditorTile, number>;

export class EditorScene extends Phaser.Scene {
  private grid: string[][] = [];
  private selected: EditorTile = "#";
  private boardGfx!: Phaser.GameObjects.Graphics;
  private paletteMarks: Phaser.GameObjects.Rectangle[] = [];
  private toast!: Phaser.GameObjects.Text;
  private toastTimer: Phaser.Time.TimerEvent | null = null;
  private slots = new EditorSlots(safeLocalStorageStore());

  constructor() {
    super({ key: "EditorScene" });
  }

  create(): void {
    const w = BALANCE.TILE * BALANCE.COLS;
    const h = BALANCE.TILE * BALANCE.ROWS;
    this.input.setDefaultCursor("default");
    this.input.mouse?.disableContextMenu(); // 右クリック＝消去に使う

    // 編集中グリッドの復元（テストプレイから戻ったとき）。なければ空盤面
    this.grid = editorSession.grid ?? emptyGrid();
    editorSession.grid = this.grid;
    this.slots = new EditorSlots(safeLocalStorageStore());

    this.boardGfx = this.add.graphics().setDepth(0);
    this.redrawBoard();

    // --- 盤面の塗り（クリック/ドラッグ。左=選択タイル・右=床） ---
    const paint = (pointer: Phaser.Input.Pointer): void => {
      const col = Math.floor(pointer.worldX / BALANCE.TILE);
      const row = Math.floor(pointer.worldY / BALANCE.TILE);
      const ch = pointer.rightButtonDown() ? "." : this.selected;
      if (!pointer.leftButtonDown() && !pointer.rightButtonDown()) return;
      if (setTile(this.grid, col, row, ch)) this.redrawBoard();
    };
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      SFX.unlock();
      paint(p);
    });
    // 音（BGM 開始・M/B のミュート切替）は全シーン共通の結線を使う。エディタは静かな曲（GDD §9）
    bindSceneAudio(this, "editor");
    this.input.on("pointermove", paint);

    // --- 上バー：タイルパレット（外周 row0 に重ねる） ---
    const barStyle = { fontFamily: "sans-serif", fontSize: "13px", color: COLORS.HUD_CSS };
    const topBar = this.add.graphics().setDepth(5);
    topBar.fillStyle(0x11141c, 0.92);
    topBar.fillRect(0, 0, w, BALANCE.TILE);
    this.paletteMarks = [];
    EDITOR_TILES.forEach((tile, i) => {
      const x = 6 + i * 53;
      const mark = this.add
        .rectangle(x + 24, 16, 50, 26, 0x000000, 0)
        .setStrokeStyle(2, 0xffffff, 0)
        .setDepth(7);
      this.paletteMarks.push(mark);
      this.add.rectangle(x + 9, 16, 16, 16, TILE_COLORS[tile]).setDepth(6);
      this.add
        .text(x + 20, 16, TILE_LABELS[tile], { ...barStyle, fontSize: "12px" })
        .setOrigin(0, 0.5)
        .setDepth(6);
      this.add
        .rectangle(x + 24, 16, 52, 30, 0x000000, 0.001) // クリック領域
        .setDepth(8)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => {
          this.selected = tile;
          this.updatePaletteHighlight();
        });
    });
    this.updatePaletteHighlight();

    // --- 下バー：操作ボタン（外周 row16 に重ねる） ---
    const bottomBar = this.add.graphics().setDepth(5);
    bottomBar.fillStyle(0x11141c, 0.92);
    bottomBar.fillRect(0, h - BALANCE.TILE, w, BALANCE.TILE);
    // ラベルは省略形にしない（「保1」では初見で意味が取れない。GDD §12.7 v0.17）
    const buttons: [string, () => void][] = [
      ["▶ 試遊1P", () => this.startTestPlay(1)],
      ["▶ 試遊2P", () => this.startTestPlay(2)],
    ];
    for (let n = 1; n <= EDITOR_SLOT_COUNT; n++) buttons.push([`保存${n}`, () => this.saveSlot(n)]);
    for (let n = 1; n <= EDITOR_SLOT_COUNT; n++) buttons.push([`読込${n}`, () => this.loadSlot(n)]);
    buttons.push(
      ["書出", () => this.doExport()],
      ["取込", () => this.doImport()],
      ["全消去", () => this.doClear()],
      ["タイトル", () => this.scene.start("TitleScene")],
    );
    // ボタンは等分割ではなく**実際の文字幅**で並べる。
    // 等分割だと長いラベルが枠からはみ出して端のボタンが画面外に切れる（v0.17 で発生）。
    const gap = 4;
    const made = buttons.map(([label, onClick]) => {
      const t = this.add
        .text(0, h - 16, label, { ...barStyle, backgroundColor: "#343b4d", padding: { x: 6, y: 4 } })
        .setOrigin(0, 0.5)
        .setDepth(6)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", (p: Phaser.Input.Pointer) => {
          p.event.stopPropagation(); // 盤面塗りに伝播させない
          SFX.unlock();
          onClick();
        });
      return t;
    });
    const totalW = made.reduce((sum, t) => sum + t.width, 0) + gap * (made.length - 1);
    let bx = Math.max(gap, (w - totalW) / 2); // 収まりきらない場合も左端から詰めて全ボタンを残す
    for (const t of made) {
      t.setX(bx);
      bx += t.width + gap;
    }

    // --- トースト（検証結果などの一時表示） ---
    this.toast = this.add
      .text(w / 2, 52, "", {
        ...barStyle,
        fontSize: "14px",
        backgroundColor: "#1d2230",
        padding: { x: 12, y: 6 },
        align: "center",
      })
      .setOrigin(0.5, 0)
      .setDepth(9)
      .setVisible(false);

    this.showToast(
      "クリック/ドラッグで塗る ／ 右クリックで床に戻す ／ 上のパレットでタイル選択",
      4.0,
    );
  }

  /** パレットの選択ハイライトを更新 */
  private updatePaletteHighlight(): void {
    EDITOR_TILES.forEach((tile, i) => {
      this.paletteMarks[i]!.setStrokeStyle(2, 0xffffff, tile === this.selected ? 0.9 : 0);
    });
  }

  /** 盤面を描き直す（タイル＋記号ラベル） */
  private redrawBoard(): void {
    const t = BALANCE.TILE;
    const g = this.boardGfx;
    g.clear();
    for (let r = 0; r < this.grid.length; r++) {
      for (let c = 0; c < this.grid[r]!.length; c++) {
        const ch = this.grid[r]![c]! as EditorTile;
        g.fillStyle(TILE_COLORS[ch] ?? COLORS.FLOOR, 1);
        g.fillRect(c * t, r * t, t, t);
        if (ch === "." || ch === "#") continue;
        // 戦車・特殊タイルは枠で強調（どのマスに何がいるか判別しやすく）
        g.lineStyle(1, 0xffffff, 0.35);
        g.strokeRect(c * t + 2, r * t + 2, t - 4, t - 4);
      }
    }
    // グリッド線（編集の目安）
    g.lineStyle(1, COLORS.FLOOR_GRID, 0.8);
    for (let c = 1; c < BALANCE.COLS; c++) g.lineBetween(c * t, 0, c * t, this.grid.length * t);
    for (let r = 1; r < BALANCE.ROWS; r++) g.lineBetween(0, r * t, BALANCE.COLS * t, r * t);
  }

  /** 一時メッセージを表示する */
  private showToast(message: string, seconds = 3.0): void {
    this.toast.setText(message).setVisible(true);
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(seconds * 1000, () => this.toast.setVisible(false));
  }

  /** テストプレイ開始（検証エラーがあれば開始しない。GDD §12.7） */
  private startTestPlay(playerCount: number): void {
    const v = validateStage(this.grid);
    if (v.errors.length > 0) {
      this.showToast(`開始できません：\n${v.errors.join("\n")}`, 4.0);
      return;
    }
    editorSession.grid = this.grid; // 戻ってきたときのために保持
    this.scene.start("GameScene", {
      playerCount,
      customStage: gridToLines(this.grid),
      returnTo: "editor",
    });
  }

  private saveSlot(n: number): void {
    this.slots.save(n, this.grid);
    this.showToast(`スロット${n}に保存しました`);
  }

  private loadSlot(n: number): void {
    const data = this.slots.load(n);
    if (data === null) {
      this.showToast(`スロット${n}は空です`);
      return;
    }
    this.grid = data.grid;
    editorSession.grid = this.grid;
    this.redrawBoard();
    this.showToast(`スロット${n}を読み込みました`);
  }

  private doExport(): void {
    // prompt に JSON を出してコピーしてもらう（コピペ共有。GDD §12.7）
    window.prompt("このJSONをコピーして共有できます：", exportStage(this.grid));
  }

  private doImport(): void {
    const json = window.prompt("ステージのJSONを貼り付けてください：");
    if (json === null || json.trim() === "") return;
    try {
      const data = importStage(json.trim());
      this.grid = data.grid;
      editorSession.grid = this.grid;
      this.redrawBoard();
      this.showToast("読み込みました");
    } catch (e) {
      this.showToast(`読み込めません：${e instanceof Error ? e.message : String(e)}`, 4.0);
    }
  }

  private doClear(): void {
    // 取り消せない破壊的操作なので確認する（誤クリックで編集内容を失わないため。GDD §12.7 v0.17）
    if (!window.confirm("編集中のステージを全て消去します。よろしいですか？")) return;
    this.grid = emptyGrid();
    editorSession.grid = this.grid;
    this.redrawBoard();
    this.showToast("全て消去しました");
  }
}
