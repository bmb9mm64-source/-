/**
 * 紹介動画の撮影ページ（開発用ツール。ゲーム本体からは import しない）。
 *
 * 本物のゲーム（src/ のシーンをそのまま）を起動し、次の3点だけを撮影用に差し替える：
 *   1. 時間 … Phaser の自動ループを止め、1/60 秒ずつ手で進める（コマ落ちの無い動画にするため）
 *   2. 乱数 … Math.random を種つきの乱数にする（同じ種なら同じ展開＝下見した場面を撮り直せる）
 *   3. 音   … AudioContext をオフライン描画用に差し替え、動画の時刻に合わせて書き出す
 * ゲームのルール・敵AI・難易度には手を入れない。操作は scripts/promo/bot.ts のボットが行う。
 *
 * 外から（record.mjs から）は window.__promo の関数を呼んで使う。
 */
import Phaser from "phaser";
import { BGM } from "../../src/audio/bgm";
import { SFX } from "../../src/audio/sfx";
import { BALANCE, COLORS } from "../../src/config/balance";
import type { GameWorld } from "../../src/core/world";
import { AchievementsScene } from "../../src/scenes/AchievementsScene";
import { EditorScene } from "../../src/scenes/EditorScene";
import { GameScene } from "../../src/scenes/GameScene";
import { MissionSelectScene } from "../../src/scenes/MissionSelectScene";
import { RENDER_SCALE, VIEW_H, VIEW_W } from "../../src/scenes/renderScale";
import { TitleScene } from "../../src/scenes/TitleScene";
import { Bot } from "./bot";

const FPS = 60;
const DT_MS = 1000 / FPS;
const SAMPLE_RATE = 48000;
const AUDIO_SECONDS = 34; // 動画（30秒）より少し長く確保しておく

// --- 乱数：ゲーム用（A）と音用（B）を分ける。音を鳴らす・鳴らさないで展開が変わらないように ---
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let gameRng = mulberry32(1);
const audioRng = mulberry32(99);
let useAudioRng = false;
// 関数そのものは一度だけ差し替える（GameWorld が Math.random の参照を握るため）
Math.random = () => (useAudioRng ? audioRng() : gameRng());
function withAudioRng<T>(fn: () => T): T {
  useAudioRng = true;
  try {
    return fn();
  } finally {
    useAudioRng = false;
  }
}

// --- 音：オフライン描画。currentTime を「動画の時刻」に見せかけて、ゲーム側の発音をそのまま予約させる ---
let audioTime = 0; // 動画の先頭からの時刻 [s]（撮影したコマ数で進む）
const offline = new OfflineAudioContext(2, SAMPLE_RATE * AUDIO_SECONDS, SAMPLE_RATE);
const audioProxy = new Proxy(offline, {
  get(target, prop) {
    if (prop === "currentTime") return audioTime;
    if (prop === "state") return "running";
    if (prop === "resume") return () => Promise.resolve();
    const v = Reflect.get(target, prop, target) as unknown;
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  },
});
(window as unknown as { AudioContext: unknown }).AudioContext = function () {
  return audioProxy;
};
// BGM は setInterval で先の音を予約していくが、撮影では時間を手で進めるので自分で呼ぶ
window.setInterval = (() => 1) as unknown as typeof window.setInterval;
window.clearInterval = (() => {}) as typeof window.clearInterval;

/* eslint-disable @typescript-eslint/no-explicit-any */
const bgm = BGM as any;
const sfx = SFX as any;
// 曲の切替：本来は出力を切り離して即無音にするが、オフライン描画では
// 「切り離す」と過去に予約した音まで消えてしまうので、その時刻から音量を絞る形に置き換える
bgm.stop = function (): void {
  if (this.gain) {
    const g = this.gain.gain as AudioParam;
    g.setValueAtTime(g.value, audioTime);
    g.linearRampToValueAtTime(0, audioTime + 0.25);
  }
  this.timer = null;
  this.leadBus = null;
  this.gain = null;
  this.track = null;
};
// 曲の開始はシーンの create() から呼ばれ、中でノイズ（乱数）を作る。ゲーム用の乱数を消費させない
const origBgmPlay = bgm.play.bind(bgm);
bgm.play = (track: unknown) => withAudioRng(() => origBgmPlay(track));
const origSfxPlay = sfx.play.bind(sfx);
sfx.play = (ev: unknown) => withAudioRng(() => origSfxPlay(ev));

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: VIEW_W * RENDER_SCALE,
  height: VIEW_H * RENDER_SCALE,
  backgroundColor: COLORS.FLOOR_CSS,
  render: { antialias: true, preserveDrawingBuffer: true },
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, expandParent: false },
  scene: [TitleScene, GameScene, EditorScene, MissionSelectScene, AchievementsScene],
});

let bot = new Bot();
let now = 0; // 手で進めるゲーム内時計 [ms]
let frameNo = 0; // 現在のシーンを始めてからのコマ数
let lastMission = -1;

function gameScene(): any {
  return game.scene.getScene("GameScene");
}
function activeWorld(): GameWorld | null {
  return game.scene.isActive("GameScene") ? (gameScene().world as GameWorld) : null;
}

export interface StepLog {
  frame: number; // シーン開始からのコマ番号
  ev: string; // 出来事（kill は跳弾回数つき）
  bounces?: number;
}

