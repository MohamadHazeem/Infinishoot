import { PASSIVES } from '../data/passives';

/**
 * Everything passives and Mods can modify. Multipliers start at
 * 1 and bonuses add to them (two +10% = 1.2x), so stacking is predictable.
 */
export interface Stats {
  damageMul: number;
  cooldownMul: number; // lower = faster weapons
  areaMul: number;
  critChance: number;
  critMult: number;
  knockbackMul: number;
  maxHp: number;
  armor: number;
  regen: number; // life per second
  moveSpeedMul: number;
  dashCooldownMul: number;
  magnet: number; // pickup range multiplier
  xpMul: number;
  rerolls: number;
  revives: number;
  chargeSpeed: number; // Buster charge rate multiplier
  chargeDmg: number; // charged shot damage multiplier
}

export function baseStats(): Stats {
  return {
    damageMul: 1,
    cooldownMul: 1,
    areaMul: 1,
    critChance: 0.05,
    critMult: 2,
    knockbackMul: 1,
    maxHp: 100,
    armor: 0,
    regen: 0,
    moveSpeedMul: 1,
    dashCooldownMul: 1,
    magnet: 1,
    xpMul: 1,
    rerolls: 0,
    revives: 0,
    chargeSpeed: 1,
    chargeDmg: 1,
  };
}

function apply(s: Stats, add: Partial<Stats>, times: number): void {
  for (const [k, v] of Object.entries(add) as [keyof Stats, number][]) s[k] += v * times;
}

/** Stats from this run's passive levels (Mods are applied on top by the synergy engine). */
export function computeStats(passives: Record<string, number>, heroAdd: Partial<Stats> = {}): Stats {
  const s = baseStats();
  apply(s, heroAdd, 1);
  for (const [id, lv] of Object.entries(passives)) {
    const def = PASSIVES[id];
    if (def) apply(s, def.add, lv);
  }
  s.cooldownMul = Math.max(0.4, s.cooldownMul);
  s.critChance = Math.min(1, s.critChance);
  return s;
}
