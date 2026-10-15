/**
 * Achievements: lifetime goals that unlock new weapons for the level-up pool.
 * This is the only progression that carries between runs.
 */
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Weapon id unlocked, if any. */
  unlockWeapon?: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_steps', name: 'First Steps', desc: 'Defeat 300 enemies in total' },
  { id: 'boss_slayer', name: 'Boss Slayer', desc: 'Defeat a boss', unlockWeapon: 'missiles' },
  { id: 'elite_hunter', name: 'Elite Hunter', desc: 'Defeat 5 elites in total', unlockWeapon: 'nova' },
  { id: 'exterminator', name: 'Exterminator', desc: 'Defeat 3,000 enemies in total', unlockWeapon: 'mines' },
  { id: 'speedster', name: 'Speedster', desc: 'Dash 60 times in one run', unlockWeapon: 'fire' },
  { id: 'arsenal', name: 'Full Arsenal', desc: 'Hold 6 weapons at once' },
  { id: 'maxed', name: 'Maxed Out', desc: 'Get a weapon to level 5' },
  { id: 'evolved', name: 'Evolution', desc: 'Evolve a weapon' },
  { id: 'stage_3', name: 'Deep Diver', desc: 'Reach stage 3' },
];
