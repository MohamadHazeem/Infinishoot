// Feedback shares the existing effects records and the enemy squash snapshot.
import type { Game } from './game';
import type { Enemy } from './enemies';
import type { Hero } from './hero';
import type { DamageOpts } from './weapons';
import type { BurstOptions } from './particles';
import { combatJuiceTuning } from '../data/juice';
import { damage } from './systems/combat';
import { settings } from './settings';

/** A transient colour for the material contact star. Nested Mod/status hits restore their caller. */
export function damageWithFeedback(this: Game, e: Enemy, base: number, o: DamageOpts, by: Hero): number {
  const previous = this.vfx.contact;
  const previousContact = this.vfx.contactPending;
  this.vfx.contact = o.loud ? o : undefined;
  this.vfx.contactPending = false;
  try {
    const dealt = damage.call(this, e, base, o, by);
    if (dealt > 0 && o.loud && e.alive && e.hp > 0 && e.pvpOwner < 0 && !e.roarT && !e.frozen && e.state !== 'windup') {
      // Pose only. Do not increase knockback velocity, flash timers or contact reach.
      const weight = Math.min(1, dealt / Math.max(1, e.maxHp * 0.32));
      const compression = (0.07 + 0.14 * weight) * (e.def.boss ? 0.4 : 1);
      e.sq = Math.min(e.sq, -compression);
      e.sqV = Math.max(-4, e.sqV);
    }
    return dealt;
  } finally {
    this.vfx.contact = previous;
    this.vfx.contactPending = previousContact;
  }
}

const escapeDust: BurstOptions = {
  count: 7, color: '#73eff7', color2: '#94b0c2', speed: [1.8, 3.2],
  size: [0.09, 0.17], life: [0.22, 0.42], up: 1.4, drag: 2, shape: 'chip',
};

export function escapeBeat(g: Game, h: Hero): void {
  const p = h.player;
  if (p.hp <= 0 || p.hp > p.maxHp * combatJuiceTuning.criticalLife) return;
  g.vfx.burst(p.x, 0.18, p.z, escapeDust);
  g.vfx.ring(p.x, p.z, 0.9, 3.8, '#73eff7', 0.42);
}

/** Resolve the affected hero on the authority. Replay receives just the resulting shake and ring. */
export function hurtBeat(g: Game, x: number, z: number, amount: number): void {
  for (const h of g.heroes) {
    const p = h.player;
    if (p.x !== x || p.z !== z || h.left) continue;
    const fraction = Math.min(1, amount / p.maxHp);
    if (fraction < combatJuiceTuning.heavyHurtFraction) return;
    g.vfx.ring(x, z, 0.9, 2.8 + 4 * fraction, '#ef7d57', 0.24);
    g.vfx.shake(x, z, 0.12 + fraction * 0.38);
    if (!g.online && !g.race && !g.pvp && settings.slowMo !== false && !settings.reduceFlash && !settings.reduceScreenEffects) g.juice.freeze(Math.min(0.105, 0.05 + fraction * 0.15));
    return;
  }
}
