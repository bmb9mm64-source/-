/**
 * 調整値の一元管理（マジックナンバー禁止・CLAUDE.md 規約）。
 * 数値は GDD v0.9（docs/gdd.md）を正とする。GDD に明記のない細部
 * （ローバーの徘徊間隔、効果音の音量など）はここでの調整値とし、
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
    FIRE_INTERVAL: 0.15, // 発射間隔 [s]（GDD §4 v0.9.1：0.3→0.15。連射速度2倍）
    FIRE_BUFFER: 0.12, // 射撃の先行入力バッファ [s]（GDD §3 v0.10。FIRE_INTERVAL 未満にして1クリック2発を防ぐ）
    MAX_BULLETS: 5, // 同時発射数上限（プレイヤーごとに独立。GDD §12.5）
    BODY_TURN_SPEED: 12, // 車体の向きの追従速度 [rad/s]（演出用。GDD「滑らかに回転」）
    TURRET_TURN_SPEED_KEYS: (540 * Math.PI) / 180, // 2P キーボード照準（IJKL）時の砲塔回転追従速度 [rad/s]（GDD §12.5「押した方向へ回転追従」。速度は本ファイルの調整値）
  },

  INPUT: {
    // 2P ゲームパッド入力（GDD §12.5。Gamepad API＝ブラウザのコントローラ対応機能）
    GAMEPAD_DEADZONE: 0.25, // スティックのデッドゾーン（中央付近の遊び。傾き量がこの値未満は入力なし扱い）
    GAMEPAD_FIRE_BUTTON: 5, // 射撃ボタン（標準マッピングの R1/RB）
    GAMEPAD_MINE_BUTTON: 4, // 地雷ボタン（標準マッピングの L1/LB）
  },

  BULLET: {
    SPEED: 200, // プレイヤー弾の弾速 [px/s]（GDD §4。v0.4 で敵弾と分離）
    ENEMY_BULLET_SPEED: 225, // 敵弾（セントリー・ローバー・マインレイヤー）の弾速 [px/s]（GDD §6 v0.4：敵弾のみ強化）
    SNIPER_BULLET_SPEED: 340, // 敵C「スナイパー」弾の弾速 [px/s]（GDD §6 v0.6。反射上限は共通の1回）
    REFLECTOR_BULLET_SPEED: 300, // 敵E「リフレクター」弾の弾速 [px/s]（GDD §6 v0.9）
    REFLECTOR_MAX_BOUNCES: 2, // 敵E弾の反射上限（この敵の弾だけ2回跳ねる。GDD §6 v0.9）
    PRISM_BULLET_SPEED: 280, // 敵G「プリズム」弾の弾速 [px/s]（GDD §6 v0.10）
    PRISM_MAX_BOUNCES: 3, // 敵G弾の反射上限（3回跳ねて盤面を長く飛び回る。GDD §6 v0.10）
    RADIUS: 4, // 弾の当たり判定半径 [px]
    MAX_BOUNCES: 1, // 反射上限（2回目の壁接触で消滅）
    MUZZLE_OFFSET: 22, // 砲口オフセット [px]（車体半径14+弾半径4 より外側 → 発射直後の自爆なし）
  },

  SENTRY: {
    // 敵A「セントリー」（GDD §6。v0.4 バランスパッチで強化）
    SIZE: 28,
    RADIUS: 14,
    TURN_SPEED: (115 * Math.PI) / 180, // 砲塔回転速度 115°/s（v0.4：90→115）
    JITTER_MAX: (2 * Math.PI) / 180, // 照準の最大ブレ（±2°。v0.4：±3→±2）
    JITTER_INTERVAL_MIN: 0.4, // ブレ量を引き直す間隔（最小）[s]
    JITTER_INTERVAL_MAX: 1.2, // ブレ量を引き直す間隔（最大）[s]
    FIRE_INTERVAL_MEAN: 2.2, // 発射間隔の平均 [s]（v0.4：3.0→2.2）
    FIRE_INTERVAL_VAR: 0.8, // 発射間隔のゆらぎ幅（±）[s]（v0.4：±1.0→±0.8）
    MAX_BULLETS: 1, // 同時発射数上限
    FIRE_ANGLE_TOL: 0.15, // 発射許可の照準許容角 [rad]（GDD v0.2 §6。跳弾狙撃時は反射点方向に適用）
    // 跳弾狙撃の確率は難易度で決まる（DIFFICULTY.*.TURRET_RICOCHET_CHANCE。GDD §6 v0.9 で個別値20%を廃止）
  },

  ROVER: {
    // 敵B「ローバー」（遊撃型。GDD §6。v0.4 バランスパッチで強化）
    SIZE: 28,
    RADIUS: 14,
    SPEED: 78, // 移動速度 [px/s]（v0.4：60→78）
    TURN_SPEED: (150 * Math.PI) / 180, // 砲塔回転速度 150°/s（v0.4：120→150）
    BODY_TURN_SPEED: 12, // 車体の向きの追従速度 [rad/s]（演出用）
    FIRE_INTERVAL_MEAN: 1.5, // 発射間隔の平均 [s]（v0.4：2.0→1.5）
    FIRE_INTERVAL_VAR: 0.6, // 発射間隔のゆらぎ幅（±）[s]（v0.4：±0.8→±0.6）
    MAX_BULLETS: 1, // 同時発射数上限
    FIRE_ANGLE_TOL: 0.15, // 発射許可の照準許容角 [rad]（セントリーと同様）
    RETARGET_INTERVAL_MIN: 1.5, // 徘徊目標を引き直す間隔（最小）[s]（GDD「数秒ごと」）
    RETARGET_INTERVAL_MAX: 3.5, // 徘徊目標を引き直す間隔（最大）[s]
    ARRIVE_DIST: 8, // 目標到達とみなす距離 [px]
    STUCK_TIME: 0.25, // 壁・戦車に行き詰まったと判断するまでの時間 [s]
    WANDER_PICK_TRIES: 20, // 徘徊目標（床タイル）の抽選試行回数
    DODGE_DETECT_RADIUS: 110, // プレイヤー弾の接近を検知する半径 [px]（v0.4：90→110）
    // 回避の成功率は難易度で決まる（DIFFICULTY.*.ROVER_DODGE_CHANCE。GDD §8.3 v0.9）
    DODGE_TIME: 0.3, // 回避移動の継続時間 [s]（「短い回避移動」）
    DODGE_COOLDOWN: 0.8, // 回避判定のクールダウン [s]（毎フレーム抽選しない）
  },

  SNIPER: {
    // 敵C「スナイパー」（狙撃型。GDD §6 v0.6）
    SIZE: 28,
    RADIUS: 14,
    TURN_SPEED: (70 * Math.PI) / 180, // 砲塔回転速度 70°/s（ゆっくりだがブレなし＝精密照準）
    FIRE_INTERVAL_MEAN: 4.0, // 発射間隔の平均 [s]
    FIRE_INTERVAL_VAR: 1.0, // 発射間隔のゆらぎ幅（±）[s]
    MAX_BULLETS: 1, // 同時発射数上限
    FIRE_ANGLE_TOL: 0.15, // 発射許可の照準許容角 [rad]（セントリーと同様）
    // 跳弾狙撃の確率は難易度で決まる（DIFFICULTY.*.TURRET_RICOCHET_CHANCE。GDD §6 v0.9 で個別値35%を廃止）
  },

  REFLECTOR: {
    // 敵E「リフレクター」（反射砲台型。GDD §6 v0.9。固定砲台＝セントリー構造の再利用）
    SIZE: 28,
    RADIUS: 14,
    TURN_SPEED: (100 * Math.PI) / 180, // 砲塔回転速度 100°/s
    JITTER_MAX: (1 * Math.PI) / 180, // 照準の最大ブレ（±1°）
    JITTER_INTERVAL_MIN: 0.4, // ブレ量を引き直す間隔（最小）[s]（セントリーと同じ調整値）
    JITTER_INTERVAL_MAX: 1.2, // ブレ量を引き直す間隔（最大）[s]
    FIRE_INTERVAL_MEAN: 2.5, // 発射間隔の平均 [s]（難易度倍率の対象）
    FIRE_INTERVAL_VAR: 0.8, // 発射間隔のゆらぎ幅（±）[s]
    MAX_BULLETS: 2, // 同時発射数上限（GDD §6 v0.9：同時2発）
    FIRE_ANGLE_TOL: 0.15, // 発射許可の照準許容角 [rad]（セントリーと同様）
    // 跳弾狙撃は難易度によらず常時100%（GDD §6 v0.9）。直接射線があれば直接射撃を優先
  },

  PRISM: {
    // 敵G「プリズム」（多重反射砲台型。GDD §6 v0.10。リフレクターと同構造）
    SIZE: 28,
    RADIUS: 14,
    TURN_SPEED: (90 * Math.PI) / 180, // 砲塔回転速度 90°/s
    JITTER_MAX: (1 * Math.PI) / 180, // 照準の最大ブレ（±1°）
    JITTER_INTERVAL_MIN: 0.4, // ブレ量を引き直す間隔（最小）[s]
    JITTER_INTERVAL_MAX: 1.2, // ブレ量を引き直す間隔（最大）[s]
    FIRE_INTERVAL_MEAN: 3.0, // 発射間隔の平均 [s]（難易度倍率の対象）
    FIRE_INTERVAL_VAR: 1.0, // 発射間隔のゆらぎ幅（±）[s]
    MAX_BULLETS: 1, // 同時発射数上限（3回反射弾が長く残るため1発）
    FIRE_ANGLE_TOL: 0.15, // 発射許可の照準許容角 [rad]
    // 跳弾狙撃は難易度によらず常時100%（リフレクターと同様。GDD §6 v0.10）
  },

  CHASER: {
    // 敵F「チェイサー」（追跡型。GDD §6 v0.9。移動・回避はローバーの WANDER 構造の流用）
    SIZE: 28,
    RADIUS: 14,
    SPEED: 110, // 移動速度 [px/s]
    TURN_SPEED: (200 * Math.PI) / 180, // 砲塔回転速度 200°/s
    BODY_TURN_SPEED: 12, // 車体の向きの追従速度 [rad/s]（演出用）
    FIRE_INTERVAL_MEAN: 1.0, // 発射間隔の平均 [s]（難易度倍率の対象）
    FIRE_INTERVAL_VAR: 0.3, // 発射間隔のゆらぎ幅（±）[s]
    MAX_BULLETS: 1, // 同時発射数上限
    FIRE_ANGLE_TOL: 0.15, // 発射許可の照準許容角 [rad]（セントリーと同様）
    RETARGET_INTERVAL_MIN: 1.0, // 追跡目標を引き直す間隔（最小）[s]（GDD「1.0〜2.0s」）
    RETARGET_INTERVAL_MAX: 2.0, // 追跡目標を引き直す間隔（最大）[s]
    CHASE_RANGE_TILES: 3, // 追跡目標の抽選範囲：最寄り生存プレイヤーのタイル±3タイル（GDD §6 v0.9）
    ARRIVE_DIST: 8, // 目標到達とみなす距離 [px]
    STUCK_TIME: 0.25, // 壁・戦車に行き詰まったと判断するまでの時間 [s]
    CHASE_PICK_TRIES: 20, // 追跡目標（床タイル）の抽選試行回数
    DODGE_DETECT_RADIUS: 110, // プレイヤー弾の接近を検知する半径 [px]（ローバーと同じ調整値）
    DODGE_CHANCE: 0.5, // 回避を試みる確率（難易度によらず50%固定。GDD §6 v0.9）
    DODGE_TIME: 0.3, // 回避移動の継続時間 [s]
    DODGE_COOLDOWN: 0.8, // 回避判定のクールダウン [s]
  },

  MINELAYER: {
    // 敵D「マインレイヤー」（地雷敷設型。GDD §6 v0.6。移動・射撃はローバーと同方式・回避なし）
    SIZE: 28,
    RADIUS: 14,
    SPEED: 70, // 移動速度 [px/s]
    TURN_SPEED: (120 * Math.PI) / 180, // 砲塔回転速度 120°/s
    BODY_TURN_SPEED: 12, // 車体の向きの追従速度 [rad/s]（演出用）
    FIRE_INTERVAL_MEAN: 2.5, // 発射間隔の平均 [s]
    FIRE_INTERVAL_VAR: 1.0, // 発射間隔のゆらぎ幅（±）[s]
    MAX_BULLETS: 1, // 同時発射数上限
    FIRE_ANGLE_TOL: 0.15, // 発射許可の照準許容角 [rad]（セントリーと同様）
    RETARGET_INTERVAL_MIN: 1.5, // 徘徊目標を引き直す間隔（最小）[s]（ローバーと同じ調整値）
    RETARGET_INTERVAL_MAX: 3.5, // 徘徊目標を引き直す間隔（最大）[s]
    ARRIVE_DIST: 8, // 目標到達とみなす距離 [px]
    STUCK_TIME: 0.25, // 壁・戦車に行き詰まったと判断するまでの時間 [s]
    WANDER_PICK_TRIES: 20, // 徘徊目標（床タイル）の抽選試行回数
    MINE_MAX: 3, // 地雷の同時敷設上限（自分が敷設した生存地雷のみ数える。GDD §6 v0.6）
    MINE_INTERVAL_MEAN: 5.0, // 敷設間隔の平均 [s]
    MINE_INTERVAL_VAR: 2.0, // 敷設間隔のゆらぎ幅（±）[s]
    MINE_SAFE_DIST: 160, // 敷設を許可する最寄り生存プレイヤーとの最小距離 [px]（自爆行為の防止）
  },

  MINE: {
    // 地雷（GDD §4）
    MAX_PER_OWNER: 2, // 同時設置上限（設置者ごと）
    FUSE_TIME: 10.0, // 設置後の自動起爆までの時間 [s]
    TRIGGER_RADIUS: 40, // 戦車の接近起爆半径 [px]（戦車中心との距離）
    BLAST_RADIUS: 48, // 爆風半径 [px]（戦車・弾・地雷・破壊可能壁 X を巻き込む）
    RADIUS: 8, // 地雷本体の半径 [px]（弾との接触＝誘爆の判定・描画に使用）
  },

  DIFFICULTY: {
    // 難易度別の調整値（GDD §8.3 v0.9 の表）。敵の脅威度のみを変え、プレイヤー性能は不変。
    // 値の選択・解決は src/core/difficulty.ts が担う（ここは数値の集約のみ）。
    easy: {
      LIVES: 5, // 初期残機
      FIRE_INTERVAL_MULT: 1.4, // 敵の発射間隔倍率（ゆっくり）
      BULLET_SPEED_MULT: 0.9, // 敵弾速の倍率（スナイパー弾にも適用）
      TURRET_RICOCHET_CHANCE: 0.4, // 固定砲台（A・C）の跳弾狙撃確率（E は常時100%）
      ROVER_DODGE_CHANCE: 0.35, // ローバーの回避成功率
    },
    normal: {
      LIVES: 3,
      FIRE_INTERVAL_MULT: 1.0,
      BULLET_SPEED_MULT: 1.0,
      TURRET_RICOCHET_CHANCE: 0.75,
      ROVER_DODGE_CHANCE: 0.5,
    },
    hard: {
      LIVES: 3,
      FIRE_INTERVAL_MULT: 0.75, // 矢継ぎ早
      BULLET_SPEED_MULT: 1.1,
      TURRET_RICOCHET_CHANCE: 1.0,
      ROVER_DODGE_CHANCE: 0.65,
    },
  },

  GAME: {
    LIVES: 3, // 初期残機（NORMAL 基準の既定値。難易度別の実効値は DIFFICULTY.*.LIVES。GDD §8・§8.3）
    MAX_PLAYERS: 2, // 最大プレイヤー数（ローカル2P協力。GDD §12.5）
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
    // 画面演出（見た目のみ。ゲームロジックには影響しない。GDD §8.5）
    EXPLOSION_TIME: 0.35, // 爆発フラッシュの表示時間 [s]
    MINE_BLINK_HZ: 3, // 地雷ランプの点滅周波数 [Hz]
    DESTROY_FLASH_RADIUS: 26, // 戦車撃破フラッシュの最終半径 [px]（地雷爆風より小さい）
    DESTROY_PARTICLES: 14, // 撃破時の破片パーティクル数
    PARTICLE_SPEED_MIN: 60, // 破片の初速（最小）[px/s]
    PARTICLE_SPEED_MAX: 220, // 破片の初速（最大）[px/s]
    PARTICLE_LIFE: 0.4, // 破片の寿命 [s]（GDD §8.5：演出は 0.3〜0.5s でテンポを損なわない）
    PARTICLE_SIZE_MIN: 2, // 破片の辺長（最小）[px]
    PARTICLE_SIZE_MAX: 5, // 破片の辺長（最大）[px]
    SHAKE_DESTROY_DURATION: 0.12, // 撃破時の画面揺れ時間 [s]（軽い揺れ）
    SHAKE_DESTROY_INTENSITY: 0.003, // 撃破時の揺れ強さ（Phaser camera shake の割合値）
    SHAKE_MINE_DURATION: 0.2, // 地雷爆発時の画面揺れ時間 [s]（一回り大きい。GDD §8.5）
    SHAKE_MINE_INTENSITY: 0.006, // 地雷爆発時の揺れ強さ
    CLEAR_BANNER_TIME: 1.0, // 「CLEAR!」表示時間 [s]（GAME.BANNER_TIME より短くし、残りで次ミッションバナーを見せる）
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
  P2_BODY: 0x2fa05a, // 2P は緑系のオリジナル配色（1P＝青系と識別。GDD §12.5）
  P2_TRACK: 0x1d6b3a,
  P2_TURRET: 0x8fe6b0,
  ENEMY_BODY: 0xd07a2f,
  ENEMY_TRACK: 0x8a4d15,
  ENEMY_TURRET: 0xffc07f,
  ROVER_BODY: 0xb84545, // 敵B「ローバー」は赤系で区別（セントリーは橙）
  ROVER_TRACK: 0x772b2b,
  ROVER_TURRET: 0xff9d9d,
  SNIPER_BODY: 0x8a55d4, // 敵C「スナイパー」は紫系のオリジナル配色（GDD §6 v0.6）
  SNIPER_TRACK: 0x59318f,
  SNIPER_TURRET: 0xd7b8ff,
  MINELAYER_BODY: 0xcfae2e, // 敵D「マインレイヤー」は黄系のオリジナル配色（GDD §6 v0.6）
  MINELAYER_TRACK: 0x8a7217,
  MINELAYER_TURRET: 0xffe98f,
  REFLECTOR_BODY: 0x2aa8a0, // 敵E「リフレクター」は青緑（シアン）系のオリジナル配色（GDD §6 v0.9）
  REFLECTOR_TRACK: 0x1a6d68,
  REFLECTOR_TURRET: 0x8ff2e8,
  CHASER_BODY: 0xaab4bf, // 敵F「チェイサー」は白銀系のオリジナル配色（GDD §6 v0.9）
  CHASER_TRACK: 0x6e7883,
  CHASER_TURRET: 0xf2f6fa,
  PRISM_BODY: 0xd44fb0, // 敵G「プリズム」はマゼンタ（赤紫）系のオリジナル配色（GDD §6 v0.10）
  PRISM_TRACK: 0x8f2f77,
  PRISM_TURRET: 0xffb3e6,
  WALL_X: 0x8a6d4c, // 破壊可能壁 X（土嚢風の茶系。恒久壁と区別）
  WALL_X_EDGE: 0xa88860,
  MINE: 0x3a3f4d, // 地雷本体（プレイヤー設置）
  MINE_LAMP: 0xff5d5d, // 地雷の点滅ランプ（プレイヤー設置）
  ENEMY_MINE: 0x4d4433, // 敵（マインレイヤー）設置の地雷本体（形は同じ・配色差で識別）
  ENEMY_MINE_LAMP: 0xffb13d, // 敵地雷の点滅ランプ（琥珀色）
  EXPLOSION: 0xffb347, // 爆風フラッシュ
  DEBRIS: [0xffc07f, 0xf2f0e6, 0x6b7386, 0xff8a5c] as readonly number[], // 撃破破片パーティクルの配色（コード描画。GDD §8.5）
  RECORD_CSS: "#ffd763", // NEW RECORD! ・ベスト表示の強調色（CSS 文字列）
  BULLET: 0xf2f0e6,
  BULLET_EDGE: 0x8f8c7c,
  CROSSHAIR: 0xe8ecf5,
  HUD_CSS: "#e8ecf5", // Text 用 CSS 文字列
  FLOOR_CSS: "#232733", // 背景色（ゲーム設定用 CSS 文字列）
  OVERLAY: 0x0a0c12, // オーバーレイの色（rgba(10,12,18) 相当）
  OVERLAY_ALPHA: 0.65, // オーバーレイの不透明度
} as const;
