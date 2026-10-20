import * as THREE from 'three';
import type { Tag } from '../../data/tags';
import type { WeaponDef } from '../../data/weapons';
import { Team } from '../bullets';
import type { Enemy } from '../enemies';
import { bossLike } from '../bossRules';
import { inSwordArc } from '../heroes3';
import { heroes4Tuning, nextPunch, punchShape } from '../heroes4';
import { Weapon, type WeaponCtx } from './base';

const B = heroes4Tuning.brawler;
const now = () => performance.now() / 1000;
const SHOCK: Tag[] = ['area', 'shock'];
const SLAM: Tag[] = ['area', 'explosive', 'fire'];

/**
 * The Brawler's left click: a 3-punch combo while fire is held. Jab and cross
 * hit a short arc in front (alternating fists); the third punch is a haymaker
 * with more reach and a launch: enemies fly off at up to `launchMax` m/s, fast
 * enough to count as knocked into lava, thorns, ice walls and quicksand
 * (src/game/hazards.ts `knockedIn`). Punches knock enemy bullets away.
 * Haymaker ranks add a shockwave round the target. Evolutions: Thunder Fists
 * (every punch Shocks, the haymaker chains lightning) and Meteor Fist (the
 * haymaker is a burning ground slam).
 *
 * Network: [seq, step, angle, reach, arc]. Every machine draws the punch from
 * `seq` changes.
 */
