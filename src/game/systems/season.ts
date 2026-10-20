/**
 * SEASON track (seasonpass lane): a free, cosmetic-only monthly track.
 * Data, calendar and the pure progress rules live in src/data/season.ts.
 *
 * - Banking: every finished run's profile XP (quests included) is also season
 *   XP (`seasonBank`, from meta2Bank); co-op runs get `seasonTuning.coopBonus`
 *   more. The run tally also advances the week's challenges.
 * - Live counters: raid clears and race wins are seen here on this machine
 *   (each player progresses their own track). Other lanes feed counters with
 *   `seasonCount(g, key)` (e.g. a trials lane: `seasonFeeds.add('trialGolds')`
 *   at load, then `seasonCount(g, 'trialGolds')` per gold medal).
 * - Claims on EXTRAS > SEASON (`seasonClaim`): cosmetics go to the profile,
 *   wardrobe, ping wheel or photo mode; filler tiers pay profile XP.
 * - Everything is local: nothing travels in snapshots. Season skins and
 *   emotes are shared data, so teammates see your skin and emote like any
 *   other; titles and banners show on lobby cards through meta2's summary.
 */
import * as THREE from 'three';
import type { Game } from '../game';
import { save, persist, saveLock } from '../save';
import { EMOTES, EMOTE_BY_ID, type EmoteDef } from '../coop2';
import {
  INSTANT_STATS,
  SEASON_EMOTES,
  SEASON_EMOTE_BY_ID,
  SEASON_HATS,
  SEASON_ITEM_BY_ID,
  addSeasonXp,
  applyChallenges,
  challengeText,
  claimAll,
  claimNext,
  rollSeasonPass,
  seasonRunXp,
  themeFor,
  tierOf,
  unclaimed,
  seasonClock,
  type ChallengeDef,
  type ClaimResult,
  type SeasonItem,
} from '../../data/season';
import { DEFAULT_EQUIP, REWARD_BY_ID, levelOf, rewardsBetween, type RewardKind, type RunTally } from '../../data/profile';
import type { BankResult } from './meta2';
import { applyHudTheme } from './meta2';
import { raidRuntime } from './raid';
import { sfx } from '../../audio/sfx';
import { settings, saveSettings } from '../settings';
import { localize, t } from '../../i18n';
import { createRetroMaterial } from '../../render/retroMaterial';
import { SeasonScreen, seasonTitleBanner } from '../../ui/seasonScreen';

export interface SeasonBank {
  /** Season XP from the run (co-op bonus included) and from challenges. */
  runXp: number;
  chXp: number;
  coop: boolean;
  challenges: string[];
  from: number;
  to: number;
}

interface SeasonState {
  ui: SeasonScreen | null;
  lastScreen: string;
  raidWon: boolean;
  raceSeen: object | null;
  last: SeasonBank | null;
}

const states = new WeakMap<Game, SeasonState>();

export function seasonState(g: Game): SeasonState {
  let s = states.get(g);
  if (!s) states.set(g, (s = { ui: null, lastScreen: '', raidWon: false, raceSeen: null, last: null }));
  return s;
}

const blocked = (g: Game) => saveLock.on || !!g.onboarding?.training;

// ---------------------------------------------------------------- emotes

let emotesIn = false;
/** Season emotes join EMOTE_BY_ID (so hosts accept them and every machine draws them); lazy so module cycles never see an uninitialised table. */
export function ensureSeasonEmotes(): void {
  if (emotesIn) return;
  emotesIn = true;
  for (const e of SEASON_EMOTES) (EMOTE_BY_ID as Record<string, EmoteDef>)[e.id] = e as unknown as EmoteDef;
}

/** The equipped season emote, if owned. */
function equippedEmote(): string {
  const id = save.seasonPass.emote;
  return id && save.seasonPass.owned.includes(id) && SEASON_EMOTE_BY_ID[id] ? id : '';
}

let wheelKey = '\u0000';
let wheel: EmoteDef[] = EMOTES;
/** The ping wheel's EMOTES page: the six emotes plus the equipped season emote. */
export function emoteWheel(): EmoteDef[] {
  const id = equippedEmote();
  if (id !== wheelKey) {
    ensureSeasonEmotes();
    wheelKey = id;
    wheel = id ? [...EMOTES, EMOTE_BY_ID[id as keyof typeof EMOTE_BY_ID]] : EMOTES;
  }
  return wheel;
}

/** Changes when the wheel's emotes change (the wheel is rebuilt then). */
export function emoteWheelKey(): string {
  return equippedEmote();
}

// ---------------------------------------------------------------- calendar

