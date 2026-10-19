/**
 * Cinematics lane (Game methods, installed on the class as fields): the
 * sky-falling stage transition, the painterly ending after Omega, the
 * legendary reveal, the jackpot chest, the flawless-stage reward with its
 * golden portal, and the playable title's HUD hint. Rules and tuning:
 * src/game/cinematics.ts; overlays: src/ui/cinematicsUi.ts; 3D pieces:
 * src/game/cineWorld.ts; title input: src/game/titlePlay.ts.
 *
 * Co-op: gameplay (golden chests, payouts, the golden portal and its bonus)
 * is decided on the host and reaches clients through the snapshot (`cn`) and
 * the effects bus ('C' events). Cinematics only ever hold the world in solo;
 * online they play locally while the game runs (the sky fall plays where the
 * game already waits, between stages, on every machine's own clock).
 */
import * as THREE from 'three';
import type { Game, Mode } from '../game';
import { LOOP_STAGES } from '../game';
import type { Hero } from '../hero';
import { settings } from '../settings';
import { Rng } from '../../core/rng';
import { sfx } from '../../audio/sfx';
import { music } from '../../audio/music';
import { playSurround } from '../../audio/surround';
import { announcer } from '../../audio/announcer';
import { caption } from '../../audio/captions';
import { PASSIVES } from '../../data/passives';
import { ENEMIES } from '../../data/enemies';
import { reduceMotion } from '../../ui/hud';
import { CineUi, type JackpotView } from '../../ui/cinematicsUi';
import type { EndingCast } from '../../ui/painterly';
import { CHEST_OPEN_RANGE } from '../chests';
import { heroPortrait } from './characters';
import { timeBarrier } from './time';
import { navLock, titlePlayState } from '../titlePlay';
import { attractRunning } from './attract';
import { ArenaAssembly, GoldPortal, JackpotChests, RevealBeam, poseLand, poseLeap, poseSkydive, type JackpotChest } from '../cineWorld';
import {
  cineDebug,
  cloudCover,
  endingFrame,
  endingLength,
  endingTuning,
  fallHeight,
  flawlessTuning,
  goldenGold,
  jackpotPlan,
  jackpotTuning,
  leapPose,
  markRevealed,
  reelTimes,
  revealTuning,
  shouldReveal,
  skyPhase,
  skyTimes,
  skyfallTuning,
  type CineLevel,
  type RevealItem,
  type SkyTimes,
} from '../cinematics';

/** SETTINGS > CINEMATICS. */
export function cineLevel(): CineLevel {
  const l = settings.cinematics;
  return l === 'off' || l === 'short' ? l : 'full';
}

/** Short versions: the setting, or REDUCE FLASHING / reduced motion. */
function shortCine(): boolean {
  return cineLevel() === 'short' || reduceMotion();
}

interface SkyState {
  /** Seconds in (clients: own clock; host/solo mirror modeT). */
  t: number;
  T: SkyTimes;
  top: number;
  gold: boolean;
  /** Where each hero leapt from, and the portal they leapt into. */
  from: { x: number; z: number }[];
  px: number;
  pz: number;
  /** The arena it fell into is built (clients: when the host's `stage` arrived). */
  loaded: boolean;
  startArena: unknown;
  skipped: boolean;
  landed: boolean;
  whoosh: boolean;
  camFar: number;
}

interface CineState {
  ui: CineUi | null;
  sky: SkyState | null;
  assembly: ArenaAssembly;
  end: { t: number; short: boolean; loop: number; cues: number } | null;
  endPending: boolean;
  reveal: { t: number; len: number; item: RevealItem; hold: boolean; landed: boolean; short: boolean; hero: Hero } | null;
  queue: RevealItem[];
  /** Legendary keys this hero owned at the last look (null: take a baseline first). */
  owned: Set<string> | null;
  firstDone: boolean;
  jack: { t: number; len: number; stops: [number, number, number]; view: JackpotView; landed: number; tickT: number; won: boolean } | null;
  chests: JackpotChest[];
  chestId: number;
  chestStage: number;
  chestCount: number;
  /** Map chest spawns rolled for gold this stage. */
  rolls: number;
  flaw: { t: number } | null;
  flawStage: number;
  goldenRide: boolean;
  goldenFor: number;
  lastBosses: number;
  lastRun: number;
  lastStage: number;
  /** Legendaries gained up to this step reveal (see gainWindow). */
  gainUntil: number;
  chestsOpen: number;
  prevMode: Mode;
  beam: RevealBeam | null;
  portal: GoldPortal | null;
  chestView: JackpotChests | null;
  camPos: THREE.Vector3;
  camQuat: THREE.Quaternion;
}

const states = new WeakMap<Game, CineState>();

export function cineState(g: Game): CineState {
  let s = states.get(g);
  if (!s) {
    s = {
      ui: null, sky: null, assembly: new ArenaAssembly(), end: null, endPending: false, reveal: null, queue: [], owned: null, firstDone: false,
      jack: null, chests: [], chestId: 1, chestStage: -1, chestCount: 0, rolls: 0, flaw: null, flawStage: -1, goldenRide: false, goldenFor: 0,
      lastBosses: 0, lastRun: 0, lastStage: 1, gainUntil: -1, chestsOpen: 0, prevMode: g.mode, beam: null, portal: null, chestView: null, camPos: new THREE.Vector3(), camQuat: new THREE.Quaternion(),
    };
    states.set(g, s);
  }
  return s;
}