/** n コマ進める。bot=操作するか／record=動画に載るコマか（音を予約し、動画の時刻を進める） */
function step(n: number, opts: { bot?: boolean; record?: boolean; render?: boolean } = {}): StepLog[] {
  const log: StepLog[] = [];
  const sceneMgr = game.scene as any;
  const origRender = sceneMgr.render;
  if (opts.render === false) sceneMgr.render = () => {};
  sfx.muted = !opts.record;
  for (let i = 0; i < n; i++) {
    const world = activeWorld();
    let playerBullets: { b: any; x: number; y: number }[] = [];
    if (world) {
      if (world.missionIndex !== lastMission || world.status === "banner") {
        if (world.missionIndex !== lastMission) bot.reset(world);
        lastMission = world.missionIndex;
      }
      if (opts.bot) {
        const s = gameScene();
        const out = bot.decide(world, 1 / FPS);
        s.keys.d.isDown = out.moveX > 0;
        s.keys.a.isDown = out.moveX < 0;
        s.keys.s.isDown = out.moveY > 0;
        s.keys.w.isDown = out.moveY < 0;
        s.input.activePointer.position.set(out.cursorX * RENDER_SCALE, out.cursorY * RENDER_SCALE);
        if (out.fire) {
          s.fireRequested = true;
          s.fireBuffer1 = BALANCE.PLAYER.FIRE_BUFFER;
        }
      }
      playerBullets = world.bullets.filter((b) => b.ownerIsPlayer).map((b) => ({ b, x: b.x, y: b.y }));
    }
    now += DT_MS;
    game.step(now, DT_MS);
    frameNo++;
    if (opts.record) {
      audioTime += 1 / FPS;
      if (bgm.timer !== null) withAudioRng(() => bgm.schedule(audioProxy));
    }
    const after = activeWorld();
    if (after) {
      bot.afterStep(after);
      for (const ev of after.events) {
        if (ev === "tankDestroyed" || ev === "playerHit" || ev === "missionClear" || ev === "gameOver") {
          log.push({ frame: frameNo, ev });
        }
      }
      // 撃破した弾が何回跳ね返っていたか（跳弾での撃破を見分けるため）
      if (after.events.includes("tankDestroyed")) {
        for (const d of after.lastDestroyedTanks) {
          let nb = -1;
          for (const pb of playerBullets) {
            if (pb.b.dead && Math.hypot(pb.b.x - d.x, pb.b.y - d.y) < 40) nb = Math.max(nb, pb.b.bounces);
          }
          if (nb >= 0) log.push({ frame: frameNo, ev: "kill", bounces: nb });
        }
      }
    }
  }
  sceneMgr.render = origRender;
  return log;
}

function startScene(key: string, data: object = {}, seed = 1): void {
  gameRng = mulberry32(seed);
  for (const s of game.scene.getScenes(true)) game.scene.stop(s.scene.key);
  game.scene.start(key, data);
  frameNo = 0;
  lastMission = -1;
  bot = new Bot(); // 前の場面の状態を持ち越さない（同じ種なら必ず同じ展開にするため）
}

/** WAV（16bit PCM）に書き出して base64 で返す */
async function renderAudio(seconds: number): Promise<string> {
  const buf = await offline.startRendering();
  const frames = Math.min(buf.length, Math.round(seconds * SAMPLE_RATE));
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  const out = new DataView(new ArrayBuffer(44 + frames * 4));
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  out.setUint32(4, 36 + frames * 4, true);
  str(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 2, true);
  out.setUint32(24, SAMPLE_RATE, true);
  out.setUint32(28, SAMPLE_RATE * 4, true);
  out.setUint16(32, 4, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < 2; c++) {
      const v = Math.max(-1, Math.min(1, ch[c]![i]!));
      out.setInt16(44 + i * 4 + c * 2, Math.round(v * 32767), true);
    }
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const el = (id: string): HTMLElement => document.getElementById(id)!;

const api = {
  ready: false,
  step,
  startScene,
  renderAudio,
  /** 音を鳴らせる状態にして、いま動いているシーンの曲を始める（最初に一度だけ呼ぶ） */
  startAudio(track: "title" | "game"): void {
    SFX.unlock();
    BGM.play(track);
  },
  status(): object {
    const w = activeWorld();
    return w
      ? { status: w.status, mission: w.missionIndex + 1, lives: w.lives, enemies: w.enemiesLeft(), frame: frameNo }
      : { status: "none", frame: frameNo };
  },
  caption(text: string, opacity: number): void {
    const c = el("caption");
    if (text) c.textContent = text;
    c.style.opacity = String(opacity);
  },
  fade(opacity: number): void {
    el("fade").style.opacity = String(opacity);
  },
  endcard(opacity: number): void {
    el("endcard").style.opacity = String(opacity);
  },
};
(window as unknown as { __promo: typeof api }).__promo = api;

// 起動を待って自動ループを止める（以後は step() でだけ進む）
const wait = window.setTimeout;
(function poll(): void {
  if (game.isBooted && game.loop.running && game.scene.isActive("TitleScene")) {
    game.loop.stop();
    api.ready = true;
  } else {
    wait(poll, 20);
  }
})();
