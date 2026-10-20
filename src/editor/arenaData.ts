/**
 * Custom arenas (editor lane): the data a player builds in EXTRAS > ARENA
 * EDITOR, the rules it plays with, normalisation of anything that comes from
 * outside (share codes, saves, the network), the colliders the data makes and
 * the validity check (heroes can reach the boss marker, no blocked spawn).
 * Pure: no DOM, no three.js, so tests and every co-op machine agree.
 */
import { aabbFromCenter, type AABB } from '../world/collision';
import { allBiomeKeys } from '../data/biomes';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { HEAT } from '../data/heat';
import { DIFFICULTIES } from '../data/modes';
import { BELT_LEN, BELT_WIDE, HAZARD_RADII, MAX_PIECES, PAD_RANGE, PIECE_BY_ID, dirOf, footprint, type PieceId } from './pieces';

export interface ArenaPiece {
  k: PieceId;
  /** Centre, whole metres (the grid snaps to 2 m, free placement to 1 m). */
  x: number;
  z: number;
  /** Quarter turns 0..3 (a direction for pads/belts/gates, a radius for hazards). */
  r: number;
}

export type SizeId = 's' | 'm' | 'l' | 'xl';
/** Half the arena's side (metres) per size preset; XL is the whole island. */
export const SIZES: { id: SizeId; half: number }[] = [
  { id: 's', half: 24 },
  { id: 'm', half: 34 },
  { id: 'l', half: 44 },
  { id: 'xl', half: 54 },
];
export const SIZE_HALF = Object.fromEntries(SIZES.map((s) => [s.id, s.half])) as Record<SizeId, number>;

export interface ArenaRules {
  /** Biome key: 'meadow' or a remix like 'meadow:autumn'. */
  biome: string;
  /** Wave preset id (WAVE_PRESETS) or 'custom' (then `foes`). */
  waves: string;
  foes: string[];
  /** Stage length in seconds. */
  time: number;
  /** Boss id or 'auto' (the stage's usual boss). */
  boss: string;
  difficulty: string;
  night: boolean;
  rain: boolean;
  wind: boolean;
  /** Stage and world events (meteor showers, floor collapse...). */
  events: boolean;
  /** Swarm rings that encircle the team. */
  rings: boolean;
  /** Heat handicaps (src/data/heat.ts ids). */
  heat: string[];
}

export interface CustomArena {
  v: 1;
  name: string;
  size: SizeId;
  pieces: ArenaPiece[];
  rules: ArenaRules;
}

export const NAME_MAX = 24;
export const TIME_MIN = 60;
export const TIME_MAX = 480;
export const TIME_STEP = 30;
export const FOES_MAX = 8;

/** Enemy mixes for the WAVES rule. 'classic' keeps the normal director roster. */
export const WAVE_PRESETS: { id: string; foes: string[] }[] = [
  { id: 'classic', foes: [] },
  { id: 'swarm', foes: ['swarmer', 'zippy', 'bopper', 'bee', 'splitter'] },
  { id: 'shooters', foes: ['shooter', 'burster', 'sniper', 'spinner', 'mortar', 'blinksniper'] },
  { id: 'brutes', foes: ['chonk', 'charger', 'shielder', 'bastion', 'leaper', 'roller'] },
  { id: 'boom', foes: ['exploder', 'bombcourier', 'splitter', 'mortar', 'burrower'] },
  { id: 'natives', foes: ['bee', 'shark', 'roller', 'slug', 'soldier', 'kite', 'gummy', 'jellyfish'] },
  { id: 'all', foes: [] },
];
export const WAVE_IDS = [...WAVE_PRESETS.map((w) => w.id), 'custom'];

