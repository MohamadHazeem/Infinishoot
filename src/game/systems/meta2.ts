/**
 * meta2 lane: long-term goals that never change how a run plays.
 *
 * - A run tally (flat counters, src/data/profile.ts keys) per hero. The host
 *   (or solo) counts kills by tag/enemy, bosses and hero events (parries,
 *   cash-ins, chests...) through `meta2Kill` / `meta2Event`; every machine
 *   also polls its own hero for things it can see (stages, flawless clears,
 *   style, combo, mech/crate rides, revives, world events, modes, secrets).
 *   Clients get the host's counters for their hero in the game-over summary
 *   (`RunSummary.m2`) and merge them by max.
 * - At the end of a run (`meta2Bank`, from bankAndShow) the tally goes into
 *   the save: lifetime stats, best runs, profile XP and levels, daily quests,
 *   and the ~100 measured achievements (src/data/meta.ts `track`).
 * - Moments: achievement toasts ('achievement' sample), quest toasts
 *   ('quest_done'), profile level-ups ('profile_level') and a strip on the
 *   game-over screen.
 * - Cosmetics from profile levels: HUD theme (CSS), pet hat (a mesh on this
 *   machine's pet) and trail colour (local dust). They are local only.
 */
import * as THREE from 'three';
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import { save, persist, grantAchievement, saveLock, type BestRun } from '../save';
import { ACHIEVEMENTS, type AchievementDef } from '../../data/meta';
import { PEAK_STATS, RAINBOW, REWARD_BY_ID, PROFILE_REWARDS, levelOf, rewardOpen, rewardsBetween, runXp, type ProfileSummary, type RewardKind, type RunTally, type SetKey, type XpBreakdown } from '../../data/profile';
import { QUEST_ALL_BONUS, QUEST_BY_ID, QUEST_XP, dailyQuests, questDay, questText, type QuestDef } from '../../data/quests';
import { biomeKeyForStage } from '../../data/biomes';
import { worldEventOf } from './worldEvents';
import { cineState } from './cinematics';
import { isOverlord } from './versus';
import { radioEvents } from '../../audio/radio';
import { challengeState } from './gauntlet';
import { sfx } from '../../audio/sfx';
import { settings } from '../settings';
import { localize, localizeHtml, escapeHtml } from '../../i18n';
import { createRetroMaterial } from '../../render/retroMaterial';
import type { RunSummary } from '../../ui/screens';
import { ProfileScreen } from '../../ui/profileScreen';
import { AchievementsScreen } from '../../ui/achievementsScreen';
import { seasonBank, seasonFrame, seasonHatMesh } from './season';

/** Hero events that count (mods2Event kinds). */
const EVENT_STAT: Record<string, string> = {
  parry: 'parries',
  perfectDash: 'perfectDashes',
  ultimate: 'ultimates',
  cashIn: 'cashIns',
  mechExit: 'mechs',
  chest: 'chests',
  rewind: 'rewinds',
};

/** EXTRAS pages that count toward Window Shopper. */
const EXTRA_PAGES = new Set(['jukebox', 'wardrobe', 'history', 'bestiary', 'rewards', 'codex', 'arsenal', 'customise', 'ghosts', 'ghostrace', 'profile', 'achievements', 'teamboard', 'unlocks']);

export const meta2Tuning = {
  /** Seconds between in-run achievement/quest checks. */
  checkEvery: 1,
  /** Seconds between polls of this machine's hero (edges, peaks, sets). */
  pollEvery: 0.1,
  /** Trail dust: seconds between puffs while moving, and minimum speed (m/s). */
  trailEvery: 0.07,
  trailSpeed: 2.5,
  /** Teammate revives count when you are this close (m). */
  reviveRange: 4.5,
};

export interface Meta2Run {
  active: boolean;
  banked: boolean;
  /** Authority counters per hero. */
  tallies: Map<Hero, RunTally>;
  /** This machine's own polled counters. */
  local: RunTally;
  lastStage: number;
  stageHit: boolean;
  lastHp: number;
  superWas: boolean;
  comebackWas: boolean;
  mgWas: boolean;
  photoWas: boolean;
  shopWas: boolean;
  jackWas: boolean;
  goldenWas: boolean;
  rhythmStage: boolean;
  pacifistStage: boolean;
  eventKind: string;
  deadWas: boolean[];
  ev0: { standWins: number; closeCalls: number };
  checkT: number;
  pollT: number;
  /** Quests already toasted this run. */
  questToasted: Set<string>;
  trailT: number;
  trailI: number;
  hatId: string;
  hat: THREE.Object3D | null;
  hatPet: object | null;
  lastScreen: string;
  /** Result of the last bank (game-over strip, tests). */
  last: BankResult | null;
  /** EXTRAS > PROFILE / ACHIEVEMENTS and the title panel (built on the first frame). */
  ui: { profile: ProfileScreen; ach: AchievementsScreen } | null;
}

