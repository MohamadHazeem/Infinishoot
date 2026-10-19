import { dailySeed } from './modes';
/** UTC ISO week: Monday boundary, ISO week-year (including New Year rollover). */
export function isoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export const WEEKLY_RULES = [
  { id: 'speed', name: 'Turbo Trouble', desc: 'Enemies move at double speed.' },
  {
    id: 'right',
    name: 'Right on Time',
    desc: 'No left-click weapon. Use your right click and special!',
  },
  { id: 'elites', name: 'Elite Parade', desc: 'Every normal director spawn is an elite.' },
  { id: 'glass', name: 'One Hit Wonder', desc: 'Any unblocked hit is lethal. Revives still work.' },
  { id: 'barrage', name: 'Bullet Carnival', desc: 'Enemy shots travel twice as fast.' },
] as const;
export type WeeklyRule = (typeof WEEKLY_RULES)[number]['id'];
export function weeklyChallenge(week = isoWeek()) {
  const seed = dailySeed(`infinishoot-weekly-v1-${week}`);
  const first = seed % WEEKLY_RULES.length;
  const second = (first + 1 + ((seed >>> 8) % (WEEKLY_RULES.length - 1))) % WEEKLY_RULES.length;
  return {
    week,
    seed,
    rules: [WEEKLY_RULES[first], WEEKLY_RULES[second]],
    board: `weekly-${week}`,
  };
}
