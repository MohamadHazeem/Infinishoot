/**
 * Optional online ghost board (modes lane; server/leaderboard/ghosts.js). Like the score board,
 * it only talks to the worker when the build has VITE_LEADERBOARD_URL; otherwise every call
 * resolves to null and ghosts travel as share codes and files.
 *   GET  /ghosts?week=2026-W42          -> { ghosts: [{ id, name, score, stage, time }] } (best first)
 *   GET  /ghosts?week=2026-W42&id=<id>  -> { code }
 *   POST /ghosts  { week, name, score, stage, time, code } -> { rank } (0 = didn't make the board)
 */
import { leaderboardEnabled } from './leaderboard';

export interface GhostEntry {
  id: string;
  name: string;
  score: number;
  stage: number;
  time: number;
}

const BASE = (import.meta.env?.VITE_LEADERBOARD_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export const ghostsOnline = leaderboardEnabled;

export async function fetchGhosts(week: string): Promise<GhostEntry[] | null> {
  if (!ghostsOnline) return null;
  try {
    const r = await fetch(`${BASE}/ghosts?week=${encodeURIComponent(week)}`);
    if (!r.ok) return null;
    return ((await r.json()) as { ghosts: GhostEntry[] }).ghosts ?? [];
  } catch {
    return null;
  }
}

export async function fetchGhostCode(week: string, id: string): Promise<string | null> {
  if (!ghostsOnline) return null;
  try {
    const r = await fetch(`${BASE}/ghosts?week=${encodeURIComponent(week)}&id=${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    return ((await r.json()) as { code: string }).code ?? null;
  } catch {
    return null;
  }
}

export async function uploadGhost(e: { week: string; name: string; score: number; stage: number; time: number; code: string }): Promise<number | null> {
  if (!ghostsOnline) return null;
  try {
    const r = await fetch(`${BASE}/ghosts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) });
    if (!r.ok) return null;
    return ((await r.json()) as { rank: number }).rank ?? null;
  } catch {
    return null;
  }
}
