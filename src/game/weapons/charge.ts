import { BULLET_Y, Team } from '../bullets';
import { Weapon, type WeaponCtx } from './base';

export const chargeTuning = {
  time: 1.3, // seconds to a full charge
  minCharge: 0.2, // releasing earlier fires nothing
  fullBlast: 2.4, // explosion radius when a full-charge shot ends
  overBlast: 3.6,
};

// Partial, full, overcharged. Never magenta: that's the enemy bullet colour.
const CHARGE_COLORS = ['#7df9ff', '#3dffb0', '#ff7a2f'];

/**
 * The default right click: hold to build a charge shot that fires on release
 * and grows with hold time; a full charge explodes on impact. Evolutions:
 * Star Cannon's full charges are blazing stars with a fiery blast; Lance Shot
 * fires a long, fast golden lance that pierces everything and Shocks.
 */
export class ChargeShot extends Weapon {
  private mz = { x: 0, z: 0 };
  /** 0..1 = first charge level, 1..2 = overcharge (with the Overcharge Mod). */
  charge = 0;
  private sparkT = 0;

  net(): number[] {
    return [this.muzzleT, Math.round(this.charge * 100) / 100];
  }
  setNet(a: number[]): void {
    this.muzzleT = a[0] ?? 0;
    this.charge = a[1] ?? 0;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    const blocked = ctx.player.dead || ctx.flags.busterDisabled;
    if (ctx.charging && !blocked) {
      this.updateCharge(dt, ctx);
      return;
    }
    if (this.charge > 0) {
      if (this.charge >= chargeTuning.minCharge && !blocked) this.fireCharged(ctx);
      this.charge = 0;
    }
  }

  private get chargeLevel(): number {
    return this.charge >= 2 ? 2 : this.charge >= 1 ? 1 : 0;
  }

  private updateCharge(dt: number, ctx: WeaponCtx): void {
    const max = ctx.flags.overcharge ? 2 : 1;
    const rate = (ctx.stats.chargeSpeed * (1 + ctx.flags.chargeSpeed)) / Math.max(0.4, this.p.time ?? chargeTuning.time);
    const before = this.charge;
    // The overcharge level builds at half speed.
    this.charge = Math.min(max, this.charge + dt * rate * (this.charge >= 1 ? 0.5 : 1));
    const pl = ctx.player;
    pl.muzzle(this.mz);
    if ((before < 1 && this.charge >= 1) || (before < 2 && this.charge >= 2)) {
      ctx.sound('chargeFull');
      ctx.fx.ring(this.mz.x, this.mz.z, 0.5, 3, CHARGE_COLORS[this.chargeLevel], 0.25);
    }
    // Sparks gather at the muzzle, more and brighter as the charge builds.
    this.sparkT -= dt;
    if (this.sparkT > 0) return;
    this.sparkT = 0.06;
    const k = Math.min(1, this.charge);
    const color = CHARGE_COLORS[this.chargeLevel];
    ctx.particles.burst(this.mz.x, BULLET_Y, this.mz.z, {
      count: 1 + Math.round(k * 3) + (this.charge >= 1 ? 2 : 0),
      color,
      color2: '#ffffff',
      speed: [0.5, 1.5 + k * 2],
      size: [0.08 + k * 0.08, 0.16 + k * 0.14],
      life: [0.1, 0.22],
      up: 1,
      drag: 4,
    });
    if (this.charge < 1 && Math.floor(before * 5) !== Math.floor(this.charge * 5)) ctx.sound('charge');
  }

  private fireCharged(ctx: WeaponCtx): void {
    const pl = ctx.player;
    const p = this.p;
    const level = this.chargeLevel;
    const k = Math.min(1, this.charge);
    const over = level === 2 ? 2 : 1;
    const dmg = p.dmg * (1.5 + 8.5 * Math.pow(k, 1.4)) * over * ctx.stats.chargeDmg;
    const size = (1.3 + 1.8 * k + (level === 2 ? 1.1 : 0)) * Math.sqrt(ctx.stats.areaMul) * (p.size ?? 1);
    const full = p.blast ?? chargeTuning.fullBlast;
    const lance = p.lance > 0;
    const star = this.evoId === 'star' && level >= 1;
    const blast = lance ? 0 : level === 2 ? full + chargeTuning.overBlast - chargeTuning.fullBlast : level === 1 ? full : 0;
    const shots = level >= 1 ? 1 + ctx.flags.chargeSplit : 1;
    const color = lance ? '#ffd23f' : star ? '#ff5e3a' : CHARGE_COLORS[level];
    pl.muzzle(this.mz);
    const base = Math.atan2(pl.aim.z, pl.aim.x);
    for (let i = 0; i < shots; i++) {
      const a = base + (shots > 1 ? (i / (shots - 1) - 0.5) * 0.45 : 0);
      ctx.bullets.spawn({
        x: this.mz.x,
        z: this.mz.z,
        dirX: Math.cos(a),
        dirZ: Math.sin(a),
        speed: p.speed * 0.85,
        life: 0.55,
        radius: 0.2 * size,
        damage: dmg,
        knockback: 6 + 10 * k,
        team: Team.Player,
        color,
        width: (lance ? 0.2 : 0.34) * size,
        length: (lance ? 2.8 : 0.9) * size,
        pierce: Math.round(1 + 6 * k) + (level === 2 ? 10 : 0) + (p.pierce ?? 0),
        owner: ctx.owner,
        kind: lance ? 9 : star ? 8 : 1,
        blast,
      });
    }
    this.muzzleT = 0.1 + 0.05 * level;
    pl.recoil = 1.6 + 0.6 * level;
    ctx.sound(level >= 1 ? 'chargeShot' : 'shoot');
    if (level >= 1) ctx.shake(this.mz.x, this.mz.z, 0.2 * level);
    ctx.particles.burst(this.mz.x, BULLET_Y, this.mz.z, {
      count: 6 + level * 6,
      color,
      color2: '#ffffff',
      speed: [4, 10],
      size: [0.12, 0.3],
      life: [0.1, 0.25],
      dir: { x: pl.aim.x, z: pl.aim.z, spread: 1.0 },
    });
    if (level >= 1) ctx.fx.ring(this.mz.x, this.mz.z, 0.6, 3 + level * 1.5, color, 0.2);
  }

}
