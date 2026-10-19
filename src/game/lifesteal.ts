import type { Hero } from './hero';

/**
 * Vampire Fang (life per kill) without the snowball (fixes lane).
 * Bot runs showed Fang 3 healing back ~95% of all damage taken through
 * stages 1-5: heal per second grew with the kill rate (40-80 kills a second
 * late on, 6-12 life a second), and with Glass Cannon the flat heal refilled
 * its 40 max life every few seconds, so the curse cost nothing.
 *  - The heal scales with max life (`killHeal` is per 100 max life), so Glass
 *    Cannon's x0.4 life also means x0.4 healing.
 *  - Full rate only up to `killsPerSec` kills a second; kills beyond that
 *    heal `overflow` of their share. Fang 3 tops out near 1.8 life a second
 *    (per 100 max life) plus a trickle, about Nanobots 5 (1.5 a second).
 */
export const lifestealTuning = {
  /** Kills per second that heal in full. */
  killsPerSec: 12,
  /** Share of the healing beyond that which still lands. */
  overflow: 0.1,
};

/** Rolling budget: refills at `rate` life per second, holds at most one second's worth. */
export class LifestealBudget {
  private left = 0;
  private t = -1;

  /** Heal `amount` at sim time `now` with a full-rate budget of `rate` life a second: returns what lands. */
  take(amount: number, rate: number, now: number): number {
    if (amount <= 0) return 0;
    // A new run restarts the clock: start full.
    this.left = this.t < 0 || now < this.t ? rate : Math.min(rate, this.left + (now - this.t) * rate);
    this.t = now;
    const full = Math.min(amount, this.left);
    this.left -= full;
    return full + (amount - full) * lifestealTuning.overflow;
  }
}

const budgets = new WeakMap<Hero, LifestealBudget>();

/** Vampire Fang heal for one kill by hero h at sim time `now` (killHeal is life per kill per 100 max life). */
export function vampHeal(h: Hero, killHeal: number, now: number): number {
  let b = budgets.get(h);
  if (!b) budgets.set(h, (b = new LifestealBudget()));
  const per = (killHeal * h.player.maxHp) / 100;
  return b.take(per, per * lifestealTuning.killsPerSec, now);
}
