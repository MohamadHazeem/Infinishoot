import type { Rng } from '../core/rng';
import type { Tag } from '../data/tags';
import type { SpecialDef } from '../data/specials';
import type { Enemy } from './enemies';
import type { Hero } from './hero';
import type { Vfx } from './vfx';
import type { DamageOpts } from './weapons';
import { freezeMul } from './bossRules';

/** What a special may touch. Implemented by Game (host/solo only). */
export interface SpecialApi {
  readonly enemies: Enemy[]; // game.enemies.list (check e.alive / e.hp > 0 / e.def.boss)
  readonly rng: Rng; // seeded gameplay RNG: rng.next(), rng.chance(p)
  readonly vfx: Vfx; // burst, ring, star, sound(name, x, z), shake, flash, banner, zone, num
  damage(e: Enemy, base: number, o: DamageOpts, by: Hero): number;
  blast(x: number, z: number, r: number, base: number, color: string, source: string, tags: Tag[], noStatus: boolean, by: Hero): void;
  zap(from: Enemy, hops: number, dmg: number, by: Hero): void; // chain lightning with its own visuals
  ignite(e: Enemy, dps: number, by: Hero): void;
}

const STORM_TAGS: Tag[] = ['shock', 'chain'];
const FIRESTORM_TAGS: Tag[] = ['shock', 'chain', 'fire'];
const ICE_TAGS: Tag[] = ['frost', 'area'];
const GLACIER_TAGS: Tag[] = ['frost', 'explosive'];
const METEOR_TAGS: Tag[] = ['explosive', 'fire'];
const COMET_TAGS: Tag[] = ['explosive', 'frost'];
const CRATER_TICK = 0.25;
const MAX_GLACIER_BURSTS = 30;
/** Storm/meteor avoid the last few enemies they hit, so strikes spread out. */
const RECENT = 5;
const METEOR_TELE = 0.55; // seconds from the ground mark to impact
const METEOR_FALL = 0.25; // the last part of it: the fiery streak coming down
const METEOR_H = 11; // streak start height

/** One running special. Fields are shared between kinds to keep it flat. */
interface Running {
  id: string;
  p: Record<string, number>;
  t: number;
  /** storm: strikes owed; meteor: meteors owed; blizzard: snow timer. */
  acc: number;
  /** storm: sound cooldown. */
  sndT: number;
  /** Strikes so far (storm) or meteors dropped (meteor). */
  n: number;
  recent: number[];
  rocks: { x: number; z: number; t: number }[];
  /** Blizzard: enemies its wave froze (Glacier Burst); Meteor: burning craters (Extinction). */
  frozen: Enemy[];
  craters: { x: number; z: number; t: number; tick: number }[];
  /** Black Hole: where it opened. */
  x: number;
  z: number;
}

const running = new Map<Hero, Running[]>();

/** Is h's special (not the Bomb) still going? The meter waits until it ends. */
export function isSpecialRunning(h: Hero): boolean {
  return (running.get(h)?.length ?? 0) > 0;
}
const near: Enemy[] = [];
const fresh: Enemy[] = [];

/** Start hero h's special (not the bomb). p = hero.specialP (its level or upgrade-track params). */
export function startSpecial(h: Hero, def: SpecialDef, p: Record<string, number>, api: SpecialApi): void {
  const v = api.vfx;
  const { x, z } = h.player;
  let frozen: Enemy[] = [];
  let hx = 0;
  let hz = 0;
  switch (def.id) {
    case 'storm':
      v.flash(0.2);
      v.sound('w:storm', x, z);
      v.sound('explode', x, z);
      v.ring(x, z, 1, p.radius * 2, p.fire ? '#ff7a2f' : '#41a6f6', 0.5);
      v.ring(x, z, 1, p.radius * 1.6, '#ffcd75', 0.4);
      break;
    case 'blizzard':
      frozen = blizzard(h, p, api);
      break;
    case 'meteor':
      v.sound('w:meteor', x, z);
      v.ring(x, z, 1, p.area * 2, p.ice ? '#9fe8ff' : '#ef7d57', 0.5);
      break;
    case 'blackhole': {
      // Opens where you aim (the cursor, clamped to range; sticks use the full range).
      const d = h.player.landDist(3, p.range);
      hx = x + h.player.aim.x * d;
      hz = z + h.player.aim.z * d;
      v.sound('w:blackhole', hx, hz);
      v.flash(0.15);
      v.ring(hx, hz, p.radius * 4, 0.5, def.color, 0.45);
      break;
    }
    default:
      return; // the Bomb lives in Game
  }
  let list = running.get(h);
  if (!list) running.set(h, (list = []));
  // acc = 1: the first strike / meteor comes on the next step.
  list.push({ id: def.id, p, t: 0, acc: def.id === 'blizzard' ? 0 : 1, sndT: 0, n: 0, recent: [], rocks: [], frozen, craters: [], x: hx, z: hz });
}

