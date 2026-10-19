import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const FALL = 0.6; // seconds from the ground mark to impact
const SMALL_FALL = 0.3;

interface Star {
  x: number;
  z: number;
  t: number;
  /** Nova Hail's split-off stars: smaller, faster, no further split. */
  small: boolean;
}

/**
 * Legendary auto weapon: every few seconds, stars fall on the biggest crowds
 * near you after a closing-ring telegraph and explode. Evolved with Focus Lens
 * (Nova Hail) each star bursts into smaller stars on impact. All visuals go
 * through the effects bus, so clients see them without net state.
 */
export class Starfall extends Weapon {
  private stars: Star[] = [];
  private near: Enemy[] = [];
  private around: Enemy[] = [];

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    const area = Math.sqrt(ctx.stats.areaMul);
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      s.t += dt;
      const fall = s.small ? SMALL_FALL : FALL;
      if (s.t < fall) {
        // The streak: sparks coming down at a slant over the mark.
        const y = 9 * (1 - s.t / fall);
        if (Math.floor(s.t * 30) !== Math.floor((s.t - dt) * 30)) ctx.particles.burst(s.x + y * 0.35, y, s.z - y * 0.2, { count: 2, color: this.color, color2: '#ffffff', speed: [0, 0.6], size: [0.2, 0.4], life: [0.1, 0.2], drag: 4 });
        continue;
      }
      this.stars.splice(i, 1);
      const r = p.radius * area * (s.small ? 0.55 : 1);
      ctx.blast(s.x, s.z, r, p.dmg * (s.small ? 0.4 : 1), this.color, 'starfall');
      ctx.fx.star(s.x, 0.8, s.z, s.small ? 1.6 : 3, '#ffffff', 0.14);
      if (!s.small) {
        ctx.shake(s.x, s.z, 0.25);
        ctx.sound('explode');
        for (let k = 0; k < p.split; k++) {
          const a = (k / p.split) * Math.PI * 2 + ctx.rng.next();
          this.stars.push({ x: s.x + Math.cos(a) * r * 1.1, z: s.z + Math.sin(a) * r * 1.1, t: 0, small: true });
        }
      }
    }

    this.cd -= dt;
    if (pl.dead || this.cd > 0) return;
    // The biggest crowds in range: each candidate scores the enemies around it; marks don't overlap.
    const cands = [...ctx.inRadius(pl.x, pl.z, p.range, this.near)];
    if (!cands.length) {
      this.cd = 0.5;
      return;
    }
    const r = p.radius * area;
    const scored = cands.slice(0, 40).map((e) => ({ e, n: ctx.inRadius(e.x, e.z, r, this.around).length }));
    scored.sort((a, b) => b.n - a.n);
    const marks: { x: number; z: number }[] = [];
    for (const { e } of scored) {
      if (marks.length >= p.count) break;
      if (marks.some((m) => (m.x - e.x) ** 2 + (m.z - e.z) ** 2 < r * r * 2)) continue;
      marks.push({ x: e.x, z: e.z });
    }
    this.cd = p.cd * ctx.stats.cooldownMul;
    for (const m of marks) {
      this.stars.push({ x: m.x, z: m.z, t: 0, small: false });
      // Ring sizes are diameters: close from 1.5x the blast onto it.
      ctx.fx.ring(m.x, m.z, r * 3, 1 / 1.5, this.color, FALL);
    }
    ctx.sound('meteor');
  }
}
