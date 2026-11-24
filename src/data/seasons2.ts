import { hashNumber } from '../dev/replay';
import { Rng } from '../core/rng';

export const RANKED_EPOCH = Date.UTC(2026, 10, 23);
export const SEASON_LENGTH = 42 * 86400000;
export const BOARDS = ['standard', 'daily', 'abyss'] as const;
export type SeasonBoard = (typeof BOARDS)[number];
export const BANDS = ['comet', 'nova', 'orbit', 'scout'] as const;
export type Band = (typeof BANDS)[number];
export const rankedSeason = (now = Date.now()) =>
  Math.floor((now - RANKED_EPOCH) / SEASON_LENGTH) + 1;
export const seasonEnd = (season: number) => RANKED_EPOCH + season * SEASON_LENGTH;
export const isBoard = (value: unknown): value is SeasonBoard => BOARDS.some((b) => b === value);
export const isBand = (value: unknown): value is Band => BANDS.some((b) => b === value);
export const positive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

export function rankedBoard(mode: string, difficulty: string): SeasonBoard | null {
  if (mode === 'daily') return difficulty === 'normal' ? 'daily' : null;
  if (mode === 'abyss')
    return ['easy', 'assist', 'normal', 'hard', 'nightmare', 'legend'].includes(difficulty)
      ? 'abyss'
      : null;
  return mode === 'standard' && ['normal', 'hard', 'nightmare', 'legend'].includes(difficulty)
    ? 'standard'
    : null;
}

/** A dedicated seed gives all boards the same precision, distance and supply rules. */
export function seasonRules(season: number) {
  const rng = new Rng(season ^ 0x624ac7);
  return {
    precision: rng.pick(['marked', 'interrupt'] as const),
    distance: rng.pick(['near', 'far'] as const),
    supply: rng.pick(['gear', 'gold'] as const),
  };
}
/** Evaluate the position and status at the killing blow. */
export function killBonus(
  rules: ReturnType<typeof seasonRules>,
  exposed: boolean,
  windingUp: boolean,
  distanceSquared: number,
): number {
  const precise = rules.precision === 'marked' ? exposed : windingUp;
  const inRange = rules.distance === 'near' ? distanceSquared <= 16 : distanceSquared >= 81;
  return (precise ? 60 : 0) + (inRange ? 30 : 0);
}

export const rankBand = (rank: number): Band =>
  rank === 1 ? 'comet' : rank <= 10 ? 'nova' : rank <= 50 ? 'orbit' : 'scout';

export interface Finish {
  season: number;
  board: SeasonBoard;
  score: number;
  bonus: number;
  stage: number;
  kills: number;
  time: number;
  seed: number;
  hash: number;
  replayVersion: number;
  difficulty: string;
  day: string;
}
/** Bind the submitted summary to its replay checkpoint. This is an integrity check, not a signature. */
export function finishChecksum(f: Finish): number {
  let hash = f.hash;
  for (const value of [
    f.replayVersion,
    f.seed,
    f.season,
    BOARDS.indexOf(f.board),
    f.score,
    f.bonus,
    f.stage,
    f.kills,
    f.time,
    ['easy', 'assist', 'normal', 'hard', 'nightmare', 'legend'].indexOf(f.difficulty),
  ])
    hash = hashNumber(hash, value);
  return hash;
}

export interface BestRun {
  key: string;
  points: number;
}
export interface LocalBoard {
  season: number;
  board: SeasonBoard;
  runs: BestRun[];
}
export interface Award {
  season: number;
  board: SeasonBoard;
  rank: number;
  band: Band;
}
export interface SeasonBook {
  boards: LocalBoard[];
  awards: Award[];
  worn: Band | null;
}

export function bestFive(runs: BestRun[], add?: BestRun): BestRun[] {
  const seen = new Set<string>();
  const valid = [];
  for (const r of add ? [...runs, add] : runs) {
    if (
      !r ||
      typeof r.key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{8}$/.test(r.key) ||
      !positive(r.points) ||
      seen.has(r.key)
    )
      continue;
    seen.add(r.key);
    valid.push({ key: r.key, points: r.points });
  }
  return valid.sort((a, b) => b.points - a.points || a.key.localeCompare(b.key)).slice(0, 5);
}
export function normalizeBook(raw: unknown): SeasonBook {
  const data = (raw ?? {}) as Partial<SeasonBook>;
  const boards: LocalBoard[] = [],
    awards: Award[] = [];
  for (const b of Array.isArray(data.boards) ? data.boards : []) {
    if (!b || !positive(b.season) || !isBoard(b.board) || !Array.isArray(b.runs)) continue;
    const runList = bestFive(b.runs);
    if (runList.length && !boards.some((old) => old.season === b.season && old.board === b.board))
      boards.push({ season: b.season, board: b.board, runs: runList });
  }
  for (const a of Array.isArray(data.awards) ? data.awards : []) {
    if (
      a &&
      positive(a.season) &&
      isBoard(a.board) &&
      positive(a.rank) &&
      a.band === rankBand(a.rank) &&
      !awards.some((old) => old.season === a.season && old.board === a.board)
    )
      awards.push({ season: a.season, board: a.board, rank: a.rank, band: a.band });
  }
  const worn = awards.find((a) => a.band === data.worn)?.band ?? null;
  return { boards: boards.sort((a, b) => b.season - a.season), awards, worn };
}
