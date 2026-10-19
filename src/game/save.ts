import { normalizeSeason, type SeasonSave } from '../data/seasons';
import { loadJson, saveJson } from '../core/storage';
import { ACHIEVEMENTS } from '../data/meta';
import { SPECIALS } from '../data/specials';
import { cleanHeat, type HeatId } from '../data/heat';
import { CODEX, META_REWARDS, META_KITS, rewardAvailable } from '../data/codex';
import { WEAPONS } from '../data/weapons';
import { cleanFriends, type FriendsData } from './lobby';
import { freshFirstTen, normalizeFirstTen, type FirstTenSave } from './firstten';
import { DEFAULT_EQUIP, REWARD_BY_ID, profileTuning, xpForLevel, type RewardKind, type SetKey } from '../data/profile';
import { HEROES } from '../data/heroes';
import { normalizeRanked, type RankedSave } from '../data/ranked';
import { normalizeSeasonPass, type SeasonPassSave } from '../data/season';
import { rewardHook } from '../data/profile';

/**
 * Persistent profile: achievements (weapon unlocks) and lifetime stats.
 * Stored in localStorage automatically; can be saved to a file for backup
 * or moving to another PC.
 */
/** One finished run, newest first in `history`. */
export interface RunRecord {
  heat?: number;
  weekly?: string;
  bolts?: number;
  date: string;
  label: string;
  hero: string;
  stage: number;
  score: number;
  kills: number;
  time: number;
  level: number;
  cause: string;
  weapons: { id: string; level: number; evo: boolean }[];
}

export interface SaveData {
  version: number;
  seasonal: SeasonSave;
  meta: {
    heat: HeatId[];
    bolts: number;
    bestHeat: Record<string, number>;
    weekly: { week: string; score: number; stage: number }[];
    codex: string[];
    rewards: string[];
    theme: string;
  };
  achievements: string[];
  /** Enemy ids met (enemy guide). */
  seen: string[];
  /** Last runs (max 30). */
  history: RunRecord[];
  /** First-time tips already shown (src/game/tips.ts). */
  tips: string[];
  /** Codex entries met: owned, picked or offered (src/data/codex.ts keys). */
  discovered: string[];
  /** The training field: offered once on a fresh save, and finished. */
  training: { offered: boolean; done: boolean };
  /** EXTRAS > FRIENDS (lobby lane): own friend code, recent teammates, saved codes. */
  friends: FriendsData;
  /** FIRST STEPS checklist and one-time helpers for new players (src/game/firstten.ts). */
  firstten: FirstTenSave;
  /** meta2 (v5): profile XP, lifetime stats by key (src/data/profile.ts), best runs and equipped cosmetics. */
  profile: ProfileData;
  /** meta2 (v5): today's daily quests (src/data/quests.ts). */
  quests: QuestData;
  /** meta2 (v5): unlock date (YYYY-MM-DD) per achievement earned since v5. */
  achDates: Record<string, string>;
  /** RANKED (race lane): this season's Elo-style rating for online PvP and race results, plus past seasons. */
  ranked: RankedSave;
  /** SEASON track (seasonpass lane, v9): season XP, claimed tiers, owned season cosmetics, weekly challenges, past seasons. */
  seasonPass: SeasonPassSave;
  lifetime: {
    runs: number;
    kills: number;
    elites: number;
    bosses: number;
    bestStage: number;
    bestLevel: number;
    playTime: number;
  };
}

/** A best run on the PROFILE timeline. */
export interface BestRun {
  date: string;
  mode: string;
  label: string;
  hero: string;
  score: number;
  stage: number;
  kills: number;
  time: number;
}

export interface ProfileData {
  xp: number;
  /** Lifetime sums, or best single run for PEAK_STATS keys. */
  stats: Record<string, number>;
  sets: Record<SetKey, string[]>;
  /** Your own kills per enemy id. */
  killsBy: Record<string, number>;
  /** Runs per hero id, and per kit ("left/right/special" ids). */
  heroRuns: Record<string, number>;
  kitRuns: Record<string, number>;
  /** Best run per mode id. */
  best: Record<string, BestRun>;
  /** Top runs by score (max 12), the PROFILE timeline. */
  timeline: BestRun[];
  /** Equipped cosmetic id per kind ('' = none). */
  equip: Record<RewardKind, string>;
}

