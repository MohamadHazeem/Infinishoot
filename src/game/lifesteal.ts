import type { Hero } from './hero';

/**
 * Vampire Fang (life per kill) without the snowball (fixes lane).
 * Bot runs showed Fang 3 healing back ~97% of all damage taken from stage 3
 * on (kill rates of 40-80 a second), and with Glass Cannon the flat heal
 * filled its 40 max life several times a second, so the curse cost nothing.
 *  - The heal scales with max life (`killHeal` is per 100 max life), so Glass
 *    Cannon's x0.4 life also means x0.4 healing.
 *  - A per-hero budget: full healing up to `perSec` of max life per second,
 *    then only `overflow` of the rest, so big hordes don't make you immortal.
 */
export const lifestealTuning = {
  /** Full-rate healing per second, as a share of max life. */
  perSec: 0.025,
  /** Share of the healing beyond the budget that still lands. */
  overflow: 0.2,
};

/** Rolling budget: refills at perSec x max life per second, holds at most one second's worth. */
export class LifestealBudget {
  private left = 0;
  private t = -1;

  /** Heal for `amount` at sim time `now`: returns what actually lands. */
  take(amount: number, maxHp: number, now: number): number {
    if (amount <= 0 || maxHp <= 0) return 0;
    const cap = lifestealTuning.perSec * maxHp;
    // A new run restarts the clock: start full.
    this.left = this.t < 0 || now < this.t ? cap : Math.min(cap, this.left + (now - this.t) * cap);
    this.t = now;
    const full = Math.min(amount, this.left);
    this.left -= full;
    return full + (amount - full) * lifestealTuning.overflow;
  }
}

const budgets = new WeakMap<Hero, LifestealBudget>();

/** Vampire Fang heal for one kill by hero h at sim time `now` (killHeal is per 100 max life). */
export function vampHeal(h: Hero, killHeal: number, now: number): number {
  let b = budgets.get(h);
  if (!b) budgets.set(h, (b = new LifestealBudget()));
  const maxHp = h.player.maxHp;
  return b.take((killHeal * maxHp) / 100, maxHp, now);
}
