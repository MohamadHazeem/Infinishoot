/** Game modes and difficulty levels, picked on the MODE screen before a solo run. */
export type ModeId = 'standard' | 'endless' | 'bossrush' | 'daily';

export interface ModeDef {
  id: ModeId;
  name: string;
  desc: string;
}

export const MODES: ModeDef[] = [
  { id: 'standard', name: 'Standard', desc: 'Survive each stage, beat the boss, take the portal. Endless stages.' },
  { id: 'endless', name: 'Endless', desc: 'One arena, no portals. A boss every 4 minutes, the shop between, and it never ends.' },
  { id: 'bossrush', name: 'Boss Rush', desc: 'Every stage starts at the boss. Bonus levels each stage.' },
  { id: 'daily', name: 'Daily Challenge', desc: "Today's seed, Normal difficulty. Same arenas for everyone; beat your best of the day." },
];

export type DifficultyId = 'easy' | 'normal' | 'hard' | 'nightmare';

export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  desc: string;
  enemyHp: number;
  enemyDmg: number;
  enemyCount: number;
  score: number;
  /** Achievement that unlocks it. */
  unlock?: string;
}

export const DIFFICULTIES: DifficultyDef[] = [
  { id: 'easy', name: 'Easy', desc: 'Softer enemies, fewer of them. Score x0.6.', enemyHp: 0.7, enemyDmg: 0.6, enemyCount: 0.8, score: 0.6 },
  { id: 'normal', name: 'Normal', desc: 'The game as designed.', enemyHp: 1, enemyDmg: 1, enemyCount: 1, score: 1 },
  { id: 'hard', name: 'Hard', desc: 'Tougher, angrier, more of them. Score x1.5.', enemyHp: 1.4, enemyDmg: 1.3, enemyCount: 1.15, score: 1.5, unlock: 'stage_3' },
  { id: 'nightmare', name: 'Nightmare', desc: 'Good luck. Score x2.2.', enemyHp: 2, enemyDmg: 1.6, enemyCount: 1.3, score: 2.2, unlock: 'hard_stage3' },
];

export const DIFF_BY_ID = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d])) as Record<DifficultyId, DifficultyDef>;
export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDef>;

/** Today's date (local) as yyyy-mm-dd. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The same seed for everyone on a given day. */
export function dailySeed(date = today()): number {
  let h = 2166136261;
  for (const c of date) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
