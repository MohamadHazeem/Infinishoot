import { BULLET_Y, Team } from '../bullets';
import { BulletShape } from '../bulletShapes';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { GP_KINDS, SUPERS, mechTuning, superTuning, type SuperId } from '../gameplay';
import { Weapon, type WeaponCtx } from './base';

/**
 * Temporary weapons from the gameplay lane: the supply-crate super weapons
 * (Minigun, Railgun, Flamethrower), which take over the left click while
 * they last, and the mech suit's arsenal (arm cannons, missile salvo, stomp),
 * which replaces every weapon while you pilot. They are never in
 * `hero.weapons` (never offered, never synced as weapons): systems/gameplay.ts
 * owns them and runs them through the hero's WeaponCtx like any weapon. What
 * they fire are ordinary bullets and effects, so online clients see them with
 * no extra protocol. `power` (set every step) scales damage with enemy life.
 */
function tempDef(id: string, name: string, color: string): WeaponDef {
  return { id, name, color, icon: '✦', desc: '', rarity: 'legendary', tags: ['projectile'], starter: false, levels: [{ text: '', p: {} }] };
}

/** A super weapon: ammo (shots, or seconds of fire) and a time limit. */
export abstract class SuperWeapon extends Weapon {
  power = 1;
  ammo: number;
  t: number;
  protected mz = { x: 0, z: 0 };

  constructor(readonly sid: SuperId) {
    const d = SUPERS[sid];
    super(tempDef(sid, d.name, d.color));
    this.ammo = d.ammo;
    this.t = d.time;
  }

  get done(): boolean {
    return this.ammo <= 0 || this.t <= 0;
  }

  protected canFire(ctx: WeaponCtx): boolean {
    return ctx.firing && !ctx.player.dead && !ctx.player.dashing && this.ammo > 0;
  }
}

/** Minigun: spins up from 8 to 30 shots a second while held. */
export class Minigun extends SuperWeapon {
  private spin = 0;
  private acc = 0;
  private n = 0;

  constructor() {
    super('minigun');
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.t -= dt;
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    const T = superTuning;
    if (!this.canFire(ctx)) {
      this.spin = Math.max(0, this.spin - dt * 2);
      this.acc = 0;
      return;
    }
    this.spin = Math.min(1, this.spin + dt / T.minigunSpin);
    const rate = (T.minigunRate[0] + (T.minigunRate[1] - T.minigunRate[0]) * this.spin) / ctx.stats.cooldownMul;
    this.acc += dt * rate;
    while (this.acc >= 1 && this.ammo > 0) {
      this.acc--;
      this.ammo--;
      this.fire(ctx);
    }
  }

  private fire(ctx: WeaponCtx): void {
    const pl = ctx.player;
    pl.muzzle(this.mz);
    const a = Math.atan2(pl.aim.z, pl.aim.x) + (ctx.rng.next() - 0.5) * 2 * superTuning.minigunSpread;
    ctx.bullets.spawn({ x: this.mz.x, z: this.mz.z, dirX: Math.cos(a), dirZ: Math.sin(a), speed: 36, life: 0.7, radius: 0.2, damage: SUPERS.minigun.dmg * this.power, knockback: 2.5, team: Team.Player, color: '#ffd23f', width: 0.22, length: 1.1, owner: ctx.owner, kind: GP_KINDS.minigun });
    this.muzzleT = 0.05;
    pl.recoil = Math.max(pl.recoil, 0.8);
    if (this.n++ % 3 === 0) ctx.sound('shoot');
    if (this.n % 2 === 0) ctx.particles.burst(this.mz.x, BULLET_Y, this.mz.z, { count: 2, color: '#ffd23f', color2: '#ffffff', speed: [3, 7], size: [0.08, 0.15], life: [0.05, 0.12], dir: { x: pl.aim.x, z: pl.aim.z, spread: 1 } });
  }
}

/** Railgun: a line of lightning through everything in front of you, every half second. */
export class Railgun extends SuperWeapon {
  private hits: Enemy[] = [];

  constructor() {
    super('railgun');
    this.cd = 0;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.t -= dt;
    this.cd -= dt;
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    if (!this.canFire(ctx) || this.cd > 0) return;
    this.cd = superTuning.railgunEvery * ctx.stats.cooldownMul;
    this.ammo--;
    this.fire(ctx);
  }

