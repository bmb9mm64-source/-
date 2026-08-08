/**
 * BGM（GDD §9 v0.11）— Web Audio API による自作合成のループ。外部音源ファイルは使わない（知財ポリシー）。
 *
 * 構成は3層：
 *   ベース（低音の持続音） ＋ アルペジオ（分散和音のメロディ） ＋ ハイハット（短いノイズ）。
 * 音階はマイナー・ペンタトニック（暗く緊張感のある5音階）。シーンごとにテンポと音型を変える。
 *
 * 先読みスケジューリング：setInterval で定期的に起き、少し先（SCHEDULE_AHEAD 秒）までの音を
 * AudioContext の正確な時刻に予約する。JS のタイマー精度に依存せずリズムが揺れない定石の実装。
 *
 * AudioContext は SFX と共有する（ブラウザの自動再生制限に従い、ユーザー操作後の SFX.unlock() が前提）。
 */
import { BALANCE } from "../config/balance";
import { SFX } from "./sfx";

/** 曲名（シーンに対応） */
export type BgmTrack = keyof typeof BALANCE.BGM.TRACKS;

const B = BALANCE.BGM;

class BgmEngine {
  private gain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private track: BgmTrack | null = null;
  private nextTime = 0; // 次に予約するステップの時刻 [s]（AudioContext 時間）
  private step = 0; // ループ内の通し歩数
  /**
   * ミュートの内訳（GDD §9 v0.17）。実際に鳴るかは masterMuted と userMuted の論理和で決まる。
   * 2つに分けているのは、B で BGM だけ消したあとに M を2回押すと BGM が復活してしまったため
   * （M の解除が B の指定を上書きしていた）。それぞれの意思を別々に覚えて合成する。
   */
  private masterMuted = false; // M キー（効果音と共通のミュート）
  private userMuted = false; // B キー（BGM だけのミュート）

  /** 実際にミュートされているか（どちらか一方でも立っていれば無音） */
  get muted(): boolean {
    return this.masterMuted || this.userMuted;
  }

  /** 現在鳴らしている曲（止まっていれば null） */
  current(): BgmTrack | null {
    return this.track;
  }

  /**
   * 指定の曲を鳴らす。同じ曲が既に鳴っていれば何もしない（シーン再入場でも途切れない）。
   * AudioContext 未初期化（ユーザー操作前）やミュート中は何もしない。
   */
  play(track: BgmTrack): void {
    if (this.muted) {
      this.track = track; // ミュート解除時にこの曲から再開できるよう覚えておく
      return;
    }
    if (this.track === track && this.timer !== null) return;
    this.stop();
    const ctx = SFX.audioContext();
    if (!ctx) return; // 未初期化（＝まだユーザー操作がない）。unlock 後の呼び出しで鳴り始める
    this.track = track;
    this.gain = ctx.createGain();
    this.gain.gain.value = BALANCE.AUDIO.BGM_MASTER;
    this.gain.connect(ctx.destination);
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.08; // わずかな余裕をもって開始
    this.timer = setInterval(() => this.schedule(ctx), B.TICK_MS);
    this.schedule(ctx); // 初回はすぐ予約して発音の遅れをなくす
  }

  /** 停止（予約済みの音も含めて即座に無音化する） */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.gain) {
      this.gain.disconnect();
      this.gain = null;
    }
    this.track = null;
  }

  /** 効果音と共通のミュート（M キー）を設定する */
  setMuted(muted: boolean): void {
    this.applyMute(() => {
      this.masterMuted = muted;
    });
  }

  /** BGM だけのミュート切替（B キー）。切替後の「BGM だけの」ミュート状態を返す */
  toggleMute(): boolean {
    this.applyMute(() => {
      this.userMuted = !this.userMuted;
    });
    return this.userMuted;
  }

  /** ミュート内訳を書き換え、実効状態が変わったときだけ停止・再開する */
  private applyMute(change: () => void): void {
    const before = this.muted;
    change();
    if (this.muted === before) return;
    if (this.muted) {
      const keep = this.track;
      this.stop();
      this.track = keep; // 解除時に同じ曲へ戻れるよう保持
    } else if (this.track) {
      const t = this.track;
      this.track = null;
      this.play(t);
    }
  }

  /** 先読み予約：現在時刻から SCHEDULE_AHEAD 秒先までのステップを予約する */
  private schedule(ctx: AudioContext): void {
    if (!this.track || !this.gain) return;
    const cfg = B.TRACKS[this.track];
    const stepDur = 60 / cfg.TEMPO / 2; // 8分音符の長さ [s]
    while (this.nextTime < ctx.currentTime + B.SCHEDULE_AHEAD) {
      this.emit(ctx, cfg, this.step, this.nextTime);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  /** 1ステップ分の発音を予約する */
  private emit(
    ctx: AudioContext,
    cfg: (typeof B.TRACKS)[BgmTrack],
    step: number,
    at: number,
  ): void {
    const inBar = step % B.STEPS_PER_BAR;
    const bar = Math.floor(step / B.STEPS_PER_BAR) % cfg.BASS.length;

    // --- アルペジオ（-1 は休符） ---
    const degree = cfg.PATTERN[inBar % cfg.PATTERN.length]!;
    if (degree >= 0) {
      const freq = B.SCALE[degree % B.SCALE.length]!;
      this.tone("triangle", freq, at, B.NOTE_DUR, B.ARP_VOL);
    }

    // --- ベース（小節頭と中間で鳴らす） ---
    if (inBar === 0 || inBar === B.STEPS_PER_BAR / 2) {
      const root = B.SCALE[cfg.BASS[bar]! % B.SCALE.length]! * B.BASS_OCTAVE;
      this.tone("sine", root, at, B.BASS_DUR, B.BASS_VOL);
    }

    // --- ハイハット（裏拍。緊張感のある曲のみ） ---
    if (cfg.HAT && inBar % 2 === 1) this.hat(ctx, at);
  }

  /** 単音（減衰するトーン）を予約する */
  private tone(type: OscillatorType, freq: number, at: number, dur: number, vol: number): void {
    const ctx = SFX.audioContext();
    if (!ctx || !this.gain) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    // 立ち上がりを少しなだらかにして耳障りなクリック音を防ぐ
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env).connect(this.gain);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** ハイハット（短いノイズ）を予約する */
  private hat(ctx: AudioContext, at: number): void {
    if (!this.gain) return;
    if (!this.noiseBuf) {
      // ホワイトノイズのバッファを1度だけ作って使い回す
      const len = Math.ceil(ctx.sampleRate * 0.2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; // 低音を削って「チッ」という音にする
    hp.frequency.value = 7000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(B.HAT_VOL, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + B.HAT_DUR);
    src.connect(hp).connect(env).connect(this.gain);
    src.start(at);
    src.stop(at + B.HAT_DUR + 0.01);
  }
}

export const BGM = new BgmEngine();
