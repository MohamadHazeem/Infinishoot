/**
 * Elite modifiers. Every elite rolls one of these on spawn; it is named in the
 * "ELITE ... INCOMING" toast, tints the elite's glow and ground ring, and
 * changes how the fight plays.
 */
export type EliteModId = 'shielded' | 'fast' | 'splitting';

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
  splitting: {
    id: 'splitting',
    name: 'Splitting',
    desc: 'Bursts into smaller copies when it dies.',
    color: '#a7f070',
    glow: [0.65, 1, 0.4],
    weight: 1,
    split: { count: 4, hpMul: 3 },
  },
};

/** Stable order: the index is what co-op snapshots carry (0 = no modifier). */
export const ELITE_MOD_IDS = Object.keys(ELITE_MODS) as EliteModId[];
