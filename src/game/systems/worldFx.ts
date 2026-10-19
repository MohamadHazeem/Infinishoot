/**
 * World effects derived from what every machine already sees: dust from
 * dashes, landings, charges and boss steps, footprints in sand and snow,
 * the stage's animated surfaces and the rainy sky. All cosmetic and local
 * (no netcode): clients compute the same things from the synced heroes and
 * enemies. A Game method installed as a field (`worldFx = WorldFxSys.worldFx`)
 * and called once per frame from render(), after the sky is set.
 */
import type { Game } from '../game';
import { biomeForStage } from '../../data/biomes';
import { fxQuality } from '../ambience';
import { worldFxTuning } from '../particles';
import { access } from '../settings';
import { renderQuality } from '../../render/quality';
import { worldRender } from '../../world/worldRender';

export const worldDustTuning = {
  /** Metres walked between footprints. */
  stride: 0.85,
  /** Seconds between dust puffs behind a dash or a charge. */
  trailEvery: 0.045,
  footSize: 0.6,
};


interface HeroFx {
  dash: boolean;
  trail: number;
  walked: number;
  side: number;
  lx: number;
  lz: number;
}

interface WorldFxState {
  arena: unknown;
  heroes: Map<object, HeroFx>;
  hop: Float32Array;
  walked: Float32Array;
  trail: Float32Array;
  side: Uint8Array;
  ex: Float32Array;
  ez: Float32Array;
  uid: Int32Array;
}

const states = new WeakMap<Game, WorldFxState>();

function state(g: Game): WorldFxState {
  let s = states.get(g);
  if (!s) {
    const n = 1024;
    s = { arena: null, heroes: new Map(), hop: new Float32Array(n), walked: new Float32Array(n), trail: new Float32Array(n), side: new Uint8Array(n), ex: new Float32Array(n), ez: new Float32Array(n), uid: new Int32Array(n).fill(-1) };
    states.set(g, s);
  }
  const need = g.enemies.list.length;
  if (need > s.hop.length) {
    const grow = <T extends Float32Array | Uint8Array | Int32Array>(a: T, fill = 0): T => {
      const b = new (a.constructor as new (n: number) => T)(need * 2);
      b.fill(fill);
      b.set(a);
      return b;
    };
    s.hop = grow(s.hop);
    s.walked = grow(s.walked);
    s.trail = grow(s.trail);
    s.side = grow(s.side);
    s.ex = grow(s.ex);
    s.ez = grow(s.ez);
    s.uid = grow(s.uid, -1);
  }
  return s;
}

