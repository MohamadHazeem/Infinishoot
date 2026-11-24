import { loadJson, saveJson, islandHunts } from '../core/storage';
import {
  BOARDS,
  bestFive,
  killBonus,
  rankBand,
  finishChecksum,
  type Finish,
  isBand,
  isBoard,
  normalizeBook,
  positive,
  rankedBoard,
  rankedSeason,
  seasonRules,
  type SeasonBoard,
  type Band,
} from '../data/seasons2';
import { REPLAY_VERSION } from '../dev/replay';
import { onlineServer } from '../net/onlineServer';
import { modSession } from '../mods/manager';
import type { RunSummary } from '../ui/screens';
import { t } from '../i18n';
import { cheats, type Game } from './game';
import { MAX_GEARS, type Hero } from './hero';
import type { Enemy } from './enemies';
import { saveLock } from './save';
import { assistedRun } from './systems/assists';
import { replayHash } from './systems/ci2';
import { customArenaActive } from './systems/editor';
import { challengeState } from './systems/gauntlet';
import { timeState } from './systems/time';
import { trialActive } from './systems/trials';

const BOOK = 'rankedSeasons.v1';
const TOKEN = 'rankedPilot.v1';
export const seasonBook = () => normalizeBook(loadJson(BOOK, null));
function pilotToken(create: boolean): string | null {
  const saved = loadJson<unknown>(TOKEN, null);
  if (typeof saved === 'string' && /^[0-9a-f]{32}$/.test(saved)) return saved;
  if (!create) return null;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  saveJson(TOKEN, token);
  // A blocked/full store cannot recover this identity on the next run.
  return loadJson<unknown>(TOKEN, null) === token ? token : null;
}

