/**
 * The look pass: dynamic lights, night stages, outlines, shockwave and heat
 * distortion, and per-area grading, fed from game state every rendered frame.
 * Everything here is cosmetic and derived locally on every machine from
 * state it already has (synced enemies and bullets, the effects bus replaying
 * rings and stars, the stage number), so co-op needs no new messages.
 * Installed on Game as `updateLook` and called at the end of render().
 */
import * as THREE from 'three';
import type { Game } from '../game';
import { Team } from '../bullets';
import { access, settings } from '../settings';
import { isNightStage, refreshLook } from '../../render/biomeLook';
import { LightPicker, lightTuning, lightUniforms } from '../../render/lights';
import { outlineInstanced } from '../../render/outlines';
import { updateHeroMarkers } from './readability';
import { easeGrade, MAX_HEAT, MAX_WAVES, postfx } from '../../render/postfx';
import { renderQuality } from '../../render/quality';
import { biomeForStage } from '../../data/biomes';
import { BiomeFx } from '../../render/biomeFx';
import { sampleWind } from '../wind';
import { samples } from '../../audio/samples';

/**
 * Test-link / debug overrides: force night on or off (null = follow the stage). World events
 * (src/game/systems/worldEvents.ts) set `eventNight` (extra darkness 0..1: eclipse, Night Raid),
 * `nightSnap` (jump to the target this frame: the eclipse's sun burst) and `lantern` (hero lantern scale).
 */
export const lookOverrides: { night: boolean | null; eventNight: number; nightSnap: boolean; lantern: number } = { night: null, eventNight: 0, nightSnap: false, lantern: 1 };
/** Extra light sources added every frame (world events: lamps, searchlights, lava bombs, the giant flower). */
export const lookHooks: ((pk: LightPicker, night: number) => void)[] = [];

export const lookTuning = {
  /** Hero lantern on night stages. */
  lanternRadius: 10,
  lanternIntensity: 0.75,
  lanternColor: new THREE.Color(1, 0.9, 0.72),
  muzzleRadius: 4.5,
  muzzleIntensity: 1.1,
  /** Explosion flashes: rings at least this big (final radius, m) light the ground. */
  ringMin: 1.2,
  /** ...and rings at least this big also send a shockwave. */
  waveMin: 3,
  bulletRadius: 3,
  bulletIntensity: 0.3,
  lavaIntensity: 0.55,
  /** Night fade speed (per second). */
  nightSpeed: 1.5,
};

interface LookState {
  picker: LightPicker;
  fx: unknown;
  frame: number;
  // World-space shockwaves.
  wx: Float32Array;
  wz: Float32Array;
  wr: Float32Array;
  wt: Float32Array;
  wl: Float32Array;
  ws: Float32Array;
  wn: number;
  colors: Map<string, THREE.Color>;
  v: THREE.Vector3;
  v2: THREE.Vector3;
  night: number;
  // Neon City / Sky Fortress set dressing (src/render/biomeFx.ts).
  biomeFx: BiomeFx;
  arena: unknown;
  gust: number;
}

const states = new WeakMap<Game, LookState>();
const tmpColor = new THREE.Color();

function color(st: LookState, c: THREE.ColorRepresentation): THREE.Color {
  if (typeof c !== 'string') return tmpColor.set(c);
  let col = st.colors.get(c);
  if (!col) {
    col = new THREE.Color(c);
    if (st.colors.size < 256) st.colors.set(c, col);
  }
  return col;
}

function addWave(st: LookState, x: number, z: number, r: number, life: number, strength: number): void {
  let i = st.wn;
  if (i >= MAX_WAVES) {
    // Replace the wave nearest its end.
    i = 0;
    for (let k = 1; k < MAX_WAVES; k++) if (st.wt[k] / st.wl[k] > st.wt[i] / st.wl[i]) i = k;
  } else st.wn++;
  st.wx[i] = x;
  st.wz[i] = z;
  st.wr[i] = r;
  st.wt[i] = 0;
  st.wl[i] = life;
  st.ws[i] = strength;
}

/** Wrap Fx.ring / Fx.star (which every machine plays, host and client) so explosions also light and ripple. */
function hookFx(game: Game, st: LookState): void {
  const fx = game.fx;
  st.fx = fx;
  const ring0 = fx.ring.bind(fx);
  const star0 = fx.star.bind(fx);
  fx.ring = (x, z, size, grow, c, life = 0.3) => {
    ring0(x, z, size, grow, c, life);
    if (grow < 1.2) return; // telegraphs and implosions shrink: no flash
    const R = 0.5 * size * grow;
    const T = lookTuning;
    if (R < T.ringMin) return;
    const col = color(st, c);
    st.picker.flash(x, 1, z, R * 1.4 + 1.5, col.r, col.g, col.b, Math.min(1.6, 0.45 + R * 0.12), Math.max(0.18, life * 1.3));
    if (R >= T.waveMin && life >= 0.15) addWave(st, x, z, R * 1.1, Math.min(0.7, Math.max(0.3, life * 1.2)), Math.min(1, 0.3 + R / 10));
  };
  fx.star = (x, y, z, size, c = '#ffffff', life = 0.12) => {
    star0(x, y, z, size, c, life);
    if (size < 1) return;
    const col = color(st, c);
    st.picker.flash(x, Math.max(0.6, y * 0.6), z, size * 1.6 + 1, col.r, col.g, col.b, Math.min(1.2, 0.35 + size * 0.15), Math.max(0.12, life * 1.5));
  };
}

