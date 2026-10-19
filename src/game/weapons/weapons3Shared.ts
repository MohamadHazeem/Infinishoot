import * as THREE from 'three';
import { commit } from '../../render/instancing';
import { createRetroMaterial } from '../../render/retroMaterial';

/** Non-level-dependent controls (level ladders and tracks live in data/weapons.ts). */
export const weapons3Tuning = {
  swarmTurn: 7,
  swarmLife: 2.5,
  prismLife: 3,
  splitDamage: 0.45,
  coilLink: 1.5,
};

/** Bounded instance writer. All transforms are reused, including on clients. */
export class WeaponBatch {
  readonly mesh: THREE.InstancedMesh;
  private mat;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private count = 0;
  private color = '';
  constructor(
    private scene: THREE.Scene,
    geometry: THREE.BufferGeometry,
    private cap: number,
  ) {
    this.mat = createRetroMaterial({ color: '#ffffff', unlit: 0.55 });
    this.mesh = new THREE.InstancedMesh(geometry, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  begin(color: string): void {
    this.count = 0;
    if (color !== this.color) {
      this.color = color;
      this.mat.uniforms.uColor.value.set(color);
    }
  }
  add(x: number, y: number, z: number, sx: number, sy = sx, sz = sx, angle = 0): void {
    if (this.count >= this.cap) return;
    this.m.compose(
      this.pos.set(x, y, z),
      this.q.setFromAxisAngle(this.up, angle),
      this.scale.set(sx, sy, sz),
    );
    this.mesh.setMatrixAt(this.count++, this.m);
  }
  line(x: number, z: number, tx: number, tz: number, width: number, y = 1): void {
    this.add(
      (x + tx) / 2,
      y,
      (z + tz) / 2,
      Math.hypot(tx - x, tz - z),
      width,
      width,
      -Math.atan2(tz - z, tx - x),
    );
  }
  end(): void {
    this.mesh.count = this.count;
    commit(this.mesh.instanceMatrix, this.count);
  }
  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Swept collisions don't tunnel through small enemies at low frame rates. */
export function segmentDistanceSq(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax,
    dz = bz - az;
  const d = dx * dx + dz * dz;
  const t = d > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / d)) : 0;
  return (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
}

/** Per-swing/flight history, recycled instead of allocating Sets during combat. */
export class HitLedger {
  private ids = new Float64Array(512);
  private n = 0;
  clear(): void {
    this.n = 0;
  }
  has(uid: number): boolean {
    for (let i = 0; i < this.n; i++) if (this.ids[i] === uid) return true;
    return false;
  }
  add(uid: number): boolean {
    if (this.has(uid) || this.n >= this.ids.length) return false;
    this.ids[this.n++] = uid;
    return true;
  }
}

/** Snapshot-only quantization lets snapCodec use its compact fixed-point numbers. */
export function compactWeaponNet(a: number[]): number[] {
  for (let i = 0; i < a.length; i++) a[i] = Math.round(a[i] * 100) / 100;
  return a;
}
