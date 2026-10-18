import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import { createRetroMaterial, type RetroMaterial } from '../../render/retroMaterial';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const MAX = 9;
const THROW = 0.35;
const RANGE = 9; // max throw distance (lands at the cursor inside this)
const TICK = 0.25;

interface Vortex {
  fx: number;
  fz: number;
  x: number;
  z: number;
  /** Seconds since thrown; active once past THROW. */
  t: number;
  tickT: number;
}

/**
 * Right-click loadout weapon: throws a vortex that drags enemies to its
 * centre and grinds them. Evolutions: Event Horizon becomes a black hole with
 * a violet accretion disc that implodes in a big blast when it closes; Cryo
 * Well is an icy whirl shedding snow that freezes everything inside when it closes.
 */
export class GravityWell extends Weapon {
  private wells: Vortex[] = [];
  private hits: Enemy[] = [];
  private groups: THREE.Group[] = [];
  private swirlMat: THREE.MeshBasicMaterial;
  private rimMat: THREE.MeshBasicMaterial;
  private holeMat: RetroMaterial;
  private diskMat: THREE.MeshBasicMaterial;
  private geos: THREE.BufferGeometry[];

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } as const;
    this.swirlMat = new THREE.MeshBasicMaterial({ color: def.color, opacity: 0.35, ...additive });
    this.rimMat = new THREE.MeshBasicMaterial({ color: def.color, opacity: 0.9, ...additive });
    this.diskMat = new THREE.MeshBasicMaterial({ color: def.evos![0].color, opacity: 0.85, ...additive });
    this.holeMat = createRetroMaterial({ color: '#05010a', unlit: 1 });
    // A spiral: a ring with gaps reads as a swirl when it spins.
    const swirl = new THREE.RingGeometry(0.2, 1, 24, 1, 0, Math.PI * 1.5).rotateX(-Math.PI / 2);
    const rim = new THREE.RingGeometry(0.95, 1, 32).rotateX(-Math.PI / 2);
    const hole = new THREE.IcosahedronGeometry(0.7, 1);
    const disk = new THREE.TorusGeometry(1.3, 0.18, 4, 24).rotateX(Math.PI / 2);
    this.geos = [swirl, rim, hole, disk];
    for (let i = 0; i < MAX; i++) {
      const g = new THREE.Group();
      const s1 = new THREE.Mesh(swirl, this.swirlMat);
      const s2 = new THREE.Mesh(swirl, this.swirlMat);
      s2.rotation.y = Math.PI;
      const holeM = new THREE.Mesh(hole, this.holeMat);
      const diskM = new THREE.Mesh(disk, this.diskMat);
      holeM.position.y = diskM.position.y = 1;
      g.add(s1, s2, new THREE.Mesh(rim, this.rimMat), holeM, diskM);
      g.renderOrder = 2;
      g.visible = false;
      scene.add(g);
      this.groups.push(g);
    }
  }

  net(): number[] {
    const out: number[] = [];
    for (const w of this.wells) out.push(Math.round(w.x * 10) / 10, Math.round(w.z * 10) / 10, Math.round(w.t * 100) / 100);
    return out;
  }
  setNet(a: number[]): void {
    this.wells.length = 0;
    for (let i = 0; i + 2 < a.length; i += 3) this.wells.push({ fx: a[i], fz: a[i + 1], x: a[i], z: a[i + 1], t: a[i + 2], tickT: 0 });
  }

  /** Overcharge: bigger, longer, stronger vortexes. */
  private radius(ctx: WeaponCtx): number {
    return this.p.radius * Math.sqrt(ctx.stats.areaMul) * (ctx.flags.overcharge ? 1.25 : 1);
  }

  private life(ctx: WeaponCtx): number {
    return this.p.life + (ctx.flags.overcharge ? 1.5 : 0);
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const r = this.radius(ctx);
    const life = this.life(ctx);
    const pullMul = ctx.flags.overcharge ? 1.3 : 1;
    const dmgMul = ctx.stats.chargeDmg;
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i];
      w.t += dt;
      if (w.t < THROW) continue;
      if (w.t - dt < THROW) {
        ctx.fx.ring(w.x, w.z, r * 0.3, r, this.color, 0.3);
        ctx.fx.ring(w.x, w.z, r * 3, 0.15, '#ffffff', 0.35); // implodes inward
        ctx.shake(w.x, w.z, 0.2);
      }
      for (const e of ctx.inRadius(w.x, w.z, r, this.hits)) {
        const dx = w.x - e.x;
        const dz = w.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d < 0.4) continue;
        const pull = p.pull * pullMul * (1 - e.def.knockbackResist) * (0.4 + 0.6 * (1 - d / r)) * dt;
        e.x += (dx / d) * Math.min(pull, d);
        e.z += (dz / d) * Math.min(pull, d);
      }
      w.tickT -= dt;
      if (w.tickT <= 0) {
        w.tickT += TICK;
        let n = 0;
        for (const e of ctx.inRadius(w.x, w.z, r, this.hits)) ctx.damage(e, p.dps * TICK * dmgMul, { source: 'well', loud: n++ < 3 });
        ctx.hitBarrels(p.dps * TICK * dmgMul, (bx, bz) => (bx - w.x) ** 2 + (bz - w.z) ** 2 < r * r);
        if (p.freeze > 0) {
          const a = ctx.rng.next() * Math.PI * 2;
          ctx.particles.burst(w.x + Math.cos(a) * r * 0.6, 2.5, w.z + Math.sin(a) * r * 0.6, { count: 3, color: '#ffffff', color2: '#9fe8ff', speed: [0.5, 2], size: [0.1, 0.22], life: [0.5, 0.9], gravity: 4 });
        }
      }
      if (w.t >= THROW + life) {
        if (p.implode > 0) {
          ctx.blast(w.x, w.z, r * 0.8, p.implode * dmgMul, this.color, 'well', ['area', 'explosive']);
          ctx.sound('explode');
        }
        // Cryo Well: everything still inside freezes solid (bosses only briefly).
        if (p.freeze > 0) {
          for (const e of ctx.inRadius(w.x, w.z, r, this.hits)) {
            e.frozen = Math.max(e.frozen, p.freeze * (e.def.boss ? 0.15 : 1));
            e.shatter = Math.max(e.shatter, 0.3);
          }
          ctx.fx.ring(w.x, w.z, r * 0.3, r * 1.2, '#ffffff', 0.35);
          ctx.particles.burst(w.x, 0.6, w.z, { count: 24, color: '#ffffff', color2: '#9fe8ff', speed: [r, r * 3], size: [0.14, 0.3], life: [0.3, 0.5], drag: 5 });
          ctx.sound('freeze');
        }
        this.wells.splice(i, 1);
      }
    }

    this.cd -= dt;
    this.tickReady();
    const pl = ctx.player;
    if (!ctx.charging || pl.dead || this.cd > 0 || ctx.flags.busterDisabled) return;
    this.startCooldown((p.cd * ctx.stats.cooldownMul) / this.rightClickSpeed(ctx));
    // Mega Buster: extra vortexes side by side.
    const n = 1 + ctx.flags.chargeSplit;
    const d = pl.landDist(2.5, RANGE);
    for (let k = 0; k < n; k++) {
      const side = (k - (n - 1) / 2) * r * 1.6;
      if (this.wells.length >= MAX) this.wells.shift();
      this.wells.push({ fx: pl.x, fz: pl.z, x: pl.x + pl.aim.x * d - pl.aim.z * side, z: pl.z + pl.aim.z * d + pl.aim.x * side, t: 0, tickT: 0 });
    }
    this.armFx(ctx, this.color, 1.1);
    ctx.sound('vortex');
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const evo = this.evoId === 'horizon';
    const r = this.radius(ctx);
    this.swirlMat.color.set(this.color);
    this.rimMat.color.set(this.color);
    this.groups.forEach((g, i) => {
      const w = this.wells[i];
      g.visible = !!w;
      if (!w) return;
      const flying = w.t < THROW;
      const left = THROW + this.life(ctx) - w.t;
      // Grows in on landing, collapses in the last 0.3 s.
      const k = flying ? 0.15 : Math.min(1, (w.t - THROW) * 6, left / 0.3);
      if (flying) {
        const f = w.t / THROW;
        g.position.set(w.fx + (w.x - w.fx) * f, 0.1 + 3 * f * (1 - f), w.fz + (w.z - w.fz) * f);
      } else g.position.set(w.x, 0.08, w.z);
      const ground = Math.max(0.01, r * k);
      for (let c = 0; c < 3; c++) g.children[c].scale.setScalar(ground);
      g.rotation.y = -ctx.time * (evo ? 9 : 6);
      // Event Horizon: a black core and a tilted accretion disc.
      g.children[3].visible = g.children[4].visible = evo;
      g.children[3].scale.setScalar(Math.max(0.01, k * (1 + Math.sin(ctx.time * 12) * 0.08)));
      g.children[4].scale.setScalar(Math.max(0.01, k * (r / 4)));
      g.children[4].rotation.set(0.5, 0, Math.sin(ctx.time * 2) * 0.2);
    });
  }

  dispose(): void {
    for (const g of this.groups) this.scene.remove(g);
    for (const geo of this.geos) geo.dispose();
    this.swirlMat.dispose();
    this.rimMat.dispose();
    this.diskMat.dispose();
    this.holeMat.dispose();
  }
}
