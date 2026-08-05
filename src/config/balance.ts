/**
 * 調整値の一元管理（マジックナンバー禁止・CLAUDE.md 規約）。
 * 数値は GDD v0.2（docs/gdd.md）と Phase 1 プロトタイプ（prototype/index.html の CONFIG）を正とし、
 * 完全一致させている。単位：px＝ピクセル、s＝秒。角度はすべてラジアン。
 */
export const BALANCE = {
  TILE: 32, // 1タイルの辺長 [px]
  COLS: 25, // 盤面の横タイル数
  ROWS: 17, // 盤面の縦タイル数（25×17 = 800×544px）
  DT_MAX: 0.05, // デルタタイムの上限クランプ [s]（タブ復帰時の吹っ飛び防止）
  EPS: 0.01, // めり込み防止の押し戻しマージン [px]

  PLAYER: {
    SPEED: 120, // 移動速度 [px/s]（GDD §4）
    SIZE: 28, // 車体当たり判定（正方形の辺長）[px]
    RADIUS: 14, // 対弾用の円近似半径 [px]（28×28 の円近似）
    FIRE_INTERVAL: 0.3, // 発射間隔 [s]
    MAX_BULLETS: 5, // 同時発射数上限
    BODY_TURN_SPEED: 12, // 車体の向きの追従速度 [rad/s]（演出用。GDD「滑らかに回転」）
  },

  BULLET: {
    SPEED: 200, // 弾速 [px/s]（GDD §4・§6）
    RADIUS: 4, // 弾の当たり判定半径 [px]
    MAX_BOUNCES: 1, // 反射上限（2回目の壁接触で消滅）
    MUZZLE_OFFSET: 22, // 砲口オフセット [px]（車体半径14+弾半径4 より外側 → 発射直後の自爆なし）
  },

  SENTRY: {
    // 敵A「セントリー」（GDD §6）
    SIZE: 28,
    RADIUS: 14,
    TURN_SPEED: Math.PI / 2, // 砲塔回転速度 90°/s
    JITTER_MAX: (3 * Math.PI) / 180, // 照準の最大ブレ（±3°）
    JITTER_INTERVAL_MIN: 0.4, // ブレ量を引き直す間隔（最小）[s]
    JITTER_INTERVAL_MAX: 1.2, // ブレ量を引き直す間隔（最大）[s]
    FIRE_INTERVAL_MEAN: 3.0, // 発射間隔の平均 [s]
    FIRE_INTERVAL_VAR: 1.0, // 発射間隔のゆらぎ幅（±）[s]
    MAX_BULLETS: 1, // 同時発射数上限
    FIRE_ANGLE_TOL: 0.15, // 発射許可の照準許容角 [rad]（GDD v0.2 §6）
  },

  GAME: {
    LIVES: 3, // 初期残機（GDD §8）
    START_GRACE: 1.0, // ステージ開始後、敵が射撃しない時間 [s]（開幕即死防止）
  },

  LOS_STEP: 6, // 射線判定（レイキャスト）のサンプリング間隔 [px]
} as const;

/**
 * オリジナル配色（原作の配色を模倣しない：寒色基調＋プレイヤー青／敵は橙）。
 * Phaser の Graphics は数値カラー、Text は CSS 文字列を使うため両形式を用意する。
 */
export const COLORS = {
  FLOOR: 0x232733,
  FLOOR_GRID: 0x272c39,
  WALL: 0x4c566a,
  WALL_EDGE: 0x5d6a82,
  HOLE: 0x12141b,
  HOLE_EDGE: 0x0a0b10,
  PLAYER_BODY: 0x2f6fd0,
  PLAYER_TRACK: 0x1d4587,
  PLAYER_TURRET: 0x7fb2ff,
  ENEMY_BODY: 0xd07a2f,
  ENEMY_TRACK: 0x8a4d15,
  ENEMY_TURRET: 0xffc07f,
  BULLET: 0xf2f0e6,
  BULLET_EDGE: 0x8f8c7c,
  CROSSHAIR: 0xe8ecf5,
  HUD_CSS: "#e8ecf5", // Text 用 CSS 文字列
  FLOOR_CSS: "#232733", // 背景色（ゲーム設定用 CSS 文字列）
  OVERLAY: 0x0a0c12, // オーバーレイの色（rgba(10,12,18) 相当）
  OVERLAY_ALPHA: 0.65, // オーバーレイの不透明度
} as const;
