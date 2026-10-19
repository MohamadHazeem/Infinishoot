/**
 * Profile level (meta2 lane): every run earns profile XP (time, kills, bosses,
 * stages, co-op bonus) and daily quests add more. Levels 1-100 unlock cosmetic
 * rewards only (titles, banner colours, HUD themes, pet hats, trail colours):
 * every run still starts equal.
 *
 * The run tally (src/game/systems/meta2.ts) is a flat record of counters. Most
 * are summed into lifetime totals at the end of a run; PEAK keys keep the best
 * single-run value instead. Achievements and quests read the same keys.
 */

/** Counters a run can report (all optional; missing = 0). */
export type RunTally = Record<string, number>;

/**
 * Stat keys and what they count. Summed into lifetime stats unless listed in
 * PEAK_STATS. Kill keys are this hero's own kills (k_<tag> by the hitting
 * weapon's tags); boss keys are team credit (everyone in the run gets them).
 */
export const STAT_NAMES: Record<string, string> = {
  runs: 'Runs',
  time: 'Time played (s)',
  kills: 'Enemies defeated',
  k_fire: 'Fire kills',
  k_frost: 'Frost kills',
  k_shock: 'Shock kills',
  k_explosive: 'Explosive kills',
  k_projectile: 'Projectile kills',
  k_orbit: 'Orbit kills',
  k_area: 'Area kills',
  k_chain: 'Chain kills',
  k_trail: 'Trail kills',
  k_elite: 'Elites defeated',
  k_veteran: 'Veterans defeated',
  k_mini: 'Mini-bosses defeated',
  k_goldbug: 'Goldbugs popped',
  k_reaper: 'Reapers defeated',
  bosses: 'Bosses defeated',
  b_king: 'King Bopper',
  b_rex: 'Rampage Rex',
  b_queen: 'Hive Queen',
  b_omega: 'Omega Overlord',
  b_titan: 'Titan Goliath',
  b_remix: 'Rematch bosses',
  stages: 'Stages cleared',
  victories: 'Loops cleared',
  chests: 'Chests opened',
  parries: 'Parries',
  perfectDashes: 'Perfect dashes',
  ultimates: 'Ultimates',
  cashIns: 'Combo cash-ins',
  mechs: 'Mech suit rides',
  crates: 'Super weapons',
  rewinds: 'Rewinds',
  lastStands: 'Last stands won',
  closeCalls: 'Close calls',
  revives: 'Teammates revived',
  coopRuns: 'Co-op runs',
  coopStages: 'Co-op stages cleared',
  localRuns: 'Local co-op runs',
  pvpDuels: 'PvP duels',
  pvpWins: 'PvP wins',
  versusRuns: 'Versus matches',
  versusWins: 'Versus wins',
  evolutions: 'Evolutions',
  fusions: 'Fusions',
  flawless: 'Flawless stages',
  dailyRuns: 'Daily challenges',
  weeklyRuns: 'Weekly challenges',
  endlessRuns: 'Endless runs',
  rushRuns: 'Boss Rush runs',
  rhythm: 'Rhythm stages',
  pacifist: 'Pacifist stages',
  minigames: 'Mini-games',
  photos: 'Photo mode visits',
  secretShops: 'Secret merchants',
  jackpots: 'Jackpots',
  golden: 'Golden routes',
  worldEvents: 'World events survived',
  comebacks: 'Comebacks',
  quests: 'Daily quests done',
  // Peaks (best single run)
  stage: 'Best stage',
  level: 'Best level',
  combo: 'Best combo',
  style: 'Best style rank',
  gold: 'Most gold held',
  heat: 'Highest heat',
  wave: 'Best Endless wave',
  rushBosses: 'Most Boss Rush bosses',
  runKills: 'Most kills in a run',
  runTime: 'Longest run (s)',
};

/** Keys that keep the best single-run value instead of a lifetime sum. */
export const PEAK_STATS = new Set(['stage', 'level', 'combo', 'style', 'gold', 'heat', 'wave', 'rushBosses', 'runKills', 'runTime']);

/** Sets of distinct things seen (lifetime): heroes played, biomes visited, world events, boss kinds beaten, kits. */
export type SetKey = 'heroes' | 'biomes' | 'events' | 'bossKinds' | 'modes' | 'screens';

// ---------------------------------------------------------------- XP

export const profileTuning = {
  /** XP per minute survived. */
  perMinute: 6,
  /** XP per kill (your own). */
  perKill: 0.1,
  perElite: 5,
  perBoss: 50,
  perStage: 40,
  perVictory: 200,
  /** Co-op runs (2+ heroes, online or local) earn this much more. */
  coopBonus: 1.25,
  /** Most XP one run can give (endless marathons). */
  runCap: 4000,
  /** Level curve: XP needed from level l to l + 1 = base + step * (l - 1). */
  base: 100,
  step: 25,
  maxLevel: 100,
};

