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

  TOUCH: {
    // タッチ操作（GDD §3.5 v0.11）。座標はゲーム内座標（論理解像度 800×544）
    STICK_DEADZONE: 12, // 仮想スティックの不感帯 [px]（この距離未満は移動しない）
    STICK_MAX_RADIUS: 64, // 最大入力とみなす基点からの距離 [px]
    BUTTON_SIZE: 76, // 地雷ボタンの一辺 [px]（指で押しやすい大きさ）
    PAUSE_SIZE: 44, // ポーズボタンの一辺 [px]
    BUTTON_MARGIN: 14, // 画面端からの余白 [px]
    HUD_HEIGHT: 32, // HUD 帯の高さ [px]（ポーズボタンを HUD の下に置くため）
    UI_ALPHA: 0.28, // 仮想コントロールの不透明度（プレイの邪魔をしない薄さ）
    MAX_POINTERS: 3, // 同時に扱う指の数（移動＋照準＋ボタン）
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
    SHELL_SPEED: 190, // 敵M「ボマー」の榴弾速度 [px/s]（GDD §6 v0.14）
    SHELL_FUSE: 1.1, // 榴弾が炸裂するまでの時間 [s]（壁に当たればその時点で炸裂）
    SHELL_BLAST_RADIUS: 44, // 榴弾の爆風半径 [px]
    VOLLEY_BULLET_SPEED: 200, // 敵V「バースター」弾の弾速 [px/s]（やや遅く＝相殺の余地）
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

  SHIELDER: {
    // 敵S「シールダー」（盾持ち型。GDD §6 v0.14。移動はローバーと同方式・低速）
    SIZE: 28,
    RADIUS: 14,
    SPEED: 55, // 移動速度 [px/s]
    TURN_SPEED: (110 * Math.PI) / 180, // 砲塔回転速度 110°/s
    BODY_TURN_SPEED: 12,
    SHIELD_TURN_SPEED: (60 * Math.PI) / 180, // 盾がプレイヤー方向へ追従する速度 60°/s
    SHIELD_ARC: (60 * Math.PI) / 180, // 盾が守る角度（正面から±60°＝計120°）
    FIRE_INTERVAL_MEAN: 2.8,
    FIRE_INTERVAL_VAR: 0.8,
    MAX_BULLETS: 1,
    FIRE_ANGLE_TOL: 0.15,
    RETARGET_INTERVAL_MIN: 1.5,
    RETARGET_INTERVAL_MAX: 3.5,
    ARRIVE_DIST: 8,
    STUCK_TIME: 0.25,
    WANDER_PICK_TRIES: 20,
  },

  VOLLEY: {
    // 敵V「バースター」（連射型。GDD §6 v0.14。3連射を1セットとして撃つ）
    SIZE: 28,
    RADIUS: 14,
    TURN_SPEED: (130 * Math.PI) / 180, // 砲塔回転速度 130°/s
    JITTER_MAX: (2 * Math.PI) / 180, // 照準の最大ブレ（±2°）
    JITTER_INTERVAL_MIN: 0.4,
    JITTER_INTERVAL_MAX: 1.2,
    BURST_COUNT: 3, // 1セットの発射数
    BURST_GAP: 0.18, // 連射の間隔 [s]
    FIRE_INTERVAL_MEAN: 3.2, // セット間隔の平均 [s]（難易度倍率の対象）
    FIRE_INTERVAL_VAR: 1.0,
    MAX_BULLETS: 3, // 同時発射数上限（3連射ぶん）
    FIRE_ANGLE_TOL: 0.15,
  },

  MORTAR: {
    // 敵M「ボマー」（榴弾型。GDD §6 v0.14。弾は反射せず一定時間で炸裂する）
    SIZE: 28,
    RADIUS: 14,
    TURN_SPEED: (100 * Math.PI) / 180, // 砲塔回転速度 100°/s
    JITTER_MAX: (2 * Math.PI) / 180,
    JITTER_INTERVAL_MIN: 0.4,
    JITTER_INTERVAL_MAX: 1.2,
    FIRE_INTERVAL_MEAN: 3.5,
    FIRE_INTERVAL_VAR: 1.0,
    MAX_BULLETS: 1,
    FIRE_ANGLE_TOL: 0.15,
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
    BGM_MASTER: 0.11, // BGM の音量（効果音より小さくしてプレイの邪魔をしない。GDD §9 v0.11）
  },

  BGM: {
    // 自作合成ループ（GDD §9）。外部音源ファイルは一切使わない（知財ポリシー）。
    // 原作の旋律も使わない＝進行・旋律ともオリジナル。
    //
    // v0.20.1：v0.20 の版は「マイナーキー＋マイナー7th＋鋸波＋深いディレイ」で
    // 不気味に聞こえたため、**明るいポップ**へ作り替えた。効いているのは次の4点：
    //   ① キーを C メジャーにし、王道のポップ進行（I–V–vi–IV）を使う
    //   ② リードの波形を鋸波→矩形波にし、ローパスを閉じすぎない（こもると暗くなる）
    //   ③ ディレイを浅くする（深いと空間が広がりすぎて不穏になる）
    //   ④ テンポを上げ、ドラムは裏拍にハイハットを入れて跳ねさせる
    ROOT_HZ: 220.0, // 基準音 A3。音程はすべてここからの半音数で表す
    STEPS_PER_BAR: 8, // 1小節あたりのステップ数（8分音符）
    BARS_PER_LOOP: 8, // ループの長さ（小節）。前半4＋後半4で表情を変える
    SCHEDULE_AHEAD: 0.25, // 先読みして予約する時間 [s]
    TICK_MS: 40, // スケジューラの起動間隔 [ms]

    // 各パートの相対音量（BGM_MASTER に対する比）
    LEAD_VOL: 0.34,
    PAD_VOL: 0.13,
    BASS_VOL: 0.7,
    KICK_VOL: 0.75,
    SNARE_VOL: 0.28,
    HAT_VOL: 0.14,

    LEAD_WAVE: "square" as OscillatorType, // 矩形波＝明るく抜ける（鋸波は暗く沈む）
    LEAD_DUR: 0.15,
    LEAD_DETUNE: 6, // 2基をわずかにずらして厚みを出す [cent]
    LEAD_CUT0: 4200, // ローパス開度（発音直後）[Hz]
    LEAD_CUT1: 1900, // 減衰後 [Hz]（閉じすぎるとこもって暗くなる）
    BASS_DUR: 0.4,
    BASS_CUT: 520, // ベースのローパス [Hz]
    PAD_ATTACK: 0.2, // パッドの立ち上がり [s]
    KICK_F0: 140,
    KICK_F1: 48,
    KICK_DUR: 0.15,
    SNARE_DUR: 0.12,
    SNARE_BAND: 2000,
    HAT_DUR: 0.026,
    HAT_HIGHPASS: 8000,
    DELAY_STEPS: 3, // リードのディレイ時間（8分音符いくつぶんか）
    DELAY_FEEDBACK: 0.2, // 浅め（深いと不穏な広がりになる）
    DELAY_MIX: 0.16,

    // シーンごとの曲（GDD §9）。数値は基準音 A3 からの半音数。-99 は休符。
    // PROG＝小節ごとのコード（ROOT＝根音、TONES＝構成音）。
    // LEAD は C メジャーの音だけを使った**絶対音程**（コードが変わっても自然に響く）。
    // BASS は各コードの根音からの相対音程。
    TRACKS: {
      title: {
        // 明るく穏やかなポップ。C → G → Am → F（王道の I–V–vi–IV）
        TEMPO: 96,
        PROG: [
          { ROOT: 3, TONES: [0, 4, 7, 12] }, // C
          { ROOT: -2, TONES: [0, 4, 7, 12] }, // G
          { ROOT: 0, TONES: [0, 3, 7, 12] }, // Am
          { ROOT: -4, TONES: [0, 4, 7, 12] }, // F
        ],
        LEAD_A: [15, 17, 19, -99, 22, -99, 19, 17],
        LEAD_B: [19, 22, 24, -99, 22, 19, 15, -99],
        BASS: [0, -99, 0, -99, 7, -99, 0, -99],
        DRUMS: false,
      },
      game: {
        // 疾走感のあるポップ。F → G → C → Am（明るいまま前へ進む）
        TEMPO: 128,
        PROG: [
          { ROOT: -4, TONES: [0, 4, 7, 12] }, // F
          { ROOT: -2, TONES: [0, 4, 7, 12] }, // G
          { ROOT: 3, TONES: [0, 4, 7, 12] }, // C
          { ROOT: 0, TONES: [0, 3, 7, 12] }, // Am
        ],
        LEAD_A: [15, 15, 19, 22, 24, 22, 19, 15],
        LEAD_B: [22, 24, 27, -99, 24, 22, 19, 17],
        BASS: [0, 0, -99, 0, 7, -99, 0, 12],
        DRUMS: true,
      },
      editor: {
        // 静かだが暗くない。C → F（作業の邪魔をしない2コード）
        TEMPO: 80,
        PROG: [
          { ROOT: 3, TONES: [0, 4, 7, 12] }, // C
          { ROOT: -4, TONES: [0, 4, 7, 12] }, // F
          { ROOT: 3, TONES: [0, 4, 7, 12] }, // C
          { ROOT: -2, TONES: [0, 4, 7, 12] }, // G
        ],
        LEAD_A: [15, -99, -99, 19, -99, -99, 17, -99],
        LEAD_B: [12, -99, -99, 15, -99, -99, 19, -99],
        BASS: [0, -99, -99, -99, 7, -99, -99, -99],
        DRUMS: false,
      },
    },
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
    // 弾のミサイル描画（GDD §5「弾の見た目」v0.16。すべて当たり判定半径 BULLET.RADIUS の倍率で、
    // 前方（+）は 1.0 まで＝弾頭の先端が当たり判定の円の縁に一致する。胴体・尾翼・炎は後方だけに伸ばす）
    MISSILE_NOSE: 1.0, // 弾頭の先端（進行方向）
    MISSILE_BODY_FRONT: 0.35, // 胴体の前端（ここから先端までが円錐状の弾頭）
    MISSILE_BODY_BACK: -1.5, // 胴体の後端
    MISSILE_HALF_WIDTH: 0.62, // 胴体の半幅
    MISSILE_FIN_BACK: -2.1, // 尾翼の後端
    MISSILE_FIN_HALF_WIDTH: 1.35, // 尾翼の半幅（張り出し）
    MISSILE_FLAME_MIN: -2.2, // 噴射炎の後端（最短）
    MISSILE_FLAME_MAX: -3.4, // 噴射炎の後端（最長）
    MISSILE_FLAME_HALF_WIDTH: 0.45, // 噴射炎の付け根の半幅
    MISSILE_FLAME_HZ: 14, // 噴射炎の明滅周波数 [Hz]
    MISSILE_FLAME_ALPHA: 0.85, // 噴射炎の不透明度
    // 敵C「スナイパー」弾：細長い徹甲弾＋後方へ伸びる曳光（GDD §5 v0.20）
    SNIPER_LEN: 2.6, // 弾体の長さ（当たり判定半径の倍率。先端は +1.0 のまま）
    SNIPER_HALF_WIDTH: 0.34, // 弾体の半幅（通常弾より細い＝速さと貫通感）
    SNIPER_TRAIL: 7.0, // 曳光の長さ（後方へ。速さを目で追えるようにする）
    SNIPER_TRAIL_ALPHA: 0.5,
    // 敵G「プリズム」弾：多面体の結晶。残り反射回数ぶんの輪が回る（GDD §5 v0.20）
    PRISM_RADIUS: 1.0, // 結晶の外接半径（当たり判定半径の倍率。実体は判定と同じ大きさに合わせる）
    PRISM_SPIN: 3.2, // 結晶の回転速度 [rad/s]
    PRISM_RING_GAP: 0.9, // 残り反射回数を示す輪の間隔（半径の倍率）
    PRISM_RING_ALPHA: 0.55,
  },

  // 描画バッファ倍率の上限（GDD §9 v0.20）。座標系は変えず描画解像度だけを上げる。
  // 上げるほど輪郭が締まるが、全て図形描画なので塗り面積＝毎フレームのコストがそのまま増える。
  // 2 なら DPR1 のフルHD（必要倍率1.89）は上限に当たらず等倍で描ける。
  // HiDPI では必要倍率に届かないが、素の3.8倍拡大よりは大幅に改善する（性能との折り合い）。
  MAX_RENDER_ZOOM: 2,

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
  SHIELDER_BODY: 0x4d7ea8, // 敵S「シールダー」は鋼青（スチールブルー）系（GDD §6 v0.14）
  SHIELDER_TRACK: 0x2f5470,
  SHIELDER_TURRET: 0xbcd8ef,
  SHIELDER_SHIELD: 0xe2eefa, // 盾（正面の弧）
  VOLLEY_BODY: 0xe0562f, // 敵V「バースター」は橙赤（バーミリオン）系
  VOLLEY_TRACK: 0x93341a,
  VOLLEY_TURRET: 0xffb08f,
  MORTAR_BODY: 0x5f7a3a, // 敵M「ボマー」は深緑（オリーブ）系
  MORTAR_TRACK: 0x3c4f24,
  MORTAR_TURRET: 0xc3e08a,
  SHELL: 0xffd08a, // 榴弾（通常弾と区別できる暖色）
  SHELL_EDGE: 0x9c7134, // 榴弾の輪郭
  SNIPER_BULLET: 0xf0d9ff, // 敵C弾の弾体（敵Cの紫系に合わせた淡い藤色）
  SNIPER_TRAIL: 0xb98bff, // 敵C弾の曳光
  PRISM_BULLET: 0xffd6f5, // 敵G弾の結晶（敵Gのマゼンタ系に合わせる）
  PRISM_BULLET_EDGE: 0xff6fd8, // 敵G弾の稜線・輪
  MISSILE_FLAME: 0xffb347, // 噴射炎（外側の橙）
  MISSILE_FLAME_CORE: 0xfff0c2, // 噴射炎の芯（明るい黄白）
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
  P2_CSS: "#8fe6b0", // 2P の HUD 文字色（戦車の砲塔色に合わせる。CSS 文字列）
  FLOOR_CSS: "#232733", // 背景色（ゲーム設定用 CSS 文字列）
  OVERLAY: 0x0a0c12, // オーバーレイの色（rgba(10,12,18) 相当）
  OVERLAY_ALPHA: 0.65, // オーバーレイの不透明度
} as const;
