import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';
import { compactWeaponNet, HitLedger, WeaponBatch } from './weapons3Shared';

export function inWhipSweep(
  x: number,
  z: number,
  base: number,
  lo: number,
  hi: number,
  reach: number,
  radius: number,
): boolean {
  const d = Math.hypot(x, z);
  if (d > reach + radius) return false;
  const a = Math.atan2(Math.sin(Math.atan2(z, x) - base), Math.cos(Math.atan2(z, x) - base));
  const pad = Math.asin(Math.min(1, radius / Math.max(radius, d)));
  return a >= lo - pad && a <= hi + pad;
}

/** Damage uses the entire swept interval each simulation step, never render timing. */
export class Whip extends Weapon {
  private swing = 0;
  private duration = 0.28;
  private base = 0;
  private side = 1;
  private mega = false;
  private hit = new HitLedger();
  private near: Enemy[] = [];
  private view: WeaponBatch;
  private tips: WeaponBatch;
  constructor(def: WeaponDef, scene: THREE.Scene) {
    super(def);
    this.view = new WeaponBatch(scene, new THREE.BoxGeometry(1, 1, 1), 32);
    this.tips = new WeaponBatch(scene, new THREE.OctahedronGeometry(0.25), 2);
  }
  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p,
      pl = ctx.player;
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    this.cd -= dt;
    if (pl.dead || ctx.flags.busterDisabled) {
      this.swing = 0;
      return;
    }
    if (ctx.firing && !pl.dashing && this.cd <= 0 && this.swing <= 0) {
      this.cd = ctx.stats.cooldownMul / p.rate;
      this.duration = Math.min(p.sweep, this.cd * 0.8);
      this.swing = this.duration;
      this.base = Math.atan2(pl.aim.z, pl.aim.x);
      this.side *= -1;
      this.hit.clear();
      this.mega = this.megaShot(ctx);
      this.muzzleT = 0.08;
      ctx.sound(this.evoId === 'sunlash' ? 'flame' : 'sweeper');
    }
    if (this.swing <= 0) return;
    const arc = (p.arc * Math.PI) / 180;
    const prev = (0.5 - this.swing / this.duration) * arc * this.side;
    this.swing = Math.max(0, this.swing - dt);
    const next = (0.5 - this.swing / this.duration) * arc * this.side;
    const reach = p.range * Math.sqrt(ctx.stats.areaMul) * (this.mega ? 1.4 : 1);
    ctx.inRadius(pl.x, pl.z, reach + 2, this.near);
    for (const e of this.near) {
      const radius = e.radius + p.width;
      const front = inWhipSweep(
        e.x - pl.x,
        e.z - pl.z,
        this.base,
        Math.min(prev, next),
        Math.max(prev, next),
        reach,
        radius,
      );
      const back =
        p.twin &&
        inWhipSweep(
          e.x - pl.x,
          e.z - pl.z,
          this.base + Math.PI,
          Math.min(prev, next),
          Math.max(prev, next),
          reach,
          radius,
        );
      if ((!front && !back) || !this.hit.add(e.uid)) continue;
      ctx.damage(e, p.dmg * (this.mega ? 4 : 1), {
        source: 'whip',
        dirX: (e.x - pl.x) / (reach || 1),
        dirZ: (e.z - pl.z) / (reach || 1),
        knockback: 4,
        canCrit: true,
        loud: true,
      });
    }
  }
  net(): number[] {
    return compactWeaponNet([
      this.muzzleT,
      this.swing,
      this.duration,
      this.base,
      this.side,
      this.mega ? 1 : 0,
    ]);
  }
  setNet(a: number[]): void {
    this.muzzleT = a[0] ?? 0;
    this.swing = a[1] ?? 0;
    this.duration = a[2] || 0.28;
    this.base = a[3] ?? 0;
    this.side = a[4] || 1;
    this.mega = !!a[5];
  }
  render(_alpha: number, ctx: WeaponCtx): void {
    this.view.begin(this.color);
    this.tips.begin('#ffffff');
    if (this.swing > 0) {
      const p = this.p,
        pl = ctx.player;
      const reach = p.range * Math.sqrt(ctx.stats.areaMul) * (this.mega ? 1.4 : 1);
      const angle =
        this.base + (((0.5 - this.swing / this.duration) * p.arc * Math.PI) / 180) * this.side;
      for (let arm = 0; arm < (p.twin ? 2 : 1); arm++) {
        let x = pl.x,
          z = pl.z;
        for (let i = 1; i <= 12; i++) {
          const a = angle + arm * Math.PI - Math.sin((i / 12) * Math.PI) * 0.28 * this.side;
          const tx = pl.x + (Math.cos(a) * reach * i) / 12,
            tz = pl.z + (Math.sin(a) * reach * i) / 12;
          this.view.line(x, z, tx, tz, p.width * (1 - i / 18), 1.1);
          x = tx;
          z = tz;
        }
        this.tips.add(x, 1.1, z, this.mega ? 2 : 1);
      }
    }
    this.view.end();
    this.tips.end();
  }
  dispose(): void {
    this.view.dispose();
    this.tips.dispose();
  }
}
