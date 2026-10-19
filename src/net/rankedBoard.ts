/**
 * Shared RANKED ladder (race lane), only when the build has VITE_LEADERBOARD_URL
 * (server/leaderboard/ranked.js). Each save posts its current season rating
 * under a random save id after a rated match; the screen shows the top 50.
 * Offline builds keep the rating local only.
 */
export interface LadderEntry {
  name: string;
  rating: number;
  games: number;
  wins: number;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const ENV_BASE = (import.meta.env?.VITE_LEADERBOARD_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class RankedLadder {
  constructor(
    readonly base = ENV_BASE,
    private fetchFn: Fetch = (u, i) => fetch(u, i),
  ) {}

  get enabled(): boolean {
    return this.base !== '';
  }

  async top(season: string): Promise<LadderEntry[] | null> {
    if (!this.enabled) return null;
    try {
      const r = await this.fetchFn(`${this.base}/ranked?season=${encodeURIComponent(season)}`);
      if (!r.ok) return null;
      return ((await r.json()) as { players: LadderEntry[] }).players ?? [];
    } catch {
      return null;
    }
  }

  /** Returns the 1-based ladder place (0 = off the board), or null when offline or refused. */
  async submit(e: { id: string; season: string; name: string; rating: number; games: number; wins: number }): Promise<number | null> {
    if (!this.enabled || !e.id || e.games <= 0) return null;
    try {
      const r = await this.fetchFn(`${this.base}/ranked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...e, version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '' }),
      });
      if (!r.ok) return null;
      return ((await r.json()) as { rank?: number }).rank ?? 0;
    } catch {
      return null;
    }
  }
}

export const rankedLadder = new RankedLadder();
