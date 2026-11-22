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
  enrageTargets: [45, 55, 65, 85],
  enrageInterval: 20,
  assistDelay: 90,
  damagePerStep: 0.10,
  speedPerStep: 0.08,
  maxSpeedBonus: 0.40,
};

export const bossLike = (e: Enemy): boolean => !!(e.def.boss || e.def.miniboss || e.def.titanPart); // Titan weak points too (src/game/titan.ts)

/** Scale a freeze duration for the enemy it lands on. */
export const freezeMul = (e: Enemy): number => (bossLike(e) ? bossRuleTuning.freezeMul : 1);

export const isAssistDifficulty = (id: string) => id === 'easy' || id === 'assist';

/** The fourth fight in each loop gets a longer budget for its phase mechanics. */
export function enrageTarget(stage: number, difficulty: string): number {
  const t = bossRuleTuning;
  const assist = isAssistDifficulty(difficulty);
  return t.enrageTargets[(Math.max(1, stage) - 1) % t.enrageTargets.length] + (assist ? t.assistDelay : 0);
}

export function enrageLevel(elapsed: number, target: number): number {
  return elapsed < target ? 0 : 1 + Math.floor((elapsed - target) / bossRuleTuning.enrageInterval);
}

export const enrageDamage = (level: number) => 1 + level * bossRuleTuning.damagePerStep;
export const enrageSpeed = (level: number) => 1 + Math.min(bossRuleTuning.maxSpeedBonus, level * bossRuleTuning.speedPerStep);
