import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng } from '../core/rng';
import { biomeForStage } from '../data/biomes';
import type { Game } from '../game/game';
import type { WorldEvent } from '../game/systems/worldEvents';
import { awareOf } from '../game/systems/stealth';
import {
  collapseCrackAt,
  collapseFallAt,
  floodLevel,
  flowerPhase,
  giantStep,
  giantStepTime,
  searchBeam,
  worldEventTuning as T,
} from '../game/worldEvents';
import { commit } from './instancing';
import type { LightPicker } from './lights';
import { createRetroMaterial, type RetroMaterial } from './retroMaterial';
import { biomeTex } from './biomeTextures';
import { makeTexture } from './textures';
import { paint } from './geometry';

/**
 * The look of the world events (src/game/systems/worldEvents.ts). Everything
 * is drawn locally on every machine from the synced event (kind, plan, clock):
 *   holes and the chasm: flat quads painted like a pit seen from the fixed 3/4
 *     camera (the far cliff face in the island's rim texture, the backdrop far
 *     below: sea, lava, city lights or clouds), with plank bridges; cracks glow
 *     before a section drops, and the slab shrinks away into the dark
 *   flood: translucent water discs that rise and fall, with a foam edge
 *   colossus: two huge stone feet and legs that lift out of view and stamp down
 *     (their shadow sweeps ahead), plus a long body shadow along its path
 *   flower: stem, bud, petals that open and droop, a glowing healing ring
 *   volcano: a cone at the shore, lava bombs arcing in, glowing puddles
 *   Night Raid: lamp posts with light pools, searchlight towers and their beams,
 *     intel caches with light columns, and ? / ! / closed-eye markers over enemies
 */

const DARK = '#1a1c2c';

function flat(w: number, d: number, x: number, z: number, y: number, uvScale = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  if (uvScale > 0) {
    // World-space UVs so neighbouring pieces tile seamlessly.
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * uvScale, -pos.getZ(i) * uvScale);
  }
  return g;
}

function pixelTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number, rng: Rng) => void, seed = 1): THREE.CanvasTexture {
  return makeTexture(size, draw, seed);
}

/** The ? ! and closed-eye markers (16 px). */
function markerTex(kind: 0 | 1 | 2): THREE.CanvasTexture {
  return pixelTex(16, (ctx) => {
    const px = (x: number, y: number, c: string, w = 1, h = 1) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    if (kind === 0) {
      // Closed eye: a curved lid with lashes, outlined so it reads on any floor.
      px(2, 5, DARK, 12, 4);
      px(1, 6, DARK, 14, 2);
      px(3, 6, '#f4f4f4', 10, 1);
      px(2, 7, '#94b0c2', 12, 1);
      for (const x of [3, 7, 11]) {
        px(x - 1, 8, DARK, 3, 4);
        px(x, 9, '#94b0c2', 1, 2);
      }
    } else if (kind === 1) {
      px(5, 1, DARK, 7, 3);
      px(9, 3, DARK, 4, 5);
      px(6, 7, DARK, 5, 3);
      px(6, 11, DARK, 4, 4);
      px(6, 2, '#ffcd75', 5, 1);
      px(10, 3, '#ffcd75', 2, 4);
      px(7, 7, '#ffcd75', 3, 2);
      px(7, 12, '#ffcd75', 2, 2);
    } else {
      px(5, 0, DARK, 6, 11);
      px(5, 11, DARK, 6, 5);
      px(6, 1, '#ff4d5e', 4, 9);
      px(6, 12, '#ff4d5e', 4, 3);
      px(6, 1, '#ffcd75', 1, 6);
    }
  }, 3 + kind);
}

interface Slab {
  mesh: THREE.Mesh;
  t: number;
}

