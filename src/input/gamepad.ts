/**
 * 2P ゲームパッド入力のポーリング（GDD §12.5）。
 * Gamepad API（navigator.getGamepads()）を毎フレーム読み、押下エッジ（押した瞬間）と
 * デッドゾーン処理済みのスティック値に正規化して返す薄い層。
 * ブラウザ API に依存するため src/core/ には置かない（core はテスト可能に保つ）。
 * 標準マッピング想定：axes[0,1]=左スティック（移動）、axes[2,3]=右スティック（照準）、
 * buttons[5]=R1/RB（射撃）、buttons[4]=L1/LB（地雷）。ボタン番号は BALANCE.INPUT に集約。
 */
import { BALANCE } from "../config/balance";
import { applyStickDeadzone } from "../core/input";

/** 1フレーム分のパッド状態（正規化済み） */
export interface GamepadFrame {
  connected: boolean; // パッドが接続されているか（毎フレーム確認して随時切替。GDD §12.5）
  moveX: number; // 左スティック（デッドゾーン適用済み。未入力は 0）
  moveY: number;
  aimAngle: number | null; // 右スティックの傾き方向 [rad]（デッドゾーン未満は null＝照準入力なし）
  firePressed: boolean; // 射撃ボタンの押下エッジ（1押下1発）
  minePressed: boolean; // 地雷ボタンの押下エッジ（1押下1設置）
}

/** 未接続時のフレーム */
function disconnectedFrame(): GamepadFrame {
  return { connected: false, moveX: 0, moveY: 0, aimAngle: null, firePressed: false, minePressed: false };
}

/** ゲームパッドのポーラ（前フレームのボタン状態を保持して押下エッジを検出する） */
export class GamepadPoller {
  private prevFire = false;
  private prevMine = false;

  /** 毎フレーム呼ぶ。最初に見つかった接続中のパッドを読む */
  poll(): GamepadFrame {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      return disconnectedFrame(); // テスト環境など Gamepad API 非対応時は常に未接続
    }
    let pad: Gamepad | null = null;
    for (const g of navigator.getGamepads()) {
      if (g?.connected) {
        pad = g;
        break;
      }
    }
    if (!pad) {
      this.prevFire = false; // 切断中にエッジ状態を持ち越さない
      this.prevMine = false;
      return disconnectedFrame();
    }

    const dz = BALANCE.INPUT.GAMEPAD_DEADZONE;
    const move = applyStickDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, dz);
    const aimVec = applyStickDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, dz);
    const fireDown = pad.buttons[BALANCE.INPUT.GAMEPAD_FIRE_BUTTON]?.pressed ?? false;
    const mineDown = pad.buttons[BALANCE.INPUT.GAMEPAD_MINE_BUTTON]?.pressed ?? false;

    const frame: GamepadFrame = {
      connected: true,
      moveX: move?.x ?? 0,
      moveY: move?.y ?? 0,
      aimAngle: aimVec ? Math.atan2(aimVec.y, aimVec.x) : null, // 傾けた方向へ砲塔即応（GDD §12.5）
      firePressed: fireDown && !this.prevFire,
      minePressed: mineDown && !this.prevMine,
    };
    this.prevFire = fireDown;
    this.prevMine = mineDown;
    return frame;
  }
}
