/**
 * Graphics lane: destruction physics, ANIME LOOK, reflective water and
 * puddles, volumetric fog with light shafts, crowd-aware camera framing and
 * hero customisation. Called once per rendered frame from render() (after
 * the look pass has picked this frame's lights). Everything here is
 * cosmetic and derived on every machine from state it already has (break
 * events, synced props and barrels, the light list, the heroes' look codes
 * from hello/start), so co-op needs no messages beyond the look code.
 */
import * as THREE from 'three';
import type { Game } from '../game';
import type { Barrel } from '../barrels';
import { arenaTuning, PILLAR_H, type PropState, type TotemState } from '../interactives';
import { coverHooks } from '../coverBreak';
import type { MergedRange } from '../../render/mergeStatic';
import type { AABB } from '../../world/collision';
import { Shatter, shatterTuning } from '../../render/shatter';
import { WaterMirror, reflectTuning } from '../../render/reflections';
import { VolumeFog, fogForce } from '../../render/volumeFog';
import { gfxPostUniforms, MAX_SHAFTS } from '../../render/graphicsPost';
import { outlineStyle } from '../../render/outlines';
import { retroGlobals } from '../../render/retroMaterial';
import { renderQuality } from '../../render/quality';
import { postfx } from '../../render/postfx';
import { SKY_PALETTES } from '../../render/sky';
import { animateAccessories } from '../../render/accessories';
import { biomeForStage } from '../../data/biomes';
import { cleanLook } from '../../data/customise';
import { viewBand } from '../animMath';
import { cineTarget } from '../cineCam';
import { access, settings } from '../settings';
import { setOwnerSkin } from '../heroLooks';
import { CustomiseUi } from '../../ui/customise';

export const animeTuning = {
  /** Ink edge width (internal px at 270p), edge threshold, fade-out distance (m). */
  inkPx: 1.5,
  inkThreshold: 0.05,
  inkFade: 90,
  /** Hull outline width multiplier and cel bands while ANIME LOOK is on. */
  outlineScale: 2,
  celSteps: 2,
  celSoft: 0.02,
  /** Speed lines: strength, how long they linger after a dash (s). */
  speed: 1,
  speedLinger: 0.16,
  /** Impact frames: frames shown, cooldown (s), a crit this many times the recent average (and at least `critMin`). */
  impactFrames: 2,
  impactCooldown: 0.9,
  critRatio: 2.4,
  critMin: 60,
  /** A hit-stop at least this long also flashes an impact frame. */
  hitStop: 0.075,
};

export const gfxTuning = {
  /** Light shafts on dark stages (MEDIUM+): strength, reach (screen heights). */
  shaftStrength: 0.75,
  shaftReach: 0.55,
  /** Night amount from which the ground fog rolls in (and is full). */
  fogFrom: 0.3,
  fogFull: 0.85,
};

interface GfxState {
  shatter: Shatter;
  mirror: WaterMirror;
  fog: VolumeFog;
  barrels: Barrel[] | null;
  barrelAlive: boolean[];
  props: PropState[] | null;
  propAlive: boolean[];
  pillarDone: Set<PropState>;
  totems: TotemState[] | null;
  totemAlive: boolean[];
  arena: unknown;
  ui: CustomiseUi | null;
  dmg: unknown;
  // Anime look.
  animeOn: boolean;
  baseSteps: number;
  baseSoft: number;
  impactLeft: number;
  impactCd: number;
  critAvg: number;
  lastStop: number;
  lastKill: number;
  speedK: number;
  speedX: number;
  speedZ: number;
  frame: number;
  /** Wheel zoom to restore when CUSTOMISE closes (-1 = not zoomed). */
  zoomBack: number;
  v: THREE.Vector3;
  c: THREE.Color;
}

const states = new WeakMap<Game, GfxState>();
/** The toppling pillar's stone and band colours (src/game/interactives.ts), tinted per biome like the pillar. */
const PILLAR_STONE = new THREE.Color('#f4ecff');
const PILLAR_BAND = new THREE.Color('#ff9ecf');
const texAvg = new WeakMap<THREE.Texture, THREE.Color>();

