/**
 * Heat: optional difficulty modifiers picked on the MODE screen (like Hades' Heat).
 * Each modifier has ranks; every rank adds heat, and total heat multiplies the
 * score. Heat never gives stats: clearing the run (beating the final boss) at a
 * heat milestone only unlocks cosmetics (skins, through achievements in src/data/meta.ts).
 * Off in Daily, Weekly and PvP. Co-op uses the host's heat.
 * Behaviour: src/game/systems/runMods.ts (via RunMods in src/game/runMods.ts).
 */
export type HeatId = 'hp' | 'speed' | 'dmg' | 'horde' | 'elites' | 'boss' | 'iframes' | 'hunger' | 'volatile' | 'boots' | 'purse';

export interface HeatDef {
  id: HeatId;
  name: string;
  icon: string;
  max: number;
  /** Heat per rank. */
  heat: number;
  /** What rank `r` (1..max) does. */
  desc(r: number): string;
}

export const heatTuning = {
  scorePerHeat: 0.05, // score x(1 + this x heat)
  hp: 0.15, // enemy life per rank
  speed: 0.08, // enemy speed per rank
  dmg: 0.12, // enemy damage per rank
  horde: 0.1, // enemies alive per rank
  elites: 0.2, // seconds between elites x(1 - this x rank)
  boss: 0.25, // boss and mini-boss life per rank
  iframes: 0.3, // i-frames after a hit x(1 - this x rank)
  volatile: 0.08, // chance per rank that a slain enemy leaves a telegraphed blast
  volatileDmg: 12, // blast damage (x stage damage scaling)
  volatileR: 1.6,
  volatileFuse: 0.9,
  boots: 0.25, // dash recharge time per rank
  purse: 0.15, // shop prices per rank
};

const pct = (v: number) => `${Math.round(v * 100)}%`;

export const HEAT_MODS: HeatDef[] = [
  { id: 'hp', name: 'Thick Hides', icon: '▣', max: 3, heat: 1, desc: (r) => `Enemies have +${pct(heatTuning.hp * r)} life.` },
  { id: 'speed', name: 'Hasty Foes', icon: '»', max: 3, heat: 1, desc: (r) => `Enemies move ${pct(heatTuning.speed * r)} faster.` },
  { id: 'dmg', name: 'Hard Hitters', icon: '✷', max: 3, heat: 1, desc: (r) => `Enemies hit ${pct(heatTuning.dmg * r)} harder.` },
  { id: 'horde', name: 'Horde', icon: '☠', max: 3, heat: 1, desc: (r) => `${pct(heatTuning.horde * r)} more enemies at once.` },
  { id: 'elites', name: 'Elite Patrol', icon: '♛', max: 2, heat: 2, desc: (r) => `Elites arrive ${pct(1 / (1 - heatTuning.elites * r) - 1)} more often.` },
  { id: 'boss', name: 'Boss Fury', icon: '♚', max: 2, heat: 1, desc: (r) => `Bosses and mini-bosses have +${pct(heatTuning.boss * r)} life.` },
  { id: 'iframes', name: 'Thin Skin', icon: '✚', max: 2, heat: 1, desc: (r) => `${pct(heatTuning.iframes * r)} shorter invincibility after a hit.` },
  { id: 'hunger', name: 'Hunger', icon: '♥', max: 2, heat: 2, desc: (r) => (r >= 2 ? 'Level-ups don\'t heal and no hearts drop.' : 'Level-ups don\'t heal.') },
  { id: 'volatile', name: 'Volatile', icon: '✺', max: 2, heat: 2, desc: (r) => `${pct(heatTuning.volatile * r)} of slain enemies leave a blast behind.` },
  { id: 'boots', name: 'Heavy Boots', icon: '◔', max: 2, heat: 1, desc: (r) => `Your dash recharges ${pct(heatTuning.boots * r)} slower.` },
  { id: 'purse', name: 'Tight Purse', icon: '●', max: 2, heat: 1, desc: (r) => `Shop prices +${pct(heatTuning.purse * r)}.` },
];

export const HEAT_BY_ID = Object.fromEntries(HEAT_MODS.map((h) => [h.id, h])) as Record<HeatId, HeatDef>;

/** Chosen ranks by modifier id (missing = 0). */
export type HeatRanks = Partial<Record<HeatId, number>>;

/** Keep only known modifiers, with whole ranks in range. */
export function cleanHeat(raw: unknown): HeatRanks {
  const out: HeatRanks = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const d of HEAT_MODS) {
    const v = Math.floor(Number((raw as Record<string, unknown>)[d.id]));
    if (Number.isFinite(v) && v > 0) out[d.id] = Math.min(d.max, v);
  }
  return out;
}

export function heatTotal(r: HeatRanks): number {
  let n = 0;
  for (const d of HEAT_MODS) n += (r[d.id] ?? 0) * d.heat;
  return n;
}

export const HEAT_MAX = HEAT_MODS.reduce((a, d) => a + d.max * d.heat, 0);

export function heatScoreMul(total: number): number {
  return 1 + heatTuning.scorePerHeat * total;
}

/** Heat milestones: beat the final boss at this heat or more to earn the achievement (a skin). */
export const HEAT_GOALS: { heat: number; achievement: string; reward: string }[] = [
  { heat: 4, achievement: 'heat_4', reward: 'Ember skin' },
  { heat: 10, achievement: 'heat_10', reward: 'Inferno skin' },
  { heat: 20, achievement: 'heat_20', reward: 'Solar skin' },
];

/** Short form for lobbies and labels: "HEAT 7". */
export function heatLabel(r: HeatRanks): string {
  const t = heatTotal(r);
  return t > 0 ? `HEAT ${t}` : '';
}