export interface XpBreakdown {
  time: number;
  kills: number;
  bosses: number;
  stages: number;
  coop: number;
  total: number;
}

/** Profile XP a finished run is worth. */
export function runXp(t: RunTally): XpBreakdown {
  const T = profileTuning;
  const time = Math.floor(((t.time ?? 0) / 60) * T.perMinute);
  const kills = Math.floor((t.kills ?? 0) * T.perKill + (t.k_elite ?? 0) * T.perElite);
  const bosses = (t.bosses ?? 0) * T.perBoss + (t.victories ?? 0) * T.perVictory;
  const stages = (t.stages ?? 0) * T.perStage;
  const base = time + kills + bosses + stages;
  const coop = (t.coopRuns ?? 0) > 0 || (t.localRuns ?? 0) > 0 ? Math.floor(base * (T.coopBonus - 1)) : 0;
  return { time, kills, bosses, stages, coop, total: Math.min(T.runCap, base + coop) };
}

/** XP needed to go from `level` to the next. */
export function xpToNext(level: number): number {
  return profileTuning.base + profileTuning.step * (level - 1);
}

/** Total XP needed to reach `level` (level 1 = 0). */
export function xpForLevel(level: number): number {
  const n = Math.max(0, Math.min(profileTuning.maxLevel, level) - 1);
  return profileTuning.base * n + (profileTuning.step * n * (n - 1)) / 2;
}

/** Level for a total XP, with progress into it (0..1; 1 at max level). */
export function levelOf(xp: number): { level: number; into: number; need: number; frac: number } {
  let lo = 1;
  let hi = profileTuning.maxLevel;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xpForLevel(mid) <= xp) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= profileTuning.maxLevel) return { level: lo, into: 0, need: 0, frac: 1 };
  const into = xp - xpForLevel(lo);
  const need = xpToNext(lo);
  return { level: lo, into, need, frac: Math.max(0, Math.min(1, into / need)) };
}

// ---------------------------------------------------------------- rewards

export type RewardKind = 'title' | 'banner' | 'hud' | 'hat' | 'trail';

export interface ProfileReward {
  id: string;
  kind: RewardKind;
  name: string;
  /** Profile level that unlocks it (0 = see `quests`). */
  level: number;
  /** Or: daily quests completed in total. */
  quests?: number;
  /** Sweetie 16 colour (banner, HUD theme, trail, hat). */
  color?: string;
}

export const REWARD_KIND_NAME: Record<RewardKind, string> = { title: 'YOUR TITLE', banner: 'BANNER', hud: 'HUD THEME', hat: 'PET HAT', trail: 'TRAIL' };