/** Graphics state for a game (created on first use). Exported for tests and test links. */
export function gfxState(g: Game): GfxState {
  let st = states.get(g);
  if (st) return st;
  st = {
    shatter: new Shatter(g.scene),
    mirror: new WaterMirror(g.scene),
    fog: new VolumeFog(g.scene),
    barrels: null,
    barrelAlive: [],
    props: null,
    propAlive: [],
    pillarDone: new Set(),
    totems: null,
    totemAlive: [],
    arena: null,
    ui: null,
    dmg: null,
    animeOn: false,
    baseSteps: 3,
    baseSoft: 0.15,
    impactLeft: 0,
    impactCd: 0,
    critAvg: 0,
    lastStop: 0,
    lastKill: 0,
    speedK: 0,
    speedX: 1,
    speedZ: 0,
    frame: 0,
    zoomBack: -1,
    v: new THREE.Vector3(),
    c: new THREE.Color(),
  };
  states.set(g, st);
  const s = st;
  coverHooks.broke = (game, box, ranges) => {
    if (game === g) shatterCover(g, s, box, ranges);
  };
  return st;
}

// ---------------------------------------------------------------- destruction

/** Average colour of a texture's pixels (cached; white when it can't be read). */
function textureColor(tex: THREE.Texture | null | undefined): THREE.Color {
  const white = new THREE.Color(1, 1, 1);
  if (!tex) return white;
  const hit = texAvg.get(tex);
  if (hit) return hit;
  let out = white;
  try {
    const img = tex.image as { data?: ArrayLike<number>; width: number; height: number; getContext?: (k: string) => CanvasRenderingContext2D | null };
    let data: ArrayLike<number> | null = img?.data ?? null;
    if (!data && img?.getContext) data = img.getContext('2d')?.getImageData(0, 0, img.width, img.height).data ?? null;
    if (data && data.length >= 4) {
      let r = 0;
      let gg = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 16) {
        r += data[i];
        gg += data[i + 1];
        b += data[i + 2];
        n++;
      }
      out = new THREE.Color(r / n / 255, gg / n / 255, b / n / 255);
    }
  } catch {
    out = white;
  }
  texAvg.set(tex, out);
  return out;
}

/** Rex smashed a cover piece (every machine, before its triangles collapse): break it into chunks of its own colours. */
function shatterCover(g: Game, st: GfxState, box: AABB, ranges: MergedRange[] | undefined): void {
  const cols: THREE.Color[] = [];
  let top = 1.5;
  for (const r of ranges ?? []) {
    const mat = r.mesh.material as THREE.ShaderMaterial;
    const base = (mat.uniforms?.uColor?.value as THREE.Color | undefined)?.clone() ?? new THREE.Color(0.7, 0.7, 0.75);
    base.multiply(textureColor(mat.uniforms?.uMap?.value as THREE.Texture | null));
    const pos = r.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vc = r.mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    let vr = 0;
    let vg = 0;
    let vb = 0;
    let n = 0;
    for (let i = r.start; i < r.start + r.count; i++) {
      top = Math.max(top, pos.getY(i));
      if (vc && (i - r.start) % 3 === 0) {
        vr += vc.getX(i);
        vg += vc.getY(i);
        vb += vc.getZ(i);
        n++;
      }
    }
    if (n) base.multiply(st.c.setRGB(vr / n, vg / n, vb / n));
    cols.push(base);
  }
  const w = box.maxX - box.minX;
  const d = box.maxZ - box.minZ;
  const h = Math.min(4.5, Math.max(0.8, top));
  // Pieces fly away from whatever smashed it (the nearest big enemy), else from below.
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  let fx = cx;
  let fz = cz;
  let bd = 49;
  for (const e of g.enemies.list) {
    if (!e.active || e.radius < 0.9) continue;
    const dd = (e.x - cx) ** 2 + (e.z - cz) ** 2;
    if (dd < bd) {
      bd = dd;
      fx = e.x;
      fz = e.z;
    }
  }
  const c1 = cols[0] ?? new THREE.Color('#94b0c2');
  const c2 = cols[1] ?? c1.clone().multiplyScalar(0.8);
  const pieces = Math.max(8, Math.min(26, Math.round(w * h * d * 1.6)));
  st.shatter.burst({ x: cx, z: cz, w, h, d, color: c1, color2: c2, pieces, fromX: fx, fromZ: fz, power: 1.7 });
}

