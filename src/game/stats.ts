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
  luck: number; // lifts rarer level-up cards, Mods and gear drops (see data/rarity.ts)
  killHeal: number; // life restored per kill
  specialCooldownMul: number; // Q/E special cooldown multiplier (Battery Pack)
  dashCharges: number; // dashes you can chain before waiting (Dash Cells)
  // Applied by the synergy engine (src/game/synergy.ts).
  thorns: number; // Spiked Shell: damage of the spike burst when you get hit
  dashZap: number; // Tesla Boots: damage of the Shock pulse when you dash
  freezeChance: number; // Cryo Rounds: chance per hit to Freeze the enemy
  // Co-op passives, applied by Game to teammates within passiveTuning.teamRadius (never to yourself).
  teamHeal: number; // life per second each living teammate near you regains
  teamDmgAura: number; // added to the damageMul of each living teammate near you
  reviveSpeed: number; // extra revive rate while you stand by a downed teammate (+1 = twice as fast)
  reviveHp: number; // extra fraction of max life a teammate you revive gets up with
  nearMateArmor: number; // your armor bonus while any living teammate is near you
}

/** Knobs for passive effects. */
export const passiveTuning = {
  thornsRadius: 3.5,
  thornsPerArmor: 0.25, // Spiked Shell damage x(1 + this per point of Armor)
  dashZapRadius: 3,
  freezeTime: 1, // Cryo Rounds freeze in seconds (bosses get 15% of it)
  teamRadius: 7, // co-op passives reach teammates within this many metres
};

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
    luck: 0,
    killHeal: 0,
    specialCooldownMul: 1,
    dashCharges: 1,
    thorns: 0,
    dashZap: 0,
    freezeChance: 0,
    teamHeal: 0,
    teamDmgAura: 0,
    reviveSpeed: 0,
    reviveHp: 0,
    nearMateArmor: 0,
  };
}

function apply(s: Stats, add: Partial<Stats>, times: number): void {
  for (const [k, v] of Object.entries(add) as [keyof Stats, number][]) s[k] += v * times;
}

/** Stats from this run's passive levels (Mods are applied on top by the synergy engine). */
export function computeStats(passives: Record<string, number>, heroAdd: Partial<Stats> = {}, extra: Partial<Stats>[] = []): Stats {
  const s = baseStats();
  apply(s, heroAdd, 1);
  for (const add of extra) apply(s, add, 1); // stat relics
  for (const [id, lv] of Object.entries(passives)) {
    const def = PASSIVES[id];
    if (def) apply(s, def.add, lv);
  }
  s.cooldownMul = Math.max(0.4, s.cooldownMul);
  s.dashCooldownMul = Math.max(0.5, s.dashCooldownMul); // dash must stay below i-frame spam
  s.specialCooldownMul = Math.max(0.5, s.specialCooldownMul);
  s.critChance = Math.min(1, s.critChance);
  return s;
}
