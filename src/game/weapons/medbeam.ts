import * as THREE from 'three';
import type { Tag } from '../../data/tags';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { heroes4Tuning, leechHeal, onBeam } from '../heroes4';
import { Weapon, type WeaponCtx } from './base';

const M = heroes4Tuning.medic;
const now = () => performance.now() / 1000;
const SHOCK: Tag[] = ['projectile', 'shock'];
const FROST: Tag[] = ['projectile', 'frost'];

/**
 * The Medic's left click: a mending beam while fire is held. Every tick it
 * burns through the first `pierce` enemies on the beam (closest first) and
 * mends the Medic by `leech` of the damage (capped per second). Teammates on
 * the beam are healed by src/game/systems/heroes4.ts, which reads `on`, `ox`,
 * `oz`, `angle`, `len`, `halfW` and `ticked`.
 * Evolutions: Surge Beam (more pierce, every 6th tick chains lightning; Shock)
 * and Lifeline (broad, heals twice as much, chills; Frost).
 *
 * Network: [on, angle, len, halfW]. Every machine draws the beam from its own
 * picture of the Medic's hand.
 */
export class MedBeam extends Weapon {
  /** Firing this step. */
  on = false;
  /** A damage/heal tick happened this step (the system heals teammates on it). */
  ticked = false;
  ox = 0;
  oz = 0;
  angle = 0;
  len = 10;
  halfW = 0.55;
  private tickCd = 0;
  private ticks = 0;
  private leechUsed = 0;
  private leechT = 0;
  private hitList: Enemy[] = [];
  private scratch: Enemy[] = [];
  private soundT = 0;
  private hand = { x: 0, z: 0 };
  // Drawing
  private beam: THREE.Mesh;
  private core: THREE.Mesh;
  private tip: THREE.Mesh;
  private flick = 0;

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const mat = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    // Flat ribbons along +X, one unit long, lying on the ground plane at hand height.
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0), mat('#a7f070', 0.5));
    this.core = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.35).rotateX(-Math.PI / 2).translate(0.5, 0, 0), mat('#f4f4f4', 0.9));
    this.tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat('#f4f4f4', 0.9));
    for (const m of [this.beam, this.core, this.tip]) {
      m.frustumCulled = false;
      m.renderOrder = 2;
      m.visible = true; // compiled at run start; hidden by zero scale
      m.scale.set(0.0001, 1, 0.0001);
      scene.add(m);
    }
  }

  get evoColor(): string {
    const e = this.evoId;
    return e === 'surge' ? '#73eff7' : e === 'lifeline' ? '#38b764' : '#a7f070';
  }

  net(): number[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return [this.on ? 1 : 0, r2(this.angle), r2(this.len), r2(this.halfW)];
  }
  setNet(a: number[]): void {
    this.on = !!a[0];
    this.angle = a[1] ?? 0;
    this.len = a[2] ?? 10;
    this.halfW = a[3] ?? 0.55;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.ticked = false;
    this.tickCd -= dt;
    if ((this.leechT -= dt) <= 0) {
      this.leechT += 1;
      this.leechUsed = 0;
    }
    const pl = ctx.player;
    this.on = ctx.firing && !pl.dead && !ctx.flags.busterDisabled && !pl.dashing;
    if (!this.on) {
      this.tickCd = Math.max(this.tickCd, 0);
      return;
    }
    const p = this.p;
    pl.muzzle(this.hand);
    this.ox = this.hand.x;
    this.oz = this.hand.z;
    this.angle = Math.atan2(pl.aim.z, pl.aim.x);
    this.len = p.range * Math.sqrt(ctx.stats.areaMul);
    this.halfW = p.width * Math.sqrt(ctx.stats.areaMul);
    this.muzzleT = Math.max(this.muzzleT, 0.05);
    if (this.tickCd > 0) return;
    this.tickCd += ctx.stats.cooldownMul / Math.max(1, p.rate);
    if (this.tickCd < 0) this.tickCd = 0;
    this.beamTick(ctx);
  }

  private beamTick(ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    this.ticked = true;
    this.ticks++;
    const mega = this.megaShot(ctx); // Hair Trigger: a MEGA tick
    const evo = this.evoId;
    // Enemies on the beam, closest first, up to `pierce`.
    const a = this.angle;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const mx = this.ox + ca * this.len * 0.5;
    const mz = this.oz + sa * this.len * 0.5;
    const list = this.hitList;
    list.length = 0;
    for (const e of ctx.inRadius(mx, mz, this.len * 0.5 + this.halfW + 1, this.scratch)) {
      if (e.hp <= 0 || !onBeam(e.x, e.z, e.radius, this.ox, this.oz, a, this.len, this.halfW)) continue;
      list.push(e);
    }
    list.sort((u, v) => (u.x - this.ox) * ca + (u.z - this.oz) * sa - ((v.x - this.ox) * ca + (v.z - this.oz) * sa));
    const n = Math.min(list.length, Math.round(p.pierce));
    const dmg = p.dmg * (mega ? 3 : 1);
    let dealt = 0;
    const tags = evo === 'surge' ? SHOCK : evo === 'lifeline' ? FROST : undefined;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      dealt += ctx.damage(e, dmg, { source: 'medbeam', tags, dirX: ca, dirZ: sa, knockback: 0.6, hx: e.x - ca * e.radius, hz: e.z - sa * e.radius, canCrit: true, loud: i === 0 && this.ticks % 2 === 0 });
      if (evo === 'lifeline' && e.active) {
        e.slowT = Math.max(e.slowT, 0.3);
        e.slowAmt = Math.max(e.slowAmt, M.lifelineSlow);
      }
    }
    if (evo === 'surge' && n > 0 && this.ticks % M.surgeEvery === 0) {
      const last = list[n - 1];
      if (last.active && last.hp > 0) ctx.zap(last, M.surgeHops, dmg * M.surgeDmg);
    }
    // Mend the Medic.
    const heal = leechHeal(dealt, p.leech, this.leechUsed);
    if (heal > 0) this.leechUsed += pl.heal(heal);
    ctx.hitBarrels(dmg, (x, z) => onBeam(x, z, 0.5, this.ox, this.oz, a, this.len, this.halfW));
    // A soft spark where the beam bites.
    if (n > 0 && this.ticks % 2 === 0) {
      const e = list[0];
      ctx.particles.burst(e.x, 1, e.z, { count: 2, color: this.evoColor, color2: '#ffffff', speed: [2, 5], size: [0.08, 0.16], life: [0.12, 0.25], up: 2 });
    }
    if ((this.soundT -= 1) <= 0) {
      this.soundT = 3;
      ctx.sound('healBeam');
    }
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    const show = this.on && !pl.dead && pl.rig.root.visible;
    if (!show) {
      for (const m of [this.beam, this.core, this.tip]) m.scale.set(0.0001, 1, 0.0001);
      return;
    }
    const t = now();
    // From the drawn hand (interpolated rig), not the sim position.
    const rx = pl.rig.root.position.x;
    const rz = pl.rig.root.position.z;
    const ax = Math.cos(this.angle);
    const az = Math.sin(this.angle);
    const hx = rx + ax * 0.85 + az * 0.38;
    const hz = rz + az * 0.85 - ax * 0.38;
    const len = this.len;
    this.flick = 0.85 + Math.sin(t * 40) * 0.1 + Math.sin(t * 23) * 0.05;
    const w = this.halfW * 2;
    for (const m of [this.beam, this.core]) {
      m.position.set(hx, 1.0, hz);
      m.rotation.set(0, -this.angle, 0);
    }
    this.beam.scale.set(len, 1, w * this.flick);
    this.core.scale.set(len, 1, w * (1.15 - this.flick * 0.4));
    (this.beam.material as THREE.MeshBasicMaterial).color.set(this.evoColor);
    // A spinning cross-light at the far end.
    this.tip.position.set(hx + ax * len, 1.0, hz + az * len);
    this.tip.rotation.set(t * 3, t * 5, 0);
    const s = 0.6 + this.flick * 0.4;
    this.tip.scale.set(s, s, s);
    (this.tip.material as THREE.MeshBasicMaterial).color.set(this.evoId === 'surge' ? '#ffffff' : '#f4f4f4');
    // Arm pointing forward while it streams.
    const rig = pl.rig;
    rig.armR.rotation.order = 'YXZ';
    rig.armR.rotation.x = -Math.PI / 2 + 0.05;
  }

  dispose(): void {
    for (const m of [this.beam, this.core, this.tip]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
