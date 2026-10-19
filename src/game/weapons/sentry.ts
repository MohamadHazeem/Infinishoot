import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import { Team } from '../bullets';
import { BulletShape } from '../bulletShapes';
import { Weapon, type WeaponCtx } from './base';
import { compactWeaponNet, WeaponBatch } from './weapons3Shared';

/** Appended kind; never renumber the existing wire damage-source table. */
export const SENTRY_BULLET_KIND = 16;

export class Sentry extends Weapon {
  private units = Array.from({ length: 8 }, () => ({
    life: 0,
    x: 0,
    z: 0,
    angle: 0,
    shot: 0,
    serial: 0,
    flash: 0,
  }));
  private serial = 0;
  private bases: WeaponBatch;
  private heads: WeaponBatch;
  private barrels: WeaponBatch;
  constructor(def: WeaponDef, scene: THREE.Scene) {
    super(def);
    this.bases = new WeaponBatch(scene, new THREE.CylinderGeometry(0.5, 0.7, 0.3, 4), 8);
    this.heads = new WeaponBatch(scene, new THREE.BoxGeometry(0.8, 0.45, 0.7), 8);
    this.barrels = new WeaponBatch(scene, new THREE.BoxGeometry(1, 1, 1), 16);
  }
  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p,
      pl = ctx.player;
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    this.cd -= dt;
    this.tickReady();
    if (!pl.dead && !ctx.flags.busterDisabled && ctx.charging && this.cd <= 0) {
      const n = Math.min(8, 1 + ctx.flags.chargeSplit);
      const cap = Math.min(this.units.length, p.max + ctx.flags.chargeSplit);
      const angle = Math.atan2(pl.aim.z, pl.aim.x),
        dist = pl.landDist(2, p.deploy);
      for (let k = 0; k < n; k++) {
        let index = 0;
        for (let i = 1; i < cap; i++)
          if (this.units[i].serial < this.units[index].serial) index = i;
        const u = this.units[index],
          a = angle + (k - (n - 1) / 2) * 0.35;
        u.x = pl.x + Math.cos(a) * dist;
        u.z = pl.z + Math.sin(a) * dist;
        u.life = p.life;
        u.shot = 0;
        u.serial = ++this.serial;
        u.angle = angle;
        ctx.fx.ring(u.x, u.z, 0.5, 1.4, this.color, 0.3);
      }
      this.startCooldown((p.cd * ctx.stats.cooldownMul) / this.rightClickSpeed(ctx));
      this.armFx(ctx, this.color, 0.7);
      ctx.sound('uplink');
    }
    let sounded = false;
    for (const u of this.units) {
      u.flash = Math.max(0, u.flash - dt);
      if (u.life <= 0) continue;
      u.life -= dt;
      u.shot -= dt;
      if (pl.dead || ctx.flags.busterDisabled || u.shot > 0) continue;
      const e = ctx.nearest(u.x, u.z, p.range);
      if (!e) {
        u.shot = 0.15;
        continue;
      }
      u.angle = Math.atan2(e.z - u.z, e.x - u.x);
      u.shot += ctx.stats.cooldownMul / p.rate;
      u.flash = 0.07;
      const over = ctx.flags.overcharge,
        n = p.twin ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const side = (k - (n - 1) / 2) * 0.35;
        const dx = Math.cos(u.angle),
          dz = Math.sin(u.angle);
        ctx.bullets.spawn({
          x: u.x + dx * 0.65 - dz * side,
          z: u.z + dz * 0.65 + dx * side,
          dirX: dx,
          dirZ: dz,
          speed: 27,
          life: p.range / 27,
          radius: over ? 0.28 : 0.19,
          damage: p.dmg * ctx.stats.chargeDmg * (over ? 1.5 : 1),
          knockback: 3,
          team: Team.Player,
          color: this.color,
          width: over ? 0.5 : 0.3,
          length: this.evoId === 'cryo' ? 0.9 : 0.6,
          pierce: p.pierce,
          owner: ctx.owner,
          kind: SENTRY_BULLET_KIND,
          shape:
            this.evoId === 'ember'
              ? BulletShape.Flame
              : this.evoId === 'cryo'
                ? BulletShape.Lance
                : BulletShape.Gem,
        });
      }
      if (!sounded) {
        ctx.sound(this.evoId === 'ember' ? 'flame' : 'drone');
        sounded = true;
      }
    }
  }
  net(): number[] {
    const a = [this.muzzleT, this.ready];
    for (const u of this.units) a.push(u.life, u.x, u.z, u.angle, u.flash);
    return compactWeaponNet(a);
  }
  setNet(a: number[]): void {
    this.muzzleT = a[0] ?? 0;
    this.ready = a[1] ?? 1;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i],
        k = 2 + i * 5;
      u.life = a[k] ?? 0;
      u.x = a[k + 1] ?? 0;
      u.z = a[k + 2] ?? 0;
      u.angle = a[k + 3] ?? 0;
      u.flash = a[k + 4] ?? 0;
    }
  }
  render(): void {
    this.bases.begin('#333c57');
    this.heads.begin(this.color);
    this.barrels.begin(this.evolved ? '#ffffff' : '#566c86');
    for (const u of this.units)
      if (u.life > 0) {
        this.bases.add(u.x, 0.2, u.z, 1);
        this.heads.add(u.x, 0.7, u.z, 1, 1, 1, -u.angle);
        const n = this.p.twin ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const side = (k - (n - 1) / 2) * 0.35;
          const dx = Math.cos(u.angle),
            dz = Math.sin(u.angle);
          this.barrels.add(
            u.x + dx * 0.5 - dz * side,
            0.8,
            u.z + dz * 0.5 + dx * side,
            u.flash ? 0.55 : 0.8,
            0.17,
            0.17,
            -u.angle,
          );
        }
      }
    this.bases.end();
    this.heads.end();
    this.barrels.end();
  }
  dispose(): void {
    this.bases.dispose();
    this.heads.dispose();
    this.barrels.dispose();
  }
}