/** Regular enemies the director can send (the bestiary roster minus bosses, parts and specials). */
export function rosterFoes(): EnemyDef[] {
  return Object.values(ENEMIES)
    .filter((d) => d.minMinute >= 0 && d.weight > 0 && !d.boss && !d.miniboss && !d.hidden && !d.treasure)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Boss choices, in a sensible order; 'auto' follows the stage like a normal run. */
export const BOSS_IDS = ['auto', 'king', 'rex', 'queen', 'omega', 'glitch', 'boxer', 'gale', 'cake', 'kraken', 'king_ex', 'rex_inferno', 'queen_night', 'titan', 'pumpking'];
export function bossChoices(): string[] {
  return BOSS_IDS.filter((id) => id === 'auto' || ENEMIES[id]?.boss);
}

/** Difficulties the editor offers (co-op-only LEGEND is not a custom-arena option). */
export function difficultyChoices(): string[] {
  return DIFFICULTIES.filter((d) => !d.coopOnly).map((d) => d.id);
}

export function defaultRules(): ArenaRules {
  return { biome: 'meadow', waves: 'classic', foes: [], time: 240, boss: 'auto', difficulty: 'normal', night: false, rain: false, wind: false, events: true, rings: true, heat: [] };
}

/** A fresh arena: one hero spawn in the middle and a boss marker above it. */
export function newArena(name = 'MY ARENA'): CustomArena {
  return { v: 1, name, size: 'm', pieces: [{ k: 'hero', x: 0, z: 4, r: 0 }, { k: 'boss', x: 0, z: -14, r: 0 }], rules: defaultRules() };
}

/** Strip control and markup characters, collapse spaces, upper-case, clamp. */
export function cleanName(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return [...s].slice(0, NAME_MAX).join('') || 'CUSTOM ARENA';
}

const int = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/** Any outside value -> a valid CustomArena (unknown ids fall back, out-of-range pieces are dropped, caps applied). */
export function normalizeArena(raw: unknown): CustomArena {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Partial<CustomArena> & Record<string, unknown>;
  const size: SizeId = SIZES.some((s) => s.id === a.size) ? (a.size as SizeId) : 'm';
  const half = SIZE_HALF[size];
  const r0 = (a.rules && typeof a.rules === 'object' ? a.rules : {}) as Partial<ArenaRules>;
  const def = defaultRules();
  const roster = new Set(rosterFoes().map((d) => d.id));
  const rules: ArenaRules = {
    biome: typeof r0.biome === 'string' && allBiomeKeys().includes(r0.biome) ? r0.biome : def.biome,
    waves: typeof r0.waves === 'string' && WAVE_IDS.includes(r0.waves) ? r0.waves : def.waves,
    foes: Array.isArray(r0.foes) ? [...new Set(r0.foes.filter((id): id is string => typeof id === 'string' && roster.has(id)))].slice(0, FOES_MAX) : [],
    time: Math.round(int(r0.time, TIME_MIN, TIME_MAX, def.time) / TIME_STEP) * TIME_STEP,
    boss: typeof r0.boss === 'string' && bossChoices().includes(r0.boss) ? r0.boss : def.boss,
    difficulty: typeof r0.difficulty === 'string' && difficultyChoices().includes(r0.difficulty) ? r0.difficulty : def.difficulty,
    night: !!r0.night,
    rain: !!r0.rain,
    wind: !!r0.wind,
    events: r0.events === undefined ? def.events : !!r0.events,
    rings: r0.rings === undefined ? def.rings : !!r0.rings,
    heat: Array.isArray(r0.heat) ? HEAT.filter((h) => (r0.heat as unknown[]).includes(h.id)).map((h) => h.id) : [],
  };
  if (rules.waves === 'custom' && !rules.foes.length) rules.waves = 'classic';
  const pieces: ArenaPiece[] = [];
  const counts: Partial<Record<PieceId, number>> = {};
  for (const p of Array.isArray(a.pieces) ? a.pieces : []) {
    if (pieces.length >= MAX_PIECES) break;
    if (!p || typeof p !== 'object') continue;
    const k = (p as ArenaPiece).k;
    const pd = PIECE_BY_ID[k as PieceId];
    if (!pd) continue;
    const x = Math.round(Number((p as ArenaPiece).x));
    const z = Math.round(Number((p as ArenaPiece).z));
    const r = int((p as ArenaPiece).r, 0, 3, 0);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !insideArena(k, x, z, r, half)) continue;
    if ((counts[k] ?? 0) >= pd.max) continue;
    counts[k] = (counts[k] ?? 0) + 1;
    pieces.push({ k, x, z, r });
  }
  return { v: 1, name: cleanName(a.name), size, pieces, rules };
}

/** Does a piece at (x, z) fit inside an arena of this half size (its footprint, and a pad's landing spot)? */
export function insideArena(k: PieceId, x: number, z: number, r: number, half: number): boolean {
  const f = footprint(k, r);
  const lim = half - 1;
  if (Math.abs(x) + f.w / 2 > lim + 0.01 || Math.abs(z) + f.d / 2 > lim + 0.01) return false;
  if (k === 'pad') {
    const t = padTarget({ k, x, z, r });
    if (Math.abs(t.x) > lim - 1 || Math.abs(t.z) > lim - 1) return false;
  }
  return true;
}

