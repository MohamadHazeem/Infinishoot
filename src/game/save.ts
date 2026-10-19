import { loadJson, saveJson } from '../core/storage';
import { ACHIEVEMENTS } from '../data/meta';
import { SPECIALS } from '../data/specials';
import { WEAPONS } from '../data/weapons';

/**
 * Persistent profile: achievements (weapon unlocks) and lifetime stats.
 * Stored in localStorage automatically; can be saved to a file for backup
 * or moving to another PC.
 */
/** One finished run, newest first in `history`. */
export interface RunRecord {
  date: string;
  label: string;
  hero: string;
  stage: number;
  score: number;
  kills: number;
  time: number;
  level: number;
  cause: string;
  weapons: { id: string; level: number; evo: boolean }[];
}

export interface SaveData {
  version: number;
  achievements: string[];
  /** Enemy ids met (enemy guide). */
  seen: string[];
  /** Last runs (max 30). */
  history: RunRecord[];
  lifetime: {
    runs: number;
    kills: number;
    elites: number;
    bosses: number;
    bestStage: number;
    bestLevel: number;
    playTime: number;
  };
}

const KEY = 'save';
// v2 dropped Bolts and Workshop upgrades; older saves keep their achievements and stats.
// v3 added the enemy guide (`seen`) and run history.
const VERSION = 3;
const CODE_PREFIX = 'ISAVE1:';

function fresh(): SaveData {
  return {
    version: VERSION,
    achievements: [],
    seen: [],
    history: [],
    lifetime: { runs: 0, kills: 0, elites: 0, bosses: 0, bestStage: 0, bestLevel: 0, playTime: 0 },
  };
}

/** Fill missing fields so older or partial saves keep working. */
function normalize(raw: unknown): SaveData {
  const d = fresh();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  if (Array.isArray(r.achievements)) {
    d.achievements = r.achievements.filter((a) => ACHIEVEMENTS.some((x) => x.id === a));
  }
  if (Array.isArray(r.seen)) d.seen = r.seen.filter((x): x is string => typeof x === 'string');
  if (Array.isArray(r.history)) d.history = r.history.filter((x) => x && typeof x === 'object' && Number.isFinite((x as RunRecord).score)).slice(0, 30);
  if (r.lifetime && typeof r.lifetime === 'object') {
    for (const k of Object.keys(d.lifetime) as (keyof SaveData['lifetime'])[]) {
      const v = Number((r.lifetime as Record<string, unknown>)[k]);
      if (Number.isFinite(v) && v >= 0) d.lifetime[k] = v;
    }
  }
  return d;
}

/**
 * Achievements that lifetime stats already prove (and Evolution for anyone
 * who reached stage 3, where old runs evolved weapons as a matter of course).
 * Saves from before loadouts keep access to what they played with.
 */
function grantFromLifetime(d: SaveData): void {
  for (const a of ACHIEVEMENTS) if (a.lifetime?.(d.lifetime) && !d.achievements.includes(a.id)) d.achievements.push(a.id);
}

export const save: SaveData = normalize(loadJson<unknown>(KEY, null));
grantFromLifetime(save);

/** While on (the title screen's attract demo), nothing touches the profile: no saves, achievements, enemies met or run records. */
export const saveLock = { on: false };

export function persist(): void {
  if (saveLock.on) return;
  saveJson(KEY, save);
}

/** Note an enemy type as met (saved with the next persist). */
export function markSeen(id: string): void {
  if (saveLock.on) return;
  if (!save.seen.includes(id)) save.seen.push(id);
}

export function addRunRecord(r: RunRecord): void {
  if (saveLock.on) return;
  save.history.unshift(r);
  save.history.length = Math.min(save.history.length, 30);
}

export function unlockedWeapons(): string[] {
  const ids = Object.values(WEAPONS)
    .filter((w) => w.starter)
    .map((w) => w.id);
  for (const a of ACHIEVEMENTS) if (a.unlockWeapon && save.achievements.includes(a.id)) ids.push(a.unlockWeapon);
  return ids;
}

/** Loadout items this save can pick: starters plus achievement unlocks. */
export function unlockedLoadout(): string[] {
  const ids = [
    ...Object.values(WEAPONS)
      .filter((w) => w.slot && w.starter)
      .map((w) => w.id),
    ...Object.values(SPECIALS)
      .filter((s) => s.starter)
      .map((s) => s.id),
  ];
  for (const a of ACHIEVEMENTS) if (a.unlockLoadout && save.achievements.includes(a.id)) ids.push(a.unlockLoadout);
  return ids;
}

/** The achievement that unlocks a loadout item, for the locked card. */
export function loadoutUnlockBy(id: string) {
  return ACHIEVEMENTS.find((a) => a.unlockLoadout === id);
}

/** Grant an achievement once. Returns its def if newly earned. */
export function grantAchievement(id: string) {
  if (saveLock.on) return null;
  if (save.achievements.includes(id)) return null;
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return null;
  save.achievements.push(id);
  persist();
  return def;
}

// ---------------------------------------------------------------- export / import

function checksum(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The save as a small readable JSON file. */
export function exportFile(): string {
  return JSON.stringify({ game: 'InfiniShoot', save }, null, 2);
}

/** Load a save file (or an old save code). Throws a readable error if it isn't one. */
export function importFile(text: string): void {
  const c = text.trim();
  if (c.startsWith(CODE_PREFIX)) {
    importCode(c);
    return;
  }
  let parsed: { game?: unknown; save?: unknown };
  try {
    parsed = JSON.parse(c);
  } catch {
    throw new Error('That file is not an InfiniShoot save.');
  }
  if (parsed?.game !== 'InfiniShoot' || !parsed.save) throw new Error('That file is not an InfiniShoot save.');
  Object.assign(save, normalize(parsed.save));
  grantFromLifetime(save);
  persist();
}

/** Replace the save with an exported code (older backups). Throws a readable error if invalid. */
export function importCode(code: string): void {
  const c = code.trim();
  if (!c.startsWith(CODE_PREFIX)) throw new Error('That is not an InfiniShoot save code.');
  const [b64, sum] = c.slice(CODE_PREFIX.length).split('.');
  if (!b64 || checksum(b64) !== sum) throw new Error('The save code is damaged or incomplete.');
  let parsed: unknown;
  try {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The save code could not be read.');
  }
  Object.assign(save, normalize(parsed));
  grantFromLifetime(save);
  persist();
}

export function resetSave(): void {
  Object.assign(save, fresh());
  persist();
}
