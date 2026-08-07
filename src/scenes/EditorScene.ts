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
import { safeLocalStorageStore } from "../core/records";

/** パレットの表示ラベル（タイル記号と同順） */
const TILE_LABELS: Record<EditorTile, string> = {
  ".": "床",
  "#": "壁",
  X: "X壁",
  H: "穴",
  P: "自機",
  A: "敵A",
  B: "敵B",
  C: "敵C",
  D: "敵D",
  E: "敵E",
  F: "敵F",
  G: "敵G",
};

/** タイルの塗り色（盤面・パレット共通。戦車系は本体色で示す） */
const TILE_COLORS: Record<EditorTile, number> = {
  ".": COLORS.FLOOR,
  "#": COLORS.WALL,
  X: COLORS.WALL_X,
  H: COLORS.HOLE,
  P: COLORS.PLAYER_BODY,
  A: COLORS.ENEMY_BODY,
  B: COLORS.ROVER_BODY,
  C: COLORS.SNIPER_BODY,
  D: COLORS.MINELAYER_BODY,
  E: COLORS.REFLECTOR_BODY,
  F: COLORS.CHASER_BODY,
  G: COLORS.PRISM_BODY,
};

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
    this.input.on("pointermove", paint);

    // --- 上バー：タイルパレット（外周 row0 に重ねる） ---
    const barStyle = { fontFamily: "sans-serif", fontSize: "13px", color: COLORS.HUD_CSS };
    const topBar = this.add.graphics().setDepth(5);
    topBar.fillStyle(0x11141c, 0.92);
    topBar.fillRect(0, 0, w, BALANCE.TILE);
    this.paletteMarks = [];
    EDITOR_TILES.forEach((tile, i) => {
      const x = 10 + i * 62;
      const mark = this.add
        .rectangle(x + 26, 16, 56, 26, 0x000000, 0)
        .setStrokeStyle(2, 0xffffff, 0)
        .setDepth(7);
      this.paletteMarks.push(mark);
      this.add.rectangle(x + 10, 16, 18, 18, TILE_COLORS[tile]).setDepth(6);
      this.add
        .text(x + 22, 16, TILE_LABELS[tile], barStyle)
        .setOrigin(0, 0.5)
        .setDepth(6);
      this.add
        .rectangle(x + 26, 16, 60, 30, 0x000000, 0.001) // クリック領域
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
    const buttons: [string, () => void][] = [
      ["▶1P", () => this.startTestPlay(1)],
      ["▶2P", () => this.startTestPlay(2)],
    ];
    for (let n = 1; n <= EDITOR_SLOT_COUNT; n++) buttons.push([`保${n}`, () => this.saveSlot(n)]);
    for (let n = 1; n <= EDITOR_SLOT_COUNT; n++) buttons.push([`読${n}`, () => this.loadSlot(n)]);
    buttons.push(
      ["出力", () => this.doExport()],
      ["入力", () => this.doImport()],
      ["消去", () => this.doClear()],
      ["戻る", () => this.scene.start("TitleScene")],
    );
    const bw = w / buttons.length;
    buttons.forEach(([label, onClick], i) => {
      this.add
        .text(bw * i + bw / 2, h - 16, label, {
          ...barStyle,
          backgroundColor: "#343b4d",
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(6)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", (p: Phaser.Input.Pointer) => {
          p.event.stopPropagation(); // 盤面塗りに伝播させない
          SFX.unlock();
          onClick();
        });
    });

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
    this.grid = emptyGrid();
    editorSession.grid = this.grid;
    this.redrawBoard();
    this.showToast("全て消去しました");
  }
}