export interface BankResult {
  xp: XpBreakdown;
  questXp: number;
  from: number;
  to: number;
  rewards: string[];
  quests: string[];
  achievements: string[];
}

const runs = new WeakMap<Game, Meta2Run>();

export function meta2State(g: Game): Meta2Run {
  let s = runs.get(g);
  if (!s) {
    s = {
      active: false, banked: false, tallies: new Map(), local: {}, lastStage: 1, stageHit: false, lastHp: -1,
      superWas: false, comebackWas: false, mgWas: false, photoWas: false, shopWas: false, jackWas: false, goldenWas: false,
      rhythmStage: false, pacifistStage: false, eventKind: '', deadWas: [], ev0: { standWins: 0, closeCalls: 0 }, checkT: 0, pollT: 0,
      questToasted: new Set(), trailT: 0, trailI: 0, hatId: '', hat: null, hatPet: null, lastScreen: '', last: null, ui: null,
    };
    runs.set(g, s);
  }
  return s;
}

const add = (t: RunTally, k: string, n = 1) => {
  t[k] = (t[k] ?? 0) + n;
};
const peak = (t: RunTally, k: string, v: number) => {
  if (v > (t[k] ?? 0)) t[k] = v;
};
const blocked = (g: Game) => saveLock.on || g.mode === 'title' || !!g.onboarding?.training;

function tallyOf(s: Meta2Run, h: Hero): RunTally {
  let t = s.tallies.get(h);
  if (!t) s.tallies.set(h, (t = {}));
  return t;
}

/** Merge two tallies key by key (max: both count the same events). */
export function mergeTally(a: RunTally, b: RunTally | undefined | null): RunTally {
  const out: RunTally = { ...a };
  if (b && typeof b === 'object') for (const [k, v] of Object.entries(b)) if (Number.isFinite(v) && v > (out[k] ?? 0)) out[k] = v;
  return out;
}

// ---------------------------------------------------------------- hooks

/** startRun: a new tally. */
export function startMeta2(g: Game): void {
  const s = meta2State(g);
  s.active = true;
  s.banked = false;
  s.tallies.clear();
  s.local = {};
  s.lastStage = g.stage;
  s.stageHit = false;
  s.lastHp = -1;
  s.superWas = s.comebackWas = s.mgWas = s.photoWas = s.shopWas = s.jackWas = s.goldenWas = false;
  s.rhythmStage = s.pacifistStage = false;
  s.eventKind = '';
  s.deadWas = [];
  s.ev0 = { standWins: radioEvents.standWins, closeCalls: radioEvents.closeCalls };
  s.questToasted.clear();
  s.last = null;
  ensureQuests();
}

/** Host/solo, from killEnemy: own kills by tag and enemy; bosses for the whole team. */
export function meta2Kill(this: Game, e: Enemy, source: string, by: Hero | null): void {
  const s = meta2State(this);
  if (!s.active || this.role === 'client' || blocked(this)) return;
  const def = e.def;
  if (by) {
    const t = tallyOf(s, by);
    add(t, 'kills');
    for (const tag of by.tagsOf(source) ?? []) add(t, 'k_' + tag);
    if (e.elite) add(t, 'k_elite');
    if (def.id.startsWith('v_')) add(t, 'k_veteran');
    if (def.id === 'golden') add(t, 'k_goldbug');
    if (def.id === 'reaper') add(t, 'k_reaper');
    add(t, 'e:' + def.id);
  }
  if (def.miniboss) {
    for (const h of this.heroes) if (!h.left) {
      const t = tallyOf(s, h);
      add(t, 'k_mini');
      t['s:bossKinds:' + def.id] = 1;
    }
  } else if (def.boss) {
    const base = def.remixOf ?? def.id;
    if (base === 'omega' && this.role === 'solo' && !this.pvp && ['standard', 'endless'].includes(this.runMode))
      peak(tallyOf(s, this.hero), 'ascension', challengeState(this).ascension);
    for (const h of this.heroes) if (!h.left) {
      const t = tallyOf(s, h);
      add(t, 'bosses');
      add(t, 'b_' + base);
      if (def.remixOf) add(t, 'b_remix');
      t['s:bossKinds:' + def.id] = 1;
    }
  }
}