export interface QuestData {
  day: string;
  ids: string[];
  /** Progress per quest (sum of the stat over the day's banked runs). */
  prog: number[];
  done: boolean[];
  /** All three done today (bonus paid). */
  all: boolean;
  /** Days in a row with all three done, and the last such day. */
  streak: number;
  lastAll: string;
}

export const SET_KEYS: SetKey[] = ['heroes', 'biomes', 'events', 'bossKinds', 'modes', 'screens'];

export function freshProfile(): ProfileData {
  return {
    xp: 0,
    stats: {},
    sets: { heroes: [], biomes: [], events: [], bossKinds: [], modes: [], screens: [] },
    killsBy: {},
    heroRuns: {},
    kitRuns: {},
    best: {},
    timeline: [],
    equip: { ...DEFAULT_EQUIP },
  };
}

const KEY = 'save';
// v2 dropped Bolts and Workshop upgrades; older saves keep their achievements and stats.
// v3 added the enemy guide (`seen`) and run history.
// v4 adds opt-in heat, weekly records, lore and cosmetic-only Bolts (main), first-time tips (`tips`), the Arsenal (`discovered`) and the training field (`training`). Legacy upgrades stay removed.
// v5: seasonal candy + cosmetics (halloween), `friends` (lobby); v6: merged; v7: meta2 profile (XP, stats, best runs, cosmetics), daily quests and achievement dates;
// v8: `ranked` (race lane: rating, monthly seasons, ladder id). Each lane normalises its own fields, so any older save loads.
// v9: `seasonPass` (seasonpass lane: the free cosmetic SEASON track); older saves start the current season at tier 0.
const VERSION = 9;
const CODE_PREFIX = 'ISAVE1:';

function fresh(): SaveData {
  return {
    version: VERSION,
    seasonal: normalizeSeason(null),
    meta: { heat: [], bolts: 0, bestHeat: {}, weekly: [], codex: [], rewards: [], theme: '' },
    achievements: [],
    seen: [],
    history: [],
    tips: [],
    discovered: [],
    training: { offered: false, done: false },
    friends: cleanFriends(null),
    firstten: freshFirstTen(),
    profile: freshProfile(),
    quests: { day: '', ids: [], prog: [], done: [], all: false, streak: 0, lastAll: '' },
    achDates: {},
    ranked: normalizeRanked(null),
    seasonPass: normalizeSeasonPass(null),
    lifetime: { runs: 0, kills: 0, elites: 0, bosses: 0, bestStage: 0, bestLevel: 0, playTime: 0 },
  };
}

