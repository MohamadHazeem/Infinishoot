import { noiseFor, type NoiseGovernor } from './noiseGovernor';
import * as THREE from 'three';
import { commit } from './instancing';
import { createRetroMaterial } from './retroMaterial';
import { textures } from './textures';

/**
 * Destruction physics (graphics lane): broken props split into real chunks
 * that fly out from the hit, tumble, bounce on the ground, slide to a stop,
 * tip onto a flat face and pile up on each other, lie there for a while,
 * then sink away. Pieces are cut from the prop's own box (a jittered grid,
 * `fracture`), so a crate breaks into crate-sized planks and a pillar into
 * drums along its length.
 *
 * Two pooled InstancedMeshes (plain chunks with instance colours, and crate
 * chunks with the crate texture), each a ring buffer: when full the oldest
 * piece is reused. Cosmetic and local: every machine breaks its own props
 * from break events it already gets (systems/graphics.ts), nothing is sent.
 */
export const shatterTuning = {
  /** Pool size per mesh (HIGH); LOW uses `lowScale` of the pieces. */
  max: 260,
  lowScale: 0.5,
  gravity: 24,
  /** Bounce: vertical speed kept, sideways speed kept, spin kept. */
  bounce: 0.35,
  slide: 0.65,
  spinKeep: 0.6,
  /** Ground friction (per second, exponential) while sliding. */
  friction: 5,
  /** Below this speed (m/s) a grounded chunk settles. */
  rest: 0.35,
  /** Seconds a settled chunk lies there (plus random extra) before it sinks for `sink` seconds. */
  life: 7,
  lifeRand: 3,
  sink: 1.2,
  /** Pile grid cell (m): settled chunks raise the floor of their cell so later chunks land on top. */
  pileCell: 0.55,
  /** How high a pile can get (m). */
  pileMax: 1.4,
  /** Launch: outward speed per unit of power, extra upward speed. */
  speed: 5.5,
  up: 5,
};

/** Longest side of a piece (m). */
export const maxPiece = 1.15;