/** Barrels, crates, stacks, pillars and totems that broke since last frame (every machine sees the same state change). */
function watchBreaks(g: Game, st: GfxState): void {
  const S = st.shatter;
  const bl = g.barrels.list;
  if (bl !== st.barrels) {
    st.barrels = bl;
    st.barrelAlive = bl.map((b) => b.alive);
  } else {
    for (let i = 0; i < bl.length; i++) {
      const b = bl[i];
      if (st.barrelAlive[i] && !b.alive) S.burst({ x: b.x, z: b.z, w: 0.9, h: 1.1, d: 0.9, color: '#ff4d5e', color2: '#ffd23f', pieces: 9, power: 2.4 });
      st.barrelAlive[i] = b.alive;
    }
  }
  const props = g.toys.props;
  if (props !== st.props) {
    st.props = props;
    st.propAlive = props.map((p) => p.alive);
    st.pillarDone.clear();
  } else {
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      const d = p.def;
      if (d.kind !== 'pillar') {
        if (st.propAlive[i] && !p.alive) {
          const stack = d.kind === 'stack';
          S.burst({ x: d.x, z: d.z, w: 1.2, h: stack ? 2.4 : 1.2, d: 1.2, yaw: d.rot, crate: true, color: '#ffffff', color2: '#e8d8c8', pieces: stack ? 14 : 8, fromX: d.x - p.dirX, fromZ: d.z - p.dirZ, power: 1.25 });
        }
      } else if (p.fallT >= arenaTuning.pillarFall + 0.03 && !st.pillarDone.has(p)) {
        // The pillar hits the ground and breaks into drums along its length (the solid pillar is skipped from here on).
        st.pillarDone.add(p);
        const sx = Math.sin(p.fallA);
        const sz = Math.cos(p.fallA);
        const len = PILLAR_H;
        const tint = st.c.set(biomeForStage(g.arenaStage).pillarTint ?? '#ffffff');
        S.burst({ x: d.x + sx * len * 0.5, z: d.z + sz * len * 0.5, w: 1.15, h: 1.15, d: len, yaw: p.fallA, color: tint.clone().multiply(PILLAR_STONE), color2: tint.clone().multiply(PILLAR_BAND), pieces: 12, fromX: d.x + sx * len * 0.5, fromZ: d.z + sz * len * 0.5, power: 0.7 });
        p.fallT = arenaTuning.pillarFall + arenaTuning.pillarLie + 2;
      }
      st.propAlive[i] = p.alive;
    }
  }
  const tt = g.toys.totems;
  if (tt !== st.totems) {
    st.totems = tt;
    st.totemAlive = tt.map((t) => t.alive);
  } else {
    for (let i = 0; i < tt.length; i++) {
      const t = tt[i];
      if (st.totemAlive[i] && !t.alive) S.burst({ x: t.x, z: t.z, w: 1.2, h: 2.6, d: 1.2, color: '#b13e53', color2: '#ef7d57', pieces: 10, power: 1.6 });
      st.totemAlive[i] = t.alive;
    }
  }
}

// ---------------------------------------------------------------- anime look

function hookDamageNumbers(g: Game, st: GfxState): void {
  const dmg = g.dmg;
  st.dmg = dmg;
  const spawn0 = dmg.spawn.bind(dmg);
  dmg.spawn = (x, y, z, value, kind, by) => {
    spawn0(x, y, z, value, kind, by);
    if (kind !== 'crit' || typeof value !== 'number' || (by !== undefined && by !== g.local)) return;
    const A = animeTuning;
    if (st.critAvg > 0 && value >= A.critMin && value >= st.critAvg * A.critRatio) impact(st, A.impactFrames);
    st.critAvg = st.critAvg <= 0 ? value : st.critAvg + (value - st.critAvg) * 0.08;
  };
}

function impact(st: GfxState, frames: number): void {
  if (!st.animeOn || access.reduceFlash || st.impactCd > 0) return;
  st.impactLeft = frames;
  st.impactCd = animeTuning.impactCooldown;
}

