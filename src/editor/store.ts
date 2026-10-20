/**
 * Saved custom arenas and their best scores (editor lane). Local only, in
 * localStorage through src/core/storage.ts (never throws), under keys of their
 * own so the profile save format (src/game/save.ts) is untouched:
 *   infinishoot.arenas.v1  -> up to MAX_SAVED arenas, newest first
 *   infinishoot.arenaBest.v1 -> best score per arena fingerprint (arenaKey)
 * Everything read back goes through normalizeArena.
 */
import { loadJson, saveJson } from '../core/storage';
import { arenaKey, normalizeArena, type CustomArena } from './arenaData';

export const MAX_SAVED = 20;
const KEY = 'arenas.v1';
const BEST = 'arenaBest.v1';

export interface SavedArena {
  /** Stable id for this slot (survives renames and edits). */
  id: string;
  arena: CustomArena;
  /** Last save, ms since epoch. */
  at: number;
}

export interface ArenaBest {
  score: number;
  stage: number;
  kills: number;
  date: string;
}

/** Tests and the save lock can swap the backing store. */
export const arenaStore = {
  locked: false,
};

function readList(): SavedArena[] {
  const raw = loadJson<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: SavedArena[] = [];
  const ids = new Set<string>();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const id = String((e as SavedArena).id ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    out.push({ id, arena: normalizeArena((e as SavedArena).arena), at: Number((e as SavedArena).at) || 0 });
    if (out.length >= MAX_SAVED) break;
  }
  return out;
}

export function savedArenas(): SavedArena[] {
  return readList();
}

export function newArenaId(): string {
  return (Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)).slice(-12);
}

/**
 * Save (insert or replace by id) and move it to the top. Returns false when
 * the list is full and this is a new arena (the UI asks to delete one first).
 */
export function saveArena(id: string, arena: CustomArena): boolean {
  if (arenaStore.locked) return true;
  const list = readList();
  const i = list.findIndex((e) => e.id === id);
  if (i < 0 && list.length >= MAX_SAVED) return false;
  if (i >= 0) list.splice(i, 1);
  list.unshift({ id, arena: normalizeArena(arena), at: Date.now() });
  saveJson(KEY, list);
  return true;
}

export function deleteArena(id: string): void {
  if (arenaStore.locked) return;
  saveJson(
    KEY,
    readList().filter((e) => e.id !== id),
  );
}

function readBest(): Record<string, ArenaBest> {
  const raw = loadJson<unknown>(BEST, {});
  const out: Record<string, ArenaBest> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z0-9]{1,13}$/.test(k) || !v || typeof v !== 'object') continue;
    const b = v as ArenaBest;
    const score = Number(b.score);
    if (!Number.isFinite(score) || score < 0) continue;
    out[k] = { score: Math.floor(score), stage: Math.max(1, Math.floor(Number(b.stage) || 1)), kills: Math.max(0, Math.floor(Number(b.kills) || 0)), date: String(b.date ?? '').slice(0, 10) };
  }
  return out;
}

export function bestFor(a: CustomArena): ArenaBest | null {
  return readBest()[arenaKey(a)] ?? null;
}

/** Record a finished run; true if it beat the arena's best. */
export function recordArenaRun(a: CustomArena, run: ArenaBest): boolean {
  const all = readBest();
  const key = arenaKey(a);
  const old = all[key];
  if (old && old.score >= run.score) return false;
  all[key] = run;
  // Keep the table bounded: best scores of arenas long gone are dropped first (lowest scores).
  const keys = Object.keys(all);
  if (keys.length > 200) for (const k of keys.sort((x, y) => all[x].score - all[y].score).slice(0, keys.length - 200)) delete all[k];
  if (!arenaStore.locked) saveJson(BEST, all);
  return true;
}