/** One piece cut from a box: centre offset and size, in the box's local frame. */
export interface Piece {
  ox: number;
  oy: number;
  oz: number;
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Cut a w x h x d box (centred on x/z, standing on y = 0) into about `n` pieces:
 * a grid with as many cells along each side as its length calls for, each cell
 * jittered in size so the pieces don't look machine-cut. Pure (tests).
 */
export function fracture(w: number, h: number, d: number, n: number, rand: () => number = Math.random): Piece[] {
  const vol = Math.max(1e-4, w * h * d);
  const k = Math.cbrt(Math.max(1, n) / vol);
  // No piece longer than `maxPiece` (big slabs read as unbroken props, and outlines treat 1.3x+ instances as elites).
  const nx = Math.max(1, Math.round(w * k), Math.ceil(w / maxPiece));
  const ny = Math.max(1, Math.round(h * k), Math.ceil(h / maxPiece));
  const nz = Math.max(1, Math.round(d * k), Math.ceil(d / maxPiece));
  const out: Piece[] = [];
  const cw = w / nx;
  const ch = h / ny;
  const cd = d / nz;
  for (let ix = 0; ix < nx; ix++)
    for (let iy = 0; iy < ny; iy++)
      for (let iz = 0; iz < nz; iz++) {
        const j = () => 0.72 + rand() * 0.26;
        out.push({
          ox: -w / 2 + cw * (ix + 0.5) + (rand() - 0.5) * cw * 0.15,
          oy: ch * (iy + 0.5),
          oz: -d / 2 + cd * (iz + 0.5) + (rand() - 0.5) * cd * 0.15,
          sx: cw * j(),
          sy: ch * j(),
          sz: cd * j(),
        });
      }
  return out;
}

/** State of one chunk for `stepChunk` (mutated in place). */
export interface ChunkState {
  y: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  /** Floor under the chunk's centre (ground or pile top) plus its half height. */
  floor: number;
}

/**
 * One physics step for a chunk: gravity, bounce on the floor with friction
 * and spin loss, then sliding friction. Returns true once it is at rest. Pure.
 */
export function stepChunk(s: ChunkState, dt: number): boolean {
  const t = shatterTuning;
  s.vy -= t.gravity * dt;
  s.y += s.vy * dt;
  if (s.y > s.floor) return false;
  s.y = s.floor;
  if (s.vy < -2) {
    s.vy = -s.vy * t.bounce;
    s.vx *= t.slide;
    s.vz *= t.slide;
    s.spin *= t.spinKeep;
    return false;
  }
  s.vy = 0;
  const f = Math.exp(-t.friction * dt);
  s.vx *= f;
  s.vz *= f;
  s.spin *= f;
  return Math.abs(s.vx) + Math.abs(s.vz) < t.rest && Math.abs(s.spin) < 2;
}

/** Settled-chunk pile heights on a coarse grid. Pure (tests). */
export class PileMap {
  private h = new Map<number, number>();
  constructor(private cell = shatterTuning.pileCell) {}
  private key(x: number, z: number): number {
    return (Math.floor(x / this.cell) + 4096) * 8192 + (Math.floor(z / this.cell) + 4096);
  }
  height(x: number, z: number): number {
    return this.h.get(this.key(x, z)) ?? 0;
  }
  /** A chunk of height `size` came to rest at (x, z) on a floor of `base`: the pile grows to its top. */
  add(x: number, z: number, base: number, size: number): void {
    const k = this.key(x, z);
    this.h.set(k, Math.min(shatterTuning.pileMax, Math.max(this.h.get(k) ?? 0, base + size * 0.85)));
  }
  /** A chunk sank away: lower its cell. */
  remove(x: number, z: number, size: number): void {
    const k = this.key(x, z);
    const v = (this.h.get(k) ?? 0) - size * 0.85;
    if (v <= 0.01) this.h.delete(k);
    else this.h.set(k, v);
  }
  clear(): void {
    this.h.clear();
  }
  get size(): number {
    return this.h.size;
  }
}

export interface ShatterSpec {
  /** Box centre on the ground, its size and yaw. */
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
  yaw?: number;
  /** Lifts the box off the ground (stacked crates, hovering things). */
  y0?: number;
  /** Two colours pieces pick between (shaded a little each). */
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  /** Use the crate texture (planks). */
  crate?: boolean;
  /** About how many pieces. */
  pieces: number;
  /** Where the blow came from (pieces fly away from it); defaults to below the centre. */
  fromX?: number;
  fromZ?: number;
  /** Launch strength (1 = a solid hit, 2+ = an explosion). */
  power?: number;
}

class Pool {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  next = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly sz: Float32Array;
  readonly rx: Float32Array;
  readonly ry: Float32Array;
  readonly rz: Float32Array;
  readonly spin: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  /** 0 flying, 1 settled (counted in the pile), 2 gone. */
  readonly state: Uint8Array;

  constructor(scene: THREE.Scene, max: number, mat: THREE.Material) {
    const f = () => new Float32Array(max);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.sx = f();
    this.sy = f();
    this.sz = f();
    this.rx = f();
    this.ry = f();
    this.rz = f();
    this.spin = f();
    this.age = f();
    this.life = f();
    this.state = new Uint8Array(max).fill(2);
    // A unit box with one chipped corner reads as a broken piece rather than a clean cube.
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0 && pos.getY(i) > 0 && pos.getZ(i) > 0) pos.setXYZ(i, 0.2, 0.2, 0.2);
    geo.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.setColorAt(0, new THREE.Color('#ffffff'));
    // Outlined like enemies and barrels (src/render/outlines.ts picks meshes with this attribute).
    this.mesh.geometry.setAttribute('instanceFlash', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
}

export class Shatter {
  private plain: Pool;
  private crate: Pool;
  readonly pile = new PileMap();
  /** Piece count multiplier (quality). */
  density = 1;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();
  private c = new THREE.Color();
  private st: ChunkState = { y: 0, vx: 0, vy: 0, vz: 0, spin: 0, floor: 0 };

