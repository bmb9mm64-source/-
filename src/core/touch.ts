/**
 * タッチ操作の入力モデル（GDD §3.5 v0.11。Phaser 非依存の純粋 TS）。
 *
 * 画面を左右に分け、指の役割を「触れ始めた位置」で決める：
 *   - 左半分  … 仮想スティック（画面上の疑似スティック）。触れた点が基点、指のずれが移動方向。
 *   - 右半分  … 照準＋射撃。触れている間は連射する（タップ連打は指が疲れるため。GDD §3.5）。
 *   - 右下ボタン … 地雷（1タップ1個。押下の立ち上がりでのみ発火）。
 *   - 右上ボタン … ポーズ切替（同上）。
 * 役割は指を離すまで変わらない（指が画面中央をまたいでも入れ替わらない）。
 */
import { BALANCE } from "../config/balance";

/** 1本の指（Phaser の Pointer から必要な値だけを抜いたもの） */
export interface TouchPointInput {
  id: number;
  x: number; // 現在位置（ゲーム内座標）
  y: number;
  startX: number; // 触れ始めた位置
  startY: number;
}

/** タッチ操作の解決結果（シーンが PlayerInput と描画に変換する） */
export interface TouchResolved {
  moveX: number; // -1〜1
  moveY: number;
  aim: { x: number; y: number } | null; // 照準点（右側に触れている間）
  fire: boolean; // 触れている間は true（連射）
  minePressed: boolean; // このフレームで地雷ボタンが押された
  pausePressed: boolean; // このフレームでポーズボタンが押された
  stick: { baseX: number; baseY: number; tipX: number; tipY: number } | null; // 仮想スティックの描画用
}

/** 指の役割（触れ始めた時に決まり、離すまで固定） */
type TouchRole = "stick" | "aim" | "mine" | "pause";

/** 画面上のボタン矩形（ゲーム内座標） */
export interface ButtonRect {
  x: number; // 左上
  y: number;
  w: number;
  h: number;
}

/** 地雷ボタンの矩形（右下）。盤面サイズから算出する */
export function mineButtonRect(width: number, height: number): ButtonRect {
  const c = BALANCE.TOUCH;
  return {
    x: width - c.BUTTON_SIZE - c.BUTTON_MARGIN,
    y: height - c.BUTTON_SIZE - c.BUTTON_MARGIN,
    w: c.BUTTON_SIZE,
    h: c.BUTTON_SIZE,
  };
}

/** ポーズボタンの矩形（右上。高さは使わないが呼び出し側の対称性のため受け取る） */
export function pauseButtonRect(width: number, _height: number): ButtonRect {
  const c = BALANCE.TOUCH;
  return {
    x: width - c.PAUSE_SIZE - c.BUTTON_MARGIN,
    y: c.BUTTON_MARGIN + c.HUD_HEIGHT,
    w: c.PAUSE_SIZE,
    h: c.PAUSE_SIZE,
  };
}

/** 点が矩形の内側か */
function hits(rect: ButtonRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * タッチ入力の状態。指の役割を id ごとに覚えておき、
 * ボタンは「押下の立ち上がり」だけを1回発火させる。
 */
export class TouchController {
  private roles = new Map<number, TouchRole>();

  /** 触れ始めた位置から役割を決める（すでに割り当て済みの指はそのまま） */
  private roleOf(p: TouchPointInput, width: number, height: number): TouchRole {
    const known = this.roles.get(p.id);
    if (known) return known;
    let role: TouchRole;
    if (hits(mineButtonRect(width, height), p.startX, p.startY)) role = "mine";
    else if (hits(pauseButtonRect(width, height), p.startX, p.startY)) role = "pause";
    else if (p.startX < width / 2) role = "stick";
    else role = "aim";
    this.roles.set(p.id, role);
    return role;
  }

  /**
   * 1フレーム分の解決。points は「今フレームで画面に触れている指」全て。
   * 離された指の役割は自動的に破棄される。
   */
  resolve(points: readonly TouchPointInput[], width: number, height: number): TouchResolved {
    const c = BALANCE.TOUCH;
    const result: TouchResolved = {
      moveX: 0,
      moveY: 0,
      aim: null,
      fire: false,
      minePressed: false,
      pausePressed: false,
      stick: null,
    };

    const seen = new Set<number>();
    for (const p of points) {
      seen.add(p.id);
      const isNew = !this.roles.has(p.id);
      const role = this.roleOf(p, width, height);
      switch (role) {
        case "stick": {
          const dx = p.x - p.startX;
          const dy = p.y - p.startY;
          const dist = Math.hypot(dx, dy);
          if (dist >= c.STICK_DEADZONE) {
            // 最大半径で頭打ちにし、正規化した方向を移動入力にする
            const scale = Math.min(dist, c.STICK_MAX_RADIUS) / dist;
            result.moveX = (dx * scale) / c.STICK_MAX_RADIUS;
            result.moveY = (dy * scale) / c.STICK_MAX_RADIUS;
          }
          const tipScale = dist > c.STICK_MAX_RADIUS ? c.STICK_MAX_RADIUS / dist : 1;
          result.stick = {
            baseX: p.startX,
            baseY: p.startY,
            tipX: p.startX + dx * tipScale,
            tipY: p.startY + dy * tipScale,
          };
          break;
        }
        case "aim":
          result.aim = { x: p.x, y: p.y };
          result.fire = true; // 触れている間は連射（GDD §3.5）
          break;
        case "mine":
          if (isNew) result.minePressed = true; // 押下の立ち上がりのみ
          break;
        case "pause":
          if (isNew) result.pausePressed = true;
          break;
      }
    }

    // 離された指の役割を破棄（次に触れたら再判定される）
    for (const id of [...this.roles.keys()]) if (!seen.has(id)) this.roles.delete(id);
    return result;
  }

  /** 状態をリセットする（シーン切替時） */
  reset(): void {
    this.roles.clear();
  }
}
