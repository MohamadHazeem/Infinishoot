import { loadJson, saveJson } from '../core/storage';
import { normalizeCabinet, type Cabinet } from '../data/mastery';
import { normalize, save, saveLock } from './save';

export interface BoardRow { id: string; stage: number; score: number; ms: number }
export interface HardcoreProfile { life: string; cabinet: Cabinet }
const profileKey = 'hardcore.life.v1';
const boardKey = 'hardcore.board.v1';
export function hardcoreProfile(): HardcoreProfile {
  const raw = loadJson<Partial<HardcoreProfile>>(profileKey, {});
  return { life: typeof raw.life === 'string' ? raw.life : '', cabinet: normalizeCabinet(raw.cabinet) };
}
export function enterLife(): HardcoreProfile {
  const profile = hardcoreProfile();
  if (!profile.life) {
    profile.life = crypto.randomUUID();
    saveJson(profileKey, profile);
  }
  return profile;
}
export function keepLife(p: HardcoreProfile) {
  if (p.life && hardcoreProfile().life === p.life) saveJson(profileKey, p);
}
export function loseLife(life: string) {
  if (hardcoreProfile().life === life) saveJson(profileKey, { life: '', cabinet: normalizeCabinet(null) });
}
export function localHardcoreBoard(): BoardRow[] {
  const rows = loadJson<BoardRow[]>(boardKey, []);
  return Array.isArray(rows) ? rows.filter(r => r && /^[a-f0-9-]{36}$/.test(r.id) && [r.score,r.stage,r.ms].every(n => Number.isSafeInteger(n) && n >= 0)).slice(0, 10) : [];
}
export function recordHardcore(row: BoardRow) {
  const rows = localHardcoreBoard().filter(r => r.id !== row.id);
  rows.push(row);
  saveJson(boardKey, rows.sort((a,b) => b.score - a.score || b.stage - a.stage || a.ms - b.ms).slice(0,10));
}

/** The challenge has its own cosmetic cabinet and a fresh, transient game profile.
 * Keep the ordinary save object's identity for systems which imported it at startup. */
export function isolatedProfile(): () => void {
  const regular = { ...save }, lock = saveLock.on;
  Object.assign(save, normalize(null));
  saveLock.on = true;
  return () => { Object.assign(save, regular); saveLock.on = lock; };
}
