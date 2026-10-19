/**
 * Where ghosts live on this machine (modes lane): your best ghost per week and the rival you
 * picked to race, as plain share codes under `infinishoot.ghosts.v1` (src/core/storage.ts, which
 * never throws). Ghosts aren't profile progress, so they stay out of the save file. The last 8
 * weeks are kept.
 */
import { loadJson, saveJson } from '../../core/storage';
import { betterGhost, ghostCode, readGhostCodeSync, type Ghost } from './ghost';

interface Stored {
  /** week -> share code of your best run. */
  mine: Record<string, string>;
  /** The ghost you race (any week; it only shows on its own week). */
  rival: { week: string; code: string } | null;
}

const KEY = 'ghosts.v1';
const KEEP_WEEKS = 8;

function load(): Stored {
  const s = loadJson<Stored>(KEY, { mine: {}, rival: null });
  return { mine: s.mine && typeof s.mine === 'object' ? s.mine : {}, rival: s.rival && typeof s.rival.code === 'string' ? s.rival : null };
}

export const ghostStore = {
  /** Your best ghost for `week` (null if you haven't played it). */
  mine(week: string): Ghost | null {
    const code = load().mine[week];
    return code ? readGhostCodeSync(code) : null;
  },
  /** Keep `g` if it beats your stored run for its week. True when it was kept. */
  keepMine(g: Ghost): boolean {
    const s = load();
    const old = s.mine[g.week] ? readGhostCodeSync(s.mine[g.week]) : null;
    if (betterGhost(old, g) !== g) return false;
    s.mine[g.week] = ghostCode(g);
    const weeks = Object.keys(s.mine).sort();
    while (weeks.length > KEEP_WEEKS) delete s.mine[weeks.shift()!];
    saveJson(KEY, s);
    return true;
  },
  /** The rival for `week`, if the picked rival is from that week. */
  rivalFor(week: string): Ghost | null {
    const r = load().rival;
    if (!r || r.week !== week) return null;
    return readGhostCodeSync(r.code);
  },
  /** The picked rival, whatever week it is from. */
  rival(): Ghost | null {
    const r = load().rival;
    return r ? readGhostCodeSync(r.code) : null;
  },
  setRival(g: Ghost | null): void {
    const s = load();
    s.rival = g ? { week: g.week, code: ghostCode(g) } : null;
    saveJson(KEY, s);
  },
  weeks(): string[] {
    return Object.keys(load().mine).sort().reverse();
  },
};