function updateAnime(g: Game, st: GfxState, frameDt: number, frozen: boolean): void {
  const A = animeTuning;
  const on = !!settings.animeLook;
  if (on !== st.animeOn) {
    st.animeOn = on;
    if (on) {
      st.baseSteps = retroGlobals.uToonSteps.value;
      st.baseSoft = retroGlobals.uCelSoft.value;
    } else {
      retroGlobals.uToonSteps.value = st.baseSteps;
      retroGlobals.uCelSoft.value = st.baseSoft;
    }
  }
  if (on) {
    retroGlobals.uToonSteps.value = A.celSteps;
    retroGlobals.uCelSoft.value = A.celSoft;
  }
  outlineStyle.scale = on ? A.outlineScale : 1;
  const ink = gfxPostUniforms.uInk.value;
  ink.set(on ? 1 : 0, A.inkPx * Math.max(1, retroGlobals.uSnapRes.value.y / 270), A.inkThreshold, 1 / A.inkFade);
  if (st.dmg !== g.dmg) hookDamageNumbers(g, st);
  // No impact frames behind the title (the attract demo hits things too).
  st.impactCd = g.mode === 'title' ? 1 : Math.max(0, st.impactCd - frameDt);
  // Heavy hits (long hit-stops) and boss kills (the kill-cam starting) get an impact frame too.
  const stop = g.juice.hitStop;
  if (stop >= A.hitStop && stop > st.lastStop + 0.02) impact(st, A.impactFrames);
  st.lastStop = stop;
  const kill = g.cam.killWeight;
  if (kill > 0 && st.lastKill === 0 && g.mode !== 'title') {
    st.impactCd = 0;
    impact(st, A.impactFrames + 1);
  }
  st.lastKill = kill;
  const imp = gfxPostUniforms.uImpact.value;
  if (st.impactLeft > 0 && on && !access.reduceFlash) {
    imp.set(1, (A.impactFrames + 1 - st.impactLeft) % 2, 0.42);
    st.impactLeft--;
  } else {
    imp.x = 0;
    st.impactLeft = 0;
  }
  // Speed lines along the local hero's dash.
  const p = g.hero.player;
  const sp = gfxPostUniforms.uSpeed.value;
  if (on && p.dashing && !p.dead && g.isCombatMode) {
    st.speedK = 1;
    const l = Math.hypot(p.vel.x, p.vel.z);
    if (l > 0.5) {
      st.speedX = p.vel.x / l;
      st.speedZ = p.vel.z / l;
    }
  }
  if (!on || st.speedK <= 0) sp.x = 0;
  else {
    // World +z points down the screen: uv y is up.
    sp.set(st.speedK * A.speed * (access.reduceFlash ? 0.5 : 1), st.speedX, -st.speedZ, Math.floor(st.frame / 3) % 97);
    const v = st.v.set(g.playerPos.x, 1, g.playerPos.z).project(g.cam.camera);
    gfxPostUniforms.uSpeedCenter.value.set((v.x + 1) / 2, (v.y + 1) / 2, 0.16);
  }
  // Linger after the dash ends (decays after this frame's lines are set, so even one dash frame shows).
  if (!frozen && !(on && p.dashing)) st.speedK = Math.max(0, st.speedK - frameDt / Math.max(0.01, A.speedLinger));
}

// ---------------------------------------------------------------- water, fog, shafts

function blockedFor(g: Game): (x: number, z: number, r: number) => boolean {
  const cols = g.arena.colliders;
  const hz = g.arena.hazards;
  const ponds = g.ambience.surfaces.patches;
  return (x, z, r) => {
    for (const b of cols) if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
    for (const h of hz) if ((h.x - x) ** 2 + (h.z - z) ** 2 < (h.r + r) ** 2) return true;
    for (const p of ponds) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + r) ** 2) return true;
    return false;
  };
}

function updateWaterAndFog(g: Game, st: GfxState, dt: number): void {
  const biome = biomeForStage(g.arenaStage);
  const lvl = renderQuality.level;
  const rainy = g.ambience.rain > 0.05;
  const puddles = g.mode === 'title' ? 0 : biome.id === 'neon' ? reflectTuning.puddles : rainy ? reflectTuning.rainPuddles : 0;
  const pal = SKY_PALETTES[biome.id];
  st.c.copy(retroGlobals.uSkyColor.value).lerp(retroGlobals.uFogColor.value, 0.4);
  if (biome.id === 'neon') st.c.lerp(new THREE.Color('#5d275d'), 0.35);
  st.mirror.update({
    on: lvl >= 1,
    sea: lvl >= 2 && (pal?.reflect ?? 1) > 0,
    ponds: g.ambience.surfaces.patches,
    puddles,
    seed: (g.arena.seed ?? 1) ^ Math.imul(g.arenaStage, 0x9e3779b1),
    half: g.arena.halfSize,
    blocked: () => blockedFor(g),
    skyColor: st.c,
  });
  // Ground fog on dark stages (night, Neon City, an eclipse from another lane).
  const night = postfx.night;
  const k = Math.max(0, Math.min(1, (night - gfxTuning.fogFrom) / Math.max(0.01, gfxTuning.fogFull - gfxTuning.fogFrom)));
  const want = g.mode === 'title' ? 0 : fogForce.amount ?? k;
  const layers = lvl <= 0 ? 0 : lvl === 1 ? 2 : 3;
  const wind = g.ambience.wind;
  st.fog.update(dt, want, layers, g.playerPos.x, g.playerPos.z, Math.max(1, g.cam.camera.far / 120), retroGlobals.uFogColor.value, wind.x * wind.s * 0.3, wind.z * wind.s * 0.3);
  // Light shafts: the two strongest lights near the screen, while the fog is thick enough (MEDIUM+).
  let n = 0;
  if (lvl >= 2 && st.fog.amount > 0.25) {
    const pos = retroGlobals.uLightPos.value;
    const col = retroGlobals.uLightCol.value;
    const count = retroGlobals.uLightCount.value;
    const out = gfxPostUniforms.uShafts.value;
    let best0 = -1;
    let best1 = -1;
    let s0 = 0;
    let s1 = 0;
    for (let i = 0; i < count; i++) {
      const c = lightAt(col, i);
      const s = c.x + c.y + c.z;
      if (s > s0) {
        best1 = best0;
        s1 = s0;
        best0 = i;
        s0 = s;
      } else if (s > s1) {
        best1 = i;
        s1 = s;
      }
    }
    for (const i of [best0, best1]) {
      if (i < 0 || n >= MAX_SHAFTS) continue;
      const lp = lightAt(pos, i);
      const v = st.v.set(lp.x, lp.y, lp.z).project(g.cam.camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) continue;
      out[n * 4] = (v.x + 1) / 2;
      out[n * 4 + 1] = (v.y + 1) / 2;
      out[n * 4 + 2] = gfxTuning.shaftStrength * st.fog.amount;
      out[n * 4 + 3] = gfxTuning.shaftReach;
      n++;
    }
  }
  gfxPostUniforms.uShaftCount.value = n;
}

