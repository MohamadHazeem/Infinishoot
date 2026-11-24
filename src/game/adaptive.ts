import type { Tag } from '../data/tags';

export const resistanceTuning = { window: 10, windows: 12, share: 0.6, step: 0.04, levels: 5 };
export const damageFamilies = ['kinetic', 'fire', 'frost', 'shock', 'explosive', 'area', 'orbit', 'trail'] as const;

/** An elemental round counts once, even when it also has delivery tags. */
export function damageFamily(tags?: readonly Tag[]): number {
  if (tags) {
    for (let i = 1; i < damageFamilies.length; i++) {
      if (tags.includes(damageFamilies[i] as Tag)) return i;
    }
    if (tags.includes('chain')) return 3;
  }
  return 0;
}

/** Each threshold is the first eligible spawn UID at that resistance level. A
 * dip removes the top threshold immediately. Survivors never acquire a new tier. */
export class AdaptiveResistance {
  readonly totals = new Float64Array(damageFamilies.length);
  readonly thresholds: number[] = [];
  family = -1;
  private leader = -1;
  private streak = 0;
  private elapsed = 0;

  record(family: number, amount: number): void {
    this.totals[family] += amount;
  }

  step(dt: number, nextUid: number): boolean {
    this.elapsed += dt;
    if (this.elapsed + 1e-8 < resistanceTuning.window) return false;
    this.elapsed -= resistanceTuning.window;
    let sum = 0,
      lead = 0;
    for (let i = 0; i < this.totals.length; i++) {
      sum += this.totals[i];
      if (this.totals[i] > this.totals[lead]) lead = i;
    }
    if (this.totals[lead] <= sum * resistanceTuning.share) lead = -1;
    this.totals.fill(0);
    this.streak = lead < 0 ? 0 : this.leader === lead ? this.streak + 1 : 1;
    this.leader = lead;
    if (lead !== this.family && this.thresholds.length) {
      this.thresholds.pop();
      if (!this.thresholds.length) this.family = -1;
    }
    if (this.streak < resistanceTuning.windows || this.thresholds.length >= resistanceTuning.levels) return false;
    this.family = lead;
    this.thresholds.push(nextUid);
    return this.thresholds.length === 1;
  }

  levels(uid: number): number {
    for (let i = this.thresholds.length - 1; i >= 0; i--) if (uid >= this.thresholds[i]) return i + 1;
    return 0;
  }
}

export function resists(def: import('../data/enemies').EnemyDef): boolean {
  return !(def.boss || def.miniboss || def.hidden || def.titanPart || def.treasure);
}