  private fire(ctx: WeaponCtx): void {
    const pl = ctx.player;
    const T = superTuning;
    pl.muzzle(this.mz);
    const dx = pl.aim.x;
    const dz = pl.aim.z;
    const L = T.railgunLength;
    const sx = this.mz.x;
    const sz = this.mz.z;
    const ex = sx + dx * L;
    const ez = sz + dz * L;
    const dmg = SUPERS.railgun.dmg * this.power;
    // Everything within the beam's width along its length.
    const near = ctx.inRadius(sx + dx * L * 0.5, sz + dz * L * 0.5, L * 0.5 + 2, this.hits);
    let loud = 0;
    for (const e of near.slice()) {
      const rx = e.x - sx;
      const rz = e.z - sz;
      const along = rx * dx + rz * dz;
      if (along < -0.5 || along > L) continue;
      if (Math.abs(rx * dz - rz * dx) > T.railgunWidth + e.radius) continue;
      ctx.damage(e, dmg, { source: 'railgun', tags: ['projectile', 'shock'], dirX: dx, dirZ: dz, knockback: 10, canCrit: true, loud: loud++ < 4, hx: e.x, hz: e.z });
    }
    ctx.hitBarrels(dmg, (x, z) => {
      const rx = x - sx;
      const rz = z - sz;
      const along = rx * dx + rz * dz;
      return along > 0 && along < L && Math.abs(rx * dz - rz * dx) < T.railgunWidth + 0.6;
    });
    // The beam: an arc from the muzzle to the end, sparks along it, stars at both ends.
    ctx.particles.burst(sx, BULLET_Y, sz, { count: 8, color: '#7df9ff', color2: '#ffffff', speed: [4, 10], size: [0.12, 0.25], life: [0.1, 0.25], dir: { x: dx, z: dz, spread: 0.6 }, arc: [ex, ez] });
    for (let d = 2; d < L; d += 2.5) ctx.particles.burst(sx + dx * d, BULLET_Y, sz + dz * d, { count: 3, color: '#7df9ff', color2: '#ffffff', speed: [0.3, 1.5], size: [0.2, 0.38], life: [0.25, 0.45], drag: 3 });
    ctx.fx.star(sx, BULLET_Y, sz, 1.6, '#ffffff', 0.12);
    ctx.fx.ring(sx, sz, 0.4, 3, '#7df9ff', 0.2);
    ctx.fx.star(ex, BULLET_Y, ez, 1.2, '#7df9ff', 0.12);
    ctx.shake(sx, sz, 0.3);
    ctx.sound('rail');
    pl.recoil = Math.max(pl.recoil, 2.4);
    this.muzzleT = 0.12;
  }
}

const FLAME_COLORS = ['#ff7a2f', '#ffd23f', '#ff5e3a'];

/** Flamethrower: a cone of flames; its ammo is seconds of fire. */
export class Flamethrower extends SuperWeapon {
  private acc = 0;
  private soundT = 0;

  constructor() {
    super('flamer');
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.t -= dt;
    this.soundT -= dt;
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    if (!this.canFire(ctx)) {
      this.acc = 0;
      return;
    }
    this.ammo = Math.max(0, this.ammo - dt);
    this.acc += dt * superTuning.flamerRate / ctx.stats.cooldownMul;
    const pl = ctx.player;
    while (this.acc >= 1) {
      this.acc--;
      pl.muzzle(this.mz);
      const a = Math.atan2(pl.aim.z, pl.aim.x) + (ctx.rng.next() - 0.5) * 2 * superTuning.flamerSpread;
      const sp = 13 * (0.8 + ctx.rng.next() * 0.4);
      ctx.bullets.spawn({ x: this.mz.x, z: this.mz.z, dirX: Math.cos(a), dirZ: Math.sin(a), speed: sp, life: superTuning.flamerRange, radius: 0.45, damage: SUPERS.flamer.dmg * this.power, knockback: 1, team: Team.Player, color: FLAME_COLORS[Math.floor(ctx.rng.next() * 3)], width: 0.75, length: 0.9, pierce: 3, owner: ctx.owner, kind: GP_KINDS.flamer, shape: BulletShape.Flame });
    }
    this.muzzleT = 0.06;
    if (this.soundT <= 0) {
      this.soundT = 0.15;
      ctx.sound('flame');
      ctx.particles.burst(this.mz.x, BULLET_Y, this.mz.z, { count: 3, color: '#ffd23f', color2: '#ff5e3a', speed: [4, 9], size: [0.2, 0.4], life: [0.15, 0.3], dir: { x: pl.aim.x, z: pl.aim.z, spread: 0.5 } });
    }
  }
}

export function createSuper(id: SuperId): SuperWeapon {
  return id === 'minigun' ? new Minigun() : id === 'railgun' ? new Railgun() : new Flamethrower();
}

/**
 * The mech suit's weapons: two arm cannons (alternating; your aim while you
 * fire, else the nearest enemy), a homing missile salvo from the shoulders,
 * and heavy steps whose every third is a stomp shockwave.
 */
export class MechArsenal extends Weapon {
  power = 1;
  private side = 1;
  private salvoT = 0.8;
  private stepT = 0;
  steps = 0;

  constructor() {
    super(tempDef('mech', 'Mech Suit', '#ffb627'));
  }

