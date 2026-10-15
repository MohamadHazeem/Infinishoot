import * as THREE from 'three';
import { createRetroMaterial, type RetroMaterial } from '../../render/retroMaterial';
import type { WeaponDef } from '../../data/weapons';
import { Weapon, type WeaponCtx } from './base';
import { commit } from '../../render/instancing';

const MAX = 8;
const HIT_COOLDOWN = 0.35;

/** Drones orbiting the player that damage whatever they touch. */
export class Drones extends Weapon {
  private angle = 0;
  private mesh: THREE.InstancedMesh;
  private ring: THREE.InstancedMesh;

  protected applyLook(c: string | null): void {
    (this.mesh.material as RetroMaterial).uniforms.uColor.value.set(c ?? '#4fc3ff');
    (this.ring.material as RetroMaterial).uniforms.uColor.value.set(c ? '#ff3df0' : '#ffffff');
  }
  private lastHit = new Map<number, number>();
  private pos: { x: number; z: number }[] = Array.from({ length: MAX }, () => ({ x: 0, z: 0 }));
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private cleanT = 0;

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.32, 0), createRetroMaterial({ color: '#4fc3ff', unlit: 0.5 }), MAX);
    this.ring = new THREE.InstancedMesh(new THREE.TorusGeometry(0.42, 0.06, 4, 12), createRetroMaterial({ color: '#ffffff', unlit: 0.8 }), MAX);
    for (const m of [this.mesh, this.ring]) {
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
  }

  private get radius(): number {
    return this.p.radius * this.areaMul;
  }
  private areaMul = 1;

  net(): number[] {
    return [Math.round(this.angle * 1000) / 1000, this.areaMul];
  }
  setNet(a: number[]): void {
    this.angle = a[0] ?? 0;
    this.areaMul = a[1] ?? 1;
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    this.areaMul = ctx.stats.areaMul;
    this.angle += p.spin * dt / Math.max(0.6, ctx.stats.cooldownMul);
    const pl = ctx.player;
    const hitR = 0.45 * p.size * this.areaMul;
    for (let i = 0; i < p.count; i++) {
      const a = this.angle + (i / p.count) * Math.PI * 2;
      const dp = this.pos[i];
      dp.x = pl.x + Math.cos(a) * this.radius;
      dp.z = pl.z + Math.sin(a) * this.radius;
      ctx.hash.query(dp.x, dp.z, hitR + 1, (en) => {
        if (!en.alive || en.hp <= 0) return;
        const rr = hitR + en.radius;
        if ((en.x - dp.x) ** 2 + (en.z - dp.z) ** 2 > rr * rr) return;
        const last = this.lastHit.get(en.uid) ?? -1;
        if (ctx.time - last < HIT_COOLDOWN) return;
        this.lastHit.set(en.uid, ctx.time);
        // Knock enemies along the orbit direction.
        ctx.damage(en, p.dmg, { source: 'drones', dirX: -Math.sin(a), dirZ: Math.cos(a), knockback: 5, hx: dp.x, hz: dp.z, canCrit: true, loud: true, tags: ctx.combos.has('tesla_drones') ? ['orbit', 'shock'] : undefined });
      });
    }
    // Forget old entries now and then so the map doesn't grow forever.
    this.cleanT += dt;
    if (this.cleanT > 3) {
      this.cleanT = 0;
      for (const [k, t] of this.lastHit) if (ctx.time - t > 1) this.lastHit.delete(k);
    }
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    const n = ctx.player.dead ? 0 : p.count;
    const r = this.radius;
    const sc = p.size * this.areaMul;
    for (let i = 0; i < n; i++) {
      // Render from the interpolated player position so drones don't jitter.
      const a = this.angle + (i / p.count) * Math.PI * 2;
      const x = pl.rig.root.position.x + Math.cos(a) * r;
      const z = pl.rig.root.position.z + Math.sin(a) * r;
      const y = 1.0 + Math.sin(ctx.time * 5 + i) * 0.15;
      this.q.setFromEuler(this.e.set(ctx.time * 4, ctx.time * 6 + i, 0));
      this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, this.m4);
      this.q.setFromEuler(this.e.set(Math.PI / 2, 0, ctx.time * 3));
      this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(sc, sc, sc));
      this.ring.setMatrixAt(i, this.m4);
    }
    this.mesh.count = this.ring.count = n;
    commit(this.mesh.instanceMatrix, this.mesh.count);
    commit(this.ring.instanceMatrix, this.ring.count);
  }

  dispose(): void {
    for (const m of [this.mesh, this.ring]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
