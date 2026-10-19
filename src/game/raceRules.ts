/**
 * Race lane rules (no Game access, unit tested in tests/race.test.ts):
 * - RACE standings: progress through one stage (timer, then the boss), finish times, places.
 * - CHALLENGE A FRIEND codes: a finished run's setup and score as a short text code.
 * - LOCAL TOURNAMENT brackets: 4-8 names, byes, results, champion.
 */
import { HEROES } from '../data/heroes';
import { loadoutOptions, type Loadout } from '../data/loadout';
import { DIFFICULTIES } from '../data/modes';

export const raceTuning = {
  /** Race clock limit (seconds, from the start, menus included): furthest wins after it. */
  limit: 7 * 60,
  /** Clients report progress this often (seconds); the host shares the board at the same rate. */
  report: 0.5,
  /** Seconds the results stay before anyone can leave (stops a mashed button skipping them). */
  resultsLock: 1.2,
  /** Seconds left on the clock when the "final minute" cue plays. */
  finalCue: 60,
};

// ---------------------------------------------------------------- race standings

export type RaceStatus = 'run' | 'boss' | 'done' | 'ko' | 'left';

/** One racer on the board (also the wire format: short keys). */
export interface RaceRow {
  /** Name. */
  n: string;
  /** Colour (hex). */
  c: string;
  /** Progress 0..2: 0-1 the stage timer, 1-2 the boss's lost life, 2 finished. */
  p: number;
  s: RaceStatus;
  /** Race clock when finished or knocked out (seconds), else the latest report time. */
  t: number;
  /** Boss life left 0..1 (-1 = no boss yet). */
  b: number;
  lv: number;
  /** Ranked rating (-1 unknown). */
  r: number;
}

/** Progress value for one machine's own run. */
export function raceProgress(stageTime: number, duration: number, bossFrac: number, finished: boolean): number {
  if (finished) return 2;
  if (bossFrac >= 0) return 1 + Math.max(0, Math.min(1, 1 - bossFrac)) * 0.999;
  return Math.max(0, Math.min(1, duration > 0 ? stageTime / duration : 0)) * 0.999;
}

/** Order: finishers by time, then furthest progress, then standing over knocked out. */
export function compareRows(a: RaceRow, b: RaceRow): number {
  const fa = a.s === 'done';
  const fb = b.s === 'done';
  if (fa !== fb) return fa ? -1 : 1;
  if (fa && fb && a.t !== b.t) return a.t - b.t;
  if (Math.abs(a.p - b.p) > 1e-6) return b.p - a.p;
  const da = a.s === 'ko' || a.s === 'left';
  const db = b.s === 'ko' || b.s === 'left';
  if (da !== db) return da ? 1 : -1;
  if (da && db && a.t !== b.t) return b.t - a.t; // lasted longer
  return 0;
}

/** Rows sorted best first with 1-based places (equal rows share a place). */
export function standings(rows: RaceRow[]): { row: RaceRow; place: number }[] {
  const sorted = [...rows].sort((a, b) => compareRows(a, b) || a.n.localeCompare(b.n));
  const out: { row: RaceRow; place: number }[] = [];
  sorted.forEach((row, i) => {
    const prev = out[i - 1];
    out.push({ row, place: prev && compareRows(prev.row, row) === 0 ? prev.place : i + 1 });
  });
  return out;
}

/** The race ends when someone beats the boss, nobody is left racing, or the clock runs out. */
export function raceOver(rows: RaceRow[], clock: number, limit = raceTuning.limit): boolean {
  if (!rows.length) return false;
  if (rows.some((r) => r.s === 'done')) return true;
  if (rows.every((r) => r.s === 'ko' || r.s === 'left')) return true;
  return clock >= limit;
}

