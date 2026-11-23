import { loadJson, saveJson, islandHunts } from '../core/storage';
import { bestFive, finishChecksum, type Finish, isBand, isBoard, normalizeBook, positive, rankedBoard, rankedSeason, seasonRules, type SeasonBoard, type Band } from '../data/seasons2';
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
import { trialActive } from './systems/trials';

const BOOK = 'rankedSeasons.v1';
const TOKEN = 'rankedPilot.v1';
export const seasonBook = () => normalizeBook(loadJson(BOOK, null));
function pilotToken(): string {
  const saved = loadJson<unknown>(TOKEN, null);
  if (typeof saved === 'string' && /^[0-9a-f]{32}$/.test(saved)) return saved;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  saveJson(TOKEN, token);
  return token;
}

async function request(path: string, body?: object) {
  if (!onlineServer) return null;
  try {
    const response = await fetch(onlineServer + path, {
      method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(6000),
      ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
export interface Standing { pilot: string; rank: number; points: number }
export async function seasonStandings(season: number, board: SeasonBoard): Promise<Standing[] | null> {
  const data = await request(`/seasons2?season=${season}&board=${board}`);
  if (!Array.isArray(data?.rows) || data.season !== season || data.board !== board) return null;
  return data.rows.slice(0,50).filter((r: Standing) => r && /^[a-f0-9]{8}$/.test(r.pilot) && positive(r.rank) && positive(r.points));
}
interface Placement { season: number; board: SeasonBoard; rank: number; points: number; band: Band | null }
export async function syncSeasonHistory(): Promise<Placement[] | null> {
  if (!onlineServer) return null;
  const data = await request('/seasons2/history', { token: pilotToken() });
  if (!Array.isArray(data?.placements)) return null;
  const rows: Placement[] = data.placements.filter((r: Placement) => r && positive(r.season) &&
    isBoard(r.board) && positive(r.rank) && positive(r.points) && (r.band === null || isBand(r.band)));
  const book = seasonBook();
  for (const row of rows) if (row.band && !book.awards.some(a => a.season === row.season && a.board === row.board))
    book.awards.push({ season: row.season, board: row.board, rank: row.rank, band: row.band });
  saveJson(BOOK, book);
  return rows;
}
export function wearBand(band: Band): void {
  const book = seasonBook();
  if (book.awards.some(a => a.band === band)) {
    book.worn = book.worn === band ? null : band;
    saveJson(BOOK, book);
  }
}
export function recordSeasonFinish(f: Finish): void {
  const book = seasonBook();
  let board = book.boards.find(b => b.season === f.season && b.board === f.board);
  if (!board) { board = {season:f.season, board:f.board, runs:[]}; book.boards.unshift(board); }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  board.runs = bestFive(board.runs, { key: hex(f.seed) + '-' + hex(f.hash), points: f.score + f.bonus });
  saveJson(BOOK, normalizeBook(book));
}
function eligible(g: Game): boolean {
  return g.authority && !g.pvp && !g.versus && !g.race && !g.squadRun && !g.onboarding?.training &&
    !g.stream.settings.enabled && (String(g.runMode) === 'abyss' || (!challengeState(g).ascension && !challengeState(g).ng)) &&
    !g.meta.week && !g.meta.points && !islandHunts && !customArenaActive(g) && !trialActive(g) &&
    !assistedRun(g) && !cheats.god && !cheats.unlockAll && modSession.hash === 'vanilla';
}

export class RankedSeasonRun {
  private season = 0;
  private board: SeasonBoard | null = null;
  private rules = seasonRules(1);
  private bonus = 0;
  private supplied = 0;
  private seed = 0;

  start(g: Game): void {
    this.board = null;
    this.season = rankedSeason();
    if (this.season < 1 || !eligible(g) || saveLock.on || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('test'))) return;
    this.board = rankedBoard(g.runMode, g.difficulty.id);
    this.seed = g.seed;
    this.rules = seasonRules(this.season);
    this.bonus = this.supplied = 0;
  }

  checkFairPlay(): void {
    if (this.board && (cheats.god || cheats.unlockAll || saveLock.on)) this.board = null;
  }

  kill(g: Game, e: Enemy, by: Hero | null): void {
    if (!this.board || !g.authority || g.mode === 'title' || !by || g.seed !== this.seed) return;
    const precise = this.rules.precision === 'marked' ? e.exposeT > 0 : e.state === 'windup';
    const dx = by.player.x - e.x, dz = by.player.z - e.z;
    const square = dx * dx + dz * dz;
    if (precise) this.bonus += 60;
    if (this.rules.distance === 'near' ? square <= 16 : square >= 81) this.bonus += 30;
    if (e.def.boss && this.supplied !== g.stage) {
      this.supplied = g.stage;
      for (const h of g.heroes) if (!h.left) {
        if (this.rules.supply === 'gear') h.rerollsLeft = Math.min(MAX_GEARS, h.rerollsLeft + 1);
        else h.gold += 2;
      }
    }
  }

  bank(g: Game, sum: RunSummary, quit = false): void {
    const board = this.board;
    this.board = null;
    if (!board || quit || g.seed !== this.seed || !eligible(g) || saveLock.on || g.meta.banked ||
        sum.time < 10 || !positive(sum.score) || rankedBoard(g.runMode, g.difficulty.id) !== board) return;
    const finish = { season: this.season, board, seed: this.seed, difficulty: g.difficulty.id, day: g.runDate,
      score: sum.score, bonus: this.bonus, kills: sum.kills, stage: sum.stage, time: sum.time,
      hash: replayHash(g), replayVersion: REPLAY_VERSION };
    recordSeasonFinish(finish);
    if (onlineServer && rankedSeason() === this.season) {
      void request('/seasons2', { ...finish, check: finishChecksum(finish), version: __APP_VERSION__, token: pilotToken() }).then(r => {
        if (!r?.accepted && g.seed === finish.seed) g.hud.toast(t('rank.localFinish'));
      });
    }
  }

  install(g: Game): void {
    const bank = g.bankAndShow.bind(g);
    g.bankAndShow = (sum, quit) => { this.bank(g, sum, quit); bank(sum, quit); };
  }
}
