import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';
import { compactWeaponNet, HitLedger, segmentDistanceSq, WeaponBatch } from './weapons3Shared';

/** Figure-eight throws, with a separate hit ledger for each half of the flight. */
export class Crosswind extends Weapon {
  private blades = Array.from({ length: 32 }, () => ({
    live: false,
    x: 0,
    z: 0,
    px: 0,
    pz: 0,
    ox: 0,
    oz: 0,
    dx: 0,
    dz: 0,
    side: 1,
    t: 0,
    back: false,
    hits: new HitLedger(),
  }));
  private near: Enemy[] = [];
  private view: WeaponBatch;
  constructor(def: WeaponDef, scene: THREE.Scene) {
    super(def);
    const a = new THREE.BoxGeometry(0.9, 0.12, 0.25).rotateY(0.65).translate(-0.28, 0, 0);
    const b = new THREE.BoxGeometry(0.9, 0.12, 0.25).rotateY(-0.65).translate(0.28, 0, 0);
    this.view = new WeaponBatch(scene, mergeGeometries([a, b])!, this.blades.length * 2);
    a.dispose();
    b.dispose();
  }
  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p,
      pl = ctx.player;
    if (!pl.dead && this.tick(dt, ctx, p.cd)) {
      const target = ctx.nearest(pl.x, pl.z, p.range + 3);
      const aim = target
        ? Math.atan2(target.z - pl.z, target.x - pl.x)
        : Math.atan2(pl.aim.z, pl.aim.x);
      let n = 0;
      for (const b of this.blades) {
        if (b.live) continue;
        const angle = aim + (n - (p.count - 1) / 2) * 0.19;
        b.live = true;
        b.x = b.px = b.ox = pl.x;
        b.z = b.pz = b.oz = pl.z;
        b.dx = Math.cos(angle);
        b.dz = Math.sin(angle);
        b.side = n % 2 ? -1 : 1;
        b.t = 0;
        b.back = false;
        b.hits.clear();
        if (++n >= p.count) break;
      }
      if (n) ctx.sound('disc');
    }
    for (const b of this.blades) {
      if (!b.live) continue;
      b.px = b.x;
      b.pz = b.z;
      b.t = Math.min(1, b.t + dt / p.flight);
      if (b.t >= 0.5 && !b.back) {
        b.back = true;
        b.hits.clear();
      }
      const forward = p.range * Math.sin(Math.PI * b.t);
      const side = b.side * p.range * 0.22 * Math.sin(Math.PI * 2 * b.t);
      b.x = b.ox + b.dx * forward - b.dz * side;
      b.z = b.oz + b.dz * forward + b.dx * side;
      const r = p.size * Math.sqrt(ctx.stats.areaMul);
      ctx.inRadius(
        (b.x + b.px) / 2,
        (b.z + b.pz) / 2,
        Math.hypot(b.x - b.px, b.z - b.pz) / 2 + r + 2,
        this.near,
      );
      for (const e of this.near) {
        if (
          segmentDistanceSq(e.x, e.z, b.px, b.pz, b.x, b.z) > (e.radius + r) ** 2 ||
          !b.hits.add(e.uid)
        )
          continue;
        ctx.damage(e, p.dmg, {
          source: 'crosswind',
          dirX: b.dx * (b.back ? -1 : 1),
          dirZ: b.dz * (b.back ? -1 : 1),
          knockback: 3,
          canCrit: true,
          loud: true,
        });
      }
      if (b.t >= 1) b.live = false;
    }
  }
  net(): number[] {
    const a: number[] = [];
    for (const b of this.blades) if (b.live) a.push(b.x, b.z, b.t);
    return compactWeaponNet(a);
  }
  setNet(a: number[]): void {
    for (let i = 0; i < this.blades.length; i++) {
      const b = this.blades[i],
        k = i * 3;
      const was = b.live;
      b.live = k + 2 < a.length;
      if (!b.live) continue;
      b.px = was ? b.x : a[k];
      b.pz = was ? b.z : a[k + 1];
      b.x = a[k];
      b.z = a[k + 1];
      b.t = a[k + 2];
    }
  }
  render(alpha: number, ctx: WeaponCtx): void {
    this.view.begin(this.color);
    const s = this.p.size * Math.sqrt(ctx.stats.areaMul);
    for (const b of this.blades)
      if (b.live) {
        const x = b.px + (b.x - b.px) * alpha,
          z = b.pz + (b.z - b.pz) * alpha;
        this.view.add(x, 1, z, s, s, s, b.t * 24);
        if (this.evolved) this.view.add(x, 1.05, z, s, s, s, b.t * 24 + Math.PI);
      }
    this.view.end();
  }
  dispose(): void {
    this.view.dispose();
  }
}
