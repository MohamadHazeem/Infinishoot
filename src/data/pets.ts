/**
 * Pets: a little companion that floats beside your hero. Picked in
 * EXTRAS > WARDROBE; some unlock with achievements.
 *
 * Pets grow: they start at level 1 every run, gain a level each stage
 * cleared (up to PET_MAX_LEVEL) and learn the skill at that step of their
 * `tree`. A skill learned twice is rank 2 (stronger). Skill numbers live in
 * `petTuning`; the behaviour runs on the host in src/game/systems/companion.ts.
 */
export type PetSkillId =
  | 'fetch'
  | 'zap'
  | 'taunt'
  | 'shield'
  | 'revive'
  | 'scout'
  | 'absorb'
  | 'split'
  | 'flame'
  | 'wings'
  | 'steal'
  | 'lucky'
  | 'turret'
  | 'porter';

export interface PetDef {
  id: string;
  name: string;
  desc: string;
  color: string;
  unlock?: string;
  /** Skill learned at level 1, 2, ... PET_MAX_LEVEL. */
  tree: PetSkillId[];
}

export const PET_MAX_LEVEL = 5;

export const PETS: PetDef[] = [
  { id: 'none', name: 'No Pet', desc: 'Go it alone.', color: '#566c86', tree: [] },
  {
    id: 'bit',
    name: 'Bit',
    desc: 'The fetcher: pulls gems and coins to you. Grows a zap, a shield and a revive.',
    color: '#73eff7',
    tree: ['fetch', 'zap', 'shield', 'revive', 'fetch'],
  },
  {
    id: 'guardian',
    name: 'Guardian',
    desc: 'The protector: revives you once per run. Grows a shield and taunts enemies away.',
    color: '#ffcd75',
    unlock: 'boss_slayer',
    tree: ['revive', 'shield', 'taunt', 'shield', 'taunt'],
  },
  {
    id: 'sparky',
    name: 'Sparky',
    desc: 'The fighter: zaps nearby enemies. Grows faster chains, a taunt and a revive.',
    color: '#fff35c',
    unlock: 'elite_hunter',
    tree: ['zap', 'taunt', 'zap', 'revive', 'zap'],
  },
  {
    id: 'robopup',
    name: 'ROBO-PUP',
    desc: 'Loyal and loud. Fetches loot, barks at crowds and guards your back.',
    color: '#ef7d57',
    unlock: 'first_steps',
    tree: ['fetch', 'taunt', 'fetch', 'shield', 'taunt'],
  },
  {
    id: 'owlbot',
    name: 'OWL-BOT',
    desc: 'A curious night owl. Spots threats and hidden relays; its second scan lights the dark.',
    color: '#73eff7',
    unlock: 'elite_hunter',
    tree: ['scout', 'zap', 'scout', 'shield', 'revive'],
  },
  {
    id: 'slimebuddy',
    name: 'SLIME BUDDY',
    desc: 'A cheerful jelly. Eats hostile bullets and splits into two bouncy helpers.',
    color: '#a7f070',
    unlock: 'stage_2',
    tree: ['absorb', 'fetch', 'split', 'absorb', 'split'],
  },
  {
    id: 'hatchling',
    name: 'DRAGON HATCHLING',
    desc: 'A brave little show-off. Breathes fire and earns its wings at level 5.',
    color: '#ef7d57',
    unlock: 'stage_3',
    tree: ['flame', 'taunt', 'flame', 'shield', 'wings'],
  },
  {
    id: 'catdrone',
    name: 'CAT DRONE',
    desc: 'A smug treasure hunter. Swipes gold and brings lucky critical hits.',
    color: '#b13e53',
    unlock: 'speedster',
    tree: ['steal', 'fetch', 'lucky', 'steal', 'lucky'],
  },
  {
    id: 'minimech',
    name: 'MINI MECH',
    desc: 'A diligent engineer. Plants a turret and carries your co-op bomb without slowing you.',
    color: '#41a6f6',
    unlock: 'field_engineer',
    tree: ['turret', 'shield', 'porter', 'turret', 'revive'],
  },
];

export const pets2Tuning = {
  scoutEvery: 2,
  scoutRange: 48,
  nightRadius: 17,
  absorbEvery: [7, 4],
  absorbRadius: 2.8,
  absorbScan: 0.1,
  splitEvery: 12,
  splitTime: 6,
  splitTick: 0.9,
  splitDamage: 9,
  splitPerLevel: 2,
  flameEvery: [3.2, 2.2],
  flameRange: 7,
  flameDamage: 16,
  flamePerLevel: 4,
  wingsRange: 2,
  wingsDamage: 1.3,
  stealEvery: [5, 3.5],
  stealRange: 8,
  stealPerStage: 18,
  luckyCrit: 0.05,
  turretEvery: 12,
  turretTime: 7,
  turretTick: [1, 0.65],
  turretRange: 11,
  turretDamage: 10,
  turretPerLevel: 2,
};

export const PET_BY_ID = Object.fromEntries(PETS.map((p) => [p.id, p])) as Record<string, PetDef>;

export const PET_SKILL_INFO: Record<
  PetSkillId,
  { name: string; color: string; desc: (rank: number) => string }
