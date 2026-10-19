import type { Enemy } from './enemies';

/**
 * Boss-like rules: the stage boss and the mid-stage mini-bosses (Prince Bopper,
 * Rex Jr., Hive Princess) resist freezes, take the Nuke's fixed bite instead of
 * dying, are never recycled closer, and shrug off instant-kill hazards. Only
 * `def.boss` gets the boss bar, the stage clear and relics.
 */
export const bossRuleTuning = {
  /** Freezes on boss-like enemies last this fraction of their normal time. */
  freezeMul: 0.15,
};

export const bossLike = (e: Enemy): boolean => !!(e.def.boss || e.def.miniboss);

/** Scale a freeze duration for the enemy it lands on. */
export const freezeMul = (e: Enemy): number => (bossLike(e) ? bossRuleTuning.freezeMul : 1);
