/**
 * Sky lane: the sky and time of day (sea and pond reflections, cloud
 * shadows, sun shafts, stars and the moon), the persistent ground scars and
 * the projectile extras that need game state (heat haze over fire shots,
 * crackle on shocked enemies, chain-zap arcs). Everything here is cosmetic
 * and derived locally on every machine from state it already has (the
 * stage, the synced bullets and enemies, effects-bus bursts), so co-op
 * needs no new messages. Installed on Game as `updateSkyFx`, called in
 * render() after the look pass.
 */
import * as THREE from 'three';
import type { Game } from '../game';
import { biomeForStage } from '../../data/biomes';
import { applyTimeOfDay } from '../../render/biomeLook';
import { MAX_HEAT, postfx } from '../../render/postfx';
import { renderQuality } from '../../render/quality';
import { SkyFx, skyOverrides } from '../../render/sky';
import { BULLET_Y, BulletLook } from '../bullets';
import { settings } from '../settings';
import type { BurstOptions } from '../particles';
import { trails, trailTuning } from '../trails';

export const skyFxTuning = {
  /** Heat haze over fire shots: shimmer strength, radius (m) and how close shots merge into one spot (m). */
  heat: 0.7,
  heatRadius: 1.6,
  heatMerge: 3,
  /** Crackle arcs on shocked enemies per re-roll (30 a second), and their reach (m). */
  crackle: 6,
  crackleReach: 0.9,
  /** Chain zap arcs: width (m) and life (s). */
  zapWidth: 0.13,
  zapLife: 0.16,
};

interface SkyState {
  fx: SkyFx;
  particles: unknown;
  v: THREE.Vector3;
  v2: THREE.Vector3;
  arcAt: number;
}

const states = new WeakMap<Game, SkyState>();

/** Chain zaps ride the effects bus as bursts with an `arc` target: draw the arc wherever a burst plays (host and clients). */
function hookBursts(game: Game, st: SkyState): void {
  const p = game.particles;
  st.particles = p;
  const burst0 = p.burst.bind(p);
  p.burst = (x: number, y: number, z: number, o: BurstOptions, rand?: () => number) => {
    burst0(x, y, z, o, rand);
    const a = o.arc;
    if (!a) return;
    if (trails.enabled) {
      const T = skyFxTuning;
      trails.arc(x, y, z, a[0], 0.9, a[1], o.color, T.zapWidth, T.zapLife, 0.5, true);
    } else {
      // LOW quality: the old dotted line.
      for (let k = 1; k < 5; k++) {
        const t = k / 5;
        burst0(x + (a[0] - x) * t, y, z + (a[1] - z) * t, { count: 1, color: o.color, color2: '#ffffff', speed: [0, 0.5], size: [0.12, 0.2], life: [0.08, 0.14] });
      }
    }
  };
}

function state(game: Game): SkyState {
  let st = states.get(game);
  if (!st) {
    st = { fx: new SkyFx(game.scene), particles: null, v: new THREE.Vector3(), v2: new THREE.Vector3(), arcAt: -1 };
    states.set(game, st);
  }
  if (st.particles !== game.particles) hookBursts(game, st);
  return st;
}

export function updateSkyFx(this: Game, frameDt: number): void {
  const st = state(this);
  const frozen = this.paused || this.mode === 'levelup' || this.mode === 'shop';
  const dt = frozen ? 0 : frameDt;
  const biome = biomeForStage(this.arenaStage).id;
  // Test links / debug can pin the time of day.
  if (skyOverrides.tod !== null) applyTimeOfDay(skyOverrides.tod);
  const cam = this.cam.camera;
  st.fx.update({
    biomeId: biome,
    dayK: this.dayK,
    night: postfx.night,
    rain: this.ambience.rain,
    dt,
    camera: cam,
    focusX: this.playerPos.x,
    focusZ: this.playerPos.z,
    quality: renderQuality.level,
    ponds: this.ambience.surfaces.patches,
  });
  this.scars.ground.magma = biome === 'magma';

  heatHaze(this, st, cam);
  if (trails.enabled && dt > 0 && trails.clock - st.arcAt >= 1 / trailTuning.arcRate) {
    st.arcAt = trails.clock;
    crackle(this);
  }
  // Weapons drew their trails and arcs after the trail clock ticked: upload those too, so they show this frame.
  trails.flush();
}

