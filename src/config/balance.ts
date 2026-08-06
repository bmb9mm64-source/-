/**
 * 調整値の一元管理（マジックナンバー禁止・CLAUDE.md 規約）。
 * 数値は GDD v0.2.1（docs/gdd.md）を正とする。GDD に明記のない細部
 * （ローバーの徘徊間隔・回避成功率、効果音の音量など）はここでの調整値とし、
 * プレイテストで更新する。単位：px＝ピクセル、s＝秒。角度はすべてラジアン。
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

  ROVER: {
    // 敵B「ローバー」（遊撃型。GDD §6）
    SIZE: 28,
    RADIUS: 14,
    SPEED: 60, // 移動速度 [px/s]
    TURN_SPEED: (2 * Math.PI) / 3, // 砲塔回転速度 120°/s
    BODY_TURN_SPEED: 12, // 車体の向きの追従速度 [rad/s]（演出用）
    FIRE_INTERVAL_MEAN: 2.0, // 発射間隔の平均 [s]
    FIRE_INTERVAL_VAR: 0.8, // 発射間隔のゆらぎ幅（±）[s]
    MAX_BULLETS: 1, // 同時発射数上限
    FIRE_ANGLE_TOL: 0.15, // 発射許可の照準許容角 [rad]（セントリーと同様）
    RETARGET_INTERVAL_MIN: 1.5, // 徘徊目標を引き直す間隔（最小）[s]（GDD「数秒ごと」）
    RETARGET_INTERVAL_MAX: 3.5, // 徘徊目標を引き直す間隔（最大）[s]
    ARRIVE_DIST: 8, // 目標到達とみなす距離 [px]
    STUCK_TIME: 0.25, // 壁・戦車に行き詰まったと判断するまでの時間 [s]
    WANDER_PICK_TRIES: 20, // 徘徊目標（床タイル）の抽選試行回数
    DODGE_DETECT_RADIUS: 90, // プレイヤー弾の接近を検知する半径 [px]
    DODGE_CHANCE: 0.35, // 回避を試みる確率（成功率は低め：GDD §6）
    DODGE_TIME: 0.3, // 回避移動の継続時間 [s]（「短い回避移動」）
    DODGE_COOLDOWN: 0.8, // 回避判定のクールダウン [s]（毎フレーム抽選しない）
  },

  MINE: {
    // 地雷（GDD §4）
    MAX_PER_OWNER: 2, // 同時設置上限（設置者ごと）
    FUSE_TIME: 10.0, // 設置後の自動起爆までの時間 [s]
    TRIGGER_RADIUS: 40, // 戦車の接近起爆半径 [px]（戦車中心との距離）
    BLAST_RADIUS: 48, // 爆風半径 [px]（戦車・弾・地雷・破壊可能壁 X を巻き込む）
    RADIUS: 8, // 地雷本体の半径 [px]（弾との接触＝誘爆の判定・描画に使用）
  },

  GAME: {
    LIVES: 3, // 初期残機（GDD §8）
    START_GRACE: 1.0, // ステージ開始後、敵が射撃しない時間 [s]（開幕即死防止）
    BANNER_TIME: 2.0, // 「MISSION n」表示時間 [s]（GDD §8）
  },

  AUDIO: {
    // 効果音の音量（0〜1。控えめに統一。マスターは全体に掛かる）
    MASTER: 0.22,
    FIRE: 0.5,
    BOUNCE: 0.35,
    CANCEL: 0.45,
    DESTROY: 0.7,
    MINE_PLACE: 0.4,
    MINE_EXPLODE: 0.85,
    CLEAR: 0.5,
    GAMEOVER: 0.5,
  },

  FX: {
    // 画面演出（見た目のみ。ゲームロジックには影響しない）
    EXPLOSION_TIME: 0.35, // 爆発フラッシュの表示時間 [s]
    MINE_BLINK_HZ: 3, // 地雷ランプの点滅周波数 [Hz]
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
  ROVER_BODY: 0xb84545, // 敵B「ローバー」は赤系で区別（セントリーは橙）
  ROVER_TRACK: 0x772b2b,
  ROVER_TURRET: 0xff9d9d,
  WALL_X: 0x8a6d4c, // 破壊可能壁 X（土嚢風の茶系。恒久壁と区別）
  WALL_X_EDGE: 0xa88860,
  MINE: 0x3a3f4d, // 地雷本体
  MINE_LAMP: 0xff5d5d, // 地雷の点滅ランプ
  EXPLOSION: 0xffb347, // 爆風フラッシュ
  BULLET: 0xf2f0e6,
  BULLET_EDGE: 0x8f8c7c,
  CROSSHAIR: 0xe8ecf5,
  HUD_CSS: "#e8ecf5", // Text 用 CSS 文字列
  FLOOR_CSS: "#232733", // 背景色（ゲーム設定用 CSS 文字列）
  OVERLAY: 0x0a0c12, // オーバーレイの色（rgba(10,12,18) 相当）
  OVERLAY_ALPHA: 0.65, // オーバーレイの不透明度
} as const;