/** Host/solo, from mods2Event: parries, perfect dashes, ultimates, cash-ins, mech rides, chests, rewinds. */
export function meta2Event(this: Game, h: Hero, kind: string): void {
  const s = meta2State(this);
  const k = EVENT_STAT[kind];
  if (!k || !s.active || this.role === 'client' || h.left || blocked(this)) return;
  add(tallyOf(s, h), k);
}

/** summary(): this hero's authority counters (clients merge them at game over). */
export function meta2Tally(this: Game, h: Hero): RunTally | undefined {
  if (this.role === 'client') return undefined;
  return { ...(meta2State(this).tallies.get(h) ?? {}) };
}

// ---------------------------------------------------------------- polling (every machine, its own hero)

function poll(g: Game, s: Meta2Run, dt: number): void {
  const h = g.hero;
  const p = h.player;
  const L = s.local;
  // Stage clears (and flawless ones, co-op ones, and what happened on them).
  if (g.stage > s.lastStage) {
    const n = g.stage - s.lastStage;
    add(L, 'stages', n);
    if (!s.stageHit && !p.dead) add(L, 'flawless');
    if (g.heroes.length > 1) add(L, 'coopStages', n);
    if (s.rhythmStage) add(L, 'rhythm');
    if (s.pacifistStage) add(L, 'pacifist');
    if (s.eventKind) {
      add(L, 'worldEvents');
      L['s:events:' + s.eventKind] = 1;
    }
    s.rhythmStage = s.pacifistStage = false;
    s.eventKind = '';
    s.stageHit = false;
    s.lastStage = g.stage;
  }
  if (s.lastHp >= 0 && p.hp < s.lastHp - 0.5) s.stageHit = true;
  s.lastHp = p.hp;
  const fighting = g.mode === 'fight';
  if (fighting && g.modes?.rhythm) s.rhythmStage = true;
  if (fighting && g.modes?.pacifist) s.pacifistStage = true;
  const ev = worldEventOf(g);
  if (ev && !p.dead) s.eventKind = ev.kind;
  // Rising edges.
  const sup = (h.play?.superT ?? 0) > 0;
  if (sup && !s.superWas) add(L, 'crates');
  s.superWas = sup;
  const cb = !!h.comeback;
  if (cb && !s.comebackWas) add(L, 'comebacks');
  s.comebackWas = cb;
  const mg = !!g.modes?.mg;
  if (mg && !s.mgWas) add(L, 'minigames');
  s.mgWas = mg;
  const ph = !!g.photo?.active;
  if (ph && !s.photoWas) add(L, 'photos');
  s.photoWas = ph;
  const shop = g.mode === 'shop' && h.secretShop;
  if (shop && !s.shopWas) add(L, 'secretShops');
  s.shopWas = shop;
  const cine = cineState(g);
  const jack = !!cine.jack?.won;
  if (jack && !s.jackWas) add(L, 'jackpots');
  s.jackWas = jack;
  const gold = cine.goldenRide;
  if (gold && !s.goldenWas) add(L, 'golden');
  s.goldenWas = gold;
  // Teammates revived near you.
  g.heroes.forEach((o, i) => {
    const was = s.deadWas[i];
    if (was && !o.player.dead && o !== h && !p.dead) {
      const dx = o.player.x - p.x;
      const dz = o.player.z - p.z;
      if (dx * dx + dz * dz <= meta2Tuning.reviveRange ** 2) add(L, 'revives');
    }
    s.deadWas[i] = o.player.dead;
  });
  L.lastStands = radioEvents.standWins - s.ev0.standWins;
  L.closeCalls = radioEvents.closeCalls - s.ev0.closeCalls;
  // Peaks and run facts (assigned, not added).
  peak(L, 'style', h.skill?.style.rank ?? 0);
  peak(L, 'combo', g.maxCombo);
  peak(L, 'gold', h.gold);
  peak(L, 'level', g.level);
  peak(L, 'stage', g.stage);
  L.evolutions = h.weapons.filter((w) => w.evolved).length + (h.specialEvo ? 1 : 0);
  L.fusions = h.weapons.filter((w) => w.def.fusion).length;
  L.victories = g.victories;
  if (g.victories > 0 && !g.pvp) peak(L, 'heat', g.meta.points);
  if (g.runMode === 'endless') peak(L, 'wave', g.stage);
  if (g.runMode === 'bossrush') peak(L, 'rushBosses', g.bossesRun);
  L['s:biomes:' + biomeKeyForStage(g.stage)] = 1;
  L['s:heroes:' + h.heroDef.id] = 1;
  if (!g.pvp && !g.versus) L['s:modes:' + g.runMode] = 1;
  void dt;
}