const lv = new THREE.Vector4();
/** Light i from the packed light uniforms (xyzw per light). */
function lightAt(a: Float32Array, i: number): THREE.Vector4 {
  return lv.set(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]);
}

// ---------------------------------------------------------------- camera framing

function updateFraming(g: Game): void {
  const cam = g.cam;
  if (!g.isCombatMode) {
    if (g.mode === 'title' || g.mode === 'transition') cam.cine = 0;
    return;
  }
  let near = 0;
  let boss = false;
  const fx = g.playerPos.x;
  const fz = g.playerPos.z;
  for (const e of g.enemies.list) {
    if (!e.active || e.def.hidden) continue;
    if (e.def.boss) boss = true;
    if (viewBand(e.x - fx, e.z - fz, cam.zoom) !== 0) near++;
  }
  cam.cine = settings.dynamicCamera === false || g.hero.player.dead ? 0 : cineTarget(near, boss, cam.zoom, g.heroes.length > 1);
}

// ---------------------------------------------------------------- customisation

function updateLooks(g: Game, rdt: number): void {
  const local = g.hero;
  const want = cleanLook(settings.look);
  if (local.player.look !== want) {
    local.player.look = want;
    local.player.setSkin(g.heroes.length > 1 ? local.color : local.skin.armor, local.skin);
  }
  for (const h of g.heroes) {
    setOwnerSkin(h.index, h.player.look);
    if (!h.left) animateAccessories(h.player.rig, rdt);
  }
}

// ---------------------------------------------------------------- frame

/** Once per rendered frame (from render(), after the look pass). */
export function updateGraphics(g: Game, frameDt: number): void {
  const st = gfxState(g);
  st.frame++;
  if (!st.ui) st.ui = new CustomiseUi(g.screens);
  const frozen = g.paused || g.mode === 'levelup' || g.mode === 'shop';
  const dt = frozen ? 0 : Math.min(frameDt, 0.05);
  if (st.arena !== g.arena) {
    st.arena = g.arena;
    st.shatter.clear();
  }
  st.shatter.density = renderQuality.level <= 0 ? shatterTuning.lowScale : 1;
  watchBreaks(g, st);
  st.shatter.update(dt);
  st.shatter.render();
  updateAnime(g, st, frameDt, frozen);
  updateWaterAndFog(g, st, frozen ? 0 : Math.min(frameDt, 0.25));
  updateFraming(g);
  updateLooks(g, dt);
  st.ui.update();
  // CUSTOMISE open: the camera moves in on the hero behind the menu, and back out after.
  const open = st.ui.isOpen;
  if (open && st.zoomBack < 0) {
    st.zoomBack = g.cam.zoom;
    g.cam.zoom = customiseZoom;
  } else if (!open && st.zoomBack >= 0) {
    g.cam.zoom = st.zoomBack;
    st.zoomBack = -1;
  }
}

/** Numbers for test links and the debug panel. */
export function gfxStats(g: Game): Record<string, number> {
  const st = gfxState(g);
  return { pieces: st.shatter.live, piles: st.shatter.pile.size, puddles: st.mirror.puddleCount, fog: Math.round(st.fog.amount * 100) / 100, cine: Math.round(g.cam.cineShown * 100) / 100, lights: retroGlobals.uLightCount.value };
}

/** Camera zoom while CUSTOMISE is open (below 1 = closer). */
export const customiseZoom = 0.5;
