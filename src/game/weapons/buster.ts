import * as THREE from 'three';
import { BULLET_Y, Team } from '../bullets';
import { Weapon, type WeaponCtx } from './base';

/**
 * The default left click: rapid aimed shots while fire is held. Evolutions:
 * Flare Buster fires big orange bolts that ignite; Volt Buster fires
 * crackling cyan bolts that Shock and pierce.
 */
export class Buster extends Weapon {
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
    const p = this.p;
    if (!ctx.firing || ctx.player.dead || ctx.flags.busterDisabled || ctx.player.dashing) {
      this.shotCd = Math.max(this.shotCd, 0);
      return;
    }
    let shots = 0;
    while (this.shotCd <= 0 && shots < 3) {
      shots++;
      // Rapid Coil also speeds the buster up.
      this.shotCd += 1 / (p.rate / ctx.stats.cooldownMul);
    }
    for (let s = 0; s < shots; s++) this.fire(ctx);
  }

  private fire(ctx: WeaponCtx): void {
    const pl = ctx.player;
    const p = this.p;
    pl.muzzle(this.mz);
    const base = Math.atan2(pl.aim.z, pl.aim.x);
    const arc = THREE.MathUtils.degToRad(p.arc);
    // Hair Trigger: every Nth shot is a mega shot.
    const mega = this.megaShot(ctx);
    const size = p.size * Math.sqrt(ctx.stats.areaMul) * (mega ? 2.2 : 1);
    const evo = this.evoId;
    const color = mega ? '#ff7a2f' : evo === 'flare' ? '#ff7a2f' : evo === 'volt' ? '#7df9ff' : '#fff36b';
    const kind = evo === 'flare' ? 6 : evo === 'volt' ? 7 : 0;
    for (let i = 0; i < p.shots; i++) {
      const fan = p.shots > 1 ? (i / (p.shots - 1) - 0.5) * arc : 0;
      const a = base + fan + (Math.random() - 0.5) * 0.05;
      ctx.bullets.spawn({
        x: this.mz.x,
        z: this.mz.z,
        dirX: Math.cos(a),
        dirZ: Math.sin(a),
        speed: p.speed,
        life: 0.75,
        radius: 0.2 * size,
        damage: p.dmg * (mega ? 4 : 1),
        knockback: mega ? 12 : 4,
        team: Team.Player,
        color,
        width: (evo === 'volt' ? 0.24 : 0.32) * size,
        length: (evo === 'volt' ? 1.3 : 0.8) * size,
        pierce: p.pierce + (mega ? 5 : 0) + (ctx.combos.has('ricochet') ? 1 : 0),
        owner: ctx.owner,
        kind,
      });
    }
    this.muzzleT = 0.05;
    pl.recoil = 1;
    ctx.sound('shoot');
    ctx.particles.burst(this.mz.x, BULLET_Y, this.mz.z, {
      count: evo ? 5 : 3,
      color: evo ? color : '#fff36b',
      color2: '#ffffff',
      speed: [3, 7],
      size: [0.08, 0.16],
      life: [0.06, 0.14],
      dir: { x: pl.aim.x, z: pl.aim.z, spread: 1.2 },
    });
  }
}
