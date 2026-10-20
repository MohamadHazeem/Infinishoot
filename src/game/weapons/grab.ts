import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { bossLike } from '../bossRules';
import { angleGap } from '../heroes3';
import { grabbable, heroes4Tuning } from '../heroes4';
import { Weapon, type WeaponCtx } from './base';

const B = heroes4Tuning.brawler;
const now = () => performance.now() / 1000;

/** A throw for src/game/systems/heroes4.ts to fly (it owns walls, cover, barrels and hazards). */
export interface ThrowReq {
  e: Enemy;
  uid: number;
  dirX: number;
  dirZ: number;
  speed: number;
  flight: number;
  dmg: number;
  splash: number;
  boom: boolean;
}

/**
 * The Brawler's right click. Press: grab the enemy in front (within `reach`,
 * a 130° cone). Hold to carry it (up to `hold` s; Giant Swing spins it round
 * you as a club), release to throw it along your aim: the system flies it,
 * smashing everything on its path, into walls, cover, pillars, barrels and
 * hazards. Bosses, mini-bosses and the Reaper can't be lifted: they get a
 * heavy uppercut instead (x`upper` damage, a short stagger). Right-click
 * rules: Quick Draw / Capacitor speed the recharge, `stats.chargeDmg` scales
 * the damage (throws and uppercuts Expose), Pacifist Core blocks it.
 * Evolutions: Piledriver (thrown enemies explode on landing) and Giant Swing.
 *
 * Network: [holding, swing angle, uppercut seq, throw seq].
 */
