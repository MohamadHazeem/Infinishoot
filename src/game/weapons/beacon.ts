import * as THREE from 'three';
import type { Tag } from '../../data/tags';
import type { WeaponDef } from '../../data/weapons';
import { createRetroMaterial, type RetroMaterial } from '../../render/retroMaterial';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const now = () => performance.now() / 1000;
const CHAIN: readonly Tag[] = ['chain'];
const CHAIN_SHOCK: readonly Tag[] = ['chain', 'shock'];

/**
 * The Tinker's right click: press to drop a turret beacon at your aim (the
 * cursor, 2-9 m). For `life` seconds it zaps the nearest enemies in range, and
 * its Repair Field heals heroes and bots standing in it and makes bots zap
 * faster (the field is applied by src/game/systems/heroes3.ts, which reads
 * `active`, `x`, `z` and `fieldR`). Pressing again moves it (once recharged).
 * Evolutions: Fortress Beacon (two zaps per shot, longer range, Shock) and Med
 * Bay (a big field that repairs 2.5x as fast and speeds bots up even more).
 *
 * Network: [life left, x, z, zapping, zx, zz, zx2, zz2].
 */
export class Beacon extends Weapon {
  /** Seconds left (0 = no beacon). */
  life = 0;
  x = 0;
  z = 0;
  private zapCd = 0;
  private zapT = 0;
  private zx = [0, 0];
  private zz = [0, 0];
  private zn = 0;
  private wasHeld = false;
  private area = 1;
  private skip: Enemy[] = [];
  // Drawing
  private root = new THREE.Group();
  private head: THREE.Mesh;
  private orb: THREE.Mesh;
  private field: THREE.Mesh;
  private beams: THREE.Mesh[] = [];
  private zapSeen = 0;
  private zapAt = -9;
  private bornAt = -9;
  private wasActive = false;

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    this.cd = 0; // ready from the start
    const m = (color: string, unlit = 0) => createRetroMaterial({ color, unlit });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.3, 8), m('#333c57'));
    base.position.y = 0.15;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 8), m('#ffcd75'));
    ring.position.y = 0.32;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6), m('#566c86'));
    mast.position.y = 0.9;
    this.head = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 4, 10), m('#a7f070', 0.4));
    this.head.position.y = 1.55;
    this.orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), m('#f4f4f4', 1));
    this.orb.position.y = 1.55;
    this.root.add(base, ring, mast, this.head, this.orb);
    this.field = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 32, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#a7f070', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
    this.field.frustumCulled = false;
    this.field.renderOrder = 1;
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.07, 0.07).translate(0.5, 0, 0), new THREE.MeshBasicMaterial({ color: '#fff35c', transparent: true, depthWrite: false }));
      b.frustumCulled = false;
      b.visible = false;
      this.beams.push(b);
      scene.add(b);
    }
    this.root.visible = this.field.visible = false;
    scene.add(this.root, this.field);
  }

  get active(): boolean {
    return this.life > 0;
  }

  /** Repair Field radius. */
  get fieldR(): number {
    return this.p.radius * Math.sqrt(this.area);
  }

  get evoColor(): string {
    const e = this.evoId;
    return e === 'fortress' ? '#ffcd75' : e === 'medbay' ? '#38b764' : '#a7f070';
  }

  net(): number[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return [r2(this.life), r2(this.x), r2(this.z), this.zapT > 0 ? this.zn : 0, r2(this.zx[0]), r2(this.zz[0]), r2(this.zx[1]), r2(this.zz[1]), r2(this.area)];
  }
  setNet(a: number[]): void {
    this.life = a[0] ?? 0;
    this.x = a[1] ?? 0;
    this.z = a[2] ?? 0;
    const zn = a[3] ?? 0;
    if (zn > 0) {
      this.zn = zn;
      this.zx[0] = a[4];
      this.zz[0] = a[5];
      this.zx[1] = a[6];
      this.zz[1] = a[7];
      this.zapT = 0.12;
      this.zapSeen++;
    }
    this.area = a[8] ?? 1;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.cd -= dt;
    this.tickReady();
    this.area = ctx.stats.areaMul;
    const pl = ctx.player;
    const blocked = pl.dead || ctx.flags.busterDisabled;
    const press = ctx.charging && !this.wasHeld;
    this.wasHeld = ctx.charging;
    if (press && !blocked && this.cd <= 0) this.place(ctx);
    this.zapT = Math.max(0, this.zapT - dt);
    if (this.life <= 0) return;
    this.life = Math.max(0, this.life - dt);
    if (this.life <= 0) {
      ctx.fx.ring(this.x, this.z, 0.4, 2.5, '#566c86', 0.25);
      ctx.particles.burst(this.x, 1, this.z, { count: 10, color: '#566c86', color2: '#ffcd75', speed: [2, 5], size: [0.12, 0.25], life: [0.3, 0.6], up: 4, gravity: 12 });
      return;
    }
    if ((this.zapCd -= dt) > 0) return;
    const p = this.p;
    this.zapCd = ctx.stats.cooldownMul / Math.max(0.3, p.rate);
    const shock = this.evoId === 'fortress';
    const dmg = p.dmg * ctx.stats.chargeDmg;
    this.skip.length = 0;
    this.zn = 0;
    for (let k = 0; k < p.volley; k++) {
      // A boss in range comes first, then the nearest.
      const boss = ctx.nearest(this.x, this.z, p.range, (en) => !en.def.boss || this.skip.includes(en));
      const e = boss ?? ctx.nearest(this.x, this.z, p.range, (en) => this.skip.includes(en));
      if (!e) break;
      this.skip.push(e);
      ctx.damage(e, dmg, { source: 'beacon', tags: shock ? CHAIN_SHOCK : CHAIN, dirX: e.x - this.x, dirZ: e.z - this.z, knockback: 3, canCrit: true, loud: k === 0 });
      this.zx[this.zn] = e.x;
      this.zz[this.zn] = e.z;
      this.zn++;
      ctx.fx.star(e.x, 1, e.z, 0.9, this.evoColor, 0.08);
    }
    if (this.zn > 0) {
      this.zapT = 0.12;
      this.zapSeen++;
      ctx.sound('minionZap');
    }
  }

  private place(ctx: WeaponCtx): void {
    const pl = ctx.player;
    const d = pl.landDist(2, 9);
    this.x = pl.x + pl.aim.x * d;
    this.z = pl.z + pl.aim.z * d;
    this.life = this.p.life;
    this.zapCd = 0.35;
    this.startCooldown(this.p.cd / this.rightClickSpeed(ctx));
    this.armFx(ctx, this.evoColor, 0.8);
    ctx.sound('summon');
    ctx.fx.ring(this.x, this.z, 0.5, this.fieldR * 2, this.evoColor, 0.35);
    ctx.particles.burst(this.x, 0.4, this.z, { count: 14, color: this.evoColor, color2: '#ffffff', speed: [2, 6], size: [0.12, 0.24], life: [0.25, 0.5], up: 5, gravity: 10 });
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const t = now();
    const on = this.life > 0 && !ctx.player.dead;
    if (on && !this.wasActive) this.bornAt = t;
    this.wasActive = on;
    this.root.visible = this.field.visible = on;
    for (const b of this.beams) b.visible = false;
    if (!on) return;
    // Drops in from above with a bounce.
    const age = t - this.bornAt;
    const drop = age < 0.25 ? (1 - age / 0.25) * 3 : 0;
    const squash = age < 0.4 ? 1 + Math.sin(age * 25) * 0.15 * (1 - age / 0.4) : 1;
    this.root.position.set(this.x, drop, this.z);
    this.root.scale.set(1, squash, 1);
    this.head.rotation.set(Math.PI / 2, 0, t * 4);
    const pulse = 0.85 + Math.sin(t * 8) * 0.15;
    this.orb.scale.setScalar(pulse);
    (this.head.material as RetroMaterial).uniforms.uColor.value.set(this.evoColor);
    // Blink faster in its last 2 seconds.
    const blink = this.life < 2 && Math.floor(t * 8) % 2 === 0;
    const r = this.fieldR;
    this.field.position.set(this.x, 0.06, this.z);
    this.field.scale.set(r, 1, r);
    this.field.rotation.y = t * 0.6;
    const fm = this.field.material as THREE.MeshBasicMaterial;
    fm.color.set(this.evoColor);
    fm.opacity = (blink ? 0.2 : 0.45) + Math.sin(t * 5) * 0.08;
    if (this.zapSeen !== 0) {
      this.zapSeen = 0;
      this.zapAt = t;
    }
    if (t - this.zapAt < 0.12) {
      for (let k = 0; k < this.zn && k < 2; k++) {
        const b = this.beams[k];
        const dx = this.zx[k] - this.x;
        const dz = this.zz[k] - this.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.1) continue;
        b.visible = true;
        b.position.set(this.x, 1.55 + drop, this.z);
        b.rotation.set(0, -Math.atan2(dz, dx), Math.atan2(-0.6, len));
        b.scale.set(Math.hypot(len, 0.6), 1 + Math.random(), 1 + Math.random());
        (b.material as THREE.MeshBasicMaterial).color.set(k % 2 ? '#ffffff' : '#fff35c');
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.root, this.field, ...this.beams);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    for (const m of [this.field, ...this.beams]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
