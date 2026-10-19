/**
 * Mid-stage world events (world-events lane): the field itself changes in the
 * middle of a fight. At most one per stage, rolled from the arena seed and the
 * stage number, and it replaces that stage's classic event (src/game/runEvents.ts):
 *   collapse  telegraphed sections of the field fall into the void (no-walk holes)
 *   flood     water rises over low ground: slows everyone, douses Burn, spreads Shock
 *   split     a chasm opens across the island; plank bridges stay
 *   giant     a colossus wades across, stamping telegraphed footprints into the field
 *   eclipse   the sun goes out (night look), then bursts back and dazzles enemies
 *   flower    a giant flower grows near the team and blooms into a healing zone
 *   volcano   a volcano at the shore erupts and rains telegraphed lava bombs
 *   stealth   a stage variant (Night Raid route node, or a seeded chance on night
 *             stages): enemies only notice you in light or when you make noise
 *
 * Everything in this file is pure (plans, geometry, timelines, light), so the
 * host and every client build the same holes, chasms and lights from the
 * plan numbers the host sends (`p`). Behaviour lives in src/game/systems/worldEvents.ts.
 */
import { Rng } from '../core/rng';
import type { AABB } from '../world/collision';
import type { Enemy } from './enemies';

/**
 * Hooks other systems read. `hidden(e)`: on a stealth stage, unaware enemies are skipped by
 * `Game.nearestEnemy`, so auto weapons, pets and turrets hold fire until the team goes loud.
 */
export const worldHooks: { hidden: ((e: Enemy) => boolean) | null } = { hidden: null };

export type WorldEventKind = 'collapse' | 'flood' | 'split' | 'giant' | 'eclipse' | 'flower' | 'volcano' | 'stealth';

export const WORLD_EVENT_KINDS: readonly WorldEventKind[] = ['collapse', 'flood', 'split', 'giant', 'eclipse', 'flower', 'volcano', 'stealth'];

export interface WorldEventDef {
  id: WorldEventKind;
  name: string;
  sub: string;
  /** Sweetie 16 colour for the HUD. */
  color: string;
  /** Roll weight (0 = never rolled mid-stage). */
  weight: number;
  /** Biome ids it can happen in (undefined = all but `notIn`). */
  onlyIn?: string[];
  notIn?: string[];
  /** Never on a night stage (it is already dark). */
  dayOnly?: boolean;
}

export const WORLD_EVENTS: Record<WorldEventKind, WorldEventDef> = {
  collapse: { id: 'collapse', name: 'THE GROUND GIVES WAY!', sub: 'GET OFF THE CRACKS', color: '#ef7d57', weight: 3, notIn: ['sky'] },
  flood: { id: 'flood', name: 'FLASH FLOOD!', sub: 'WATER SLOWS · SHOCK SPREADS · FIRE GOES OUT', color: '#41a6f6', weight: 3, notIn: ['magma', 'sky'] },
  split: { id: 'split', name: 'THE ISLAND SPLITS!', sub: 'GET TO A BRIDGE', color: '#b13e53', weight: 2, notIn: ['sky'] },
  giant: { id: 'giant', name: 'THE COLOSSUS WALKS!', sub: 'MIND ITS FEET', color: '#94b0c2', weight: 3 },
  eclipse: { id: 'eclipse', name: 'ECLIPSE!', sub: 'DARKNESS FALLS', color: '#5d275d', weight: 2, dayOnly: true },
  flower: { id: 'flower', name: 'A GIANT FLOWER SPROUTS', sub: 'STAND IN THE BLOOM TO HEAL', color: '#a7f070', weight: 2, notIn: ['magma', 'neon'] },
  volcano: { id: 'volcano', name: 'ERUPTION!', sub: 'LAVA BOMBS INCOMING', color: '#ff7a2f', weight: 2, onlyIn: ['magma', 'dunes', 'peaks', 'meadow'] },
  stealth: { id: 'stealth', name: 'NIGHT RAID', sub: 'STAY IN THE SHADOWS · GRAB THE INTEL', color: '#3b5dc9', weight: 0 },
};

