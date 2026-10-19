/** Hand-authored challenges. IDs and seeds are permanent: records survive copy/tuning changes. */
export type TrialMetric = 'damage' | 'time' | 'kills' | 'combo';
export type TrialGoal = 'survive' | 'boss' | 'parry' | 'dash' | 'environment' | 'escort' | 'gems' | 'kills' | 'beats' | 'puzzle' | 'stealth' | 'zones';
export type TrialCategory = 'basics' | 'skill' | 'heroes' | 'world' | 'bosses' | 'pairs';
export interface TrialDef {
  id: string; tier: number; category: TrialCategory; seed: number; biome: string;
  hero: string; kit: readonly string[]; rank: number; seconds: number; goal: TrialGoal; target: number;
  metric: TrialMetric; medals: readonly [number, number, number];
  foes: readonly string[]; alive: number; bosses?: readonly string[];
  players?: 2; only?: boolean; noHit?: boolean; mech?: boolean; gravity?: boolean; phase?: number;
}
const def = (id: string, tier: number, category: TrialCategory, goal: TrialGoal, target: number, metric: TrialMetric, medals: TrialDef['medals'], extra: Partial<TrialDef> = {}): TrialDef => ({
  id, tier, category, seed: 61001 + id.split('').reduce((a, c, i) => a + c.charCodeAt(0) * (i + 1), 0),
  biome: 'meadow', hero: 'rookie', kit: ['buster', 'charge'], rank: 2, seconds: 90, goal, target, metric, medals,
  foes: ['bopper', 'zippy'], alive: 24, ...extra,
});
export const TRIALS: readonly TrialDef[] = [
  def('buster', 0, 'basics', 'survive', 90, 'damage', [90, 35, 0], { kit: ['buster'], only: true, rank: 0 }),
  def('king', 0, 'bosses', 'boss', 1, 'time', [90, 60, 40], { bosses: ['king'], kit: ['rail', 'charge', 'drones'], rank: 5, alive: 0 }),
  def('parry', 0, 'skill', 'parry', 20, 'time', [120, 80, 50], { seconds: 120, foes: [], alive: 0, kit: [], only: true }),
  def('gems', 0, 'world', 'gems', 30, 'time', [120, 80, 50], { seconds: 120, gravity: true, biome: 'sky', alive: 12 }),
  def('ronin', 0, 'heroes', 'kills', 60, 'time', [120, 85, 55], { hero: 'ronin', kit: ['katana', 'iaido'], seconds: 120, only: true, alive: 35 }),
  def('combo', 0, 'basics', 'survive', 90, 'combo', [15, 35, 60], { kit: ['scatter', 'charge', 'drones'], alive: 40 }),
  def('rhino', 1, 'skill', 'dash', 10, 'time', [120, 85, 55], { kit: [], only: true, foes: ['charger'], alive: 3, seconds: 120 }),
  def('rex', 1, 'bosses', 'survive', 60, 'damage', [0, 0, 0], { bosses: ['rex'], phase: 2, noHit: true, kit: [], only: true, alive: 0, seconds: 60 }),
  def('environment', 1, 'world', 'environment', 20, 'time', [150, 100, 65], { biome: 'magma', seconds: 150, alive: 40, only: true }),
  def('escort', 1, 'world', 'escort', 1, 'time', [150, 110, 75], { biome: 'factory', kit: ['laser', 'well', 'drones'], seconds: 150, alive: 14 }),
  def('tinker', 1, 'heroes', 'kills', 80, 'time', [150, 105, 70], { hero: 'tinker', kit: ['beacon', 'drones'], seconds: 150, rank: 4, alive: 35, only: true }),
  def('rhythm', 1, 'skill', 'beats', 25, 'time', [120, 90, 60], { biome: 'neon', seconds: 120, kit: ['buster', 'charge'], alive: 35 }),
  def('mech', 2, 'heroes', 'kills', 150, 'time', [90, 65, 45], { mech: true, alive: 65, biome: 'factory' }),
  def('puzzle', 2, 'world', 'puzzle', 6, 'time', [120, 75, 45], { kit: [], only: true, foes: [], alive: 0, seconds: 120, biome: 'peaks' }),
  def('rush', 2, 'bosses', 'boss', 3, 'time', [180, 135, 95], { seconds: 180, bosses: ['king', 'rex', 'queen'], kit: ['rail', 'well', 'drones', 'lightning'], rank: 5, alive: 0 }),
  def('night', 2, 'world', 'stealth', 3, 'time', [150, 105, 70], { seconds: 150, biome: 'dunes:night', kit: [], only: true, foes: ['bopper', 'shooter'], alive: 12 }),
  def('bulwark', 2, 'heroes', 'survive', 120, 'damage', [100, 40, 0], { seconds: 120, hero: 'bulwark', kit: ['buster', 'shield'], biome: 'peaks', foes: ['shooter', 'burster'], alive: 14 }),
  def('furnace', 2, 'heroes', 'kills', 100, 'time', [120, 90, 60], { seconds: 120, hero: 'furnace', kit: ['buster', 'charge', 'fire'], biome: 'magma', alive: 45 }),
  def('queen', 3, 'bosses', 'boss', 1, 'time', [120, 80, 50], { seconds: 120, bosses: ['queen'], biome: 'peaks', hero: 'ace', kit: ['laser', 'charge', 'missiles'], rank: 5, alive: 0 }),
  def('clean', 3, 'skill', 'survive', 90, 'kills', [20, 45, 75], { noHit: true, kit: ['buster', 'charge'], foes: ['shooter', 'bopper'], alive: 28 }),
  def('dance', 3, 'skill', 'beats', 40, 'time', [150, 110, 80], { seconds: 150, biome: 'neon', kit: ['scatter', 'well'], alive: 45 }),
  def('pair-core', 3, 'pairs', 'escort', 1, 'time', [180, 120, 80], { seconds: 180, players: 2, biome: 'factory', kit: ['laser', 'well', 'drones'], alive: 30 }),
  def('pair-zones', 3, 'pairs', 'zones', 1, 'damage', [180, 70, 0], { seconds: 120, players: 2, biome: 'sky', kit: ['scatter', 'charge', 'drones'], alive: 25 }),
  def('pair-rush', 3, 'pairs', 'boss', 3, 'time', [180, 135, 90], { seconds: 180, players: 2, bosses: ['king', 'rex', 'queen'], kit: ['rail', 'well', 'lightning'], rank: 5, alive: 0 }),
];
export const TRIAL_BY_ID = Object.fromEntries(TRIALS.map(d => [d.id, d])) as Record<string, TrialDef>;
export const TRIAL_TIER_POINTS = [0, 6, 18, 36] as const;
export type TrialMedal = 0 | 1 | 2 | 3;
export interface TrialResult { time: number; damage: number; kills: number; combo: number; progress: number; success: boolean; medal: TrialMedal; }
export interface TrialBest { medal: TrialMedal; time: number; value: number; }
export type TrialRecords = Record<string, TrialBest>;
export function medalFor(d: TrialDef, r: Omit<TrialResult, 'medal'>): TrialMedal {
  if (![r.time, r.damage, r.kills, r.combo].every(n => Number.isFinite(n) && n >= 0) || !r.success || !Number.isFinite(r.progress) || r.progress < d.target || !Number.isFinite(r[d.metric]) || r.time > d.seconds + 0.05 || (d.noHit && r.damage > 0)) return 0;
  const value = r[d.metric], lower = d.metric === 'time' || d.metric === 'damage';
  for (let i = 2; i >= 0; i--) if (lower ? value <= d.medals[i] : value >= d.medals[i]) return (i + 1) as TrialMedal;
  return 0;
}
export function trialPoints(records: TrialRecords): number { return TRIALS.reduce((n, d) => n + (records[d.id]?.medal ?? 0), 0); }
export function trialUnlocked(d: TrialDef, records: TrialRecords): boolean { return trialPoints(records) >= TRIAL_TIER_POINTS[d.tier]; }
/** Unknown IDs and malformed records are dropped; old/missing storage starts with tier one. */
export function normalizeTrialRecords(raw: unknown): TrialRecords {
  const out: TrialRecords = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const d of TRIALS) {
    const r = (raw as TrialRecords)[d.id];
    if (r && [1, 2, 3].includes(r.medal) && Number.isFinite(r.time) && r.time >= 0 && r.time <= d.seconds + 0.05 && Number.isFinite(r.value) && r.value >= 0) out[d.id] = { medal: r.medal, time: r.time, value: r.value };
  }
  return out;
}
/** Higher medals win; within a medal use its metric, then fastest completion. XP only for new medal levels. */
export function recordTrial(records: TrialRecords, d: TrialDef, r: TrialResult): number {
  const medal = medalFor(d, r);
  if (!medal) return 0;
  const old = records[d.id], value = r[d.metric], lower = d.metric === 'time' || d.metric === 'damage';
  const xp = Math.max(0, medal - (old?.medal ?? 0)) * 100;
  if (!old || medal > old.medal || (medal === old.medal && (lower ? value < old.value : value > old.value)) || (medal === old.medal && value === old.value && r.time < old.time)) records[d.id] = { medal, time: r.time, value };
  return xp;
}
export const TRIAL_ACHIEVEMENTS = [
  { id: 'trial_first', name: 'Trial Spark', desc: 'Earn your first trial medal', tier: 'bronze' as const, cat: 'modes' as const },
  { id: 'trial_gold10', name: 'Trial Champion', desc: 'Earn gold in 10 different trials', tier: 'gold' as const, cat: 'modes' as const },
];
