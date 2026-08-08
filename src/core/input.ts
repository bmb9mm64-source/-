/**
 * プレイヤー入力の抽象化（Phaser 非依存の純粋 TS。GDD §12.5）。
 * シーン側（マウス・キーボード・ゲームパッド）は入力をこの PlayerInput 型に正規化して
 * GameWorld.update に渡す。ワールドは入力元の違い（1P マウス／2P パッド・キーボード）を知らない。
 * 角度はすべてラジアン。
 */

/**
 * 照準入力の方式：
 * - cursor … カーソル位置（ワールド座標 px）へ砲塔を即時追従（1P マウス）
 * - angle  … 角度指定。instant=true は即応（2P パッド右スティック）、
 *             instant=false は指定角度へ回転追従（2P キーボード IJKL。
 *             回転速度は BALANCE.PLAYER.TURRET_TURN_SPEED_KEYS）
 * - none   … 照準入力なし。砲塔は現在の向きを維持
 */
export type PlayerAim =
  | { mode: "cursor"; x: number; y: number }
  | { mode: "angle"; angle: number; instant: boolean }
  | { mode: "none" };

/** 1フレーム分の1プレイヤーの入力 */
export interface PlayerInput {
  moveX: number; // 移動ベクトル X（-1〜+1。斜めの正規化はワールド側で行う）
  moveY: number; // 移動ベクトル Y（-1〜+1）
  aim: PlayerAim; // 照準（角度指定 or カーソル位置）
  fire: boolean; // このフレームに発射要求があるか（1押下1発）
  placeMine: boolean; // このフレームに地雷設置要求があるか（1押下1設置）
}

/** 入力なし（未接続・退場中などのフォールバック用） */
export function idlePlayerInput(): PlayerInput {
  return { moveX: 0, moveY: 0, aim: { mode: "none" }, fire: false, placeMine: false };
}

/**
 * 8方向照準（2P キーボード IJKL：I=上・J=左・K=下・L=右。同時押しで斜め）の
 * 押下状態を砲塔の目標角度 [rad] に変換する。どの方向も押されていない
 * （または上下・左右が打ち消し合う）場合は null（照準入力なし）。
 * 座標系は画面系（Y 下向きが正）なので「下」= +PI/2。
 */
export function eightWayAngle(up: boolean, left: boolean, down: boolean, right: boolean): number | null {
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (down ? 1 : 0) - (up ? 1 : 0);
  if (x === 0 && y === 0) return null;
  return Math.atan2(y, x);
}

/**
 * アナログスティックのデッドゾーン処理：傾きの大きさが deadzone 未満なら null（入力なし）。
 * 以上ならそのままのベクトルを返す（移動の速度正規化はワールド側で行うため大きさは補正しない）。
 */
export function applyStickDeadzone(
  x: number,
  y: number,
  deadzone: number,
): { x: number; y: number } | null {
  if (Math.hypot(x, y) < deadzone) return null;
  return { x, y };
}
