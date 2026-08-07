/**
 * 地雷（GDD §4）。Phaser 非依存の純粋 TS。
 * - 設置：同時 2 個まで（設置者ごと）。
 * - 起爆：設置後 10 秒で自動／敵味方の戦車が半径 40px 内に接近／弾・爆風が触れて誘爆。
 * - 爆風半径 48px：範囲内の全戦車・弾・地雷を巻き込む（自爆あり）。
 *   破壊可能壁 X は爆風で消滅する（タイルを床 '.' に書き換える。GDD §7）。
 * - 誘爆の連鎖は同フレーム内で解決する。
 *
 * 暫定解釈（GDD 未記載・要 game-designer 確認）：
 *   設置者自身は「一度トリガー半径（40px）の外へ出るまで」接近起爆の対象にしない。
 *   GDD の「接近で起爆」を文字通り適用すると、設置した瞬間に足元で起爆して必ず自爆するため。
 *   （自動起爆・誘爆・爆風による自爆は設置者にも通常どおり適用される。）
 *
 * v0.6.1（GDD §4）：接近起爆は**敵対側の戦車のみ**に反応する。
 *   プレイヤーの地雷は敵の接近で、敵の地雷はプレイヤーの接近で起爆（＋一度離れた設置者の再接近）。
 *   同陣営の戦車（敵の地雷×別の敵）では起爆しない。時限起爆・誘爆・爆風の効果範囲は
 *   従来どおり全員に及ぶ（敵地雷をプレイヤーが撃って誘爆させ敵を巻き込む遊びは維持）。
 *   ※修正の背景：M7 で敵ローバーが味方マインレイヤーの地雷を踏み、プレイヤーが何も
 *     しないうちにミッションが自壊クリアする問題が実プレイ検証で発覚したため。
 */
import { BALANCE } from "../config/balance";
import type { Bullet } from "./bullet";
import { type ParsedStage, tileAt } from "./stage";

/** 地雷の調整値（BALANCE.MINE と同形。テストで差し替え可能） */
export interface MineConfig {
  MAX_PER_OWNER: number;
  FUSE_TIME: number;
  TRIGGER_RADIUS: number;
  BLAST_RADIUS: number;
  RADIUS: number;
}

/** 地雷 */
export interface Mine {
  x: number;
  y: number;
  owner: object; // 設置者（同時設置数のカウントと接近起爆の除外に使用）
  ownerIsPlayer: boolean; // 設置者がプレイヤー側か（接近起爆の敵対判定に使用。v0.6.1）
  fuse: number; // 自動起爆までの残り時間 [s]
  ownerClear: boolean; // 設置者が一度トリガー半径外へ出たか（出るまで設置者では起爆しない）
  dead: boolean;
}

/** 爆風の対象となる戦車の最小情報（プレイヤー・敵で共用） */
export interface MineTarget {
  x: number;
  y: number;
  radius: number; // 対弾用の円近似半径 [px]（爆風判定にも使用）
  alive: boolean;
  kind?: string; // "player" ならプレイヤー側（接近起爆の敵対判定。未指定は敵対扱い＝旧挙動）
}

/** 爆発イベント（効果音・画面演出用の座標） */
export interface Explosion {
  x: number;
  y: number;
}

/** updateMines の結果 */
export interface MineUpdateResult {
  explosions: Explosion[]; // このフレームで起きた爆発（連鎖分を含む）
  wallsDestroyed: number; // 爆風で消滅した破壊可能壁 X の枚数
}

/** owner が場に置いている生存地雷の数 */
export function liveMineCount(mines: readonly Mine[], owner: object): number {
  let n = 0;
  for (const m of mines) if (!m.dead && m.owner === owner) n++;
  return n;
}

/**
 * 地雷の設置を試みる。同時設置上限（設置者ごとに 2 個）未満なら
 * owner の現在位置に設置して Mine を返す。上限なら null（不発）。
 */
export function tryPlaceMine(
  mines: Mine[],
  owner: { x: number; y: number; kind?: string },
  cfg: MineConfig = BALANCE.MINE,
): Mine | null {
  if (liveMineCount(mines, owner) >= cfg.MAX_PER_OWNER) return null;
  const m: Mine = {
    x: owner.x,
    y: owner.y,
    owner,
    ownerIsPlayer: owner.kind === "player",
    fuse: cfg.FUSE_TIME,
    ownerClear: false,
    dead: false,
  };
  mines.push(m);
  return m;
}