/** Fill missing fields so older or partial saves keep working. */
export function normalize(raw: unknown): SaveData {
  const d = fresh();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  d.seasonal = normalizeSeason(r.seasonal);
  if (Array.isArray(r.achievements)) {
    d.achievements = r.achievements.filter((a) => ACHIEVEMENTS.some((x) => x.id === a));
  }
  if (Array.isArray(r.seen)) d.seen = r.seen.filter((x): x is string => typeof x === 'string');
  if (Array.isArray(r.tips)) d.tips = r.tips.filter((x): x is string => typeof x === 'string');
  if (Array.isArray(r.discovered)) d.discovered = r.discovered.filter((x): x is string => typeof x === 'string');
  if (r.training && typeof r.training === 'object') d.training = { offered: !!r.training.offered, done: !!r.training.done };
  d.friends = cleanFriends(r.friends);
  if (Array.isArray(r.history)) d.history = r.history.filter((x) => x && typeof x === 'object' && Number.isFinite((x as RunRecord).score)).slice(0, 30);
  if (r.lifetime && typeof r.lifetime === 'object') {
    for (const k of Object.keys(d.lifetime) as (keyof SaveData['lifetime'])[]) {
      const v = Number((r.lifetime as Record<string, unknown>)[k]);
      if (Number.isFinite(v) && v >= 0) d.lifetime[k] = v;
    }
  }
  d.firstten = normalizeFirstTen(r.firstten, d.lifetime.runs);
  d.ranked = normalizeRanked(r.ranked);
  d.seasonPass = normalizeSeasonPass(r.seasonPass);
  const m = r.meta;
  if (m && typeof m === 'object') {
    d.meta.heat = cleanHeat(m.heat);
    if (Number.isFinite(m.bolts) && m.bolts >= 0) d.meta.bolts = Math.floor(m.bolts);
    if (m.bestHeat && typeof m.bestHeat === 'object') for (const mode of ['standard', 'endless', 'bossrush']) {
      const n = m.bestHeat[mode];
      if (Number.isFinite(n) && n >= 0) d.meta.bestHeat[mode] = Math.min(14, Math.floor(n));
    }
    if (Array.isArray(m.weekly)) d.meta.weekly = m.weekly.filter(x => x && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(x.week) && Number.isFinite(x.score) && x.score >= 0 && Number.isFinite(x.stage)).slice(0, 52);
    if (Array.isArray(m.codex)) d.meta.codex = [...new Set(m.codex.filter(id => CODEX.some(c => c.id === id)))];
    if (Array.isArray(m.rewards)) d.meta.rewards = [...new Set(m.rewards.filter(id => META_REWARDS.some(c => c.id === id)))];
    if (d.meta.rewards.includes(m.theme) && META_REWARDS.some(c => c.id === m.theme && c.kind === 'theme')) d.meta.theme = m.theme;
  }
  for (const id of d.seen) if (CODEX.some(c => c.id === `enemy:${id}`) && !d.meta.codex.includes(`enemy:${id}`)) d.meta.codex.push(`enemy:${id}`);
  normalizeMeta2(d, r as Record<string, unknown>);
  return d;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
function counts(raw: unknown, max = 400): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, max)) if (k.length <= 64 && num(v) > 0) out[k] = num(v);
  return out;
}
function bestRun(raw: unknown): BestRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Number.isFinite(Number(r.score))) return null;
  const str = (v: unknown, n = 32) => String(v ?? '').slice(0, n);
  return { date: DAY.test(String(r.date)) ? String(r.date) : '', mode: str(r.mode), label: str(r.label, 48), hero: str(r.hero), score: num(r.score), stage: num(r.stage), kills: num(r.kills), time: num(r.time) };
}

/** meta2 fields (v5). Saves from before v5 get a profile seeded from what they already prove. */
function normalizeMeta2(d: SaveData, r: Record<string, unknown>): void {
  const p = r.profile as Partial<ProfileData> | undefined;
  if (p && typeof p === 'object') {
    const P = d.profile;
    P.xp = num(p.xp);
    P.stats = counts(p.stats);
    P.killsBy = counts(p.killsBy);
    P.heroRuns = counts(p.heroRuns);
    P.kitRuns = counts(p.kitRuns, 200);
    if (p.sets && typeof p.sets === 'object') for (const k of SET_KEYS) {
      const v = (p.sets as Record<string, unknown>)[k];
      if (Array.isArray(v)) P.sets[k] = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length <= 48))].slice(0, 200);
    }
    if (p.best && typeof p.best === 'object') for (const [k, v] of Object.entries(p.best).slice(0, 16)) {
      const b = bestRun(v);
      if (b) P.best[k.slice(0, 16)] = b;
    }
    if (Array.isArray(p.timeline)) P.timeline = p.timeline.map(bestRun).filter((x): x is BestRun => !!x).slice(0, 12);
    if (p.equip && typeof p.equip === 'object') for (const k of Object.keys(DEFAULT_EQUIP) as RewardKind[]) {
      const id = String((p.equip as Record<string, unknown>)[k] ?? '');
      P.equip[k] = id === '' && (k === 'hat' || k === 'trail') ? '' : REWARD_BY_ID[id]?.kind === k ? id : DEFAULT_EQUIP[k];
    }
  } else seedProfile(d);
  const q = r.quests as Partial<QuestData> | undefined;
  if (q && typeof q === 'object' && DAY.test(String(q.day)) && Array.isArray(q.ids)) {
    d.quests.day = String(q.day);
    d.quests.ids = q.ids.filter((x): x is string => typeof x === 'string').slice(0, 3);
    d.quests.prog = d.quests.ids.map((_, i) => num(Array.isArray(q.prog) ? q.prog[i] : 0));
    d.quests.done = d.quests.ids.map((_, i) => !!(Array.isArray(q.done) && q.done[i]));
    d.quests.all = !!q.all;
  }
  if (q && typeof q === 'object') {
    d.quests.streak = Math.floor(num(q.streak));
    d.quests.lastAll = DAY.test(String(q.lastAll)) ? String(q.lastAll) : '';
  }
  if (r.achDates && typeof r.achDates === 'object') for (const [k, v] of Object.entries(r.achDates as Record<string, unknown>))
    if (d.achievements.includes(k) && DAY.test(String(v))) d.achDates[k] = String(v);
}