function ui(g: Game, s: CineState): CineUi | null {
  if (s.ui) return s.ui;
  const root = typeof document !== 'undefined' ? document.getElementById('ingame')?.parentElement ?? document.getElementById('hud') : null;
  if (!root) return null;
  s.ui = new CineUi(root);
  void g;
  return s.ui;
}

function portalOf(g: Game, s: CineState): GoldPortal {
  return (s.portal ??= new GoldPortal(g.scene));
}

/** A pad button, or one of the usual skip keys through this machine's Input (the overlay also hears any key itself). */
function anyPadPressed(g: Game): boolean {
  for (let i = 0; i < 16; i++) if (g.input.padButtonPressed(i)) return true;
  return g.input.keyPressed('Enter') || g.input.keyPressed('Space') || g.input.keyPressed('Escape') || g.input.mousePressed(0);
}

function pinned(len: number): number | null {
  return cineDebug.pin >= 0 ? Math.min(len - 1e-3, cineDebug.pin * len) : null;
}

// ---------------------------------------------------------------- the step

/**
 * Top of Game.update (after the time lane's holds, before the client split). Advances
 * the cinematics' clocks, runs the host-side rules (golden chests, flawless clears, the
 * golden portal, the ending trigger, legendary detection) and returns true while a solo
 * cinematic holds the world.
 */
export function cineStep(this: Game, dt: number): boolean {
  const s = cineState(this);
  const view = ui(this, s);
  if (this.mode !== 'title') navLock.move = false;
  const pressed = (view?.takeSkip() ?? false) || anyPadPressed(this);
  // A new run (or back to the title): nothing carries over. (Clients' run clocks snap back to the host's
  // a little with every snapshot, so only a real drop counts.)
  if ((this.mode === 'title' && s.prevMode !== 'title') || this.runTime < s.lastRun - 1.5 || this.stage < s.lastStage || this.bossesRun < s.lastBosses) resetRun(this, s);
  s.lastRun = this.runTime;
  s.lastStage = this.stage;
  if (this.mode === 'title') {
    s.prevMode = this.mode;
    return false;
  }
  const host = this.role !== 'client';
  const level = cineLevel();

  // Stage changed: golden chests and the golden portal belong to the old one.
  if (s.chestStage !== this.stage) {
    s.chestStage = this.stage;
    s.chestCount = 0;
    s.rolls = 0;
    if (host) s.chests = [];
    s.portal?.close();
  }

  // Client sky fall runs on its own clock (the host's runs on modeT, see skyfallTransition).
  if (!host) clientSky(this, s, dt, pressed);
  else if (s.sky && pressed && s.sky.t > skyfallTuning.minSkip) s.sky.skipped = true;
  // The host doesn't simulate during a transition: let the touchdown dust fly anyway (clients always do).
  if (host && s.sky?.landed && this.mode === 'transition') {
    this.particles.update(dt);
    this.fx.update(dt);
  }

  if (host) hostRules(this, s, dt);
  pollReveals(this, s, level);

  // Overlay clocks.
  let hold = false;
  let block = false;
  const solo = this.role === 'solo';
  if (s.end) {
    const len = endingLength(s.end.short);
    const pin = pinned(len);
    if (pressed && s.end.t > endingTuning.minSkip) s.end.t = len;
    else s.end.t = pin ?? s.end.t + dt;
    endCues(this, s);
    if (s.end.t >= len) {
      s.end = null;
      view?.endingStop();
    } else {
      hold ||= solo;
      block = true;
    }
  }
  if (s.reveal) {
    const r = s.reveal;
    const pin = pinned(r.len);
    if (pressed && r.t > revealTuning.minSkip) r.t = r.len;
    else r.t = pin ?? r.t + dt;
    if (!r.landed && r.t >= r.len * revealTuning.landAt) revealLand(this, s);
    if (r.t >= r.len) {
      s.reveal = null;
      view?.revealHide();
    } else hold ||= r.hold;
  }
  if (s.jack) {
    const j = s.jack;
    const pin = pinned(j.len);
    // A skip lands the reels at once (the payout still shows), a second one closes it.
    if (pressed && j.t > jackpotTuning.minSkip) j.t = j.t < j.stops[2] ? j.stops[2] : Math.max(j.t, j.len - 0.3);
    else j.t = pin ?? j.t + dt;
    if (j.t >= j.len) {
      s.jack = null;
      view?.jackpotStop();
    } else hold ||= solo;
  }
  if (s.flaw) {
    s.flaw.t = pinned(flawlessTuning.time) ?? s.flaw.t + dt;
    if (s.flaw.t >= flawlessTuning.time) {
      s.flaw = null;
      view?.flawlessStop();
    }
  }
  view?.setBlocking(block || (hold && !s.reveal));
  // Online the ending sits over the shop: its key presses must not buy anything.
  if (block && !solo) this.input.endStep();
  s.prevMode = this.mode;
  return hold;
}

function resetRun(g: Game, s: CineState): void {
  if (s.sky) endSky(g, s);
  s.end = null;
  s.endPending = false;
  s.reveal = null;
  s.queue = [];
  s.owned = null;
  s.firstDone = false;
  s.jack = null;
  s.chests = [];
  s.chestCount = 0;
  s.flaw = null;
  s.flawStage = -1;
  s.goldenRide = false;
  s.goldenFor = 0;
  s.lastBosses = g.bossesRun;
  s.portal?.close();
  s.ui?.reset();
}

