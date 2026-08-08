/**
 * BGM（GDD §9 v0.11／v0.20／v0.21）— Web Audio API による自作合成のループ。
 * 外部音源ファイルは使わない（知財ポリシー）。原作の旋律も使わず、進行・旋律とも完全オリジナル。
 *
 * 構成：
 *   リード（旋律。三角波2基＋控えめな矩形波で芯を足し、浅いディレイ＝山びこを掛ける）
 *   ＋ アルペジオ（旋律が休んでいる間だけ和音を分散して鳴らす＝コール＆レスポンス）
 *   ＋ パッド（和音の敷物）＋ ベース ＋ ドラム（テンポの速い曲のみ）
 *
 * v0.21「長く聴いていられる曲」への作り替え（GDD §9）。以前は 1小節（8音）の
 * パターンを延々と繰り返していたため数十秒で耳に付いた。直したのは次の6点：
 *   ① 旋律を4小節（32音）の**フレーズ**単位で持ち、A→B→A→C の16小節形式で並べる
 *   ② HOLD（-98）で音を伸ばし、音の長さを揃えない（緩急＝歌っている感じ）
 *   ③ 拍頭を強く・それ以外を弱くする（一定音量は聴き疲れの原因）
 *   ④ リードの主波形を三角波にする（矩形波は高次倍音が多く長時間で耳に刺さる）
 *   ⑤ 旋律の休符中だけアルペジオで隙間を埋める
 *   ⑥ スウィングで裏拍を少し後ろへずらし、機械的な等間隔を崩す
 *
 * 先読みスケジューリング：setInterval で定期的に起き、少し先（SCHEDULE_AHEAD 秒）までの音を
 * AudioContext の正確な時刻に予約する。JS のタイマー精度に依存せずリズムが揺れない定石の実装。
 *
 * AudioContext は SFX と共有する（ブラウザの自動再生制限に従い、ユーザー操作後の SFX.unlock() が前提）。
 */import { BALANCE } from "../config/balance";
import { SFX } from "./sfx";

/** 曲名（シーンに対応） */
export type BgmTrack = keyof typeof BALANCE.BGM.TRACKS;

const B = BALANCE.BGM;

/** 休符を表す音程値（半音数として使えない値にしてある） */
const REST = -99;
/** 直前の音を伸ばすことを表す値（音符の長さを揃えないための記号） */
const HOLD = -98;

/** ドラムのパターン（1小節内の何ステップ目で鳴らすか）。曲が持たない場合は null */
interface DrumPattern {
  readonly KICK: readonly number[];
  readonly SNARE: readonly number[];
}

/** 半音数 → 周波数 [Hz] */
function semitone(n: number): number {
  return B.ROOT_HZ * 2 ** (n / 12);
}

class BgmEngine {
  private gain: GainNode | null = null; // 全体の出口
  private leadBus: GainNode | null = null; // リード（ディレイ送り）
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

    const cfg = B.TRACKS[track];
    const stepDur = 60 / cfg.TEMPO / 2; // 8分音符の長さ [s]

    this.gain = ctx.createGain();
    this.gain.gain.value = BALANCE.AUDIO.BGM_MASTER;
    this.gain.connect(ctx.destination);