/** A pre-v5 save: profile stats and XP from its lifetime stats, heroes and best runs from its history. */
function seedProfile(d: SaveData): void {
  const L = d.lifetime;
  const P = d.profile;
  const S = P.stats;
  if (L.runs) S.runs = L.runs;
  if (L.kills) S.kills = L.kills;
  if (L.elites) S.k_elite = L.elites;
  if (L.bosses) S.bosses = L.bosses;
  if (L.playTime) S.time = Math.floor(L.playTime);
  if (L.bestStage) S.stage = L.bestStage;
  if (L.bestLevel) S.level = L.bestLevel;
  if (L.bosses) S.stages = L.bosses; // every beaten stage boss cleared a stage
  // Retroactive profile XP for the time already played (same formula as a run).
  P.xp = retroXp(S);
  for (const h of d.history) {
    const id = HEROES.find((x) => x.name === h.hero)?.id;
    if (id) {
      P.heroRuns[id] = (P.heroRuns[id] ?? 0) + 1;
      if (!P.sets.heroes.includes(id)) P.sets.heroes.push(id);
    }
    const run: BestRun = { date: h.date, mode: 'standard', label: h.label, hero: h.hero, score: h.score, stage: h.stage, kills: h.kills, time: h.time };
    P.timeline.push(run);
  }
  P.timeline.sort((a, b) => b.score - a.score);
  P.timeline.length = Math.min(P.timeline.length, 12);
  for (const c of d.meta.codex) if (c.startsWith('biome:') && !P.sets.biomes.includes(c.slice(6))) P.sets.biomes.push(c.slice(6));
}

/** XP for lifetime stats with no per-run detail (same rates as a run, no per-run cap), capped at level 40 so old saves still have levels to earn. */
function retroXp(S: Record<string, number>): number {
  const T = profileTuning;
  const xp = Math.floor(((S.time ?? 0) / 60) * T.perMinute + (S.kills ?? 0) * T.perKill + (S.k_elite ?? 0) * T.perElite + (S.bosses ?? 0) * T.perBoss + (S.stages ?? 0) * T.perStage);
  return Math.min(xp, xpForLevel(40));
}

/**
 * Achievements that lifetime stats already prove (and Evolution for anyone
 * who reached stage 3, where old runs evolved weapons as a matter of course).
 * Saves from before loadouts keep access to what they played with.
 */
function grantFromLifetime(d: SaveData): void {
  for (const a of ACHIEVEMENTS) if (a.lifetime?.(d.lifetime) && !d.achievements.includes(a.id)) d.achievements.push(a.id);
}

export const save: SaveData = normalize(loadJson<unknown>(KEY, null));
grantFromLifetime(save);
// Season track cosmetics (titles, banners, HUD themes, trails, hats) are owned through the track, not by profile level.
rewardHook.owns = (id) => save.seasonPass.owned.includes(id);

/** While on (the title screen's attract demo), nothing touches the profile: no saves, achievements, enemies met or run records. */
export const saveLock = { on: false };

export function persist(): void {
  if (saveLock.on) return;
  saveJson(KEY, save);
}

/** Note an enemy type as met (saved with the next persist). */
export function markSeen(id: string): void {
  if (saveLock.on) return;
  if (!save.seen.includes(id)) save.seen.push(id);
  markCodex(`enemy:${id}`);
}

export function addRunRecord(r: RunRecord): void {
  if (saveLock.on) return;
  save.history.unshift(r);
  save.history.length = Math.min(save.history.length, 30);
}

export function unlockedWeapons(): string[] {
  const ids = Object.values(WEAPONS)
    .filter((w) => w.starter)
    .map((w) => w.id);
  for (const a of ACHIEVEMENTS) if (a.unlockWeapon && save.achievements.includes(a.id)) ids.push(a.unlockWeapon);
  return ids;
}

