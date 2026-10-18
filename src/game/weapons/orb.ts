import * as THREE from 'three';
import { SIM_DT } from '../../core/loop';
import type { Tag } from '../../data/tags';
import type { WeaponDef } from '../../data/weapons';
import { createRetroMaterial, type RetroMaterial } from '../../render/retroMaterial';
import { BULLET_Y } from '../bullets';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const MAX = 12;
const STORM_TAGS: Tag[] = ['projectile', 'area', 'shock'];

interface Orb {
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  tickT: number;
  /** Hair Trigger MEGA orb: bigger and x4 damage. */
  mega: boolean;
}

/**
 * Left-click loadout weapon: slow plasma orbs that zap the nearest enemies as
 * they drift. Evolutions: Storm Sphere orbs turn violet with a spinning storm
 * ring, Shock what they zap and burst when they fade; Cryo Sphere orbs are
 * big, slow and icy and freeze what they zap for a moment.
 */
export class PlasmaOrb extends Weapon {
  private shotCd = 0;
  private orbs: Orb[] = [];
  private mz = { x: 0, z: 0 };
  private hits: Enemy[] = [];
  private meshes: THREE.Group[] = [];
  private coreMat: RetroMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private geos: THREE.BufferGeometry[];

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;
    this.coreMat = createRetroMaterial({ color: '#ffffff', unlit: 1 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: def.color, opacity: 0.5, ...additive });
    this.ringMat = new THREE.MeshBasicMaterial({ color: def.evos![0].color, opacity: 0.9, side: THREE.DoubleSide, ...additive });
    const core = new THREE.IcosahedronGeometry(0.22, 0);
    const glow = new THREE.IcosahedronGeometry(0.5, 1);
    const ring = new THREE.TorusGeometry(0.75, 0.06, 4, 12).rotateX(Math.PI / 2);
    this.geos = [core, glow, ring];
    for (let i = 0; i < MAX; i++) {
      const g = new THREE.Group();
      const ringA = new THREE.Mesh(ring, this.ringMat);
      const ringB = new THREE.Mesh(ring, this.ringMat);
      ringB.rotation.x = Math.PI / 2;
      g.add(new THREE.Mesh(core, this.coreMat), new THREE.Mesh(glow, this.glowMat), ringA, ringB);
      g.visible = false;
      g.renderOrder = 2;
      scene.add(g);
      this.meshes.push(g);
    }
  }

  net(): number[] {
    const out = [this.muzzleT];
    for (const o of this.orbs) out.push(Math.round(o.x * 10) / 10, Math.round(o.z * 10) / 10, o.mega ? 1 : 0);
    return out;
  }
  setNet(a: number[]): void {
    this.muzzleT = a[0] ?? 0;
    this.orbs.length = 0;
    for (let i = 1; i + 2 < a.length; i += 3) this.orbs.push({ x: a[i], z: a[i + 1], vx: 0, vz: 0, life: 1, tickT: 0, mega: a[i + 2] === 1 });
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    const p = this.p;
    const evo = this.evoId === 'storm';
    const r = p.radius * Math.sqrt(ctx.stats.areaMul);
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.x += o.vx * dt;
      o.z += o.vz * dt;
      o.life -= dt;
      o.tickT -= dt;
      if (o.tickT <= 0) {
        o.tickT += p.tick;
        let n = 0;
        // Zap only the nearest few (p.zaps): the orb is a precise shot, not a giant aura.
        const near = ctx.inRadius(o.x, o.z, o.mega ? r * 1.5 : r, this.hits);
        near.sort((a, b) => (a.x - o.x) ** 2 + (a.z - o.z) ** 2 - ((b.x - o.x) ** 2 + (b.z - o.z) ** 2));
        if (near.length > p.zaps * (o.mega ? 2 : 1)) near.length = p.zaps * (o.mega ? 2 : 1);
        for (const e of near) {
          ctx.damage(e, p.dmg * (o.mega ? 4 : 1), { source: 'orb', tags: evo ? STORM_TAGS : undefined, knockback: 0, canCrit: true, loud: n < 3 });
          // Cryo Sphere: a short freeze on whatever it zaps (not bosses), opening the Frost combos.
          if (p.chill > 0 && e.hp > 0 && !e.def.boss) e.frozen = Math.max(e.frozen, p.chill);
          if (n++ < 4) ctx.fx.star(e.x, 0.9, e.z, 0.7, this.color, 0.08);
        }
        if (n) ctx.sound('zap');
        if (p.chill > 0) ctx.particles.burst(o.x, BULLET_Y, o.z, { count: 2, color: '#ffffff', color2: '#9fe8ff', speed: [0.5, 2], size: [0.1, 0.2], life: [0.3, 0.6], gravity: 3 });
        const rr = (o.mega ? r * 1.5 : r) ** 2;
        ctx.hitBarrels(p.dmg, (bx, bz) => (bx - o.x) ** 2 + (bz - o.z) ** 2 < rr);
      }
      if (o.life <= 0) {
        if (p.burst > 0) ctx.blast(o.x, o.z, r, p.dmg * p.burst, this.color, 'orb');
        this.orbs.splice(i, 1);
      }
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
    if (this.orbs.length >= MAX) this.orbs.shift();
    this.orbs.push({ x: this.mz.x, z: this.mz.z, vx: pl.aim.x * p.speed, vz: pl.aim.z * p.speed, life: p.life, tickT: 0.05, mega });
    this.muzzleT = 0.06;
    pl.recoil = 1.2;
    ctx.sound('chargeShot');
    ctx.particles.burst(this.mz.x, BULLET_Y, this.mz.z, { count: 6, color: this.color, color2: '#ffffff', speed: [2, 6], size: [0.1, 0.22], life: [0.1, 0.2], dir: { x: pl.aim.x, z: pl.aim.z, spread: 1.4 } });
  }

  render(alpha: number, ctx: WeaponCtx): void {
    const evo = this.evolved;
    const cryo = this.evoId === 'cryo';
    this.glowMat.color.set(this.color);
    this.ringMat.color.set(this.color);
    this.meshes.forEach((g, i) => {
      const o = this.orbs[i];
      g.visible = !!o;
      if (!o) return;
      // Orbs move linearly; draw them where they'll be this frame.
      g.position.set(o.x + o.vx * (alpha - 1) * SIM_DT, BULLET_Y, o.z + o.vz * (alpha - 1) * SIM_DT);
      const s = (evo ? (cryo ? 1.8 : 1.5) : 1) * (o.mega ? 1.8 : 1) * (1 + Math.sin(ctx.time * 30 + i) * 0.08);
      g.scale.setScalar(s);
      g.children[2].visible = g.children[3].visible = evo;
      // Storm rings spin fast; Cryo rings turn slowly like a snowflake.
      g.rotation.set(cryo ? 0 : ctx.time * 3 + i, ctx.time * (cryo ? 1 : 5), 0);
    });
  }

  dispose(): void {
    for (const g of this.meshes) this.scene.remove(g);
    for (const geo of this.geos) geo.dispose();
    this.coreMat.dispose();
    this.glowMat.dispose();
    this.ringMat.dispose();
  }
}
