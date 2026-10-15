import * as THREE from 'three';
import { createRetroMaterial } from '../../render/retroMaterial';
import type { WeaponDef } from '../../data/weapons';
import { Weapon, type WeaponCtx } from './base';
import { commit } from '../../render/instancing';

const MAX = 40;
const ARM_TIME = 0.4;
const TRIGGER = 1.0;

interface Mine {
  x: number;
  z: number;
  age: number;
}

/** Drops proximity mines at the player's feet. Rewards running through crowds. */
export class Mines extends Weapon {
  private list: Mine[] = [];
  private dome: THREE.InstancedMesh;
  private c = new THREE.Color();
  private m4 = new THREE.Matrix4();

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const g = new THREE.SphereGeometry(0.35, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    this.dome = new THREE.InstancedMesh(g, createRetroMaterial({ unlit: 0.5 }), MAX);
    for (let i = 0; i < MAX; i++) this.dome.setColorAt(i, this.c.set('#ff9f3d'));
    this.dome.frustumCulled = false;
    this.dome.count = 0;
    scene.add(this.dome);
  }

  net(): number[] {
    const out: number[] = [this.list.length];
    for (const m of this.list) out.push(Math.round(m.x * 100) / 100, Math.round(m.z * 100) / 100, Math.round(m.age * 100) / 100);
    return out;
  }
  setNet(a: number[]): void {
    this.list = [];
    for (let i = 0; i < (a[0] ?? 0); i++) this.list.push({ x: a[1 + i * 3], z: a[2 + i * 3], age: a[3 + i * 3] });
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    if (!pl.dead && this.tick(dt, ctx, p.cd)) {
      for (let k = 0; k < p.per; k++) {
        if (this.list.length >= p.max) this.list.shift();
        const ox = (k - (p.per - 1) / 2) * 1.2;
        this.list.push({ x: pl.x + ox, z: pl.z - pl.vel.z * 0.02, age: 0 });
      }
      ctx.sound('mine');
    }
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i];
      m.age += dt;
      if (m.age < ARM_TIME) continue;
      let hit = false;
      ctx.hash.query(m.x, m.z, TRIGGER + 1, (e) => {
        if (hit || !e.alive || e.hp <= 0) return;
        const rr = TRIGGER + e.radius * 0.5;
        if ((e.x - m.x) ** 2 + (e.z - m.z) ** 2 < rr * rr) hit = true;
      });
      if (hit) {
        ctx.blast(m.x, m.z, p.radius * ctx.stats.areaMul, p.dmg, '#ff9f3d', 'mines');
        this.list.splice(i--, 1);
      }
    }
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    for (let i = 0; i < this.list.length; i++) {
      const m = this.list[i];
      const armed = m.age >= ARM_TIME;
      const blink = armed && Math.sin(ctx.time * 14 + i) > 0.3;
      const s = Math.min(1, m.age * 6);
      this.m4.makeScale(s, s, s).setPosition(m.x, 0.02, m.z);
      this.dome.setMatrixAt(i, this.m4);
      this.dome.setColorAt(i, this.c.set(blink ? '#ffffff' : armed ? '#ff3d5a' : '#ff9f3d'));
    }
    this.dome.count = this.list.length;
    commit(this.dome.instanceMatrix, this.dome.count);
    if (this.dome.instanceColor) commit(this.dome.instanceColor, this.dome.count);
  }

  dispose(): void {
    this.scene.remove(this.dome);
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
  }
}