/** Solo/host: stage clears, the ending, the golden portal and its bonus, golden chests. */
function hostRules(g: Game, s: CineState, dt: number): void {
  // A stage was cleared this step (stageClear counts the boss).
  if (g.bossesRun > s.lastBosses) {
    s.lastBosses = g.bossesRun;
    onStageClear(g, s);
  }
  if (s.endPending && g.mode === 'cleared' && g.modeT >= endingTuning.delay) {
    s.endPending = false;
    g.vfx.cine('ending', Math.max(1, Math.round(g.stage / LOOP_STAGES)), 0, 0, '');
  }
  // The golden portal opens beside the normal one after a flawless stage.
  // Built only when first needed (normal play adds nothing to the scene).
  if (g.mode === 'portal' && g.portal.active && s.flawStage === g.stage && !s.portal?.active) {
    const spot = g.portalSpot(g.portal.x, g.portal.z);
    portalOf(g, s).open(spot.x, spot.z);
    g.vfx.ring(spot.x, spot.z, 1, 7, '#ffcd75', 0.6);
    g.vfx.toast('FLAWLESS BONUS: TAKE THE GOLDEN PORTAL!', 3);
    g.vfx.sound('jingle', NaN, NaN);
  }
  const portal = s.portal;
  if (g.mode === 'portal' && portal?.active && g.modeT > 0.5) {
    if (g.aliveHeroes.some((h) => Math.hypot(h.player.x - portal.x, h.player.z - portal.z) < flawlessTuning.enter)) {
      g.mode = 'transition';
      g.modeT = 0;
      g.stageLoaded = false;
      s.goldenRide = true;
      s.goldenFor = g.stage + 1;
      g.vfx.sound('portal', NaN, NaN);
      g.vfx.flash(0.6);
    } else if (g.modeT % 0.25 < dt) {
      g.vfx.burst(portal.x, 0.4, portal.z, { count: 3, color: '#ffcd75', color2: '#f4f4f4', speed: [0.5, 2], size: [0.1, 0.22], life: [0.6, 1.0], up: 5, drag: 1 });
    }
  }
  if (g.mode !== 'portal' && g.mode !== 'transition') portal?.close();
  // The golden route's bonus, once the new stage is under way.
  if (s.goldenFor && g.stage === s.goldenFor && g.mode === 'fight') {
    s.goldenFor = 0;
    s.goldenRide = false;
    goldenBonus(g);
  }
  updateJackpots(g, s, dt);
}

function onStageClear(g: Game, s: CineState): void {
  if (g.pvp || g.onboarding.training || g.runMode === 'gauntlet' || g.runMode === 'bossrush') return;
  // Leftover golden chests vanish with the stage, like the normal ones.
  for (const c of s.chests) g.vfx.burst(c.x, 0.4, c.z, { count: 12, color: '#ffd23f', color2: '#f4f4f4', speed: [2, 6], size: [0.15, 0.3], life: [0.3, 0.6], up: 5, gravity: 12 });
  s.chests = [];
  if (g.stage % LOOP_STAGES === 0) s.endPending = true;
  if (!g.damagedThisStage) {
    const endless = g.runMode === 'endless';
    s.flawStage = g.stage;
    g.vfx.cine('flawless', -1, 0, 0, endless ? 'NO HITS TAKEN · BONUS GOLD AND A CHEST EACH' : 'NO HITS TAKEN · A GOLDEN PORTAL WILL OPEN');
    // Endless has no portal: the bonus comes right away.
    if (endless) goldenBonus(g);
  }
}

/** The golden route's reward at the start of the next stage: gold, a chest per hero, maybe a relic. */
function goldenBonus(g: Game): void {
  const gold = goldenGold(g.stage);
  for (const h of g.heroes) {
    if (h.left) continue;
    h.gold += gold;
    g.goldFx(h, gold);
    const p = h.player;
    const a = g.rng.range(0, Math.PI * 2);
    let x = p.x + Math.cos(a) * 2.6;
    let z = p.z + Math.sin(a) * 2.6;
    if (g.walls.hitCircle(x, z, 1)) {
      x = p.x;
      z = p.z + 2.2;
    }
    const f = g.rng.range(0, Math.PI * 2);
    g.chests.add(x, z, f);
    g.host?.broadcast({ t: 'chestspawn', x, z, f });
    g.vfx.ring(x, z, 1, 6, '#ffcd75', 0.6);
  }
  const relic = g.rng.chance(flawlessTuning.relicChance);
  if (relic) g.grantRelics();
  g.vfx.banner('GOLDEN ROUTE!', `+${gold} GOLD EACH · A TREASURE CHEST EACH${relic ? ' · A RELIC' : ''}`, 2.6);
  g.vfx.sound('powerUp', NaN, NaN);
}

// ---------------------------------------------------------------- jackpot chests