export class Grab extends Weapon {
  held: Enemy | null = null;
  private heldUid = -1;
  private holdT = 0;
  private wasHeld = false;
  swingA = 0;
  holding = false;
  upSeq = 0;
  throwSeq = 0;
  /** Throws this step (the system takes them). */
  readonly throws: ThrowReq[] = [];
  /** An uppercut landed this step (the system plays its hit-stop). */
  upHit = false;
  private scratch: Enemy[] = [];
  private swingHit = new Map<number, number>();
  private t = 0;
  // Drawing
  private grip: THREE.Mesh;
  private upper: THREE.Mesh;
  private upDrawn = 0;
  private upAt = -9;
  private throwDrawn = 0;
  private throwAt = -9;

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    this.cd = 0;
    const mat = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.grip = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 18, 1).rotateX(-Math.PI / 2), mat('#ffcd75', 0.7));
    // The uppercut: a tall vertical crescent.
    this.upper = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 12, 1, 0, Math.PI), mat('#ffffff', 0.85));
    for (const m of [this.grip, this.upper]) {
      m.frustumCulled = false;
      m.renderOrder = 2;
      m.scale.set(0.0001, 0.0001, 0.0001);
      scene.add(m);
    }
  }

  get evoColor(): string {
    const e = this.evoId;
    return e === 'suplex' ? '#b13e53' : e === 'cyclone' ? '#a7f070' : '#ffcd75';
  }

  net(): number[] {
    return [this.holding ? 1 : 0, Math.round(this.swingA * 100) / 100, this.upSeq, this.throwSeq];
  }
  setNet(a: number[]): void {
    this.holding = !!a[0];
    this.swingA = a[1] ?? 0;
    this.upSeq = a[2] ?? 0;
    this.throwSeq = a[3] ?? 0;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.throws.length = 0;
    this.upHit = false;
    this.t += dt;
    this.cd -= dt;
    this.tickReady();
    const pl = ctx.player;
    const press = ctx.charging && !this.wasHeld;
    this.wasHeld = ctx.charging;
    const blocked = pl.dead || ctx.flags.busterDisabled;
    if (this.held) {
      const e = this.held;
      if (!e.active || e.uid !== this.heldUid || e.hp <= 0 || blocked) {
        this.drop();
        return;
      }
      this.holdT += dt;
      this.carry(ctx, e, dt);
      if (!ctx.charging || this.holdT >= this.p.hold) this.throwHeld(ctx);
      return;
    }
    if (!press || blocked || this.cd > 0) return;
    this.tryGrab(ctx);
  }

  private tryGrab(ctx: WeaponCtx): void {
    const pl = ctx.player;
    const p = this.p;
    const reach = p.reach * Math.sqrt(ctx.stats.areaMul);
    const a0 = Math.atan2(pl.aim.z, pl.aim.x);
    let best: Enemy | null = null;
    let bestBoss: Enemy | null = null;
    let bd = Infinity;
    let bb = Infinity;
    for (const e of ctx.inRadius(pl.x, pl.z, reach + 2, this.scratch)) {
      if (e.hp <= 0 || e.pvpOwner >= 0 || e.def.hidden) continue;
      const dx = e.x - pl.x;
      const dz = e.z - pl.z;
      const d = Math.hypot(dx, dz) - e.radius;
      if (d > reach) continue;
      if (d > 0.6 && angleGap(Math.atan2(dz, dx), a0) > 1.15) continue;
      if (grabbable(e) && !bossLike(e)) {
        if (d < bd) {
          bd = d;
          best = e;
        }
      } else if (d < bb) {
        bb = d;
        bestBoss = e;
      }
    }
    if (best) return this.grabIt(ctx, best);
    if (bestBoss) return this.uppercut(ctx, bestBoss);
    // A whiff: a short reach animation, a quick retry.
    this.startCooldown(0.3);
    ctx.sound('punch');
  }

  private grabIt(ctx: WeaponCtx, e: Enemy): void {
    this.held = e;
    this.heldUid = e.uid;
    this.holdT = 0;
    this.holding = true;
    this.swingA = Math.atan2(ctx.player.aim.z, ctx.player.aim.x);
    this.swingHit.clear();
    e.squash(8);
    ctx.fx.ring(e.x, e.z, e.radius + 0.2, 1.6, this.evoColor, 0.2);
    ctx.fx.star(e.x, 1.2 * e.scale, e.z, 1.1, '#ffffff', 0.08);
    ctx.sound('grab');
    this.muzzleT = Math.max(this.muzzleT, 0.06);
  }

  /** Hold the enemy in front (or swing it round: Giant Swing). */
  private carry(ctx: WeaponCtx, e: Enemy, dt: number): void {
    const pl = ctx.player;
    const p = this.p;
    let a = Math.atan2(pl.aim.z, pl.aim.x);
    let r = B.holdDist + e.radius;
    if (p.swing) {
      this.swingA += B.swingSpeed * dt;
      a = this.swingA;
      r = B.swingR;
      // The spinning enemy is a club: everything it touches takes a hit (each once per 0.4 s).
      const dmg = p.dmg * B.swingDmg * ctx.stats.chargeDmg;
      for (const o of ctx.inRadius(e.x, e.z, e.radius + 1, this.scratch).slice()) {
        if (o === e || o.hp <= 0 || o.pvpOwner >= 0) continue;
        if ((this.swingHit.get(o.uid) ?? -1) > this.t) continue;
        this.swingHit.set(o.uid, this.t + 0.4);
        const dx = o.x - pl.x;
        const dz = o.z - pl.z;
        const d = Math.hypot(dx, dz) || 1;
        ctx.damage(o, dmg, { source: 'grab', dirX: dx / d, dirZ: dz / d, knockback: 0, canCrit: true, loud: true });
        if (o.active && !bossLike(o)) {
          o.kx = (dx / d) * B.throwKnock;
          o.kz = (dz / d) * B.throwKnock;
        }
      }
      if (this.swingHit.size > 64) this.swingHit.clear();
    } else this.swingA = a;
    e.x = pl.x + Math.cos(a) * r;
    e.z = pl.z + Math.sin(a) * r;
    e.kx = e.kz = e.vx = e.vz = 0;
    e.slowT = Math.max(e.slowT, 0.15);
    e.slowAmt = 1;
  }

  private throwHeld(ctx: WeaponCtx): void {
    const e = this.held!;
    const pl = ctx.player;
    const p = this.p;
    // Giant Swing lets go along the spin's tangent if that's closer to the aim; otherwise straight down the aim.
    const dirX = pl.aim.x;
    const dirZ = pl.aim.z;
    this.throws.push({
      e,
      uid: e.uid,
      dirX,
      dirZ,
      speed: p.speed,
      flight: p.flight,
      dmg: p.dmg * ctx.stats.chargeDmg,
      splash: p.splash * Math.sqrt(ctx.stats.areaMul),
      boom: !!p.boom,
    });
    this.drop();
    this.throwSeq = (this.throwSeq + 1) % 1000;
    this.startCooldown(p.cd / this.rightClickSpeed(ctx));
    this.armFx(ctx, this.evoColor, 0.9);
    ctx.sound('throw');
    ctx.shake(pl.x, pl.z, 0.15);
    pl.bounce(-4);
  }

  private uppercut(ctx: WeaponCtx, e: Enemy): void {
    const pl = ctx.player;
    const p = this.p;
    const dmg = p.dmg * p.upper * ctx.stats.chargeDmg;
    const dx = e.x - pl.x;
    const dz = e.z - pl.z;
    const d = Math.hypot(dx, dz) || 1;
    ctx.damage(e, dmg, { source: 'grab', dirX: dx / d, dirZ: dz / d, knockback: 2, canCrit: true, loud: true });
    if (e.active) {
      e.slowT = Math.max(e.slowT, 0.5);
      e.slowAmt = Math.max(e.slowAmt, 0.6);
      e.squash(-12);
    }
    this.upSeq = (this.upSeq + 1) % 1000;
    this.upHit = true;
    ctx.fx.star(e.x, 1.6 * e.scale, e.z, 2.6, this.evoColor, 0.16);
    ctx.particles.burst(e.x, 1, e.z, { count: 16, color: this.evoColor, color2: '#ffffff', speed: [3, 9], size: [0.12, 0.26], life: [0.2, 0.45], up: 12, gravity: 14 });
    ctx.fx.ring(e.x, e.z, e.radius, e.radius + 2.5, '#ffffff', 0.2);
    ctx.shake(e.x, e.z, 0.35);
    ctx.sound('punchHeavy');
    this.startCooldown((p.cd * 1.4) / this.rightClickSpeed(ctx));
    this.armFx(ctx, this.evoColor, 1);
    pl.bounce(6);
  }

  /** Let go without throwing (it died, or the Brawler went down). */
  drop(): void {
    const e = this.held;
    if (e && e.active) e.slowT = Math.min(e.slowT, 0.1);
    this.held = null;
    this.heldUid = -1;
    this.holding = false;
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    const t = now();
    if (this.upSeq !== this.upDrawn) {
      this.upDrawn = this.upSeq;
      this.upAt = t;
    }
    if (this.throwSeq !== this.throwDrawn) {
      this.throwDrawn = this.throwSeq;
      this.throwAt = t;
    }
    const rig = pl.rig;
    const rx = rig.root.position.x;
    const rz = rig.root.position.z;
    const aim = Math.atan2(pl.aim.z, pl.aim.x);
    // Grip ring under the held enemy.
    if (this.holding && !pl.dead) {
      const a = this.p.swing ? this.swingA : aim;
      const r = this.p.swing ? B.swingR : B.holdDist + 0.5;
      this.grip.position.set(rx + Math.cos(a) * r, 0.07, rz + Math.sin(a) * r);
      const s = 0.9 + Math.sin(t * 14) * 0.1;
      this.grip.scale.set(s, 1, s);
      (this.grip.material as THREE.MeshBasicMaterial).color.set(this.evoColor);
      // Both arms up, holding it.
      rig.armR.rotation.order = rig.armL.rotation.order = 'YXZ';
      rig.armR.rotation.x = rig.armL.rotation.x = -Math.PI * 0.62;
      if (this.p.swing) rig.body.rotation.y = -a + Math.PI / 2;
    } else this.grip.scale.set(0.0001, 1, 0.0001);
    const ua = t - this.upAt;
    if (ua < 0.25 && !pl.dead) {
      const k = ua / 0.25;
      this.upper.position.set(rx + Math.cos(aim) * 1.3, 0.6 + k * 1.2, rz + Math.sin(aim) * 1.3);
      this.upper.rotation.set(0, -aim + Math.PI / 2, 0);
      const s = 1.2 + k * 0.8;
      this.upper.scale.set(s, s, s);
      (this.upper.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      // The uppercut arm swings up.
      rig.armR.rotation.order = 'YXZ';
      rig.armR.rotation.x = -Math.PI * (0.3 + 0.6 * Math.min(1, ua / 0.08));
    } else this.upper.scale.set(0.0001, 0.0001, 0.0001);
    const ta = t - this.throwAt;
    if (ta < 0.2 && !pl.dead) {
      // The throwing arm follows through.
      rig.armR.rotation.order = 'YXZ';
      rig.armR.rotation.x = -Math.PI / 2 * (1 - ta / 0.2) - 0.3;
      rig.body.rotation.y += -0.4 * (1 - ta / 0.2);
    }
  }

  dispose(): void {
    this.drop();
    for (const m of [this.grip, this.upper]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
