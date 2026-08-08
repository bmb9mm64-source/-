/**
 * 効果音 — Web Audio API による自作合成のみ（外部音源ファイル不使用＝知財ポリシー。GDD §9）。
 * オシレーター（発振器）とノイズバッファをその場で生成して鳴らす。
 * AudioContext はブラウザの自動再生制限のため、ユーザー操作（クリック等）後に
 * unlock() で初期化する。M キーでミュート切替（シーン側から toggleMute を呼ぶ）。
 * 音量は BALANCE.AUDIO に集約（マスター音量で全体を控えめに統一）。
 */
import { BALANCE } from "../config/balance";
import type { WorldEvent } from "../core/world";

/**
 * 合成パラメータ（周波数 Hz・時間 s）。ゲームバランスではなく音色の定義なので
 * balance.ts ではなく本ファイルに名前付きで集約する（マジックナンバー禁止の趣旨は維持）。
 */
const P = {
  // 射撃（v0.20）：単発の矩形波スイープだけだと「ピュン」と安っぽいので3層で作る。
  //   ① 低音のボディ … 発射の重さ（腹に来る成分）
  //   ② ノイズのアタック … 火薬の破裂感。ローパスを閉じて「バッ」と短く
  //   ③ 高音のクリック … 立ち上がりの鋭さ（無いと鈍く聞こえる）
  FIRE: {
    BODY_TYPE: "triangle" as OscillatorType,
    BODY_F0: 320,
    BODY_F1: 70,
    BODY_DUR: 0.18,
    NOISE_DUR: 0.09,
    NOISE_CUT0: 3800,
    NOISE_CUT1: 400,
    NOISE_VOL: 0.9, // FIRE 音量に対する比
    CLICK_TYPE: "square" as OscillatorType,
    CLICK_F0: 1500,
    CLICK_F1: 600,
    CLICK_DUR: 0.035,
    CLICK_VOL: 0.35,
  },
  BOUNCE: { TYPE: "triangle" as OscillatorType, F0: 900, F1: 500, DUR: 0.06 },
  CANCEL: { TYPE: "square" as OscillatorType, F0: 1200, F1: 200, DUR: 0.09 },
  DESTROY: { NOISE_DUR: 0.35, CUT0: 1200, CUT1: 100, RUMBLE_F0: 110, RUMBLE_F1: 40, RUMBLE_DUR: 0.3 },
  MINE_PLACE: { TYPE: "sine" as OscillatorType, F0: 300, F1: 220, DUR: 0.08 },
  MINE_EXPLODE: { NOISE_DUR: 0.5, CUT0: 900, CUT1: 80, RUMBLE_F0: 90, RUMBLE_F1: 35, RUMBLE_DUR: 0.4 },
  CLEAR: { TYPE: "triangle" as OscillatorType, NOTES: [523.25, 659.25, 783.99], STEP: 0.13, DUR: 0.24 }, // ド・ミ・ソ（C5-E5-G5）
  GAMEOVER: { TYPE: "triangle" as OscillatorType, NOTES: [392.0, 311.13, 261.63, 196.0], STEP: 0.2, DUR: 0.3 }, // 下降音形
  ENV_FLOOR: 0.001, // 減衰エンベロープの下限ゲイン（exponentialRamp は 0 を指定できない）
  MIN_FREQ: 1, // exponentialRamp の周波数下限
} as const;

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** ユーザー操作（クリック・キー押下）後に呼ぶ。AudioContext を生成／再開する */
  unlock(): void {
    if (typeof AudioContext === "undefined") return; // テスト環境など Web Audio 非対応時は無音
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = BALANCE.AUDIO.MASTER;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** ミュート切替（M キー）。切替後の状態を返す */
  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  /**
   * BGM など他モジュールが同じ AudioContext を共有するためのアクセサ。
   * （未初期化なら null。BGM は自前の GainNode を destination へつなぐ）
   */
  audioContext(): AudioContext | null {
    return this.ctx;
  }

  /** 発音可能なら出力先を返す（未初期化・ミュート時は null） */
  private out(): { ctx: AudioContext; master: GainNode } | null {
    if (!this.ctx || !this.master || this.muted) return null;
    return { ctx: this.ctx, master: this.master };
  }

  /** 単音：周波数 f0→f1 へスイープしつつ減衰するトーン */
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const o = this.out();
    if (!o) return;
    const t0 = o.ctx.currentTime + delay;
    const osc = o.ctx.createOscillator();
    const gain = o.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(f0, P.MIN_FREQ), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, P.MIN_FREQ), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(P.ENV_FLOOR, t0 + dur);
    osc.connect(gain).connect(o.master);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  /** ノイズ：ローパスフィルタ（高音を削る）を cut0→cut1 へ絞りながら減衰させる爆発音の素 */
  private noise(dur: number, vol: number, cut0: number, cut1: number): void {
    const o = this.out();
    if (!o) return;
    const t0 = o.ctx.currentTime;
    const len = Math.ceil(o.ctx.sampleRate * dur);
    const buf = o.ctx.createBuffer(1, len, o.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = o.ctx.createBufferSource();
    src.buffer = buf;
    const filter = o.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cut0, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(cut1, P.MIN_FREQ), t0 + dur);
    const gain = o.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(P.ENV_FLOOR, t0 + dur);
    src.connect(filter).connect(gain).connect(o.master);
    src.start(t0);
  }

  /** 射撃（低音ボディ＋ノイズのアタック＋高音クリックの3層。GDD §9 v0.20） */
  fire(): void {
    const c = P.FIRE;
    const v = BALANCE.AUDIO.FIRE;
    this.tone(c.BODY_TYPE, c.BODY_F0, c.BODY_F1, c.BODY_DUR, v);
    this.noise(c.NOISE_DUR, v * c.NOISE_VOL, c.NOISE_CUT0, c.NOISE_CUT1);
    this.tone(c.CLICK_TYPE, c.CLICK_F0, c.CLICK_F1, c.CLICK_DUR, v * c.CLICK_VOL);
  }

  /** 跳弾反射 */
  bounce(): void {
    this.tone(P.BOUNCE.TYPE, P.BOUNCE.F0, P.BOUNCE.F1, P.BOUNCE.DUR, BALANCE.AUDIO.BOUNCE);
  }

  /** 弾同士の相殺 */
  cancel(): void {
    this.tone(P.CANCEL.TYPE, P.CANCEL.F0, P.CANCEL.F1, P.CANCEL.DUR, BALANCE.AUDIO.CANCEL);
  }

  /** 戦車撃破／被弾の爆発 */
  destroy(): void {
    const c = P.DESTROY;
    this.noise(c.NOISE_DUR, BALANCE.AUDIO.DESTROY, c.CUT0, c.CUT1);
    this.tone("sine", c.RUMBLE_F0, c.RUMBLE_F1, c.RUMBLE_DUR, BALANCE.AUDIO.DESTROY);
  }

  /** 地雷設置 */
  minePlace(): void {
    const c = P.MINE_PLACE;
    this.tone(c.TYPE, c.F0, c.F1, c.DUR, BALANCE.AUDIO.MINE_PLACE);
  }

  /** 地雷起爆（戦車撃破よりひと回り大きい爆発） */
  mineExplode(): void {
    const c = P.MINE_EXPLODE;
    this.noise(c.NOISE_DUR, BALANCE.AUDIO.MINE_EXPLODE, c.CUT0, c.CUT1);
    this.tone("sine", c.RUMBLE_F0, c.RUMBLE_F1, c.RUMBLE_DUR, BALANCE.AUDIO.MINE_EXPLODE);
  }

  /** ミッションクリア（上昇アルペジオ＝分散和音） */
  missionClear(): void {
    const c = P.CLEAR;
    c.NOTES.forEach((f, i) => {
      this.tone(c.TYPE, f, f, c.DUR, BALANCE.AUDIO.CLEAR, i * c.STEP);
    });
  }

  /** ゲームオーバー（下降音形） */
  gameOver(): void {
    const c = P.GAMEOVER;
    c.NOTES.forEach((f, i) => {
      this.tone(c.TYPE, f, f, c.DUR, BALANCE.AUDIO.GAMEOVER, i * c.STEP);
    });
  }

  /** ワールドの出来事イベントを対応する効果音に振り分ける */
  play(event: WorldEvent): void {
    switch (event) {
      case "fire":
        this.fire();
        break;
      case "bounce":
        this.bounce();
        break;
      case "cancel":
        this.cancel();
        break;
      case "shieldBlock":
        // 盾で弾かれた音（相殺音を低めに鳴らして「無効化された」ことを伝える）
        this.cancel();
        break;
      case "tankDestroyed":
      case "playerHit":
        this.destroy();
        break;
      case "minePlaced":
        this.minePlace();
        break;
      case "mineExploded":
        this.mineExplode();
        break;
      case "missionClear":
      case "allClear":
        this.missionClear();
        break;
      case "gameOver":
        this.gameOver();
        break;
    }
  }
}

/** 効果音のシングルトン（シーンから共用する） */
export const SFX = new SfxEngine();