async function request(path: string, body?: object) {
  if (!onlineServer) return null;
  try {
    const response = await fetch(onlineServer + path, {
      method: body ? 'POST' : 'GET',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
      ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
export interface Standing {
  pilot: string;
  rank: number;
  points: number;
}
export async function seasonStandings(
  season: number,
  board: SeasonBoard,
): Promise<Standing[] | null> {
  const data = await request(`/seasons2?season=${season}&board=${board}`);
  if (!Array.isArray(data?.rows) || data.season !== season || data.board !== board) return null;
  return data.rows
    .slice(0, 50)
    .filter(
      (r: Standing) =>
        r &&
        typeof r.pilot === 'string' &&
        /^[a-f0-9]{8}$/.test(r.pilot) &&
        positive(r.rank) &&
        positive(r.points),
    );
}
export interface Placement {
  season: number;
  board: SeasonBoard;
  runs: number;
  rank: number | null;
  points: number;
  band: Band | null;
}
export async function syncSeasonHistory(): Promise<Placement[] | null> {
  if (!onlineServer) return null;
  const token = pilotToken(false);
  if (!token) return [];
  const data = await request('/seasons2/history', { token });
  if (!Array.isArray(data?.placements)) return null;
  const rows: Placement[] = data.placements.filter(
    (r: Placement) =>
      r &&
      positive(r.season) &&
      isBoard(r.board) &&
      positive(r.runs) &&
      r.runs <= 5 &&
      (r.runs === 5 ? positive(r.rank) : r.rank === null) &&
      positive(r.points) &&
      (r.band === null ||
        (isBand(r.band) &&
          r.season < rankedSeason() &&
          positive(r.rank) &&
          r.band === rankBand(r.rank))),
  );
  const book = seasonBook();
  for (const row of rows)
    if (
      row.band &&
      row.rank &&
      !book.awards.some((a) => a.season === row.season && a.board === row.board)
    )
      book.awards.push({ season: row.season, board: row.board, rank: row.rank, band: row.band });
  saveJson(BOOK, book);
  return rows;
}
export function wearBand(band: Band): void {
  const book = seasonBook();
  if (book.awards.some((a) => a.band === band)) {
    book.worn = book.worn === band ? null : band;
    saveJson(BOOK, book);
  }
}
export function recordSeasonFinish(f: Finish): void {
  const book = seasonBook();
  let board = book.boards.find((b) => b.season === f.season && b.board === f.board);
  if (!board) {
    board = { season: f.season, board: f.board, runs: [] };
    book.boards.unshift(board);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  board.runs = bestFive(board.runs, {
    key: hex(f.seed) + '-' + hex(f.hash),
    points: f.score + f.bonus,
  });
  saveJson(BOOK, normalizeBook(book));
}
function eligible(g: Game): boolean {
  return (
    g.authority &&
    !g.pvp &&
    !g.versus &&
    !g.race &&
    !g.squadRun &&
    !g.onboarding?.training &&
    !g.stream.settings.enabled &&
    !g.bossMaker.active &&
    (String(g.runMode) === 'abyss' || (!challengeState(g).ascension && !challengeState(g).ng)) &&
    !g.meta.week &&
    !g.meta.points &&
    !islandHunts &&
    !customArenaActive(g) &&
    !trialActive(g) &&
    !assistedRun(g) &&
    !cheats.god &&
    !cheats.unlockAll &&
    modSession.hash === 'vanilla'
  );
}

export class RankedSeasonRun {
  private season = 0;
  private board: SeasonBoard | null = null;
  private rules = seasonRules(1);
  private bonus = 0;
  private seed = 0;
  private suppliedStage = 0;
  private practice = false;
  // One reusable checkpoint, sent only to teammates. Credentials stay on the finishing host.
  private readonly checkpoint = [0, 0, 0, 0, 0];

  snapshot(): number[] | undefined {
    if (!this.board || this.practice) return undefined;
    const packet = this.checkpoint;
    packet[0] = this.seed;
    packet[1] = this.season;
    packet[2] = BOARDS.indexOf(this.board);
    packet[3] = this.bonus;
    packet[4] = this.suppliedStage;
    return packet;
  }

  mirror(g: Game, packet: unknown): void {
    this.practice = false;
    if (
      !Array.isArray(packet) ||
      packet.length !== 5 ||
      packet[0] !== g.seed ||
      !positive(packet[1]) ||
      !Number.isInteger(packet[2]) ||
      !BOARDS[packet[2]] ||
      !Number.isSafeInteger(packet[3]) ||
      packet[3] < 0 ||
      packet[3] > g.kills * 90 ||
      !Number.isSafeInteger(packet[4]) ||
      packet[4] < 0 ||
      packet[4] > g.stage
    ) {
      this.board = null;
      return;
    }
    if (this.season !== packet[1] || !this.board) this.rules = seasonRules(packet[1]);
    this.seed = packet[0];
    this.season = packet[1];
    this.board = BOARDS[packet[2]];
    this.bonus = packet[3];
    this.suppliedStage = packet[4];
  }

  start(g: Game): void {
    this.board = null;
    this.season = rankedSeason();
    const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
    // Replay playback and calendar previews still need the recorded supplies.
    // A chosen seed or forced holiday changes the competition conditions.
    this.practice = query.has('seed') || query.has('season');
    if (
      this.season < 1 ||
      !eligible(g) ||
      saveLock.on ||
      query.has('test')
    )
      return;
    this.board = rankedBoard(g.runMode, g.difficulty.id);
    this.seed = g.seed;
    this.rules = seasonRules(this.season);
    this.bonus = this.suppliedStage = 0;
  }

  checkFairPlay(g: Game): void {
    if (
      this.board &&
      g.authority &&
      (cheats.god ||
        cheats.unlockAll ||
        saveLock.on ||
        g.stream.settings.enabled ||
        g.bossMaker.active ||
        assistedRun(g) ||
        g.race ||
        g.versus ||
        g.pvp)
    )
      this.board = null;
  }

  kill(g: Game, e: Enemy, by: Hero | null): void {
    if (!this.board || !g.authority || g.mode === 'title' || g.seed !== this.seed) return;
    if (by) {
      const dx = by.player.x - e.x,
        dz = by.player.z - e.z;
      this.bonus += killBonus(this.rules, e.exposeT > 0, e.state === 'windup', dx * dx + dz * dz);
    }
    if (e.def.boss && this.suppliedStage !== g.stage) {
      this.suppliedStage = g.stage;
      for (const hero of g.heroes) {
        if (hero.left) continue;
        if (this.rules.supply === 'gear')
          hero.rerollsLeft = Math.min(MAX_GEARS, hero.rerollsLeft + 1);
        else hero.gold += 2;
      }
    }
  }

  bank(g: Game, sum: RunSummary, quit = false): void {
    const board = this.board;
    this.board = null;
    if (
      !board ||
      this.practice ||
      quit ||
      g.seed !== this.seed ||
      !eligible(g) ||
      saveLock.on ||
      g.meta.banked ||
      sum.time < 10 ||
      !positive(sum.score) ||
      rankedBoard(g.runMode, g.difficulty.id) !== board
    )
      return;
    const finish = {
      season: this.season,
      board,
      seed: this.seed,
      difficulty: g.difficulty.id,
      day: g.runDate,
      score: sum.score,
      bonus: this.bonus,
      kills: sum.kills,
      stage: sum.stage,
      time: sum.time,
      hash: replayHash(g),
      replayVersion: REPLAY_VERSION,
    };
    recordSeasonFinish(finish);
    g.hud.toast(
      t('rank.finish', {
        mode: t('rank.' + board),
        total: finish.score + finish.bonus,
        bonus: finish.bonus,
      }),
    );
    if (onlineServer && rankedSeason() === this.season) {
      const token = pilotToken(true);
      if (!token) return;
      void request('/seasons2', {
        ...finish,
        check: finishChecksum(finish),
        version: __APP_VERSION__,
        token,
      }).then((r) => {
        if (!r?.accepted && g.seed === finish.seed) g.hud.toast(t('rank.localFinish'));
      });
    }
  }

  install(g: Game): void {
    // Reuse the time system's circular frames. Rewinding kills also rewinds their
    // ranked points and the boss supply whose gold/gears the timeline restores.
    const timeline = timeState(g).tl;
    const scores = new Map(timeline.frames.map(frame => [frame, { bonus: 0, suppliedStage: 0 }]));
    const record = timeline.record.bind(timeline);
    timeline.record = game => {
      const frame = record(game);
      if (this.board) {
        const score = scores.get(frame)!;
        score.bonus = this.bonus;
        score.suppliedStage = this.suppliedStage;
      }
      return frame;
    };
    const restore = timeline.restore.bind(timeline);
    timeline.restore = (game, frame, mode, next, k) => {
      restore(game, frame, mode, next, k);
      if (mode === 'full' && this.board) {
        const score = scores.get(frame)!;
        this.bonus = score.bonus;
        this.suppliedStage = score.suppliedStage;
      }
    };
    const bank = g.bankAndShow.bind(g);
    g.bankAndShow = (sum, quit) => {
      this.bank(g, sum, quit);
      bank(sum, quit);
    };
  }
}