export function markCodex(id: string): void {
  if (!save.meta.codex.includes(id) && CODEX.some(c => c.id === id)) save.meta.codex.push(id);
}
export function unlockMeta(): void {
  const p = { achievements: save.achievements, ...save.meta };
  for (const r of META_REWARDS) if (r.cost === 0 && rewardAvailable(r.id, p) && !save.meta.rewards.includes(r.id)) save.meta.rewards.push(r.id);
}
export function buyMeta(id: string): boolean {
  const r = META_REWARDS.find(x => x.id === id);
  if (!r || save.meta.rewards.includes(id) || !rewardAvailable(id, { achievements: save.achievements, ...save.meta }) || save.meta.bolts < r.cost) return false;
  save.meta.bolts -= r.cost;
  save.meta.rewards.push(id);
  persist();
  return true;
}
export function recordWeekly(week: string, score: number, stage: number): void {
  const old = save.meta.weekly.find(r => r.week === week);
  if (old) { if (score > old.score) Object.assign(old, { score: Math.floor(score), stage }); }
  else save.meta.weekly.unshift({ week, score: Math.floor(score), stage });
  save.meta.weekly.sort((a, b) => b.week.localeCompare(a.week));
  save.meta.weekly.length = Math.min(save.meta.weekly.length, 52);
}

/** Loadout items this save can pick: starters plus achievement unlocks. */
export function unlockedLoadout(): string[] {
  const ids = [
    ...Object.values(WEAPONS)
      .filter((w) => w.slot && w.starter)
      .map((w) => w.id),
    ...Object.values(SPECIALS)
      .filter((s) => s.starter)
      .map((s) => s.id),
  ];
  for (const a of ACHIEVEMENTS) if (a.unlockLoadout && save.achievements.includes(a.id)) ids.push(a.unlockLoadout);
  unlockMeta();
  for (const [id, kit] of Object.entries(META_KITS)) if (save.meta.rewards.includes(id)) ids.push(...Object.values(kit));
  return [...new Set(ids)];
}

/** The achievement that unlocks a loadout item, for the locked card. */
export function loadoutUnlockBy(id: string) {
  return ACHIEVEMENTS.find((a) => a.unlockLoadout === id);
}

/** Grant an achievement once. Returns its def if newly earned. */
export function grantAchievement(id: string) {
  if (saveLock.on) return null;
  if (save.achievements.includes(id)) return null;
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return null;
  save.achievements.push(id);
  save.achDates[id] = new Date().toISOString().slice(0, 10);
  persist();
  return def;
}

// ---------------------------------------------------------------- export / import

function checksum(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The save as a small readable JSON file. */
export function exportFile(): string {
  return JSON.stringify({ game: 'InfiniShoot', save }, null, 2);
}

/** Load a save file (or an old save code). Throws a readable error if it isn't one. */
export function importFile(text: string): void {
  const c = text.trim();
  if (c.startsWith(CODE_PREFIX)) {
    importCode(c);
    return;
  }
  let parsed: { game?: unknown; save?: unknown };
  try {
    parsed = JSON.parse(c);
  } catch {
    throw new Error('That file is not an InfiniShoot save.');
  }
  if (parsed?.game !== 'InfiniShoot' || !parsed.save) throw new Error('That file is not an InfiniShoot save.');
  Object.assign(save, normalize(parsed.save));
  grantFromLifetime(save);
  persist();
}

/** Replace the save with an exported code (older backups). Throws a readable error if invalid. */
export function importCode(code: string): void {
  const c = code.trim();
  if (!c.startsWith(CODE_PREFIX)) throw new Error('That is not an InfiniShoot save code.');
  const [b64, sum] = c.slice(CODE_PREFIX.length).split('.');
  if (!b64 || checksum(b64) !== sum) throw new Error('The save code is damaged or incomplete.');
  let parsed: unknown;
  try {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The save code could not be read.');
  }
  Object.assign(save, normalize(parsed));
  grantFromLifetime(save);
  persist();
}

export function resetSave(): void {
  Object.assign(save, fresh());
  persist();
}