/** Advance every active special (call once per simulation step, host/solo only). */
export function updateSpecials(heroes: Hero[], dt: number, api: SpecialApi): void {
  for (const h of heroes) {
    const list = running.get(h);
    if (!list) continue;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.t += dt;
      const more = s.id === 'storm' ? storm(h, s, dt, api) : s.id === 'blizzard' ? snow(h, s, dt, api) : s.id === 'blackhole' ? hole(h, s, dt, api) : meteors(h, s, dt, api);
      if (!more) list.splice(i, 1);
    }
  }
}

/** Drop all running specials (new run / stage load). */
export function resetSpecials(): void {
  running.clear();
}

/** A random live enemy within r of (x, z), preferring ones not in `recent` (which it then joins). */
function pick(x: number, z: number, r: number, recent: number[], api: SpecialApi): Enemy | null {
  near.length = fresh.length = 0;
  const r2 = r * r;
  for (const e of api.enemies) {
    if (!e.alive || e.hp <= 0 || (e.x - x) ** 2 + (e.z - z) ** 2 > r2) continue;
    near.push(e);
    if (!recent.includes(e.uid)) fresh.push(e);
  }
  const pool = fresh.length ? fresh : near;
  if (!pool.length) return null;
  const e = api.rng.pick(pool);
  recent.push(e.uid);
  if (recent.length > RECENT) recent.shift();
  return e;
}

// ------------------------------------------------------------------ Thunderstorm

function storm(h: Hero, s: Running, dt: number, api: SpecialApi): boolean {
  const p = s.p;
  s.sndT -= dt;
  s.acc += dt * p.rate;
  while (s.acc >= 1) {
    s.acc -= 1;
    const e = pick(h.player.x, h.player.z, p.radius, s.recent, api);
    if (e) strike(h, s, e, api);
  }
  return s.t < p.dur;
}

function strike(h: Hero, s: Running, e: Enemy, api: SpecialApi): void {
  const v = api.vfx;
  const { x, z } = e;
  // A jagged bolt from the sky: stars stacked up a wobbling column (orange for Firestorm).
  const fire = s.p.fire > 0;
  let ox = 0;
  let oz = 0;
  for (let k = 1; k <= 5; k++) {
    ox += (Math.random() - 0.5) * 0.9;
    oz += (Math.random() - 0.5) * 0.9;
    v.star(x + ox, k * 1.9, z + oz, k % 2 ? 1.1 : 0.8, k % 2 ? '#ffffff' : fire ? '#ff7a2f' : '#fff35c', 0.1);
  }
  v.star(x, 0.6, z, 2, '#ffffff', 0.14);
  v.ring(x, z, 0.6, 4, '#ffcd75', 0.22);
  v.burst(x, 0.3, z, { count: 6, color: '#ffffff', color2: '#ffcd75', speed: [3, 8], size: [0.08, 0.18], life: [0.15, 0.3], up: 5, gravity: 16 });
  v.shake(x, z, 0.06);
  if (s.sndT <= 0) {
    v.sound(s.n % 3 ? 'w:zap' : 'explode', x, z);
    s.sndT = 0.15;
  }
  s.n++;
  api.damage(e, s.p.dmg, { source: 'storm', tags: fire ? FIRESTORM_TAGS : STORM_TAGS, canCrit: true, loud: true }, h);
  api.zap(e, s.p.chains, s.p.dmg * 0.6, h);
}

