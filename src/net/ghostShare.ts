import { onlineServer } from './onlineServer';
/**
 * Help ghosts over the optional worker (server/leaderboard/ghost.js): upload
 * your ghost for a 6-character code, or fetch a friend's by theirs. Only active
 * when the build has VITE_LEADERBOARD_URL; offline, ghosts travel as GHOST1-
 * share codes or files (src/game/coop2.ts encodeGhost / decodeGhost).
 */
import { cleanGhost, type HelpGhost } from '../game/coop2';

const BASE = onlineServer;

export const ghostShareEnabled = BASE !== '';

/** A short code the worker hands out ("K7P2QX"). */
export function isShortCode(s: string): boolean {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(s.trim().toUpperCase());
}

export async function uploadGhost(g: HelpGhost): Promise<string | null> {
  if (!ghostShareEnabled) return null;
  try {
    const r = await fetch(`${BASE}/ghost`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ghost: g }) });
    if (!r.ok) return null;
    const code = ((await r.json()) as { code?: string }).code ?? '';
    return isShortCode(code) ? code : null;
  } catch {
    return null;
  }
}

export async function fetchGhost(code: string): Promise<HelpGhost | null> {
  if (!ghostShareEnabled || !isShortCode(code)) return null;
  try {
    const r = await fetch(`${BASE}/ghost?code=${encodeURIComponent(code.trim().toUpperCase())}`);
    if (!r.ok) return null;
    return cleanGhost(((await r.json()) as { ghost?: unknown }).ghost);
  } catch {
    return null;
  }
}