export function padTarget(p: ArenaPiece): { x: number; z: number } {
  const d = dirOf(p.r);
  return { x: p.x + d.x * PAD_RANGE, z: p.z + d.z * PAD_RANGE };
}

/** Radius of a round hazard piece. */
export function hazardRadius(p: ArenaPiece): number {
  return HAZARD_RADII[p.r & 3];
}

/** The collider a solid piece makes (same numbers the arena builder uses), or null. */
export function pieceBox(p: ArenaPiece): AABB | null {
  const def = PIECE_BY_ID[p.k];
  if (!def?.solid) return null;
  const f = footprint(p.k, p.r);
  return aabbFromCenter(p.x, p.z, f.w, f.d);
}

/** Every collider the pieces make (no arena edge walls). */
export function pieceColliders(a: CustomArena): AABB[] {
  const out: AABB[] = [];
  for (const p of a.pieces) {
    const b = pieceBox(p);
    if (b) out.push(b);
  }
  return out;
}

/** The belt strip a belt piece makes, as the arena's conveyor record. */
export function beltOf(p: ArenaPiece): { x: number; z: number; w: number; d: number; dx: number; dz: number } {
  const d = dirOf(p.r);
  const along = d.x !== 0;
  return { x: p.x, z: p.z, w: along ? BELT_LEN : BELT_WIDE, d: along ? BELT_WIDE : BELT_LEN, dx: d.x, dz: d.z };
}

export function countOf(a: CustomArena, k: PieceId): number {
  let n = 0;
  for (const p of a.pieces) if (p.k === k) n++;
  return n;
}

/** Index of the topmost piece whose footprint covers (x, z), or -1 (markers and toys first, then cover, then ground patches). */
export function pieceAt(a: CustomArena, x: number, z: number): number {
  let best = -1;
  let rank = -1;
  for (let i = 0; i < a.pieces.length; i++) {
    const p = a.pieces[i];
    const def = PIECE_BY_ID[p.k];
    const hit = def.round ? (x - p.x) ** 2 + (z - p.z) ** 2 <= hazardRadius(p) ** 2 : (() => {
      const f = footprint(p.k, p.r);
      return Math.abs(x - p.x) <= Math.max(0.5, f.w / 2) && Math.abs(z - p.z) <= Math.max(0.5, f.d / 2);
    })();
    if (!hit) continue;
    const r = def.group === 'marker' ? 3 : def.group === 'toy' ? 2 : def.round ? 0 : 1;
    if (r >= rank) {
      rank = r;
      best = i;
    }
  }
  return best;
}

// ------------------------------------------------------------------ validity

export type IssueId = 'noHero' | 'heroBlocked' | 'heroHazard' | 'heroSplit' | 'bossBlocked' | 'bossUnreachable' | 'cramped' | 'chestUnreachable' | 'turretUnreachable' | 'gateBlocked' | 'noBoss';
export interface Issue {
  id: IssueId;
  x: number;
  z: number;
}
export interface Validity {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Walkable floor reached from the first hero spawn, in m². */
  area: number;
  /** Reach grid (1 m cells, row-major from -half): 1 = a hero can walk here. */
  reach: Uint8Array;
  half: number;
}

/** Hero clearance used for the walk grid (a touch more than the hero's 0.45 m radius). */
const CLEAR = 0.5;
/** Fewest m² of reachable floor a playable arena needs. */
export const MIN_AREA = 140;

/** Hazards that hurt to stand in (a hero spawn there is an error). */
const HURTS: PieceId[] = ['lava', 'thorns'];

/**
 * Walk grid flood fill from the hero spawns. Solid pieces (grown by the hero
 * radius) and the arena edge block; hazards, belts and water don't; a jump pad
 * also links to its landing spot. Errors stop PLAY / HOST; warnings are hints.
 */
