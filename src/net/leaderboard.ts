import { heroOf } from '../data/heroes';
import { localize } from '../i18n';
import type { ScoreReplay } from '../platform/scoreReplay';
import { onlineServer } from './onlineServer';
/**
 * Optional online leaderboard (server/leaderboard). Only active when the build
 * was made with VITE_LEADERBOARD_URL set; otherwise every call is a no-op and
 * the game stays fully offline.
 */
export interface GlobalScore {
  name: string;
  score: number;
  stage: number;
  kills: number;
  time: number;
  date: string;
}

const BASE = onlineServer;

export const leaderboardEnabled = BASE !== '';

/** Board id for a run: "<mode>-<difficulty>" or "daily-<date>". */
export function boardId(mode: string, difficulty: string, date: string): string {
  return mode === 'daily' ? `daily-${date}` : `${mode}-${difficulty}`;
}

export async function fetchTop(board: string): Promise<GlobalScore[] | null> {
  if (!leaderboardEnabled) return null;
  try {
    const r = await fetch(`${BASE}/replay-scores?board=${encodeURIComponent(board)}`);
    if (!r.ok) return null;
    const { scores } = await r.json() as { scores: GlobalScore[] };
    return scores.map(row => ({ ...row, name: localize(heroOf(row.name).name) }));
  } catch {
    return null;
  }
}

/** Returns the 1-based global rank, 0 if it missed the board, or null if offline/failed. */
export async function submitGlobal(board: string, e: { score: number; stage: number; kills: number; time: number }, replay: ScoreReplay | undefined): Promise<number | null> {
  if (!leaderboardEnabled || !replay || e.score <= 0) return null;
  try {
    const r = await fetch(`${BASE}/replay-scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board, ...e, replay }),
    });
    if (!r.ok) return null;
    return ((await r.json()) as { rank: number }).rank ?? null;
  } catch {
    return null;
  }
}