// ------------------------------------------------------------------ Blizzard

function blizzard(h: Hero, p: Record<string, number>, api: SpecialApi): Enemy[] {
  const frozen: Enemy[] = [];
  const v = api.vfx;
  const { x, z } = h.player;
  const R = p.radius;
  v.sound('w:freeze', x, z);
  v.flash(0.25);
  v.shake(x, z, 0.35);
  v.ring(x, z, 1, R * 2, '#73eff7', 0.55);
  v.ring(x, z, 1, R * 1.6, '#ffffff', 0.45);
  v.star(x, 1.2, z, 4, '#ffffff', 0.2);
  // Ice shards fly out to roughly the wave's edge (distance = speed / drag).
  v.burst(x, 0.6, z, { count: 40, color: '#ffffff', color2: '#73eff7', speed: [R * 2.2, R * 5], size: [0.14, 0.3], life: [0.3, 0.55], drag: 5 });
  let n = 0;
  for (const e of api.enemies) {
    if (!e.alive || e.hp <= 0) continue;
    const dx = e.x - x;
    const dz = e.z - z;
    const d = Math.hypot(dx, dz);
    if (d > R + e.radius) continue;
    // Bosses shrug off most of the freeze (as with Frost Nova).
    e.frozen = Math.max(e.frozen, p.freeze * freezeMul(e));
    e.shatter = Math.max(e.shatter, p.shatter);
    const k = d || 1;
    api.damage(e, p.dmg, { source: 'blizzard', tags: ICE_TAGS, dirX: dx / k, dirZ: dz / k, knockback: 3, canCrit: true, loud: n++ < 4 }, h);
    if (e.hp > 0) frozen.push(e);
  }
  return frozen;
}

/** After the wave: snow drifts down around the hero while the freeze lasts. */
function snow(h: Hero, s: Running, dt: number, api: SpecialApi): boolean {
  s.acc -= dt;
  if (s.acc <= 0) {
    s.acc += 0.1;
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * Math.min(s.p.radius, 12);
    api.vfx.burst(h.player.x + Math.cos(a) * d, 4.5 + Math.random() * 1.5, h.player.z + Math.sin(a) * d, {
      count: 3,
      color: '#ffffff',
      color2: '#94b0c2',
      speed: [0.3, 1.2],
      size: [0.1, 0.2],
      life: [1, 1.5],
      gravity: 4,
      drag: 1,
    });
  }
  // Ice Age: icicles rain on enemies that are still frozen.
  if (s.p.icicles > 0) {
    s.sndT -= dt;
    s.n += dt * s.p.icicles;
    while (s.n >= 1) {
      s.n -= 1;
      const live = s.frozen.filter((e) => e.alive && e.hp > 0 && e.frozen > 0);
      if (!live.length) break;
      const e = api.rng.pick(live);
      api.vfx.star(e.x, 2.4, e.z, 0.9, '#ffffff', 0.1);
      api.vfx.burst(e.x, 1.6, e.z, { count: 4, color: '#ffffff', color2: '#9fe8ff', speed: [2, 5], size: [0.1, 0.2], life: [0.15, 0.3], up: 2, gravity: 14 });
      if (s.sndT <= 0) {
        api.vfx.sound('w:freeze', e.x, e.z);
        s.sndT = 0.25;
      }
      api.damage(e, s.p.dmg * 0.35, { source: 'blizzard', tags: ICE_TAGS, canCrit: true, loud: true }, h);
    }
  }
  if (s.t < s.p.freeze) return true;
  // Glacier Burst: whatever is still frozen when it ends shatters in an icy blast.
  if (s.p.burst > 0) {
    let n = 0;
    for (const e of s.frozen) {
      if (!e.alive || e.hp <= 0 || n++ >= MAX_GLACIER_BURSTS) continue;
      api.blast(e.x, e.z, 2.2, s.p.dmg * s.p.burst, '#9fe8ff', 'blizzard', GLACIER_TAGS, false, h);
    }
    if (n) {
      api.vfx.sound('explode', h.player.x, h.player.z);
      api.vfx.shake(h.player.x, h.player.z, 0.4);
    }
  }
  return false;
}

