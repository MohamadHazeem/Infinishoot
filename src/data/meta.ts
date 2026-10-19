/**
 * Achievements: lifetime goals that unlock auto weapons for the level-up pool
 * and loadout items (clicks and specials) for the LOADOUT screen. This is the
 * only progression that carries between runs.
 */
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Auto weapon added to the level-up pool, if any. */
  unlockWeapon?: string;
  /** Loadout item (left/right-click weapon id or special id) made pickable, if any. */
  unlockLoadout?: string;
  /** Can be earned from lifetime stats alone (old saves get it on load). */
  lifetime?: (l: { kills: number; elites: number; bosses: number; bestStage: number; runs: number }) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_steps', name: 'First Steps', desc: 'Defeat 300 enemies in total', unlockLoadout: 'shield', unlockWeapon: 'pellets', lifetime: (l) => l.kills >= 300 },
  { id: 'boss_slayer', name: 'Boss Slayer', desc: 'Defeat a boss', unlockWeapon: 'missiles', lifetime: (l) => l.bosses >= 1 },
  { id: 'stage_2', name: 'Onward', desc: 'Reach stage 2', unlockLoadout: 'blizzard', lifetime: (l) => l.bestStage >= 2 },
  { id: 'elite_hunter', name: 'Elite Hunter', desc: 'Defeat 5 elites in total', unlockWeapon: 'nova', lifetime: (l) => l.elites >= 5 },
  { id: 'evolved', name: 'Evolution', desc: 'Evolve a weapon or special', unlockLoadout: 'well', unlockWeapon: 'bouncer', lifetime: (l) => l.bestStage >= 3 },
  { id: 'arsenal', name: 'Full Arsenal', desc: 'Hold 6 weapons at once', unlockLoadout: 'orb' },
  { id: 'exterminator', name: 'Exterminator', desc: 'Defeat 3,000 enemies in total', unlockWeapon: 'mines', lifetime: (l) => l.kills >= 3000 },
  { id: 'speedster', name: 'Speedster', desc: 'Dash 60 times in one run', unlockWeapon: 'fire' },
  { id: 'stage_3', name: 'Deep Diver', desc: 'Reach stage 3', unlockLoadout: 'meteor', lifetime: (l) => l.bestStage >= 3 },
  { id: 'maxed', name: 'Maxed Out', desc: 'Max out a weapon', unlockLoadout: 'laser', unlockWeapon: 'sweeper' },
  { id: 'boss_rush', name: 'Boss Rush', desc: 'Defeat 5 bosses in total', unlockLoadout: 'orbital', lifetime: (l) => l.bosses >= 5 },
  { id: 'elite_slayer', name: 'Elite Slayer', desc: 'Defeat 25 elites in total', unlockLoadout: 'rail', lifetime: (l) => l.elites >= 25 },
  { id: 'victory', name: 'The End?', desc: 'Defeat the final boss on stage 4', unlockLoadout: 'blackhole', lifetime: (l) => l.bestStage > 4 },
  { id: 'hard_stage3', name: 'Hard Boiled', desc: 'Reach stage 3 on Hard or Nightmare' },
  { id: 'endless_5', name: 'Marathon', desc: 'Reach wave 5 in Endless' },
  { id: 'rush_3', name: 'Boss Buster', desc: 'Beat 3 bosses in the Boss Rush mode' },
  // Hero unlocks (src/data/heroes.ts; checked in src/game/systems/heroMechs.ts).
  { id: 'riposte', name: 'Riposte', desc: 'Parry 25 times in one run' },
  { id: 'immovable', name: 'Immovable', desc: 'Stand still for 20 seconds straight during a stage' },
  { id: 'double_trouble', name: 'Double Trouble', desc: 'Evolve both your left and right click in one run' },
  // heroes3 lane: Ronin and Tinker (checked in src/game/systems/heroes3.ts).
  { id: 'point_blank', name: 'Point Blank', desc: 'Defeat 150 enemies within 2.5 m of you in one run' },
  { id: 'workshop', name: 'Workshop', desc: 'Hold 4 auto weapons at level 5 or higher in one run' },
];
