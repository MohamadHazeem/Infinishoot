import type { NumKind } from '../game/vfx';

export const combatJuiceTuning = {
  levelSlow: 0.20, evolutionSlow: 0.38, heavyHurtFraction: 0.18,
  criticalLife: 0.25, critLift: 0.75, stackCell: 0.65,
};

export function rewardSlow(evolution: boolean): number {
  return evolution ? combatJuiceTuning.evolutionSlow : combatJuiceTuning.levelSlow;
}

/** The compact number record already carries the world anchor. Keep repeats on one row. */
export function labelLift(value: number | string, kind: NumKind, by?: number): number {
  if (by === undefined || typeof value !== 'string') return 0;
  if (kind === 'crit' && value.endsWith('!')) return combatJuiceTuning.critLift;
  if (kind !== 'hit') return 0;
  if (value.endsWith(' SHIELD')) return 0.52;
  if (value.endsWith(' FIRE') || value.endsWith(' SHOCK') || value.endsWith(' FROST')) return 0.32;
  return 0;
}

export function stackAnchor(n: number): number {
  const cell = combatJuiceTuning.stackCell;
  return Math.round(n / cell) * cell;
}

/** 12 and 25 bridge the long gap before the voiced 50/100/150 kill milestones. */
export function streakTier(combo: number): number {
  if (combo === 12) return 1;
  if (combo === 25) return 2;
  if (combo > 0 && combo % 50 === 0) return Math.min(5, 2 + combo / 50);
  return 0;
}