/** Start the season/week if the calendar moved on; a finished season's earned tiers are claimed for you. */
export function seasonRoll(g: Game | null, now: Date = seasonClock.now()): void {
  if (saveLock.on) return;
  const sp = save.seasonPass;
  const before = sp.season + sp.week;
  const roll = rollSeasonPass(sp, now);
  if (before === sp.season + sp.week) return;
  if (roll.ended) {
    payProfileXp(g, roll.ended.claims);
    g?.hud.toast(t('season.toast.ended', { name: localize(themeFor(roll.ended.season).name), n: roll.ended.tier }), 5);
  }
  persist();
}

// ---------------------------------------------------------------- progress

/**
 * A live counter from a mode (raid clears, race wins, trial gold medals...):
 * advances the week's challenges on this machine right away.
 */
export function seasonCount(g: Game, key: string, n = 1): ChallengeDef[] {
  if (blocked(g) || n <= 0) return [];
  seasonRoll(g);
  const sp = save.seasonPass;
  const ch = applyChallenges(sp, { [key]: n });
  if (ch.done.length) {
    const up = addSeasonXp(sp, ch.xp);
    challengeMoments(g, ch.done, up);
  }
  persist();
  return ch.done;
}

/** meta2Bank: the run's XP and tally go into the season (once per run, every machine for its own player). */
export function seasonBank(g: Game, tally: RunTally, res: BankResult): SeasonBank | null {
  if (saveLock.on || g.onboarding?.training) return null;
  seasonRoll(g);
  const sp = save.seasonPass;
  const coop = (tally.coopRuns ?? 0) > 0 || (tally.localRuns ?? 0) > 0;
  const runXp = seasonRunXp(res.xp.total + res.questXp, coop);
  const t2: RunTally = { ...tally };
  for (const k of INSTANT_STATS) delete t2[k];
  const ch = applyChallenges(sp, t2);
  const up = addSeasonXp(sp, runXp + ch.xp);
  const out: SeasonBank = { runXp, chXp: ch.xp, coop, challenges: ch.done.map((c) => c.id), from: up.from, to: up.to };
  seasonState(g).last = out;
  challengeMoments(g, ch.done, null);
  if (up.to > up.from) {
    g.hud.toast(`★ ${t('season.toast.tier', { n: up.to })} ${t('season.toast.claim')}`, 5);
    sfx.named('achievement');
  }
  renderStrip(out);
  return out;
}

function challengeMoments(g: Game, done: ChallengeDef[], up: { from: number; to: number } | null): void {
  if (!done.length) return;
  for (const c of done) g.hud.toast(t('season.toast.challenge', { text: localize(challengeText(c)) }), 4);
  sfx.named('questDone');
  if (up && up.to > up.from) g.hud.toast(`★ ${t('season.toast.tier', { n: up.to })} ${t('season.toast.claim')}`, 5);
}

/** Profile XP from claims (filler tiers, duplicates), with the profile level-up moment. */
function payProfileXp(g: Game | null, claims: ClaimResult[]): void {
  const xp = claims.reduce((a, c) => a + c.xp, 0);
  if (!xp) return;
  const P = save.profile;
  const from = levelOf(P.xp).level;
  P.xp += xp;
  const to = levelOf(P.xp).level;
  if (to > from && g) {
    const names = rewardsBetween(from, to).map((r) => localize(r.name));
    g.hud.toast(`★ ${localize('PROFILE LEVEL')} ${to}!${names.length ? ' ' + localize('NEW') + ': ' + names.join(', ') : ''}`, 5);
    sfx.named('profileLevel');
  }
}

/** Claim the next earned tier (or all of them). */
export function seasonClaim(g: Game, all = false): ClaimResult[] {
  if (saveLock.on) return [];
  seasonRoll(g);
  const sp = save.seasonPass;
  const res = all ? claimAll(sp) : ((c) => (c ? [c] : []))(claimNext(sp));
  if (!res.length) return res;
  payProfileXp(g, res);
  sfx.named(res.some((c) => c.item?.slot === 'champion' || c.tier >= 50) ? 'trophy' : 'achievement');
  persist();
  return res;
}

// ---------------------------------------------------------------- equipping

const PROFILE_KINDS = new Set(['title', 'banner', 'hud', 'trail', 'hat']);

export function isEquipped(it: SeasonItem): boolean {
  if (PROFILE_KINDS.has(it.kind)) return save.profile.equip[it.kind as RewardKind] === it.id;
  if (it.kind === 'skin') return settings.skin === it.id;
  if (it.kind === 'emote') return save.seasonPass.emote === it.id;
  return false;
}

