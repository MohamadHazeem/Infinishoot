import * as THREE from 'three';
import type { Tag } from '../../data/tags';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const MAX = 9;
const FLASH = 0.35; // seconds the beam shows after impact (unless it lingers)
const TICK = 0.25;
const SUN_TAGS: Tag[] = ['area', 'fire'];

interface Strike {
  x: number;
  z: number;
  /** Seconds since called; the beam lands at `delay`. */
  t: number;
  delay: number;
  r: number;
  tickT: number;
}

/**
 * Right-click loadout weapon: marks a spot where you aim, then a satellite
 * beam slams down from the sky. Evolutions: Sun Lance turns it into a blazing
 * orange column that lingers, burning everything under it; Storm Barrage calls
 * three crackling gold beams around the target that Shock (tag from the evolution).
 */
export class OrbitalStrike extends Weapon {
  private strikes: Strike[] = [];
  private hits: Enemy[] = [];
  private groups: THREE.Group[] = [];
  private ringMat: THREE.MeshBasicMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  private coreMat: THREE.MeshBasicMaterial;
  private geos: THREE.BufferGeometry[];

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } as const;
    this.ringMat = new THREE.MeshBasicMaterial({ color: def.color, opacity: 0.9, ...additive });
    this.beamMat = new THREE.MeshBasicMaterial({ color: def.color, opacity: 0.55, ...additive });
    this.coreMat = new THREE.MeshBasicMaterial({ color: '#ffffff', opacity: 0.9, ...additive });
    const ring = new THREE.RingGeometry(0.9, 1, 32).rotateX(-Math.PI / 2);
    const tick = new THREE.RingGeometry(0.2, 1, 4, 1, 0, Math.PI / 10).rotateX(-Math.PI / 2);
    // Unit-radius column, 30 m tall, standing on the ground.
    const beam = new THREE.CylinderGeometry(1, 1, 30, 16, 1, true).translate(0, 15, 0);
    this.geos = [ring, tick, beam];
    for (let i = 0; i < MAX; i++) {
      const g = new THREE.Group();
      const marks = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(tick, this.ringMat);
        m.rotation.y = (k / 4) * Math.PI * 2;
        marks.add(m);
      }
      g.add(new THREE.Mesh(ring, this.ringMat), marks, new THREE.Mesh(beam, this.beamMat), new THREE.Mesh(beam, this.coreMat));
      g.renderOrder = 2;
      g.visible = false;
      scene.add(g);
      this.groups.push(g);
    }
  }

  net(): number[] {
    const out: number[] = [];
    for (const s of this.strikes) out.push(Math.round(s.x * 10) / 10, Math.round(s.z * 10) / 10, Math.round(s.t * 100) / 100, s.delay, Math.round(s.r * 10) / 10);
    return out;
  }
  setNet(a: number[]): void {
    this.strikes.length = 0;
    for (let i = 0; i + 4 < a.length; i += 5) this.strikes.push({ x: a[i], z: a[i + 1], t: a[i + 2], delay: a[i + 3], r: a[i + 4], tickT: 0 });
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const over = ctx.flags.overcharge;
    const dmg = p.dmg * ctx.stats.chargeDmg * (over ? 1.5 : 1);
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      const before = s.t;
      s.t += dt;
      if (before < s.delay && s.t >= s.delay) {
        ctx.blast(s.x, s.z, s.r, dmg, this.color, 'orbital');
        ctx.sound('beam');
        ctx.shake(s.x, s.z, 0.55);
        ctx.fx.ring(s.x, s.z, s.r, s.r * 3, '#ffffff', 0.35);
        ctx.particles.burst(s.x, 0.5, s.z, { count: 30, color: this.color, color2: '#ffffff', speed: [4, 12], size: [0.2, 0.45], life: [0.3, 0.7], up: 9, gravity: 14 });
      }
      // Sun Lance: the column lingers and burns.
      if (s.t >= s.delay && p.linger > 0) {
        s.tickT -= dt;
        if (s.tickT <= 0) {
          s.tickT += TICK;
          let n = 0;
          for (const e of ctx.inRadius(s.x, s.z, s.r, this.hits)) ctx.damage(e, p.dps * TICK * ctx.stats.chargeDmg, { source: 'orbital', tags: SUN_TAGS, loud: n++ < 3 });
          ctx.hitBarrels(p.dps * TICK, (bx, bz) => (bx - s.x) ** 2 + (bz - s.z) ** 2 < s.r * s.r);
        }
      }
      if (s.t >= s.delay + Math.max(FLASH, p.linger)) this.strikes.splice(i, 1);
    }

    this.cd -= dt;
    this.tickReady();
    const pl = ctx.player;
    if (!ctx.charging || pl.dead || this.cd > 0 || ctx.flags.busterDisabled) return;
    this.startCooldown((p.cd * ctx.stats.cooldownMul) / this.rightClickSpeed(ctx));
    const r = p.radius * Math.sqrt(ctx.stats.areaMul) * (over ? 1.3 : 1);
    const d = pl.landDist(2.5, p.range);
    const tx = pl.x + pl.aim.x * d;
    const tz = pl.z + pl.aim.z * d;
    // Storm Barrage: beams in a ring around the target. Mega Buster: extra beams side by side.
    const ring = p.count ?? 1;
    const n = ring + ctx.flags.chargeSplit;
    for (let k = 0; k < n; k++) {
      let x: number;
      let z: number;
      if (k < ring && ring > 1) {
        const a = (k / ring) * Math.PI * 2 + Math.atan2(pl.aim.z, pl.aim.x);
        x = tx + Math.cos(a) * r * 1.2;
        z = tz + Math.sin(a) * r * 1.2;
      } else {
        // The plain beam plus Mega Buster's extras sit side by side across the aim, centred on the target.
        const j = ring > 1 ? k - ring + 1 : k;
        const m = ring > 1 ? n - ring + 1 : n;
        const side = (j - (m - 1) / 2) * r * 1.8;
        x = tx - pl.aim.z * side;
        z = tz + pl.aim.x * side;
      }
      if (this.strikes.length >= MAX) this.strikes.shift();
      this.strikes.push({ x, z, t: 0, delay: p.delay + k * 0.08, r, tickT: 0 });
    }
    this.armFx(ctx, this.color, 0.8);
    ctx.sound('uplink');
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const p = this.p;
    const evo = this.evoId === 'sun';
    const barrage = this.evoId === 'barrage';
    this.ringMat.color.set(this.color);
    this.beamMat.color.set(this.color);
    this.groups.forEach((g, i) => {
      const s = this.strikes[i];
      g.visible = !!s;
      if (!s) return;
      g.position.set(s.x, 0.08, s.z);
      const [ring, marks, beam, core] = g.children;
      const aiming = s.t < s.delay;
      // Targeting: the ring closes in and the reticle spins; a thin guide beam flickers.
      const k = aiming ? s.t / s.delay : 1;
      ring.scale.setScalar(s.r * (aiming ? 1.8 - 0.8 * k : 1));
      marks.scale.setScalar(s.r * 1.1);
      marks.rotation.y = ctx.time * (aiming ? 6 : 2);
      marks.visible = aiming;
      const after = s.t - s.delay;
      const fade = aiming ? 1 : p.linger > 0 ? Math.min(1, (p.linger - after) / 0.3) : 1 - after / FLASH;
      const w = aiming ? 0.06 * (0.5 + Math.random()) : s.r * (evo ? 0.9 : barrage ? 0.5 : 0.75) * Math.max(0, fade) * (1 + Math.sin(ctx.time * (barrage ? 90 : 40)) * (barrage ? 0.25 : 0.06));
      beam.scale.set(w, 1, w);
      core.scale.set(w * 0.35, 1, w * 0.35);
      beam.rotation.y = ctx.time * 3;
    });
  }

  dispose(): void {
    for (const g of this.groups) this.scene.remove(g);
    for (const geo of this.geos) geo.dispose();
    this.ringMat.dispose();
    this.beamMat.dispose();
    this.coreMat.dispose();
  }
}
