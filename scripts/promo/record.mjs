/**
 * 紹介動画（README 用・30秒）の録画スクリプト（開発用ツール）。
 *
 * 使い方（リポジトリのルートで）：
 *   node scripts/promo/record.mjs scout 2,5,10 1-8   … 下見：各ミッションを種1〜8で遊ばせ、撃破の時刻を表示
 *   node scripts/promo/record.mjs capture             … 本番：下の PLAN どおりに撮って docs/video/ に書き出す
 *
 * 仕組み：Vite の開発サーバで scripts/promo/capture.html を開き、Playwright（ブラウザの自動操作）で
 * 1/60 秒ずつゲームを進めては画面を1コマずつ保存し、ffmpeg（動画の加工ツール）で動画にする。
 * 音はゲームの自作合成音をオフラインで書き出して合わせる（capture.ts の説明を参照）。
 * 必要なもの：playwright と ffmpeg（どちらも package.json には入れていない。撮影する環境に用意する）。
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "docs/video");
const TMP_DIR = process.env.PROMO_TMP ?? path.join(ROOT, "node_modules/.promo");
const FPS = 60;
const W = 1200; // 盤面 800×544 の 1.5 倍
const H = 816;

/**
 * 動画の構成。from＝ミッション開始から数えた撮り始めのコマ、frames＝撮るコマ数（60コマ＝1秒）。
 * ミッションと種（seed）は scout で下見して、跳弾での撃破が続く場面を選んだもの。
 */
const PLAN = [
  { kind: "title", frames: 150 },
  { kind: "play", mission: 8, seed: 1, from: 100, frames: 400, caption: "壁で跳ね返して、撃ち抜け。" },
  { kind: "play", mission: 45, seed: 1, from: 340, frames: 360, caption: "敵は13種。対処法がぜんぶ違う" },
  { kind: "play", mission: 36, seed: 4, from: 560, frames: 270, caption: "全50ミッション ・ 難易度3段階" },
  { kind: "play", mission: 50, seed: 1, from: 190, frames: 380, caption: "最後の第50層には、全13種が待つ。" },
  { kind: "end", frames: 240 },
];
const FADE = 8; // 場面の切り替わりで暗転するコマ数

