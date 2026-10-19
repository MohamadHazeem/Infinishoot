import { markClip } from './clips';
/**
 * Time lane: rewind, last stand, bullet-time dodges, the death replay and
 * clutch revives. These are Game methods (`this` is the Game), installed on
 * the class as fields, e.g. `timeStep = TimeSys.timeStep;`.
 *
 * Simulation (solo and host, in update()):
 * - `timeStep` runs at the top of every update. It records the world into
 *   the timeline (src/game/timeline.ts), runs the holds that stop the world
 *   (the rewind's backward playback, the death replay), reads the rewind
 *   button, ticks last stands and the co-op rewind vote, and spots near
 *   misses in boss fights. Returning true means "the world holds this step".
 * - `lastStand` (from hurtHero) turns a killing blow into a last stand.
 * - `timeKill` (from killEnemy) counts last-stand kills.
 * - `clutchRevive` (from updateRevives) spots a revive in dire straits.
 *
 * Co-op rules: the rewind is the TEAM's (one per stage): a press opens a
 * vote, and once everyone standing has pressed it the host rewinds the whole
 * team (the world holds on the host for the playback, so everyone sees it
 * through snapshots). Last stands are per hero, judged on the host. Bullet
 * time is presentation only online (the dodging hero's camera swings; the
 * shared simulation never slows). The death replay plays when the whole team
 * is down, on the host's recording, focused on the last hero to fall.
 *
 * Network: snapshots carry `tm` (timeNet): time events since that client's
 * last snapshot, the hold in progress, the client's own position during a
 * rewind playback, its last stand, the vote and the team's rewind meter.
 */
import type { Game } from '../game';
import { dropTuning, scoreTuning } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import type { Input } from '../../core/input';
import { Timeline } from '../timeline';
import { camWeight, isClutch, nearMiss, grazes, rewindBlock, rewindCurve, soClose, standOpens, swingWeight, timeDebug, timeTuning, votePasses, type DeathInfo } from '../timeRules';
import { TimeHud, type StandHud, type VoteHud } from '../../ui/timeHud';
import { timeSound } from '../timeAudio';
import { settings } from '../settings';
import { PAD_REWIND } from '../../core/keybinds';
import { Team } from '../bullets';
import { music } from '../../audio/music';
import { onlineStop } from '../netFeel';
import { loadHighScores } from '../highscores';
import { promptText } from '../../ui/prompts';
import * as THREE from 'three';

/** Time events: [seq, kind, hero, x, z, extra]. */
type TimeKind = 'rw' | 're' | 'ls' | 'lw' | 'lf' | 'bt' | 'cr' | 'rp' | 'vo' | 'no';
export type TimeEvent = [number, TimeKind, number, number, number, number];

/** Why a rewind press did nothing (the 'no' event's extra). */
const NO_TEXT = ['', 'REWIND USED THIS STAGE', 'NOTHING TO REWIND YET', 'NO REWIND IN PVP', 'NOT RIGHT NOW', 'THE TEAM DID NOT AGREE'];

interface HeroTime {
  standUsed: boolean;
  /** Seconds of last stand left (0 = none running). */
  standT: number;
  standKills: number;
  standCombo: number;
  /** Kills short at the last failed stand (the replay's "so close"). */
  standShort: number;
  btCd: number;
  lastHp: number;
  graze: number;
  prevPerfect: boolean;
  /** Last 'no' event (stepN), so held buttons don't spam. */
  noAt: number;
  /** Events sent to this hero's client so far. */
  sentEv: number;
}

interface Hold {
  kind: 'rewind' | 'replay';
  t: number;
  dur: number;
  /** Frame indices: rewind plays from -> to backwards (from newest), the replay forwards. */
  from: number;
  to: number;
  hero: number;
  /** Rewind: seconds of play it undoes. Replay: dead flags to put back at the end. */
  secs: number;
  dead: boolean[];
}

interface View {
  kind: 'bt' | 'replay' | 'revive';
  t: number;
  dur: number;
  hero: number;
  other: number;
  side: number;
}

interface TimeState {
  tl: Timeline;
  lastRec: number;
  lastRun: number;
  stage: number;
  rewindsUsed: number;
  hold: Hold | null;
  vote: { t: number; yes: number[]; caller: number } | null;
  heroes: HeroTime[];
  chestsOpen: number;
  bossSpawned: boolean;
  heroCount: number;
  /** Team combo at the start of this step (hurtHero zeroes it before a death). */
  lastCombo: number;
  /** Strikes about to land this step (checked for near misses next step). */
  landing: { x: number; z: number; r: number; obj: object }[];
  bossHop: Map<number, number>;
  /** XP per kill, smoothed (the replay's "kills from level"). */
  xpKill: number;
  deathSeen: boolean;
  replayDone: boolean;
  so: { title: string; text: string };
  clutchUntil: number;
  seq: number;
  events: { ev: TimeEvent; at: number }[];
  // ---- presentation (every machine)
  hud: TimeHud | null;
  view: View | null;
  /** Client mirror of the host's state. */
  net: { hold: number; k: number; stand: StandHud | null; vote: VoteHud | null; used: boolean; hist: number; so: [string, string] | null; at: number };
  playedRw: boolean;
  skipped: boolean;
  shownRun: boolean;
  /** Seconds left of the CLOSE CALL text and the clutch panel. */
  btText: number;
  reviveT: number;
  /** On the title screen (already reset). */
  idle: boolean;
}

const states = new WeakMap<Game, TimeState>();

