/**
 * Daily quests (meta2 lane): three per day, picked from QUESTS by a seed made
 * from the local date, so everyone gets the same three on the same day.
 * Progress is the sum of the matching run-tally key over that day's runs
 * (src/data/profile.ts keys). Rewards are profile XP; completed quests also
 * count toward quest-only cosmetics (PROFILE_REWARDS with `quests`).
 */
import { Rng } from '../core/rng';

export type QuestTier = 'easy' | 'medium' | 'hard';

export interface QuestDef {
  id: string;
  /** Text with `#` for the goal number. */
  text: string;
  stat: string;
  goal: number;
  tier: QuestTier;
  /** Only offered when the player can do it alone (co-op quests are fine: local co-op counts). */
  coop?: boolean;
}

export const QUEST_XP: Record<QuestTier, number> = { easy: 120, medium: 220, hard: 360 };
/** Extra XP for finishing all three in a day. */
export const QUEST_ALL_BONUS = 250;

export const QUESTS: QuestDef[] = [
  // Easy
  { id: 'q_kill300', text: 'Defeat # enemies', stat: 'kills', goal: 300, tier: 'easy' },
  { id: 'q_stage2', text: 'Clear # stages', stat: 'stages', goal: 2, tier: 'easy' },
  { id: 'q_chest5', text: 'Open # chests', stat: 'chests', goal: 5, tier: 'easy' },
  { id: 'q_elite5', text: 'Defeat # elites', stat: 'k_elite', goal: 5, tier: 'easy' },
  { id: 'q_time10', text: 'Survive # minutes in total', stat: 'time', goal: 600, tier: 'easy' },
  { id: 'q_boss1', text: 'Defeat # boss', stat: 'bosses', goal: 1, tier: 'easy' },
  { id: 'q_pdash10', text: 'Land # perfect dashes', stat: 'perfectDashes', goal: 10, tier: 'easy' },
  { id: 'q_ult3', text: 'Fire # ultimates', stat: 'ultimates', goal: 3, tier: 'easy' },
  // Medium
  { id: 'q_fire500', text: 'Defeat # enemies with fire', stat: 'k_fire', goal: 500, tier: 'medium' },
  { id: 'q_frost400', text: 'Defeat # enemies with frost', stat: 'k_frost', goal: 400, tier: 'medium' },
  { id: 'q_shock400', text: 'Defeat # enemies with shock', stat: 'k_shock', goal: 400, tier: 'medium' },
  { id: 'q_boom500', text: 'Defeat # enemies with explosions', stat: 'k_explosive', goal: 500, tier: 'medium' },
  { id: 'q_orbit300', text: 'Defeat # enemies with orbit weapons', stat: 'k_orbit', goal: 300, tier: 'medium' },
  { id: 'q_parry15', text: 'Parry # shots', stat: 'parries', goal: 15, tier: 'medium' },
  { id: 'q_cash3', text: 'Cash in your combo # times', stat: 'cashIns', goal: 3, tier: 'medium' },
  { id: 'q_coop1', text: 'Clear a stage in co-op', stat: 'coopStages', goal: 1, tier: 'medium', coop: true },
  { id: 'q_mech1', text: 'Ride a mech suit', stat: 'mechs', goal: 1, tier: 'medium' },
  { id: 'q_evo1', text: 'Evolve # item', stat: 'evolutions', goal: 1, tier: 'medium' },
  { id: 'q_daily', text: 'Play the Daily Challenge', stat: 'dailyRuns', goal: 1, tier: 'medium' },
  // Hard
  { id: 'q_kill2000', text: 'Defeat # enemies', stat: 'kills', goal: 2000, tier: 'hard' },
  { id: 'q_boss3', text: 'Defeat # bosses', stat: 'bosses', goal: 3, tier: 'hard' },
  { id: 'q_stage4', text: 'Clear # stages', stat: 'stages', goal: 4, tier: 'hard' },
  { id: 'q_flawless', text: 'Clear a stage without getting hit', stat: 'flawless', goal: 1, tier: 'hard' },
  { id: 'q_parry40', text: 'Parry # shots', stat: 'parries', goal: 40, tier: 'hard' },
  { id: 'q_mini2', text: 'Defeat # mini-bosses', stat: 'k_mini', goal: 2, tier: 'hard' },
  { id: 'q_coop3', text: 'Clear # stages in co-op', stat: 'coopStages', goal: 3, tier: 'hard', coop: true },
];

export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(QUESTS.map((q) => [q.id, q]));

export function questText(q: QuestDef): string {
  return q.text.replace('#', q.stat === 'time' ? String(Math.round(q.goal / 60)) : q.goal.toLocaleString('en-US'));
}

/** Seed for a YYYY-MM-DD date. */
function dateSeed(day: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 0x85ebca6b) >>> 0;
  return h >>> 0;
}

/** The day's three quests: one easy, one medium, one hard, never two on the same stat. */
export function dailyQuests(day: string): QuestDef[] {
  const rng = new Rng(dateSeed(day));
  const out: QuestDef[] = [];
  for (const tier of ['easy', 'medium', 'hard'] as QuestTier[]) {
    const pool = QUESTS.filter((q) => q.tier === tier && !out.some((o) => o.stat === q.stat));
    out.push(pool[Math.floor(rng.next() * pool.length) % pool.length]);
  }
  return out;
}

/** Local date as YYYY-MM-DD (quests roll over at local midnight, like the Daily Challenge). */
export function questDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