/** Instanced pool helper: matrices for the first `n` instances, uploaded with `commit`. */
class Pool {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, readonly cap: number, parent: THREE.Object3D) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    parent.add(this.mesh);
  }
  begin(): void {
    this.n = 0;
  }
  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, q: THREE.Quaternion | null = null, rotY = 0): void {
    if (this.n >= this.cap) return;
    if (q) this.q.copy(q);
    else this.q.setFromAxisAngle(Y_AXIS, rotY);
    this.m.compose(this.v.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    this.mesh.setMatrixAt(this.n++, this.m);
  }
  end(): void {
    this.mesh.count = this.n;
    if (this.n) commit(this.mesh.instanceMatrix, this.n);
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class WorldEventView {
  private root = new THREE.Group();
  private ev: WorldEvent | null = null;
  private biomeKey = '';
  /** Per-event pieces (geometries disposed on change; materials kept). */
  private piece = new THREE.Group();
  private mats = new Map<string, RetroMaterial>();
  private texs = new Map<string, THREE.Texture>();
  // Holes and chasm.
  private openN = -1;
  private holes: THREE.Mesh[] = [];
  private cracks: { mesh: THREE.Mesh; glow: THREE.Mesh; fill: THREE.Mesh; from: number; to: number }[] = [];
  private slabs: Slab[] = [];
  private slabbed = new Set<string>();
  // Flood.
  private water: { mesh: THREE.Mesh; foam: THREE.Mesh; r: number }[] = [];
  // Colossus.
  private feet: THREE.Group[] = [];
  private shadow: THREE.Mesh | null = null;
  // Flower.
  private flower: { root: THREE.Group; petals: THREE.Object3D[]; bud: THREE.Mesh; ring: THREE.Mesh; disc: THREE.Mesh } | null = null;
  // Volcano.
  private bombs: Pool;
  private puddles: Pool;
  private volcano: THREE.Group | null = null;
  // Night Raid.
  private lampPosts: Pool;
  private lampHeads: Pool;
  private pools: Pool;
  private beams: Pool;
  private towers: Pool;
  private crates: Pool;
  private columns: Pool;
  private marks: Pool[];
  private all: Pool[];
  private time = 0;
  private fxT = 0;
  private bp = { x: 0, z: 0 };
  private tq = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.root.add(this.piece);
    const unlit = (c: string, k = 1) => createRetroMaterial({ color: c, unlit: k });
    this.bombs = new Pool(paint(new THREE.DodecahedronGeometry(0.6, 0), '#ff7a2f'), createRetroMaterial({ vertexColors: true, unlit: 0.9 }), 40, this.root);
    this.puddles = new Pool(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2).translate(0, 0.065, 0), createRetroMaterial({ map: biomeTex('lava'), unlit: 1, uvScroll: [0.03, 0.02] }), 40, this.root);
    this.lampPosts = new Pool(new THREE.BoxGeometry(0.22, 3, 0.22).translate(0, 1.5, 0), unlit('#333c57', 0), 40, this.root);
    this.lampHeads = new Pool(new THREE.BoxGeometry(0.6, 0.5, 0.6).translate(0, 3.1, 0), unlit('#ffcd75', 1), 40, this.root);
    const poolTex = pixelTex(32, (ctx, s) => {
      // A dithered pool of light: solid core, checkered rim (no soft gradients).
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const d = Math.hypot(x + 0.5 - s / 2, y + 0.5 - s / 2) / (s / 2);
          if (d > 1) continue;
          if (d > 0.72 && (x + y) % 2) continue;
          ctx.fillStyle = d > 0.72 ? 'rgba(255,205,117,0.26)' : 'rgba(255,224,160,0.3)';
          ctx.fillRect(x, y, 1, 1);
        }
    });
    const poolMat = createRetroMaterial({ map: poolTex, unlit: 1, transparent: true, alphaTest: 0.05 });
    poolMat.depthWrite = false;
    this.pools = new Pool(flat(2, 2, 0, 0, 0.045), poolMat, 48, this.root);
    const beamMat = createRetroMaterial({ map: poolTex, unlit: 1, transparent: true, alphaTest: 0.05, color: '#e8f4ff' });
    beamMat.depthWrite = false;
    this.beams = new Pool(flat(2, 2, 0, 0, 0.05), beamMat, 8, this.root);
    this.towers = new Pool(paint(new THREE.BoxGeometry(1.2, 5.5, 1.2).translate(0, 2.75, 0), '#566c86'), createRetroMaterial({ vertexColors: true }), 8, this.root);
    this.crates = new Pool(paint(new THREE.BoxGeometry(1.1, 0.8, 1.1).translate(0, 0.4, 0), '#29366f'), createRetroMaterial({ vertexColors: true, unlit: 0.3 }), 8, this.root);
    const colMat = createRetroMaterial({ color: '#73eff7', unlit: 1, transparent: true, map: pixelTex(4, (ctx) => {
      ctx.fillStyle = 'rgba(115,239,247,0.35)';
      ctx.fillRect(0, 0, 4, 4);
      ctx.fillStyle = 'rgba(244,244,244,0.5)';
      ctx.fillRect(1, 0, 1, 4);
    }) });
    colMat.depthWrite = false;
    this.columns = new Pool(new THREE.BoxGeometry(0.5, 14, 0.5).translate(0, 7, 0), colMat, 8, this.root);
    this.marks = ([0, 1, 2] as const).map((k) => {
      const m = createRetroMaterial({ map: markerTex(k), unlit: 1, transparent: true, alphaTest: 0.5 });
      m.depthTest = false;
      const p = new Pool(new THREE.PlaneGeometry(k === 0 ? 0.85 : 1, k === 0 ? 0.85 : 1), m, 96, this.root);
      p.mesh.renderOrder = 6;
      return p;
    });
    this.all = [this.bombs, this.puddles, this.lampPosts, this.lampHeads, this.pools, this.beams, this.towers, this.crates, this.columns, ...this.marks];
  }

  private mat(key: string, make: () => RetroMaterial): RetroMaterial {
    let m = this.mats.get(key);
    if (!m) this.mats.set(key, (m = make()));
    return m;
  }

  private tex(key: string, make: () => THREE.Texture): THREE.Texture {
    let t = this.texs.get(key);
    if (!t) this.texs.set(key, (t = make()));
    return t;
  }

  // ------------------------------------------------------------------ building

  private reset(): void {
    for (const o of [...this.piece.children]) {
      this.piece.remove(o);
      o.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
    }
    this.holes = [];
    this.cracks = [];
    this.slabs = [];
    this.slabbed.clear();
    this.water = [];
    this.feet = [];
    this.shadow = null;
    this.flower = null;
    this.volcano = null;
    this.openN = -1;
  }

  private build(g: Game, ev: WorldEvent): void {
    this.reset();
    const biome = biomeForStage(g.arenaStage);
    this.biomeKey = biome.id + (biome.variant ?? '');
    if (ev.kind === 'collapse' || ev.kind === 'split') this.buildCracks(ev);
    if (ev.kind === 'flood') this.buildFlood(ev);
    if (ev.kind === 'giant') this.buildGiant();
    if (ev.kind === 'flower') this.buildFlower(ev);
    if (ev.kind === 'volcano') this.buildVolcano(ev);
  }

  /** Jagged crack lines over each pending section (dark lines plus a glowing core). */
  private buildCracks(ev: WorldEvent): void {
    const rng = new Rng(ev.p.length * 977 + Math.round(ev.p[0] * 13));
    const dark: Record<number, THREE.BufferGeometry[]> = {};
    const glow: Record<number, THREE.BufferGeometry[]> = {};
    const fill: Record<number, THREE.BufferGeometry[]> = {};
    const line = (wave: number, x0: number, z0: number, x1: number, z1: number, w: number) => {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      const a = Math.atan2(dx, dz);
      const mk = (ww: number, y: number) => {
        const geo = new THREE.PlaneGeometry(ww, len);
        geo.rotateX(-Math.PI / 2);
        geo.rotateY(a);
        geo.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
        return geo;
      };
      (dark[wave] ??= []).push(mk(w, 0.05));
      (glow[wave] ??= []).push(mk(w * 0.4, 0.055));
    };
    const jag = (wave: number, x: number, z: number, ang: number, len: number, w: number) => {
      let px = x;
      let pz = z;
      const n = Math.max(2, Math.round(len / 1.1));
      for (let i = 0; i < n; i++) {
        ang += rng.range(-0.7, 0.7);
        const s = len / n;
        const nx = px + Math.sin(ang) * s;
        const nz = pz + Math.cos(ang) * s;
        line(wave, px, pz, nx, nz, w);
        px = nx;
        pz = nz;
      }
    };
    if (ev.kind === 'collapse') {
      const h = T.cell / 2;
      for (let i = 0; i + 2 < ev.p.length; i += 3) {
        const [x, z, w] = [ev.p[i], ev.p[i + 1], ev.p[i + 2]];
        (fill[w] ??= []).push(flat(T.cell, T.cell, x, z, 0.045, 0.5));
        // The outline of the section, then cracks running in from it.
        line(w, x - h, z - h, x + h, z - h, 0.22);
        line(w, x - h, z + h, x + h, z + h, 0.22);
        line(w, x - h, z - h, x - h, z + h, 0.22);
        line(w, x + h, z - h, x + h, z + h, 0.22);
        for (let k = 0; k < 4; k++) jag(w, x + rng.range(-h, h) * 0.8, z + rng.range(-h, h) * 0.8, rng.next() * Math.PI * 2, rng.range(2, 4.5), 0.16);
      }
    } else {
      // Split: a crack along the chasm's middle (near the team mostly matters, so the whole run is fine).
      const [axis, pos] = ev.p;
      const half = 55;
      for (const b of ev.boxes) (fill[0] ??= []).push(flat(b.box.maxX - b.box.minX, b.box.maxZ - b.box.minZ, (b.box.minX + b.box.maxX) / 2, (b.box.minZ + b.box.maxZ) / 2, 0.045, 0.5));
      for (let s = -half; s < half; s += 3) {
        const x0 = axis === 0 ? s : pos + rng.range(-0.6, 0.6);
        const z0 = axis === 0 ? pos + rng.range(-0.6, 0.6) : s;
        const x1 = axis === 0 ? s + 3 : pos + rng.range(-0.6, 0.6);
        const z1 = axis === 0 ? pos + rng.range(-0.6, 0.6) : s + 3;
        line(0, x0, z0, x1, z1, 0.3);
        if (rng.chance(0.4)) jag(0, (x0 + x1) / 2, (z0 + z1) / 2, rng.next() * Math.PI * 2, rng.range(1, 2.2), 0.14);
      }
    }
    const darkMat = this.mat('crackDark', () => createRetroMaterial({ color: DARK, unlit: 1 }));
    const glowMat = this.mat('crackGlow', () => createRetroMaterial({ color: '#ff7a2f', unlit: 1 }));
    const fillMat = this.mat('crackFill', () => {
      // Dithered red danger fill, like the boss strike zones but square.
      const m = createRetroMaterial({ unlit: 1, transparent: true, alphaTest: 0.05, map: this.tex('crackFill', () => pixelTex(4, (ctx) => {
        ctx.fillStyle = 'rgba(255,77,94,0.42)';
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) ctx.fillRect(x, y, 1, 1);
      })) });
      m.depthWrite = false;
      return m;
    });
    for (const k of Object.keys(dark)) {
      const w = Number(k);
      const a = new THREE.Mesh(mergeGeometries(dark[w]), darkMat);
      const b = new THREE.Mesh(mergeGeometries(glow[w]), glowMat);
      const f = new THREE.Mesh(mergeGeometries(fill[w] ?? [flat(0.01, 0.01, 0, -999, 0)]), fillMat);
      f.renderOrder = 1;
      dark[w].forEach((x) => x.dispose());
      glow[w].forEach((x) => x.dispose());
      fill[w]?.forEach((x) => x.dispose());
      a.visible = b.visible = f.visible = false;
      this.piece.add(a, b, f);
      const from = ev.kind === 'collapse' ? collapseCrackAt(w) : 0;
      const to = ev.kind === 'collapse' ? collapseFallAt(w) : T.splitWarn;
      this.cracks.push({ mesh: a, glow: b, fill: f, from, to });
    }
  }

  /** The pits for the boxes open now (rebuilt when that set changes). */
  private buildHoles(g: Game, ev: WorldEvent): void {
    for (const m of this.holes) {
      this.piece.remove(m);
      m.geometry.dispose();
    }
    this.holes = [];
    const open = ev.boxes.filter((b) => b.on).map((b) => b.box);
    if (!open.length) return;
    const biome = biomeForStage(g.arenaStage);
    const covered = (x: number, z: number) => open.some((b) => x > b.minX - 0.25 && x < b.maxX + 0.25 && z > b.minZ - 0.25 && z < b.maxZ + 0.25);
    const voidG: THREE.BufferGeometry[] = [];
    const cliffG: THREE.BufferGeometry[] = [];
    const lipG: THREE.BufferGeometry[] = [];
    const L = 0.22;
    for (const b of open) {
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      voidG.push(flat(w + 0.2, d + 0.2, cx, cz, 0.03, 0.12));
      // The far wall (up-screen edge) shows as a cliff face with a shadow under it; the side walls
      // as dark strips. Skipped where another hole continues.
      const band = Math.min(2.4, d * 0.42);
      if (!covered(cx, b.minZ - 0.5)) {
        cliffG.push(flat(w + 0.2, band, cx, b.minZ + band / 2, 0.04, 0.5));
        lipG.push(flat(w + 0.2, 0.7, cx, b.minZ + band + 0.35, 0.045));
        lipG.push(flat(w + 0.4, L, cx, b.minZ - L / 2 + 0.05, 0.055));
      }
      if (!covered(cx, b.maxZ + 0.5)) lipG.push(flat(w + 0.4, L, cx, b.maxZ + L / 2 - 0.05, 0.055));
      if (!covered(b.minX - 0.5, cz)) lipG.push(flat(L, d + 0.2, b.minX - L / 2 + 0.05, cz, 0.055), flat(0.45, d * 0.8, b.minX + 0.22, cz - d * 0.1, 0.05));
      if (!covered(b.maxX + 0.5, cz)) lipG.push(flat(L, d + 0.2, b.maxX + L / 2 - 0.05, cz, 0.055), flat(0.45, d * 0.8, b.maxX - 0.22, cz - d * 0.1, 0.05));
    }
    const lava = biome.sea.tex === 'lava';
    const voidCol = lava ? '#a04030' : biome.kind === 'neon' ? '#6a6a84' : biome.kind === 'sky' ? '#8090b0' : '#1e2236';
    const voidMat = this.mat(`void:${this.biomeKey}`, () => createRetroMaterial({ map: biomeTex(biome.sea.tex), unlit: lava ? 1 : 0.7, color: voidCol, uvScroll: biome.sea.scroll }));
    const cliffMat = this.mat(`cliff:${this.biomeKey}`, () => createRetroMaterial({ map: biomeTex(biome.rim), color: '#c8b8a8', unlit: 0.25 }));
    const lipMat = this.mat('lip', () => createRetroMaterial({ color: DARK, unlit: 1 }));
    for (const [gs, mat] of [[voidG, voidMat], [cliffG, cliffMat], [lipG, lipMat]] as const) {
      if (!gs.length) continue;
      const m = new THREE.Mesh(mergeGeometries(gs), mat);
      gs.forEach((x) => x.dispose());
      this.holes.push(m);
      this.piece.add(m);
    }
    // The split's bridges: planks with rope rails across each gap in the chasm.
    if (ev.kind === 'split') {
      const [axis, pos] = ev.p;
      const plankMat = this.mat('planks', () => createRetroMaterial({ map: biomeTex('planks') }));
      const ropeMat = this.mat('rope', () => createRetroMaterial({ color: '#a86a3c' }));
      const bw = T.bridgeWidth - 1;
      const span = T.chasmWidth + 1.2;
      const gs: THREE.BufferGeometry[] = [];
      const rs: THREE.BufferGeometry[] = [];
      for (const b of ev.p.slice(2, 5)) {
        const x = axis === 0 ? b : pos;
        const z = axis === 0 ? pos : b;
        gs.push(flat(axis === 0 ? bw : span, axis === 0 ? span : bw, x, z, 0.06, 0.5));
        for (const s of [-1, 1]) {
          const r = new THREE.BoxGeometry(axis === 0 ? 0.12 : span, 0.12, axis === 0 ? span : 0.12);
          r.translate(axis === 0 ? x + (s * bw) / 2 : x, 0.7, axis === 0 ? z : z + (s * bw) / 2);
          rs.push(r);
          for (const e of [-1, 1]) {
            const post = new THREE.BoxGeometry(0.2, 0.9, 0.2);
            post.translate(axis === 0 ? x + (s * bw) / 2 : x + (e * span) / 2, 0.45, axis === 0 ? z + (e * span) / 2 : z + (s * bw) / 2);
            rs.push(post);
          }
        }
      }
      const pm = new THREE.Mesh(mergeGeometries(gs), plankMat);
      const rm = new THREE.Mesh(mergeGeometries(rs), ropeMat);
      gs.forEach((x) => x.dispose());
      rs.forEach((x) => x.dispose());
      this.holes.push(pm, rm);
      this.piece.add(pm, rm);
    }
  }

  private buildFlood(ev: WorldEvent): void {
    const waterTex = this.tex('flood', () =>
      pixelTex(16, (ctx, s, rng) => {
        ctx.fillStyle = 'rgba(65,166,246,0.72)';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = 'rgba(115,239,247,0.8)';
        for (let i = 0; i < 6; i++) ctx.fillRect(rng.int(0, s - 4), rng.int(0, s - 1), rng.int(2, 4), 1);
        ctx.fillStyle = 'rgba(59,93,201,0.8)';
        for (let i = 0; i < 5; i++) ctx.fillRect(rng.int(0, s - 3), rng.int(0, s - 1), rng.int(1, 3), 1);
      }),
    );
    const mat = this.mat('flood', () => {
      const m = createRetroMaterial({ map: waterTex, unlit: 0.45, transparent: true, uvScroll: [0.04, 0.025] });
      m.depthWrite = false;
      return m;
    });
    const foamMat = this.mat('foam', () => createRetroMaterial({ color: '#f4f4f4', unlit: 0.7 }));
    for (let i = 0; i + 2 < ev.p.length; i += 3) {
      const geo = new THREE.CircleGeometry(1, 40);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(ev.p[i], 0.075, ev.p[i + 1]);
      mesh.renderOrder = 1;
      const foam = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 40).rotateX(-Math.PI / 2), foamMat);
      foam.position.set(ev.p[i], 0.08, ev.p[i + 1]);
      mesh.visible = foam.visible = false;
      this.piece.add(mesh, foam);
      this.water.push({ mesh, foam, r: ev.p[i + 2] });
    }
  }

  private buildGiant(): void {
    const stone = this.mat('giantStone', () => createRetroMaterial({ vertexColors: true }));
    for (let f = 0; f < 2; f++) {
      const g = new THREE.Group();
      const parts = [
        paint(new THREE.BoxGeometry(3.6, 1.5, 4.8).translate(0, 0.75, 0.3), '#6a7488'), // boot
        paint(new THREE.BoxGeometry(3.8, 0.35, 5).translate(0, 0.17, 0.3), '#333c57'), // sole
        paint(new THREE.BoxGeometry(1.1, 0.9, 1.1).translate(-1.15, 0.6, 2.75), '#94b0c2'), // toes
        paint(new THREE.BoxGeometry(1.1, 0.9, 1.1).translate(0, 0.65, 2.85), '#94b0c2'),
        paint(new THREE.BoxGeometry(1.1, 0.9, 1.1).translate(1.15, 0.6, 2.75), '#94b0c2'),
        paint(new THREE.BoxGeometry(2.6, 30, 2.6).translate(0, 16, -0.4), '#566c86'), // leg
        paint(new THREE.BoxGeometry(2.9, 1.2, 2.9).translate(0, 2.2, -0.4), '#ffcd75'), // ankle cuff
        paint(new THREE.BoxGeometry(2.7, 1.4, 2.7).translate(0, 6, -0.4), '#38b764'), // moss band
      ];
      const mesh = new THREE.Mesh(mergeGeometries(parts), stone);
      parts.forEach((p) => p.dispose());
      g.add(mesh);
      g.visible = false;
      this.piece.add(g);
      this.feet.push(g);
    }
    const shTex = this.tex('shadow', () =>
      pixelTex(32, (ctx, s) => {
        for (let y = 0; y < s; y++)
          for (let x = 0; x < s; x++) {
            const d = Math.hypot((x + 0.5 - s / 2) / (s / 2), (y + 0.5 - s / 2) / (s / 2));
            if (d > 1 || (d > 0.75 && (x + y) % 2)) continue;
            ctx.fillStyle = 'rgba(26,28,44,0.5)';
            ctx.fillRect(x, y, 1, 1);
          }
      }),
    );
    const shMat = this.mat('shadow', () => {
      const m = createRetroMaterial({ map: shTex, unlit: 1, transparent: true, alphaTest: 0.05 });
      m.depthWrite = false;
      return m;
    });
    this.shadow = new THREE.Mesh(flat(1, 1, 0, 0, 0), shMat);
    this.shadow.visible = false;
    this.piece.add(this.shadow);
  }

  private buildFlower(ev: WorldEvent): void {
    const root = new THREE.Group();
    root.position.set(ev.p[0], 0, ev.p[1]);
    const green = this.mat('stem', () => createRetroMaterial({ color: '#38b764' }));
    const petalMat = this.mat('petal', () => createRetroMaterial({ color: '#ff8fc8', unlit: 0.35 }));
    const centre = this.mat('pollen', () => createRetroMaterial({ color: '#ffcd75', unlit: 0.8 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 3, 6).translate(0, 1.5, 0), green);
    const leafA = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.7).translate(0.9, 0, 0), green);
    leafA.position.y = 0.9;
    leafA.rotation.z = 0.4;
    const leafB = leafA.clone();
    leafB.rotation.set(0, Math.PI, 0.4);
    leafB.position.y = 1.4;
    const head = new THREE.Group();
    head.position.y = 3;
    const bud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), petalMat);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 10), centre);
    const petals: THREE.Object3D[] = [];
    for (let k = 0; k < 8; k++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (k / 8) * Math.PI * 2;
      const pet = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 2).translate(0, 0, 1.2), petalMat);
      pivot.add(pet);
      head.add(pivot);
      petals.push(pet);
    }
    head.add(bud, disc);
    const ringMat = this.mat('healRing', () => createRetroMaterial({ color: '#a7f070', unlit: 1 }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(T.flowerR - 0.3, T.flowerR, 48).rotateX(-Math.PI / 2).translate(0, 0.06, 0), ringMat);
    const zoneMat = this.mat('healZone', () => {
      const m = createRetroMaterial({ map: this.tex('healZone', () => pixelTex(4, (ctx) => {
        ctx.fillStyle = 'rgba(167,240,112,0.35)';
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillRect(2, 2, 1, 1);
      })), unlit: 1, transparent: true });
      m.depthWrite = false;
      return m;
    });
    const zone = new THREE.Mesh(new THREE.CircleGeometry(T.flowerR, 40).rotateX(-Math.PI / 2).translate(0, 0.055, 0), zoneMat);
    const uv = zone.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * T.flowerR * 4, uv.getY(i) * T.flowerR * 4);
    root.add(stem, leafA, leafB, head, ring, zone);
    this.piece.add(root);
    this.flower = { root, petals, bud, ring, disc: zone };
  }

  private buildVolcano(ev: WorldEvent): void {
    const g = new THREE.Group();
    g.position.set(ev.p[0], 0, ev.p[1]);
    const rock = this.mat('volcano', () => createRetroMaterial({ vertexColors: true }));
    const cone = paint(new THREE.CylinderGeometry(2.5, 9, 9, 7).translate(0, 3, 0), '#3a2c2c');
    const crater = paint(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 7).translate(0, 7.6, 0), '#ff7a2f');
    g.add(new THREE.Mesh(mergeGeometries([cone, crater]), rock));
    cone.dispose();
    crater.dispose();
    this.piece.add(g);
    this.volcano = g;
  }

  // ------------------------------------------------------------------ per frame

  render(g: Game, ev: WorldEvent | null, dt: number): void {
    if (ev !== this.ev) {
      this.ev = ev;
      if (ev) this.build(g, ev);
      else this.reset();
    }
    this.time += dt;
    for (const p of this.all) p.begin();
    if (ev) {
      let open = 0;
      for (const b of ev.boxes) if (b.on) open++;
      if (open !== this.openN) {
        this.openN = open;
        this.buildHoles(g, ev);
      }
      this.renderCracks(g, ev, dt);
      if (ev.kind === 'flood') this.renderFlood(g, ev, dt);
      if (ev.kind === 'giant') this.renderGiant(g, ev);
      if (ev.kind === 'flower') this.renderFlower(g, ev, dt);
      if (ev.kind === 'volcano') this.renderVolcano(g, ev, dt);
      if (ev.kind === 'stealth' && ev.stealth) this.renderStealth(g, ev);
    }
    for (const p of this.all) p.end();
  }

  private renderCracks(g: Game, ev: WorldEvent, dt: number): void {
    const t = ev.t;
    for (const c of this.cracks) {
      const on = t >= c.from && t < c.to;
      c.mesh.visible = on;
      // The glow blinks faster as the drop nears.
      const k = on ? (t - c.from) / Math.max(0.1, c.to - c.from) : 0;
      c.glow.visible = on && Math.sin(this.time * (6 + k * 22)) > -0.2;
      c.fill.visible = on && (k < 0.5 || c.glow.visible);
    }
    // Slabs: each newly opened section shrinks away into the dark.
    const biome = biomeForStage(g.arenaStage);
    for (const b of ev.boxes) {
      if (!b.on || this.slabbed.has(b.key)) continue;
      this.slabbed.add(b.key);
      if (t - b.at > 1) continue; // opened long ago (a client joining late)
      const w = b.box.maxX - b.box.minX;
      const d = b.box.maxZ - b.box.minZ;
      const geo = flat(w, d, 0, 0, 0, 0.5);
      const mat = createRetroMaterial({ map: this.tex(`ground:${this.biomeKey}`, () => biomeTex(biome.ground)), color: biome.groundTint ?? '#ffffff' });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((b.box.minX + b.box.maxX) / 2, 0.06, (b.box.minZ + b.box.maxZ) / 2);
      this.piece.add(mesh);
      this.slabs.push({ mesh, t: 0 });
    }
    for (let i = this.slabs.length - 1; i >= 0; i--) {
      const s = this.slabs[i];
      s.t += dt;
      const k = Math.min(1, s.t / 0.9);
      const sc = 1 - 0.75 * k * k;
      s.mesh.scale.set(sc, 1, sc);
      s.mesh.rotation.y = k * 0.5;
      (s.mesh.material as RetroMaterial).uniforms.uColor.value.setScalar(1 - k * 0.85);
      if (k >= 1) {
        this.piece.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.slabs.splice(i, 1);
      }
    }
  }

  private renderFlood(g: Game, ev: WorldEvent, dt: number): void {
    const lv = floodLevel(ev.t);
    for (const w of this.water) {
      const r = Math.max(0.01, w.r * lv);
      w.mesh.visible = w.foam.visible = lv > 0.01;
      if (!w.mesh.visible) continue;
      w.mesh.scale.set(r, 1, r);
      w.foam.scale.set(r, 1, r);
      // World-space UVs so the ripples don't stretch as the water grows.
      const uv = w.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
      const pos = w.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) * r * 0.25, pos.getZ(i) * r * 0.25);
      uv.needsUpdate = true;
    }
    // Local cosmetic splashes where heroes wade.
    if ((this.fxT -= dt) <= 0 && lv > 0.2) {
      this.fxT = 0.18;
      for (const h of g.heroes) {
        const p = h.player;
        if (h.left || p.dead || p.speed < 1.5) continue;
        if (!this.water.some((w) => Math.hypot(p.x - w.mesh.position.x, p.z - w.mesh.position.z) < w.r * lv)) continue;
        g.particles.burst(p.x, 0.15, p.z, { count: 3, color: '#73eff7', color2: '#f4f4f4', speed: [1, 2.5], size: [0.1, 0.2], life: [0.2, 0.4], up: 3, gravity: 10 });
        g.fx.ring(p.x, p.z, 0.4, 3, '#73eff7', 0.4);
      }
    }
  }

  private renderGiant(g: Game, ev: WorldEvent): void {
    const t = ev.t;
    const cam = g.cam.camera.position;
    const yaw = Math.atan2(ev.p[2], ev.p[3]);
    const pa = this.bp;
    let midX = 0;
    let midZ = 0;
    for (let f = 0; f < 2; f++) {
      const foot = this.feet[f];
      // This foot's last planted step and its next one.
      let k = f;
      while (k + 2 < T.giantSteps && giantStepTime(k + 2) <= t) k += 2;
      const land = giantStepTime(k);
      giantStep(ev.p, k, pa);
      let x = pa.x;
      let z = pa.z;
      let y = 0;
      if (t < land) {
        // Coming down for its first step.
        const u = Math.max(0, 1 - (land - t) / (T.giantStepT * 1.6));
        y = 40 * (1 - u * u);
      } else if (k + 2 < T.giantSteps) {
        const next = giantStepTime(k + 2);
        const lift = next - T.giantStepT * 1.25;
        if (t > lift) {
          const u = (t - lift) / (next - lift);
          const nx = pa.x;
          const nz = pa.z;
          giantStep(ev.p, k + 2, pa);
          x = nx + (pa.x - nx) * u;
          z = nz + (pa.z - nz) * u;
          y = 26 * Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.6;
        }
      } else if (t > land + T.giantStepT * 1.5) y = 40 * Math.min(1, (t - land - T.giantStepT * 1.5) / 2); // walks off
      foot.visible = y < 39;
      foot.position.set(x, y, z);
      foot.rotation.y = yaw;
      // Never let a leg fill the camera.
      foot.visible &&= Math.hypot(cam.x - x, cam.z - z) > 3;
      midX += x / 2;
      midZ += z / 2;
    }
    const sh = this.shadow!;
    sh.visible = t < giantStepTime(T.giantSteps - 1) + 2;
    sh.position.set(midX - ev.p[3] * 4, 0.05, midZ + ev.p[2] * 4);
    sh.rotation.y = yaw;
    sh.scale.set(12, 1, 18);
  }

  private renderFlower(g: Game, ev: WorldEvent, dt: number): void {
    const f = this.flower!;
    const ph = flowerPhase(ev.t);
    const grow = ph.grow * ph.grow * (3 - 2 * ph.grow);
    f.root.scale.setScalar(Math.max(0.01, grow * (1 - ph.wilt * 0.3)));
    // Petals open on bloom (up and closed -> flat and open), droop as it wilts.
    const open = ph.bloom ? Math.min(1, (ev.t - T.flowerGrow) / 0.8) : ph.wilt > 0 ? 1 : 0;
    const ang = (1 - open) * 1.35 - ph.wilt * 0.9 + (ph.bloom ? Math.sin(this.time * 2) * 0.06 : 0);
    for (const p of f.petals) p.rotation.x = -ang;
    f.bud.visible = open < 0.3;
    f.ring.visible = f.disc.visible = ph.bloom;
    f.ring.scale.setScalar(1 + Math.sin(this.time * 4) * 0.03);
    f.root.visible = ev.t < T.flowerGrow + T.flowerBloom + T.flowerWilt;
    if (ph.bloom && (this.fxT -= dt) <= 0) {
      this.fxT = 0.25;
      const a = this.time * 3.7;
      g.particles.burst(f.root.position.x + Math.cos(a) * T.flowerR * 0.7, 0.4, f.root.position.z + Math.sin(a) * T.flowerR * 0.7, { count: 2, color: '#a7f070', color2: '#ffcd75', speed: [0.3, 1], size: [0.12, 0.22], life: [0.6, 1], up: 2.5, gravity: -1, drag: 1 });
    }
  }

  private renderVolcano(g: Game, ev: WorldEvent, dt: number): void {
    const [vx, vz] = ev.p;
    for (const b of ev.bombs) {
      // Arc in from the volcano's side: high and far at launch, down onto the target.
      const u = Math.min(1, Math.max(0, 1 - b.t / b.flight));
      const dx = vx - b.x;
      const dz = vz - b.z;
      const d = Math.hypot(dx, dz) || 1;
      const back = 18 * (1 - u);
      const x = b.x + (dx / d) * back;
      const z = b.z + (dz / d) * back;
      const y = 16 * (1 - u) + 7 * 4 * u * (1 - u);
      this.bombs.add(x, y + 0.4, z, 1, 1, 1, null, this.time * 4 + b.x);
      if ((this.fxT -= dt * 0.25) <= 0) {
        this.fxT = 0.05;
        g.particles.burst(x, y + 0.4, z, { count: 1, color: '#ffcd75', color2: '#ff7a2f', speed: [0.2, 0.8], size: [0.18, 0.3], life: [0.2, 0.35], drag: 2 });
      }
    }
    for (const q of ev.puddles) {
      const s = T.puddleR * Math.min(1, q.life / 0.6, (T.puddleLife - q.life) / 0.25 + 0.3);
      this.puddles.add(q.x, 0, q.z, s, 1, s);
    }
    if (this.volcano && ev.t < T.volcanoWarn + T.volcanoLen && Math.random() < dt * 6) {
      g.particles.burst(vx + (Math.random() - 0.5) * 3, 8, vz + (Math.random() - 0.5) * 3, { count: 2, color: '#3a3d5c', color2: '#ff7a2f', speed: [1, 3], size: [0.6, 1.1], life: [1, 1.8], up: 6, drag: 1, gravity: -2 });
    }
  }

  private renderStealth(g: Game, ev: WorldEvent): void {
    const st = ev.stealth!;
    const L = st.layout;
    for (const l of L.lamps) {
      this.lampPosts.add(l.x, 0, l.z, 1, 1, 1);
      this.lampHeads.add(l.x, 0, l.z, 1, 1, 1);
      this.pools.add(l.x, 0, l.z, l.r, 1, l.r);
    }
    for (const s of L.search) {
      this.towers.add(s.x, 0, s.z, 1, 1, 1);
      searchBeam(s, ev.t, this.bp);
      this.beams.add(this.bp.x, 0, this.bp.z, T.searchR, 1, T.searchR);
    }
    L.caches.forEach((c, i) => {
      if (st.got & (1 << i)) return;
      const bob = Math.sin(this.time * 3 + i) * 0.05;
      this.crates.add(c.x, bob, c.z, 1, 1, 1, null, this.time * 0.5 + i);
      this.columns.add(c.x, 0, c.z, 1, 1, 1);
    });
    if (!st.active) return;
    // Markers over enemies near this machine's hero: closed eye (unaware), ? (suspicious), ! (hunting).
    const me = g.hero.player;
    const q = this.tq.copy(g.cam.camera.quaternion);
    const mark = (e: { x: number; z: number; radius: number; def: { hidden?: boolean } }, s: 0 | 1 | 2) => {
      const d = Math.abs(e.x - me.x) + Math.abs(e.z - me.z);
      if (e.def.hidden || d > (s === 0 ? 14 : 30)) return;
      const bounce = s === 2 ? Math.abs(Math.sin(this.time * 9)) * 0.25 : 0;
      this.marks[s].add(e.x, 1.6 + e.radius * 1.4 + bounce, e.z, 1, 1, 1, q);
    };
    if (g.role === 'client') {
      for (const [uid, e] of g.netEnemies) if (e.active) mark(e, awareOf(g, st, e, uid));
    } else for (const e of g.enemies.list) if (e.alive) mark(e, awareOf(g, st, e));
  }

  /** Light sources for the look pass (LightPicker): lamps, beams, lava, the flower, caches. */
  addLights(pk: LightPicker, night: number): void {
    const ev = this.ev;
    if (!ev) return;
    if (ev.kind === 'stealth' && ev.stealth) {
      const L = ev.stealth.layout;
      for (const l of L.lamps) pk.add(l.x, 3, l.z, l.r + 1.5, 1, 0.82, 0.5, 0.75 + 0.4 * night, 2);
      for (const s of L.search) {
        searchBeam(s, ev.t, this.bp);
        pk.add(this.bp.x, 4, this.bp.z, T.searchR + 2, 0.85, 0.92, 1, 1.1, 3);
      }
      L.caches.forEach((c, i) => {
        if (!(ev.stealth!.got & (1 << i))) pk.add(c.x, 1.5, c.z, 3, 0.45, 0.94, 0.97, 0.6, 1);
      });
    } else if (ev.kind === 'volcano') {
      for (const q of ev.puddles) pk.add(q.x, 0.6, q.z, 3, 1, 0.45, 0.15, 0.6, 1);
      for (const b of ev.bombs) pk.add(b.x, 1, b.z, 3.5 * Math.min(1, 1.2 - b.t / b.flight), 1, 0.5, 0.15, 0.5, 2);
    } else if (ev.kind === 'flower' && flowerPhase(ev.t).bloom && this.flower) {
      const p = this.flower.root.position;
      pk.add(p.x, 2, p.z, T.flowerR + 2, 0.75, 1, 0.55, 0.55 + 0.3 * night, 2);
    } else if ((ev.kind === 'collapse' || ev.kind === 'split') && this.cracks.some((c) => c.glow.visible)) {
      // Glowing cracks light the ground a little.
      if (ev.kind === 'collapse') {
        for (let i = 0; i + 2 < ev.p.length; i += 3) {
          const w = ev.p[i + 2];
          if (ev.t >= collapseCrackAt(w) && ev.t < collapseFallAt(w)) pk.add(ev.p[i], 0.5, ev.p[i + 1], 4, 1, 0.45, 0.15, 0.35, 1);
        }
      }
    }
  }
}