  private noise: NoiseGovernor;

  constructor(scene: THREE.Scene) {
    this.noise = noiseFor(scene);
    const max = shatterTuning.max;
    this.plain = new Pool(scene, max, createRetroMaterial({ instanceFlash: true }));
    this.crate = new Pool(scene, Math.round(max / 2), createRetroMaterial({ map: textures.crate(), instanceFlash: true }));
  }

  /** Live pieces (tests and the debug panel). */
  get live(): number {
    let n = 0;
    for (const p of [this.plain, this.crate]) for (let i = 0; i < p.n; i++) if (p.state[i] !== 2) n++;
    return n;
  }

  clear(): void {
    for (const p of [this.plain, this.crate]) {
      p.n = p.next = 0;
      p.state.fill(2);
      p.mesh.count = 0;
    }
    this.pile.clear();
  }

  /** Break a box into flying chunks. */
  burst(o: ShatterSpec, rand: () => number = Math.random): void {
    if (this.density <= 0) return;
    const T = shatterTuning;
    const pool = o.crate ? this.crate : this.plain;
    const n = Math.max(2, Math.round(o.pieces * this.density));
    let pieces = fracture(o.w, o.h, o.d, n, rand);
    // The grid can't go coarser than the piece cap: keep a random share when fewer are wanted (LOW quality).
    if (pieces.length > n * 1.25) pieces = pieces.filter(() => rand() < n / pieces.length);
    const yaw = o.yaw ?? 0;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const power = o.power ?? 1;
    const fx = o.fromX ?? o.x;
    const fz = o.fromZ ?? o.z;
    this.c1.set(o.color);
    this.c2.set(o.color2 ?? o.color);
    const max = pool.state.length;
    const allowed = this.noise.take('debris', pieces.length);
    let emitted = 0;
    for (const p of pieces) {
      if (emitted++ >= allowed) break;
      const i = pool.next;
      pool.next = (pool.next + 1) % max;
      pool.n = Math.min(max, pool.n + 1);
      if (pool.state[i] === 1) this.pile.remove(pool.x[i], pool.z[i], pool.sy[i]);
      // Rotate the piece offset by the prop's yaw (three.js Y rotation: x' = x cos + z sin, z' = -x sin + z cos).
      const wx = o.x + p.ox * cy + p.oz * sy;
      const wz = o.z - p.ox * sy + p.oz * cy;
      pool.x[i] = wx;
      pool.y[i] = (o.y0 ?? 0) + p.oy;
      pool.z[i] = wz;
      // Away from the blow, plus a spread around the box centre.
      let dx = wx - fx;
      let dz = wz - fz;
      const dl = Math.hypot(dx, dz);
      if (dl < 0.05) {
        const a = rand() * Math.PI * 2;
        dx = Math.cos(a);
        dz = Math.sin(a);
      } else {
        dx /= dl;
        dz /= dl;
      }
      const ox = p.ox * cy + p.oz * sy;
      const oz = -p.ox * sy + p.oz * cy;
      const sp = T.speed * power * (0.45 + rand() * 0.75);
      pool.vx[i] = dx * sp + ox * 2.2 + (rand() - 0.5) * 1.5;
      pool.vz[i] = dz * sp + oz * 2.2 + (rand() - 0.5) * 1.5;
      pool.vy[i] = T.up * (0.4 + rand() * 0.8) * Math.min(2, 0.6 + power * 0.5) + p.oy * 1.5;
      pool.sx[i] = p.sx;
      pool.sy[i] = p.sy;
      pool.sz[i] = p.sz;
      pool.rx[i] = (rand() - 0.5) * 0.4;
      pool.ry[i] = yaw + (rand() - 0.5) * 0.4;
      pool.rz[i] = (rand() - 0.5) * 0.4;
      pool.spin[i] = (rand() - 0.5) * 16 * Math.min(1.6, power);
      pool.age[i] = 0;
      pool.life[i] = T.life + rand() * T.lifeRand;
      pool.state[i] = 0;
      const shade = 0.82 + rand() * 0.3;
      pool.mesh.setColorAt(i, this.c.copy(rand() < 0.5 ? this.c1 : this.c2).multiplyScalar(shade));
    }
    if (pool.mesh.instanceColor) commit(pool.mesh.instanceColor, pool.n);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const T = shatterTuning;
    const st = this.st;
    for (const pool of [this.plain, this.crate]) {
      for (let i = 0; i < pool.n; i++) {
        const s = pool.state[i];
        if (s === 2) continue;
        pool.age[i] += dt;
        if (s === 1) {
          // Lying in the pile: sink away at the end of its life.
          if (pool.age[i] > pool.life[i] + T.sink) {
            pool.state[i] = 2;
            this.pile.remove(pool.x[i], pool.z[i], pool.sy[i]);
          }
          continue;
        }
        const half = pool.sy[i] * 0.5;
        st.y = pool.y[i];
        st.vx = pool.vx[i];
        st.vy = pool.vy[i];
        st.vz = pool.vz[i];
        st.spin = pool.spin[i];
        st.floor = this.pile.height(pool.x[i], pool.z[i]) + half;
        const rest = stepChunk(st, dt);
        pool.x[i] += st.vx * dt;
        pool.z[i] += st.vz * dt;
        pool.y[i] = st.y;
        pool.vx[i] = st.vx;
        pool.vy[i] = st.vy;
        pool.vz[i] = st.vz;
        pool.spin[i] = st.spin;
        pool.rx[i] += st.spin * dt;
        pool.rz[i] += st.spin * 0.7 * dt;
        pool.ry[i] += st.spin * 0.25 * dt;
        const grounded = st.y <= st.floor + 1e-3;
        if (grounded) {
          // Tip over onto the nearest flat face as it slows.
          const k = Math.min(1, dt * 9);
          const q = Math.PI / 2;
          pool.rx[i] += (Math.round(pool.rx[i] / q) * q - pool.rx[i]) * k;
          pool.rz[i] += (Math.round(pool.rz[i] / q) * q - pool.rz[i]) * k;
        }
        if (rest || pool.age[i] > 6) {
          pool.state[i] = 1;
          pool.age[i] = Math.min(pool.age[i], 1);
          this.pile.add(pool.x[i], pool.z[i], st.floor - half, pool.sy[i]);
        }
      }
    }
  }

  render(): void {
    const T = shatterTuning;
    for (const pool of [this.plain, this.crate]) {
      let top = 0;
      for (let i = 0; i < pool.n; i++) {
        if (pool.state[i] === 2) {
          this.m4.makeScale(0, 0, 0);
          pool.mesh.setMatrixAt(i, this.m4);
          continue;
        }
        top = i + 1;
        const over = pool.state[i] === 1 ? pool.age[i] - pool.life[i] : 0;
        const k = over > 0 ? Math.max(0, 1 - over / T.sink) : 1;
        this.e.set(pool.rx[i], pool.ry[i], pool.rz[i], 'YXZ');
        this.q.setFromEuler(this.e);
        const y = pool.y[i] - (1 - k) * pool.sy[i] * 1.2;
        const sc = 0.4 + 0.6 * k;
        this.m4.compose(this.v.set(pool.x[i], y, pool.z[i]), this.q, this.s.set(pool.sx[i] * sc, pool.sy[i] * sc, pool.sz[i] * sc));
        pool.mesh.setMatrixAt(i, this.m4);
      }
      pool.mesh.count = top;
      commit(pool.mesh.instanceMatrix, top);
    }
  }
}
