import { loadJson, saveJson } from '../core/storage';
import { bankMarks, normalizeCabinet, type Cabinet, type Tallies } from '../data/mastery';
import { normalize, save, saveLock } from './save';

export interface BoardRow {
  id: string;
  stage: number;
  score: number;
  ms: number;
}
export interface HardcoreProfile {
  life: string;
  cabinet: Cabinet;
}
const profileKey = 'hardcore.life.v1';
const lifeId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const boardKey = 'hardcore.board.v1';
export function hardcoreProfile(): HardcoreProfile {
  const raw = loadJson<Partial<HardcoreProfile>>(profileKey, {});
  const life = typeof raw.life === 'string' && lifeId.test(raw.life) ? raw.life : '';
  return { life, cabinet: normalizeCabinet(life ? raw.cabinet : null) };
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
  if (p.life && hardcoreProfile().life === p.life)
    saveJson(profileKey, { life: p.life, cabinet: normalizeCabinet(p.cabinet) });
}
/** Credit the current collection, including progress or equipment saved by another tab. */
export function bankLife(life: string, marks: Tallies): boolean {
  const current = hardcoreProfile();
  if (!life || current.life !== life) return false;
  bankMarks(current.cabinet, marks);
  keepLife(current);
  return true;
}
export function loseLife(life: string) {
  if (hardcoreProfile().life === life)
    saveJson(profileKey, { life: '', cabinet: normalizeCabinet(null) });
}
export function localHardcoreBoard(): BoardRow[] {
  const rows = loadJson<BoardRow[]>(boardKey, []);
  return Array.isArray(rows)
    ? rows
        .filter(
          (r) =>
            r &&
            lifeId.test(r.id) &&
            [r.score, r.stage, r.ms].every((n) => Number.isSafeInteger(n) && n > 0),
        )
        .slice(0, 10)
    : [];
}
export function recordHardcore(row: BoardRow) {
  const rows = localHardcoreBoard().filter((r) => r.id !== row.id);
  rows.push(row);
  saveJson(
    boardKey,
    rows.sort((a, b) => b.score - a.score || b.stage - a.stage || a.ms - b.ms).slice(0, 10),
  );
}

/** The challenge has its own cosmetic cabinet and a fresh, transient game profile.
 * Keep the ordinary save object's identity for systems which imported it at startup. */
export function isolatedProfile(): () => void {
  const regular = { ...save },
    lock = saveLock.on;
  Object.assign(save, normalize(null));
  saveLock.on = true;
  return () => {
    Object.assign(save, regular);
    saveLock.on = lock;
  };
}