export class Fists extends Weapon {
  private punchCd = 0;
  private idle = 9;
  /** Combo step of the last punch: 0 jab, 1 cross, 2 haymaker; -1 before the first. */
  step = -1;
  seq = 0;
  angle = 0;
  reach = 2;
  arc = 95;
  /** Enemies the haymaker hit this step (the system plays its hit-stop and shake). */
  hayHits = 0;
  /** Any punch landed this step (camera kick). */
  hits = 0;
  private scratch: Enemy[] = [];
  // Drawing
  private swoosh: THREE.Mesh;
  private shock: THREE.Mesh;
  private drawnSeq = 0;
  private punchAt = -9;

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const mat = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    // A short, thick swoosh arc in front of the fist, and a flat shock ring for the haymaker.
    this.swoosh = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 10, 1, -0.7, 1.4).rotateX(-Math.PI / 2), mat('#ffffff', 0.8));
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 20, 1).rotateX(-Math.PI / 2), mat('#ffcd75', 0.7));
    for (const m of [this.swoosh, this.shock]) {
      m.frustumCulled = false;
      m.renderOrder = 2;
      m.scale.set(0.0001, 1, 0.0001);
      scene.add(m);
    }
  }

  get evoColor(): string {
    const e = this.evoId;
    return e === 'thunder' ? '#73eff7' : e === 'meteor' ? '#ffcd75' : '#ef7d57';
  }

  net(): number[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return [this.seq, this.step, r2(this.angle), r2(this.reach), Math.round(this.arc)];
  }
  setNet(a: number[]): void {
    this.seq = a[0] ?? 0;
    this.step = a[1] ?? -1;
    this.angle = a[2] ?? 0;
    this.reach = a[3] ?? 2;
    this.arc = a[4] ?? 95;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.hayHits = this.hits = 0;
    this.idle += dt;
    this.punchCd -= dt;
    const pl = ctx.player;
    if (!ctx.firing || pl.dead || ctx.flags.busterDisabled || pl.dashing) {
      this.punchCd = Math.max(this.punchCd, 0);
      return;
    }
    if (this.punchCd > 0) return;
    this.step = nextPunch(this.step, this.idle);
    this.idle = 0;
    this.seq = (this.seq + 1) % 1000;
    const interval = ctx.stats.cooldownMul / Math.max(0.5, this.p.rate);
    this.punchCd += interval * (this.step === 2 ? B.hayRecover : 1);
    if (this.punchCd < 0) this.punchCd = 0;
    this.punch(ctx, this.step);
  }

  private punch(ctx: WeaponCtx, k: number): void {
    const pl = ctx.player;
    const p = this.p;
    const evo = this.evoId;
    const mega = this.megaShot(ctx); // Hair Trigger: a MEGA punch
    const shape = punchShape(p, k, ctx.stats.areaMul, ctx.stats.knockbackMul);
    const reach = shape.reach * (mega ? 1.4 : 1);
    const arc = shape.arc;
    const a0 = Math.atan2(pl.aim.z, pl.aim.x);
    this.angle = a0;
    this.reach = reach;
    this.arc = arc;
    const hay = k === 2;
    const dmg = p.dmg * shape.mul * (mega ? 3 : 1);
    const tags = evo === 'thunder' ? SHOCK : undefined;
    let n = 0;
    let first: Enemy | null = null;
    for (const e of ctx.inRadius(pl.x, pl.z, reach + 1, this.scratch).slice()) {
      const dx = e.x - pl.x;
      const dz = e.z - pl.z;
      if (!inSwordArc(dx, dz, e.radius, a0, arc, reach)) continue;
      const d = Math.hypot(dx, dz) || 1;
      // Launch along the punch, not just away from the fist, so a haymaker sends a crowd one way.
      const lx = (dx / d) * 0.4 + Math.cos(a0) * 0.6;
      const lz = (dz / d) * 0.4 + Math.sin(a0) * 0.6;
      const ll = Math.hypot(lx, lz) || 1;
      ctx.damage(e, dmg, { source: 'fists', tags, dirX: lx / ll, dirZ: lz / ll, knockback: 0, hx: e.x - (dx / d) * e.radius, hz: e.z - (dz / d) * e.radius, canCrit: true, loud: n < 3 });
      if (e.active && e.hp > 0 && !bossLike(e)) {
        // Knockback set directly: the launch has to carry them into the hazards.
        const kb = shape.knock * (e.elite ? 0.55 : 1);
        e.kx = (lx / ll) * kb;
        e.kz = (lz / ll) * kb;
        if (hay) {
          e.slowT = Math.max(e.slowT, B.hayStagger);
          e.slowAmt = Math.max(e.slowAmt, 0.85);
        }
      }
      e.squash(hay ? -10 : -5);
      first ??= e;
      n++;
    }
    this.hits = n;
    if (hay) this.hayHits = n;
    // Punch enemy bullets back out of the air.
    const b = ctx.bullets;
    for (let i = 0; i < b.count; i++) {
      if (b.team[i] !== Team.Enemy) continue;
      if (!inSwordArc(b.x[i] - pl.x, b.z[i] - pl.z, b.radius[i], a0, arc, reach)) continue;
      ctx.fx.star(b.x[i], 1, b.z[i], 0.6, '#ffffff', 0.08);
      b.kill(i--);
    }
    ctx.hitBarrels(dmg, (x, z) => inSwordArc(x - pl.x, z - pl.z, 0.6, a0, arc, reach));
    // Haymaker extras: shockwave, thunder, meteor slam.
    if (hay) {
      const cx = first ? first.x : pl.x + Math.cos(a0) * reach * 0.8;
      const cz = first ? first.z : pl.z + Math.sin(a0) * reach * 0.8;
      if (p.quake > 0) {
        const r = p.quake * Math.sqrt(ctx.stats.areaMul);
        if (p.slam) ctx.blast(cx, cz, r, dmg * B.slamDmg, '#ffcd75', 'fists', SLAM);
        else {
          for (const e of ctx.inRadius(cx, cz, r, this.scratch).slice()) {
            if (e === first) continue;
            const dx = e.x - cx;
            const dz = e.z - cz;
            const d = Math.hypot(dx, dz) || 1;
            ctx.damage(e, dmg * B.quakeDmg, { source: 'fists', tags, dirX: dx / d, dirZ: dz / d, knockback: 0, canCrit: true, loud: false });
            if (e.active && !bossLike(e)) {
              e.kx = (dx / d) * shape.knock * 0.6;
              e.kz = (dz / d) * shape.knock * 0.6;
            }
          }
          ctx.fx.ring(cx, cz, 0.4, r * 2, this.evoColor, 0.25);
        }
        ctx.shake(cx, cz, 0.25);
      }
      if (p.thunder && first && first.active && first.hp > 0) ctx.zap(first, B.thunderHops, dmg * B.thunderDmg);
      ctx.sound('punchHeavy');
      if (n > 0) ctx.shake(pl.x, pl.z, 0.2);
    } else ctx.sound('punch');
    if (first) {
      ctx.fx.star(first.x, 1.1 * first.scale, first.z, hay ? 1.8 : 1, hay ? this.evoColor : '#ffffff', hay ? 0.14 : 0.08);
      ctx.particles.burst(first.x, 1, first.z, { count: hay ? 12 : 4, color: this.evoColor, color2: '#ffffff', speed: [4, 10], size: [0.1, 0.22], life: [0.1, 0.25], dir: { x: Math.cos(a0), z: Math.sin(a0), spread: 0.8 } });
    }
    pl.recoil = Math.max(pl.recoil, hay ? 1.6 : 0.8);
    pl.bounce(hay ? -5 : -2);
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    const t = now();
    if (this.seq !== this.drawnSeq) {
      this.drawnSeq = this.seq;
      this.punchAt = t;
    }
    const age = t - this.punchAt;
    const hay = this.step === 2;
    const life = hay ? 0.2 : 0.11;
    const rx = pl.rig.root.position.x;
    const rz = pl.rig.root.position.z;
    this.swoosh.visible = !(pl.dead || age > life || !pl.rig.root.visible);
    if (this.swoosh.visible) {
      const k = age / life;
      const r = this.reach * (0.75 + 0.25 * k);
      this.swoosh.position.set(rx, hay ? 0.9 : 1.05, rz);
      this.swoosh.rotation.set(0, -this.angle, 0);
      this.swoosh.scale.set(r, 1, r * (hay ? 1.3 : 0.8));
      const sm = this.swoosh.material as THREE.MeshBasicMaterial;
      sm.opacity = 0.85 * (1 - k);
      sm.color.set(hay ? this.evoColor : '#ffffff');
    }
    const sl = 0.3;
    this.shock.visible = !(pl.dead || !hay || age > sl || !pl.rig.root.visible);
    if (this.shock.visible) {
      const k = age / sl;
      const r = 0.6 + k * (this.reach + 1.2);
      this.shock.position.set(rx + Math.cos(this.angle) * this.reach * 0.7, 0.08, rz + Math.sin(this.angle) * this.reach * 0.7);
      this.shock.scale.set(r, 1, r);
      const m = this.shock.material as THREE.MeshBasicMaterial;
      m.opacity = 0.75 * (1 - k);
      m.color.set(this.evoColor);
    }
    this.poseArms(ctx, age);
  }

  /** Jab and cross alternate fists, thrown straight out; the haymaker winds the body round. */
  private poseArms(ctx: WeaponCtx, age: number): void {
    const rig = ctx.player.rig;
    rig.armR.scale.y = rig.armL.scale.y = 1;
    if (ctx.player.dead || age > 0.24) return;
    const right = this.step === 2 || this.seq % 2 === 0;
    const arm = right ? rig.armR : rig.armL;
    const out = age < 0.06 ? age / 0.06 : 1 - Math.min(1, (age - 0.06) / 0.18);
    arm.rotation.order = 'YXZ';
    arm.rotation.x = -Math.PI / 2 * out + (1 - out) * 0.1;
    arm.rotation.y = (right ? -1 : 1) * 0.15 * out;
    arm.scale.y = 1 + 0.25 * out; // the punch reaches
    if (this.step === 2) rig.body.rotation.y += (right ? -1 : 1) * 0.5 * out;
  }

  dispose(): void {
    for (const m of [this.swoosh, this.shock]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
