import * as THREE from 'three';
import { createRetroMaterial, type RetroMaterial } from '../../render/retroMaterial';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';
import { commit } from '../../render/instancing';
import { streaks } from '../streaks';

const MAX = 48;

interface Missile {
  /** Last rendered position (for the motion streak). */
  lx?: number;
  lz?: number;
  x: number;
  z: number;
  px: number;
  pz: number;
  a: number; // heading
  sp: number;
  life: number;
  target: Enemy | null;
  targetUid: number;
  smokeT: number;
}

/** Homing missiles: launch upward-outward, curve onto random targets, explode. */
export class Missiles extends Weapon {
  private list: Missile[] = [];
  private mesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private pool: Enemy[] = [];

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const body = new THREE.CylinderGeometry(0.1, 0.13, 0.6, 6).rotateX(Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(body, createRetroMaterial({ color: '#ff5e5e', unlit: 0.5 }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  private pickTarget(ctx: WeaponCtx, m: Missile): void {
    // Random enemy within range, so a volley spreads across the crowd.
    const cands = ctx.inRadius(m.x, m.z, 13, this.pool);
    m.target = cands.length ? cands[Math.floor(Math.random() * cands.length)] : null;
    m.targetUid = m.target ? m.target.uid : -1;
  }

  net(): number[] {
    const out: number[] = [this.list.length];
    for (const m of this.list) out.push(Math.round(m.x * 100) / 100, Math.round(m.z * 100) / 100, Math.round(m.a * 100) / 100);
    return out;
  }
  setNet(a: number[]): void {
    const n = a[0] ?? 0;
    const old = this.list;
    this.list = [];
    for (let i = 0; i < n; i++) {
      const x = a[1 + i * 3];
      const z = a[2 + i * 3];
      const o = old[i];
      this.list.push({ x, z, px: o ? o.x : x, pz: o ? o.z : z, a: a[3 + i * 3], sp: 0, life: 1, target: null, targetUid: -1, smokeT: 0 });
    }
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    if (!pl.dead && this.tick(dt, ctx, p.cd)) {
      for (let i = 0; i < p.count && this.list.length < MAX; i++) {
        const a = (i / p.count) * Math.PI * 2 + Math.random() * 0.5;
        const m: Missile = { x: pl.x, z: pl.z, px: pl.x, pz: pl.z, a, sp: 6, life: 3, target: null, targetUid: -1, smokeT: 0 };
        this.pickTarget(ctx, m);
        this.list.push(m);
      }
      ctx.sound('missile');
    }
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i];
      m.px = m.x;
      m.pz = m.z;
      m.life -= dt;
      if (!m.target || !m.target.active || m.target.uid !== m.targetUid || m.target.hp <= 0) this.pickTarget(ctx, m);
      if (m.target) {
        const want = Math.atan2(m.target.z - m.z, m.target.x - m.x);
        let d = want - m.a;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = 6 * dt;
        m.a += Math.max(-turn, Math.min(turn, d));
      }
      m.sp = Math.min(20, m.sp + 30 * dt);
      m.x += Math.cos(m.a) * m.sp * dt;
      m.z += Math.sin(m.a) * m.sp * dt;
      m.smokeT -= dt;
      if (m.smokeT <= 0) {
        m.smokeT = 0.03;
        ctx.particles.burst(m.x, 1.0, m.z, { count: 1, color: '#e8e8f0', color2: '#ffb36b', speed: [0, 0.5], size: [0.15, 0.25], life: [0.2, 0.35], drag: 4 });
      }
      let boom = m.life <= 0;
      if (!boom) {
        ctx.hash.query(m.x, m.z, 1.2, (e) => {
          if (boom || !e.alive || e.hp <= 0) return;
          const rr = e.radius + 0.25;
          if ((e.x - m.x) ** 2 + (e.z - m.z) ** 2 < rr * rr) boom = true;
        });
      }
      if (boom) {
        ctx.blast(m.x, m.z, p.radius * ctx.stats.areaMul, p.dmg, '#ff7a2f', 'missiles', ctx.combos.has('firestorm') ? ['projectile', 'explosive', 'fire'] : undefined);
        this.list.splice(i--, 1);
      }
    }
  }

  protected applyLook(c: string | null): void {
    (this.mesh.material as RetroMaterial).uniforms.uColor.value.set(c ?? '#ff5e5e');
  }

  render(alpha: number): void {
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i];
      const rx = m.px + (m.x - m.px) * alpha;
      const rz = m.pz + (m.z - m.pz) * alpha;
      streaks.add(m.lx ?? rx, m.lz ?? rz, rx, rz, 1.0, 0.16, this.look('#ffd23f'), 0.22);
      m.lx = rx;
      m.lz = rz;
      this.q.setFromAxisAngle(this.up, Math.PI / 2 - m.a);
      this.m4.compose(this.v.set(m.px + (m.x - m.px) * alpha, 1.0, m.pz + (m.z - m.pz) * alpha), this.q, this.s);
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