export const worldEventTuning = {
  enabled: true,
  /** Chance a stage gets a world event (stage 1, later stages). */
  chanceFirst: 0.25,
  chance: 0.6,
  /** When it starts, as a share of the stage clock. */
  from: 0.35,
  to: 0.6,
  /** Night stages: chance the stage is a stealth Night Raid instead. */
  stealthNight: 0.35,
  /** Mid-stage events wait while a classic stage event still runs, but never start after this share. */
  latest: 0.8,

  // --- Floor collapse
  cell: 6, // m, square sections
  waves: 3,
  perWave: 3,
  waveEvery: 8, // s between waves of cracks
  crackTime: 3.5, // s of cracks and rumble before a section drops
  collapseMin: 6, // m from the team's centre
  collapseMax: 24,
  collapseHeroDmg: 12, // x stage damage; heroes are pushed to the edge, never dropped
  // --- Island split
  chasmWidth: 4,
  bridgeWidth: 5.5,
  splitWarn: 4,
  splitOffset: 7, // m up-screen of the team, so the crack is in view
  bridgeSpread: 22,
  splitHeroDmg: 10,
  // --- Flood
  floodZones: 3,
  floodRMin: 8,
  floodRMax: 12,
  floodWarn: 3,
  floodRise: 6,
  floodHold: 30,
  floodFall: 6,
  floodHeroSlow: 0.7, // hero speed in water
  floodEnemySlow: 0.4, // enemy slow amount in water
  floodShockR: 5, // a shocked enemy in water shocks wet enemies this close
  floodShockEvery: 0.4,
  // --- Colossus
  giantSteps: 14,
  giantStride: 8.5,
  giantStepT: 1.6,
  giantFirst: 3, // s before the first step lands
  giantWarn: 1.4, // footprint telegraph
  giantR: 3.6, // stomp radius
  giantKnockR: 7.5,
  giantHeroDmg: 30, // x stage damage (one hit never takes more than playerTuning.maxHitFrac)
  giantOffsetMin: 5,
  giantOffsetMax: 9,
  giantSide: 2.2, // left/right foot offset
  // --- Eclipse
  eclipseFade: 5,
  eclipseDark: 25,
  eclipseSpeed: 0.15, // enemies move this much faster in the dark
  eclipseDazzle: 2.5, // s enemies are dazzled when the sun bursts back
  eclipseDazzleSlow: 0.6,
  eclipseRange: 30,
  // --- Giant flower
  flowerGrow: 6,
  flowerBloom: 22,
  flowerWilt: 4,
  flowerR: 4.5,
  flowerHeal: 0.04, // share of max life per second
  flowerDistMin: 8,
  flowerDistMax: 13,
  flowerSlow: 0.3, // pollen slows enemies in the bloom
  // --- Volcano
  volcanoWarn: 3,
  volcanoLen: 25,
  bombEvery: 0.65,
  bombFlight: 1.5,
  bombR: 2.3,
  bombHeroDmg: 16, // x stage damage
  bombFoe: 40, // x enemy hp scaling
  puddleR: 1.5,
  puddleLife: 6,
  puddleDmg: 5,
  puddleTick: 0.6,
  // --- Stealth (Night Raid)
  caches: 3,
  cacheTime: 1.5, // s standing on a cache to grab it
  cacheR: 1.7,
  lamps: 14,
  lampR: 5.5,
  searchlights: 2,
  searchR: 3.6,
  baseLight: 0.12, // how visible you are in the dark
  darkSight: 3.2, // m an enemy sees you in the dark
  litSight: 13, // m it sees you fully lit
  notice: 1.6, // suspicion per second when seen (1 = alert)
  alertTime: 9, // s an alert enemy keeps hunting after losing you
  spread: 7, // m an alert spreads to other enemies
  noiseFire: 9, // m: firing your left click
  noiseLoud: 13, // m: loud left clicks (Scattergun, Rail Driver)
  noiseDash: 4.5,
  noiseSpecial: 22, // m: specials and the bomb
  patrolSpeed: 0.35,
  searchSpeed: 0.6,
  ghostMul: 2, // cache rewards when no hunter is close
};

const T = worldEventTuning;