/** Fire shots shimmer the air behind them: extra heat spots after the look pass's lava ones. */
function heatHaze(game: Game, st: SkyState, cam: THREE.PerspectiveCamera): void {
  if (!postfx.distortion || !settings.distortion) return;
  const b = game.bullets;
  const T = skyFxTuning;
  let n = postfx.heatCount;
  const first = n;
  const motion = Math.min(1, settings.shake);
  for (let i = 0; i < b.count && n < MAX_HEAT; i++) {
    if (b.look[i] !== BulletLook.Fire) continue;
    // A little behind the shot, where the flame trail is.
    const sp = Math.hypot(b.vx[i], b.vz[i]) || 1;
    const x = b.x[i] - (b.vx[i] / sp) * 0.8;
    const z = b.z[i] - (b.vz[i] / sp) * 0.8;
    let merged = false;
    for (let k = first; k < n; k++) {
      const o = k * 4;
      // Spots store screen coords; merge in world space through the saved positions below.
      if (Math.abs(heatX[k] - x) < T.heatMerge && Math.abs(heatZ[k] - z) < T.heatMerge) {
        postfx.heat[o + 3] = Math.min(1, postfx.heat[o + 3] + 0.1 * T.heat * motion);
        merged = true;
        break;
      }
    }
    if (merged) continue;
    if (project(st, cam, x, BULLET_Y, z, T.heatRadius, postfx.heat, n * 4, T.heat * motion)) {
      heatX[n] = x;
      heatZ[n] = z;
      n++;
    }
  }
  postfx.heatCount = n;
}
const heatX = new Float32Array(MAX_HEAT);
const heatZ = new Float32Array(MAX_HEAT);

/** Shocked enemies crackle: little arcs jump off them (a few per re-roll). */
function crackle(game: Game): void {
  const T = skyFxTuning;
  const list = game.enemies.list;
  let left = T.crackle;
  const n = list.length;
  if (!n) return;
  // Start somewhere random so a big crowd shares the budget over time.
  const start = Math.floor(Math.random() * n);
  for (let j = 0; j < n && left > 0; j++) {
    const e = list[(start + j) % n];
    if (!e.active || e.shockT <= 0 || e.def.hidden || Math.random() > 0.5) continue;
    left--;
    const a = Math.random() * Math.PI * 2;
    const r = e.radius * (0.6 + Math.random() * 0.5);
    const y = e.radius * (0.6 + Math.random() * 1.2);
    const reach = T.crackleReach * (0.6 + Math.random() * 0.6);
    trails.arc(e.x + Math.cos(a) * r * 0.5, y, e.z + Math.sin(a) * r * 0.5, e.x + Math.cos(a) * (r + reach), Math.max(0.15, y + (Math.random() - 0.6) * 0.8), e.z + Math.sin(a) * (r + reach), '#7df9ff', 0.06, 1 / trailTuning.arcRate + 0.02, 0.18, false);
  }
}

/** Project a world circle to (u, v, radius in screen heights, strength). False if off screen. */
function project(st: SkyState, cam: THREE.PerspectiveCamera, x: number, y: number, z: number, r: number, out: Float32Array, o: number, strength: number): boolean {
  const a = st.v.set(x, y, z).project(cam);
  const b = st.v2.set(x + r, y, z).project(cam);
  if (a.z > 1) return false;
  const rad = Math.hypot(((b.x - a.x) / 2) * cam.aspect, (b.y - a.y) / 2);
  const u = (a.x + 1) / 2;
  const v = (a.y + 1) / 2;
  if (u + rad < -0.1 || u - rad > 1.1 || v + rad < -0.1 || v - rad > 1.1) return false;
  out[o] = u;
  out[o + 1] = v;
  out[o + 2] = rad;
  out[o + 3] = strength;
  return true;
}