export function fmtClock(s: number): string {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What a rival row says on the HUD and the results. */
export function rowLabel(r: RaceRow): string {
  switch (r.s) {
    case 'done':
      return `FINISHED ${fmtClock(r.t)}`;
    case 'ko':
      return `K.O. · ${progressText(r.p)}`;
    case 'left':
      return 'LEFT';
    case 'boss':
      return `BOSS ${Math.round(Math.max(0, r.b) * 100)}% LEFT`;
    default:
      return progressText(r.p);
  }
}

function progressText(p: number): string {
  if (p >= 2) return 'BOSS DOWN';
  if (p >= 1) return `BOSS ${Math.round((p - 1) * 100)}% DOWN`;
  return `STAGE ${Math.round(p * 100)}%`;
}

/** Clean a wire row (clients and the host never trust each other's numbers to be in range). */
export function cleanRow(raw: unknown): RaceRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const s = (['run', 'boss', 'done', 'ko', 'left'] as const).find((x) => x === o.s) ?? 'run';
  const n = Number(o.p);
  const color = typeof o.c === 'string' && /^#[0-9a-f]{3,6}$/i.test(o.c) ? o.c : '#f4f4f4';
  return {
    n: String(o.n ?? 'Player').replace(/[\u0000-\u001f<>&"]/g, '').slice(0, 12) || 'Player',
    c: color,
    p: Number.isFinite(n) ? Math.max(0, Math.min(2, n)) : 0,
    s,
    t: Math.max(0, Math.min(36000, Number(o.t) || 0)),
    b: Math.max(-1, Math.min(1, Number.isFinite(Number(o.b)) ? Number(o.b) : -1)),
    lv: Math.max(1, Math.min(999, Math.floor(Number(o.lv) || 1))),
    r: Math.max(-1, Math.min(4000, Math.round(Number.isFinite(Number(o.r)) ? Number(o.r) : -1))),
  };
}

// ---------------------------------------------------------------- challenge codes

export type ChallengeMode = 'standard' | 'endless' | 'bossrush';
export const CHALLENGE_MODES: readonly ChallengeMode[] = ['standard', 'endless', 'bossrush'];

export interface Challenge {
  seed: number;
  mode: ChallengeMode;
  difficulty: string;
  hero: string;
  loadout: Loadout;
  score: number;
  stage: number;
  /** Who set the score. */
  name: string;
}

const CODE_HEAD = 'IS1';
const MODE_LETTER: Record<ChallengeMode, string> = { standard: 's', endless: 'e', bossrush: 'b' };

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1679616).toString(36).padStart(4, '0'); // 4 base-36 characters
}

/** Names travel as letters, digits and underscores (spaces become underscores). */
export function codeName(name: string): string {
  return name.normalize('NFKD').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/[\s-]+/g, '_').slice(0, 12) || 'Player';
}

/** "IS1.<seed>.<mode><diff>.<hero>.<left>.<right>.<special>.<score>.<stage>.<name>.<check>" (numbers in base 36). */
export function encodeChallenge(c: Challenge): string {
  const body = [
    CODE_HEAD,
    (c.seed >>> 0).toString(36),
    MODE_LETTER[c.mode] + c.difficulty,
    c.hero,
    c.loadout.primary,
    c.loadout.secondary,
    c.loadout.special,
    Math.max(0, Math.floor(c.score)).toString(36),
    String(Math.max(1, Math.floor(c.stage))),
    codeName(c.name),
  ].join('.');
  return `${body}.${fnv(body)}`;
}

/** Read a pasted code (spaces, line breaks and surrounding text are ignored). Throws a readable error. */
export function decodeChallenge(text: string): Challenge {
  const m = /IS1\.[A-Za-z0-9._-]+/.exec(String(text ?? '').replace(/\s+/g, ''));
  if (!m) throw new Error('THAT IS NOT A CHALLENGE CODE.');
  const parts = m[0].split('.');
  if (parts.length !== 11) throw new Error('THE CODE IS INCOMPLETE.');
  const sum = parts.pop()!;
  if (fnv(parts.join('.')) !== sum.toLowerCase()) throw new Error('THE CODE IS DAMAGED (A LETTER IS WRONG OR MISSING).');
  const [, seed36, md, hero, primary, secondary, special, score36, stage, name] = parts;
  const mode = CHALLENGE_MODES.find((k) => MODE_LETTER[k] === md[0]);
  const difficulty = md.slice(1);
  if (!mode || !DIFFICULTIES.some((d) => d.id === difficulty)) throw new Error('THAT CODE USES A MODE THIS VERSION DOES NOT HAVE.');
  if (!HEROES.some((h) => h.id === hero)) throw new Error('THAT CODE USES A HERO THIS VERSION DOES NOT HAVE.');
  if (!loadoutOptions('primary').includes(primary) || !loadoutOptions('secondary').includes(secondary) || !loadoutOptions('special').includes(special))
    throw new Error('THAT CODE USES A WEAPON THIS VERSION DOES NOT HAVE.');
  const seed = parseInt(seed36, 36);
  const score = parseInt(score36, 36);
  if (!Number.isFinite(seed) || !Number.isFinite(score)) throw new Error('THE CODE IS DAMAGED.');
  return { seed: seed >>> 0, mode, difficulty, hero, loadout: { primary, secondary, special }, score, stage: Math.max(1, Number(stage) || 1), name: name.replace(/_/g, ' ') };
}

