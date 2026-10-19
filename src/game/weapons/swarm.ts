import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';
import { compactWeaponNet, segmentDistanceSq, WeaponBatch, weapons3Tuning } from './weapons3Shared';

/** A staggered wave: launch wide, accelerate, then steer onto the nearest foe. */
export class Swarm extends Weapon {
  private missiles = Array.from({ length: 96 }, () => ({
    live: false,
    x: 0,
    z: 0,
    px: 0,
    pz: 0,
    angle: 0,
    age: 0,
    target: null as Enemy | null,
    targetUid: -1,
    seek: 0,
  }));
  private pending = 0;
  private wave = 0;
  private gap = 0;
  private view: WeaponBatch;
  constructor(def: WeaponDef, scene: THREE.Scene) {
    super(def);
    const body = new THREE.ConeGeometry(0.16, 0.7, 4).rotateZ(-Math.PI / 2);
    const fins = new THREE.BoxGeometry(0.22, 0.08, 0.5).translate(-0.2, 0, 0);
    this.view = new WeaponBatch(scene, mergeGeometries([body, fins])!, 96);
    body.dispose();
    fins.dispose();
  }
  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p,
      pl = ctx.player;
    if (!pl.dead && this.tick(dt, ctx, p.cd) && !this.pending && ctx.nearest(pl.x, pl.z, 17)) {
      this.pending = p.count;
      this.wave = 0;
      this.gap = 0;
      ctx.sound('missile');
    }
    if (pl.dead) this.pending = 0;
    this.gap -= dt;
    if (this.pending > 0 && this.gap <= 0) {
      const m = this.missiles.find((v) => !v.live);
      if (m) {
        const target = ctx.nearest(pl.x, pl.z, 17);
        const base = target
          ? Math.atan2(target.z - pl.z, target.x - pl.x)
          : Math.atan2(pl.aim.z, pl.aim.x);
        m.live = true;
        m.x = m.px = pl.x;
        m.z = m.pz = pl.z;
        m.age = 0;
        m.seek = 0;
        m.angle = base + (this.wave % 2 ? -1 : 1) * (0.7 + (this.wave % 3) * 0.22);
        m.target = target;
        m.targetUid = target?.uid ?? -1;
      }
      this.pending--;
      this.wave++;
      this.gap += p.gap;
    }
    for (const m of this.missiles) {
      if (!m.live) continue;
      m.age += dt;
      m.seek -= dt;
      m.px = m.x;
      m.pz = m.z;
      if (m.seek <= 0) {
        m.seek = 0.15;
        if (!m.target?.alive || m.target.hp <= 0 || m.target.uid !== m.targetUid) {
          m.target = ctx.nearest(m.x, m.z, 18);
          m.targetUid = m.target?.uid ?? -1;
        }
      }
      const e = m.target?.uid === m.targetUid ? m.target : null;
      if (e?.alive && m.age > 0.14) {
        const target = Math.atan2(e.z - m.z, e.x - m.x);
        const delta = Math.atan2(Math.sin(target - m.angle), Math.cos(target - m.angle));
        m.angle += Math.max(
          -dt * weapons3Tuning.swarmTurn,
          Math.min(dt * weapons3Tuning.swarmTurn, delta),
        );
      }
      const step = p.speed * Math.min(1, 0.35 + m.age * 2) * dt;
      m.x += Math.cos(m.angle) * step;
      m.z += Math.sin(m.angle) * step;
      if (
        (e?.alive && segmentDistanceSq(e.x, e.z, m.px, m.pz, m.x, m.z) < (e.radius + 0.22) ** 2) ||
        m.age > weapons3Tuning.swarmLife
      ) {
        ctx.blast(m.x, m.z, p.radius * Math.sqrt(ctx.stats.areaMul), p.dmg, this.color, 'swarm');
        m.live = false;
      }
    }
  }
  net(): number[] {
    const a: number[] = [];
    for (const m of this.missiles) if (m.live) a.push(m.x, m.z, m.angle);
    return compactWeaponNet(a);
  }
  setNet(a: number[]): void {
    for (let i = 0; i < this.missiles.length; i++) {
      const m = this.missiles[i],
        k = i * 3,
        was = m.live;
      m.live = k + 2 < a.length;
      if (!m.live) continue;
      m.px = was ? m.x : a[k];
      m.pz = was ? m.z : a[k + 1];
      m.x = a[k];
      m.z = a[k + 1];
      m.angle = a[k + 2];
    }
  }
  render(alpha: number): void {
    this.view.begin(this.color);
    const s = this.evolved ? 1.45 : 1;
    for (const m of this.missiles)
      if (m.live)
        this.view.add(
          m.px + (m.x - m.px) * alpha,
          1.05,
          m.pz + (m.z - m.pz) * alpha,
          s,
          s,
          s,
          -m.angle,
        );
    this.view.end();
  }
  dispose(): void {
    this.view.dispose();
  }
}