/** Host: a map chest spawn rolls for gold. Returns true when it became a golden chest (called from updateChestSpawns). */
export function jackpotRoll(this: Game, x: number, z: number, facing: number): boolean {
  const s = cineState(this);
  if (s.chestStage !== this.stage) {
    s.chestStage = this.stage;
    s.chestCount = 0;
    s.rolls = 0;
  }
  // Seeded from the run seed, stage and spawn number, not drawn from the game's RNG stream (so the
  // rest of the run's randomness is the same as without golden chests).
  const roll = new Rng((this.seed ^ Math.imul(this.stage, 0x9e3779b1) ^ Math.imul(++s.rolls, 0x85ebca6b)) >>> 0).next();
  if (s.chestCount >= jackpotTuning.perStage || this.pvp || this.onboarding.training || roll >= jackpotTuning.chance) return false;
  s.chestCount++;
  s.chests.push({ id: s.chestId++, x, z, facing, openT: -1 });
  this.vfx.ring(x, z, 1, 8, '#ffd23f', 0.7);
  this.vfx.burst(x, 1, z, { count: 30, color: '#ffd23f', color2: '#f4f4f4', speed: [2, 7], size: [0.15, 0.32], life: [0.5, 1], up: 9, gravity: 10 });
  this.vfx.toast('A GOLDEN CHEST APPEARED!', 3);
  this.vfx.sound('goldenLaugh', NaN, NaN);
  return true;
}

/** Debug and test links: put a golden chest at (x, z). */
export function debugJackpotChest(g: Game, x: number, z: number): void {
  const s = cineState(g);
  s.chests.push({ id: s.chestId++, x, z, facing: 0, openT: -1 });
}

function updateJackpots(g: Game, s: CineState, dt: number): void {
  if (!s.chests.length) return;
  const running = g.isCombatMode && !(g.paused && g.role === 'solo') && g.screens.current === 'none';
  for (let i = s.chests.length - 1; i >= 0; i--) {
    const c = s.chests[i];
    if (c.openT >= 0) {
      if (running) c.openT += dt;
      if (c.openT > 3) s.chests.splice(i, 1);
      continue;
    }
    if (!running) continue;
    if (g.stepN % 20 === 0) g.vfx.burst(c.x, 1.1, c.z, { count: 3, color: '#ffd23f', color2: '#f4f4f4', speed: [0.5, 1.6], size: [0.1, 0.2], life: [0.5, 0.9], up: 3, drag: 1 });
    const h = g.aliveHeroes.find((x) => Math.hypot(x.player.x - c.x, x.player.z - c.z) < CHEST_OPEN_RANGE + 0.2);
    if (h) openJackpot(g, s, c, h);
  }
}

function openJackpot(g: Game, s: CineState, c: JackpotChest, h: Hero): void {
  c.openT = 0;
  const plan = jackpotPlan(g.rng, g.stage);
  const view: JackpotView = { land: [], title: '', lines: [], gold: 0 };
  if (plan.kind === 'gold') {
    h.gold += plan.gold;
    view.gold = plan.gold;
    view.land = [0, 1, 2].map(() => ({ icon: 'cn_coin', color: '#ffcd75', glyph: '●' }));
    view.title = 'JACKPOT!';
    view.lines = [`+${plan.gold} GOLD`];
  } else {
    let gold = 0;
    for (let k = 0; k < plan.items; k++) {
      const f = h.chestItem();
      if (f.id === 'gold') {
        gold += Number(f.text.replace(/\D/g, '')) || 0;
        view.land.push({ icon: 'cn_coin', color: '#ffcd75', glyph: '●' });
      } else {
        view.land.push({ icon: f.id, color: f.color, glyph: f.icon });
        view.lines.push(`${f.name.toUpperCase()} ${f.text}`);
      }
    }
    if (gold) view.lines.push(`+${gold} GOLD`);
    view.gold = gold;
    view.title = 'TRIPLE TREASURE!';
  }
  h.player.happyT = 2;
  h.loadoutDirty = true;
  g.runEvents.onChest();
  g.mods2Event(h, 'chest');
  timeBarrier(g); // a rewind must not take the payout back
  // Online the opener is untouchable while their reels spin; solo the world holds instead.
  if (g.role !== 'solo') h.player.invuln = Math.max(h.player.invuln, jackpotTuning.onlineIframes);
  g.vfx.sound('chest', c.x, c.z);
  g.vfx.ring(c.x, c.z, 1, 7, '#ffd23f', 0.5);
  g.vfx.burst(c.x, 0.8, c.z, { count: 40, color: '#ffd23f', color2: '#f4f4f4', speed: [3, 9], size: [0.14, 0.3], life: [0.5, 1], up: 9, gravity: 12 });
  g.vfx.cine('jackpot', h.index, c.x, c.z, JSON.stringify(view));
  void s;
  g.checkAchievements();
}

// ---------------------------------------------------------------- legendary reveal

/** Everything legendary a hero owns right now: legendary auto weapons and items, fusions, evolutions. */
export function legendaryOwned(h: Hero): RevealItem[] {
  const out: RevealItem[] = [];
  for (const w of h.weapons) {
    const d = w.def;
    if (!d.slot && d.rarity === 'legendary') {
      out.push({ key: `w:${d.id}`, icon: w.iconId, glyph: d.icon, name: d.name, color: d.color, label: d.fusion ? 'FUSION!' : 'LEGENDARY WEAPON!', text: d.desc.replace(/^FUSION of [^.]*\. /, '') });
    }
    if (w.build && w.build.evo >= 0) {
      const e = d.evos?.[w.build.evo];
      out.push({ key: `e:${d.id}:${w.build.evo}`, icon: w.iconId, glyph: d.icon, name: w.name, color: w.color, label: 'EVOLUTION!', text: e?.text ?? '' });
    } else if (w.partnerEvolved && d.evolution) {
      out.push({ key: `e:${d.id}:auto`, icon: w.iconId, glyph: d.icon, name: w.name, color: w.color, label: 'EVOLUTION!', text: d.evolution.text });
    }
  }
  if (h.specialBuild && h.specialBuild.evo >= 0) {
    const sp = h.loadout()[0];
    const e = h.specialDef.evos?.[h.specialBuild.evo];
    out.push({ key: `e:sp:${h.special.id}:${h.specialBuild.evo}`, icon: sp.id, glyph: sp.icon, name: sp.name, color: sp.color, label: 'EVOLUTION!', text: e?.text ?? '' });
  }
  for (const id of Object.keys(h.passives)) {
    const d = PASSIVES[id];
    if (d?.rarity === 'legendary') out.push({ key: `p:${id}`, icon: id, glyph: d.icon, name: d.name, color: d.color, label: 'LEGENDARY ITEM!', text: d.desc });
  }
  return out;
}

