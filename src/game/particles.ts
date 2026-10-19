import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { commit } from '../render/instancing';
import { renderQuality } from '../render/quality';

/**
 * Pooled chunky 3D particles (little spinning cubes), one InstancedMesh.
 * Used for sparks, death pops, dash trails, dust.
 */
const MAX = 2048;

export interface BurstOptions {
  count: number;
  color: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation; // random mix between color and color2
  speed: [number, number];
  size: [number, number];
  life: [number, number];
  up?: number; // extra upward velocity
  gravity?: number;
  drag?: number;
  /** Bias direction (x, z) and cone spread in radians; omit for all directions. */
  dir?: { x: number; z: number; spread: number };
}

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private px = new Float32Array(MAX);
  private py = new Float32Array(MAX);
  private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private vz = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private spin = new Float32Array(MAX);
  private colors: THREE.Color[] = [];
  private alive = 0; // particles [0, alive) are live; dead ones are swapped out
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c1 = new THREE.Color();
  private c2 = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), createRetroMaterial({ unlit: 0.7 }), MAX);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.colors.push(new THREE.Color(1, 1, 1));
      this.mesh.setColorAt(i, this.colors[i]);
    }
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  burst(x: number, y: number, z: number, o: BurstOptions, rand = Math.random): void {
    this.c1.set(o.color);
    this.c2.set(o.color2 ?? o.color);
    const count = o.count <= 2 ? o.count : Math.ceil(o.count * renderQuality.particles);
    for (let n = 0; n < count && this.alive < MAX; n++) {
      const i = this.alive++;
      let a = rand() * Math.PI * 2;
      if (o.dir) a = Math.atan2(o.dir.z, o.dir.x) + (rand() - 0.5) * o.dir.spread;
      const sp = o.speed[0] + rand() * (o.speed[1] - o.speed[0]);
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.vx[i] = Math.cos(a) * sp;
      this.vz[i] = Math.sin(a) * sp;
      this.vy[i] = (o.up ?? 0) * (0.5 + rand());
      this.maxLife[i] = this.life[i] = o.life[0] + rand() * (o.life[1] - o.life[0]);
      this.size[i] = o.size[0] + rand() * (o.size[1] - o.size[0]);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 3;
      this.spin[i] = rand() * 10;
      this.colors[i].copy(this.c1).lerp(this.c2, rand());
    }
  }

  clear(): void {
    this.alive = 0;
  }

  update(dt: number): void {
    for (let i = 0; i < this.alive; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.swapRemove(i);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.05) {
        this.py[i] = 0.05;
        this.vy[i] *= -0.4;
      }
      this.spin[i] += dt * 8;
    }
  }

  private swapRemove(i: number): void {
    const j = --this.alive;
    if (i === j) return;
    this.px[i] = this.px[j];
    this.py[i] = this.py[j];
    this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.vz[i] = this.vz[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.size[i] = this.size[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
    this.spin[i] = this.spin[j];
    this.colors[i].copy(this.colors[j]);
  }

  /** Upload instance data. Particles are cosmetic, so no interpolation. */
  render(): void {
    for (let i = 0; i < this.alive; i++) {
      const k = this.life[i] / this.maxLife[i];
      const sc = this.size[i] * Math.min(1, k * 2.5);
      this.q.setFromEuler(this.e.set(this.spin[i], this.spin[i] * 0.7, 0));
      this.m4.compose(this.v.set(this.px[i], this.py[i], this.pz[i]), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, this.colors[i]);
    }
    this.mesh.count = this.alive;
    commit(this.mesh.instanceMatrix, this.mesh.count);
    if (this.mesh.instanceColor) commit(this.mesh.instanceColor, this.mesh.count);
  }
}
