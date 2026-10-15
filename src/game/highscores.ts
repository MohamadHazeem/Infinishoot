import { loadJson, saveJson } from '../core/storage';

export interface ScoreEntry {
  score: number;
  stage: number;
  kills: number;
  date: string; // ISO date (yyyy-mm-dd)
  /** Mode and difficulty, e.g. "ENDLESS · HARD" (blank = standard normal). */
  label?: string;
}

const KEY = 'highscores.v1';
const MAX = 10;

export function loadHighScores(): ScoreEntry[] {
  const list = loadJson<ScoreEntry[]>(KEY, []);
  return Array.isArray(list) ? list.slice(0, MAX) : [];
}

/** Insert a run; returns its 0-based rank, or -1 if it didn't make the table. */
export function submitScore(entry: ScoreEntry): number {
  const list = loadHighScores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const rank = list.indexOf(entry);
  saveJson(KEY, list.slice(0, MAX));
  return rank < MAX ? rank : -1;
}

const DAILY_KEY = 'daily.v1';

/** Best Daily Challenge score for a date (0 = none yet). */
export function dailyBest(date: string): number {
  const d = loadJson<{ date: string; score: number }>(DAILY_KEY, { date: '', score: 0 });
  return d.date === date ? d.score : 0;
}

/** Record a Daily Challenge run; returns true if it beat today's best. */
export function submitDaily(date: string, score: number): boolean {
  if (score <= dailyBest(date)) return false;
  saveJson(DAILY_KEY, { date, score });
  return true;
}