function parseList(s) {
  return s.split(",").flatMap((part) => {
    const [a, b] = part.split("-").map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
}

async function openPage() {
  const server = await createServer({ root: ROOT, logLevel: "error", server: { port: 5199, strictPort: false } });
  await server.listen();
  const port = server.httpServer.address().port;
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("[page error]", e.message));
  await page.goto(`http://localhost:${port}/scripts/promo/capture.html`);
  await page.waitForFunction(() => window.__promo?.ready === true);
  return { page, close: async () => (await browser.close(), await server.close()) };
}

/** 下見：ミッション×種ごとに最後まで遊ばせて、出来事の時刻（秒）を表示する */
async function scout(missions, seeds) {
  const { page, close } = await openPage();
  for (const m of missions) {
    for (const seed of seeds) {
      const r = await page.evaluate(
        ({ m, seed }) => {
          const p = window.__promo;
          p.startScene("GameScene", { startMission: m }, seed);
          const log = [];
          for (let i = 0; i < 45; i++) {
            log.push(...p.step(60, { bot: true, render: false }));
            if (log.some((l) => l.ev === "missionClear" || l.ev === "playerHit")) break;
          }
          return log;
        },
        { m, seed },
      );
      const t = (f) => (f / 60).toFixed(1);
      const kills = r.filter((l) => l.ev === "kill").map((l) => `${t(l.frame)}s(${l.bounces}回反射)`);
      const end = r.find((l) => l.ev === "missionClear" || l.ev === "playerHit");
      const result = !end ? "時間切れ" : end.ev === "missionClear" ? `クリア ${t(end.frame)}s` : `被弾 ${t(end.frame)}s`;
      console.log(`M${m} seed${seed}: ${result} ／ 撃破 ${kills.join(" ") || "なし"}`);
    }
  }
  await close();
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 失敗:\n${err.slice(-2000)}`))));
  });
}

/** 本番：PLAN どおりに撮る */
async function capture() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
  const silent = path.join(TMP_DIR, "silent.mp4");
  const wav = path.join(TMP_DIR, "audio.wav");
  const { page, close } = await openPage();

  // 画面のコマ（PNG）を ffmpeg へ順に流し込み、まず画質をほぼ落とさない中間ファイルにする
  const ff = spawn(
    "ffmpeg",
    ["-y", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv444p", silent],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let ffErr = "";
  ff.stderr.on("data", (d) => (ffErr += d));
  const ffDone = new Promise((resolve, reject) =>
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 失敗:\n${ffErr.slice(-2000)}`)))),
  );
  let total = 0;
  const shoot = async () => {
    const png = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    total++;
  };
  // 場面の最初と最後だけ暗転させる（0＝そのまま、1＝真っ黒）
  const fadeAt = (i, n) => Math.max(0, 1 - i / FADE, 1 - (n - 1 - i) / FADE);

  await page.evaluate(() => window.__promo.startAudio("title"));
  for (const [idx, clip] of PLAN.entries()) {
    console.log(`撮影中 ${idx + 1}/${PLAN.length}: ${clip.kind}${clip.mission ? ` M${clip.mission}` : ""}`);
    if (clip.kind === "title") {
      await page.evaluate(() => window.__promo.startScene("TitleScene", {}, 1));
    } else if (clip.kind === "play") {
      await page.evaluate(
        ({ m, seed, from }) => {
          const p = window.__promo;
          p.startScene("GameScene", { startMission: m }, seed);
          p.step(from, { bot: true, render: false });
        },
        { m: clip.mission, seed: clip.seed, from: clip.from },
      );
    }
    const seen = [];
    for (let i = 0; i < clip.frames; i++) {
      const log = await page.evaluate(
        ({ clip, i, fade, last }) => {
          const p = window.__promo;
          const log = p.step(1, { bot: true, record: true });
          if (clip.kind === "end") {
            p.endcard(Math.min(1, i / 14));
            p.fade(last ? Math.max(0, 1 - (clip.frames - 1 - i) / 20) : 0); // 最後はゆっくり暗転
          } else {
            p.fade(fade);
            // 字幕は場面の少し後に出て、終わる少し前に消える
            const a = Math.min(1, Math.max(0, (i - 20) / 10), Math.max(0, (clip.frames - 16 - i) / 10));
            p.caption(clip.caption ?? "", clip.caption ? Math.max(0, Math.min(1, a)) : 0);
          }
          return log;
        },
        { clip, i, fade: clip.kind === "end" ? 0 : fadeAt(i, clip.frames), last: idx === PLAN.length - 1 },
      );
      seen.push(...log.filter((l) => l.ev !== "tankDestroyed").map((l) => `${l.ev}@${(i / FPS).toFixed(1)}s`));
      await shoot();
    }
    // 下見どおりの場面が撮れたかの確認用（撃破・クリア・被弾が場面の何秒目に起きたか）
    if (clip.kind === "play") console.log(`  出来事: ${seen.join(" ") || "なし"}`);
  }
  ff.stdin.end();
  await ffDone;
  const seconds = total / FPS;
  const b64 = await page.evaluate((s) => window.__promo.renderAudio(s), seconds);
  writeFileSync(wav, Buffer.from(b64, "base64"));
  await close();

  // 仕上げ：音を合わせて MP4（どのブラウザでも再生できる H.264＋AAC）にする。最後の約1秒で音を絞る
  const mp4 = path.join(OUT_DIR, "promo.mp4");
  await run("ffmpeg", [
    "-y", "-i", silent, "-i", wav,
    "-c:v", "libx264", "-crf", "23", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    // ゲームの音量は控えめに作ってあるので、動画として聞きやすい大きさ（-16 LUFS）へそろえる
    "-af", `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=${seconds - 1.2}:d=1.2`,
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-shortest", mp4,
  ]);
  // README にそのまま表示できる、音なし・小さめの動く画像（アニメーション WebP）
  const webp = path.join(OUT_DIR, "promo.webp");
  await run("ffmpeg", [
    "-y", "-i", silent, "-vf", "fps=20,scale=720:-2:flags=lanczos",
    "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "60", "-compression_level", "6", "-loop", "0", "-an", webp,
  ]);
  console.log(`完了：${seconds.toFixed(1)} 秒 → ${path.relative(ROOT, mp4)} ／ ${path.relative(ROOT, webp)}`);
}

const [mode, a, b] = process.argv.slice(2);
if (mode === "scout") await scout(parseList(a ?? "1"), parseList(b ?? "1-4"));
else if (mode === "capture") await capture();
else console.log("使い方: node scripts/promo/record.mjs scout <ミッション> <種> ／ capture");
