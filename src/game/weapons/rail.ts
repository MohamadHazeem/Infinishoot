import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import { BARREL_RADIUS } from '../barrels';
import { BULLET_Y } from '../bullets';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const TRACES = 8;
const FADE = 0.25; // seconds a rail trace stays visible
const ION_STEP = 2.4; // metres between Ion Rail detonations

interface Trace {
  x: number;
  z: number;
  dx: number;
  dz: number;
  len: number;
  t: number;
  mega: boolean;
}

/**
 * Left-click loadout weapon: a slow, hyper-velocity rail that pierces
 * everything in a long line. Evolutions: Ion Rail's line detonates in a
 * rippling chain of blasts a moment later; Storm Rail turns gold, Shocks all
 * it pierces (Shock tag from the evolution) and the first enemies hit arc
 * lightning onward.
 */
export class Rail extends Weapon {
  private shotCd = 0;
  private mz = { x: 0, z: 0 };
  private hits: Enemy[] = [];
  private traces: Trace[] = [];
  private ions: { x: number; z: number; t: number }[] = [];
  private group = new THREE.Group();
  private beams: { core: THREE.Mesh; glow: THREE.Mesh }[] = [];
  private coreMat: THREE.MeshBasicMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private geo = new THREE.BoxGeometry(1, 0.1, 1).translate(0, 0, 0.5);

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;
    this.coreMat = new THREE.MeshBasicMaterial({ color: '#ffffff', ...additive });
    this.glowMat = new THREE.MeshBasicMaterial({ color: def.color, opacity: 0.6, ...additive });
    for (let i = 0; i < TRACES; i++) {
      const core = new THREE.Mesh(this.geo, this.coreMat);
      const glow = new THREE.Mesh(this.geo, this.glowMat);
      core.renderOrder = glow.renderOrder = 2;
      core.visible = glow.visible = false;
      this.group.add(core, glow);
      this.beams.push({ core, glow });
    }
    scene.add(this.group);
  }

  net(): number[] {
    const out = [this.muzzleT];
    for (const t of this.traces) out.push(Math.round(t.x * 10) / 10, Math.round(t.z * 10) / 10, Math.round(Math.atan2(t.dz, t.dx) * 100) / 100, Math.round(t.len), Math.round(t.t * 100) / 100, t.mega ? 1 : 0);
    return out;
  }
  setNet(a: number[]): void {
    this.muzzleT = a[0] ?? 0;
    this.traces.length = 0;
    for (let i = 1; i + 5 < a.length; i += 6) this.traces.push({ x: a[i], z: a[i + 1], dx: Math.cos(a[i + 2]), dz: Math.sin(a[i + 2]), len: a[i + 3], t: a[i + 4], mega: a[i + 5] === 1 });
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    for (let i = this.traces.length - 1; i >= 0; i--) if ((this.traces[i].t += dt) > FADE) this.traces.splice(i, 1);
    const p = this.p;
    // Ion Rail: the line goes off in a ripple of small blasts.
    for (let i = this.ions.length - 1; i >= 0; i--) {
      const ion = this.ions[i];
      if ((ion.t -= dt) > 0) continue;
      ctx.blast(ion.x, ion.z, 1.6 * Math.sqrt(ctx.stats.areaMul), p.dmg * 0.5, this.color, 'rail', ['projectile', 'explosive']);
      this.ions.splice(i, 1);
    }

    this.shotCd -= dt;
    const pl = ctx.player;
    if (!ctx.firing || pl.dead || pl.dashing || ctx.flags.busterDisabled) {
      this.shotCd = Math.max(this.shotCd, 0);
      return;
    }
    if (this.shotCd > 0) return;
    this.shotCd += 1 / (p.rate / ctx.stats.cooldownMul);
    pl.muzzle(this.mz);
    const mega = this.megaShot(ctx);
    this.fire(ctx, Math.atan2(pl.aim.z, pl.aim.x), mega);
    this.muzzleT = 0.12;
    pl.recoil = 2.4;
    ctx.sound('rail');
  }

  private fire(ctx: WeaponCtx, angle: number, mega: boolean): void {
    const p = this.p;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const len = p.range;
    const half = (p.width * Math.sqrt(ctx.stats.areaMul) * (mega ? 2 : 1)) / 2;
    const ox = this.mz.x;
    const oz = this.mz.z;
    const dmg = p.dmg * (mega ? 4 : 1);
    let arcs = p.arcs ?? 0;
    // Nearest first, so Storm Rail's arcs start at the front of the line.
    const hit = ctx.inRadius(ox + dx * len * 0.5, oz + dz * len * 0.5, len * 0.5 + 1.5, this.hits).filter((e) => {
      const t = (e.x - ox) * dx + (e.z - oz) * dz;
      return t >= -e.radius && t <= len + e.radius && Math.abs((e.x - ox) * dz - (e.z - oz) * dx) <= e.radius + half;
    });
    hit.sort((a, b) => (a.x - ox) * dx + (a.z - oz) * dz - ((b.x - ox) * dx + (b.z - oz) * dz));
    for (const e of hit) {
      const t = (e.x - ox) * dx + (e.z - oz) * dz;
      ctx.damage(e, dmg, { source: 'rail', dirX: dx, dirZ: dz, knockback: 6, hx: ox + dx * t, hz: oz + dz * t, canCrit: true, loud: true });
      if (arcs > 0 && e.hp > 0) {
        arcs--;
        ctx.zap(e, 2, dmg * 0.35);
      }
    }
    ctx.hitBarrels(dmg, (bx, bz) => {
      const t = (bx - ox) * dx + (bz - oz) * dz;
      return t > 0 && t < len && Math.abs((bx - ox) * dz - (bz - oz) * dx) < half + BARREL_RADIUS;
    });
    this.traces.push({ x: ox, z: oz, dx, dz, len, t: 0, mega });
    if (this.traces.length > TRACES) this.traces.shift();
    // Sparks along the line.
    for (let d = 1; d < len; d += 2.2) {
      ctx.particles.burst(ox + dx * d, BULLET_Y, oz + dz * d, { count: 2, color: this.color, color2: '#ffffff', speed: [1, 4], size: [0.08, 0.18], life: [0.15, 0.35], up: 1.5 });
    }
    if (p.ion) for (let d = ION_STEP; d <= len; d += ION_STEP) this.ions.push({ x: ox + dx * d, z: oz + dz * d, t: 0.2 + d * 0.012 });
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const p = this.p;
    this.glowMat.color.set(this.color);
    this.beams.forEach((b, i) => {
      const t = this.traces[i];
      b.core.visible = b.glow.visible = !!t;
      if (!t) return;
      const k = 1 - t.t / FADE;
      const w = p.width * Math.sqrt(ctx.stats.areaMul) * (t.mega ? 2 : 1);
      const yaw = Math.atan2(t.dx, t.dz);
      for (const m of [b.core, b.glow]) {
        m.position.set(t.x, BULLET_Y, t.z);
        m.rotation.set(0, yaw, 0);
      }
      b.core.scale.set(w * 0.3 * k, 1, t.len);
      b.glow.scale.set(w * (1.4 + (1 - k)) * k, 2, t.len);
    });
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.geo.dispose();
    this.coreMat.dispose();
    this.glowMat.dispose();
  }
}
