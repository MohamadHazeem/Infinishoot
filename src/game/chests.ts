import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from '../render/geometry';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';
import { textures } from '../render/textures';

const MAX = 24;
export const CHEST_OPEN_RANGE = 1.4;

export interface WorldChest {
  x: number;
  z: number;
  /** Seconds since it was opened (-1 = still closed). */
  openT: number;
  facing: number;
}

/**
 * Treasure chests placed around each stage. Walk into one to pop it open:
 * it gives an item on the spot (no menu), then stays open as a marker.
 */
export class Chests {
  list: WorldChest[] = [];
  // Textured wood and vertex-coloured gold trim, as separate instanced meshes sharing matrices.
  private baseWood: THREE.InstancedMesh;
  private baseTrim: THREE.InstancedMesh;
  private lidWood: THREE.InstancedMesh;
  private lidTrim: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private hinge = new THREE.Matrix4();
  private lidM = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    const trim = '#ffd23f';
    const dark = '#333c57';
    const baseTrim = mergeGeometries([
      paint(new THREE.BoxGeometry(1.04, 0.1, 0.7), trim).translate(0, 0.08, 0),
      paint(new THREE.BoxGeometry(0.12, 0.52, 0.7), trim).translate(-0.3, 0.26, 0),
      paint(new THREE.BoxGeometry(0.12, 0.52, 0.7), trim).translate(0.3, 0.26, 0),
      paint(new THREE.BoxGeometry(1.04, 0.05, 0.7), trim).translate(0, 0.48, 0),
    ]);
    // Lid is built with its hinge (back edge) at the origin so it can swing open.
    const lidTrim = mergeGeometries([
      paint(new THREE.BoxGeometry(0.12, 0.28, 0.7), trim).translate(-0.3, 0.14, 0.34),
      paint(new THREE.BoxGeometry(0.12, 0.28, 0.7), trim).translate(0.3, 0.14, 0.34),
      paint(new THREE.BoxGeometry(0.22, 0.22, 0.08), trim).translate(0, 0.02, 0.7),
      paint(new THREE.BoxGeometry(0.07, 0.09, 0.09), dark).translate(0, 0.0, 0.72), // keyhole
    ]);
    const woodMat = createRetroMaterial({ map: textures.chestWood() });
    const trimMat = createRetroMaterial({ vertexColors: true, unlit: 0.2 });
    this.baseWood = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.5, 0.66).translate(0, 0.25, 0), woodMat, MAX);
    this.baseTrim = new THREE.InstancedMesh(baseTrim, trimMat, MAX);
    this.lidWood = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 0.26, 0.68).translate(0, 0.13, 0.34), woodMat, MAX);
    this.lidTrim = new THREE.InstancedMesh(lidTrim, trimMat, MAX);
    for (const m of [this.baseWood, this.baseTrim, this.lidWood, this.lidTrim]) {
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
  }

  /** Stages start with no chests; they appear over time (Game spawns them, clients mirror). */
  clear(): void {
    this.list = [];
  }

  add(x: number, z: number, facing: number): void {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({ x, z, openT: -1, facing });
  }

  /** Index of the closest closed chest within range of (x, z), or -1. */
  touching(x: number, z: number, r = CHEST_OPEN_RANGE): number {
    let best = -1;
    let bd = r * r;
    this.list.forEach((c, i) => {
      if (c.openT >= 0) return;
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  open(i: number): WorldChest | null {
    const c = this.list[i];
    if (!c || c.openT >= 0) return null;
    c.openT = 0;
    return c;
  }

  get closedCount(): number {
    return this.list.filter((c) => c.openT < 0).length;
  }

  render(dt: number, time: number): void {
    let n = 0;
    for (const c of this.list) {
      if (c.openT >= 0) c.openT += dt;
      // Closed chests bob a little to catch the eye; the lid snaps open with a bounce.
      const bob = c.openT < 0 ? Math.abs(Math.sin(time * 3 + c.x)) * 0.06 : 0;
      const k = c.openT < 0 ? 0 : Math.min(1, c.openT / 0.18);
      const swing = k * 1.9 - (k >= 1 ? Math.sin(Math.min(1, (c.openT - 0.18) / 0.3) * Math.PI) * 0.25 : 0);
      this.q.setFromAxisAngle(this.up, c.facing);
      this.m4.compose(this.v.set(c.x, bob, c.z), this.q, this.s);
      this.baseWood.setMatrixAt(n, this.m4);
      this.baseTrim.setMatrixAt(n, this.m4);
      // Lid: hinge at the back top edge, rotate about X.
      this.hinge.makeRotationX(-swing).setPosition(0, 0.5, -0.34);
      this.lidM.multiplyMatrices(this.m4, this.hinge);
      this.lidWood.setMatrixAt(n, this.lidM);
      this.lidTrim.setMatrixAt(n, this.lidM);
      n++;
    }
    for (const m of [this.baseWood, this.baseTrim, this.lidWood, this.lidTrim]) {
      m.count = n;
      commit(m.instanceMatrix, n);
    }
  }
}