// ---------------------------------------------------------------- local tournament

export type TourneyKind = 'race' | 'pvp';
/** A finished hot-seat race turn. */
export interface TurnResult {
  p: number;
  /** Finish time (or time survived). */
  t: number;
  score: number;
}
export interface TMatch {
  /** Player indexes into `names`; -1 = bye, -2 = winner of an earlier match not known yet. */
  a: number;
  b: number;
  /** Winner's player index, -1 while open. */
  w: number;
  ra?: TurnResult;
  rb?: TurnResult;
}
export interface Tourney {
  kind: TourneyKind;
  names: string[];
  seed: number;
  rounds: TMatch[][];
  champion: number;
}

export const TOURNEY_MIN = 4;
export const TOURNEY_MAX = 8;

/** Bracket order by seed (1 v 8, 4 v 5, 2 v 7, 3 v 6), so byes fall to the top seeds. */
const ORDER: Record<number, number[]> = { 4: [0, 3, 1, 2], 8: [0, 7, 3, 4, 1, 6, 2, 5] };

export function cleanName(s: string): string {
  return String(s ?? '').replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, 12);
}

export function createTourney(names: string[], kind: TourneyKind, seed: number): Tourney {
  const list = names.map(cleanName).filter(Boolean);
  if (list.length < TOURNEY_MIN || list.length > TOURNEY_MAX) throw new Error(`A TOURNAMENT NEEDS ${TOURNEY_MIN} TO ${TOURNEY_MAX} PLAYERS.`);
  const lower = list.map((n) => n.toLowerCase());
  if (new Set(lower).size !== lower.length) throw new Error('EVERY PLAYER NEEDS A DIFFERENT NAME.');
  const size = list.length <= 4 ? 4 : 8;
  const order = ORDER[size];
  const first: TMatch[] = [];
  for (let i = 0; i < size; i += 2) {
    const a = order[i] < list.length ? order[i] : -1;
    const b = order[i + 1] < list.length ? order[i + 1] : -1;
    first.push({ a, b, w: -1 });
  }
  const rounds: TMatch[][] = [first];
  for (let n = size / 4; n >= 1; n /= 2) rounds.push(Array.from({ length: n }, () => ({ a: -2, b: -2, w: -1 })));
  const t: Tourney = { kind, names: list, seed: seed >>> 0, rounds, champion: -1 };
  first.forEach((m, i) => {
    if (m.a >= 0 && m.b < 0) recordWin(t, 0, i, m.a);
    else if (m.b >= 0 && m.a < 0) recordWin(t, 0, i, m.b);
  });
  return t;
}

/** Record a match winner (a player index) and move them on. */
export function recordWin(t: Tourney, round: number, match: number, winner: number): void {
  const m = t.rounds[round]?.[match];
  if (!m || m.w >= 0 || (winner !== m.a && winner !== m.b) || winner < 0) return;
  m.w = winner;
  if (round === t.rounds.length - 1) {
    t.champion = winner;
    return;
  }
  const next = t.rounds[round + 1][match >> 1];
  if (match % 2 === 0) next.a = winner;
  else next.b = winner;
}

/** The next match to play (both players known, no winner yet), or null when it's over. */
export function nextMatch(t: Tourney): { round: number; match: number; m: TMatch } | null {
  for (let r = 0; r < t.rounds.length; r++)
    for (let i = 0; i < t.rounds[r].length; i++) {
      const m = t.rounds[r][i];
      if (m.w < 0 && m.a >= 0 && m.b >= 0) return { round: r, match: i, m };
    }
  return null;
}

