import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from '../../render/geometry';
import { createRetroMaterial, type RetroMaterial } from '../../render/retroMaterial';
import type { WeaponDef } from '../../data/weapons';
import { Weapon, type WeaponCtx } from './base';
import { commit } from '../../render/instancing';
import { streaks } from '../streaks';

const MAX = 16;
const HIT_COOLDOWN = 0.3;

interface Disc {
  /** Last rendered position (for the motion streak). */
  lx?: number;
  lz?: number;
  x: number;
  z: number;
  px: number;
  pz: number;
  dx: number;
  dz: number;
  dist: number; // travelled outward
  back: boolean;
  spin: number;
  hits: Map<number, number>;
}

/** Boomerang discs: thrown toward the aim, slice through everything, return. */
export class Discs extends Weapon {
  private discs: Disc[] = [];
  private mesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    // Saw-blade look: magenta disc, white rim, yellow hub and teeth, so the
    // spin reads from the top-down camera. Merged into one vertex-coloured mesh.
    const part = (geo: THREE.BufferGeometry, color: string) => paint(geo.index ? geo.toNonIndexed() : geo, color);
    const parts = [
      part(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 12), '#ff3df0'),
      part(new THREE.TorusGeometry(0.44, 0.06, 4, 12).rotateX(Math.PI / 2), '#ffffff'),
      part(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 6), '#ffd23f'),
    ];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(part(new THREE.ConeGeometry(0.09, 0.22, 3).rotateZ(-Math.PI / 2).rotateY(-a).translate(Math.cos(a) * 0.52, 0, Math.sin(a) * 0.52), '#ffd23f'));
    }
    const merged = mergeGeometries(parts)!;
    this.mesh = new THREE.InstancedMesh(merged, createRetroMaterial({ vertexColors: true, unlit: 0.45 }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  net(): number[] {
    const out: number[] = [this.discs.length];
    for (const d of this.discs) out.push(Math.round(d.x * 100) / 100, Math.round(d.z * 100) / 100, Math.round(d.spin * 100) / 100);
    return out;
  }
  setNet(a: number[]): void {
    const n = a[0] ?? 0;
    const old = this.discs;
    this.discs = [];
    for (let i = 0; i < n; i++) {
      const x = a[1 + i * 3];
      const z = a[2 + i * 3];
      const o = old[i];
      this.discs.push({ x, z, px: o ? o.x : x, pz: o ? o.z : z, dx: 0, dz: 0, dist: 0, back: false, spin: a[3 + i * 3], hits: new Map() });
    }
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    const size = p.size * ctx.stats.areaMul;
    if (!pl.dead && this.tick(dt, ctx, p.cd)) {
      const base = Math.atan2(pl.aim.z, pl.aim.x);
      for (let i = 0; i < p.count && this.discs.length < MAX; i++) {
        const a = base + (p.count > 1 ? (i / p.count) * Math.PI * 2 : 0);
        this.discs.push({ x: pl.x, z: pl.z, px: pl.x, pz: pl.z, dx: Math.cos(a), dz: Math.sin(a), dist: 0, back: false, spin: 0, hits: new Map() });
      }
      ctx.sound('disc');
    }
    const hitR = 0.5 * size;
    for (let i = 0; i < this.discs.length; i++) {
      const d = this.discs[i];
      d.px = d.x;
      d.pz = d.z;
      d.spin += dt * 18;
      if (!d.back) {
        // Decelerate toward the end of the throw for a satisfying hang.
        const k = 1 - d.dist / p.range;
        const sp = p.speed * (0.35 + 0.65 * k);
        d.x += d.dx * sp * dt;
        d.z += d.dz * sp * dt;
        d.dist += sp * dt;
        if (d.dist >= p.range) d.back = true;
      } else {
        const tx = pl.x - d.x;
        const tz = pl.z - d.z;
        const l = Math.hypot(tx, tz) || 1;
        const sp = p.speed * 1.2;
        d.x += (tx / l) * sp * dt;
        d.z += (tz / l) * sp * dt;
        if (l < 0.8) {
          this.discs.splice(i--, 1);
          continue;
        }
      }
      ctx.hash.query(d.x, d.z, hitR + 1, (e) => {
        if (!e.alive || e.hp <= 0) return;
        const rr = hitR + e.radius;
        if ((e.x - d.x) ** 2 + (e.z - d.z) ** 2 > rr * rr) return;
        if (ctx.time - (d.hits.get(e.uid) ?? -9) < HIT_COOLDOWN) return;
        d.hits.set(e.uid, ctx.time);
        ctx.damage(e, p.dmg, { source: 'discs', dirX: d.dx, dirZ: d.dz, knockback: 4, hx: d.x, hz: d.z, canCrit: true, loud: true });
      });
    }
  }

  protected applyLook(c: string | null): void {
    (this.mesh.material as RetroMaterial).uniforms.uColor.value.set(c ? new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.35) : '#ffffff');
  }

  render(alpha: number, ctx: WeaponCtx): void {
    const sc = this.p.size * ctx.stats.areaMul;
    for (let i = 0; i < this.discs.length; i++) {
      const d = this.discs[i];
      const rx = d.px + (d.x - d.px) * alpha;
      const rz = d.pz + (d.z - d.pz) * alpha;
      streaks.add(d.lx ?? rx, d.lz ?? rz, rx, rz, 1.0, 0.3 * sc, this.look(this.def.color), 0.16);
      d.lx = rx;
      d.lz = rz;
      this.q.setFromAxisAngle(this.up, d.spin);
      this.m4.compose(
        this.v.set(d.px + (d.x - d.px) * alpha, 1.0, d.pz + (d.z - d.pz) * alpha),
        this.q,
        this.s.set(sc, sc, sc),
      );
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.count = this.discs.length;
    commit(this.mesh.instanceMatrix, this.mesh.count);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