    // リード用のディレイ（山びこ）。旋律だけに掛けて空間を出す
    this.leadBus = ctx.createGain();
    this.leadBus.connect(this.gain);
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = stepDur * B.DELAY_STEPS;
    const fb = ctx.createGain();
    fb.gain.value = B.DELAY_FEEDBACK;
    const wet = ctx.createGain();
    wet.gain.value = B.DELAY_MIX;
    this.leadBus.connect(delay);
    delay.connect(fb).connect(delay); // フィードバックで減衰しながら繰り返す
    delay.connect(wet).connect(this.gain);

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
    if (this.leadBus) {
      this.leadBus.disconnect();
      this.leadBus = null;
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
    const stepDur = 60 / cfg.TEMPO / 2;
    while (this.nextTime < ctx.currentTime + B.SCHEDULE_AHEAD) {
      this.emit(ctx, cfg, this.step, this.nextTime, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  /** 1ステップぶんの音を予約する */
  private emit(
    ctx: AudioContext,
    cfg: (typeof B.TRACKS)[BgmTrack],
    step: number,
    at: number,
    stepDur: number,
  ): void {
    const inBar = step % B.STEPS_PER_BAR;
    const bar = Math.floor(step / B.STEPS_PER_BAR) % B.BARS_PER_LOOP;
    const chord = cfg.PROG[bar % cfg.PROG.length]!;
    // スウィング：裏拍（奇数の8分）を少し後ろへずらし、機械的な等間隔を崩す
    const t = at + (inBar % 2 === 1 ? cfg.SWING * stepDur : 0);

    // --- リード（旋律）：4小節のフレーズを FORM の順（A→B→A→C）に並べる ---
    const stepsPerPhrase = B.STEPS_PER_BAR * B.BARS_PER_PHRASE;
    const form = cfg.FORM[Math.floor(bar / B.BARS_PER_PHRASE) % cfg.FORM.length]!;
    const phrase = cfg.PHRASES[form]!;
    const inPhrase = step % stepsPerPhrase;
    const note = phrase[inPhrase]!;
    if (note !== REST && note !== HOLD) {
      // 後ろに続く HOLD の数だけ音を伸ばす＝音符の長さが揃わず「歌っている」感じになる
      let len = 1;
      while (len < stepsPerPhrase && phrase[(inPhrase + len) % stepsPerPhrase] === HOLD) len++;
      const dur = Math.min(len * stepDur * B.LEAD_GATE, B.LEAD_MAX_DUR);
      // 拍頭は強く、それ以外は弱く（同じ音量が続くと耳が疲れる）
      const vol = B.LEAD_VOL * (inBar % 4 === 0 ? 1 : B.LEAD_SOFT);
      this.lead(ctx, semitone(note), t, dur, vol);
    } else if (note === REST && cfg.ARP) {
      // 旋律が休んでいるときだけ和音を分散して鳴らす（コール＆レスポンス。隙間を埋めつつ濁らせない）
      const iv = chord.TONES[step % chord.TONES.length]!;
      this.arp(ctx, semitone(chord.ROOT + iv + 12), t);
    }

    // --- パッド（和音の敷物）。小節頭にそのコードをふわっと置く ---
    if (inBar === 0) {
      const barDur = stepDur * B.STEPS_PER_BAR;
      for (const iv of chord.TONES) this.pad(ctx, semitone(chord.ROOT + iv), t, barDur);
    }

    // --- ベース（コードの根音から2オクターブ下） ---
    const bassNote = cfg.BASS[inBar % cfg.BASS.length]!;
    if (bassNote !== REST) this.bass(ctx, semitone(chord.ROOT + bassNote - 24), t);

    // --- ドラム（DRUMS を持つ曲のみ）。派手なフィルは入れず一定のグルーヴを保つ ---
    const drums: DrumPattern | null = cfg.DRUMS;
    if (drums) {
      if (drums.KICK.includes(inBar)) this.kick(ctx, t);
      if (drums.SNARE.includes(inBar)) this.snare(ctx, t);
      this.hat(ctx, t, inBar % 2 === 0 ? 1 : B.HAT_SOFT); // 裏拍は弱く＝カチカチ耳に付かない
    }
  }

  /**
   * リード：三角波2基をわずかにずらして厚みを出し、矩形波を小さく重ねて芯を足す。
   * 三角波を主にしているのは、矩形波は高次倍音が多く長時間の再生で耳に刺さるため（GDD §9 v0.21）。
   */
  private lead(ctx: AudioContext, freq: number, at: number, dur: number, vol: number): void {
    if (!this.leadBus) return;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(B.LEAD_CUT0, at);
    filter.frequency.exponentialRampToValueAtTime(B.LEAD_CUT1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + B.LEAD_ATTACK); // 立ち上がりを付けてプチッと鳴らさない
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    filter.connect(g).connect(this.leadBus);
    const voices: [OscillatorType, number, number][] = [
      [B.LEAD_WAVE, -B.LEAD_DETUNE, 1],
      [B.LEAD_WAVE, B.LEAD_DETUNE, 1],
      [B.LEAD_EDGE_WAVE, 0, B.LEAD_EDGE_MIX],
    ];
    for (const [type, detune, mix] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const vg = ctx.createGain();
      vg.gain.value = mix;
      o.connect(vg).connect(filter);
      o.start(at);
      o.stop(at + dur);
    }
  }

  /** アルペジオ：旋律の休符を埋める小さく柔らかい単音（リードと同じディレイに送る） */
  private arp(ctx: AudioContext, freq: number, at: number): void {
    if (!this.leadBus) return;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = B.ARP_CUT;
    const g = ctx.createGain();
    g.gain.setValueAtTime(B.ARP_VOL, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + B.ARP_DUR);
    o.connect(filter).connect(g).connect(this.leadBus);
    o.start(at);
    o.stop(at + B.ARP_DUR);
  }

  /** パッド：小節いっぱい伸びる柔らかい和音（ふわっと入ってふわっと消える） */
  private pad(ctx: AudioContext, freq: number, at: number, dur: number): void {
    if (!this.gain) return;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(B.PAD_VOL, at + B.PAD_ATTACK);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.gain);
    o.start(at);
    o.stop(at + dur);
  }

  /** ベース：ローパスで丸めた低音 */
  private bass(ctx: AudioContext, freq: number, at: number): void {
    if (!this.gain) return;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = B.BASS_CUT;
    const g = ctx.createGain();
    g.gain.setValueAtTime(B.BASS_VOL, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + B.BASS_DUR);
    o.connect(filter).connect(g).connect(this.gain);
    o.start(at);
    o.stop(at + B.BASS_DUR);
  }

  /** キック：サイン波を急激に下げて「ドッ」と鳴らす */
  private kick(ctx: AudioContext, at: number): void {
    if (!this.gain) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(B.KICK_F0, at);
    o.frequency.exponentialRampToValueAtTime(B.KICK_F1, at + B.KICK_DUR);
    const g = ctx.createGain();
    g.gain.setValueAtTime(B.KICK_VOL, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + B.KICK_DUR);
    o.connect(g).connect(this.gain);
    o.start(at);
    o.stop(at + B.KICK_DUR);
  }

  /** スネア：ノイズをバンドパスで抜いた短い破裂音 */
  private snare(ctx: AudioContext, at: number): void {
    this.noiseBurst(ctx, at, B.SNARE_DUR, B.SNARE_VOL, "bandpass", B.SNARE_BAND);
  }

  /** ハイハット：ノイズをハイパスで抜いた極短音（accent＝1で通常、小さいほど弱く） */
  private hat(ctx: AudioContext, at: number, accent: number): void {
    this.noiseBurst(ctx, at, B.HAT_DUR, B.HAT_VOL * accent, "highpass", B.HAT_HIGHPASS);
  }

  /** ノイズを1発鳴らす（スネア・ハイハット共通。バッファは使い回す） */
  private noiseBurst(
    ctx: AudioContext,
    at: number,
    dur: number,
    vol: number,
    filterType: BiquadFilterType,
    freq: number,
  ): void {
    if (!this.gain) return;
    if (!this.noiseBuf) {
      const len = Math.ceil(ctx.sampleRate * 0.3);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(filter).connect(g).connect(this.gain);
    src.start(at);
    src.stop(at + dur);
  }
}

/** BGM のシングルトン（シーンから共用する） */
export const BGM = new BgmEngine();