export function worldFx(this: Game, frameDt: number): void {
  const s = state(this);
  // Animated scenery, crusher presses and boss arena dressing (src/world/worldRender.ts).
  worldRender(this, frameDt);
  // A new arena: build its surfaces; the title screen never rains.
  if (s.arena !== this.arena) {
    s.arena = this.arena;
    if (this.mode === 'title') this.ambience.setRain(false);
    this.ambience.loadSurfaces(this.arena, (x, z) => this.walls.hitCircle(x, z, 0.5), this.particles);
    s.heroes.clear();
    s.uid.fill(-1);
  }
  worldFxTuning.amount = renderQuality.worldEffects ? (fxQuality.ambience < 0.5 ? 0.5 : 1) : 0;
  this.ambience.reduceFlash = access.reduceFlash;
  this.ambience.tintSky();

  const frozen = (this.paused && this.role === 'solo') || this.mode === 'levelup' || this.mode === 'shop';
  if (!renderQuality.worldEffects || frozen || frameDt <= 0 || this.mode === 'title') return;
  // Dust tint and footprint tint come from the biome (no prints on grass, tiles or ash).
  const b = biomeForStage(this.arenaStage);
  const biome = b.id;
  const dust = b.dust;
  const print = b.prints;
  const soft = this.particles.soft;
  const decals = this.particles.decals;
  const T = worldDustTuning;

  // Heroes: a puff of dust as a dash starts and a trail behind it; footprints in sand and snow.
  for (const h of this.heroes) {
    const p = h.player;
    let hs = s.heroes.get(h);
    if (!hs) {
      hs = { dash: false, trail: 0, walked: 0, side: 0, lx: p.x, lz: p.z };
      s.heroes.set(h, hs);
    }
    if (h.left || p.dead) {
      hs.lx = p.x;
      hs.lz = p.z;
      continue;
    }
    const dx = p.x - hs.lx;
    const dz = p.z - hs.lz;
    const moved = Math.hypot(dx, dz);
    hs.lx = p.x;
    hs.lz = p.z;
    const dashing = p.dashing;
    if (dashing && !hs.dash) soft.dust(p.x, p.z, 6, 0.9, dust, Math.random, -p.vel.x, -p.vel.z, 3);
    if (dashing && (hs.trail -= frameDt) <= 0) {
      hs.trail = T.trailEvery;
      soft.dust(p.x, p.z, 1, 0.7, dust, Math.random, -p.vel.x, -p.vel.z, 1.2);
    }
    hs.dash = dashing;
    if (moved > 2) continue; // teleport or respawn
    hs.walked += moved;
    if (hs.walked >= T.stride) {
      hs.walked -= T.stride;
      hs.side ^= 1;
      if (print && !dashing && moved > 0.001) {
        const a = Math.atan2(dz, dx);
        const o = (hs.side ? 1 : -1) * 0.17;
        decals.foot(p.x - Math.sin(a) * o, p.z + Math.cos(a) * o, a, T.footSize, print);
      }
      if (biome === 'dunes' && hs.side) soft.dust(p.x, p.z, 1, 0.45, dust, Math.random, -dx, -dz, 0.8);
    }
  }

  // Enemies: landings, charges and the heavy steps of bosses.
  const list = this.enemies.list;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.active || e.def.hidden) {
      s.uid[i] = -1;
      continue;
    }
    if (s.uid[i] !== e.uid) {
      // A new enemy in this slot: start its history fresh.
      s.uid[i] = e.uid;
      s.hop[i] = e.hopY;
      s.ex[i] = e.x;
      s.ez[i] = e.z;
      s.walked[i] = 0;
      continue;
    }
    const r = e.radius;
    // Landed from a jump (boss slams, hoppers).
    if (s.hop[i] > 0.4 && e.hopY <= 0.05 && e.state !== 'spawning') {
      soft.dust(e.x, e.z, Math.round(8 + r * 4), Math.max(0.8, r * 1.1), dust, Math.random, 0, 0, 3 + r * 2);
    }
    s.hop[i] = e.hopY;
    const b = e.def.behavior;
    const charging = e.state === 'attack' && (b === 'charger' || ((b === 'rex' || b === 'omega') && e.action === 'charge'));
    if (charging && (s.trail[i] -= frameDt) <= 0) {
      s.trail[i] = T.trailEvery * (r > 1 ? 0.8 : 1.4);
      soft.dust(e.x, e.z, 1, Math.max(0.6, r * 0.9), dust, Math.random, -e.lungeX, -e.lungeZ, 1.5);
    }
    if (e.def.boss && e.hopY <= 0.3) {
      const dx = e.x - s.ex[i];
      const dz = e.z - s.ez[i];
      const moved = Math.hypot(dx, dz);
      if (moved < 3) {
        s.walked[i] += moved;
        const stride = 1.1 * Math.max(1, r);
        if (s.walked[i] >= stride) {
          s.walked[i] -= stride;
          s.side[i] ^= 1;
          const a = Math.atan2(dz, dx);
          const o = (s.side[i] ? 1 : -1) * r * 0.45;
          const fx = e.x - Math.sin(a) * o;
          const fz = e.z + Math.cos(a) * o;
          soft.dust(fx, fz, 3, Math.max(0.7, r * 0.6), dust, Math.random, 0, 0, 1.6);
          if (print) decals.foot(fx, fz, a, r * 0.9, print, 8);
        }
      }
    }
    s.ex[i] = e.x;
    s.ez[i] = e.z;
  }
}
