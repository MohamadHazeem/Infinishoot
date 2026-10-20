/**
 * Elite modifiers. Every elite rolls one of these on spawn; it is named in the
 * "ELITE ... INCOMING" toast, tints the elite's glow and ground ring, and
 * changes how the fight plays.
 */
export type EliteModId = 'shielded' | 'fast' | 'splitting' | 'vampiric' | 'teleporting' | 'explosive' | 'gravity' | 'summoner' | 'mirrored' | 'phasing' | 'berserk' | 'frostbite';

export interface EliteModDef {
  id: EliteModId;
  /** Shown in the toast: "ELITE SHIELDED RHINO INCOMING!". */
  name: string;
  desc: string;
  /** Ground ring, shield bubble and spawn telegraph colour. */
  color: string;
  /** Body glow (rgb 0-1), replacing the plain elite gold. */
  glow: [number, number, number];
  /** Relative roll chance. */
  weight: number;
  /** Multipliers on top of the normal elite HP / speed. */
  hpMul?: number;
  speedMul?: number;
  /** Shield worth this fraction of the elite's max HP; absorbs hits (and blocks Burn/Shock) until broken. */
  shield?: number;
  /** Afterimage trail: seconds between puffs while moving. */
  trail?: number;
  /** On death, burst into `count` normal-size copies, each with `hpMul` x a normal enemy's HP. */
  split?: { count: number; hpMul: number };
  /** Heals this fraction of max HP whenever it hurts a player, and regenerates per second. */
  vampire?: { onHit: number; regen: number };
  /** Blinks next to its target every this many seconds. */
  teleport?: number;
  /** On death, a telegraphed blast (radius, damage) after a short fuse. */
  explode?: { r: number; dmg: number; fuse: number };
}

export const ELITE_MODS: Record<EliteModId, EliteModDef> = {
  shielded: {
    id: 'shielded',
    name: 'Shielded',
    desc: 'A shield soaks up hits until it breaks.',
    color: '#41a6f6',
    glow: [0.45, 0.8, 1],
    weight: 1,
    shield: 0.6,
  },
  fast: {
    id: 'fast',
    name: 'Fast',
    desc: 'Much faster, a bit frailer, leaves a trail.',
    color: '#ff5d3a',
    glow: [1, 0.35, 0.2],
    weight: 1,
    hpMul: 0.75,
    speedMul: 1.75,
    trail: 0.05,
  },
  vampiric: {
    id: 'vampiric',
    name: 'Vampiric',
    desc: 'Heals when it hits you, and slowly regenerates.',
    color: '#b13e53',
    glow: [0.75, 0.05, 0.2],
    weight: 1,
    vampire: { onHit: 0.15, regen: 0.012 },
  },
  teleporting: {
    id: 'teleporting',
    name: 'Blinking',
    desc: 'Teleports next to you every few seconds.',
    color: '#a35cff',
    glow: [0.65, 0.35, 1],
    weight: 1,
    teleport: 3.5,
  },
  explosive: {
    id: 'explosive',
    name: 'Volatile',
    desc: 'Blows up when it dies. Get clear!',
    color: '#ff7a2f',
    glow: [1, 0.55, 0.1],
    weight: 1,
    explode: { r: 3.4, dmg: 24, fuse: 0.9 },
  },
  splitting: {
    id: 'splitting',
    name: 'Splitting',
    desc: 'Bursts into smaller copies when it dies.',
    color: '#a7f070',
    glow: [0.65, 1, 0.4],
    weight: 1,
    split: { count: 4, hpMul: 3 },
  },
  gravity: { id: 'gravity', name: 'Gravity', desc: 'Pulls heroes and bullets gently inward. Dash out of the violet ring.', color: '#5d275d', glow: [0.65, 0.35, 1], weight: 0.8 },
  summoner: { id: 'summoner', name: 'Summoner', desc: 'Calls two small helpers every six seconds. Keep the crowd under control.', color: '#a7f070', glow: [0.65, 1, 0.4], weight: 0.8 },
  mirrored: { id: 'mirrored', name: 'Mirrored', desc: 'Reflects every fourth bullet as a weaker pink shot. Use beams or area attacks.', color: '#73eff7', glow: [0.45, 0.95, 1], weight: 0.7, hpMul: 0.85 },
  phasing: { id: 'phasing', name: 'Phasing', desc: 'Vanishes for one second every five seconds. Save your burst for its return.', color: '#94b0c2', glow: [0.58, 0.69, 0.76], weight: 0.7, hpMul: 0.85 },
  berserk: { id: 'berserk', name: 'Berserk', desc: 'Gains speed and damage as life falls. Finish it before it corners you.', color: '#b13e53', glow: [1, 0.25, 0.3], weight: 1 },
  frostbite: { id: 'frostbite', name: 'Frostbite', desc: 'Leaves icy trails that slow your movement. Dash across the cyan patches.', color: '#41a6f6', glow: [0.25, 0.65, 1], weight: 0.8 },

};

/** Stable order: the index is what co-op snapshots carry (0 = no modifier). */
export const ELITE_MOD_IDS = Object.keys(ELITE_MODS) as EliteModId[];

/** All elites2 gameplay numbers live here; exposed in the debug panel. */
export const elites2Tuning = {
  championStage: 3, championChance: 0.12, championHp: 1.25,
  gravityRadius: 6, gravityPull: 1.1, bulletPull: 3,
  summonEvery: 6, summonCount: 2, summonCap: 560,
  reflectEvery: 4, reflectDamage: 0.35, reflectMaxDamage: 12, reflectMaxSpeed: 14,
  phaseEvery: 5, phaseTime: 1,
  berserkSpeed: 0.65, berserkDamage: 0.5,
  frostEvery: 0.65, frostLife: 3, frostRadius: 1.15, frostSlow: 0.35,
  championGold: 12,
};
/** Reserved below OWNED_CHEST (100); normal chests use 1. */
export const CHAMPION_CHEST = 2;
export const CHAMPION_DESC = 'Rare elites from stage 3 carry two modifiers and a golden name. Their chest grants two upgrades and 12 gold.';

/** Stable weighted roll, with the same exclusions for both champion slots. */
export function pickEliteMod(roll: number, noSplit: boolean, stationary: boolean, exclude?: EliteModId): EliteModId {
  let total = 0;
  const allowed = (id: EliteModId) => id !== exclude && !(ELITE_MODS[id].split && noSplit) && !(ELITE_MODS[id].teleport && stationary);
  for (const id of ELITE_MOD_IDS) if (allowed(id)) total += ELITE_MODS[id].weight;
  let r = Math.max(0, Math.min(0.999999999, roll)) * total;
  for (const id of ELITE_MOD_IDS) if (allowed(id) && (r -= ELITE_MODS[id].weight) < 0) return id;
  return 'berserk';
}
export function championRoll(stage: number, roll: number): boolean { return stage >= elites2Tuning.championStage && roll < elites2Tuning.championChance; }
export function berserkBonus(hp: number, maxHp: number): number { return Math.max(0, Math.min(1, 1 - hp / Math.max(1, maxHp))); }
