import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import { BARREL_RADIUS } from '../barrels';
import { BULLET_Y } from '../bullets';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const TICK = 0.15;
const FAN = 0.24; // radians between side beams
const MAX_BEAMS = 5;
/** Beam i's angle offset in FAN steps: centre, then alternating sides. */
const SLOT = [0, -1, 1, -2, 2];
const PRISM = ['#fff35c', '#5cf2ff', '#a7f070'];

/**
 * Left-click loadout weapon: a held beam that damages everything along it;
 * Splitter ranks fan it into side beams. Evolutions: Prism Lance fans into
 * five rainbow beams; Scorch Ray fuses into one thick blazing beam that
 * ignites (its Fire tag comes from the evolution).
 */
export class Laser extends Weapon {
  private on = 0;
  /** Beam count (3 once evolved), synced for clients. */
  private count = 1;
  /** Hair Trigger MEGA pulse flash. */
  private megaT = 0;
  private tickT = 0;
  private soundT = 0;
  private mz = { x: 0, z: 0 };
  private hits: Enemy[] = [];
  private group = new THREE.Group();
  private beams: { core: THREE.Mesh; glow: THREE.Mesh; mat: THREE.MeshBasicMaterial; glowMat: THREE.MeshBasicMaterial }[] = [];
  private geo = new THREE.BoxGeometry(1, 0.12, 1).translate(0, 0, 0.5);

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;
    for (let i = 0; i < MAX_BEAMS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', ...additive });
      const glowMat = new THREE.MeshBasicMaterial({ color: def.color, opacity: 0.55, ...additive });
      const core = new THREE.Mesh(this.geo, mat);
      const glow = new THREE.Mesh(this.geo, glowMat);
      core.renderOrder = glow.renderOrder = 2;
      this.group.add(core, glow);
      this.beams.push({ core, glow, mat, glowMat });
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  net(): number[] {
    return [this.on, this.muzzleT, this.count, Math.round(this.megaT * 100) / 100];
  }
  setNet(a: number[]): void {
    this.on = a[0] ?? 0;
    this.muzzleT = a[1] ?? 0;
    this.count = a[2] ?? 1;
    this.megaT = a[3] ?? 0;
  }

  private get range(): number {
    return this.p.range;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    const pl = ctx.player;
    this.megaT = Math.max(0, this.megaT - dt);
    this.count = this.p.focus > 0 ? 1 : Math.min(MAX_BEAMS, this.p.beams);
    this.on = ctx.firing && !pl.dead && !pl.dashing && !ctx.flags.busterDisabled ? 1 : 0;
    if (!this.on) {
      this.tickT = 0;
      return;
    }
    this.muzzleT = 0.03;
    this.tickT -= dt;
    this.soundT -= dt;
    if (this.tickT > 0) return;
    this.tickT += TICK * ctx.stats.cooldownMul;
    if (this.soundT <= 0) {
      ctx.sound('zap');
      this.soundT = 0.3;
    }
    const p = this.p;
    pl.muzzle(this.mz);
    const base = Math.atan2(pl.aim.z, pl.aim.x);
    // Hair Trigger: every Nth tick is a MEGA pulse.
    const mega = this.megaShot(ctx);
    if (mega) this.megaT = 0.15;
    const width = p.width * Math.sqrt(ctx.stats.areaMul) * (mega ? 2 : 1);
    for (let b = 0; b < this.count; b++) {
      const a = base + SLOT[b] * FAN;
      const dmg = p.dps * TICK * (b === 0 ? 1 : 0.6) * (mega ? 4 : 1);
      this.burn(ctx, Math.cos(a), Math.sin(a), width, dmg);
    }
    // Scorch Ray: embers drift off the beam.
    if (this.evoId === 'scorch') {
      const d = 1 + ctx.rng.next() * (p.range - 1);
      ctx.particles.burst(this.mz.x + pl.aim.x * d, BULLET_Y, this.mz.z + pl.aim.z * d, { count: 3, color: '#ff7a2f', color2: '#ffcd75', speed: [1, 3], size: [0.15, 0.3], life: [0.2, 0.4], up: 2.5 });
    }
  }

  /** Damage every enemy within `width` of the beam segment. */
  private burn(ctx: WeaponCtx, dx: number, dz: number, width: number, dmg: number): void {
    const r = this.range;
    const cx = this.mz.x + dx * r * 0.5;
    const cz = this.mz.z + dz * r * 0.5;
    const ox = this.mz.x;
    const oz = this.mz.z;
    ctx.hitBarrels(dmg, (bx, bz) => {
      const t = (bx - ox) * dx + (bz - oz) * dz;
      return t > 0 && t < r && Math.abs((bx - ox) * dz - (bz - oz) * dx) < width * 0.5 + BARREL_RADIUS;
    });
    for (const e of ctx.inRadius(cx, cz, r * 0.5 + 1.5, this.hits)) {
      const ex = e.x - this.mz.x;
      const ez = e.z - this.mz.z;
      const t = ex * dx + ez * dz;
      if (t < -e.radius || t > r + e.radius) continue;
      const off = Math.abs(ex * dz - ez * dx);
      if (off > e.radius + width * 0.5) continue;
      ctx.damage(e, dmg, { source: 'laser', dirX: dx, dirZ: dz, knockback: 0.6, hx: this.mz.x + dx * t, hz: this.mz.z + dz * t, canCrit: true, loud: true });
    }
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    this.group.visible = this.on > 0 && !pl.dead;
    if (!this.group.visible) return;
    const evo = this.evoId === 'prism';
    const scorch = this.evoId === 'scorch';
    const p = this.p;
    pl.muzzle(this.mz);
    // Interpolated hero position is what's drawn; offset the muzzle to match.
    const ox = pl.rig.root.position.x - pl.x;
    const oz = pl.rig.root.position.z - pl.z;
    const base = Math.atan2(pl.aim.x, pl.aim.z); // three.js yaw: +Z forward
    const flicker = 0.85 + Math.random() * 0.3;
    const width = p.width * Math.sqrt(ctx.stats.areaMul) * flicker * (this.megaT > 0 ? 2 : 1);
    this.beams.forEach((bm, i) => {
      const shown = i < this.count;
      bm.core.visible = bm.glow.visible = shown;
      if (!shown) return;
      const yaw = base - SLOT[i] * FAN; // three.js yaw turns the other way
      const len = this.range * (i === 0 ? 1 : 0.85);
      for (const m of [bm.core, bm.glow]) {
        m.position.set(this.mz.x + ox, BULLET_Y, this.mz.z + oz);
        m.rotation.set(0, yaw, 0);
      }
      bm.core.scale.set(width * 0.35, 1, len);
      bm.glow.scale.set(width * (evo ? 1.6 : 1.2), 2, len);
      bm.glowMat.color.set(this.megaT > 0 ? '#ff7a2f' : evo ? PRISM[(i + Math.floor(ctx.time * 8)) % 3] : scorch ? (Math.sin(ctx.time * 30) > 0 ? '#ff7a2f' : '#ef7d57') : this.def.color);
      bm.mat.color.set(scorch ? '#ffcd75' : '#ffffff');
    });
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.geo.dispose();
    for (const b of this.beams) {
      b.mat.dispose();
      b.glowMat.dispose();
    }
  }
}
