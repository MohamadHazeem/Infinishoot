import type { Rarity } from './rarity';
import type { Tag } from './tags';

/**
 * Upgrade lines for loadout items (left click, right click, special). Instead
 * of one ladder of levels, an item has a few tracks of ranks; each rank adds
 * to the item's base params (its `levels[0].p`). After `evoAt` ranks you pick
 * one of two evolutions, which changes the look and behaviour (weapon classes
 * read `evoId`). Once everything is maxed, Overdrive ranks repeat forever.
 */
export interface TrackRank {
  text: string;
  /** Added to the params. */
  p: Record<string, number>;
}

export interface Track {
  id: string;
  name: string;
  ranks: TrackRank[];
}

export interface EvoDef {
  id: string;
  name: string;
  color: string;
  text: string;
  /** Extra tags while evolved (Mods and statuses key off them). */
  tags?: Tag[];
  /** Added to the params, then `mul` multiplies them. */
  p?: Record<string, number>;
  mul?: Record<string, number>;
}

export interface Upgradable {
  tracks?: Track[];
  evos?: EvoDef[];
  /** Total ranks needed before the evolution choice is offered. */
  evoAt?: number;
}

/** Ranks per track, the chosen evolution (-1 = none) and Overdrive ranks. */
export interface Build {
  ranks: number[];
  evo: number;
  od: number;
}

export const trackTuning = {
  overdrive: 0.08, // damage per Overdrive rank
};

/** Card rarity of a track's rank (0-based): later ranks are rarer, evolutions legendary. */
export const RANK_RARITY: Rarity[] = ['common', 'common', 'uncommon', 'rare'];

/** Params whose value is damage, for Overdrive. */
const DAMAGE_KEYS = ['dmg', 'dps'];

export function newBuild(def: Upgradable): Build {
  return { ranks: (def.tracks ?? []).map(() => 0), evo: -1, od: 0 };
}

export function totalRanks(b: Build): number {
  return b.ranks.reduce((a, n) => a + n, 0);
}

export function tracksMaxed(def: Upgradable, b: Build): boolean {
  return (def.tracks ?? []).every((t, i) => b.ranks[i] >= t.ranks.length);
}

/** Everything taken: all tracks maxed and an evolution chosen (Overdrive is still offered). */
export function buildMaxed(def: Upgradable, b: Build): boolean {
  return tracksMaxed(def, b) && (!def.evos?.length || b.evo >= 0);
}

export function canEvolve(def: Upgradable, b: Build): boolean {
  return !!def.evos?.length && b.evo < 0 && totalRanks(b) >= (def.evoAt ?? 8);
}

/** Base params plus every rank taken, the evolution and Overdrive. */
export function buildParams(base: Record<string, number>, def: Upgradable, b: Build): Record<string, number> {
  const p = { ...base };
  (def.tracks ?? []).forEach((t, i) => {
    for (let r = 0; r < b.ranks[i]; r++) for (const [k, v] of Object.entries(t.ranks[r].p)) p[k] = (p[k] ?? 0) + v;
  });
  const evo = def.evos?.[b.evo];
  if (evo) {
    for (const [k, v] of Object.entries(evo.p ?? {})) p[k] = (p[k] ?? 0) + v;
    for (const [k, v] of Object.entries(evo.mul ?? {})) p[k] = (p[k] ?? 0) * v;
  }
  if (b.od) for (const k of DAMAGE_KEYS) if (k in p) p[k] *= 1 + trackTuning.overdrive * b.od;
  return p;
}

/** Compact form for the network: "evo:r1,r2,r3:od". */
export function buildKey(b: Build): string {
  return `${b.evo}:${b.ranks.join(',')}:${b.od}`;
}

export function parseBuild(key: string, def: Upgradable): Build {
  const [evo, ranks, od] = key.split(':');
  const b = newBuild(def);
  const rs = (ranks ?? '').split(',').map(Number);
  b.ranks = b.ranks.map((_, i) => rs[i] || 0);
  b.evo = Number(evo);
  if (!Number.isFinite(b.evo)) b.evo = -1;
  b.od = Number(od) || 0;
  return b;
}