function fresh(): HeroTime {
  return { standUsed: false, standT: 0, standKills: 0, standCombo: 0, standShort: -1, btCd: 0, lastHp: -1, graze: 0, prevPerfect: false, noAt: -999, sentEv: 0 };
}

/** Per-Game time state (kept off the Game class so the lane stays self-contained). */
export function timeState(g: Game): TimeState {
  let s = states.get(g);
  if (!s) {
    s = {
      tl: new Timeline(),
      lastRec: -1,
      lastRun: 0,
      stage: -1,
      rewindsUsed: 0,
      hold: null,
      vote: null,
      heroes: [],
      chestsOpen: 0,
      bossSpawned: false,
      heroCount: 0,
      lastCombo: 0,
      landing: [],
      bossHop: new Map(),
      xpKill: 1,
      deathSeen: false,
      replayDone: false,
      so: { title: '', text: '' },
      clutchUntil: 0,
      seq: 0,
      events: [],
      hud: null,
      view: null,
      net: { hold: 0, k: 0, stand: null, vote: null, used: false, hist: 0, so: null, at: 0 },
      playedRw: false,
      skipped: false,
      shownRun: false,
      btText: 0,
      reviveT: 0,
      idle: false,
    };
    states.set(g, s);
  }
  return s;
}

function heroTime(s: TimeState, h: Hero): HeroTime {
  return (s.heroes[h.index] ??= fresh());
}