/**
 * Legendaries count when they come from a real gain: a level-up pick (the menu just closed;
 * fusions and evolutions are picks too), a map chest or a jackpot opening. Anything else
 * (debug grants, test-link kits, scripted changes) joins the baseline silently.
 */
function gainWindow(g: Game, s: CineState): void {
  let opened = 0;
  for (const c of g.chests.list) if (c.openT >= 0) opened++;
  if ((s.prevMode === 'levelup' && g.mode !== 'levelup') || opened > s.chestsOpen) s.gainUntil = g.stepN + 90;
  s.chestsOpen = opened;
}

/** Debug and test links: treat the next second as a gain moment (as if a level-up pick just closed). */
export function debugGainWindow(g: Game): void {
  cineState(g).gainUntil = g.stepN + 90;
}

function pollReveals(g: Game, s: CineState, level: CineLevel): void {
  gainWindow(g, s);
  if (g.stepN % 6 !== 0 || g.onboarding.training) return;
  const calm = g.isCombatMode && g.screens.current === 'none' && !g.paused;
  const now = legendaryOwned(g.hero);
  if (!s.owned) {
    // The first look of a run is the baseline (the kit you start with, test-link items).
    s.owned = new Set(now.map((r) => r.key));
    return;
  }
  const gained = g.stepN <= s.gainUntil;
  let shown = false;
  for (const r of now) {
    if (s.owned.has(r.key)) continue;
    s.owned.add(r.key);
    if (!gained) continue;
    // One reveal per gain; anything else gained at once just counts as seen.
    if (!shown && level !== 'off' && shouldReveal(!s.firstDone, r.key) && s.queue.length < 1) {
      s.queue.push(r);
      shown = true;
    } else markRevealed(r.key);
    s.firstDone = true;
  }
  if (!s.reveal && s.queue.length && calm && !s.jack && !s.end && !s.sky) startReveal(g, s, s.queue.shift()!);
}

function startReveal(g: Game, s: CineState, item: RevealItem): void {
  markRevealed(item.key);
  const short = shortCine();
  const online = g.role !== 'solo';
  const len = online ? revealTuning.online : short ? revealTuning.short : revealTuning.full;
  s.reveal = { t: 0, len, item, hold: !online, landed: false, short, hero: g.hero };
  music.silence(Math.min(len, revealTuning.silence));
  sfx.muffle(0.3);
  sfx.named('whoosh');
}

function revealLand(g: Game, s: CineState): void {
  const r = s.reveal!;
  r.landed = true;
  const p = r.hero.player;
  sfx.named('legendaryPick'); // fanfare (and the announcer's "Legendary!")
  if (!reduceMotion()) {
    g.hud.flash(0.45);
    g.juice.shake(0.25 * settings.shake);
  }
  g.particles.burst(p.x, 1.2, p.z, { count: 40, color: r.item.color, color2: '#fff6d5', speed: [3, 9], size: [0.14, 0.3], life: [0.4, 0.9], up: 6, gravity: 8 });
  g.fx.ring(p.x, p.z, 1, 7, '#ffd23f', 0.5);
  p.happyT = 1.5;
}

// ---------------------------------------------------------------- effects-bus events

/** A cinematics event from the effects bus (host locally, clients from the snapshot). */
export function onCine(this: Game, kind: string, hero: number, x: number, z: number, data: string): void {
  const s = cineState(this);
  const view = ui(this, s);
  const level = cineLevel();
  if (kind === 'flawless') {
    if (level !== 'off') {
      s.flaw = { t: 0 };
      view?.flawlessStart(data);
    } else this.hud.toast(`FLAWLESS! ${data}`, 3);
    if (!announcer.say('perfect')) caption({ who: 'ANNOUNCER', text: 'Flawless!', color: '#ffcd75', kind: 'announcer' });
    sfx.named('jingle');
    sfx.named('powerUp');
    if (!reduceMotion()) this.hud.flash(0.3);
  } else if (kind === 'ending') {
    if (level === 'off') return;
    const short = shortCine();
    s.end = { t: 0, short, loop: hero, cues: 0 };
    view?.endingStart(endingCast(this, hero), short);
    music.silence(1.6);
  } else if (kind === 'jackpot') {
    let v: JackpotView;
    try {
      v = JSON.parse(data) as JackpotView;
    } catch {
      return;
    }
    if (hero !== this.local) {
      this.hud.toast(`${(this.heroes[hero]?.name ?? 'A TEAMMATE').toUpperCase()} HIT THE JACKPOT!`, 2.5);
      return;
    }
    if (level === 'off') {
      this.hud.toast(`${v.title} ${v.lines.join(' · ')}`, 3.5);
      sfx.named('legendary');
      return;
    }
    const rt = reelTimes(shortCine());
    s.gainUntil = this.stepN + 90 + Math.ceil(rt.len * 60); // a legendary from the jackpot reveals after the reels
    s.jack = { t: 0, len: rt.len, stops: rt.stops, view: v, landed: 0, tickT: 0, won: false };
    const el = typeof document !== 'undefined' ? document.querySelector('#runinfo .gold') : null;
    const r = el?.getBoundingClientRect();
    view?.jackpotStart(v, r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null);
    music.silence(rt.len);
    sfx.named('jingle');
    playSurround('jackpot'); // coins rain around your head (sound lane, src/audio/surround.ts)
    void x;
    void z;
  }
}