/** Wear an owned season cosmetic (again = take it off). Returns whether it is worn now. Stickers live in photo mode. */
export function equipSeasonItem(g: Game | null, id: string): boolean {
  const it = SEASON_ITEM_BY_ID[id];
  if (!it || !save.seasonPass.owned.includes(id)) return false;
  const on = !isEquipped(it);
  if (PROFILE_KINDS.has(it.kind)) {
    const kind = it.kind as RewardKind;
    save.profile.equip[kind] = on ? id : DEFAULT_EQUIP[kind];
    if (kind === 'hud') applyHudTheme();
  } else if (it.kind === 'skin') {
    settings.skin = on ? id : 'classic';
    saveSettings();
    g?.applyLocalSkin();
  } else if (it.kind === 'emote') save.seasonPass.emote = on ? id : '';
  else return false;
  persist();
  return on;
}

// ---------------------------------------------------------------- frame

/** meta2Frame: screens, title banner, live raid/race wins. No allocation on ordinary frames. */
export function seasonFrame(g: Game, dt: number): void {
  void dt;
  const s = seasonState(g);
  const cur = g.screens.current;
  if (cur !== s.lastScreen) {
    s.lastScreen = cur;
    if (typeof document !== 'undefined' && (cur === 'title' || cur === 'extras' || cur === 'gameover')) {
      ensureSeasonEmotes();
      // The title (and its attract demo) only reads: the banner shows a rolled copy, nothing is saved.
      if (cur !== 'title') seasonRoll(g);
      seasonUi(g);
      if (cur === 'title') seasonTitleBanner(() => seasonUi(g).open());
    }
  }
  if (cur === 'season') s.ui?.tick();
  if (blocked(g)) return;
  const raid = raidRuntime(g).state;
  const won = raid?.phase === 'won';
  if (won && !s.raidWon) seasonCount(g, 'raidClears');
  s.raidWon = won;
  const R = g.race;
  if (R && R.phase === 'over' && R.final && s.raceSeen !== R.final) {
    s.raceSeen = R.final;
    const me = R.final.find((x) => x.row === R.rows[R.you]);
    if (me?.place === 1 && R.rows.length >= 2 && R.final.filter((x) => x.place === 1).length === 1) seasonCount(g, 'raceWins');
  }
}

/** Build EXTRAS > SEASON once. */
export function seasonUi(g: Game): SeasonScreen {
  const s = seasonState(g);
  if (s.ui) return s.ui;
  const ui = (s.ui = new SeasonScreen(g));
  const menu = document.querySelector('#scr-extras .menu');
  if (menu && !menu.querySelector('[data-act=sp-season]')) {
    const b = document.createElement('button');
    b.dataset.nav = '';
    b.dataset.act = 'sp-season';
    b.textContent = localize('SEASON');
    b.addEventListener('click', () => ui.open());
    menu.prepend(b);
  }
  return ui;
}

/** The SEASON line on the game-over screen. */
function renderStrip(b: SeasonBank): void {
  if (typeof document === 'undefined') return;
  const go = document.getElementById('scr-gameover');
  if (!go) return;
  let el = go.querySelector<HTMLElement>('.sp-strip');
  if (!el) {
    el = document.createElement('div');
    el.className = 'sp-strip px';
    (go.querySelector('.m2-strip') ?? go.querySelector('.unlocked'))?.after(el);
  }
  const sp = save.seasonPass;
  const tr = tierOf(sp.xp);
  const left = unclaimed(sp);
  const theme = themeFor(sp.season);
  el.style.setProperty('--sp', theme.color);
  el.innerHTML = `<b class="sp-t">${t('season.tier_n', { n: tr.tier })}</b><span class="sp-n">${localize(theme.name).toUpperCase()}</span><div class="sp-bar"><i style="width:${Math.round(tr.frac * 100)}%"></i></div><span class="sp-x">+${b.runXp + b.chXp} ${t('season.sxp')}</span>${b.coop ? `<small>${t('season.strip.coop')}</small>` : ''}${left ? `<small class="sp-c">${t('season.claim_n', { n: left })}</small>` : ''}`;
  el.title = t('season.strip.why', { run: b.runXp, ch: b.chXp });
  el.hidden = false;
}

// ---------------------------------------------------------------- pet hats

