import * as THREE from 'three';
import { Rng } from '../core/rng';
import { commit } from '../render/instancing';
import { createRetroMaterial, retroGlobals } from '../render/retroMaterial';
import { Surfaces, inPatch } from '../render/surfaces';
import type { Particles } from './particles';

/**
 * Living environments, purely cosmetic and local to each machine:
 * - weather motes that drift in a box around the camera (meadow pollen,
 *   desert sand gusts, mountain snow, volcano embers and ash)
 * - rain on some meadow and peaks stages (streaks, ground splashes, pond
 *   ripples, a darker sky and the odd lightning flash)
 * - grass tufts on the meadow that sway in the wind and bend away from
 *   whoever walks through them
 * - animated surfaces (water, lava, ice: src/render/surfaces.ts).
 */

type Weather = 'pollen' | 'sand' | 'snow' | 'embers' | 'rain';

/** Test links can force the weather: 'rain', 'clear' (never rain) or null (seeded roll). */
export const weatherForce: { mode: 'rain' | 'clear' | null } = { mode: null };

export const rainTuning = {
  /** Chance that a stage of this biome is a rainy one. */
  chance: { meadow: 0.35, peaks: 0.3 } as Record<string, number>,
  /** Seconds to fade the rain in at the start of a stage. */
  fadeIn: 4,
  /** Sky darkening at full rain (0..1). */
  dark: 0.6,
  /** Seconds between lightning flashes (min, max), only in heavy rain. */
  bolt: [7, 18] as [number, number],
  flash: 0.8,
  /** Flash strength with REDUCE FLASHING on. */
  flashReduced: 0.1,
};

/** Is this stage rainy? Deterministic from the stage seed, so co-op machines agree. Pure, for tests. */
export function rollRain(biomeId: string, seed: number): boolean {
  const chance = rainTuning.chance[biomeId] ?? 0;
  if (chance <= 0) return false;
  return new Rng((seed ^ 0x2a1b9c) >>> 0).next() < chance;
}

