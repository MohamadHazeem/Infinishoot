/**
 * Pets: a little companion that floats beside your hero. Picked in
 * EXTRAS > WARDROBE; some unlock with achievements.
 *
 * Pets grow: they start at level 1 every run, gain a level each stage
 * cleared (up to PET_MAX_LEVEL) and learn the skill at that step of their
 * `tree`. A skill learned twice is rank 2 (stronger). Skill numbers live in
 * `petTuning`; the behaviour runs on the host in src/game/systems/companion.ts.
 */
export type PetSkillId = 'fetch' | 'zap' | 'taunt' | 'shield' | 'revive';

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
];

export const PET_BY_ID = Object.fromEntries(PETS.map((p) => [p.id, p])) as Record<string, PetDef>;

export const PET_SKILL_INFO: Record<PetSkillId, { name: string; color: string; desc: (rank: number) => string }> = {
  fetch: { name: 'FETCH', color: '#73eff7', desc: (r) => `+${Math.round(petTuning.fetchMagnet * r * 100)}% pickup range; grabs up to ${petTuning.fetchCount[r - 1]} gems and coins every ${petTuning.fetchEvery[r - 1]} s` },
  zap: { name: 'ZAP', color: '#fff35c', desc: (r) => `zaps ${petTuning.zapTargets[r - 1]} ${r > 1 ? 'enemies' : 'enemy'} every ${petTuning.zapEvery[r - 1]} s` },
  taunt: { name: 'TAUNT', color: '#ef7d57', desc: (r) => `every ${petTuning.tauntEvery[r - 1]} s draws nearby enemies away for ${petTuning.tauntTime[r - 1]} s` },
  shield: { name: 'SHIELD', color: '#41a6f6', desc: (r) => `blocks one big hit per stage${r > 1 ? ' and blasts enemies back' : ''}` },
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
  /** Taunt: cooldown, how long the decoy holds, how far the pet flies out, enemies needed nearby. */
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
  const r: Record<PetSkillId, number> = { fetch: 0, zap: 0, taunt: 0, shield: 0, revive: 0 };
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
