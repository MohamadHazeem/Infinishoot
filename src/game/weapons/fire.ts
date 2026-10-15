import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';
import { commit } from '../../render/instancing';

const MAX = 260;
const TICK = 0.25;

interface Flame {
  x: number;
  z: number;
  age: number;
  life: number;
  r: number;
}

/** Fire trail: running (and dashing, later) leaves flames that burn enemies. */
export class Fire extends Weapon {
  private flames: Flame[] = [];
  private mesh: THREE.InstancedMesh;
  private c = new THREE.Color();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private lastX = 0;
  private lastZ = 0;
  private tickT = 0;
  private hits: Enemy[] = [];

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    // Flat-bottomed cone reads as a flame tongue from above.
    const g = new THREE.ConeGeometry(0.5, 1.1, 5).translate(0, 0.55, 0);
    this.mesh = new THREE.InstancedMesh(
      g,
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      MAX,
    );
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, this.c.set('#ff7a2f'));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  net(): number[] {
    const out: number[] = [this.flames.length];
    for (const f of this.flames) out.push(Math.round(f.x * 100) / 100, Math.round(f.z * 100) / 100, Math.round(f.age * 100) / 100, f.life, Math.round(f.r * 100) / 100);
    return out;
  }
  setNet(a: number[]): void {
    this.flames = [];
    for (let i = 0; i < (a[0] ?? 0); i++) {
      const k = 1 + i * 5;
      this.flames.push({ x: a[k], z: a[k + 1], age: a[k + 2], life: a[k + 3], r: a[k + 4] });
    }
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    const r = p.radius * ctx.stats.areaMul;
    // Drop flames by distance travelled; dashing (lvl 4+) drops them densely and bigger.
    const spacing = pl.dashing && p.dash ? 0.45 : 0.75;
    const moved = Math.hypot(pl.x - this.lastX, pl.z - this.lastZ);
    if (!pl.dead && moved > spacing) {
      this.lastX = pl.x;
      this.lastZ = pl.z;
      if (this.flames.length >= MAX) this.flames.shift();
      const big = pl.dashing && p.dash ? 1.4 : 1;
      this.flames.push({ x: pl.x, z: pl.z, age: 0, life: p.life * big, r: r * big });
    }
    for (const f of this.flames) f.age += dt;
    this.flames = this.flames.filter((f) => f.age < f.life);

    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = TICK;
    const dmg = p.dps * TICK;
    const burned = new Set<number>();
    for (const f of this.flames) {
      for (const e of ctx.inRadius(f.x, f.z, f.r, this.hits)) {
        if (burned.has(e.uid)) continue; // overlapping flames don't stack
        burned.add(e.uid);
        ctx.damage(e, dmg, { source: 'fire' });
      }
    }
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    let n = 0;
    for (const f of this.flames) {
      const k = f.age / f.life;
      const flicker = 0.85 + Math.sin(ctx.time * 30 + f.x * 7) * 0.15;
      const sc = f.r * Math.min(1, f.age * 8) * (1 - k * 0.6) * flicker;
      this.q.setFromAxisAngle(this.s.set(0, 1, 0), ctx.time * 3 + f.z);
      this.m4.compose(this.v.set(f.x, 0.02, f.z), this.q, this.s.set(sc, sc * (1.2 - k * 0.5), sc));
      this.mesh.setMatrixAt(n, this.m4);
      // Additive fade: darken toward black as the flame dies.
      if (this.evolved) this.mesh.setColorAt(n, this.c.setRGB(1, 0.88 - k * 0.3, 0.3 + (1 - k) * 0.25).multiplyScalar((1 - k) * 0.85));
      else this.mesh.setColorAt(n, this.c.setRGB(1, 0.5 - k * 0.3, 0.12).multiplyScalar((1 - k) * 0.8));
      n++;
    }
    this.mesh.count = n;
    commit(this.mesh.instanceMatrix, this.mesh.count);
    if (this.mesh.instanceColor) commit(this.mesh.instanceColor, this.mesh.count);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