/** Run facts known only at the end. */
function finish(g: Game, t: RunTally, sum: RunSummary): RunTally {
  t.runs = 1;
  t.time = Math.floor(sum.time ?? g.runTime);
  peak(t, 'runTime', t.time);
  peak(t, 'runKills', t.kills ?? 0);
  peak(t, 'stage', sum.stage);
  peak(t, 'level', sum.level);
  if (g.localCoop) t.localRuns = 1;
  else if (g.heroes.length > 1 && !g.pvp && !g.versus) t.coopRuns = 1;
  if (g.versus) {
    t.versusRuns = 1;
    const won = g.versus.winner === (isOverlord(g) ? 'overlord' : 'heroes');
    if (won) t.versusWins = 1;
  }
  if (!g.pvp && !g.versus) {
    const k = ({ daily: 'dailyRuns', weekly: 'weeklyRuns', endless: 'endlessRuns', bossrush: 'rushRuns' } as Record<string, string>)[g.runMode];
    if (k) t[k] = 1;
  }
  return t;
}

/** This machine's view of the running tally (authority counters merged in). */
export function currentTally(g: Game): RunTally {
  const s = meta2State(g);
  // Kept even on a client: a PvP duel's clients counted their own stage as solo runs.
  return mergeTally(s.local, s.tallies.get(g.hero));
}

// ---------------------------------------------------------------- achievements and quests

/** A measured achievement's value now (lifetime/profile + this run). */
export function achValue(a: AchievementDef, run: RunTally = {}): number {
  const tr = a.track;
  if (!tr) return 0;
  const P = save.profile;
  if (tr.scope === 'plevel') return levelOf(P.xp).level;
  if (tr.scope === 'set' || tr.scope === 'has') {
    const set = new Set(P.sets[tr.stat as SetKey] ?? []);
    const pre = `s:${tr.stat}:`;
    for (const k of Object.keys(run)) if (k.startsWith(pre)) set.add(k.slice(pre.length));
    return tr.scope === 'has' ? (set.has(tr.member ?? '') ? 1 : 0) : set.size;
  }
  const life = P.stats[tr.stat] ?? 0;
  const now = run[tr.stat] ?? 0;
  return tr.scope === 'run' || PEAK_STATS.has(tr.stat) ? Math.max(life, now) : life + now;
}

/** Grant every measured achievement that is met. Returns the new ones. */
export function checkMeta2Achievements(g: Game | null, run: RunTally = {}): AchievementDef[] {
  const out: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!a.track || save.achievements.includes(a.id)) continue;
    if (achValue(a, run) < a.track.goal) continue;
    const def = grantAchievement(a.id);
    if (!def) continue;
    out.push(def);
    if (g) {
      if (g.mode !== 'title') g.newAchievements.push(def.id);
      achievementToast(g, def);
    }
  }
  return out;
}

/** The unlock toast (shared with the classic achievements in runFlow.checkAchievements). */
export function achievementToast(g: Game, def: AchievementDef, unlock = ''): void {
  g.hud.toast(`★ ${localize((def.tier ?? 'bronze').toUpperCase())} · ${localize(def.name)}${unlock}`, 4);
  sfx.named('achievement');
}

/** Make sure today's quests are rolled (and yesterday's left behind). */
export function ensureQuests(day = questDay()): void {
  const Q = save.quests;
  if (Q.day === day && Q.ids.length === 3 && Q.ids.every((id) => QUEST_BY_ID[id])) return;
  Q.day = day;
  Q.ids = dailyQuests(day).map((q) => q.id);
  Q.prog = [0, 0, 0];
  Q.done = [false, false, false];
  Q.all = false;
}

