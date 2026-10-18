import { BULLET_Y, Team } from '../bullets';
import { Weapon, type WeaponCtx } from './base';

/**
 * Left-click loadout weapon: a pellet fan. Evolutions: Dragon's Breath spits
 * long flame pellets that ignite, with a fire plume at the muzzle; Flak Cannon
 * pellets burst in small blasts on their first hit.
 */
export class Scatter extends Weapon {
  private shotCd = 0;
  private mz = { x: 0, z: 0 };

  net(): number[] {
    return [this.muzzleT];
  }
  setNet(a: number[]): void {
    this.muzzleT = a[0] ?? 0;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    this.shotCd -= dt;
    const pl = ctx.player;
    if (!ctx.firing || pl.dead || pl.dashing || ctx.flags.busterDisabled) {
      this.shotCd = Math.max(this.shotCd, 0);
      return;
    }
    if (this.shotCd > 0) return;
    this.shotCd += 1 / (this.p.rate / ctx.stats.cooldownMul);
    this.fire(ctx);
  }

  private fire(ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    const evo = this.evoId === 'dragon';
    const flak = this.evoId === 'flak';
    pl.muzzle(this.mz);
    const base = Math.atan2(pl.aim.z, pl.aim.x);
    // Hair Trigger makes MEGA blasts.
    const pellets = p.pellets;
    const spread = (p.spread * Math.PI) / 180;
    const mega = this.megaShot(ctx);
    const size = Math.sqrt(ctx.stats.areaMul) * (evo ? 1.3 : 1) * (mega ? 1.6 : 1);
    for (let i = 0; i < pellets; i++) {
      const a = base + (i / (pellets - 1) - 0.5) * spread + (ctx.rng.next() - 0.5) * 0.08;
      const sp = p.speed * (0.85 + ctx.rng.next() * 0.3);
      ctx.bullets.spawn({
        x: this.mz.x,
        z: this.mz.z,
        dirX: Math.cos(a),
        dirZ: Math.sin(a),
        speed: sp,
        life: p.life,
        radius: 0.18 * size,
        damage: p.dmg * (mega ? 4 : 1),
        knockback: (p.knock ?? 3) * (mega ? 2.5 : 1),
        team: Team.Player,
        color: mega ? '#ff7a2f' : evo ? '#ff5e3a' : flak ? '#ffb627' : '#ffe9a8',
        width: (evo ? 0.34 : flak ? 0.26 : 0.2) * size,
        length: (evo ? 1.3 : flak ? 0.35 : 0.45) * size,
        pierce: p.pierce + (mega ? 5 : 0),
        owner: ctx.owner,
        kind: evo ? 3 : flak ? 5 : 2,
        blast: flak ? p.blast * Math.sqrt(ctx.stats.areaMul) : 0,
      });
    }
    this.muzzleT = 0.08;
    pl.recoil = 1.8;
    ctx.sound(evo ? 'flame' : 'shoot');
    ctx.particles.burst(this.mz.x, BULLET_Y, this.mz.z, {
      count: evo ? 14 : flak ? 9 : 6,
      color: evo ? '#ff7a2f' : flak ? '#ffb627' : '#ffe9a8',
      color2: evo ? '#ffd23f' : '#ffffff',
      speed: evo ? [4, 12] : [3, 8],
      size: evo ? [0.2, 0.45] : [0.08, 0.18],
      life: evo ? [0.15, 0.35] : [0.06, 0.14],
      dir: { x: pl.aim.x, z: pl.aim.z, spread: evo ? 0.9 : 1.2 },
      up: evo ? 1.5 : 0,
    });
  }
}
