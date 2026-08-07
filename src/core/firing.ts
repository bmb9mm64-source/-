/**
 * 発射制御（発射間隔＋同時発射数上限）。Phaser 非依存の純粋 TS。
 */
import { BALANCE } from "../config/balance";
import { type Bullet, type BulletSpawnConfig, liveBulletCount, spawnBullet } from "./bullet";
import type { ParsedStage } from "./stage";

/** 発射制御の調整値 */
export interface FireOptions {
  fireInterval: number; // 発射間隔 [s]
  maxBullets: number; // 同時発射数上限
  bullet?: BulletSpawnConfig; // 弾の生成パラメータ（省略時は BALANCE.BULLET）
  stage?: ParsedStage; // 渡すと砲口位置を壁に入らないよう補正する（GDD §5.3 v0.12）
}

/** tryFire が必要とする最小の射手情報 */
export interface Shooter {
  x: number;
  y: number;
  kind?: string; // "player" ならプレイヤー側（敵弾は敵に当たらない。GDD §5.2 v0.12）
  cooldown: number; // 次弾発射可能までの残り時間 [s]
}

/**
 * 発射を試みる。条件（クールダウン消化・場の自弾数が上限未満）を満たせば
 * 弾を生成して cooldown を設定し true を返す。満たさなければ不発（false）。
 */
export function tryFire(
  shooter: Shooter,
  bullets: Bullet[],
  angle: number,
  opts: FireOptions,
): boolean {
  if (shooter.cooldown > 0) return false;
  if (liveBulletCount(bullets, shooter) >= opts.maxBullets) return false;
  spawnBullet(bullets, shooter, angle, opts.bullet ?? BALANCE.BULLET, opts.stage);
  shooter.cooldown = opts.fireInterval;
  return true;
}