  update(dt: number, ctx: WeaponCtx): void {
    const T = mechTuning;
    const pl = ctx.player;
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    if (pl.dead) return;
    // Arm cannons.
    this.cd -= dt;
    let ax = pl.aim.x;
    let az = pl.aim.z;
    let go = ctx.firing;
    if (!go) {
      const t = ctx.nearest(pl.x, pl.z, T.cannonRange);
      if (t) {
        const d = Math.hypot(t.x - pl.x, t.z - pl.z) || 1;
        ax = (t.x - pl.x) / d;
        az = (t.z - pl.z) / d;
        go = true;
      }
    }
    if (go && this.cd <= 0) {
      this.cd = Math.max(0, this.cd) + ctx.stats.cooldownMul / T.cannonRate;
      this.side = -this.side;
      // From the arm on this side: 1.1 m out, 1 m forward.
      const x = pl.x + ax * 1 - az * 1.1 * this.side;
      const z = pl.z + az * 1 + ax * 1.1 * this.side;
      ctx.bullets.spawn({ x, z, dirX: ax, dirZ: az, speed: 30, life: 0.8, radius: 0.36, damage: T.cannonDmg * this.power, knockback: 9, team: Team.Player, color: '#ffb627', width: 0.5, length: 1.3, pierce: 1, owner: ctx.owner, kind: GP_KINDS.cannon });
      ctx.particles.burst(x, BULLET_Y + 0.6, z, { count: 3, color: '#ffb627', color2: '#ffffff', speed: [3, 8], size: [0.12, 0.25], life: [0.06, 0.15], dir: { x: ax, z: az, spread: 1 } });
      this.muzzleT = 0.06;
      ctx.sound('mechCannon');
    }
    // Missile salvo: fanned out of the shoulders, then they home in.
    this.salvoT -= dt;
    if (this.salvoT <= 0 && ctx.nearest(pl.x, pl.z, 24)) {
      this.salvoT = T.salvoEvery * ctx.stats.cooldownMul;
      const base = Math.atan2(pl.aim.z, pl.aim.x);
      for (let i = 0; i < T.salvoCount; i++) {
        const a = base + Math.PI + (i / (T.salvoCount - 1) - 0.5) * 2.6 + (i % 2 ? 0.2 : -0.2);
        ctx.bullets.spawn({ x: pl.x, z: pl.z, dirX: Math.cos(a), dirZ: Math.sin(a), speed: 15, life: 2.2, radius: 0.3, damage: T.missileDmg * this.power, knockback: 6, team: Team.Player, color: '#ffe9a8', width: 0.32, length: 0.9, homing: 1, blast: T.missileBlast, owner: ctx.owner, kind: GP_KINDS.missile });
      }
      ctx.sound('mechMissile');
      ctx.particles.burst(pl.x, 2.6, pl.z, { count: 10, color: '#d8def0', color2: '#ffe9a8', speed: [1, 3], size: [0.25, 0.45], life: [0.4, 0.8], up: 3, drag: 2, smoke: 2, scorch: 0 });
    }
    this.steer(dt, ctx);
    // Heavy steps; every few a stomp.
    if (pl.speed > 1) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = T.stepEvery;
        this.steps++;
        if (this.steps % T.stompEvery === 0) {
          ctx.blast(pl.x, pl.z, T.stompRadius, T.stompDmg * this.power, '#ffb627', 'mech', ['explosive']);
          ctx.shake(pl.x, pl.z, 0.5);
          ctx.particles.burst(pl.x, 0.2, pl.z, { count: 6, color: '#d9c49c', color2: '#ffffff', speed: [2, 6], size: [0.2, 0.4], life: [0.3, 0.6], up: 2, dust: 10, scorch: 0 });
        } else {
          ctx.shake(pl.x, pl.z, 0.18);
          ctx.particles.burst(pl.x - pl.aim.z * 0.6 * (this.steps % 2 ? 1 : -1), 0.15, pl.z + pl.aim.x * 0.6 * (this.steps % 2 ? 1 : -1), { count: 4, color: '#d9c49c', color2: '#f2e2b8', speed: [0.5, 2], size: [0.2, 0.35], life: [0.3, 0.5], up: 1, dust: 4, scorch: 0 });
        }
      }
    } else this.stepT = Math.min(this.stepT, 0.15);
  }

  /** Missiles turn toward the nearest enemy. */
  private steer(dt: number, ctx: WeaponCtx): void {
    const b = ctx.bullets;
    const k = GP_KINDS.missile;
    const turn = mechTuning.missileTurn * dt;
    for (let i = 0; i < b.count; i++) {
      if (b.kind[i] !== k || b.owner[i] !== ctx.owner || b.team[i] !== Team.Player) continue;
      const t = ctx.nearest(b.x[i], b.z[i], 14);
      const sp = Math.hypot(b.vx[i], b.vz[i]) || 1;
      const speed = Math.min(26, sp + 30 * dt);
      let dx = b.vx[i] / sp;
      let dz = b.vz[i] / sp;
      if (t) {
        const tl = Math.hypot(t.x - b.x[i], t.z - b.z[i]) || 1;
        dx += ((t.x - b.x[i]) / tl - dx) * Math.min(1, turn);
        dz += ((t.z - b.z[i]) / tl - dz) * Math.min(1, turn);
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
      }
      b.vx[i] = dx * speed;
      b.vz[i] = dz * speed;
    }
  }
}
