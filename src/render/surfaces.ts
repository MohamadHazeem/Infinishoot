import * as THREE from 'three';
import { Rng } from '../core/rng';
import { createRetroMaterial } from './retroMaterial';
import { commit } from './instancing';
import { textures } from './textures';
import { SpritePool, pixelTexture, spriteTextures } from '../game/fx';
import type { Particles } from '../game/particles';

/**
 * Animated surfaces, purely cosmetic and local to each machine:
 * - water ponds (decoration on the meadow and dunes) with lapping foam,
 *   ripples, lily pads and splashes where heroes wade through
 * - the island shoreline: foam on water seas, a glowing lava rim on Magma Isle
 * - lava pools that churn, glow, bubble and now and then spurt
 * - ice ponds and snow that glint and sparkle.
 *
 * Patches are plain data (`SurfacePatch`) so gameplay code can reuse them:
 * the arena's lava/ice hazards are drawn as they are, and `decorPatches()`
 * deterministically adds the decorative ponds from the stage seed.
 */
export type SurfaceKind = 'water' | 'lava' | 'ice';

export interface SurfacePatch {
  x: number;
  z: number;
  /** Radius of the surface (for hazards: the hazard radius). */
  r: number;
  kind: SurfaceKind;
  /** Decoration only (no gameplay effect). */
  decor?: boolean;
}

export const surfaceTuning = {
  /** Decorative ponds per biome: [count, min radius, max radius]. */
  ponds: { meadow: [4, 2.4, 4.2], dunes: [3, 2.6, 4.4] } as Record<string, [number, number, number]>,
  rippleEvery: 0.5,
  bubbleEvery: 0.35,
  spurtEvery: [2.5, 6] as [number, number],
  glintsPerM2: 0.22,
  /** Distance from the camera target beyond which patches are not animated. */
  near: 34,
};

/**
 * Decorative ponds for a stage, the same on every machine for the same seed.
 * `blocked(x, z)` rejects walls and props; `avoid` are circles to keep clear
 * of (hazard pools, chests). Pure, for tests.
 */
export function decorPatches(biomeId: string, seed: number, halfSize: number, blocked: (x: number, z: number) => boolean, avoid: { x: number; z: number; r: number }[] = []): SurfacePatch[] {
  const spec = surfaceTuning.ponds[biomeId];
  if (!spec) return [];
  const [count, rMin, rMax] = spec;
  const rng = new Rng((seed ^ 0x7a3e11) >>> 0);
  const out: SurfacePatch[] = [];
  const lim = halfSize - 8;
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const r = rng.range(rMin, rMax);
      const x = rng.range(-lim, lim);
      const z = rng.range(-lim, lim);
      if (Math.hypot(x, z) < 12 + r) continue;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 4)) continue;
      if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 2)) continue;
      let hit = blocked(x, z);
      for (let k = 0; k < 10 && !hit; k++) {
        const a = (k / 10) * Math.PI * 2;
        hit = blocked(x + Math.cos(a) * (r + 0.6), z + Math.sin(a) * (r + 0.6)) || blocked(x + Math.cos(a) * r * 0.5, z + Math.sin(a) * r * 0.5);
      }
      if (hit) continue;
      out.push({ x, z, r, kind: 'water', decor: true });
      break;
    }
  }
  return out;
}