/** A hero's time state (tests, test links). */
export function heroTimeOf(g: Game, h: Hero): HeroTime {
  return heroTime(timeState(g), h);
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const now = () => performance.now() / 1000;

export function rewindPressed(input: Input): boolean {
  return input.actionPressed('rewind') || PAD_REWIND.some((b) => input.padButtonPressed(b));
}

function skipPressed(input: Input): boolean {
  return (
    input.mousePressed(0) ||
    input.keyPressed('Escape') ||
    input.keyPressed('Space') ||
    input.keyPressed('Enter') ||
    input.actionPressed('pause') ||
    input.padButtonPressed(0) ||
    input.padButtonPressed(1) ||
    input.padButtonPressed(9)
  );
}

/** The live boss or mini-boss (bullet time only happens against them). */
function bossNow(g: Game): Enemy | null {
  if (g.boss?.active) return g.boss;
  const m = g.bossField.mini;
  return m?.active ? m : null;
}

// ---------------------------------------------------------------- the step hook

/** Top of Game.update: holds, recording, the rewind button, last stands, votes, near misses. True = the world holds this step. */
export function timeStep(this: Game, dt: number): boolean {
  const s = timeState(this);
  if (this.role === 'client') return clientStep(this, s, dt);
  // Title: nothing to do (reset once). New run / new stage: fresh counters and history.
  if (this.mode === 'title') {
    if (!s.idle) resetRun(s);
    s.idle = true;
    return false;
  }
  s.idle = false;
  if (this.runTime < s.lastRun - 1e-6) resetRun(s);
  s.lastRun = this.runTime;
  if (this.stage !== s.stage) {
    s.stage = this.stage;
    s.rewindsUsed = 0;
    s.vote = null;
    if (timeTuning.standPerStage) for (const ht of s.heroes) if (ht) ht.standUsed = false;
    s.tl.clear();
  }
  if (s.hold) {
    advanceHold(this, s, dt);
    return true;
  }
  barriers(this, s);
  const running = !(this.paused && this.role === 'solo') && this.mode !== 'levelup' && this.mode !== 'shop' && this.juice.hitStop <= 0 && !this.photo?.active;
  // Record the world a few times a second of play.
  if (this.mode === 'fight' && running && this.runTime - s.lastRec >= 1 / timeTuning.recordHz - 1e-6) {
    s.tl.record(this);
    s.tl.stage = this.stage;
    s.lastRec = this.runTime;
  }
  if (this.mode === 'dead') {
    if (deathStep(this, s)) return true;
  } else s.deathSeen = s.replayDone = false;
  // The rewind button (the local hero; clients send `rw`).
  const h = this.hero;
  if (running && h && this.isCombatMode && this.screens.current === 'none' && !this.paused && rewindPressed(this.input)) this.requestRewind(h);
  if (running) {
    const sdt = dt * (this.slowMoT > 0 ? 0.35 : 1);
    tickVote(this, s, sdt);
    tickStands(this, s, sdt);
    if (this.mode === 'fight') nearMisses(this, s, sdt);
  }
  s.lastCombo = this.combo;
  if (s.hold) return true; // a rewind started this step
  return false;
}

function resetRun(s: TimeState): void {
  s.tl.clear();
  s.lastRec = -1;
  s.stage = -1;
  s.rewindsUsed = 0;
  s.vote = null;
  s.heroes = [];
  s.hold = null;
  s.deathSeen = s.replayDone = false;
  s.clutchUntil = 0;
  s.landing.length = 0;
  s.bossHop.clear();
}

/** Moments a rewind may not cross: menus, chests opened, the boss arriving, players joining or leaving. */
/** Start the rewind history over (another lane's payout that a rewind must not undo, e.g. a jackpot chest). */
export function timeBarrier(g: Game): void {
  const s = timeState(g);
  s.tl.clear();
  s.lastRec = -1;
}

function barriers(g: Game, s: TimeState): void {
  let opened = 0;
  for (const c of g.chests.list) if (c.openT >= 0) opened++;
  const heroes = g.heroes.filter((h) => !h.left).length;
  const cross = (g.mode !== 'fight' && g.mode !== 'dead') || opened !== s.chestsOpen || g.director.bossSpawned !== s.bossSpawned || heroes !== s.heroCount;
  s.chestsOpen = opened;
  s.bossSpawned = g.director.bossSpawned;
  s.heroCount = heroes;
  if (cross && s.tl.count) {
    s.tl.clear();
    s.lastRec = -1;
  }
}

// ---------------------------------------------------------------- rewind

/** A hero pressed REWIND (local, or a client's `rw` message on the host). */
export function requestRewind(this: Game, h: Hero): void {
  const s = timeState(this);
  const fighting = this.mode === 'fight' && !s.hold && this.introLeft <= 0 && !this.onboarding.training && !(this.boss && this.boss.hp <= 0);
  const why = rewindBlock({ used: s.rewindsUsed, history: s.tl.span, pvp: !!this.pvp, fighting, dead: h.player.dead });
  if (why === '') return;
  if (why !== null) {
    const ht = heroTime(s, h);
    if (this.stepN - ht.noAt < 90) return;
    ht.noAt = this.stepN;
    emit(this, 'no', h, Math.max(1, NO_TEXT.indexOf(why)));
    return;
  }
  if (!this.coop) {
    startRewind(this, s, h);
    return;
  }
  // Co-op: everyone standing has to agree.
  if (!s.vote) s.vote = { t: timeTuning.voteTime, yes: [h.index], caller: h.index };
  else if (!s.vote.yes.includes(h.index)) s.vote.yes.push(h.index);
  else return;
  emit(this, 'vo', h, s.vote.yes.length);
  checkVote(this, s);
}

function standing(g: Game): number[] {
  return g.heroes.filter((x) => !x.left && !x.player.dead).map((x) => x.index);
}

function checkVote(g: Game, s: TimeState): void {
  const v = s.vote;
  if (!v || !votePasses(v.yes, standing(g))) return;
  const caller = g.heroes[v.caller] ?? g.hero;
  s.vote = null;
  // The history may have hit a barrier while the team voted.
  if (s.tl.span < timeTuning.rewindMin || g.mode !== 'fight') {
    emit(g, 'no', caller, 2);
    return;
  }
  startRewind(g, s, caller);
}

function tickVote(g: Game, s: TimeState, dt: number): void {
  const v = s.vote;
  if (!v) return;
  if (g.mode !== 'fight') {
    s.vote = null;
    return;
  }
  v.t -= dt;
  checkVote(g, s);
  if (s.vote && v.t <= 0) {
    s.vote = null;
    emit(g, 'no', g.heroes[v.caller] ?? g.hero, 5);
  }
}

function startRewind(g: Game, s: TimeState, h: Hero): void {
  const tl = s.tl;
  // Record "now" so the playback starts from the present.
  tl.record(g);
  const to = tl.indexBack(timeTuning.rewindSeconds);
  const from = tl.count - 1;
  if (to < 0 || from <= to) return;
  s.hold = { kind: 'rewind', t: 0, dur: timeTuning.rewindPlay, from, to, hero: h.index, secs: r2(tl.at(from).t - tl.at(to).t), dead: [] };
  emit(g, 'rw', h, s.hold.secs);
}

/** Holds: the rewind plays the history backwards, the death replay plays its window forwards in slow motion. */
function advanceHold(g: Game, s: TimeState, dt: number): void {
  const H = s.hold!;
  const pinned = timeDebug.pin >= 0;
  if (!pinned) H.t += dt;
  // Cosmetic things keep moving while the world holds.
  g.particles.update(dt);
  g.fx.update(dt);
  const tl = s.tl;
  if (H.kind === 'rewind') {
    const k = pinned ? timeDebug.pin : Math.min(1, H.t / H.dur);
    const idx = Math.round(H.from + (H.to - H.from) * rewindCurve(k));
    tl.restore(g, tl.at(Math.max(H.to, Math.min(H.from, idx))), 'visual');
    if (pinned || H.t < H.dur) return;
    tl.restore(g, tl.at(H.to), 'full');
    s.rewindsUsed++;
    for (const h of g.heroes) g.mods2Event(h, 'rewind');
    s.hold = null;
    for (const ht of s.heroes) if (ht && ht.standT > 0) ht.standT = 0; // the stand is undone (it stays used)
    tl.clear();
    s.lastRec = g.runTime;
    s.landing.length = 0;
    for (const h of g.heroes) if (!h.left) emit(g, 're', h, h.player.dashStock);
    return;
  }
  // Death replay.
  const play = timeTuning.replayPlay;
  const k = pinned ? timeDebug.pin : Math.min(1, H.t / play);
  const pos = H.from + (H.to - H.from) * k;
  const i0 = Math.min(H.to, Math.floor(pos));
  const i1 = Math.min(H.to, i0 + 1);
  const f0 = tl.at(i0);
  tl.restore(g, f0, 'visual', i1 > i0 ? tl.at(i1) : null, pos - i0);
  g.slowMoT = Math.max(g.slowMoT, 0.05); // cosmetic animation runs slow too
  g.heroes.forEach((h, i) => {
    if (h.left || !H.dead[i]) return;
    const p = h.player;
    p.invuln = 0; // no i-frame blinking in the replay
    const down = k >= 1 || f0.heroDead(i);
    if (p.dead !== down) {
      p.dead = down;
      p.rig.root.visible = true;
    }
    if (down) p.hp = 0;
  });
  const skip = !pinned && skipPressed(g.input);
  if (!skip && (pinned || H.t < play + timeTuning.replayLinger)) return;
  endReplay(g, s);
}

function endReplay(g: Game, s: TimeState): void {
  const H = s.hold;
  if (!H || H.kind !== 'replay') return;
  g.heroes.forEach((h, i) => {
    if (h.left || !H.dead[i]) return;
    h.player.dead = true;
    h.player.hp = 0;
  });
  s.hold = null;
  s.replayDone = true;
}

// ---------------------------------------------------------------- death replay

/** Mode 'dead' (the whole team is down): note the "so close" stat, then play the replay after the fall. */
function deathStep(g: Game, s: TimeState): boolean {
  if (!s.deathSeen) {
    s.deathSeen = true;
    s.so = soClose(deathInfo(g, s));
    // The killing moment itself goes into the history.
    if (s.tl.count) s.tl.record(g);
  }
  if (s.replayDone || g.gameOverShown || g.modeT < timeTuning.replayDelay) return false;
  s.replayDone = true;
  if (settings.deathReplay === false || g.pvp || g.onboarding.training || s.tl.span < 0.5) return false;
  const tl = s.tl;
  const to = tl.count - 1;
  const from = Math.min(to - 1, tl.indexBack(timeTuning.replayWindow));
  if (from < 0) return false;
  // Focus: the last hero to fall (lowest life in the newest frame that was still up before it).
  let hero = g.local;
  const before = tl.at(Math.max(0, to - 1));
  for (const h of g.heroes) if (!h.left && !before.heroDead(h.index)) hero = h.index;
  s.hold = { kind: 'replay', t: 0, dur: timeTuning.replayPlay + timeTuning.replayLinger, from, to, hero, secs: r2(tl.at(to).t - tl.at(from).t), dead: g.heroes.map((h) => h.player.dead) };
  emit(g, 'rp', g.heroes[hero] ?? g.hero, s.hold.dur);
  return true;
}

function deathInfo(g: Game, s: TimeState): DeathInfo {
  const boss = g.boss?.active ? g.boss : null;
  const best = loadHighScores()[0]?.score ?? 0;
  const score = g.score * g.meta.multiplier;
  let short = -1;
  for (const ht of s.heroes) if (ht && ht.standShort > 0) short = short < 0 ? ht.standShort : Math.min(short, ht.standShort);
  const need = Math.max(0, g.xpNext - g.xp);
  return {
    bossHp01: boss ? Math.max(0, boss.hp / boss.maxHp) : -1,
    bossName: boss?.def.name ?? '',
    toBoss: g.director.bossSpawned ? -1 : g.director.remaining,
    level: g.level,
    xp01: g.xpNext > 0 ? g.xp / g.xpNext : 0,
    killsToLevel: s.xpKill > 0 ? Math.ceil(need / (s.xpKill * Math.max(0.1, g.hero.stats.xpMul))) : -1,
    toBest: best - score,
    bestScore: best,
    standShort: short,
    combo: s.lastCombo,
    rewindLeft: s.rewindsUsed < timeTuning.rewindPerStage && !g.coop,
    runTime: g.runTime,
    kills: g.kills,
  };
}

// ---------------------------------------------------------------- last stand

/** hurtHero: a killing blow just landed on h. True = a last stand starts instead of going down. */
export function lastStand(this: Game, h: Hero): boolean {
  const s = timeState(this);
  const ht = heroTime(s, h);
  if (this.mode !== 'fight' || this.role === 'client') return false;
  const combo = Math.max(s.lastCombo, s.tl.bestCombo(timeTuning.standMemory));
  if (!standOpens({ combo, used: ht.standUsed, pvp: !!this.pvp, training: !!this.onboarding.training, active: ht.standT > 0 })) return false;
  const T = timeTuning;
  const p = h.player;
  ht.standUsed = true;
  ht.standT = T.standTime;
  ht.standKills = 0;
  ht.standCombo = combo;
  p.dead = false;
  p.hp = 1;
  p.rig.root.visible = true;
  p.invuln = Math.max(p.invuln, T.standTime + T.standFreeze + 0.2);
  if (!this.online) this.juice.freeze(T.standFreeze);
  this.vfx.ring(p.x, p.z, 1, 9, '#b13e53', 0.5);
  this.vfx.burst(p.x, 1, p.z, { count: 24, color: '#b13e53', color2: '#ffcd75', speed: [3, 8], size: [0.15, 0.3], life: [0.4, 0.8], up: 5, gravity: 8 });
  this.vfx.num(p.x, 3.2, p.z, 'LAST STAND!', 'crit');
  emit(this, 'ls', h, T.standKills);
  return true;
}

function tickStands(g: Game, s: TimeState, dt: number): void {
  for (const h of g.heroes) {
    const ht = s.heroes[h.index];
    if (!ht || ht.standT <= 0) continue;
    if (h.left) {
      ht.standT = 0;
      continue;
    }
    // Leaving the fight (stage cleared, portal) counts as surviving.
    if (g.mode !== 'fight' && g.mode !== 'dead') {
      standWin(g, h, ht);
      continue;
    }
    ht.standT -= dt;
    h.player.hp = Math.max(1, h.player.hp);
    if (ht.standT > 0) continue;
    // Out of time: the blow lands after all.
    ht.standT = 0;
    ht.standShort = Math.max(1, timeTuning.standKills - ht.standKills);
    const p = h.player;
    p.invuln = 0;
    p.hp = 0;
    p.dead = true;
    p.rig.root.visible = p.showWhenDead;
    emit(g, 'lf', h, ht.standShort);
    g.onHeroDown(h);
  }
}

function standWin(g: Game, h: Hero, ht: HeroTime): void {
  const T = timeTuning;
  const p = h.player;
  ht.standT = 0;
  ht.standShort = -1;
  p.hp = Math.max(p.hp, p.maxHp * T.standHeal);
  p.invuln = Math.max(T.standIframes, Math.min(p.invuln, T.standIframes));
  if (ht.standCombo > g.combo) {
    g.combo = ht.standCombo;
    g.comboT = scoreTuning.comboWindow;
  }
  g.vfx.ring(p.x, p.z, 1, 12, '#a7f070', 0.5);
  g.vfx.burst(p.x, 1.2, p.z, { count: 36, color: '#a7f070', color2: '#ffcd75', speed: [4, 10], size: [0.15, 0.32], life: [0.5, 0.9], up: 7, gravity: 10 });
  g.vfx.num(p.x, 3.2, p.z, 'SURVIVED!', 'heal');
  h.skill.style.add(60, 'LAST STAND');
  emit(g, 'lw', h, ht.standCombo);
}

/** killEnemy: last-stand kills, and the XP a kill is worth (for the replay's stats). */
export function timeKill(this: Game, e: Enemy, by: Hero | null): void {
  const s = timeState(this);
  s.xpKill += (e.def.xp * dropTuning.xpMul - s.xpKill) * 0.05;
  if (!by) return;
  const ht = s.heroes[by.index];
  if (!ht || ht.standT <= 0) return;
  ht.standKills++;
  if (ht.standKills >= timeTuning.standKills) standWin(this, by, ht);
}

// ---------------------------------------------------------------- bullet time

/** Boss and mini-boss fights: strikes and slams landing just beside a hero, bosses charging past, bullet rings grazing, perfect dashes. */
function nearMisses(g: Game, s: TimeState, dt: number): void {
  const boss = bossNow(g);
  if (!boss) {
    s.landing.length = 0;
    return;
  }
  const T = timeTuning;
  // Strikes that were about to land last step and are gone now: they landed.
  const landed = s.landing.filter((l) => !g.strikes.includes(l.obj as (typeof g.strikes)[number]));
  s.landing.length = 0;
  for (const st of g.strikes) if (st.t <= dt * 1.2) s.landing.push({ x: st.x, z: st.z, r: st.r, obj: st });
  // Slams: a boss (or mini-boss) coming down from a jump.
  const slams: Enemy[] = [];
  for (const e of [g.boss, g.bossField.mini]) {
    if (!e?.active) continue;
    const was = s.bossHop.get(e.uid) ?? 0;
    if (was > 0.6 && e.hopY < 0.2) slams.push(e);
    s.bossHop.set(e.uid, e.hopY);
  }
  for (const h of g.heroes) {
    if (h.left || h.player.dead) continue;
    const ht = heroTime(s, h);
    const p = h.player;
    ht.btCd -= dt;
    const hurt = ht.lastHp >= 0 && p.hp < ht.lastHp - 0.01;
    ht.lastHp = p.hp;
    // Grazing bullets (counted even while cooling down, so a ring that starts then doesn't pile up later).
    let n = 0;
    const b = g.bullets;
    for (let i = 0; i < b.count; i++) if (b.team[i] === Team.Enemy && grazes(b.x[i], b.z[i], b.radius[i], p.x, p.z, p.radius)) n++;
    ht.graze = ht.graze * Math.exp(-dt / T.grazeDecay) + n;
    const perfect = h.skill.dashPerfect && !ht.prevPerfect;
    ht.prevPerfect = h.skill.dashPerfect;
    if (ht.btCd > 0 || hurt || p.hurtFlash > 0 || ht.standT > 0) continue;
    let at: { x: number; z: number } | null = null;
    for (const l of landed) if (nearMiss(l.x, l.z, l.r, p.x, p.z, p.radius)) at = l;
    for (const e of slams) if (nearMiss(e.x, e.z, 3.8, p.x, p.z, p.radius)) at = e;
    if (!at && boss.state === 'attack') {
      const sp = Math.hypot(boss.x - boss.px, boss.z - boss.pz) / Math.max(1e-3, dt);
      const gap = Math.hypot(boss.x - p.x, boss.z - p.z) - boss.radius - p.radius;
      if (sp > 6 && gap > 0 && gap < T.chargeMargin) at = boss;
    }
    if (!at && ht.graze >= T.grazeNeed) at = boss;
    if (!at && perfect) at = boss;
    if (at) bulletTime(g, s, h, at.x, at.z);
  }
}

function bulletTime(g: Game, s: TimeState, h: Hero, x: number, z: number): void {
  const ht = heroTime(s, h);
  ht.btCd = timeTuning.btCooldown;
  ht.graze = 0;
  const p = h.player;
  if (g.role === 'solo' && settings.slowMo !== false) g.slowMoT = Math.max(g.slowMoT, timeTuning.btSlow);
  g.vfx.star(p.x, 1.2, p.z, 2.2, '#73eff7', 0.18);
  g.vfx.ring(p.x, p.z, 0.5, 5, '#73eff7', 0.3);
  h.skill.style.add(30, 'CLOSE CALL');
  emit(g, 'bt', h, 0, x, z);
}

/** Force a bullet-time moment for hero h (test links, debug panel). */
export function debugBulletTime(g: Game, h: Hero = g.hero): void {
  const s = timeState(g);
  bulletTime(g, s, h, h.player.x + 3, h.player.z - 2);
}

// ---------------------------------------------------------------- clutch revive

/** updateRevives: h was just revived by `helpers`. A rescue in dire straits gets the hand-grab cutscene. */
export function clutchRevive(this: Game, h: Hero, helpers: Hero[]): void {
  if (!helpers.length || this.pvp) return;
  const s = timeState(this);
  if (this.runTime < s.clutchUntil && timeDebug.pin < 0) return;
  let helper = helpers[0];
  for (const o of helpers) if (o.player.hp / o.player.maxHp < helper.player.hp / helper.player.maxHp) helper = o;
  const crowd = this.enemiesInRadius(h.player.x, h.player.z, timeTuning.clutchRadius, this.scratch).length;
  const clutch = isClutch({ helperHp01: helper.player.hp / helper.player.maxHp, crowd, standing: this.aliveHeroes.length - 1, players: this.heroes.filter((x) => !x.left).length });
  if (!clutch && !forceClutch.on) return;
  forceClutch.on = false;
  s.clutchUntil = this.runTime + timeTuning.clutchCooldown;
  if (this.role === 'solo' && settings.slowMo !== false) this.slowMoT = Math.max(this.slowMoT, timeTuning.clutchSlow);
  const mx = (h.player.x + helper.player.x) / 2;
  const mz = (h.player.z + helper.player.z) / 2;
  this.vfx.star(mx, 1.6, mz, 3, '#ffcd75', 0.25);
  this.vfx.num(mx, 3.6, mz, 'CLUTCH!', 'score');
  emit(this, 'cr', h, helper.index, mx, mz);
}

/** Test links: the next revive counts as clutch whatever the odds. */
export const forceClutch = { on: false };

// ---------------------------------------------------------------- events and network

function emit(g: Game, kind: TimeKind, h: Hero, extra = 0, x = h.player.x, z = h.player.z): void {
  const s = timeState(g);
  const ev: TimeEvent = [++s.seq, kind, h.index, r2(x), r2(z), extra];
  if (g.role === 'host') {
    const t = now();
    s.events.push({ ev, at: t });
    while (s.events.length > 64 || (s.events.length && t - s.events[0].at > 3)) s.events.shift();
  }
  playEvent(g, s, ev);
}

/** Every machine: sounds, banners and camera moves for a time event. */
function playEvent(g: Game, s: TimeState, ev: TimeEvent): void {
  const [, kind, i, x, z, extra] = ev;
  const h = g.heroes[i];
  if (!h) return;
  const mine = i === g.local;
  const me = g.hero.player;
  const gain = mine ? 1 : Math.max(0, 1 - Math.hypot(x - me.x, z - me.z) / 30) * 0.7;
  const hud = ensureHud(s);
  switch (kind) {
    case 'rw':
      s.playedRw = false;
      timeSound('rewind');
      music.silence(timeTuning.rewindPlay + 0.3);
      g.hud.flash(0.2);
      if (g.coop) g.hud.toast(`${h.name.toUpperCase()}: TEAM REWIND!`, 1.6);
      break;
    case 're':
      if (!s.playedRw) {
        s.playedRw = true;
        hud?.played();
        timeSound('play');
        g.hud.flash(0.3);
      }
      if (mine && g.role === 'client') {
        g.player.teleport(x, z);
        g.player.dashStock = extra;
        g.player.invuln = Math.max(g.player.invuln, timeTuning.rewindIframes);
      }
      break;
    case 'ls':
      timeSound('stand', gain);
      if (mine) {
        hud?.standStart(timeTuning.standKills);
        music.silence(0.8);
        g.hud.flash(0.5);
        g.input.rumble(0.9, 0.7, 300);
        if (g.online) onlineStop(g, timeTuning.standFreeze);
      }
      break;
    case 'lw':
    case 'lf':
      timeSound(kind === 'lw' ? 'standWin' : 'standFail', gain);
      if (mine) hud?.standEnd(kind === 'lw');
      break;
    case 'bt':
      if (!mine) break;
      timeSound('bulletTime');
      g.input.rumble(0.3, 0.5, 200);
      if (settings.dynamicCamera !== false) {
        // Swing away from the attack, so it stays in view.
        const ax = x - me.x;
        const az = z - me.z;
        const side = ax * me.aim.z - az * me.aim.x >= 0 ? 1 : -1;
        s.view = { kind: 'bt', t: 0, dur: timeTuning.btSwing, hero: i, other: -1, side };
      }
      hud?.letterbox(true, false, true);
      s.btText = timeTuning.btSwing;
      break;
    case 'cr': {
      markClip(g, 'revive');
      const o = g.heroes[extra];
      timeSound('clutch', Math.max(gain, 0.6));
      hud?.reviveStart(o?.name ?? '', h.name, extra, i);
      const near = mine || extra === g.local || Math.hypot(x - me.x, z - me.z) < 20;
      if (near && settings.dynamicCamera !== false) s.view = { kind: 'revive', t: 0, dur: timeTuning.clutchTime, hero: i, other: extra, side: (i + extra) % 2 ? 1 : -1 };
      s.reviveT = timeTuning.clutchTime;
      break;
    }
    case 'rp':
      s.skipped = false;
      timeSound('replay');
      music.silence(extra + 0.5);
      s.view = { kind: 'replay', t: 0, dur: extra, hero: i, other: -1, side: 1 };
      break;
    case 'vo':
      timeSound('vote', 0.8);
      if (extra === 1 && !mine) g.hud.toast(`${h.name.toUpperCase()} WANTS TO REWIND · PRESS ${promptText('rewind')} TO AGREE`, 2.4);
      break;
    case 'no':
      if (extra === 5) {
        g.hud.toast('TEAM REWIND: NOT EVERYONE AGREED', 2);
        break;
      }
      if (!mine) break;
      timeSound('deny');
      g.hud.toast(NO_TEXT[extra] ?? 'NOT RIGHT NOW', 1.6);
      break;
  }
}

/** Host: a client's time message (`rw`: the rewind button). */
export function timeMessage(this: Game, h: Hero, m: Record<string, unknown>): void {
  if (m.t === 'rw' && this.isCombatMode && !h.player.dead) this.requestRewind(h);
}

/** Host snapshot part for one client. */
export function timeNet(this: Game, forHero: Hero): Record<string, unknown> {
  const s = timeState(this);
  const ht = heroTime(s, forHero);
  const e: TimeEvent[] = [];
  for (const x of s.events) if (x.ev[0] > ht.sentEv) e.push(x.ev);
  ht.sentEv = s.seq;
  const H = s.hold;
  const out: Record<string, unknown> = {
    m: [s.rewindsUsed >= timeTuning.rewindPerStage ? 1 : 0, r2(Math.min(1, s.tl.span / timeTuning.rewindSeconds))],
  };
  if (e.length) out.e = e;
  if (H) {
    out.h = [H.kind === 'rewind' ? 1 : 2, r2(Math.min(1, H.t / (H.kind === 'rewind' ? H.dur : timeTuning.replayPlay)))];
    if (H.kind === 'rewind') out.p = [r2(forHero.player.x), r2(forHero.player.z)];
    else out.so = [s.so.title, s.so.text];
  }
  if (ht.standT > 0) out.s = [ht.standKills, timeTuning.standKills, r2(ht.standT / timeTuning.standTime)];
  const v = s.vote;
  if (v) out.v = [v.yes.length, Math.max(1, standing(this).length), r2(Math.max(0, v.t) / timeTuning.voteTime), v.caller, v.yes.includes(forHero.index) ? 1 : 0];
  return out;
}

/** Client: mirror the host's time state and play its events. */
export function applyTimeNet(this: Game, data: unknown): void {
  const s = timeState(this);
  const d = data as { m?: number[]; e?: TimeEvent[]; h?: number[]; p?: number[]; s?: number[]; v?: number[]; so?: [string, string] } | undefined;
  if (!d) return;
  const n = s.net;
  n.at = now();
  n.used = !!d.m?.[0];
  n.hist = d.m?.[1] ?? 0;
  for (const ev of d.e ?? []) playEvent(this, s, ev);
  n.hold = d.h?.[0] ?? 0;
  n.k = d.h?.[1] ?? 0;
  if (d.p && n.hold === 1) {
    const p = this.player;
    p.prev.x = p.pos.x;
    p.prev.z = p.pos.z;
    p.pos.x = d.p[0];
    p.pos.z = d.p[1];
  }
  if (d.so) n.so = d.so;
  n.stand = d.s ? { kills: d.s[0], need: d.s[1], left01: d.s[2] } : null;
  n.vote = d.v ? { yes: d.v[0], need: d.v[1], left01: d.v[2], caller: this.heroes[d.v[3]]?.name ?? '', mine: !!d.v[4] } : null;
}

/** Client step: send the rewind button; hold while the host plays a rewind or replay. */
function clientStep(g: Game, s: TimeState, _dt: number): boolean {
  const n = s.net;
  // A host that went quiet can't keep us frozen.
  if (n.hold && now() - n.at > 1) n.hold = 0;
  if (n.hold) return true;
  const control = g.isCombatMode && !g.player.dead && g.screens.current === 'none' && !g.paused;
  if (control && rewindPressed(g.input)) g.client?.send({ t: 'rw' });
  return false;
}

// ---------------------------------------------------------------- render (every machine)

const camDir = new THREE.Vector3();
const camTo = new THREE.Vector3();
const camAt = new THREE.Vector3();

/** After the camera rig: camera moves (bullet time, replay, clutch revive) and the time HUD. */
export function renderTime(this: Game, frameDt: number): void {
  const s = timeState(this);
  const hud = ensureHud(s);
  const inRun = this.mode !== 'title' && this.screens.current === 'none';
  if (!hud) return;
  if (!inRun) {
    if (s.shownRun) {
      s.shownRun = false;
      hud.reset();
      s.view = null;
      s.btText = s.reviveT = 0;
    }
    hud.meter(false, 0, false, false, false);
    return;
  }
  s.shownRun = true;
  const client = this.role === 'client';
  const H = s.hold;
  // Hold progress (host: its own clock; client: the host's).
  const holdKind = client ? s.net.hold : H ? (H.kind === 'rewind' ? 1 : 2) : 0;
  const pin = timeDebug.pin;
  const holdK = client ? s.net.k : H ? (pin >= 0 ? pin : Math.min(1, H.t / (H.kind === 'rewind' ? H.dur : timeTuning.replayPlay))) : 0;
  // Camera move.
  const v = s.view;
  if (v) {
    v.t = pin < 0 ? v.t + frameDt : v.kind === 'replay' ? Math.min(v.dur - 0.05, pin * timeTuning.replayPlay + 0.1) : pin * v.dur;
    if (v.kind === 'replay' && (holdKind !== 2 || s.skipped) && pin < 0 && v.t > 0.3) s.view = null;
    else if (v.t >= v.dur && pin < 0) s.view = null;
    else applyView(this, v);
  }
  // HUD.
  const used = client ? s.net.used : s.rewindsUsed >= timeTuning.rewindPerStage;
  const hist = client ? s.net.hist : Math.min(1, s.tl.span / timeTuning.rewindSeconds);
  const ready = !used && hist * timeTuning.rewindSeconds >= timeTuning.rewindMin && this.mode === 'fight';
  const vote = client ? s.net.vote : voteHud(this, s);
  hud.meter(this.isCombatMode, used ? 0 : hist, ready, used, !!vote);
  hud.vhsAt(holdKind === 1 ? rewindCurve(holdK) : -1, H?.secs ?? timeTuning.rewindSeconds, frameDt);
  hud.standAt(client ? s.net.stand : standHud(this, s), frameDt);
  hud.voteAt(vote);
  const replay = holdKind === 2 && !s.skipped;
  if (client && replay && skipPressed(this.input)) s.skipped = true;
  const so = client ? s.net.so : [s.so.title, s.so.text];
  hud.replayAt(replay ? { speed: timeTuning.replayWindow / timeTuning.replayPlay, card: holdK >= 1, title: so?.[0] ?? '', text: so?.[1] ?? '' } : null);
  s.btText = Math.max(0, s.btText - frameDt);
  s.reviveT = Math.max(0, s.reviveT - frameDt);
  if (pin >= 0 && s.view?.kind === 'bt') s.btText = 1;
  if (pin >= 0 && s.view?.kind === 'revive') s.reviveT = 1;
  if (s.reviveT <= 0) hud.reviveEnd();
  const bars = replay || (s.view !== null && s.view.kind !== 'replay') || s.btText > 0 || s.reviveT > 0;
  hud.letterbox(bars, replay || s.reviveT > 0, s.btText > 0 && !replay);
  hud.body('tm-hold', holdKind !== 0);
}

function voteHud(g: Game, s: TimeState): VoteHud | null {
  const v = s.vote;
  if (!v) return null;
  return { yes: v.yes.length, need: Math.max(1, standing(g).length), left01: Math.max(0, v.t) / timeTuning.voteTime, caller: g.heroes[v.caller]?.name ?? '', mine: v.yes.includes(g.local) };
}

function standHud(g: Game, s: TimeState): StandHud | null {
  const ht = s.heroes[g.local];
  if (!ht || ht.standT <= 0) return null;
  return { kills: ht.standKills, need: timeTuning.standKills, left01: Math.max(0, ht.standT / timeTuning.standTime) };
}

function ensureHud(s: TimeState): TimeHud | null {
  if (s.hud) return s.hud;
  const root = document.getElementById('ingame')?.parentElement;
  if (!root) return null;
  s.hud = new TimeHud(root);
  return s.hud;
}

/**
 * Override the rig's camera for a cinematic beat: orbit, pitch and distance
 * blend from the rig's own framing, so every move starts and ends seamlessly.
 */
function applyView(g: Game, v: View): void {
  const cam = g.cam.camera;
  const T = timeTuning;
  // Where the rig looks: its view ray on the ground.
  cam.getWorldDirection(camDir);
  const hit = camDir.y < -0.05 ? -cam.position.y / camDir.y : 25;
  const bx = cam.position.x + camDir.x * hit;
  const bz = cam.position.z + camDir.z * hit;
  const baseDist = Math.hypot(cam.position.x - bx, cam.position.y, cam.position.z - bz);
  const basePitch = Math.asin(Math.min(1, cam.position.y / Math.max(0.01, baseDist)));
  const h = g.heroes[v.hero]?.player;
  if (!h) return;
  const hp = h.rig.root.position;
  let fx = hp.x;
  let fz = hp.z;
  let w = 0;
  let yaw = 0;
  let pitch = basePitch;
  let dist = baseDist;
  const k = v.t / v.dur;
  if (v.kind === 'bt') {
    w = swingWeight(k);
    yaw = v.side * T.btYaw * w;
    pitch = basePitch - THREE.MathUtils.degToRad(T.btPitch) * w;
    dist = baseDist * (1 + (T.btZoom - 1) * w);
  } else if (v.kind === 'replay') {
    w = camWeight(v.t, v.dur, 0.5, 0.01);
    yaw = (-0.35 + T.replayOrbit * k) * w;
    pitch = basePitch + (THREE.MathUtils.degToRad(T.replayPitch) - basePitch) * w;
    dist = baseDist + (T.replayDist - baseDist) * w;
  } else {
    const o = g.heroes[v.other]?.player.rig.root.position;
    if (o) {
      fx = (fx + o.x) / 2;
      fz = (fz + o.z) / 2;
    }
    const sep = o ? Math.hypot(hp.x - o.x, hp.z - o.z) : 2;
    w = camWeight(v.t, v.dur, 0.3, 0.4);
    yaw = v.side * (0.25 + 0.15 * k) * w;
    pitch = basePitch + (THREE.MathUtils.degToRad(40) - basePitch) * w;
    dist = baseDist + (Math.max(9, 6 + sep * 1.5) - baseDist) * w;
  }
  if (w <= 0.001) return;
  // Blend the look-at point from the rig's to the subject.
  const lx = bx + (fx - bx) * w;
  const lz = bz + (fz - bz) * w;
  const ly = 0.9 * w;
  const cp = Math.cos(pitch);
  camTo.set(lx + Math.sin(yaw) * cp * dist, ly + Math.sin(pitch) * dist, lz + Math.cos(yaw) * cp * dist);
  cam.position.copy(camTo);
  camAt.set(lx, ly, lz);
  cam.lookAt(camAt);
}