function endingCast(g: Game, loop: number): EndingCast {
  const look = heroPortrait(g, g.hero).colors;
  const omega = ENEMIES.omega;
  return { armor: look.armor, accent: look.accent, suit: look.suit, hair: look.hair, boss: omega?.bodyColor ?? '#5d275d', bossAccent: omega?.accentColor ?? '#b13e53', loop };
}

/** Sounds as the ending's panels change. */
function endCues(g: Game, s: CineState): void {
  const e = s.end!;
  const f = endingFrame(e.t, e.short);
  const want = f.panel + 1;
  while (e.cues < want) {
    e.cues++;
    if (e.cues === 1) sfx.named('bossRoar', 0.6);
    else if (e.cues === 2) sfx.named('jingle');
    else if (e.cues === 3) sfx.named('ominous');
    else sfx.named('legendary');
  }
  void g;
}

// ---------------------------------------------------------------- net

/** Host -> clients (snapshot `cn`): golden chests, the golden portal, the golden ride. */
export function cineNet(this: Game): unknown {
  const s = cineState(this);
  const p = s.portal;
  if (!s.chests.length && !p?.active && !s.goldenRide) return null;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    jc: s.chests.map((c) => [c.id, r2(c.x), r2(c.z), r2(c.facing), c.openT < 0 ? -1 : r2(c.openT)]),
    gp: p?.active ? [r2(p.x), r2(p.z)] : 0,
    gr: s.goldenRide ? 1 : 0,
  };
}

export function applyCineNet(this: Game, n: unknown): void {
  const s = cineState(this);
  const v = n as { jc?: number[][]; gp?: number[] | 0; gr?: number } | null | undefined;
  if (!v) {
    s.chests = [];
    s.portal?.close();
    s.goldenRide = false;
    return;
  }
  s.chests = (v.jc ?? []).map((c) => ({ id: c[0], x: c[1], z: c[2], facing: c[3], openT: c[4] }));
  if (Array.isArray(v.gp)) portalOf(this, s).open(v.gp[0], v.gp[1]);
  else s.portal?.close();
  s.goldenRide = v.gr === 1;
}

// ---------------------------------------------------------------- sky fall (host)

/** First line of Game.updateTransition: the sky fall plays the stage transition. Returns false to keep the old fade. */
export function skyfallTransition(this: Game): boolean {
  const s = cineState(this);
  const level = cineLevel();
  if (level === 'off' || this.pvp) {
    if (s.sky) endSky(this, s);
    return false;
  }
  if (!s.sky) startSky(this, s, level === 'short' || reduceMotion());
  const sky = s.sky!;
  const T = sky.T;
  const pin = pinned(T.len);
  if (pin !== null) this.modeT = pin;
  if (sky.skipped) this.modeT = Math.max(this.modeT, T.len);
  sky.t = this.modeT;
  if (!this.stageLoaded && this.modeT >= T.cut) {
    this.stageLoaded = true;
    const t = this.modeT;
    this.loadStage(this.stage + 1);
    this.mode = 'transition';
    this.modeT = t;
  }
  this.hud.setFade(0);
  if (this.modeT >= T.len) {
    endSky(this, s);
    this.mode = 'fight';
    this.modeT = 0.8; // the same "a moment in" as the old fade, for systems that wait on it
  }
  return true;
}

function startSky(g: Game, s: CineState, short: boolean): void {
  const gold = s.goldenRide;
  const portal = gold && s.portal?.active ? s.portal : g.portal;
  s.sky = {
    t: 0,
    T: skyTimes(short ? 'short' : 'full'),
    top: short ? skyfallTuning.topShort : skyfallTuning.top,
    gold,
    from: g.heroes.map((h) => ({ x: h.player.x, z: h.player.z })),
    px: portal.active ? portal.x : g.hero.player.x,
    pz: portal.active ? portal.z : g.hero.player.z,
    loaded: false,
    startArena: g.arena,
    skipped: false,
    landed: false,
    whoosh: false,
    camFar: g.cam.camera.far,
  };
}

function endSky(g: Game, s: CineState): void {
  s.assembly.finish();
  for (const h of g.heroes) h.player.rig.root.scale.setScalar(1);
  const cam = g.cam.camera;
  if (s.sky && cam.far !== s.sky.camFar) {
    cam.far = s.sky.camFar;
    cam.updateProjectionMatrix();
  }
  s.sky = null;
  s.ui?.skyfall(null);
  setBody('cn-cine', false);
}