export function roundName(t: Tourney, round: number): string {
  const left = t.rounds.length - round;
  return left === 1 ? 'FINAL' : left === 2 ? 'SEMI-FINALS' : left === 3 ? 'QUARTER-FINALS' : `ROUND ${round + 1}`;
}

/** Each match plays its own seed, the same for both players. */
export function matchSeed(t: Tourney, round: number, match: number): number {
  let h = (t.seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (round + 1), 2654435761) >>> 0;
  h = Math.imul(h ^ (match + 17), 1597334677) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Hot-seat race: further wins; both finished, faster wins; then score; a dead heat goes to the higher seed (a). */
export function turnWinner(a: TurnResult, b: TurnResult): 'a' | 'b' {
  if (Math.abs(a.p - b.p) > 1e-6) return a.p > b.p ? 'a' : 'b';
  if (a.p >= 2 && a.t !== b.t) return a.t < b.t ? 'a' : 'b';
  if (a.score !== b.score) return a.score > b.score ? 'a' : 'b';
  return 'a';
}

/** Store one hot-seat turn; when both are in, the winner moves on. Returns who won (or null while waiting). */
export function recordTurn(t: Tourney, round: number, match: number, side: 'a' | 'b', r: TurnResult): number | null {
  const m = t.rounds[round]?.[match];
  if (!m || m.w >= 0) return null;
  if (side === 'a') m.ra = r;
  else m.rb = r;
  if (!m.ra || !m.rb) return null;
  const w = turnWinner(m.ra, m.rb) === 'a' ? m.a : m.b;
  recordWin(t, round, match, w);
  return w;
}

/** An online match ended: if the open match is between the winner and one of the losers, record it. */
export function autoRecord(t: Tourney, winner: string, players: string[]): { round: number; match: number } | null {
  const nm = nextMatch(t);
  if (!nm) return null;
  const low = (s: string) => s.trim().toLowerCase();
  const names = players.map(low);
  const a = low(t.names[nm.m.a]);
  const b = low(t.names[nm.m.b]);
  if (!names.includes(a) || !names.includes(b)) return null;
  const w = low(winner) === a ? nm.m.a : low(winner) === b ? nm.m.b : -1;
  if (w < 0) return null;
  recordWin(t, nm.round, nm.match, w);
  return { round: nm.round, match: nm.match };
}

/** Rebuild a stored tournament, or null if it's broken (a newer build's format, a hand edit). */
export function cleanTourney(raw: unknown): Tourney | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<Tourney>;
  if (!Array.isArray(o.names) || !Array.isArray(o.rounds) || (o.kind !== 'race' && o.kind !== 'pvp')) return null;
  const names = o.names.map((n) => cleanName(String(n))).filter(Boolean);
  if (names.length < TOURNEY_MIN || names.length > TOURNEY_MAX) return null;
  const okIdx = (v: unknown) => Number.isInteger(v) && (v as number) >= -2 && (v as number) < names.length;
  const res = (x: unknown): TurnResult | undefined => {
    if (!x || typeof x !== 'object') return undefined;
    const r = x as TurnResult;
    return Number.isFinite(r.p) && Number.isFinite(r.t) && Number.isFinite(r.score) ? { p: r.p, t: r.t, score: r.score } : undefined;
  };
  const rounds: TMatch[][] = [];
  for (const round of o.rounds) {
    if (!Array.isArray(round)) return null;
    const ms: TMatch[] = [];
    for (const m of round) {
      if (!m || !okIdx(m.a) || !okIdx(m.b) || !(Number.isInteger(m.w) && m.w >= -1 && m.w < names.length)) return null;
      ms.push({ a: m.a, b: m.b, w: m.w, ra: res(m.ra), rb: res(m.rb) });
    }
    rounds.push(ms);
  }
  const champion = Number.isInteger(o.champion) && (o.champion as number) >= -1 && (o.champion as number) < names.length ? (o.champion as number) : -1;
  return { kind: o.kind, names, seed: Number(o.seed) >>> 0, rounds, champion };
}