/** A season pet hat (meta2's hatMesh asks first). Same placement as the profile hats. */
export function seasonHatMesh(id: string): THREE.Object3D | null {
  const h = SEASON_HATS[id];
  if (!h) return null;
  const main = createRetroMaterial({ color: h.color });
  const trim = createRetroMaterial({ color: h.trim });
  const g = new THREE.Group();
  g.name = 'm2hat';
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z = 0, rx = 0, rz = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    g.add(mesh);
    return mesh;
  };
  const dome = (r: number, m: THREE.Material, y = 0) => put(new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, y);
  switch (h.shape) {
    case 'sunhat':
      put(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 10), main, 0, 0.01);
      dome(0.17, main);
      put(new THREE.CylinderGeometry(0.172, 0.172, 0.05, 10), trim, 0, 0.03);
      break;
    case 'pith':
      put(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 10), main, 0, 0.01);
      dome(0.2, main).scale.y = 0.85;
      put(new THREE.CylinderGeometry(0.202, 0.202, 0.05, 10), trim, 0, 0.03);
      break;
    case 'headphones':
    case 'earmuffs': {
      const band = put(new THREE.TorusGeometry(0.2, 0.03, 4, 10, Math.PI), h.shape === 'headphones' ? main : trim, 0, 0);
      band.rotation.y = Math.PI / 2;
      for (const s of [-1, 1]) {
        if (h.shape === 'headphones') put(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8), trim, s * 0.2, 0, 0, 0, Math.PI / 2);
        else put(new THREE.SphereGeometry(0.09, 6, 4), main, s * 0.2, 0);
      }
      break;
    }
    case 'propeller': {
      dome(0.2, main);
      put(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 4), trim, 0, 0.23);
      const blades = new THREE.Group();
      blades.position.y = 0.28;
      blades.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.015, 0.06), trim));
      blades.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.34), main));
      // Spins with the clock (cosmetic, no per-frame state).
      blades.children[0].onBeforeRender = () => (blades.rotation.y = (performance.now() / 120) % (Math.PI * 2));
      g.add(blades);
      break;
    }
    case 'antenna':
      put(new THREE.TorusGeometry(0.19, 0.02, 4, 10, Math.PI), main, 0, 0).rotation.y = Math.PI / 2;
      for (const s of [-1, 1]) {
        put(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 4), main, s * 0.09, 0.27, 0, 0, -s * 0.3);
        put(new THREE.SphereGeometry(0.05, 6, 4), trim, s * 0.13, 0.37);
      }
      break;
    case 'cupcake':
      put(new THREE.CylinderGeometry(0.17, 0.13, 0.1, 8), trim, 0, 0.04);
      dome(0.18, main, 0.09);
      put(new THREE.SphereGeometry(0.05, 6, 4), createRetroMaterial({ color: '#b13e53' }), 0, 0.29);
      break;
    case 'tricorn':
      put(new THREE.ConeGeometry(0.28, 0.16, 3), main, 0, 0.08);
      put(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 3), trim, 0, 0.01);
      break;
    case 'robo':
      put(new THREE.BoxGeometry(0.34, 0.14, 0.3), main, 0, 0.06);
      put(new THREE.BoxGeometry(0.3, 0.05, 0.02), trim, 0, 0.07, 0.155);
      put(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 4), main, 0, 0.18);
      put(new THREE.SphereGeometry(0.04, 6, 4), trim, 0, 0.25);
      break;
    case 'flower':
      put(new THREE.TorusGeometry(0.17, 0.03, 4, 12), trim, 0, 0.02, 0, Math.PI / 2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        put(new THREE.SphereGeometry(0.055, 6, 4), i % 2 ? main : createRetroMaterial({ color: '#f4f4f4' }), Math.cos(a) * 0.17, 0.05, Math.sin(a) * 0.17);
      }
      break;
    case 'viking':
      dome(0.2, main);
      put(new THREE.CylinderGeometry(0.202, 0.202, 0.04, 10), createRetroMaterial({ color: '#ffcd75' }), 0, 0.02);
      put(new THREE.ConeGeometry(0.05, 0.2, 5), trim, -0.2, 0.12, 0, 0, 0.7);
      put(new THREE.ConeGeometry(0.05, 0.2, 5), trim, 0.2, 0.12, 0, 0, -0.7);
      break;
    case 'wizard':
      put(new THREE.CylinderGeometry(0.26, 0.26, 0.025, 10), main, 0, 0.01);
      put(new THREE.ConeGeometry(0.15, 0.42, 8), main, 0, 0.22, 0, -0.15, 0);
      put(new THREE.OctahedronGeometry(0.05), trim, 0.02, 0.2, 0.13);
      break;
  }
  g.position.y = 0.25;
  g.scale.setScalar(1.3);
  return g;
}

/** Title of a reward id (profile rewards and season items), for the SEASON screen. */
export function rewardName(id: string): string {
  return REWARD_BY_ID[id]?.name ?? SEASON_ITEM_BY_ID[id]?.name ?? id;
}