/** Client: the sky fall on this machine's clock, catching up with the host's stage load. */
function clientSky(g: Game, s: CineState, dt: number, pressed: boolean): void {
  const level = cineLevel();
  if (g.mode === 'transition' && s.prevMode !== 'transition' && !s.sky && level !== 'off' && !g.pvp) {
    startSky(g, s, level === 'short' || reduceMotion());
    s.sky!.gold = s.goldenRide;
  }
  const sky = s.sky;
  if (!sky) return;
  if (pressed && sky.t > skyfallTuning.minSkip) {
    // Skipped on this screen: back to the plain fade until the host starts the stage.
    endSky(g, s);
    return;
  }
  const T = sky.T;
  if (g.arena !== sky.startArena) sky.loaded = true;
  const pin = pinned(T.len);
  if (pin !== null) sky.t = pin;
  else if (g.mode !== 'transition') sky.t += dt * 4; // the host is done: land quickly
  else sky.t += dt;
  // Stay in the clouds until this machine has built the new stage.
  if (!sky.loaded && sky.t > T.cut) sky.t = T.cut;
  if (sky.t >= T.len || (g.mode !== 'transition' && sky.t > T.land && !sky.loaded)) endSky(g, s);
}

// ---------------------------------------------------------------- render

const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const Q1 = new THREE.Quaternion();
const M1 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** Every rendered frame, after the camera rig and the HUD fade: camera moves, poses, 3D pieces and overlays. */
export function renderCinematics(this: Game, frameDt: number): void {
  const s = cineState(this);
  const view = ui(this, s);
  const time = this.animTime;
  // Golden portal and chests (every machine).
  s.portal?.render(frameDt);
  if (s.chests.length || s.chestView) (s.chestView ??= new JackpotChests(this.scene)).render(s.chests, time);
  // Title hint.
  if (view) {
    const tp = titlePlayState(this);
    view.titleHint(this.mode === 'title' && this.screens.current === 'title' && attractRunning(this) ? (tp.controlled ? 'playing' : 'idle') : '');
  }
  if (s.sky) renderSky(this, s, frameDt);
  // Legendary reveal: beam, falling icon, title card, a gentle push-in.
  if (s.reveal && view) {
    const beam = (s.beam ??= new RevealBeam(this.scene));
    const r = s.reveal;
    const k = r.t / r.len;
    const p = r.hero.player.rig.root.position;
    beam.show(p.x, p.z, k, revealTuning.landAt, r.item.color);
    const land = revealTuning.landAt;
    const y = 2 + revealTuning.height * Math.max(0, 1 - k / land) ** 1.5;
    V1.set(p.x, y, p.z).project(this.cam.camera);
    view.revealShow(r.item, k, land, k < land + 0.05 ? { x: ((V1.x + 1) / 2) * innerWidth, y: ((1 - V1.y) / 2) * innerHeight } : null, r.short);
    view.letterbox(r.hold);
    setBody('cn-cine', r.hold); // solo: a clean frame (online the HUD stays, the fight goes on)
    // Push the camera in on the hero and back out.
    const bell = Math.sin(Math.min(1, k * 1.25) * Math.PI);
    const cam = this.cam.camera;
    cam.position.lerp(V2.set(p.x, p.y + 2, p.z), revealTuning.zoom * bell);
  } else {
    s.beam?.show(0, 0, -1, 0, '#fff');
    if (!s.sky) {
      view?.letterbox(false);
      setBody('cn-cine', false);
    }
  }
  // Overlays with their own clocks.
  if (view) {
    if (s.end) view.endingDraw(s.end.t);
    if (s.jack) jackDraw(this, s, view);
    if (s.flaw) view.flawlessDraw(s.flaw.t, reduceMotion());
  }
}

function jackDraw(g: Game, s: CineState, view: CineUi): void {
  const j = s.jack!;
  const r = view.jackpotDraw(j.t, j.stops, j.len);
  for (const i of r.landed) {
    sfx.reelLand(i === 2 ? 'legendary' : 'rare');
    if (i === 2) {
      j.won = true;
      sfx.named('legendary');
      if (j.view.gold > 0) for (let k = 0; k < 4; k++) setTimeout(() => sfx.coin(), 150 + k * 110);
      if (!reduceMotion()) g.hud.flash(0.35);
    }
  }
  if (r.ticks && j.t - j.tickT > 0.06) {
    j.tickT = j.t;
    sfx.reelTick();
  }
}

function setBody(cls: string, on: boolean): void {
  if (typeof document !== 'undefined') document.body.classList.toggle(cls, on);
}

