import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';
import { compactWeaponNet, segmentDistanceSq, WeaponBatch, weapons3Tuning } from './weapons3Shared';

/** Each parent splits just once. Children keep bouncing but never multiply. */
export class Prism extends Weapon {
  private shards = Array.from({ length: 96 }, () => ({
    live: false,
    x: 0,
    z: 0,
    px: 0,
    pz: 0,
    angle: 0,
    age: 0,
    hops: 0,
    small: false,
    split: false,
    last: -1,
    target: null as Enemy | null,
    targetUid: -1,
  }));
  private view: WeaponBatch;
  private excluded = -1;
  private skip = (e: Enemy) => e.uid === this.excluded;
  constructor(def: WeaponDef, scene: THREE.Scene) {
    super(def);
    this.view = new WeaponBatch(scene, new THREE.OctahedronGeometry(0.4).scale(1.5, 0.7, 0.7), 192);
  }
  private launch(
    x: number,
    z: number,
    angle: number,
    small: boolean,
    last: number,
    ctx: WeaponCtx,
  ): void {
    const s = this.shards.find((v) => !v.live);
    if (!s) return;
    s.live = true;
    s.x = s.px = x;
    s.z = s.pz = z;
    s.angle = angle;
    s.age = 0;
    s.hops = this.p.hops + ctx.flags.chainBonus;
    s.small = small;
    s.split = small;
    s.last = last;
    this.excluded = last;
    s.target = ctx.nearest(x, z, this.p.range, this.skip);
    s.targetUid = s.target?.uid ?? -1;
  }
  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p,
      pl = ctx.player;
    if (!pl.dead && this.tick(dt, ctx, p.cd)) {
      const e = ctx.nearest(pl.x, pl.z, p.range);
      if (e) {
        const a = Math.atan2(e.z - pl.z, e.x - pl.x);
        for (let i = 0; i < p.count; i++)
          this.launch(pl.x, pl.z, a + (i - (p.count - 1) / 2) * 0.45, false, -1, ctx);
        ctx.sound('orb');
      } else this.cd = 0.2;
    }
    for (const s of this.shards) {
      if (!s.live) continue;
      s.px = s.x;
      s.pz = s.z;
      s.age += dt;
      if (s.age > weapons3Tuning.prismLife) {
        s.live = false;
        continue;
      }
      if (!s.target?.alive || s.target.uid !== s.targetUid) {
        this.excluded = s.last;
        s.target = ctx.nearest(s.x, s.z, p.range, this.skip);
        s.targetUid = s.target?.uid ?? -1;
      }
      const e = s.target;
      // The first fan remains visible briefly; each impact then snaps toward the next foe.
      if (e && s.age > 0.12) s.angle = Math.atan2(e.z - s.z, e.x - s.x);
      s.x += Math.cos(s.angle) * p.speed * dt;
      s.z += Math.sin(s.angle) * p.speed * dt;
      if (
        !e ||
        segmentDistanceSq(e.x, e.z, s.px, s.pz, s.x, s.z) > (e.radius + (s.small ? 0.15 : 0.3)) ** 2
      )
        continue;
      ctx.damage(e, p.dmg * (s.small ? weapons3Tuning.splitDamage : 1), {
        source: 'prism',
        knockback: 2,
        canCrit: true,
        loud: true,
      });
      ctx.fx.star(s.x, 1, s.z, s.small ? 0.4 : 0.8, this.color, 0.12);
      if (!s.split) {
        s.split = true;
        this.launch(s.x, s.z, s.angle + 0.9, true, e.uid, ctx);
        this.launch(s.x, s.z, s.angle - 0.9, true, e.uid, ctx);
      }
      s.last = e.uid;
      this.excluded = s.last;
      s.target = ctx.nearest(s.x, s.z, p.range, this.skip);
      s.targetUid = s.target?.uid ?? -1;
      if (--s.hops <= 0 || !s.target) s.live = false;
    }
  }
  net(): number[] {
    const a: number[] = [];
    for (const s of this.shards) if (s.live) a.push(s.x, s.z, s.angle, s.small ? 1 : 0);
    return compactWeaponNet(a);
  }
  setNet(a: number[]): void {
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i],
        k = i * 4,
        was = s.live;
      s.live = k + 3 < a.length;
      if (!s.live) continue;
      s.px = was ? s.x : a[k];
      s.pz = was ? s.z : a[k + 1];
      s.x = a[k];
      s.z = a[k + 1];
      s.angle = a[k + 2];
      s.small = !!a[k + 3];
    }
  }
  render(alpha: number): void {
    this.view.begin(this.color);
    for (const s of this.shards)
      if (s.live) {
        const k = s.small ? 0.55 : 1,
          x = s.px + (s.x - s.px) * alpha,
          z = s.pz + (s.z - s.pz) * alpha;
        this.view.add(x, 1, z, k, k, k, -s.angle);
        if (this.evolved && !s.small) this.view.add(x, 1, z, k, k, k, -s.angle + Math.PI / 2);
      }
    this.view.end();
  }
  dispose(): void {
    this.view.dispose();
  }
}