/** Today's quests with progress (banked + this run). */
export function questView(run: RunTally = {}): { def: QuestDef; text: string; cur: number; done: boolean; xp: number }[] {
  ensureQuests();
  const Q = save.quests;
  return Q.ids.map((id, i) => {
    const def = QUEST_BY_ID[id];
    const cur = Math.min(def.goal, (Q.prog[i] ?? 0) + (Q.done[i] ? 0 : run[def.stat] ?? 0));
    return { def, text: questText(def), cur: Q.done[i] ? def.goal : cur, done: Q.done[i] || cur >= def.goal, xp: QUEST_XP[def.tier] };
  });
}

function yesterday(day: string): string {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return questDay(d);
}

/** Add a run to today's quests. Returns the quests finished and the XP they pay. */
export function bankQuests(run: RunTally, day = questDay()): { done: QuestDef[]; xp: number } {
  ensureQuests(day);
  const Q = save.quests;
  const done: QuestDef[] = [];
  let xp = 0;
  Q.ids.forEach((id, i) => {
    if (Q.done[i]) return;
    const def = QUEST_BY_ID[id];
    Q.prog[i] = Math.min(def.goal, (Q.prog[i] ?? 0) + (run[def.stat] ?? 0));
    if (Q.prog[i] >= def.goal) {
      Q.done[i] = true;
      done.push(def);
      xp += QUEST_XP[def.tier];
    }
  });
  if (done.length) save.profile.stats.quests = (save.profile.stats.quests ?? 0) + done.length;
  if (!Q.all && Q.done.every(Boolean)) {
    Q.all = true;
    xp += QUEST_ALL_BONUS;
    Q.streak = Q.lastAll === yesterday(day) ? Q.streak + 1 : 1;
    Q.lastAll = day;
  }
  return { done, xp };
}

// ---------------------------------------------------------------- banking

/** Fold a finished run into the profile. Pure on the save (no Game), for tests and the bank. */
export function bankTally(t: RunTally, info: { hero: string; heroName: string; kit: string; mode: string; label: string; score: number; stage: number; kills: number; time: number; date?: string }): BankResult {
  const P = save.profile;
  const date = info.date ?? questDay();
  for (const [k, v] of Object.entries(t)) {
    if (!Number.isFinite(v) || v <= 0) continue;
    if (k.startsWith('s:')) {
      const i = k.indexOf(':', 2);
      const set = k.slice(2, i);
      const id = i > 0 ? k.slice(i + 1) : '';
      const arr = P.sets[set as SetKey];
      if (arr && id && !arr.includes(id)) arr.push(id);
    } else if (k.startsWith('e:')) P.killsBy[k.slice(2)] = (P.killsBy[k.slice(2)] ?? 0) + v;
    else if (PEAK_STATS.has(k)) P.stats[k] = Math.max(P.stats[k] ?? 0, v);
    else P.stats[k] = (P.stats[k] ?? 0) + v;
  }
  if (info.hero) P.heroRuns[info.hero] = (P.heroRuns[info.hero] ?? 0) + 1;
  if (info.kit) P.kitRuns[info.kit] = (P.kitRuns[info.kit] ?? 0) + 1;
  const run: BestRun = { date, mode: info.mode, label: info.label, hero: info.heroName, score: Math.floor(info.score), stage: info.stage, kills: info.kills, time: Math.floor(info.time) };
  if (!P.best[info.mode] || run.score > P.best[info.mode].score) P.best[info.mode] = run;
  P.timeline.push(run);
  P.timeline.sort((a, b) => b.score - a.score);
  P.timeline.length = Math.min(P.timeline.length, 12);
  // XP and quests.
  const from = levelOf(P.xp).level;
  const xp = runXp(t);
  const q = bankQuests(t, date);
  P.xp += xp.total + q.xp;
  const to = levelOf(P.xp).level;
  const opened = new Set([...rewardsBetween(from, to).map((r) => r.id)]);
  const questsTotal = P.stats.quests ?? 0;
  const questsBefore = questsTotal - q.done.length;
  for (const r of PROFILE_REWARDS) if (r.quests && questsBefore < r.quests && questsTotal >= r.quests) opened.add(r.id);
  return { xp, questXp: q.xp, from, to, rewards: [...opened], quests: q.done.map((d) => d.id), achievements: [] };
}

