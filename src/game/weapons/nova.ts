import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';
import { SCAR_COLORS } from '../scars';

/** Periodic frost blast: damages and freezes everything nearby. */
export class Nova extends Weapon {
  private hits: Enemy[] = [];

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    if (pl.dead || !this.tick(dt, ctx, p.cd)) return;
    const r = p.radius * ctx.stats.areaMul;
    ctx.sound('freeze');
    ctx.fx.ring(pl.x, pl.z, 1, r * 2, this.look('#9fe8ff'), 0.4);
    ctx.fx.ring(pl.x, pl.z, 1, r * 1.5, '#ffffff', 0.3);
    ctx.fx.scar(pl.x, pl.z, r * 0.8, SCAR_COLORS.frost, 6);
    ctx.particles.burst(pl.x, 0.6, pl.z, {
      count: 26,
      color: '#ffffff',
      color2: this.look('#9fe8ff'),
      speed: [r * 1.5, r * 3],
      size: [0.12, 0.28],
      life: [0.25, 0.45],
      drag: 5,
    });
    for (const e of ctx.inRadius(pl.x, pl.z, r, this.hits)) {
      // Bosses shrug off most of the freeze.
      e.frozen = Math.max(e.frozen, p.freeze * (e.def.behavior === 'boss' ? 0.15 : 1));
      e.shatter = p.shatter;
      ctx.damage(e, p.dmg, { source: 'nova' });
    }
  }
}