/** Is (x, z) inside a patch of this kind? */
export function inPatch(patches: readonly SurfacePatch[], x: number, z: number, kind: SurfaceKind): SurfacePatch | null {
  for (const p of patches) if (p.kind === kind && (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) return p;
  return null;
}

const SEGS = 16;
const HOT = new THREE.Color('#fff2a8');
const WARM = new THREE.Color('#c2441c');
const MAX_BUBBLES = 48;
const MAX_RIPPLES = 220;
const MAX_GLINTS = 120;

/** Wobbly radii around a patch (deterministic from its position). */
function edgeRadii(p: SurfacePatch): number[] {
  const rng = new Rng(((p.x * 73856093) ^ (p.z * 19349663)) >>> 0);
  const raw = Array.from({ length: SEGS }, () => rng.range(0.86, 1.08));
  return raw.map((v, i) => (v * 2 + raw[(i + 1) % SEGS] + raw[(i + SEGS - 1) % SEGS]) / 4);
}

/** Tiling foam/flow textures (wrap on). */
function tiled(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): THREE.Texture {
  const t = pixelTexture(w, h, f);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let surfArt: { shore: THREE.Texture; lap: THREE.Texture; flow: THREE.Texture; rim: THREE.Texture } | null = null;
function art(): NonNullable<typeof surfArt> {
  if (surfArt) return surfArt;
  const rng = new Rng(99);
  const blobs = Array.from({ length: 9 }, () => ({ x: rng.int(0, 31), y: rng.int(0, 7), w: rng.int(2, 5) }));
  surfArt = {
    // Shore line: a solid white band at the outer edge with a broken, dithered inner edge.
    shore: tiled(32, 8, (x, y) => {
      const edge = 5 + ((x * 7) % 3 === 0 ? -1 : 0) + (x % 11 === 0 ? -1 : 0);
      if (y >= edge) return [0.74, 0.88, 0.96, 1];
      if (y === edge - 1 && (x + y) % 2 === 0) return [0.6, 0.8, 0.94, 1];
      return [0, 0, 0, 0];
    }),
    // Lapping foam: loose blobs that roll toward the shore.
    lap: tiled(32, 8, (x, y) => {
      for (const b of blobs) if (y === b.y && x >= b.x && x < b.x + b.w) return [0.72, 0.88, 0.98, 1];
      return [0, 0, 0, 0];
    }),
    // Lava flow: bright wavy veins over a transparent background.
    flow: tiled(32, 32, (x, y) => {
      const v1 = Math.sin((x / 32) * Math.PI * 4 + Math.sin((y / 32) * Math.PI * 2) * 1.6);
      const v2 = Math.sin((y / 32) * Math.PI * 2 + (x / 32) * Math.PI * 2);
      if (Math.abs(v1) < 0.12 && v2 > -0.2) return [1, 0.95, 0.55, 1];
      if (Math.abs(v1) < 0.22 && v2 > 0.1) return [1, 0.8, 0.3, 1];
      return [0, 0, 0, 0];
    }),
    // Lava shore: glowing band with flickering tongues.
    rim: tiled(32, 8, (x, y) => {
      const edge = 3 + Math.round(Math.sin(x * 0.9) * 1.2 + Math.sin(x * 2.3) * 0.6);
      if (y >= 6) return [1, 0.96, 0.6, 1];
      if (y >= edge) return [1, 0.62, 0.22, 1];
      if (y === edge - 1 && x % 2 === 0) return [1, 0.4, 0.2, 1];
      return [0, 0, 0, 0];
    }),
  };
  return surfArt;
}

/**
 * A strip along a closed loop: each loop point `p` with outward normal `n`
 * (not necessarily unit: corners use a mitre) spans from p + n*inner to
 * p + n*outer. U runs along the loop (`uPerM` repeats per metre), V across.
 */
function band(pts: [number, number][], nrm: [number, number][], inner: number, outer: number, y: number, uPerM: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let u = 0;
  const n = pts.length;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (i > 0) u += Math.hypot(pts[k][0] - pts[(k + n - 1) % n][0], pts[k][1] - pts[(k + n - 1) % n][1]) * uPerM;
    const [px, pz] = pts[k];
    const [nx, nz] = nrm[k];
    pos.push(px + nx * inner, y, pz + nz * inner, px + nx * outer, y, pz + nz * outer);
    uv.push(u, 0, u, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Merge simple non-indexed-compatible geometries (same attributes) into one. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    pos.push(...(p.array as Float32Array));
    nrm.push(...(g.getAttribute('normal').array as Float32Array));
    uv.push(...(g.getAttribute('uv').array as Float32Array));
    const ix = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: p.count }, (_, i) => i);
    for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** A wobbly disc for a patch, UVs in world metres / `tile`. */
function disc(p: SurfacePatch, radii: number[], scale: number, y: number, tile: number): THREE.BufferGeometry {
  const pos: number[] = [p.x, y, p.z];
  const uv: number[] = [p.x / tile, p.z / tile];
  const idx: number[] = [];
  for (let k = 0; k < SEGS; k++) {
    const a = (k / SEGS) * Math.PI * 2;
    const r = p.r * radii[k] * scale;
    const x = p.x + Math.cos(a) * r;
    const z = p.z + Math.sin(a) * r;
    pos.push(x, y, z);
    uv.push(x / tile, z / tile);
    idx.push(0, 1 + ((k + 1) % SEGS), 1 + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function loop(p: SurfacePatch, radii: number[], scale: number): { pts: [number, number][]; nrm: [number, number][] } {
  const pts: [number, number][] = [];
  const nrm: [number, number][] = [];
  for (let k = 0; k < SEGS; k++) {
    const a = (k / SEGS) * Math.PI * 2;
    const r = p.r * radii[k] * scale;
    pts.push([p.x + Math.cos(a) * r, p.z + Math.sin(a) * r]);
    nrm.push([Math.cos(a), Math.sin(a)]);
  }
  return { pts, nrm };
}

export class Surfaces {
  /** Every surface on this stage (hazard pools and decoration). */
  patches: SurfacePatch[] = [];
  private group = new THREE.Group();
  private fx: Particles | null = null;
  private ripples: SpritePool;
  private glints: SpritePool;
  private glow: SpritePool;
  private bubbles: THREE.InstancedMesh;
  private mats: {
    water: THREE.Material;
    shore: THREE.Material;
    lap: THREE.Material;
    flow: THREE.Material;
    rim: THREE.Material;
    lily: THREE.Material;
  };
  private biome = '';
  private half = 55;
  private t = 0;
  // Per-patch timers (parallel to `patches`).
  private rippleT: number[] = [];
  private spurtT: number[] = [];
  private bubbleT: number[] = [];
  // Ripples
  private rn = 0;
  private rx = new Float32Array(MAX_RIPPLES);
  private rz = new Float32Array(MAX_RIPPLES);
  private ry = new Float32Array(MAX_RIPPLES);
  private rAge = new Float32Array(MAX_RIPPLES);
  private rLife = new Float32Array(MAX_RIPPLES);
  private rSize = new Float32Array(MAX_RIPPLES);
  private rA = new Float32Array(MAX_RIPPLES);
  // Glints
  private gn = 0;
  private gx = new Float32Array(MAX_GLINTS);
  private gy = new Float32Array(MAX_GLINTS);
  private gz = new Float32Array(MAX_GLINTS);
  private gAge = new Float32Array(MAX_GLINTS);
  private gLife = new Float32Array(MAX_GLINTS);
  private gSize = new Float32Array(MAX_GLINTS);
  private glintAcc = 0;
  // Bubbles
  private bn = 0;
  private bx = new Float32Array(MAX_BUBBLES);
  private bz = new Float32Array(MAX_BUBBLES);
  private bAge = new Float32Array(MAX_BUBBLES);
  private bLife = new Float32Array(MAX_BUBBLES);
  private bSize = new Float32Array(MAX_BUBBLES);
  private bHot = new Uint8Array(MAX_BUBBLES);
  private walkT = new Map<object, number>();
  private m4 = new THREE.Matrix4();
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const a = art();
    const sprites = spriteTextures();
    this.mats = {
      water: createRetroMaterial({ map: textures.water(), unlit: 0.35, uvScroll: [0.05, 0.03] }),
      shore: createRetroMaterial({ side: THREE.DoubleSide, map: a.shore, unlit: 0.3, alphaTest: 0.5, transparent: true, uvScroll: [0.05, 0] }),
      lap: createRetroMaterial({ side: THREE.DoubleSide, map: a.lap, unlit: 0.3, alphaTest: 0.5, transparent: true, uvScroll: [0.02, 0.35] }),
      flow: createRetroMaterial({ side: THREE.DoubleSide, map: a.flow, unlit: 1, alphaTest: 0.5, transparent: true, uvScroll: [-0.05, 0.08] }),
      rim: createRetroMaterial({ side: THREE.DoubleSide, map: a.rim, unlit: 1, alphaTest: 0.5, transparent: true, uvScroll: [0.04, 0.25] }),
      lily: createRetroMaterial({ color: '#4fd36a', unlit: 0.2 }),
    };
    this.ripples = new SpritePool(scene, { max: MAX_RIPPLES, map: sprites.ring, mode: 'flat', renderOrder: 1 });
    this.glints = new SpritePool(scene, { max: MAX_GLINTS, map: sprites.glint, mode: 'billboard', renderOrder: 4 });
    this.glow = new SpritePool(scene, { max: 64, map: sprites.puff, mode: 'flat', additive: true, renderOrder: 1 });
    const dome = new THREE.SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
    this.bubbles = new THREE.InstancedMesh(dome, createRetroMaterial({ unlit: 1 }), MAX_BUBBLES);
    this.bubbles.setColorAt(0, this.c.set('#ffd23f'));
    this.bubbles.frustumCulled = false;
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bubbles.count = 0;
    scene.add(this.bubbles);
  }

  /**
   * Build a stage's surfaces. `hazards` are the arena's lava/ice pools (drawn
   * on top of the arena's own pool meshes); decorative ponds are added here.
   */
  load(biomeId: string, seed: number, arena: { halfSize: number; hazards: readonly { x: number; z: number; r: number; kind: string }[] }, blocked: (x: number, z: number) => boolean, fx: Particles | null): void {
    this.fx = fx;
    this.biome = biomeId;
    this.half = arena.halfSize;
    for (const ch of [...this.group.children]) {
      this.group.remove(ch);
      (ch as THREE.Mesh).geometry?.dispose();
    }
    const hazards: SurfacePatch[] = arena.hazards.filter((h) => h.kind === 'lava' || h.kind === 'ice' || h.kind === 'water').map((h) => ({ x: h.x, z: h.z, r: h.r, kind: h.kind as SurfaceKind }));
    const decor = decorPatches(biomeId, seed, arena.halfSize, blocked, hazards.map((h) => ({ x: h.x, z: h.z, r: h.r / 0.85 })));
    this.patches = [...hazards, ...decor];
    this.rippleT = this.patches.map(() => Math.random());
    this.spurtT = this.patches.map(() => 1 + Math.random() * 4);
    this.bubbleT = this.patches.map(() => Math.random());
    this.rn = this.gn = this.bn = 0;
    this.walkT.clear();

    const water: THREE.BufferGeometry[] = [];
    const shore: THREE.BufferGeometry[] = [];
    const lap: THREE.BufferGeometry[] = [];
    const flow: THREE.BufferGeometry[] = [];
    const lily: THREE.BufferGeometry[] = [];
    const rim: THREE.BufferGeometry[] = [];
    for (const p of this.patches) {
      const radii = edgeRadii(p);
      if (p.kind === 'water') {
        water.push(disc(p, radii, 1, 0.03, 4));
        const l = loop(p, radii, 1);
        shore.push(band(l.pts, l.nrm, -0.32, 0.14, 0.04, 1 / 1.6));
        lap.push(band(l.pts, l.nrm, -1.25, -0.28, 0.036, 1 / 1.6));
        if (biomeId === 'meadow') {
          const rng = new Rng(((p.x * 31) ^ (p.z * 17)) >>> 0);
          for (let k = rng.int(2, 4); k > 0; k--) {
            const a = rng.next() * Math.PI * 2;
            const d = rng.range(0.2, 0.6) * p.r;
            const pad = new THREE.CircleGeometry(rng.range(0.28, 0.42), 7, 0.5, Math.PI * 2 - 0.9);
            pad.rotateX(-Math.PI / 2);
            pad.rotateY(rng.next() * Math.PI * 2);
            pad.translate(p.x + Math.cos(a) * d, 0.045, p.z + Math.sin(a) * d);
            lily.push(pad);
          }
        }
      } else if (p.kind === 'lava') {
        flow.push(disc(p, radii, 0.95, 0.042, 3));
      }
    }
    // The island shoreline: foam on water seas, a glowing rim on the lava sea.
    const E = arena.halfSize + 2;
    const sq: [number, number][] = [
      [-E, -E],
      [E, -E],
      [E, E],
      [-E, E],
    ];
    const mit: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    if (biomeId === 'meadow' || biomeId === 'dunes') {
      shore.push(band(sq, mit, 0, 0.5, -0.38, 1 / 1.6));
      lap.push(band(sq, mit, 0.4, 2.2, -0.385, 1 / 1.6));
    } else if (biomeId === 'magma') rim.push(band(sq, mit, 0, 1.6, -0.37, 1 / 1.4));

    const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, order = 0) => {
      const g = merge(parts);
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = order;
      m.frustumCulled = false;
      this.group.add(m);
    };
    add(water, this.mats.water);
    add(lily, this.mats.lily);
    add(lap, this.mats.lap, 1);
    add(shore, this.mats.shore, 1);
    add(flow, this.mats.flow, 1);
    add(rim, this.mats.rim, 1);
  }

  clear(): void {
    this.rn = this.gn = this.bn = 0;
  }

  /** A ripple ring on the ground or water (rain drops, waders). */
  ripple(x: number, z: number, size: number, life = 0.6, alpha = 0.7, y = 0.05): void {
    const i = this.rn < MAX_RIPPLES ? this.rn++ : Math.floor(Math.random() * MAX_RIPPLES);
    this.rx[i] = x;
    this.rz[i] = z;
    this.ry[i] = y;
    this.rAge[i] = 0;
    this.rLife[i] = life;
    this.rSize[i] = size;
    this.rA[i] = alpha;
  }

  private glint(x: number, y: number, z: number, size: number): void {
    if (this.gn >= MAX_GLINTS) return;
    const i = this.gn++;
    this.gx[i] = x;
    this.gy[i] = y;
    this.gz[i] = z;
    this.gAge[i] = 0;
    this.gLife[i] = 0.35 + Math.random() * 0.4;
    this.gSize[i] = size;
  }

  private bubble(x: number, z: number, size: number): void {
    if (this.bn >= MAX_BUBBLES) return;
    const i = this.bn++;
    this.bx[i] = x;
    this.bz[i] = z;
    this.bAge[i] = 0;
    this.bLife[i] = 0.6 + Math.random() * 0.7;
    this.bSize[i] = size;
    this.bHot[i] = Math.random() < 0.5 ? 1 : 0;
  }

  /** Per frame. `cx, cz` camera target, `rain` 0..1, `walkers` wade through water. */
  render(dt: number, cx: number, cz: number, rain: number, walkers: readonly { x: number; z: number; speed?: number }[], amount = 1): void {
    this.t += dt;
    const T = surfaceTuning;
    const near2 = T.near * T.near;
    for (let i = 0; i < this.patches.length && dt > 0; i++) {
      const p = this.patches[i];
      if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > near2) continue;
      const area = Math.PI * p.r * p.r;
      if (p.kind === 'water') {
        // Calm ripples, many more in the rain.
        this.rippleT[i] -= dt * (1 + rain * area * 0.6) * amount;
        while (this.rippleT[i] <= 0) {
          this.rippleT[i] += T.rippleEvery * (0.5 + Math.random());
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * p.r * 0.8;
          const big = rain > 0 ? 0.35 + Math.random() * 0.3 : 0.6 + Math.random() * 0.6;
          this.ripple(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, big, rain > 0 ? 0.45 : 1.1, 0.55);
        }
      } else if (p.kind === 'lava') {
        this.bubbleT[i] -= dt * (area / 20) * amount;
        while (this.bubbleT[i] <= 0) {
          this.bubbleT[i] += T.bubbleEvery * (0.5 + Math.random());
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * p.r * 0.8;
          this.bubble(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 0.22 + Math.random() * 0.24);
        }
        if ((this.spurtT[i] -= dt * amount) <= 0 && this.fx) {
          this.spurtT[i] = T.spurtEvery[0] + Math.random() * (T.spurtEvery[1] - T.spurtEvery[0]);
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * p.r * 0.6;
          const x = p.x + Math.cos(a) * d;
          const z = p.z + Math.sin(a) * d;
          this.fx.burst(x, 0.2, z, { count: 10, color: '#ff7a2f', color2: '#ffe680', speed: [0.6, 2.2], size: [0.14, 0.3], life: [0.6, 1.0], up: 9, gravity: 20, drag: 0.6 });
          this.fx.soft.sparks(x, 0.3, z, 5, '#ffb627', 4);
          this.fx.soft.smoke(x, 0.6, z, 2, 0.6, Math.random, '#c4b6d6');
          this.ripple(x, z, 1.4, 0.5, 0.5, 0.06);
        }
      } else if (p.kind === 'ice') {
        this.glintAcc += dt * area * T.glintsPerM2 * amount;
        while (this.glintAcc >= 1) {
          this.glintAcc -= 1;
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * p.r;
          this.glint(p.x + Math.cos(a) * d, 0.1, p.z + Math.sin(a) * d, 0.35 + Math.random() * 0.3);
        }
      }
    }
    // Snow sparkles here and there around the camera on Frosty Peaks.
    if (this.biome === 'peaks' && dt > 0 && Math.random() < dt * 14 * amount) {
      this.glint(cx + (Math.random() - 0.5) * 40, 0.06, cz + (Math.random() - 0.5) * 28, 0.22 + Math.random() * 0.15);
    }
    // Waders: ripples around anyone moving through water.
    for (const w of walkers) {
      if (!inPatch(this.patches, w.x, w.z, 'water')) continue;
      const t = (this.walkT.get(w) ?? 0) - dt;
      if (t <= 0 && (w.speed ?? 1) > 0.5) {
        this.ripple(w.x, w.z, 0.9, 0.7, 0.8);
        this.walkT.set(w, 0.22);
      } else this.walkT.set(w, t);
    }

    // Ripples: grow and fade.
    const rp = this.ripples;
    rp.begin();
    for (let i = 0; i < this.rn; i++) {
      this.rAge[i] += dt;
      if (this.rAge[i] >= this.rLife[i]) {
        const j = --this.rn;
        this.rx[i] = this.rx[j];
        this.rz[i] = this.rz[j];
        this.ry[i] = this.ry[j];
        this.rAge[i] = this.rAge[j];
        this.rLife[i] = this.rLife[j];
        this.rSize[i] = this.rSize[j];
        this.rA[i] = this.rA[j];
        i--;
        continue;
      }
      const k = this.rAge[i] / this.rLife[i];
      const s = this.rSize[i] * (0.35 + (1 - (1 - k) * (1 - k)) * 1.1);
      rp.push(this.rx[i], this.ry[i], this.rz[i], s, 0.88, 0.96, 1, this.rA[i] * (1 - k));
    }
    rp.end();

    // Glints: twinkle up and down.
    const gp = this.glints;
    gp.begin();
    for (let i = 0; i < this.gn; i++) {
      this.gAge[i] += dt;
      if (this.gAge[i] >= this.gLife[i]) {
        const j = --this.gn;
        this.gx[i] = this.gx[j];
        this.gy[i] = this.gy[j];
        this.gz[i] = this.gz[j];
        this.gAge[i] = this.gAge[j];
        this.gLife[i] = this.gLife[j];
        this.gSize[i] = this.gSize[j];
        i--;
        continue;
      }
      const k = this.gAge[i] / this.gLife[i];
      const tw = Math.sin(k * Math.PI);
      gp.push(this.gx[i], this.gy[i], this.gz[i], this.gSize[i] * (0.4 + 0.6 * tw), 1, 1, 1, tw > 0.25 ? 1 : tw * 4);
    }
    gp.end();

    // Lava: a warm pulsing glow around each pool, and bubbles that swell and pop.
    const gl = this.glow;
    gl.begin();
    if (this.biome === 'magma' || this.patches.some((p) => p.kind === 'lava')) {
      for (let i = 0; i < this.patches.length; i++) {
        const p = this.patches[i];
        if (p.kind !== 'lava' || (p.x - cx) ** 2 + (p.z - cz) ** 2 > near2 * 1.6) continue;
        const pulse = 0.3 + 0.1 * Math.sin(this.t * 2.2 + p.x);
        gl.push(p.x, 0.02, p.z, (p.r / 0.85) * 3.2, 1, 0.45, 0.15, pulse, p.z);
      }
    }
    gl.end();
    let live = 0;
    for (let i = 0; i < this.bn; i++) {
      this.bAge[i] += dt;
      if (this.bAge[i] >= this.bLife[i]) {
        // Pop: a few hot sparks.
        if (this.fx && dt > 0) this.fx.soft.sparks(this.bx[i], 0.12, this.bz[i], 2, '#ffd23f', 2.5);
        const j = --this.bn;
        this.bx[i] = this.bx[j];
        this.bz[i] = this.bz[j];
        this.bAge[i] = this.bAge[j];
        this.bLife[i] = this.bLife[j];
        this.bSize[i] = this.bSize[j];
        this.bHot[i] = this.bHot[j];
        i--;
        continue;
      }
      const k = this.bAge[i] / this.bLife[i];
      const s = this.bSize[i] * Math.min(1, k * 1.6) * (k > 0.85 ? 1.25 : 1);
      this.m4.makeScale(s, s * 0.8, s).setPosition(this.bx[i], 0.03, this.bz[i]);
      this.bubbles.setColorAt(live, this.bHot[i] ? HOT : WARM);
      this.bubbles.setMatrixAt(live++, this.m4);
    }
    this.bubbles.count = live;
    commit(this.bubbles.instanceMatrix, live);
    if (this.bubbles.instanceColor) commit(this.bubbles.instanceColor, live);
  }

  get halfSize(): number {
    return this.half;
  }
}
