import * as THREE from 'three';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';

/**
 * Chunky debris: pieces thrown by deaths and broken things that tumble,
 * bounce on the ground, settle, then sink away. One pooled InstancedMesh
 * (a ring buffer: when it is full the oldest piece is reused). No wall
 * collisions; cosmetic and local.
 */
export const debrisTuning = {
  max: 300,
  gravity: 26,
  /** Bounce: vertical speed kept, sideways speed kept, spin kept. */
  bounce: 0.42,
  bounceSlide: 0.6,
  bounceSpin: 0.55,
  /** Ground friction once resting (per second, exponential). */
  friction: 7,
  /** Seconds a piece stays before it starts sinking, plus random extra. */
  life: 2.6,
  lifeRand: 1.4,
  sink: 0.6,
};

/** One debris step on the ground plane: returns true while still bouncing. Pure, for tests. */
export function stepDebris(s: { y: number; vx: number; vy: number; vz: number; h: number; spin: number }, dt: number): boolean {
  const t = debrisTuning;
  s.vy -= t.gravity * dt;
  s.y += s.vy * dt;
  if (s.y <= s.h) {
    s.y = s.h;
    if (s.vy < -2) {
      s.vy = -s.vy * t.bounce;
      s.vx *= t.bounceSlide;
      s.vz *= t.bounceSlide;
      s.spin *= t.bounceSpin;
    } else {
      s.vy = 0;
      const f = Math.exp(-t.friction * dt);
      s.vx *= f;
      s.vz *= f;
      s.spin *= f;
    }
  }
  return s.y > s.h || Math.abs(s.vx) + Math.abs(s.vz) > 0.05;
}

export class Debris {
  private mesh: THREE.InstancedMesh;
  private n = 0;
  private next = 0;
  private x: Float32Array;
  private y: Float32Array;
  private z: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private sx: Float32Array;
  private sy: Float32Array;
  private sz: Float32Array;
  private rx: Float32Array;
  private ry: Float32Array;
  private spin: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();
  private c = new THREE.Color();
  private st = { y: 0, vx: 0, vy: 0, vz: 0, h: 0, spin: 0 };

  constructor(scene: THREE.Scene) {
    const max = debrisTuning.max;
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
    this.spin = f();
    this.age = f();
    this.life = f();
    // A chipped chunk: a box with one bevelled corner reads as a broken piece, not a cube.
    const geo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 0 && pos.getY(i) > 0 && pos.getZ(i) > 0) pos.setXYZ(i, 0.15, 0.15, 0.15);
    geo.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(geo, createRetroMaterial({ unlit: 0.25 }), max);
    this.mesh.setColorAt(0, this.c.set('#ffffff'));
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  spawn(x: number, y: number, z: number, count: number, color: THREE.ColorRepresentation, color2: THREE.ColorRepresentation, size: number, speed: number, rand = Math.random): void {
    const max = debrisTuning.max;
    this.c1.set(color);
    this.c2.set(color2);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % max;
      this.n = Math.min(max, this.n + 1);
      const a = rand() * Math.PI * 2;
      const sp = speed * (0.35 + rand() * 0.65);
      const s = size * (0.6 + rand() * 0.6);
      this.x[i] = x + Math.cos(a) * 0.2;
      this.y[i] = y;
      this.z[i] = z + Math.sin(a) * 0.2;
      this.vx[i] = Math.cos(a) * sp;
      this.vz[i] = Math.sin(a) * sp;
      this.vy[i] = 4 + rand() * 6;
      this.sx[i] = s * (0.7 + rand() * 0.6);
      this.sy[i] = s * (0.45 + rand() * 0.4);
      this.sz[i] = s * (0.7 + rand() * 0.6);
      this.rx[i] = rand() * Math.PI * 2;
      this.ry[i] = rand() * Math.PI * 2;
      this.spin[i] = (rand() - 0.5) * 24;
      this.age[i] = 0;
      this.life[i] = debrisTuning.life + rand() * debrisTuning.lifeRand;
      this.mesh.setColorAt(i, this.c.copy(this.c1).lerp(this.c2, rand() < 0.5 ? 0 : 1).multiplyScalar(0.85 + rand() * 0.25));
    }
    if (this.mesh.instanceColor) commit(this.mesh.instanceColor, this.n);
  }

  clear(): void {
    this.n = this.next = 0;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    const st = this.st;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i] + debrisTuning.sink) continue;
      this.age[i] += dt;
      st.y = this.y[i];
      st.vx = this.vx[i];
      st.vy = this.vy[i];
      st.vz = this.vz[i];
      st.h = this.sy[i] * 0.5;
      st.spin = this.spin[i];
      const moving = stepDebris(st, dt);
      this.x[i] += st.vx * dt;
      this.z[i] += st.vz * dt;
      this.y[i] = st.y;
      this.vx[i] = st.vx;
      this.vy[i] = st.vy;
      this.vz[i] = st.vz;
      this.spin[i] = st.spin;
      this.rx[i] += st.spin * dt;
      this.ry[i] += st.spin * 0.6 * dt;
      // Once it slows down on the ground, tip over onto a flat face.
      if (!moving || (st.y <= st.h && Math.abs(st.spin) < 3)) {
        const flat = Math.round(this.rx[i] / (Math.PI / 2)) * (Math.PI / 2);
        this.rx[i] += (flat - this.rx[i]) * Math.min(1, dt * 10);
      }
    }
  }

  render(): void {
    const t = debrisTuning;
    for (let i = 0; i < this.n; i++) {
      const over = this.age[i] - this.life[i];
      if (over >= t.sink) {
        this.m4.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m4);
        continue;
      }
      // Resting pieces lie flat-ish; tumbling ones spin freely. Then they sink and shrink away.
      const k = over > 0 ? 1 - over / t.sink : 1;
      this.e.set(this.rx[i], this.ry[i], 0, 'YXZ');
      this.q.setFromEuler(this.e);
      const y = this.y[i] - (1 - k) * this.sy[i];
      this.m4.compose(this.v.set(this.x[i], y, this.z[i]), this.q, this.s.set(this.sx[i] * k, this.sy[i] * k, this.sz[i] * k));
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.count = this.n;
    commit(this.mesh.instanceMatrix, this.n);
  }
}