// ------------------------------------------------------------------ Meteor Shower

function meteors(h: Hero, s: Running, dt: number, api: SpecialApi): boolean {
  const p = s.p;
  const v = api.vfx;
  if (s.n < p.count) {
    s.acc += (dt * p.count) / p.dur;
    while (s.acc >= 1 && s.n < p.count) {
      s.acc -= 1;
      drop(h, s, api);
    }
  }
  for (let i = s.rocks.length - 1; i >= 0; i--) {
    const m = s.rocks[i];
    const before = m.t;
    m.t += dt;
    if (before < METEOR_TELE - METEOR_FALL && m.t >= METEOR_TELE - METEOR_FALL) v.ring(m.x, m.z, p.blast * 2, 0.5, '#ffcd75', METEOR_FALL);
    if (m.t < METEOR_TELE) {
      if (m.t < METEOR_TELE - METEOR_FALL) continue;
      // Falling: a streak of fire coming down at a slant.
      const y = (METEOR_H * (METEOR_TELE - m.t)) / METEOR_FALL;
      v.burst(m.x + y * 0.4, y, m.z - y * 0.25, { count: 2, color: '#ff7a2f', color2: '#ffcd75', speed: [0, 0.8], size: [0.25, 0.45], life: [0.12, 0.25], drag: 4 });
      continue;
    }
    const ice = p.ice > 0;
    api.blast(m.x, m.z, p.blast, p.dmg, ice ? '#9fe8ff' : '#ff7a2f', 'meteor', ice ? COMET_TAGS : METEOR_TAGS, false, h);
    v.shake(m.x, m.z, 0.18);
    v.burst(m.x, 0.4, m.z, { count: 8, color: ice ? '#ffffff' : '#ff7a2f', color2: ice ? '#9fe8ff' : '#333c57', speed: [4, 9], size: [0.2, 0.4], life: [0.35, 0.6], up: 7, gravity: 16 });
    // Ice Comets freeze what they hit; Extinction leaves a burning crater.
    if (ice) {
      for (const e of api.enemies) {
        if (!e.alive || e.hp <= 0 || (e.x - m.x) ** 2 + (e.z - m.z) ** 2 > (p.blast + e.radius) ** 2) continue;
        e.frozen = Math.max(e.frozen, p.ice * freezeMul(e));
        e.shatter = Math.max(e.shatter, 0.3);
      }
    }
    if (p.crater > 0) s.craters.push({ x: m.x, z: m.z, t: p.crater, tick: 0 });
    s.rocks.splice(i, 1);
  }
  for (let i = s.craters.length - 1; i >= 0; i--) {
    const c = s.craters[i];
    c.t -= dt;
    c.tick -= dt;
    if (c.tick <= 0) {
      c.tick += CRATER_TICK;
      v.burst(c.x + (Math.random() - 0.5) * p.blast, 0.3, c.z + (Math.random() - 0.5) * p.blast, { count: 2, color: '#ff7a2f', color2: '#ffcd75', speed: [0.3, 1.2], size: [0.2, 0.4], life: [0.3, 0.6], up: 2.5 });
      for (const e of api.enemies) {
        if (!e.alive || e.hp <= 0 || (e.x - c.x) ** 2 + (e.z - c.z) ** 2 > (p.blast + e.radius) ** 2) continue;
        api.damage(e, p.dmg * 0.12, { source: 'meteor', tags: METEOR_TAGS }, h);
      }
    }
    if (c.t <= 0) s.craters.splice(i, 1);
  }
  return s.n < p.count || s.rocks.length > 0 || s.craters.length > 0;
}