/** Level 1 owns the defaults (Rookie title, Navy banner, no hat or trail). */
export const PROFILE_REWARDS: ProfileReward[] = [
  { id: 't_rookie', kind: 'title', name: 'Rookie', level: 1 },
  { id: 'b_navy', kind: 'banner', name: 'Navy', level: 1, color: '#29366f' },
  { id: 'h_default', kind: 'hud', name: 'Classic', level: 1, color: '#ffcd75' },
  { id: 't_cadet', kind: 'title', name: 'Cadet', level: 2 },
  { id: 'tr_dust', kind: 'trail', name: 'Stardust', level: 3, color: '#f4f4f4' },
  { id: 'b_teal', kind: 'banner', name: 'Teal', level: 4, color: '#257179' },
  { id: 't_scrapper', kind: 'title', name: 'Scrapper', level: 5 },
  { id: 'hat_cap', kind: 'hat', name: 'Ball Cap', level: 6, color: '#b13e53' },
  { id: 'h_lime', kind: 'hud', name: 'Lime', level: 7, color: '#a7f070' },
  { id: 't_gunner', kind: 'title', name: 'Gunner', level: 8 },
  { id: 'b_plum', kind: 'banner', name: 'Plum', level: 10, color: '#5d275d' },
  { id: 'tr_ember', kind: 'trail', name: 'Ember', level: 12, color: '#ef7d57' },
  { id: 't_ace', kind: 'title', name: 'Hotshot', level: 14 },
  { id: 'hat_party', kind: 'hat', name: 'Party Hat', level: 15, color: '#73eff7' },
  { id: 'b_red', kind: 'banner', name: 'Ruby', level: 17, color: '#b13e53' },
  { id: 'h_sky', kind: 'hud', name: 'Sky', level: 18, color: '#41a6f6' },
  { id: 't_ranger', kind: 'title', name: 'Ranger', level: 20 },
  { id: 'tr_frost', kind: 'trail', name: 'Frost', level: 22, color: '#73eff7' },
  { id: 'b_green', kind: 'banner', name: 'Clover', level: 24, color: '#38b764' },
  { id: 't_buster', kind: 'title', name: 'Buster Pro', level: 25 },
  { id: 'hat_tophat', kind: 'hat', name: 'Top Hat', level: 28, color: '#333c57' },
  { id: 'h_orange', kind: 'hud', name: 'Tangerine', level: 30, color: '#ef7d57' },
  { id: 't_veteran', kind: 'title', name: 'Veteran', level: 32 },
  { id: 'b_slate', kind: 'banner', name: 'Gunmetal', level: 35, color: '#566c86' },
  { id: 'tr_leaf', kind: 'trail', name: 'Meadow', level: 37, color: '#a7f070' },
  { id: 't_hunter', kind: 'title', name: 'Bot Hunter', level: 40 },
  { id: 'hat_crown', kind: 'hat', name: 'Paper Crown', level: 42, color: '#ffcd75' },
  { id: 'b_blue', kind: 'banner', name: 'Cobalt', level: 45, color: '#3b5dc9' },
  { id: 'h_cyan', kind: 'hud', name: 'Ice', level: 48, color: '#73eff7' },
  { id: 't_hero', kind: 'title', name: 'Island Hero', level: 50 },
  { id: 'tr_plasma', kind: 'trail', name: 'Plasma', level: 53, color: '#41a6f6' },
  { id: 'b_orange', kind: 'banner', name: 'Sunset', level: 56, color: '#ef7d57' },
  { id: 't_warden', kind: 'title', name: 'Warden', level: 60 },
  { id: 'hat_horns', kind: 'hat', name: 'Devil Horns', level: 63, color: '#b13e53' },
  { id: 'h_red', kind: 'hud', name: 'Alarm', level: 66, color: '#b13e53' },
  { id: 't_legend', kind: 'title', name: 'Living Legend', level: 70 },
  { id: 'tr_rose', kind: 'trail', name: 'Rose', level: 73, color: '#b13e53' },
  { id: 'b_gold', kind: 'banner', name: 'Gold', level: 76, color: '#ffcd75' },
  { id: 't_overlord', kind: 'title', name: 'Overlord Bane', level: 80 },
  { id: 'hat_halo', kind: 'hat', name: 'Halo', level: 85, color: '#fff35c' },
  { id: 'tr_gold', kind: 'trail', name: 'Gold Rush', level: 88, color: '#ffcd75' },
  { id: 't_mythic', kind: 'title', name: 'Mythic', level: 90 },
  { id: 'b_white', kind: 'banner', name: 'Pearl', level: 95, color: '#f4f4f4' },
  { id: 'h_white', kind: 'hud', name: 'Pearl', level: 97, color: '#f4f4f4' },
  { id: 't_infinite', kind: 'title', name: 'Infinite', level: 100 },
  // Daily quest rewards (total quests completed).
  { id: 't_errand', kind: 'title', name: 'Errand Runner', level: 0, quests: 3 },
  { id: 'b_mint', kind: 'banner', name: 'Mint', level: 0, quests: 10, color: '#a7f070' },
  { id: 'hat_beanie', kind: 'hat', name: 'Beanie', level: 0, quests: 20, color: '#38b764' },
  { id: 't_questor', kind: 'title', name: 'Questor', level: 0, quests: 45 },
  { id: 'tr_rainbow', kind: 'trail', name: 'Rainbow', level: 0, quests: 90 },
];

export const REWARD_BY_ID: Record<string, ProfileReward> = Object.fromEntries(PROFILE_REWARDS.map((r) => [r.id, r]));

/** Rainbow trail cycles these. */
export const RAINBOW = ['#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#73eff7', '#41a6f6', '#5d275d'];

export function rewardOpen(r: ProfileReward, level: number, quests: number): boolean {
  return r.quests ? quests >= r.quests : level >= r.level;
}

/** Rewards that open between two levels (for the level-up moment). */
export function rewardsBetween(from: number, to: number): ProfileReward[] {
  return PROFILE_REWARDS.filter((r) => !r.quests && r.level > from && r.level <= to);
}

/** Default equipped cosmetic per kind. */
export const DEFAULT_EQUIP: Record<RewardKind, string> = { title: 't_rookie', banner: 'b_navy', hud: 'h_default', hat: '', trail: '' };

// ---------------------------------------------------------------- lobby summary

/** What other players see on your lobby card (sent in `hello`). */
export interface ProfileSummary {
  lv: number;
  title: string;
  banner: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Clean a summary from the network (null if missing or junk). */
export function cleanSummary(raw: unknown): ProfileSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lv = Math.floor(Number(r.lv));
  if (!Number.isFinite(lv) || lv < 1 || lv > profileTuning.maxLevel) return null;
  const title = REWARD_BY_ID[String(r.title)]?.kind === 'title' ? REWARD_BY_ID[String(r.title)].name : 'Rookie';
  const banner = typeof r.banner === 'string' && HEX.test(r.banner) ? r.banner : '#29366f';
  return { lv, title, banner };
}