/** Small integer hash -> [0, 1). */
export function hash01(n: number): number {
  let h = (n | 0) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Seed for one stage's event (same on every machine). */
export function eventSeed(arenaSeed: number, stage: number): number {
  return (Math.imul(arenaSeed ^ 0x2f6b1d3, 2654435761) ^ Math.imul(stage + 7, 40503)) >>> 0;
}

/** Kinds that can happen mid-stage in a biome. */
export function kindsFor(biomeId: string, night: boolean): WorldEventKind[] {
  return WORLD_EVENT_KINDS.filter((k) => {
    const d = WORLD_EVENTS[k];
    if (d.weight <= 0) return false;
    if (d.onlyIn && !d.onlyIn.includes(biomeId)) return false;
    if (d.notIn?.includes(biomeId)) return false;
    return !(d.dayOnly && night);
  });
}

/**
 * Roll this stage's world event. Pure: (arena seed, stage, biome, night, last kind) -> a kind and its
 * start as a share of the stage clock (0 for stealth: the whole stage), or null for a plain stage.
 */
export function planWorldEvent(arenaSeed: number, stage: number, biomeId: string, night: boolean, prev: WorldEventKind | null = null): { kind: WorldEventKind; at: number } | null {
  const rng = new Rng(eventSeed(arenaSeed, stage));
  if (night && rng.chance(T.stealthNight)) return { kind: 'stealth', at: 0 };
  if (!rng.chance(stage <= 1 ? T.chanceFirst : T.chance)) return null;
  const kinds = kindsFor(biomeId, night).filter((k) => k !== prev);
  if (!kinds.length) return null;
  const w = (k: WorldEventKind) => WORLD_EVENTS[k].weight * (k === 'volcano' && biomeId === 'magma' ? 2 : 1);
  let r = rng.next() * kinds.reduce((a, k) => a + w(k), 0);
  let i = 0;
  while (i < kinds.length - 1 && (r -= w(kinds[i])) > 0) i++;
  return { kind: kinds[i], at: rng.range(T.from, T.to) };
}

/** Seconds after its start that an event's own action is over (its holes and chasms stay). */
export function eventLength(kind: WorldEventKind): number {
  switch (kind) {
    case 'collapse':
      return collapseFallAt(T.waves - 1) + 1.2;
    case 'split':
      return T.splitWarn + 2;
    case 'flood':
      return T.floodWarn + T.floodRise + T.floodHold + T.floodFall;
    case 'giant':
      return T.giantFirst + T.giantSteps * T.giantStepT + 2;
    case 'eclipse':
      return T.eclipseFade + T.eclipseDark + 1;
    case 'flower':
      return T.flowerGrow + T.flowerBloom + T.flowerWilt;
    case 'volcano':
      return T.volcanoWarn + T.volcanoLen + T.bombFlight + T.puddleLife;
    case 'stealth':
      return Infinity;
  }
}

// ------------------------------------------------------------------ floor collapse

/** Seconds after the start that wave `w`'s sections drop. */
export function collapseFallAt(w: number): number {
  return 1 + w * T.waveEvery + T.crackTime;
}

/** Seconds after the start that wave `w`'s cracks appear. */
export function collapseCrackAt(w: number): number {
  return 1 + w * T.waveEvery;
}

/**
 * Pick the sections that fall: square cells on a grid around the team's centre (ax, az), in clusters of
 * `perWave` per wave. `avoid(x, z, r)` rejects cells over things that must stay reachable (toys, chests).
 * Returns flat [x, z, wave] triples. Pure.
 */
export function collapsePlan(seed: number, ax: number, az: number, half: number, avoid: (x: number, z: number, r: number) => boolean = () => false): number[] {
  const rng = new Rng(seed ^ 0x51ed27);
  const C = T.cell;
  const lim = half - C * 0.5 - 2;
  const cand: { x: number; z: number }[] = [];
  const gx = Math.round(ax / C);
  const gz = Math.round(az / C);
  const span = Math.ceil(T.collapseMax / C) + 1;
  for (let i = -span; i <= span; i++)
    for (let j = -span; j <= span; j++) {
      const x = (gx + i) * C;
      const z = (gz + j) * C;
      const d = Math.hypot(x - ax, z - az);
      if (d < T.collapseMin || d > T.collapseMax) continue;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      if (Math.hypot(x, z) < 6) continue; // the start plaza stays
      if (avoid(x, z, C * 0.75)) continue;
      cand.push({ x, z });
    }
  const out: number[] = [];
  const taken = new Set<string>();
  for (let w = 0; w < T.waves && cand.length; w++) {
    const free = cand.filter((c) => !taken.has(`${c.x},${c.z}`));
    if (!free.length) break;
    const seedCell = free[Math.floor(rng.next() * free.length)];
    // The cluster: the seed cell and its nearest free neighbours (a ragged chunk, not a line).
    const near = free
      .map((c) => ({ c, d: Math.hypot(c.x - seedCell.x, c.z - seedCell.z) + rng.next() * 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, T.perWave);
    for (const { c } of near) {
      taken.add(`${c.x},${c.z}`);
      out.push(c.x, c.z, w);
    }
  }
  return out;
}

/** The hole a collapse cell leaves (a gap: blocks walking, bullets fly over). */
export function cellBox(x: number, z: number): AABB {
  // Exact cells: neighbours join without a seam a hero could get stuck in.
  const h = T.cell / 2;
  return { minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h, gap: true };
}

// ------------------------------------------------------------------ island split

/**
 * The chasm: [axis, pos, bridge1, bridge2, bridge3]. axis 0 = runs along x at z = pos (across the
 * screen, just up-screen of the team); axis 1 = runs along z at x = pos. Bridges are centres along the run.
 */
export function splitPlan(seed: number, ax: number, az: number, half: number): number[] {
  const rng = new Rng(seed ^ 0x7a11);
  const axis = rng.chance(0.65) ? 0 : 1;
  const lim = half - 10;
  let pos: number;
  let along: number;
  if (axis === 0) {
    pos = az - T.splitOffset - rng.range(0, 1.5);
    along = ax;
  } else {
    pos = ax + (rng.chance(0.5) ? 1 : -1) * (T.splitOffset + 2 + rng.range(0, 2));
    along = az;
  }
  pos = Math.max(-lim, Math.min(lim, pos));
  if (Math.abs(pos) < T.chasmWidth) pos = pos < 0 ? -T.chasmWidth : T.chasmWidth; // keep the start plaza whole
  const b1 = Math.max(-half + 8, Math.min(half - 8, along + rng.range(-3, 3)));
  const s = T.bridgeSpread + rng.range(-3, 3);
  const b2 = b1 - s < -half + 6 ? b1 + 2 * s : b1 - s;
  const b3 = b1 + s > half - 6 ? b1 - 2 * s : b1 + s;
  return [axis, pos, b1, Math.max(-half + 4, Math.min(half - 4, b2)), Math.max(-half + 4, Math.min(half - 4, b3))];
}

/** The chasm's gap boxes: the band across the island minus the bridges. Pure. */
export function splitBoxes(p: number[], half: number): AABB[] {
  const [axis, pos] = p;
  const bridges = p.slice(2, 5).sort((a, b) => a - b);
  const w = T.chasmWidth / 2;
  const bw = T.bridgeWidth / 2;
  const out: AABB[] = [];
  let from = -half;
  for (const b of [...bridges, half + bw]) {
    const to = b - bw;
    if (to - from > 0.5) out.push(axis === 0 ? { minX: from, maxX: to, minZ: pos - w, maxZ: pos + w, gap: true } : { minX: pos - w, maxX: pos + w, minZ: from, maxZ: to, gap: true });
    from = Math.max(from, b + bw);
  }
  return out;
}

// ------------------------------------------------------------------ flood

/** Low ground that floods: [x, z, r] triples, the first one over the team. Pure. */
export function floodPlan(seed: number, ax: number, az: number, half: number): number[] {
  const rng = new Rng(seed ^ 0xf100d);
  const out: number[] = [];
  const lim = half - 6;
  for (let i = 0; i < T.floodZones; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = i === 0 ? rng.range(0, 4) : rng.range(12, 24);
    const r = rng.range(T.floodRMin, T.floodRMax);
    out.push(Math.max(-lim, Math.min(lim, ax + Math.cos(a) * d)), Math.max(-lim, Math.min(lim, az + Math.sin(a) * d)), r);
  }
  return out;
}

/** Water level 0..1 at event time t (warning, rise, hold, fall). */
export function floodLevel(t: number): number {
  const a = T.floodWarn;
  const b = a + T.floodRise;
  const c = b + T.floodHold;
  const d = c + T.floodFall;
  if (t <= a || t >= d) return 0;
  if (t < b) return smooth((t - a) / T.floodRise);
  if (t < c) return 1;
  return 1 - smooth((t - c) / T.floodFall);
}

/** How deep (0..1) the water is at (x, z): 0 = dry. */
export function floodDepth(p: number[], level: number, x: number, z: number): number {
  if (level <= 0) return 0;
  let best = 0;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const r = p[i + 2] * level;
    const d = Math.hypot(x - p[i], z - p[i + 1]);
    if (d < r) best = Math.max(best, Math.min(1, (r - d) / 1.5));
  }
  return best;
}

// ------------------------------------------------------------------ colossus

/** The colossus's walk: [startX, startZ, dirX, dirZ]. It crosses the field just beside the team. Pure. */
export function giantPlan(seed: number, ax: number, az: number): number[] {
  const rng = new Rng(seed ^ 0x61a7);
  // Mostly across the screen (along x), so its feet come into view one after another.
  const ang = rng.chance(0.6) ? (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.25, 0.25) : (rng.chance(0.5) ? 1 : -1) * Math.PI / 2 + rng.range(-0.3, 0.3);
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  const off = (rng.chance(0.5) ? 1 : -1) * rng.range(T.giantOffsetMin, T.giantOffsetMax);
  const L = T.giantStride * (T.giantSteps - 1);
  // Perpendicular (-dz, dx), offset so the path passes beside the team.
  return [ax - dx * L * 0.5 - dz * off, az - dz * L * 0.5 + dx * off, dx, dz];
}

/** Where step i lands (feet alternate either side of the path). */
export function giantStep(p: number[], i: number, out: { x: number; z: number }): { x: number; z: number } {
  const [sx, sz, dx, dz] = p;
  const side = (i % 2 === 0 ? 1 : -1) * T.giantSide;
  out.x = sx + dx * T.giantStride * i - dz * side;
  out.z = sz + dz * T.giantStride * i + dx * side;
  return out;
}

/** Event time when step i lands. */
export function giantStepTime(i: number): number {
  return T.giantFirst + i * T.giantStepT;
}

// ------------------------------------------------------------------ eclipse, flower

/** Darkness 0..1 at event time t: fades in, holds, snaps back at the burst. */
export function eclipseNight(t: number): number {
  if (t <= 0) return 0;
  if (t < T.eclipseFade) return smooth(t / T.eclipseFade);
  return t < T.eclipseFade + T.eclipseDark ? 1 : 0;
}

/** Event time of the sun burst. */
export function eclipseBurstAt(): number {
  return T.eclipseFade + T.eclipseDark;
}

/** Flower growth 0..1, whether it is in bloom (healing), and wilting 0..1. */
export function flowerPhase(t: number): { grow: number; bloom: boolean; wilt: number } {
  const g = Math.min(1, Math.max(0, t / T.flowerGrow));
  const b0 = T.flowerGrow;
  const b1 = b0 + T.flowerBloom;
  return { grow: g, bloom: t >= b0 && t < b1, wilt: Math.min(1, Math.max(0, (t - b1) / T.flowerWilt)) };
}

// ------------------------------------------------------------------ stealth

export interface StealthLayout {
  caches: { x: number; z: number }[];
  lamps: { x: number; z: number; r: number }[];
  /** Searchlight towers: the beam circles the tower at radius `R`. */
  search: { x: number; z: number; R: number; ph: number }[];
}

/**
 * Night Raid layout: intel caches spread over the field, lamp posts (pools of light) and searchlight
 * towers. `blocked(x, z, r)` rejects spots inside walls. Returns flat numbers for the snapshot:
 * [nCaches, (x, z)..., nLamps, (x, z, r)..., nSearch, (x, z, R, phase)...]. Pure.
 */
export function stealthPlan(seed: number, half: number, blocked: (x: number, z: number, r: number) => boolean = () => false): number[] {
  const rng = new Rng(seed ^ 0x57ea1);
  const lim = half - 6;
  const spot = (minD: number, maxD: number, r: number, others: { x: number; z: number }[], gap: number): { x: number; z: number } | null => {
    for (let k = 0; k < 40; k++) {
      const a = rng.next() * Math.PI * 2;
      const d = rng.range(minD, maxD);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (Math.abs(x) > lim || Math.abs(z) > lim || blocked(x, z, r)) continue;
      if (others.some((o) => Math.hypot(o.x - x, o.z - z) < gap)) continue;
      return { x, z };
    }
    return null;
  };
  const caches: { x: number; z: number }[] = [];
  for (let i = 0; i < T.caches; i++) {
    const s = spot(16, Math.min(40, lim), 1.5, caches, 22);
    if (s) caches.push(s);
  }
  const lamps: { x: number; z: number; r: number }[] = [];
  // A lamp near each cache (grabbing intel is a risk), the rest scattered.
  for (const c of caches) {
    const a = rng.next() * Math.PI * 2;
    const x = c.x + Math.cos(a) * 3.5;
    const z = c.z + Math.sin(a) * 3.5;
    if (!blocked(x, z, 0.5)) lamps.push({ x, z, r: T.lampR });
  }
  while (lamps.length < T.lamps) {
    const s = spot(9, lim, 0.5, lamps, 9);
    if (!s) break;
    lamps.push({ x: s.x, z: s.z, r: T.lampR * rng.range(0.8, 1.15) });
  }
  const search: { x: number; z: number; R: number; ph: number }[] = [];
  for (let i = 0; i < T.searchlights; i++) {
    const s = spot(14, lim - 4, 1, [...search, ...caches], 16);
    if (s) search.push({ x: s.x, z: s.z, R: rng.range(6, 9), ph: rng.next() * Math.PI * 2 });
  }
  const out: number[] = [caches.length];
  for (const c of caches) out.push(r2(c.x), r2(c.z));
  out.push(lamps.length);
  for (const l of lamps) out.push(r2(l.x), r2(l.z), r2(l.r));
  out.push(search.length);
  for (const s of search) out.push(r2(s.x), r2(s.z), r2(s.R), r2(s.ph));
  return out;
}

/** Decode stealthPlan's numbers. */
export function stealthLayout(p: number[]): StealthLayout {
  let i = 0;
  const caches: StealthLayout['caches'] = [];
  for (let n = p[i++] ?? 0; n > 0; n--, i += 2) caches.push({ x: p[i], z: p[i + 1] });
  const lamps: StealthLayout['lamps'] = [];
  for (let n = p[i++] ?? 0; n > 0; n--, i += 3) lamps.push({ x: p[i], z: p[i + 1], r: p[i + 2] });
  const search: StealthLayout['search'] = [];
  for (let n = p[i++] ?? 0; n > 0; n--, i += 4) search.push({ x: p[i], z: p[i + 1], R: p[i + 2], ph: p[i + 3] });
  return { caches, lamps, search };
}

/** Where searchlight `s`'s beam is at stage time t. */
export function searchBeam(s: StealthLayout['search'][number], t: number, out: { x: number; z: number }): { x: number; z: number } {
  const a = s.ph + t * (0.45 + (s.R % 1) * 0.2);
  out.x = s.x + Math.cos(a) * s.R;
  out.z = s.z + Math.sin(a) * s.R;
  return out;
}

const beam = { x: 0, z: 0 };
/** How lit (0..1) a spot is: lamp pools and searchlight beams over a dark base. Pure. */
export function lightAt(L: StealthLayout, t: number, x: number, z: number, extra: readonly { x: number; z: number; r: number }[] = []): number {
  let v = T.baseLight;
  const pool = (px: number, pz: number, r: number, k: number) => {
    const d = Math.hypot(x - px, z - pz);
    if (d < r) v = Math.max(v, k * (d < r * 0.6 ? 1 : 1 - (d - r * 0.6) / (r * 0.4)));
  };
  for (const l of L.lamps) pool(l.x, l.z, l.r, 0.9);
  for (const l of extra) pool(l.x, l.z, l.r, 0.75);
  for (const s of L.search) {
    searchBeam(s, t, beam);
    pool(beam.x, beam.z, T.searchR, 1);
  }
  return Math.min(1, v);
}

/** How far an enemy sees a hero with visibility v (0..1). */
export function sightRange(v: number, elite = false): number {
  return (T.darkSight + (T.litSight - T.darkSight) * Math.min(1, Math.max(0, (v - T.baseLight) / (1 - T.baseLight)))) * (elite ? 1.4 : 1);
}

function smooth(k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