export function validateArena(a: CustomArena): Validity {
  const half = SIZE_HALF[a.size];
  const n = half * 2;
  const blocked = new Uint8Array(n * n);
  const boxes = pieceColliders(a);
  const lim = half - 1;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -half + i + 0.5;
      const z = -half + j + 0.5;
      if (Math.abs(x) > lim - CLEAR || Math.abs(z) > lim - CLEAR) {
        blocked[j * n + i] = 1;
        continue;
      }
      for (const b of boxes) {
        if (x > b.minX - CLEAR && x < b.maxX + CLEAR && z > b.minZ - CLEAR && z < b.maxZ + CLEAR) {
          blocked[j * n + i] = 1;
          break;
        }
      }
    }
  const cell = (x: number, z: number) => {
    const i = Math.floor(x + half);
    const j = Math.floor(z + half);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };
  // A pad covers the four cells around its centre; stepping on any of them lands at its target.
  const pads: { from: number; to: number }[] = [];
  for (const p of a.pieces) {
    if (p.k !== 'pad') continue;
    const to = cell(padTarget(p).x, padTarget(p).z);
    for (let dz = -1; dz <= 0; dz++)
      for (let dx = -1; dx <= 0; dx++) {
        const c = cell(p.x + dx + 0.5, p.z + dz + 0.5);
        if (c >= 0 && to >= 0) pads.push({ from: c, to });
      }
  }
  const fill = (start: number): Uint8Array => {
    const seen = new Uint8Array(n * n);
    if (start < 0 || blocked[start]) return seen;
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const c = queue.pop()!;
      const i = c % n;
      const j = (c - i) / n;
      const next = [i > 0 ? c - 1 : -1, i < n - 1 ? c + 1 : -1, j > 0 ? c - n : -1, j < n - 1 ? c + n : -1];
      for (const pd of pads) if (pd.from === c && pd.to >= 0) next.push(pd.to);
      for (const m of next) {
        if (m < 0 || seen[m] || blocked[m]) continue;
        seen[m] = 1;
        queue.push(m);
      }
    }
    return seen;
  };

  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const heroes = a.pieces.filter((p) => p.k === 'hero');
  const free = (p: ArenaPiece) => {
    const c = cell(p.x, p.z);
    return c >= 0 && !blocked[c];
  };
  if (!heroes.length) errors.push({ id: 'noHero', x: 0, z: 0 });
  for (const h of heroes) {
    if (!free(h)) errors.push({ id: 'heroBlocked', x: h.x, z: h.z });
    else if (a.pieces.some((p) => HURTS.includes(p.k) && (p.x - h.x) ** 2 + (p.z - h.z) ** 2 < (hazardRadius(p) + 0.6) ** 2)) errors.push({ id: 'heroHazard', x: h.x, z: h.z });
  }
  const first = heroes.find(free);
  const reach = first ? fill(cell(first.x, first.z)) : new Uint8Array(n * n);
  const reached = (p: { x: number; z: number }) => {
    const c = cell(p.x, p.z);
    return c >= 0 && reach[c] === 1;
  };
  for (const h of heroes) if (free(h) && first && h !== first && !reached(h)) errors.push({ id: 'heroSplit', x: h.x, z: h.z });
  const boss = a.pieces.find((p) => p.k === 'boss');
  if (!boss) warnings.push({ id: 'noBoss', x: 0, z: 0 });
  else if (!free(boss)) errors.push({ id: 'bossBlocked', x: boss.x, z: boss.z });
  else if (first && !reached(boss)) errors.push({ id: 'bossUnreachable', x: boss.x, z: boss.z });
  let area = 0;
  for (let c = 0; c < reach.length; c++) area += reach[c];
  if (first && area < MIN_AREA) errors.push({ id: 'cramped', x: first.x, z: first.z });
  for (const p of a.pieces) {
    if (p.k === 'chest' && first && !reached(p)) warnings.push({ id: 'chestUnreachable', x: p.x, z: p.z });
    if (p.k === 'turret' && first && !reached(p)) warnings.push({ id: 'turretUnreachable', x: p.x, z: p.z });
    if (p.k === 'gate' && !free(p)) warnings.push({ id: 'gateBlocked', x: p.x, z: p.z });
  }
  return { ok: errors.length === 0, errors, warnings, area, reach, half };
}

/** The pieces sorted for a stable fingerprint (so the same layout keeps its best score whatever the build order). */
export function arenaKey(a: CustomArena): string {
  const parts = a.pieces.map((p) => `${p.k}${p.x},${p.z},${p.r}`).sort();
  const r = a.rules;
  const s = `${a.size}|${parts.join(';')}|${r.biome}|${r.waves}|${r.foes.join(',')}|${r.time}|${r.boss}|${r.difficulty}|${+r.night}${+r.rain}${+r.wind}${+r.events}${+r.rings}|${r.heat.join(',')}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

