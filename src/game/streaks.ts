import * as THREE from 'three';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';

/**
 * Motion streaks: short glowing slivers left behind fast things (discs,
 * missiles, charge shots) that shrink away in a fraction of a second.
 * Cosmetic and local: weapons and bullets add them from render(), so every
 * machine draws its own from synced positions.
 */
const MAX = 600;

class Streaks {
  private mesh: THREE.InstancedMesh | null = null;
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private z = new Float32Array(MAX);
  private ang = new Float32Array(MAX);
  private len = new Float32Array(MAX);
  private wid = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private colors: THREE.Color[] = Array.from({ length: MAX }, () => new THREE.Color());
  private n = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  /** Off for players who turn effects down. */
  enabled = true;

  attach(scene: THREE.Scene): void {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), createRetroMaterial({ unlit: 1 }), MAX);
    this.mesh.setColorAt(0, new THREE.Color('#ffffff'));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** A streak from (x0, z0) to (x1, z1) at height y. */
  add(x0: number, z0: number, x1: number, z1: number, y: number, width: number, color: THREE.ColorRepresentation, life = 0.18): void {
    if (!this.enabled || this.n >= MAX) return;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const i = this.n++;
    this.x[i] = (x0 + x1) / 2;
    this.z[i] = (z0 + z1) / 2;
    this.y[i] = y;
    this.ang[i] = Math.atan2(dx, dz);
    this.len[i] = len;
    this.wid[i] = width;
    this.age[i] = 0;
    this.life[i] = life;
    this.colors[i].set(color);
  }

  render(dt: number): void {
    const m = this.mesh;
    if (!m) return;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // Swap-remove.
        const j = --this.n;
        this.x[i] = this.x[j];
        this.y[i] = this.y[j];
        this.z[i] = this.z[j];
        this.ang[i] = this.ang[j];
        this.len[i] = this.len[j];
        this.wid[i] = this.wid[j];
        this.age[i] = this.age[j];
        this.life[i] = this.life[j];
        this.colors[i].copy(this.colors[j]);
        i--;
        continue;
      }
      const k = 1 - this.age[i] / this.life[i];
      this.q.setFromAxisAngle(this.up, this.ang[i]);
      const w = this.wid[i] * k;
      this.m4.compose(this.v.set(this.x[i], this.y[i], this.z[i]), this.q, this.s.set(w, w * 0.6, this.len[i] * (0.6 + 0.4 * k)));
      m.setMatrixAt(i, this.m4);
      m.setColorAt(i, this.colors[i]);
    }
    m.count = this.n;
    commit(m.instanceMatrix, this.n);
    if (m.instanceColor) commit(m.instanceColor, this.n);
  }

  clear(): void {
    this.n = 0;
  }
}

export const streaks = new Streaks();