function state(game: Game): LookState {
  let st = states.get(game);
  if (!st) {
    const f = () => new Float32Array(MAX_WAVES);
    st = { picker: new LightPicker(), fx: null, frame: 0, wx: f(), wz: f(), wr: f(), wt: f(), wl: f(), ws: f(), wn: 0, colors: new Map(), v: new THREE.Vector3(), v2: new THREE.Vector3(), night: 0, biomeFx: new BiomeFx(), arena: null, gust: 0 };
    states.set(game, st);
  }
  if (st.fx !== game.fx) hookFx(game, st);
  return st;
}

export function updateLook(this: Game, frameDt: number): void {
  const st = state(this);
  const frozen = this.paused || this.mode === 'levelup' || this.mode === 'shop';
  const dt = frozen ? 0 : frameDt;
  const cam = this.cam.camera;

  // --- A new arena: build the biome's animated dressing and set the enemy palette.
  const biome = biomeForStage(this.arenaStage);
  if (st.arena !== this.arena) {
    st.arena = this.arena;
    st.biomeFx.load(this.arena.group, this.arena.deco);
    this.enemies.setTint(biome.enemyTint ?? '#ffffff');
  }

  // --- Night: every 3rd arena stage (or forced by a test link), faded in. Neon City is always partly dark.
  const wantNight = this.mode !== 'title' && settings.nightStages && (lookOverrides.night ?? isNightStage(this.arenaStage));
  const nt0 = wantNight ? 1 : settings.nightStages && lookOverrides.night !== false ? (biome.night ?? 0) : 0;
  const nt = this.mode === 'title' ? nt0 : Math.max(nt0, lookOverrides.eventNight);
  st.night = Math.abs(nt - st.night) < 0.002 || lookOverrides.nightSnap ? nt : st.night + (nt - st.night) * Math.min(1, frameDt * lookTuning.nightSpeed);
  lookOverrides.nightSnap = false;
  if (st.night !== postfx.night) {
    postfx.night = st.night;
    refreshLook();
  }
  easeGrade(frameDt);
  // Distortion follows its own toggle; screen shake at 0 (motion-sensitive players) also turns it off.
  postfx.distortion = settings.distortion && settings.shake > 0;
  const motion = Math.min(1, settings.shake);

  // --- Outlines: attach to new enemy batches (created lazily) and hero rigs.
  if ((st.frame++ & 31) === 0) {
    for (const o of this.scene.children) {
      const m = o as THREE.InstancedMesh;
      if (m.isInstancedMesh && m.geometry.attributes.instanceFlash) outlineInstanced(m);
    }
  }
  updateHeroMarkers(this); // merged hero outlines, x-ray and ground ring (readability lane)

  // --- Lights.
  const p = this.playerPos;
  const pk = st.picker;
  pk.begin(p.x, p.z, lightTuning.viewRadius * Math.max(1, cam.far / 120));
  pk.tickFlashes(dt, access.reduceFlash);
  const night = st.night;
  if (night > 0.01) {
    const T = lookTuning;
    const c = T.lanternColor;
    for (const h of this.heroes) {
      if (h.left) continue;
      const r = h.player.rig.root.position;
      const down = h.player.dead;
      pk.add(r.x, 2.4, r.z, T.lanternRadius * (down ? 0.55 : 1) * Math.max(0.5, lookOverrides.lantern), c.r, c.g, c.b, T.lanternIntensity * night * (down ? 0.6 : 1) * lookOverrides.lantern, 1000);
    }
  }
  for (const m of this.flashes) {
    if (m.visible) pk.add(m.position.x, m.position.y, m.position.z, lookTuning.muzzleRadius, 1, 0.92, 0.65, lookTuning.muzzleIntensity, 5);
  }
  // Bullets: merged per grid cell.
  const b = this.bullets;
  const bc = b.mesh.instanceColor?.array as Float32Array | undefined;
  if (bc) {
    const br = lookTuning.bulletRadius;
    for (let i = 0; i < b.count; i++) {
      const enemy = b.team[i] !== Team.Player;
      const k = lookTuning.bulletIntensity * (enemy ? 0.8 : 1) * (0.7 + Math.min(1.2, b.width[i] * 0.8));
      pk.addSmall(b.x[i], 0.8, b.z[i], br, bc[i * 3], bc[i * 3 + 1], bc[i * 3 + 2], k);
    }
  }
  // Burning and shocked enemies, elites with a modifier, raging bosses.
  const t = this.animTime;
  for (const e of this.enemies.list) {
    if (!e.active || e.def.hidden) continue;
    if (e.burnT > 0) pk.addSmall(e.x, 1, e.z, 3.2, 1, 0.45, 0.12, 0.55 * (0.8 + 0.2 * Math.sin(t * 23 + e.uid)));
    if (e.shockT > 0) pk.addSmall(e.x, 1, e.z, 3, 0.6, 0.8, 1, Math.sin(t * 50 + e.uid) > 0.2 ? 0.45 : 0.1);
    if (e.mod) {
      const mc = color(st, e.mod.color);
      pk.add(e.x, 1.2, e.z, 4 * e.scale, mc.r, mc.g, mc.b, 0.45, 2);
    }
    if (e.def.boss && e.enraged) pk.add(e.x, 2, e.z, 7, 1, 0.2, 0.25, 0.5 + 0.2 * Math.sin(t * 8), 3);
  }
  // Lava pools glow and shimmer.
  let heat = 0;
  const hz = this.arena.hazards;
  for (let i = 0; i < hz.length; i++) {
    const h = hz[i];
    if (h.kind !== 'lava') continue;
    const fl = 0.85 + 0.15 * Math.sin(t * 3.1 + i * 1.7);
    pk.add(h.x, 0.6, h.z, h.r * 1.5 + 2.5, 1, 0.42, 0.12, lookTuning.lavaIntensity * fl, 1);
    if (heat < MAX_HEAT && Math.hypot(h.x - p.x, h.z - p.z) < 26) {
      if (project(st, cam, h.x, 0.5, h.z, h.r * 1.2 + 1, postfx.heat, heat * 4, 0.85 * motion)) heat++;
    }
  }
  postfx.heatCount = heat;
  // Neon signs and street lamps light the wet roof around them.
  const lights = this.arena.deco?.lights;
  if (lights) {
    const vr = lightTuning.viewRadius + 6;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (Math.abs(l.x - p.x) > vr || Math.abs(l.z - p.z) > vr) continue;
      const lc = color(st, l.color);
      pk.add(l.x, l.y, l.z, l.r, lc.r, lc.g, lc.b, l.k * (0.7 + 0.5 * night), 1);
    }
  }
  // Wind (Sky Fortress): flags, steam and streaks follow it; each gust whooshes.
  const wind = sampleWind(this, dt);
  this.ambience.wind.x = wind.x;
  this.ambience.wind.z = wind.z;
  this.ambience.wind.s = wind.s;
  if (wind.gust > 0.2 && st.gust <= 0.2 && dt > 0 && this.mode !== 'title') samples.play('wind_gust', { gain: 0.45, priority: 2, cooldown: 3 });
  st.gust = wind.gust;
  st.biomeFx.reduceFlash = access.reduceFlash;
  st.biomeFx.render(dt, p.x, p.z, wind);
  for (const f of lookHooks) f(pk, night);
  for (const ch of this.chests.list) if (ch.openT < 0) pk.add(ch.x, 1, ch.z, 3.5, 1, 0.8, 0.35, 0.35 + 0.35 * night, 0);
  if (this.portal.active) pk.add(this.portal.x, 1.5, this.portal.z, 8, 1, 0.35, 0.95, 0.8, 4);

  const scale = lightTuning.dayScale + (lightTuning.nightScale - lightTuning.dayScale) * night;
  lightUniforms.uLightCount.value = pk.pick(renderQuality.lights, lightUniforms.uLightPos.value, lightUniforms.uLightCol.value, scale);

  // --- Shockwaves: age and project to the screen.
  let wn = 0;
  for (let i = 0; i < st.wn; i++) {
    st.wt[i] += dt;
    const k = st.wt[i] / st.wl[i];
    if (k >= 1) {
      const j = --st.wn;
      st.wx[i] = st.wx[j];
      st.wz[i] = st.wz[j];
      st.wr[i] = st.wr[j];
      st.wt[i] = st.wt[j];
      st.wl[i] = st.wl[j];
      st.ws[i] = st.ws[j];
      i--;
      continue;
    }
    const e = 1 - (1 - k) * (1 - k); // ease-out like the rings
    const strength = st.ws[i] * (1 - k) * (access.reduceFlash ? 0.5 : 1) * motion;
    if (project(st, cam, st.wx[i], 0.2, st.wz[i], Math.max(0.3, st.wr[i] * e), postfx.waves, wn * 4, strength)) wn++;
  }
  postfx.waveCount = wn;
}

/** Project a world circle (centre, radius) to (u, v, radius in screen heights, strength). False if off screen. */
function project(st: LookState, cam: THREE.PerspectiveCamera, x: number, y: number, z: number, r: number, out: Float32Array, o: number, strength: number): boolean {
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
