import { Team } from '../bullets';
import { Weapon, type WeaponCtx } from './base';

/** Scatter Gun: a shotgun blast of short-lived pellets at the nearest enemy. */
export class Scatter extends Weapon {
  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    if (pl.dead || !this.tick(dt, ctx, p.cd)) return;
    const e = ctx.nearest(pl.x, pl.z, p.range);
    if (!e) {
      this.cd = 0.25;
      return;
    }
    const base = Math.atan2(e.z - pl.z, e.x - pl.x);
    const spread = (p.spread * Math.PI) / 180;
    const color = this.look('#ffcd75');
    for (let i = 0; i < p.pellets; i++) {
      const a = base + (p.pellets > 1 ? (i / (p.pellets - 1) - 0.5) * spread : 0) + (ctx.rng.next() - 0.5) * 0.08;
      ctx.bullets.spawn({
        x: pl.x + Math.cos(base) * 0.6,
        z: pl.z + Math.sin(base) * 0.6,
        dirX: Math.cos(a),
        dirZ: Math.sin(a),
        speed: 24 * (0.85 + ctx.rng.next() * 0.3),
        life: (p.range / 24) * 1.1,
        radius: 0.18,
        damage: p.dmg,
        knockback: 5,
        team: Team.Player,
        color,
        width: 0.22,
        length: 0.5,
        pierce: p.pierce,
        owner: ctx.owner,
        kind: this.evolved ? 3 : 2,
      });
    }
    ctx.sound('shoot');
    ctx.particles.burst(pl.x + Math.cos(base) * 0.8, 1.05, pl.z + Math.sin(base) * 0.8, {
      count: 5,
      color,
      color2: '#ffffff',
      speed: [3, 7],
      size: [0.1, 0.2],
      life: [0.08, 0.16],
      dir: { x: Math.cos(base), z: Math.sin(base), spread: 1 },
    });
  }
}
