import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import { commit } from '../../render/instancing';
import { createRetroMaterial, type RetroMaterial } from '../../render/retroMaterial';
import type { Enemy } from '../enemies';
import { streaks } from '../streaks';
import { Weapon, type WeaponCtx } from './base';

const MAX = 12;

interface Drone {
  x: number;
  z: number;
  px: number;
  pz: number;
  target: Enemy | null;
  hitsLeft: number;
  hit: Set<number>;
  back: boolean;
  spin: number;
  lx?: number;
  lz?: number;
}

/**
 * Bounce Drone: launches at the nearest enemy, ricochets to the next nearest
 * one a few times, then flies home.
 */
export class Bouncer extends Weapon {
  private list: Drone[] = [];
  private mesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    def: WeaponDef,
    private scene: THREE.Scene,
  ) {
    super(def);
    const g = new THREE.OctahedronGeometry(0.3, 0).scale(1.3, 0.45, 1.3);
    this.mesh = new THREE.InstancedMesh(g, createRetroMaterial({ color: '#73eff7', unlit: 0.6 }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  protected applyLook(c: string | null): void {
    (this.mesh.material as RetroMaterial).uniforms.uColor.value.set(c ?? '#73eff7');
  }

  net(): number[] {
    const out: number[] = [];
    for (const d of this.list) out.push(Math.round(d.x * 100) / 100, Math.round(d.z * 100) / 100);
    return out;
  }
  setNet(a: number[]): void {
    const n = Math.floor(a.length / 2);
    while (this.list.length > n) this.list.pop();
    for (let i = 0; i < n; i++) {
      let d = this.list[i];
      if (!d) {
        d = { x: a[i * 2], z: a[i * 2 + 1], px: a[i * 2], pz: a[i * 2 + 1], target: null, hitsLeft: 0, hit: new Set(), back: false, spin: 0 };
        this.list.push(d);
      }
      d.px = d.x;
      d.pz = d.z;
      d.x = a[i * 2];
      d.z = a[i * 2 + 1];
    }
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    if (!pl.dead && this.tick(dt, ctx, p.cd)) {
      for (let i = 0; i < p.count && this.list.length < MAX; i++) {
        const t = ctx.nearest(pl.x, pl.z, 12, (e) => this.list.some((d) => d.target === e));
        if (!t) break;
        this.list.push({ x: pl.x, z: pl.z, px: pl.x, pz: pl.z, target: t, hitsLeft: p.bounces, hit: new Set(), back: false, spin: 0 });
        ctx.sound('bouncer');
      }
    }
    const speed = p.speed;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i];
      d.px = d.x;
      d.pz = d.z;
      d.spin += dt * 14;
      let tx = pl.x;
      let tz = pl.z;
      if (!d.back) {
        if (!d.target || !d.target.active || d.target.hp <= 0) d.target = ctx.nearest(d.x, d.z, p.hop, (e) => d.hit.has(e.uid));
        if (!d.target) d.back = true;
        else {
          tx = d.target.x;
          tz = d.target.z;
        }
      }
      const dx = tx - d.x;
      const dz = tz - d.z;
      const dist = Math.hypot(dx, dz) || 1;
      const step = speed * dt;
      if (!d.back && d.target && dist < d.target.radius + 0.4) {
        ctx.damage(d.target, p.dmg, { source: 'bouncer', dirX: dx / dist, dirZ: dz / dist, knockback: 4, hx: d.x, hz: d.z, canCrit: true, loud: true });
        d.hit.add(d.target.uid);
        d.hitsLeft--;
        d.target = d.hitsLeft > 0 ? ctx.nearest(d.x, d.z, p.hop, (e) => d.hit.has(e.uid)) : null;
        if (!d.target) d.back = true;
        continue;
      }
      if (d.back && dist < 0.8) {
        this.list.splice(i--, 1);
        continue;
      }
      d.x += (dx / dist) * Math.min(step, dist);
      d.z += (dz / dist) * Math.min(step, dist);
    }
  }

  render(alpha: number): void {
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i];
      const x = d.px + (d.x - d.px) * alpha;
      const z = d.pz + (d.z - d.pz) * alpha;
      streaks.add(d.lx ?? x, d.lz ?? z, x, z, 1.1, 0.18, this.look('#73eff7'), 0.15);
      d.lx = x;
      d.lz = z;
      d.spin += 0.3;
      this.q.setFromAxisAngle(this.up, d.spin);
      this.m4.compose(this.v.set(x, 1.1, z), this.q, this.s.set(1, 1, 1));
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.count = this.list.length;
    commit(this.mesh.instanceMatrix, this.mesh.count);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
