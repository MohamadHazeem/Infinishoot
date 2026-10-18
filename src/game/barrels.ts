import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from '../render/geometry';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';
import type { Arena } from '../world/fieldArena';

const MAX = 160;
export const BARREL_RADIUS = 0.5;

export const barrelTuning = {
  hp: 24, // about three Buster shots
  radius: 4.2,
  damage: 70, // grows with the stage
  chainDelay: 0.14, // seconds before a barrel caught in a blast goes off
};

export interface Barrel {
  x: number;
  z: number;
  box: Arena['barrels'][number]['box'];
  hp: number;
  alive: boolean;
  /** Counting down to an explosion (-1 = not lit). */
  fuse: number;
  flash: number;
  /** Hero index credited with the kill. */
  by: number;
}

/** Red explosive barrels: shoot one and it blows up, setting off its neighbours. */
export class Barrels {
  list: Barrel[] = [];
  private mesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private white = new THREE.Color('#ffffff');

  constructor(scene: THREE.Scene) {
    const geo = mergeGeometries([
      paint(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 8), '#ff4d5e'),
      paint(new THREE.CylinderGeometry(0.47, 0.47, 0.18, 8), '#ffd23f').translate(0, 0.28, 0),
      paint(new THREE.CylinderGeometry(0.47, 0.47, 0.18, 8), '#ffd23f').translate(0, -0.28, 0),
      paint(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 8), '#3a3d5c').translate(0.15, 0.58, 0.1),
    ]);
    this.mesh = new THREE.InstancedMesh(geo, createRetroMaterial({ vertexColors: true, instanceFlash: true }), MAX);
    this.mesh.geometry.setAttribute('instanceFlash', new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  load(arena: Arena): void {
    this.list = arena.barrels.slice(0, MAX).map((b) => ({ x: b.x, z: b.z, box: b.box, hp: barrelTuning.hp, alive: true, fuse: -1, flash: 0, by: 0 }));
  }

  /** First live barrel overlapping a circle, or -1. */
  hitTest(x: number, z: number, r: number): number {
    const rr = (r + BARREL_RADIUS) ** 2;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (b.alive && (b.x - x) ** 2 + (b.z - z) ** 2 < rr) return i;
    }
    return -1;
  }

  /** Damage a barrel; lights its fuse when it runs out of life. */
  hit(i: number, dmg: number, by: number): void {
    const b = this.list[i];
    if (!b || !b.alive) return;
    b.hp -= dmg;
    b.flash = 1;
    if (b.hp <= 0 && b.fuse < 0) {
      b.fuse = 0.05;
      b.by = by;
    }
  }

  /** Damage every live barrel whose centre passes `inside`. */
  hitWhere(dmg: number, by: number, inside: (x: number, z: number) => boolean): void {
    for (let i = 0; i < this.list.length; i++) if (this.list[i].alive && inside(this.list[i].x, this.list[i].z)) this.hit(i, dmg, by);
  }

  /** Light every barrel inside a blast. */
  igniteNear(x: number, z: number, r: number, by: number): void {
    for (const b of this.list) {
      if (!b.alive || b.fuse >= 0 || (b.x - x) ** 2 + (b.z - z) ** 2 > (r + BARREL_RADIUS) ** 2) continue;
      b.fuse = barrelTuning.chainDelay;
      b.by = by;
      b.flash = 1;
    }
  }

  /** Count fuses down; calls `explode` for each barrel that goes off. */
  update(dt: number, explode: (i: number, b: Barrel) => void): void {
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (!b.alive) continue;
      b.flash = Math.max(0, b.flash - dt * 6);
      if (b.fuse < 0) continue;
      b.fuse -= dt;
      if (b.fuse <= 0) {
        b.alive = false;
        explode(i, b);
      }
    }
  }

  /** Client: the host says barrel i blew up. */
  remove(i: number): Barrel | null {
    const b = this.list[i];
    if (!b || !b.alive) return null;
    b.alive = false;
    return b;
  }

  render(time: number): void {
    const flash = this.mesh.geometry.getAttribute('instanceFlash') as THREE.InstancedBufferAttribute;
    let n = 0;
    for (const b of this.list) {
      if (!b.alive) continue;
      // Lit barrels swell and wobble just before they pop.
      const lit = b.fuse >= 0;
      const sc = lit ? 1.12 + Math.sin(time * 60) * 0.06 : 1 + b.flash * 0.08;
      this.q.set(0, 0, 0, 1);
      this.m4.compose(this.v.set(b.x, 0.55, b.z), this.q, this.s.set(sc, sc * (lit ? 1.05 : 1), sc));
      this.mesh.setMatrixAt(n, this.m4);
      const f = lit ? 0.8 : b.flash;
      this.c.copy(this.white);
      flash.setXYZW(n, this.c.r, this.c.g, this.c.b, f);
      n++;
    }
    this.mesh.count = n;
    commit(this.mesh.instanceMatrix, n);
    commit(flash, n);
  }
}