/** bankAndShow: bank this machine's run (once). */
export function meta2Bank(this: Game, sum: RunSummary): BankResult | null {
  const s = meta2State(this);
  if (!s.active || s.banked || saveLock.on || this.onboarding?.training) return null;
  s.banked = true;
  s.active = false;
  poll(this, s, 0);
  const t = finish(this, mergeTally(currentTally(this), sum.m2), sum);
  const h = this.hero;
  const pick = h.loadoutPick;
  const kit = pick ? `${pick.primary}/${pick.secondary}/${pick.special}` : '';
  const res = bankTally(t, { hero: h.heroDef.id, heroName: h.heroDef.name, kit, mode: this.pvp ? 'pvp' : this.versus ? 'versus' : this.runMode, label: this.runLabel || 'STANDARD', score: sum.score, stage: sum.stage, kills: t.kills ?? sum.kills, time: t.time ?? 0 });
  res.achievements = checkMeta2Achievements(this).map((a) => a.id);
  seasonBank(this, t, res); // SEASON track (seasonpass lane): the run's XP and weekly challenges
  persist();
  s.last = res;
  moments(this, res);
  return res;
}

/** pvpOver: everyone banks a PvP run (no game-over screen). */
export function meta2PvpOver(this: Game, winner: string): void {
  const s = meta2State(this);
  if (!s.active || s.banked) return;
  add(s.local, 'pvpDuels');
  if (winner && winner === this.hero.name) add(s.local, 'pvpWins');
  this.meta2Bank({ score: Math.floor(this.score), stage: this.stage, kills: this.kills, time: this.runTime, level: this.level } as RunSummary);
}

function moments(g: Game, res: BankResult): void {
  for (const id of res.quests) {
    if (meta2State(g).questToasted.has(id)) continue;
    g.hud.toast(`${localize('QUEST COMPLETE')}: ${localize(questText(QUEST_BY_ID[id]))} +${QUEST_XP[QUEST_BY_ID[id].tier]} XP`, 4);
  }
  if (res.quests.some((id) => !meta2State(g).questToasted.has(id))) sfx.named('questDone');
  if (res.to > res.from) {
    const names = res.rewards.map((id) => REWARD_BY_ID[id]?.name).filter(Boolean);
    g.hud.toast(`★ ${localize('PROFILE LEVEL')} ${res.to}!${names.length ? ' ' + localize('NEW') + ': ' + names.map((n) => localize(n!)).join(', ') : ''}`, 5);
    sfx.named('profileLevel');
  }
  renderStrip(res);
}

/** The PROFILE line on the game-over screen. */
function renderStrip(res: BankResult): void {
  const go = document.getElementById('scr-gameover');
  if (!go) return;
  let el = go.querySelector<HTMLElement>('.m2-strip');
  if (!el) {
    el = document.createElement('div');
    el.className = 'm2-strip px';
    go.querySelector('.unlocked')?.after(el);
  }
  const P = save.profile;
  const lv = levelOf(P.xp);
  const total = res.xp.total + res.questXp;
  const title = REWARD_BY_ID[P.equip.title]?.name ?? 'Rookie';
  const why = [`TIME +${res.xp.time}`, `KILLS +${res.xp.kills}`, `BOSSES +${res.xp.bosses}`, `STAGES +${res.xp.stages}`, res.xp.coop ? `CO-OP +${res.xp.coop}` : '', res.questXp ? `QUESTS +${res.questXp}` : ''].filter(Boolean).join(' · ');
  el.title = localize(why);
  const parts = [
    `<div class="m2-row"><b class="m2-lv">LV ${lv.level}</b><span class="m2-title">${escapeHtml(localize(title).toUpperCase())}</span><div class="m2-bar"><i style="width:${Math.round(lv.frac * 100)}%"></i></div><span class="m2-xp">+${total} XP</span></div>`,
  ];
  if (res.to > res.from) parts.push(`<div class="m2-up"><span>PROFILE LEVEL UP!</span> ${res.from} &#9654; ${res.to}${res.rewards.length ? ` · <span>NEW</span>: ${res.rewards.map((id) => `<span>${escapeHtml(REWARD_BY_ID[id]?.name ?? id)}</span>`).join(', ')}` : ''}</div>`);
  el.innerHTML = localizeHtml(parts.join(''));
  el.hidden = false;
}

// ---------------------------------------------------------------- frame

