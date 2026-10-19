import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';
import { compactWeaponNet, segmentDistanceSq, WeaponBatch, weapons3Tuning } from './weapons3Shared';

/** Running lays a fence; standing still makes a compact close-defense battery. */
export class Tesla extends Weapon {
  private coils = Array.from({ length: 6 }, () => ({
    life: 0,
    x: 0,
    z: 0,
    tick: 0,
    pulse: 0,
    tx: 0,
    tz: 0,
    link: -1,
    serial: 0,
  }));
  private serial = 0;
  private near: Enemy[] = [];
  private posts: WeaponBatch;
  private rings: WeaponBatch;
  private beams: WeaponBatch;
  constructor(def: WeaponDef, scene: THREE.Scene) {
    super(def);
    this.posts = new WeaponBatch(scene, new THREE.CylinderGeometry(0.18, 0.36, 1.2, 6), 6);
    this.rings = new WeaponBatch(
      scene,
      new THREE.TorusGeometry(0.4, 0.09, 4, 8).rotateX(Math.PI / 2),
      30,
    );
    this.beams = new WeaponBatch(scene, new THREE.BoxGeometry(1, 1, 1), 12);
  }
  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p,
      pl = ctx.player;
    if (!pl.dead && this.tick(dt, ctx, p.cd)) {
      let slot = 0,
        newest = -1;
      for (let i = 0; i < Math.min(p.max, this.coils.length); i++) {
        const c = this.coils[i];
        if (c.serial < this.coils[slot].serial) slot = i;
        if (c.life > 0 && (newest < 0 || c.serial > this.coils[newest].serial)) newest = i;
      }
      for (const old of this.coils) if (old.link === slot) old.link = -1;
      const c = this.coils[slot];
      // Separate stacked coils so even a stationary hero can read the deployed count.
      const a = this.serial * 2.4;
      c.x = pl.x + Math.cos(a) * 0.8;
      c.z = pl.z + Math.sin(a) * 0.8;
      c.life = p.life;
      c.tick = 0;
      c.serial = ++this.serial;
      c.link = newest === slot ? -1 : newest;
      ctx.fx.ring(c.x, c.z, 0.3, 1.2, this.color, 0.3);
      ctx.sound('mine');
    }
    for (const c of this.coils) {
      c.pulse = Math.max(0, c.pulse - dt);
      if (c.life <= 0) continue;
      c.life -= dt;
      c.tick -= dt;
      if (c.tick > 0 || pl.dead) continue;
      c.tick += p.tick * ctx.stats.cooldownMul;
      const e = ctx.nearest(c.x, c.z, p.range);
      if (e) {
        c.tx = e.x;
        c.tz = e.z;
        c.pulse = 0.16;
        ctx.damage(e, p.dmg, { source: 'tesla', knockback: 1, canCrit: true, loud: false });
      }
      const other = this.coils[c.link];
      if (
        other?.life > 0 &&
        Math.hypot(other.x - c.x, other.z - c.z) <= p.range * weapons3Tuning.coilLink
      ) {
        const width = p.width * Math.sqrt(ctx.stats.areaMul);
        ctx.inRadius(
          (other.x + c.x) / 2,
          (other.z + c.z) / 2,
          Math.hypot(other.x - c.x, other.z - c.z) / 2 + width + 2,
          this.near,
        );
        for (const target of this.near)
          if (
            segmentDistanceSq(target.x, target.z, c.x, c.z, other.x, other.z) <=
            (target.radius + width) ** 2
          ) {
            ctx.damage(target, p.dmg, {
              source: 'tesla',
              knockback: 1,
              canCrit: true,
              loud: false,
            });
          }
      }
      if (e && c.serial === this.serial) ctx.sound('zap');
    }
  }
  net(): number[] {
    const a: number[] = [];
    // Fixed slots preserve link indices on clients.
    for (const c of this.coils) a.push(c.life, c.x, c.z, c.pulse, c.tx, c.tz, c.link);
    return compactWeaponNet(a);
  }
  setNet(a: number[]): void {
    for (let i = 0; i < this.coils.length; i++) {
      const c = this.coils[i],
        k = i * 7;
      c.life = a[k] ?? 0;
      c.x = a[k + 1] ?? 0;
      c.z = a[k + 2] ?? 0;
      c.pulse = a[k + 3] ?? 0;
      c.tx = a[k + 4] ?? 0;
      c.tz = a[k + 5] ?? 0;
      c.link = a[k + 6] ?? -1;
    }
  }
  render(): void {
    this.posts.begin('#566c86');
    this.rings.begin(this.color);
    this.beams.begin(this.color);
    for (const c of this.coils)
      if (c.life > 0) {
        this.posts.add(c.x, 0.65, c.z, 1);
        const n = this.evolved ? 5 : Math.min(4, 2 + Math.floor(this.level / 2));
        for (let k = 0; k < n; k++) this.rings.add(c.x, 0.4 + k * 0.24, c.z, 1);
        if (c.pulse > 0) this.beams.line(c.x, c.z, c.tx, c.tz, 0.09);
        const other = this.coils[c.link];
        if (
          other?.life > 0 &&
          Math.hypot(other.x - c.x, other.z - c.z) <= this.p.range * weapons3Tuning.coilLink
        )
          this.beams.line(c.x, c.z, other.x, other.z, 0.055, 0.65);
      }
    this.posts.end();
    this.rings.end();
    this.beams.end();
  }
  dispose(): void {
    this.posts.dispose();
    this.rings.dispose();
    this.beams.dispose();
  }
}
