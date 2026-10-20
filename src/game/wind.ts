/**
 * Sky Fortress wind. A steady breeze from a direction picked by the stage
 * seed, with gusts on a fixed schedule. On the host it pushes every bullet
 * (enemy shots more than yours) and blows light enemies around; an enemy
 * knocked hard into a chasm falls to its doom (an environmental kill).
 *
 * The wind is a pure function of (arena seed, stage clock), so clients draw
 * the same direction and gusts (streaks, flags, gust sound) without any new
 * network messages: the host's clock is the director's, a client's comes from
 * the synced time-left and runs on locally during the boss.
 */
import type { Game } from './game';
import { Team } from './bullets';
import type { Enemy } from './enemies';
import { biomeForStage } from '../data/biomes';
import { hazardTuning } from './hazards';
import { ARENA_SOURCE_NAMES, ENV_SOURCES } from './systems/arena';

export const windTuning = {
  /** Breeze and extra gust acceleration (m/s²) on a bullet with k = 1. */
  base: 1.4,
  gust: 5,
  /** Gust schedule: one gust per `period` seconds, lasting `gustLen`. */
  period: 11,
  gustLen: 3.4,
  /** How far the direction wanders (radians) over the stage, and leans in gusts. */
  wander: 0.45,
  /** Bullet push per team. */
  playerBullets: 0.55,
  enemyBullets: 1,
  /** Light enemies (xp <= lightXp, not elites or bosses) drift at this share of the acceleration, as m/s. */
  enemyPush: 0.38,
  lightXp: 2,
  /** Knockback speed that sends an enemy over a chasm's edge. */
  fallSpeed: hazardTuning.knockSpeed,
};

export interface WindState {
  /** Unit direction the wind blows toward. */
  x: number;
  z: number;
  /** Acceleration (m/s²) right now, 0 off the Sky Fortress. */
  s: number;
  /** Gust envelope 0..1. */
  gust: number;
  /** Stage clock the wind was sampled at. */
  t: number;
}

// Falling into a chasm counts as an environmental kill (score bonus, ENV KILL banner).
if (!ENV_SOURCES.includes('fall')) ENV_SOURCES.push('fall');
ARENA_SOURCE_NAMES.fall = 'Sky Falls';

function hash(n: number): number {
  let h = (n | 0) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Gust envelope (0..1) at stage time `t`: each period has one gust at a seeded offset, eased in and out. Pure. */
export function gustAt(seed: number, t: number): number {
  const T = windTuning;
  const k = Math.floor(t / T.period);
  const start = hash(seed + k * 7919) * (T.period - T.gustLen);
  const u = (t - k * T.period - start) / T.gustLen;
  if (u <= 0 || u >= 1) return 0;
  return Math.sin(u * Math.PI) ** 2;
}

/** The wind at stage time `t` for an arena seed, written into `out`. Pure. */
export function windAt(seed: number, t: number, out: WindState): WindState {
  const T = windTuning;
  const g = gustAt(seed, t);
  const a = hash(seed) * Math.PI * 2 + Math.sin(t * 0.045 + seed) * T.wander + g * 0.2;
  out.x = Math.cos(a);
  out.z = Math.sin(a);
  out.gust = g;
  out.s = T.base + g * T.gust;
  out.t = t;
  return out;
}

interface Clock {
  t: number;
  arena: unknown;
}
const clocks = new WeakMap<Game, Clock>();
/** Wind on any biome (custom arenas' WIND rule, src/game/systems/editor.ts); set on every machine. */
export const windForce = { on: false };
const states = new WeakMap<Game, WindState>();

/** The current wind for this game (zero strength off the Sky Fortress). Cheap; call any time. */
export function windOf(game: Game): WindState {
  let w = states.get(game);
  if (!w) states.set(game, (w = { x: 1, z: 0, s: 0, gust: 0, t: 0 }));
  return w;
}

/** Stage clock both host and clients agree on (closely enough for cosmetics). */
function stageClock(game: Game, dt: number): number {
  let c = clocks.get(game);
  if (!c) clocks.set(game, (c = { t: 0, arena: null }));
  if (c.arena !== game.arena) {
    c.arena = game.arena;
    c.t = 0;
  }
  if (game.role === 'client') {
    const d = game.director.duration;
    c.t = game.netTimeLeft >= 0 ? d - game.netTimeLeft : c.t + dt;
  } else c.t = game.director.time;
  return c.t;
}

/** Sample the wind for this frame/step. `dt` only advances a client's clock during the boss. */
export function sampleWind(game: Game, dt: number): WindState {
  const w = windOf(game);
  if ((biomeForStage(game.arenaStage).kind !== 'sky' && !windForce.on) || game.mode === 'title') {
    w.s = 0;
    w.gust = 0;
    return w;
  }
  return windAt(game.arena.seed, stageClock(game, dt), w);
}

function inGap(game: Game, x: number, z: number, r: number): boolean {
  const gaps = game.arena.deco?.gaps;
  if (!gaps) return false;
  for (let i = 0; i < gaps.length; i++) {
    const b = gaps[i];
    if (x > b.minX + r && x < b.maxX - r && z > b.minZ + r && z < b.maxZ - r) return true;
  }
  return false;
}

/** Host step: wind pushes bullets and light enemies; hard-knocked enemies fall into chasms. */
export function updateWind(this: Game, dt: number): void {
  const w = sampleWind(this, dt);
  if (w.s <= 0) return;
  const T = windTuning;
  const ax = w.x * w.s * dt;
  const az = w.z * w.s * dt;
  const b = this.bullets;
  for (let i = 0; i < b.count; i++) {
    const k = b.team[i] === Team.Enemy ? T.enemyBullets : T.playerBullets;
    b.vx[i] += ax * k;
    b.vz[i] += az * k;
  }
  const drift = w.s * T.enemyPush * dt;
  const list = this.enemies.list;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive || e.def.boss || e.pvpOwner >= 0 || e.hopY > 0 || e.def.behavior === 'reaper') continue;
    if (!e.elite && e.def.xp <= T.lightXp) {
      e.x += w.x * drift;
      e.z += w.z * drift;
    }
    if (e.kx * e.kx + e.kz * e.kz > T.fallSpeed * T.fallSpeed) {
      // Where the knockback is carrying it: over the edge?
      const lx = e.x + e.kx * 0.12;
      const lz = e.z + e.kz * 0.12;
      if (inGap(this, lx, lz, -e.radius * 0.2)) fall(this, e);
    }
  }
}

function fall(game: Game, e: Enemy): void {
  const tough = e.elite || e.def.behavior === 'reaper';
  e.kx = e.kz = 0;
  game.vfx.num(e.x, 2.2, e.z, 'BYE-BYE!', 'crit');
  game.vfx.burst(e.x, 0.2, e.z, { count: 12, color: '#ffffff', color2: '#b4e2ff', speed: [1.5, 4], size: [0.25, 0.45], life: [0.4, 0.8], up: -2, gravity: 6, drag: 2 });
  game.vfx.sound('dash', e.x, e.z, 0.7);
  game.envHit(e, 'fall', tough ? e.maxHp * hazardTuning.eliteFrac : e.hp + e.shield + 1);
}