/** Render hook: polling, periodic checks, cosmetics. Cheap (no allocation unless a check runs). */
export function meta2Frame(this: Game, dt: number): void {
  const s = meta2State(this);
  seasonFrame(this, dt); // SEASON track (seasonpass lane): title banner, EXTRAS > SEASON, raid/race wins
  trackScreens(this, s);
  applyCosmetics(this, s, dt);
  if (!s.active || s.banked || blocked(this) || !this.isCombatMode) return;
  s.pollT -= dt;
  if (s.pollT <= 0) {
    s.pollT = meta2Tuning.pollEvery;
    poll(this, s, dt);
  }
  s.checkT -= dt;
  if (s.checkT > 0) return;
  s.checkT = meta2Tuning.checkEvery;
  const run = currentTally(this);
  checkMeta2Achievements(this, run);
  for (const q of questView(run)) {
    if (!q.done || save.quests.done[save.quests.ids.indexOf(q.def.id)] || s.questToasted.has(q.def.id)) continue;
    s.questToasted.add(q.def.id);
    this.hud.toast(`${localize('QUEST COMPLETE')}: ${localize(q.text)} +${q.xp} XP`, 4);
    sfx.named('questDone');
  }
}

/** Build the screens and add PROFILE / ACHIEVEMENTS to EXTRAS. */
export function meta2Ui(g: Game): NonNullable<Meta2Run['ui']> {
  const s = meta2State(g);
  if (s.ui) return s.ui;
  ensureCss();
  const ui = (s.ui = { profile: new ProfileScreen(g.screens), ach: new AchievementsScreen(g.screens) });
  const menu = document.querySelector('#scr-extras .menu');
  menu?.insertAdjacentHTML('afterbegin', localizeHtml('<button data-nav data-act="m2-profile">PROFILE</button><button data-nav data-act="m2-achievements">ACHIEVEMENTS</button>'));
  menu?.querySelector('[data-act=m2-profile]')?.addEventListener('click', () => ui.profile.open());
  menu?.querySelector('[data-act=m2-achievements]')?.addEventListener('click', () => ui.ach.open());
  return ui;
}

function trackScreens(g: Game, s: Meta2Run): void {
  const cur = g.screens.current;
  if (cur === s.lastScreen) return;
  s.lastScreen = cur;
  if (cur === 'title' && typeof document !== 'undefined') {
    const ui = meta2Ui(g);
    ui.profile.renderTitlePanel(() => ui.profile.open());
  }
  if (saveLock.on || !EXTRA_PAGES.has(cur)) return;
  const set = save.profile.sets.screens;
  if (set.includes(cur)) return;
  set.push(cur);
  checkMeta2Achievements(g);
  persist();
}

// ---------------------------------------------------------------- cosmetics

export function equipped(kind: RewardKind): string {
  const id = save.profile.equip[kind];
  const r = REWARD_BY_ID[id];
  return r && r.kind === kind && rewardOpen(r, levelOf(save.profile.xp).level, save.profile.stats.quests ?? 0) ? id : '';
}

/** HUD theme: a CSS colour the HUD's timer, level badge and combo read. */
export function applyHudTheme(): void {
  const root = document.documentElement;
  const id = equipped('hud');
  const c = id && id !== 'h_default' ? REWARD_BY_ID[id].color : '';
  root.classList.toggle('m2-hud', !!c);
  if (c) root.style.setProperty('--m2-hud', c);
  ensureCss();
}

let hudApplied = '';
function applyCosmetics(g: Game, s: Meta2Run, dt: number): void {
  const hud = save.profile.equip.hud;
  if (hud !== hudApplied) {
    hudApplied = hud;
    applyHudTheme();
  }
  // Pet hat on this machine's pet.
  const pv = g.hero?.petView ?? null;
  const hat = equipped('hat');
  if (pv !== s.hatPet || hat !== s.hatId) {
    if (s.hat && s.hatPet === pv) s.hat.parent?.remove(s.hat);
    s.hat = null;
    s.hatPet = pv;
    s.hatId = hat;
    if (pv && hat) {
      s.hat = hatMesh(hat);
      // On the pet's body group (first child group) so the hat grows and spins with it.
      const body = pv.root.children.find((c) => (c as THREE.Group).isGroup) ?? pv.root;
      body.add(s.hat);
    }
  }
  // Trail dust behind this machine's hero while it moves.
  const trail = equipped('trail');
  if (!trail || g.mode !== 'fight' || g.paused || settings.graphics === 0 || settings.graphics === 4) return;
  const p = g.hero.player;
  if (p.dead) return;
  s.trailT -= dt;
  if (s.trailT > 0) return;
  const sp = p.speed;
  if (sp < meta2Tuning.trailSpeed) return;
  s.trailT = meta2Tuning.trailEvery;
  const cols = trail === 'tr_rainbow' ? RAINBOW : REWARD_BY_ID[trail].colors;
  const color = cols ? cols[s.trailI++ % cols.length] : REWARD_BY_ID[trail].color!;
  g.particles.soft.dust(p.x, p.z, 2, 0.5, color, Math.random, -p.vel.x, -p.vel.z, 1.2);
}