/** 爆心 (x,y) の爆風円と重なる破壊可能壁 X を床に変える。消した枚数を返す */
function destroyXTiles(stage: ParsedStage, x: number, y: number, radius: number): number {
  const t = stage.tile;
  const c0 = Math.floor((x - radius) / t);
  const c1 = Math.floor((x + radius) / t);
  const r0 = Math.floor((y - radius) / t);
  const r1 = Math.floor((y + radius) / t);
  let destroyed = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (tileAt(stage, c, r) !== "X") continue;
      // 円とタイル矩形（AABB）の判定：円中心を矩形にクランプして距離を比較
      const nx = Math.max(c * t, Math.min(x, c * t + t));
      const ny = Math.max(r * t, Math.min(y, r * t + t));
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < radius * radius) {
        stage.grid[r]![c] = "."; // 破壊可能壁を床に変える（GDD §7）
        destroyed++;
      }
    }
  }
  return destroyed;
}

/**
 * 地雷の更新（1フレーム分）。起爆判定 → 爆発の連鎖解決の順に処理する。
 * 戦車は alive=false、弾は dead=true に書き換える（撃破の集計は呼び出し側の責務）。
 * 消滅した地雷（dead）の配列からの除去も呼び出し側で行う。
 */
export function updateMines(
  mines: Mine[],
  dt: number,
  tanks: readonly MineTarget[],
  bullets: readonly Bullet[],
  stage: ParsedStage,
  cfg: MineConfig = BALANCE.MINE,
): MineUpdateResult {
  const toExplode: Mine[] = [];

  // --- 起爆判定（自動起爆・接近起爆・弾の接触） ---
  for (const m of mines) {
    if (m.dead) continue;

    // 設置後 10 秒で自動起爆
    m.fuse -= dt;
    if (m.fuse <= 0) {
      m.dead = true;
      toExplode.push(m);
      continue;
    }

    // 接近起爆（v0.6.1）：敵対側の戦車のみ反応（＋一度離れた設置者の再接近）。
    // 同陣営（敵の地雷×別の敵）では起爆しない。kind 未指定の対象は敵対扱い（旧挙動互換）。
    let triggered = false;
    for (const t of tanks) {
      if (!t.alive) continue;
      const dx = t.x - m.x;
      const dy = t.y - m.y;
      const inRange = dx * dx + dy * dy < cfg.TRIGGER_RADIUS * cfg.TRIGGER_RADIUS;
      if (t === m.owner) {
        if (!inRange) m.ownerClear = true;
        else if (m.ownerClear) triggered = true; // 一度離れた設置者が戻ってきた
      } else if (inRange) {
        const hostile = t.kind === undefined || (t.kind === "player") !== m.ownerIsPlayer;
        if (hostile) triggered = true;
      }
    }

    // 弾が触れて誘爆
    if (!triggered) {
      for (const b of bullets) {
        if (b.dead) continue;
        const dx = b.x - m.x;
        const dy = b.y - m.y;
        const rr = cfg.RADIUS + b.radius;
        if (dx * dx + dy * dy < rr * rr) {
          triggered = true;
          break;
        }
      }
    }

    if (triggered) {
      m.dead = true;
      toExplode.push(m);
    }
  }

  // --- 爆発の解決（誘爆の連鎖は同フレーム内でキューを回して処理） ---
  const result: MineUpdateResult = { explosions: [], wallsDestroyed: 0 };
  while (toExplode.length > 0) {
    const m = toExplode.pop()!;
    result.explosions.push({ x: m.x, y: m.y });
    const blast = cfg.BLAST_RADIUS;

    // 範囲内の全戦車を撃破（敵味方を問わない＝自爆あり）
    for (const t of tanks) {
      if (!t.alive) continue;
      const dx = t.x - m.x;
      const dy = t.y - m.y;
      const rr = blast + t.radius;
      if (dx * dx + dy * dy < rr * rr) t.alive = false;
    }

    // 範囲内の弾を消滅させる
    for (const b of bullets) {
      if (b.dead) continue;
      const dx = b.x - m.x;
      const dy = b.y - m.y;
      const rr = blast + b.radius;
      if (dx * dx + dy * dy < rr * rr) b.dead = true;
    }

    // 破壊可能壁 X を消滅させる（タイルを床に変える）
    result.wallsDestroyed += destroyXTiles(stage, m.x, m.y, blast);

    // 範囲内の他の地雷を誘爆させる（連鎖）
    for (const other of mines) {
      if (other.dead) continue;
      const dx = other.x - m.x;
      const dy = other.y - m.y;
      const rr = blast + cfg.RADIUS;
      if (dx * dx + dy * dy < rr * rr) {
        other.dead = true;
        toExplode.push(other);
      }
    }
  }
  return result;
}
