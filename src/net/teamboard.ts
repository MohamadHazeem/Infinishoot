import { onlineServer } from './onlineServer';
import { loadJson, saveJson } from '../core/storage';

/**
 * Weekly co-op challenge team board (MP lane). A team (the host's team name
 * plus its members) keeps one entry per ISO week on the optional online
 * service (server/leaderboard/teamboard.js), and every machine in the team
 * keeps its own local best. Offline builds only keep the local best.
 */
export interface TeamEntry {
  team: string;
  members: string[];
  score: number;
  stage: number;
  date: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const ENV_BASE = onlineServer;

/** Team names: letters, digits, spaces and a little punctuation, 16 characters. */
export function cleanTeam(name: unknown): string {
  return (
    String(name ?? '')
      .replace(/[^\p{L}\p{N} _.'-]/gu, '')
      .trim()
      .slice(0, 16) || 'Team'
  );
}

export class TeamBoardService {
  constructor(
    readonly base = ENV_BASE,
    private fetchFn: Fetch = (u, i) => fetch(u, i),
  ) {}

  get enabled(): boolean {
    return this.base !== '';
  }

  async top(week: string): Promise<TeamEntry[] | null> {
    if (!this.enabled) return null;
    try {
      const r = await this.fetchFn(`${this.base}/teamboard?week=${encodeURIComponent(week)}`);
      if (!r.ok) return null;
      return ((await r.json()) as { teams: TeamEntry[] }).teams ?? [];
    } catch {
      return null;
    }
  }

  /** Returns the team's 1-based rank (0 = off the board), or null when offline/failed. */
  async submit(week: string, e: { team: string; members: string[]; score: number; stage: number; kills: number; time: number }): Promise<number | null> {
    if (!this.enabled || e.score <= 0) return null;
    try {
      const r = await this.fetchFn(`${this.base}/teamboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week, ...e, version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '' }),
      });
      if (!r.ok) return null;
      return ((await r.json()) as { rank: number }).rank ?? null;
    } catch {
      return null;
    }
  }
}

export const teamBoard = new TeamBoardService();

const KEY = 'teamweekly.v1';

/** This machine's best team result per week (the last 52 weeks are kept). */
export function localTeamBest(week: string): TeamEntry | null {
  return loadJson<Record<string, TeamEntry>>(KEY, {})[week] ?? null;
}

/** Record a team result; returns true if it beat this machine's best for the week. */
export function recordTeamBest(week: string, e: TeamEntry): boolean {
  const all = loadJson<Record<string, TeamEntry>>(KEY, {});
  const old = all[week];
  if (old && old.score >= e.score) return false;
  all[week] = { ...e, team: cleanTeam(e.team), members: e.members.slice(0, 4) };
  const keep = Object.keys(all).sort().slice(-52);
  saveJson(KEY, Object.fromEntries(keep.map((k) => [k, all[k]])));
  return true;
}