/** Lightning brightness `t` seconds after a strike: two quick flickers then a fade. Pure, for tests. */
export function flashCurve(t: number, reduced = false): number {
  if (t < 0 || t > 0.45) return 0;
  if (reduced) return 1 - t / 0.45;
  if (t < 0.06) return 1;
  if (t < 0.12) return 0.25;
  if (t < 0.2) return 0.75;
  return 0.75 * (1 - (t - 0.2) / 0.25);
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const RAIN_SKY = new THREE.Color(0.36, 0.42, 0.6);
const RAIN_FOG = new THREE.Color('#7f93b8');

const WEATHER_BY_BIOME: Record<string, Weather> = { meadow: 'pollen', dunes: 'sand', peaks: 'snow', magma: 'embers' };

interface WeatherStyle {
  count: number;
  colors: string[];
  /** Box half-extents around the camera target. */
  w: number;
  d: number;
  y: [number, number];
  /** Base velocity (x, y, z) and wobble amplitude. */
  vel: [number, number, number];
  wobble: number;
  /** Mote size (x, y, z) in metres. */
  size: [number, number, number];
}

const STYLES: Record<Weather, WeatherStyle> = {
  pollen: { count: 90, colors: ['#fff4a0', '#ffffff', '#ffd6f0'], w: 24, d: 18, y: [0.4, 4], vel: [0.35, 0.05, 0.15], wobble: 0.6, size: [0.07, 0.07, 0.07] },
  sand: { count: 170, colors: ['#ffd0a0', '#ffb36b', '#ffe9c4'], w: 26, d: 18, y: [0.15, 2.6], vel: [9, 0, 1.5], wobble: 0.4, size: [0.55, 0.035, 0.035] },
  snow: { count: 240, colors: ['#ffffff', '#d8f0ff', '#f4f4f4'], w: 24, d: 18, y: [0, 12], vel: [0.5, -1.3, 0.2], wobble: 0.5, size: [0.09, 0.09, 0.09] },
  embers: { count: 150, colors: ['#ff7a2f', '#ffd23f', '#ff4d5e', '#566c86'], w: 24, d: 18, y: [0, 9], vel: [0.2, 1.4, 0.1], wobble: 0.7, size: [0.08, 0.08, 0.08] },
  rain: { count: 330, colors: ['#a9cdee', '#c8e2f6', '#8fb8e0'], w: 22, d: 17, y: [0, 13], vel: [-3, -26, 2], wobble: 0, size: [0.045, 0.9, 0.045] },
};

const MAX_MOTES = 340;

/** Quality preset scale for weather (set by settings). */
export const fxQuality = { ambience: 1 };
const MAX_TUFTS = 1100;

export class Ambience {
  private motes: THREE.InstancedMesh;
  private tufts: THREE.InstancedMesh;
  private weather: Weather | null = null;
  private style: WeatherStyle | null = null;
  private x = new Float32Array(MAX_MOTES);
  private y = new Float32Array(MAX_MOTES);
  private z = new Float32Array(MAX_MOTES);
  private ph = new Float32Array(MAX_MOTES);
  private tx = new Float32Array(MAX_TUFTS);
  private tz = new Float32Array(MAX_TUFTS);
  private ts = new Float32Array(MAX_TUFTS);
  private tr = new Float32Array(MAX_TUFTS);
  private tBend = new Float32Array(MAX_TUFTS);
  private nTufts = 0;
  private t = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  /** 0..1 strength multiplier (quality preset / accessibility). */
  density = 1;
  /** Water, lava and ice surfaces of the current stage. */
  readonly surfaces: Surfaces;
  /** Rain intensity right now, 0..1 (the sound lane's ambience can follow it). */
  rain = 0;
  /** Lightning brightness right now, 0..1. */
  flash = 0;
  /** Lightning strikes so far (watch it change to play thunder). */
  strikes = 0;
  /** How far the last strike was, 0 = overhead .. 1 = far (thunder delay and volume). */
  strikeDist = 0;
  /** REDUCE FLASHING: lightning becomes a faint, smooth glow (set from settings each frame). */
  reduceFlash = false;
  private biomeId = '';
  private seed = 0;
  private rainy = false;
  private rainT = 0;
  private boltT = 8;
  private flashT = -1;
  private fall = new THREE.Quaternion();
  private down = new THREE.Vector3();
  private yAxis = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    this.surfaces = new Surfaces(scene);
    this.motes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), createRetroMaterial({ unlit: 1 }), MAX_MOTES);
    this.motes.setColorAt(0, this.c.set('#ffffff'));
    // Three thin blades fanned out, pivoting at the base.
    const blade = (rz: number, ry: number) => new THREE.BoxGeometry(0.06, 0.5, 0.02).translate(0, 0.25, 0).rotateZ(rz).rotateY(ry);
    const geo = mergeBlades([blade(0, 0), blade(0.35, 1.1), blade(-0.35, 2.2)]);
    this.tufts = new THREE.InstancedMesh(geo, createRetroMaterial({ unlit: 0.25 }), MAX_TUFTS);
    this.tufts.setColorAt(0, this.c.set('#4fd36a'));
    for (const m of [this.motes, this.tufts]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
  }

  /**
   * New arena: pick the biome's weather and scatter grass (meadow only).
   * `blocked(x, z)` keeps tufts out of walls.
   */
  load(biomeId: string, seed: number, halfSize: number, blocked: (x: number, z: number) => boolean): void {
    this.biomeId = biomeId;
    this.seed = seed;
    const f = weatherForce.mode;
    this.rainy = f === 'rain' ? biomeId !== 'magma' : f === 'clear' ? false : rollRain(biomeId, seed);
    this.rainT = 0;
    this.rain = 0;
    this.flash = 0;
    this.flashT = -1;
    this.boltT = rainTuning.bolt[0];
    this.setupMotes();
    const rng = new Rng(seed ^ 0x51ed27);
    this.nTufts = 0;
    if (biomeId === 'meadow') {
      const greens = ['#4fd36a', '#3fbf5a', '#6ee07a', '#38b764', '#a7f070'];
      const lim = halfSize - 3;
      for (let k = 0; k < MAX_TUFTS * 3 && this.nTufts < MAX_TUFTS; k++) {
        const x = rng.range(-lim, lim);
        const z = rng.range(-lim, lim);
        if (blocked(x, z) || (Math.abs(x) < 3 && Math.abs(z) < 3)) continue;
        const i = this.nTufts++;
        this.tx[i] = x;
        this.tz[i] = z;
        this.ts[i] = rng.range(0.7, 1.4);
        this.tr[i] = rng.next() * Math.PI * 2;
        this.tBend[i] = 0;
        this.tufts.setColorAt(i, this.c.set(rng.pick(greens)));
      }
      if (this.tufts.instanceColor) commit(this.tufts.instanceColor, this.nTufts);
    }
  }

  /** Scatter the motes for the current weather (rain replaces the biome's own motes). */
  private setupMotes(): void {
    this.weather = this.rainy ? 'rain' : (WEATHER_BY_BIOME[this.biomeId] ?? null);
    this.style = this.weather ? STYLES[this.weather] : null;
    const rng = new Rng(this.seed ^ 0x51ed27);
    if (!this.style) return;
    const st = this.style;
    for (let i = 0; i < st.count; i++) {
      this.x[i] = rng.range(-st.w, st.w);
      this.y[i] = rng.range(st.y[0], st.y[1]);
      this.z[i] = rng.range(-st.d, st.d);
      this.ph[i] = rng.next() * Math.PI * 2;
      this.motes.setColorAt(i, this.c.set(rng.pick(st.colors)));
    }
    if (this.motes.instanceColor) commit(this.motes.instanceColor, st.count);
  }

  /** Turn this stage's rain on or off (the title screen stays dry). */
  setRain(on: boolean): void {
    on = on && this.biomeId !== 'magma';
    if (on === this.rainy) return;
    this.rainy = on;
    this.rain = 0;
    this.rainT = 0;
    this.setupMotes();
  }

  get raining(): boolean {
    return this.rainy;
  }

  /** Build the stage's animated surfaces (call after `load`, once the arena exists). */
  loadSurfaces(arena: { halfSize: number; hazards: readonly { x: number; z: number; r: number; kind: string }[] }, blocked: (x: number, z: number) => boolean, fx: Particles | null): void {
    this.surfaces.load(this.biomeId, this.seed, arena, blocked, fx);
    // No grass growing out of ponds.
    let k = 0;
    for (let i = 0; i < this.nTufts; i++) {
      if (inPatch(this.surfaces.patches, this.tx[i], this.tz[i], 'water')) continue;
      this.tx[k] = this.tx[i];
      this.tz[k] = this.tz[i];
      this.ts[k] = this.ts[i];
      this.tr[k] = this.tr[i];
      this.tBend[k] = 0;
      if (this.tufts.instanceColor) this.tufts.setColorAt(k, this.tufts.getColorAt(i, this.c));
      k++;
    }
    if (k !== this.nTufts && this.tufts.instanceColor) commit(this.tufts.instanceColor, k);
    this.nTufts = k;
  }

  /** Rain fades in over the stage's first seconds and swells and eases; heavy rain brings lightning. */
  private updateRain(dt: number, cx: number, cz: number): void {
    if (!this.rainy) {
      this.rain = Math.max(0, this.rain - dt * 0.5);
      this.flash = 0;
      return;
    }
    this.rainT += dt;
    const fade = Math.min(1, this.rainT / rainTuning.fadeIn);
    const swell = 0.75 + 0.25 * Math.sin(this.rainT * 0.11) * Math.sin(this.rainT * 0.037 + 1);
    this.rain = fade * swell;
    const calm = reducedMotion();
    if (dt > 0 && this.rain > 0.6 && !calm && (this.boltT -= dt) <= 0) {
      const [a, b] = rainTuning.bolt;
      this.boltT = a + Math.random() * (b - a);
      this.flashT = 0;
      this.strikes++;
      this.strikeDist = Math.random();
    }
    if (this.flashT >= 0) {
      this.flashT += dt;
      const reduced = this.reduceFlash;
      this.flash = flashCurve(this.flashT, reduced) * (reduced ? rainTuning.flashReduced : rainTuning.flash) * (1 - this.strikeDist * 0.5);
      if (this.flashT > 0.5) this.flashT = -1;
    } else this.flash = 0;
    void cx;
    void cz;
  }

  /** Rain streaks fall along the wind; each drop that lands splashes (or ripples a pond). */
  private renderRain(dt: number, cx: number, cz: number, n: number, st: WeatherStyle): void {
    this.down.set(-st.vel[0], -st.vel[1], -st.vel[2]).normalize();
    this.fall.setFromUnitVectors(this.yAxis, this.down);
    const sf = this.surfaces;
    for (let i = 0; i < n; i++) {
      this.x[i] += st.vel[0] * dt;
      this.y[i] += st.vel[1] * dt;
      this.z[i] += st.vel[2] * dt;
      if (this.y[i] < 0) {
        // Landed: splash where it hit, then respawn at the top somewhere in the box.
        if (dt > 0 && (i & 1) === 0) {
          const water = inPatch(sf.patches, this.x[i], this.z[i], 'water');
          if (water) sf.ripple(this.x[i], this.z[i], 0.45, 0.4, 0.6, 0.05);
          else sf.ripple(this.x[i], this.z[i], 0.28, 0.22, 0.55, 0.03);
        }
        this.y[i] += st.y[1];
        this.x[i] = cx + (Math.random() * 2 - 1) * st.w;
        this.z[i] = cz + (Math.random() * 2 - 1) * st.d;
      }
      if (this.x[i] - cx > st.w) this.x[i] -= st.w * 2;
      else if (this.x[i] - cx < -st.w) this.x[i] += st.w * 2;
      if (this.z[i] - cz > st.d) this.z[i] -= st.d * 2;
      else if (this.z[i] - cz < -st.d) this.z[i] += st.d * 2;
      this.m4.compose(this.v.set(this.x[i], this.y[i] + st.size[1] * 0.5, this.z[i]), this.fall, this.s.set(st.size[0], st.size[1], st.size[2]));
      this.motes.setMatrixAt(i, this.m4);
    }
  }

  /**
   * Darken the sky in the rain and flash it for lightning. Call after the
   * time-of-day light is set for the frame (it rewrites the shared uniforms).
   */
  tintSky(): void {
    const k = this.rain * rainTuning.dark;
    const f = this.flash;
    if (k <= 0 && f <= 0) return;
    const g = retroGlobals;
    g.uSunColor.value.multiplyScalar(1 - k);
    g.uSkyColor.value.lerp(RAIN_SKY, k);
    g.uGroundColor.value.multiplyScalar(1 - k * 0.6);
    g.uFogColor.value.lerp(RAIN_FOG, Math.min(1, k * 1.4));
    if (f > 0) {
      g.uSunColor.value.r += f * 0.9;
      g.uSunColor.value.g += f * 0.95;
      g.uSunColor.value.b += f;
      g.uSkyColor.value.r += f * 0.6;
      g.uSkyColor.value.g += f * 0.65;
      g.uSkyColor.value.b += f * 0.75;
      g.uGroundColor.value.r += f * 0.35;
      g.uGroundColor.value.g += f * 0.35;
      g.uGroundColor.value.b += f * 0.45;
    }
  }

  /** `cx, cz`: camera target. `walkers`: positions that push grass aside. */
  render(dt: number, cx: number, cz: number, walkers: { x: number; z: number; speed?: number }[]): void {
    this.t += dt;
    this.updateRain(dt, cx, cz);
    const st = this.style;
    const rainK = this.weather === 'rain' ? this.rain : 1;
    const n = st ? Math.floor(st.count * this.density * fxQuality.ambience * rainK) : 0;
    if (st && this.weather === 'rain') this.renderRain(dt, cx, cz, n, st);
    else if (st) {
      // Sand blows in gusts; everything else drifts steadily.
      const gust = this.weather === 'sand' ? 0.35 + 0.65 * Math.max(0, Math.sin(this.t * 0.6) * Math.sin(this.t * 0.23 + 1)) : 1;
      for (let i = 0; i < n; i++) {
        const w = Math.sin(this.t * 1.3 + this.ph[i]) * st.wobble;
        this.x[i] += (st.vel[0] * gust + w * 0.5) * dt;
        this.y[i] += (st.vel[1] + Math.cos(this.t * 0.9 + this.ph[i]) * st.wobble * 0.3) * dt;
        this.z[i] += (st.vel[2] + w * 0.3) * dt;
        // Wrap inside the box around the camera.
        if (this.x[i] - cx > st.w) this.x[i] -= st.w * 2;
        else if (this.x[i] - cx < -st.w) this.x[i] += st.w * 2;
        if (this.z[i] - cz > st.d) this.z[i] -= st.d * 2;
        else if (this.z[i] - cz < -st.d) this.z[i] += st.d * 2;
        if (this.y[i] > st.y[1]) this.y[i] = st.y[0];
        else if (this.y[i] < st.y[0]) this.y[i] = st.y[1];
        // Embers and pollen twinkle by size; sand streaks thin out between gusts.
        const tw = this.weather === 'sand' ? gust : 0.7 + 0.3 * Math.sin(this.t * 5 + this.ph[i]);
        this.e.set(this.ph[i] + this.t, this.ph[i] * 2 + this.t * 0.7, 0);
        if (this.weather === 'sand') this.e.set(0, -Math.atan2(st.vel[2], st.vel[0]), 0);
        this.q.setFromEuler(this.e);
        this.m4.compose(this.v.set(this.x[i], this.y[i], this.z[i]), this.q, this.s.set(st.size[0] * tw, st.size[1] * tw, st.size[2] * tw));
        this.motes.setMatrixAt(i, this.m4);
      }
    }
    this.motes.count = n;
    commit(this.motes.instanceMatrix, n);
    this.surfaces.render(dt, cx, cz, this.rain, walkers, Math.max(0.4, fxQuality.ambience));

    // Grass: sway with the wind; bend away from nearby walkers and spring back.
    const nt = this.nTufts;
    for (let i = 0; i < nt; i++) {
      const x = this.tx[i];
      const z = this.tz[i];
      if (Math.abs(x - cx) > 30 || Math.abs(z - cz) > 24) {
        // Off-screen: park it (keeps the instance count stable).
        this.m4.makeScale(0, 0, 0);
        this.tufts.setMatrixAt(i, this.m4);
        continue;
      }
      let push = 0;
      let ang = 0;
      for (const w of walkers) {
        const dx = x - w.x;
        const dz = z - w.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1.4) {
          push = Math.max(push, 1 - Math.sqrt(d2) / 1.2);
          ang = Math.atan2(dz, dx);
        }
      }
      this.tBend[i] += (push - this.tBend[i]) * Math.min(1, dt * (push > this.tBend[i] ? 20 : 4));
      const sway = Math.sin(this.t * 2.1 + x * 0.35 + z * 0.22) * 0.18 + Math.sin(this.t * 3.7 + x) * 0.05;
      const b = this.tBend[i] * 1.1;
      this.e.set(Math.sin(ang) * b, this.tr[i], sway - Math.cos(ang) * b, 'YXZ');
      this.q.setFromEuler(this.e);
      const s = this.ts[i];
      this.m4.compose(this.v.set(x, 0, z), this.q, this.s.set(s, s, s));
      this.tufts.setMatrixAt(i, this.m4);
    }
    this.tufts.count = nt;
    commit(this.tufts.instanceMatrix, nt);
  }
}

function mergeBlades(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const g of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...(ng.getAttribute('position').array as Float32Array));
    nrm.push(...(ng.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}
