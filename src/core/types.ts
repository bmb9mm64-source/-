/**
 * core 共通の型定義（Phaser 非依存の純粋 TS）。
 * 座標は px、角度はラジアンで統一する。
 */

/** 2次元座標 */
export interface Vec2 {
  x: number;
  y: number;
}

/** 戦車の共通状態（プレイヤー・敵で共用） */
export interface TankBody {
  x: number;
  y: number;
  bodyAngle: number; // 車体の向き [rad]
  turretAngle: number; // 砲塔の向き [rad]
  half: number; // 車体当たり判定（正方形）の半辺長 [px]
  radius: number; // 対弾用の円近似半径 [px]
  alive: boolean;
}

/** プレイヤー戦車 */
export interface PlayerTank extends TankBody {
  kind: "player";
  cooldown: number; // 次弾発射可能までの残り時間 [s]
}