function renderSky(g: Game, s: CineState, frameDt: number): void {
  const sky = s.sky!;
  const T = sky.T;
  const host = g.role !== 'client';
  const t = host ? g.modeT : sky.t;
  sky.t = t;
  const ph = skyPhase(t, T);
  const loaded = host ? g.stageLoaded : sky.loaded;
  setBody('cn-cine', true);
  g.hud.setFade(0);
  if (!host) g.fadeT = 0;
  const cam = g.cam.camera;
  // The rig's camera this frame: where we hand back to.
  s.camPos.copy(cam.position);
  s.camQuat.copy(cam.quaternion);
  const living = g.heroes.filter((h) => !h.left && !h.player.dead);
  const me = g.hero;
  let cover = 0;
  let wind = 0;
  if (ph.phase === 'leap') {
    const lp = leapPose(ph.k);
    g.heroes.forEach((h, i) => {
      if (h.left || h.player.dead) return;
      const f = sky.from[i] ?? { x: h.player.x, z: h.player.z };
      poseLeap(h.player.rig, f.x + (sky.px - f.x) * lp.along, lp.y, f.z + (sky.pz - f.z) * lp.along, lp.scale, ph.k);
    });
    cover = ph.k > 0.72 ? (ph.k - 0.72) / 0.28 : 0;
    wind = ph.k > 0.6 ? (ph.k - 0.6) / 0.4 : 0;
    // Camera leans in on the portal.
    const w = Math.sin(ph.k * Math.PI * 0.5) * 0.5;
    V1.copy(s.camPos).lerp(V2.set(sky.px, 7, sky.pz + 7), w);
    M1.lookAt(V1, V2.set(sky.px, 1.2, sky.pz), UP);
    Q1.setFromRotationMatrix(M1);
    cam.position.copy(V1);
    cam.quaternion.copy(s.camQuat).slerp(Q1, w);
    if (!sky.whoosh && ph.k > 0.8) {
      sky.whoosh = true;
      sfx.named('whoosh');
    }
  } else if (ph.phase === 'fall' || ph.phase === 'land' || ph.phase === 'done') {
    const u = ph.phase === 'fall' ? ph.k : 1;
    if (!loaded) {
      cover = 1;
      for (const h of g.heroes) h.player.rig.root.visible = false;
    } else {
      // The new arena assembles under the fall.
      if (s.assembly.done && s.assembly.target !== g.arena.group && !sky.landed) s.assembly.start(g.arena.group, me.player.x, me.player.z, T);
      s.assembly.update(t);
      const yaw = (1 - u) * skyfallTuning.camYaw;
      for (const h of living) {
        h.player.rig.root.visible = true;
        h.player.rig.root.rotation.y = Math.PI + yaw;
        if (ph.phase === 'fall') poseSkydive(h.player.rig, fallHeight(u, sky.top) + 0.6 * (1 - u), g.animTime, u);
        else poseLand(h.player.rig, ph.k);
      }
      cover = ph.phase === 'fall' ? cloudCover(u) : 0;
      wind = ph.phase === 'fall' ? 1 - u * 0.6 : 0;
      // Touchdown: dust, a ring, a thump.
      if (!sky.landed && t >= T.land) {
        sky.landed = true;
        for (const h of living) {
          const p = h.player;
          g.particles.burst(p.x, 0.2, p.z, { count: skyfallTuning.dust, color: '#f2e2b8', color2: '#ffffff', speed: [3, 8], size: [0.18, 0.4], life: [0.4, 0.8], up: 2.5, gravity: 4, drag: 2 });
          g.fx.ring(p.x, p.z, 0.6, 5, sky.gold ? '#ffcd75' : '#f4f4f4', 0.4);
        }
        if (!reduceMotion()) g.juice.shake(skyfallTuning.shake * settings.shake);
        sfx.named('bossSlam', 1.5);
        g.input.rumble(0.6, 0.4, 180);
      }
      // Camera: high over the hero, turning slowly, handing back to the rig before touchdown.
      const hp = me.player.rig.root.position;
      const pitch = THREE.MathUtils.degToRad(skyfallTuning.camPitch);
      const d = skyfallTuning.camDist + 4 * (1 - u);
      V1.set(Math.sin(yaw) * Math.cos(pitch) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d).add(V2.set(hp.x, hp.y, hp.z));
      M1.lookAt(V1, V2, UP);
      Q1.setFromRotationMatrix(M1);
      const hb = Math.max(0, Math.min(1, (t - (T.land - skyfallTuning.handBack)) / (T.len - T.land + skyfallTuning.handBack)));
      const w = hb * hb * (3 - 2 * hb);
      cam.position.copy(V1).lerp(s.camPos, w);
      cam.quaternion.copy(Q1).slerp(s.camQuat, w);
      // A wide lens up high so the drop reads (the rig puts its own FOV back next frame).
      cam.fov += (skyfallTuning.fov - cam.fov) * (1 - w);
      if (cam.far < 200) cam.far = 200;
      cam.updateProjectionMatrix();
    }
  }
  s.ui?.skyfall(ph.phase === 'done' ? null : { cover, t, wind, gold: sky.gold });
  void frameDt;
}

/** Where the golden portal stands (for the autoplay bot), or null. */
export function goldenPortalAt(g: Game): { x: number; z: number } | null {
  const p = states.get(g)?.portal;
  return p?.active ? { x: p.x, z: p.z } : null;
}

/** Debug and test links: start a sky-fall transition now (from wherever the hero stands). */
export function debugSkyfall(g: Game, golden = false): void {
  const s = cineState(g);
  if (g.role === 'client') return;
  if (!g.portal.active) g.portal.open(g.hero.player.x + 3, g.hero.player.z);
  g.mode = 'transition';
  g.modeT = 0;
  g.stageLoaded = false;
  s.goldenRide = golden;
  if (golden) s.goldenFor = g.stage + 1;
}

/** Debug and test links: clear the stage without a hit (and open the portals right away with `portal`). */
export function debugFlawless(g: Game, portal: boolean): void {
  if (g.role === 'client') return;
  g.damagedThisStage = false;
  g.stageClear();
  if (portal) {
    g.preShop = false;
    g.openPortal();
  }
}

/** Debug and test links: play the ending now (loop `loop`). */
export function debugEnding(g: Game, loop = 1): void {
  g.vfx.cine('ending', loop, 0, 0, '');
}