/** Mark a landing spot: every other meteor aims at an enemy in range, the rest land anywhere in the area. */
function drop(h: Hero, s: Running, api: SpecialApi): void {
  const { x, z } = h.player;
  const A = s.p.area;
  const rng = api.rng;
  const e = s.n % 2 === 0 ? pick(x, z, A, s.recent, api) : null;
  let mx: number;
  let mz: number;
  if (e) {
    mx = e.x + rng.range(-0.6, 0.6);
    mz = e.z + rng.range(-0.6, 0.6);
  } else {
    const a = rng.next() * Math.PI * 2;
    const d = A * Math.sqrt(rng.next());
    mx = x + Math.cos(a) * d;
    mz = z + Math.sin(a) * d;
  }
  s.n++;
  s.rocks.push({ x: mx, z: mz, t: 0 });
  // A ring closing onto the blast radius marks where it lands.
  api.vfx.ring(mx, mz, s.p.blast * 3, 0.67, s.p.ice ? '#9fe8ff' : '#ff7a2f', METEOR_TELE);
}

// ------------------------------------------------------------------ Black Hole

const HOLE_TAGS: Tag[] = ['area'];
const HOLE_TICK = 0.25;

/** Pull everything in toward the hole, grind it, then collapse in a blast (White Hole: wider, and it burns). */
function hole(h: Hero, s: Running, dt: number, api: SpecialApi): boolean {
  const p = s.p;
  const v = api.vfx;
  const R = p.radius;
  for (const e of api.enemies) {
    if (!e.alive || e.hp <= 0) continue;
    const dx = s.x - e.x;
    const dz = s.z - e.z;
    const d = Math.hypot(dx, dz);
    if (d > R + e.radius || d < 0.3) continue;
    // Bosses barely budge; everything else is dragged harder near the centre.
    const pull = p.pull * (e.def.boss ? 0.2 : 1) * (1 - e.def.knockbackResist * 0.5) * (0.4 + 0.6 * (1 - d / R)) * dt;
    e.x += (dx / d) * Math.min(pull, d);
    e.z += (dz / d) * Math.min(pull, d);
  }
  s.acc -= dt;
  if (s.acc <= 0) {
    s.acc += HOLE_TICK;
    let n = 0;
    for (const e of api.enemies) {
      if (!e.alive || e.hp <= 0 || (e.x - s.x) ** 2 + (e.z - s.z) ** 2 > (R + e.radius) ** 2) continue;
      api.damage(e, p.dps * HOLE_TICK, { source: 'blackhole', tags: HOLE_TAGS, loud: n++ < 3 }, h);
    }
    // The swirl: a closing ring and sparks spiralling in from the rim.
    v.ring(s.x, s.z, R * 2, 0.35, '#b48cff', 0.3);
    for (let k = 0; k < 4; k++) {
      const a = api.rng.next() * Math.PI * 2;
      v.burst(s.x + Math.cos(a) * R, 0.6, s.z + Math.sin(a) * R, { count: 2, color: '#b48cff', color2: '#5d275d', speed: [R * 1.5, R * 2.5], size: [0.15, 0.3], life: [0.3, 0.45], drag: 3, dir: { x: -Math.cos(a), z: -Math.sin(a), spread: 0.4 } });
    }
    v.star(s.x, 1, s.z, 1.6, '#5d275d', 0.25);
  }
  if (s.t < p.dur) return true;
  // Collapse.
  const white = p.burn > 0;
  const blast = R * (white ? 1.6 : 1.1);
  api.blast(s.x, s.z, blast, p.implode, white ? '#fff35c' : '#b48cff', 'blackhole', white ? ['explosive', 'fire'] : ['explosive'], false, h);
  if (white) for (const e of api.enemies) if (e.alive && e.hp > 0 && (e.x - s.x) ** 2 + (e.z - s.z) ** 2 < blast * blast) api.ignite(e, p.implode * 0.05, h);
  v.ring(s.x, s.z, 1, blast * 2, white ? '#ffffff' : '#b48cff', 0.4);
  v.sound('explode', s.x, s.z);
  v.shake(s.x, s.z, 0.8);
  v.flash(white ? 0.6 : 0.3);
  return false;
}