> = {
  fetch: {
    name: 'FETCH',
    color: '#73eff7',
    desc: (r) =>
      `+${Math.round(petTuning.fetchMagnet * r * 100)}% pickup range; grabs up to ${petTuning.fetchCount[r - 1]} gems and coins every ${petTuning.fetchEvery[r - 1]} s`,
  },
  zap: {
    name: 'ZAP',
    color: '#fff35c',
    desc: (r) =>
      `zaps ${petTuning.zapTargets[r - 1]} ${r > 1 ? 'enemies' : 'enemy'} every ${petTuning.zapEvery[r - 1]} s`,
  },
  taunt: {
    name: 'TAUNT',
    color: '#ef7d57',
    desc: (r) =>
      `every ${petTuning.tauntEvery[r - 1]} s draws nearby enemies away for ${petTuning.tauntTime[r - 1]} s`,
  },
  shield: {
    name: 'SHIELD',
    color: '#41a6f6',
    desc: (r) => `blocks one big hit per stage${r > 1 ? ' and blasts enemies back' : ''}`,
  },
  scout: {
    name: 'SCOUT',
    color: '#73eff7',
    desc: () =>
      'scans for elites and distant threats; rank II reveals hidden relays and lights the night',
  },
  absorb: {
    name: 'GULP',
    color: '#a7f070',
    desc: () => 'absorbs one nearby hostile bullet every 7 / 4 s',
  },
  split: {
    name: 'SPLIT',
    color: '#a7f070',
    desc: () => 'summons two helpers for 6 s every 12 s; rank II doubles their damage',
  },
  flame: {
    name: 'FIRE BURST',
    color: '#ef7d57',
    desc: () => 'breathes a cone of fire every 3.2 / 2.2 s',
  },
  wings: {
    name: 'WINGS',
    color: '#ffcd75',
    desc: () => 'grows wings; fire reaches 2 m farther and deals 30% more damage',
  },
  steal: {
    name: 'SWIPE',
    color: '#b13e53',
    desc: () => 'swipes 1 gold from a new enemy every 5 / 3.5 s; up to 18 per stage',
  },
  lucky: { name: 'LUCKY', color: '#ffcd75', desc: () => 'adds 5% critical-hit chance per rank' },
  turret: {
    name: 'TURRET',
    color: '#41a6f6',
    desc: () => 'plants a 7 s turret every 12 s; rank II fires faster',
  },
  porter: {
    name: 'PORTER',
    color: '#41a6f6',
    desc: () => 'carries your co-op objective bomb at full movement speed',
  },
  revive: { name: 'REVIVE', color: '#ffcd75', desc: () => 'revives you once per run' },
};

/** Pet skill numbers. Arrays are indexed by rank - 1. */
export const petTuning = {
  /** Fetch: extra magnet range per rank (+0.6 = the old Bit's +60%). */
  fetchMagnet: 0.6,
  fetchEvery: [2.5, 1.5],
  fetchRange: [10, 14],
  fetchCount: [4, 8],
  /** Zap: interval, chained targets, range; damage = zapDmg + zapPerLevel * team level, times zapMul. */
  zapEvery: [1.5, 1.2, 0.9],
  zapTargets: [1, 2, 3],
  zapMul: [1, 1.15, 1.3],
  zapRange: 9,
  zapDmg: 10,
  zapPerLevel: 3,
  /** Taunt: cooldown, how long the decoy holds, the least it flies out (it goes 2 m past the crowd's middle), the crowd check radius and size. */
  tauntEvery: [12, 9],
  tauntTime: [2.5, 3.5],
  tauntDist: 5,
  tauntCheck: 8,
  tauntMinEnemies: 3,
  /** Shield: hits at least this fraction of max life (or lethal ones) are blocked. */
  shieldMinFrac: 0.12,
  shieldIframes: 1,
  shieldBlastR: 4,
  shieldBlastDmg: 25,
  shieldBlastPerLevel: 5,
  /** Revive: life fraction and i-frames on getting up. */
  reviveHp: 0.6,
  reviveIframes: 2.5,
  /** Presentation: body scale per level above 1. */
  growPerLevel: 0.12,
};

/** Skill ranks a pet has at a level (a skill repeated in the tree ranks up). */
export function petRanks(def: PetDef, level: number): Record<PetSkillId, number> {
  const r: Record<PetSkillId, number> = {
    fetch: 0,
    zap: 0,
    taunt: 0,
    shield: 0,
    revive: 0,
    scout: 0,
    absorb: 0,
    split: 0,
    flame: 0,
    wings: 0,
    steal: 0,
    lucky: 0,
    turret: 0,
    porter: 0,
  };
  const n = Math.max(0, Math.min(level, def.tree.length, PET_MAX_LEVEL));
  for (let i = 0; i < n; i++) r[def.tree[i]]++;
  return r;
}

/** The skill a pet learns on reaching `level` (null past the tree or for no pet). */
export function petSkillAt(def: PetDef, level: number): PetSkillId | null {
  return level >= 1 && level <= def.tree.length ? def.tree[level - 1] : null;
}

/** Clamp a rank into a tuning array. */
export function rankOf<T>(arr: readonly T[], rank: number): T {
  return arr[Math.max(0, Math.min(arr.length - 1, rank - 1))];
}