function hatMesh(id: string): THREE.Object3D {
  const season = seasonHatMesh(id);
  if (season) return season;
  const color = REWARD_BY_ID[id]?.color ?? '#ffcd75';
  const mat = createRetroMaterial({ color });
  const g = new THREE.Group();
  g.name = 'm2hat';
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, y: number, x = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, 0);
    mesh.rotation.z = rz;
    g.add(mesh);
  };
  if (id === 'hat_cap') {
    put(new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat, 0);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.18), mat);
    brim.position.set(0, 0.01, 0.17);
    g.add(brim);
  } else if (id === 'hat_party') put(new THREE.ConeGeometry(0.13, 0.32, 6), mat, 0.16);
  else if (id === 'hat_tophat') {
    put(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 8), mat, 0.01);
    put(new THREE.CylinderGeometry(0.14, 0.15, 0.26, 8), mat, 0.15);
    put(new THREE.CylinderGeometry(0.152, 0.152, 0.05, 8), createRetroMaterial({ color: '#b13e53' }), 0.06);
  } else if (id === 'hat_crown') {
    put(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 6, 1, true), mat, 0.04);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), mat);
      c.position.set(Math.cos(a) * 0.14, 0.12, Math.sin(a) * 0.14);
      g.add(c);
    }
  } else if (id === 'hat_horns') {
    put(new THREE.ConeGeometry(0.05, 0.18, 5), mat, 0.07, -0.12, 0.35);
    put(new THREE.ConeGeometry(0.05, 0.18, 5), mat, 0.07, 0.12, -0.35);
  } else if (id === 'hat_halo') {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 4, 12), createRetroMaterial({ color, unlit: 1 }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.2;
    g.add(halo);
  } else {
    // Beanie with a bobble.
    put(new THREE.SphereGeometry(0.21, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat, -0.02);
    put(new THREE.SphereGeometry(0.06, 6, 4), createRetroMaterial({ color: '#f4f4f4' }), 0.21);
  }
  g.position.y = 0.25; // sits on the 0.26 m shell
  g.scale.setScalar(1.3); // pets are small from the top-down camera
  return g;
}

// ---------------------------------------------------------------- lobby summary and CSS

/** What teammates see on your lobby card. */
export function profileSummary(): ProfileSummary {
  return { lv: levelOf(save.profile.xp).level, title: equipped('title') || 't_rookie', banner: REWARD_BY_ID[equipped('banner') || 'b_navy'].color ?? '#29366f' };
}

const CSS = `
html.m2-hud #timer .clock, html.m2-hud #xpbar .lv b, html.m2-hud #combo .mult { color: var(--m2-hud); }
#scr-gameover .m2-strip { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); margin: var(--p) auto; padding: var(--p) calc(3 * var(--p)); width: min(560px, 90vw); box-sizing: border-box; text-align: start; }
#scr-gameover .m2-strip .m2-row { display: flex; gap: calc(3 * var(--p)); align-items: center; }
#scr-gameover .m2-strip .m2-lv { font: 22px var(--display); color: var(--yellow); white-space: nowrap; }
#scr-gameover .m2-strip .m2-title { font: 11px var(--label); color: var(--cyan); letter-spacing: 1px; white-space: nowrap; }
#scr-gameover .m2-strip .m2-bar { flex: 1; margin: 0; }
#scr-gameover .m2-strip .m2-xp { font: 20px var(--display); color: var(--lime); white-space: nowrap; }
#scr-gameover .m2-strip .m2-up { font: 16px var(--font); color: var(--yellow); animation: m2-blink 0.6s steps(2) 4; }
.m2-bar { height: calc(2 * var(--p)); background: var(--ink); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--slate); margin: var(--p) 0; }
.m2-bar i { display: block; height: 100%; background: var(--lime); }
@keyframes m2-blink { 50% { color: var(--white); } }
body.reduce-flash #scr-gameover .m2-strip .m2-up { animation: none; }
`;
let cssDone = false;
export function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style');
  st.id = 'm2-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
