import { modSession } from '../../mods/manager';
/**
 * Co-op, wave 2 (coop2 lane): drop-in/drop-out, the shared revive pool, team
 * roles, the synced team ultimate, emotes and help ghosts. Game methods
 * (`this` is the Game), installed on the class as fields. Rules and knobs are
 * in src/game/coop2.ts and src/data/coopRoles.ts; the HUD in src/ui/coopHud.ts.
 *
 * Host-authoritative like the rest of co-op:
 * - A `hello` while a run is on is a mid-run join (`coopHello`): the player
 *   waits for a safe moment, then gets a hero built to the team's level
 *   (automatic level-up picks, a share of the team's gold), spawns next to a
 *   teammate with spawn protection, and receives `start` + `stage` + `cojoin`
 *   (its spawn and the world's one-off state: chests, blown barrels, broken
 *   cover). Everyone else gets `roster`. The joiner's snapshot encoder is new,
 *   so its first snapshot is a keyframe.
 * - A client that drops (`coopLeft`) leaves its hero on autopilot for
 *   `joinTuning.grace` seconds (the shared autopilot brain), then the hero is
 *   removed and its build kept. Rejoining (matched by a stable player id from
 *   localStorage, or the name for older clients) reclaims the hero, or rebuilds
 *   it from the kept build. A client that quits on purpose sends `bye` and its
 *   hero leaves at once. Enemy scaling follows the players still in the run.
 * - Snapshot field `co` (generic snapCodec path; unchanged parts cost nothing):
 *   `j` [code, players] while joinable, `ai` [[hero, seconds left]], `pl`
 *   [lives, cost] with the pool on, `bb` [down 0..1, can buy] for a downed
 *   receiver, `g` the help ghost, `e` events since that client's last snapshot
 *   ([seq, kind, a, b, c]: em emote, tu team ultimate, bb bought back, gh ghost).
 * - Client -> host: `emote` {k}, `cobuy`, `bye`.
 */
import type { Game, LobbyEntry } from '../game';
import { Hero, HERO_COLORS, type RemoteInput } from '../hero';
import { Autopilot } from '../autopilot';
import { Player, playerTuning } from '../player';
import { computeStats } from '../stats';
import { resolveCircleVsBoxes } from '../../world/collision';
import { applyBuild, exportBuild, type HeroBuild } from '../pvp';
import { power } from '../ultimates';
import { bossLike } from '../bossRules';
import { settings } from '../settings';
import { WEAPONS } from '../../data/weapons';
import { validLoadout, type Loadout } from '../../data/loadout';
import { cleanLook } from '../../data/customise';
import { heroOf } from '../../data/heroes';
import { skinOf } from '../../data/skins';
import { metaSkin } from '../../data/codex';
import { unlockedWeapons } from '../save';
import { PAD_TEAM } from '../../core/keybinds';
import { Team } from '../bullets';
import { brokenCover, onCoverMsg } from '../coverBreak';
import { resetSnapFor } from './netHost';
import { timeState } from './time';
import { roleBonus, roleOf, type RoleBonus } from '../../data/coopRoles';
import {
  EMOTES,
  EmoteLimiter,
  addToInbox,
  autoPickCount,
  autoPickIndex,
  cleanGhost,
  emoteOf,
  ghostInbox,
  ghostTuning,
  joinTuning,
  poolCost,
  poolTuning,
  saveMyGhost,
  splitCost,
  takeFromInbox,
  teamUltDamage,
  teamUltDue,
  teamUltTuning,
  type EmoteDef,
  type HelpGhost,
} from '../coop2';
import { CoopHud, type CoopHudView } from '../../ui/coopHud';
import { GhostScreen } from '../../ui/ghostScreen';
import { playEmoteVoice } from '../../audio/emoteVoice';
import type { Enemy } from '../enemies';

type CoopEvent = [number, 'em' | 'tu' | 'bb' | 'gh', number, number, number];

interface Pending {
  peerId: string;
  pid: string;
  entry: LobbyEntry;
  /** Hero index this player is coming back to, or -1 for a new hero. */
  reclaim: number;
  since: number;
}

interface Stash {
  pid: string;
  name: string;
  build: HeroBuild;
  gold: number;
  rerolls: number;
}

interface Grace {
  index: number;
  t: number;
  pilot: Autopilot;
}

interface TeamUltRun {
  t: number;
  wave: number;
  x: number;
  z: number;
  parts: number[];
}

interface GhostRun {
  g: HelpGhost;
  t: number;
  player: Player;
  pilot: Autopilot;
  view: Game;
  helped: number;
  shotT: number;
  novaT: number;
  trailT: number;
}

/** Client-side mirror of the host's `co` field. */
interface CoopNet {
  joinable: [string, number] | null;
  ai: [number, number][];
  pool: [number, number] | null;
  buy: [number, number] | null;
  ghost: { name: string; hero: string; color: string; look: string; x: number; z: number; ax: number; az: number; t01: number } | null;
  ghostP: Player | null;
  ghostKey: string;
  waiting: string;
}

export interface CoopState {
  stage: number;
  lastRun: number;
  lastMode: string;
  pending: Pending[];
  /** Stable player id per hero index (host). */
  pids: string[];
  grace: Grace[];
  stash: Stash[];
  bye: Set<string>;
  pool: { on: boolean; lives: number; stage: number };
  downT: number[];
  ult: { prev: number[]; fired: number[]; last: number; cdUntil: number; run: TeamUltRun | null; count: number };
  seq: number;
  events: { ev: CoopEvent; at: number }[];
  sent: number[];
  lim: EmoteLimiter[];
  ghost: GhostRun | null;
  ghostsUsed: number;
  /** Run time the current boss appeared (-1 = none). */
  bossSince: number;
  /** Next run time to look in the (empty) ghost inbox. */
  inboxNext: number;
  bonus: RoleBonus;
  bonusStep: number;
  net: CoopNet;
  hud: CoopHud | null;
  ghostUi: GhostScreen | null;
  /** Bubbles to show: hero index -> [emote, seconds left]. */
  bubbles: Map<number, [EmoteDef, number]>;
  beatT: number;
}

const states = new WeakMap<Game, CoopState>();

/** Test links / screenshots: a JOINABLE badge code to show in a solo test. */
export const coopDebugView = { joinCode: '' };

export function coopState(g: Game): CoopState {
  let s = states.get(g);
  if (!s) {
    s = {
      stage: -1,
      lastRun: 0,
      lastMode: 'title',
      pending: [],
      pids: [],
      grace: [],
      stash: [],
      bye: new Set(),
      pool: { on: false, lives: 0, stage: 1 },
      downT: [],
      ult: { prev: [], fired: [], last: -Infinity, cdUntil: -Infinity, run: null, count: 0 },
      seq: 0,
      events: [],
      sent: [],
      lim: [],
      ghost: null,
      ghostsUsed: 0,
      bossSince: -1,
      inboxNext: 0,
      bonus: roleBonus([]),
      bonusStep: -1,
      net: { joinable: null, ai: [], pool: null, buy: null, ghost: null, ghostP: null, ghostKey: '', waiting: '' },
      hud: null,
      ghostUi: null,
      bubbles: new Map(),
      beatT: 0,
    };
    states.set(g, s);
  }
  return s;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Simulated seconds (rate limits): steps at 60 Hz, so tests can drive it. */
const simNow = (g: Game) => g.stepN / 60;

function setPeer(h: Hero, id: string): void {
  (h as unknown as { peerId: string }).peerId = id;
}

function activeHeroes(g: Game): Hero[] {
  return g.heroes.filter((h) => !h.left);
}

function emit(g: Game, s: CoopState, kind: CoopEvent[1], a = 0, b = 0, c = 0): void {
  if (g.role !== 'host') return;
  const now = simNow(g);
  s.events.push({ ev: [++s.seq, kind, a, b, c], at: now });
  while (s.events.length > 48 || (s.events.length && now - s.events[0].at > 3)) s.events.shift();
}

function rosterOf(g: Game): { name: string; skin: string; pet: string; hero: string; look: string }[] {
  return g.heroes.map((x) => ({ name: x.name, skin: x.skin.id, pet: x.pet, hero: x.heroDef.id, look: x.player.look }));
}

/** Is the run open to new players (host)? */
export function joinable(g: Game): boolean {
  return g.role === 'host' && !!g.host && !g.pvp && g.mode !== 'title' && g.mode !== 'dead' && settings.coopJoinable !== false && !g.onboarding.training;
}

// ---------------------------------------------------------------- the step hook

/** Top of Game.update (host, client and solo), before the time lane's holds. */
export function coop2Step(this: Game, dt: number): void {
  const s = coopState(this);
  // New run, new stage, game over: reset or record.
  if (this.mode !== s.lastMode) onModeChange(this, s.lastMode);
  s.lastMode = this.mode;
  if (this.role === 'client') {
    clientStep(this, s);
    return;
  }
  if (this.mode === 'title') return;
  if (this.runTime < s.lastRun - 1e-6 || s.stage < 0) newRun(this, s);
  s.lastRun = this.runTime;
  if (this.stage !== s.stage) {
    if (s.ghost && s.stage > 0) disposeGhost(s); // a new arena: the ghost's job is done
    if (s.stage > 0 && this.stage > s.stage && s.pool.on) s.pool.lives = Math.min(poolTuning.max, s.pool.lives + poolTuning.perStage * (this.stage - s.stage));
    s.stage = this.stage;
  }
  if (this.role === 'host') admitPending(this, s);
  graceStep(this, s, dt);
  const running = !(this.paused && this.role === 'solo') && this.mode !== 'levelup' && this.mode !== 'shop' && !this.photo?.active;
  if (!running) return;
  poolStep(this, s, dt);
  if (this.isCombatMode) {
    teamUltStep(this, s, dt);
    ghostStep(this, s, dt);
  }
}

function newRun(g: Game, s: CoopState): void {
  s.stage = g.stage;
  s.grace.length = 0;
  s.stash.length = 0;
  s.downT = [];
  s.ult = { prev: [], fired: [], last: -Infinity, cdUntil: -Infinity, run: null, count: 0 };
  s.ghostsUsed = 0;
  s.inboxNext = 0;
  disposeGhost(s);
  s.pool = { on: g.role === 'host' && settings.coopPool === true, lives: poolTuning.start, stage: g.stage };
  // startRun stands every hero back up; nobody controls a disconnected one any more.
  if (g.role === 'host') {
    for (const h of g.heroes) {
      if (h === g.hero || h.peerId) continue;
      h.left = true;
      h.player.dead = true;
      h.player.showWhenDead = false;
      h.disposeWeapons();
    }
    g.director.players = Math.max(1, activeHeroes(g).length);
  }
}

function onModeChange(g: Game, from: string): void {
  if (g.mode === 'dead' && from !== 'dead' && from !== 'title') recordGhosts(g);
  if (g.mode === 'title') {
    const s = coopState(g);
    disposeGhost(s);
    s.net.ghostP?.dispose();
    s.net.ghostP = null;
    s.net.ghost = null;
    s.net.ghostKey = '';
    s.bubbles.clear();
    s.pending.length = s.grace.length = 0;
  }
}

// ---------------------------------------------------------------- drop-in (host)

/** Host: a `hello` while a run is on. True if handled (joined, queued or refused). */
export function coopHello(this: Game, from: string, m: Record<string, unknown>): boolean {
  if (this.mode === 'title' || this.pvp || this.role !== 'host') return false;
  const host = this.host!;
  const s = coopState(this);
  const refuse = (reason: string) => {
    host.send(from, { t: 'full', reason });
    return true;
  };
  // A dropped player whose hero waits on autopilot may always come back (netcode lane), even into a closed run.
  const waiting = typeof m.pid === 'string' && m.pid !== '' && s.grace.some((x) => s.pids[x.index] === m.pid);
  if (!joinable(this) && !(waiting && this.mode !== 'dead' && this.role === 'host' && !!this.host)) return refuse(this.mode === 'dead' ? 'That run just ended.' : 'That run is closed to new players.');
  if (s.pending.some((p) => p.peerId === from) || this.heroByPeer(from)) return true;
  const name = String(m.name ?? 'Player').slice(0, 12);
  const pid = typeof m.pid === 'string' ? m.pid.slice(0, 16) : '';
  const entry: LobbyEntry = {
    peerId: from,
    name,
    unlocked: Array.isArray(m.unlocked) ? (m.unlocked as string[]) : unlockedWeapons(),
    loadout: validLoadout(m.loadout as Partial<Loadout>),
    skin: (metaSkin(String(m.skin ?? '')) ?? skinOf(String(m.skin ?? ''))).id,
    pet: String(m.pet ?? 'none'),
    hero: heroOf(String(m.hero ?? '')).id,
    look: cleanLook(m.look),
  };
  // Coming back? Their old hero (on autopilot, or removed) waits for them.
  const mine = (i: number) => (pid ? s.pids[i] === pid : this.heroes[i]?.name === name);
  const reclaim = this.heroes.findIndex((h, i) => i !== this.local && mine(i) && (h.left || s.grace.some((x) => x.index === i)));
  const busy = activeHeroes(this).length + s.pending.filter((p) => p.reclaim < 0).length;
  const maxPlayers = this.runMode === 'raid' ? 8 : 4;
  if (reclaim < 0 && busy >= maxPlayers) return refuse(`That run is full (${maxPlayers} players).`);
  if (reclaim < 0 && this.heroes.length >= maxPlayers && !this.heroes.some((h, i) => h.left && !s.grace.some((x) => x.index === i))) return refuse(`That run is full (${maxPlayers} players).`);
  s.pending.push({ peerId: from, pid, entry, reclaim, since: simNow(this) });
  host.send(from, { t: 'cowait', msg: reclaim >= 0 ? 'Welcome back! Jumping back into the run...' : 'The run is already going: you jump in at the next safe moment...' });
  return true;
}

/** A calm moment to drop someone in: fighting, no menu, no hold. */
function safeMoment(g: Game): boolean {
  return (g.mode === 'fight' || g.mode === 'cleared' || g.mode === 'portal') && !g.route.open && g.aliveHeroes.length > 0;
}

function admitPending(g: Game, s: CoopState): void {
  if (!s.pending.length) return;
  for (let i = s.pending.length - 1; i >= 0; i--) {
    if (simNow(g) - s.pending[i].since > joinTuning.waitMax) {
      g.host?.send(s.pending[i].peerId, { t: 'full', reason: 'Could not find a moment to join. Try again.' });
      s.pending.splice(i, 1);
    }
  }
  if (!safeMoment(g)) return;
  const list = s.pending.splice(0);
  for (const p of list) admit(g, s, p);
}

/** Rebuild a hero to a fair power level for the team: automatic level-up picks and a share of the team's gold. */
export function fairBuild(g: Game, h: Hero): number {
  const n = autoPickCount(g.level);
  for (let i = 0; i < n; i++) {
    const offers = h.buildOffers();
    if (!offers.length) break;
    h.applyOffer(offers[autoPickIndex(offers)]);
  }
  const mates = g.heroes.filter((x) => x !== h && !x.left);
  const avg = mates.length ? mates.reduce((a, x) => a + x.gold, 0) / mates.length : 0;
  h.gold = Math.round(avg * joinTuning.goldShare);
  h.pendingLevels = h.chestsPending = 0;
  h.offers = [];
  h.recomputeStats();
  h.player.reset(h.stats);
  h.bombCharge = 1;
  h.loadoutDirty = true;
  return n;
}

/** Put a hero next to a living teammate, on open ground, with spawn protection. */
export function placeNearMate(g: Game, h: Hero): void {
  const mate = g.aliveHeroes.find((x) => x !== h) ?? g.heroes.find((x) => x !== h && !x.left);
  const bx = mate?.player.x ?? 0;
  const bz = mate?.player.z ?? 0;
  const lim = g.arena.halfSize - 2;
  let x = bx;
  let z = bz;
  for (let k = 0; k < 16; k++) {
    const a = k * 0.785 + 0.3;
    const d = joinTuning.spawnDist * (1 + Math.floor(k / 8) * 0.8);
    const tx = bx + Math.cos(a) * d;
    const tz = bz + Math.sin(a) * d;
    if (Math.abs(tx) < lim && Math.abs(tz) < lim && !g.walls.hitCircle(tx, tz, 0.7)) {
      x = tx;
      z = tz;
      break;
    }
  }
  h.player.teleport(x, z);
  h.player.invuln = Math.max(h.player.invuln, joinTuning.spawnProtect);
  g.vfx.ring(x, z, 1, 6, h.color, 0.5);
  g.vfx.burst(x, 1, z, { count: 26, color: h.color, color2: '#ffffff', speed: [3, 8], size: [0.12, 0.3], life: [0.4, 0.8], up: 6, gravity: 10 });
  g.vfx.sound('powerUp', x, z);
}

function admit(g: Game, s: CoopState, p: Pending): void {
  const host = g.host;
  if (!host) return;
  const st = s.stash.find((x) => (p.pid ? x.pid === p.pid : x.name === p.entry.name));
  let h: Hero;
  let back = false;
  const gi = p.reclaim >= 0 ? s.grace.findIndex((x) => x.index === p.reclaim) : -1;
  if (p.reclaim >= 0 && g.heroes[p.reclaim] && (gi >= 0 || g.heroes[p.reclaim].left)) {
    h = g.heroes[p.reclaim];
    back = true;
    if (gi >= 0) s.grace.splice(gi, 1);
    else {
      // Removed after the grace period: rebuilt from the kept build (or to the team's level).
      h.left = false;
      h.player.showWhenDead = true;
      if (st) restoreStash(g, h, st);
      else {
        h.startRun();
        fairBuild(g, h);
      }
      placeNearMate(g, h);
    }
    setPeer(h, p.peerId);
    h.remote = null;
  } else {
    let index = g.heroes.length;
    if (index >= (g.runMode === 'raid' ? 8 : 4)) index = g.heroes.findIndex((x, i) => x.left && !s.grace.some((q) => q.index === i));
    if (index < 0) {
      host.send(p.peerId, { t: 'full', reason: 'That run is full (4 players).' });
      return;
    }
    const e = p.entry;
    h = g.makeHero(index, e.name, e.unlocked.filter((id) => WEAPONS[id]), p.peerId, e.skin, e.pet, e.hero);
    h.player.look = cleanLook(e.look);
    h.loadoutPick = e.loadout;
    h.startRun();
    if (st) restoreStash(g, h, st);
    else fairBuild(g, h);
    const list = [...g.heroes];
    list[index] = h;
    g.setHeroes(list);
    placeNearMate(g, h);
  }
  if (st) s.stash.splice(s.stash.indexOf(st), 1);
  s.pids[h.index] = p.pid;
  resetSnapFor(h);
  for (const x of g.heroes) x.player.showWhenDead = true;
  g.director.players = Math.max(1, activeHeroes(g).length);
  const li = g.lobby.findIndex((x) => x.peerId === p.peerId || x.name === p.entry.name);
  if (li >= 1) g.lobby[li] = p.entry;
  else g.lobby.push(p.entry);
  // The joiner: the run, the arena, then its spawn and the world's one-off state.
  host.send(p.peerId, { t: 'start', mods: modSession.hash, runMode: g.runMode, join: 1, season: g.halloween.season, candyBaseline: g.halloween.earned, meta: { heat: g.meta.heat, week: g.meta.week, clears: g.victories }, seed: g.seed, difficulty: g.difficulty.id, you: h.index, players: rosterOf(g) });
  host.send(p.peerId, { t: 'stage', season: g.halloween.season, stage: g.stage, seed: g.seed });
  host.send(p.peerId, {
    t: 'cojoin',
    x: r2(h.player.x),
    z: r2(h.player.z),
    inv: joinTuning.spawnProtect,
    back: back ? 1 : 0,
    ch: g.chests.list.map((c) => [r2(c.x), r2(c.z), r2(c.facing), c.openT >= 0 ? 1 : 0]),
    ba: g.barrels.list.map((b, i) => (b.alive ? -1 : i)).filter((i) => i >= 0),
    cv: brokenCover(g),
    cs: g.arenaStage,
  });
  for (const o of g.heroes) if (o.peerId && o !== h && !o.left) host.send(o.peerId, { t: 'roster', players: rosterOf(g) });
  g.vfx.banner(back ? `${h.name.toUpperCase()} IS BACK!` : `${h.name.toUpperCase()} JOINED!`, back ? 'THEIR HERO IS THEIRS AGAIN' : `${activeHeroes(g).length} PLAYERS · ENEMIES SCALE UP`, 2);
}

function restoreStash(g: Game, h: Hero, st: Stash): void {
  applyBuild(h, st.build, g.scene);
  h.gold = st.gold;
  h.rerollsLeft = st.rerolls;
  h.pendingLevels = h.chestsPending = 0;
}

/** Host: a client's connection closed. True if handled here. */
export function coopLeft(this: Game, id: string): boolean {
  const s = coopState(this);
  const pi = s.pending.findIndex((p) => p.peerId === id);
  if (pi >= 0) {
    s.pending.splice(pi, 1);
    return true;
  }
  if (this.pvp || this.mode === 'title' || this.role !== 'host') return false;
  const h = this.heroByPeer(id);
  if (!h || h.left) return false;
  const quit = s.bye.delete(id);
  if (quit || joinTuning.grace <= 0 || this.mode === 'dead') {
    removeHero(this, s, h, `${h.name.toUpperCase()} LEFT THE GAME`);
    return true;
  }
  // Dropped: keep the hero in the fight on autopilot for a while, in case they come back.
  setPeer(h, '');
  const p = h.player;
  h.remote ??= { x: p.x, z: p.z, vx: 0, vz: 0, ax: p.aim.x, az: p.aim.z, ad: -1, firing: false, charging: false, dashing: false };
  s.grace.push({ index: h.index, t: joinTuning.grace, pilot: new Autopilot() });
  this.vfx.toast(`${h.name.toUpperCase()} DISCONNECTED · AUTOPILOT FOR ${Math.round(joinTuning.grace)} S`, 3);
  return true;
}

/** Take a hero out of the run cleanly, keeping its build for a later rejoin. */
function removeHero(g: Game, s: CoopState, h: Hero, why: string): void {
  const gi = s.grace.findIndex((x) => x.index === h.index);
  if (gi >= 0) s.grace.splice(gi, 1);
  const pid = s.pids[h.index] ?? '';
  s.stash = s.stash.filter((x) => (pid ? x.pid !== pid : x.name !== h.name));
  if (g.mode !== 'dead') s.stash.push({ pid, name: h.name, build: exportBuild(h, g.level), gold: h.gold, rerolls: h.rerollsLeft });
  setPeer(h, '');
  h.remote = null;
  h.left = true;
  h.player.dead = true;
  h.player.showWhenDead = false;
  h.pendingLevels = h.chestsPending = 0;
  h.shopDone = true;
  h.disposeWeapons();
  g.director.players = Math.max(1, activeHeroes(g).length);
  g.vfx.toast(why, 3);
  // Don't leave the others stuck on a menu waiting for them.
  if (g.mode === 'levelup' && !g.heroes.some((x) => !x.left && x.needsPick)) g.afterPick(g.hero, '#ffffff');
  if (g.mode === 'shop' && g.heroes.every((x) => x.left || x.shopDone)) g.closeShop();
  if (g.aliveHeroes.length === 0 && g.isCombatMode) g.onHeroDown(h);
}

/** Host: disconnected heroes on autopilot, until their player is back or the grace time runs out. */
function graceStep(g: Game, s: CoopState, dt: number): void {
  for (let i = s.grace.length - 1; i >= 0; i--) {
    const gr = s.grace[i];
    const h = g.heroes[gr.index];
    if (!h || h.left) {
      s.grace.splice(i, 1);
      continue;
    }
    gr.t -= dt;
    if (gr.t <= 0) {
      removeHero(g, s, h, `${h.name.toUpperCase()} DIDN'T COME BACK · THEIR HERO LEAVES`);
      continue;
    }
    // Menus and votes never wait for an empty seat.
    if (g.mode === 'levelup' && h.needsPick && h.offers.length) g.heroAction(h, 'pick', autoPickIndex(h.offers), 1);
    if (g.mode === 'shop' && !h.shopDone) g.heroAction(h, 'done', 0, 1);
    const vote = timeState(g).vote; // a TEAM REWIND vote (systems/time.ts): the autopilot agrees
    if (vote && !h.player.dead && !vote.yes.includes(h.index)) vote.yes.push(h.index);
    pilotHero(g, h, gr.pilot, dt);
  }
}

/** Drive a hero with the autopilot brain through its remote input (host). */
function pilotHero(g: Game, h: Hero, pilot: Autopilot, dt: number): void {
  const p = h.player;
  const r: RemoteInput = h.remote ?? { x: p.x, z: p.z, vx: 0, vz: 0, ax: p.aim.x, az: p.aim.z, ad: -1, firing: false, charging: false, dashing: false };
  h.remote = r;
  if (!g.isCombatMode || p.dead || g.paused) {
    r.x = p.x;
    r.z = p.z;
    r.vx = r.vz = 0;
    r.firing = r.charging = false;
    return;
  }
  const was = g.local;
  g.local = h.index;
  let o;
  try {
    o = pilot.decide(g);
  } finally {
    g.local = was;
  }
  let mx = o.mx;
  let mz = o.mz;
  const l = Math.hypot(mx, mz);
  if (l > 0) {
    mx /= l;
    mz /= l;
  }
  const spd = playerTuning.maxSpeed * h.stats.moveSpeedMul;
  // The host follows remote heroes halfway each step, so lead by two steps' travel.
  const pos = { x: p.x + mx * spd * dt * 2, z: p.z + mz * spd * dt * 2 };
  resolveCircleVsBoxes(pos, p.radius, g.arena.colliders);
  r.x = pos.x;
  r.z = pos.z;
  r.vx = mx * spd;
  r.vz = mz * spd;
  if (o.target) {
    const ax = o.target.x - p.x;
    const az = o.target.z - p.z;
    const d = Math.hypot(ax, az) || 1;
    r.ax = ax / d;
    r.az = az / d;
    r.ad = d;
  }
  r.firing = !!o.target;
  r.charging = o.charge;
  r.dashing = false;
  if (o.special) g.tryBomb(h);
  if (o.ult) g.tryUlt(h);
}

/** Host: messages this lane adds. */
export function coopMessage(this: Game, h: Hero, m: Record<string, unknown>): void {
  if (m.t === 'emote') this.coopEmote(h, String(m.k ?? ''));
  else if (m.t === 'cobuy') tryBuyBack(this, coopState(this), h, false);
  else if (m.t === 'bye') coopState(this).bye.add(h.peerId);
}

// ---------------------------------------------------------------- roles

/** The team-role bonus for this step (host; every hero in the run counts, downed ones too). */
export function teamBonus(g: Game): RoleBonus {
  const s = coopState(g);
  if (s.bonusStep !== g.stepN) {
    s.bonusStep = g.stepN;
    s.bonus = g.pvp || !g.coop ? roleBonus([]) : roleBonus(activeHeroes(g).map((h) => roleOf(h.heroDef.id)));
  }
  return s.bonus;
}

/** Live stats: the party's role bonus (called from Game.updateHero after refreshLive). */
export function coopRoleStats(this: Game, h: Hero): void {
  if (h.left || this.role === 'client') return;
  const b = teamBonus(this);
  if (b.scale <= 0) return;
  const st = h.stats;
  st.armor += b.armor;
  st.regen += b.regen;
  st.damageMul *= 1 + b.damageMul;
  st.moveSpeedMul *= 1 + b.moveSpeedMul;
  st.magnet *= 1 + b.magnetMul;
}

// ---------------------------------------------------------------- shared revive pool

function poolStep(g: Game, s: CoopState, dt: number): void {
  for (const h of g.heroes) s.downT[h.index] = h.player.dead && !h.left && g.isCombatMode ? (s.downT[h.index] ?? 0) + dt : 0;
  if (!s.pool.on || !g.coop) return;
  // The host's own downed hero buys back with the team-move key.
  const h = g.hero;
  if (h.player.dead && g.isCombatMode && g.screens.current === 'none' && buyPressed(g)) {
    tryBuyBack(g, s, h, false);
    g.input.consumeAction('team');
    for (const b of PAD_TEAM) g.input.consumePad(b);
  }
}

function buyPressed(g: Game): boolean {
  return g.input.actionPressed('team') || PAD_TEAM.some((b) => g.input.padButtonPressed(b));
}

/** Can hero h buy back in right now (waited long enough, nobody reviving)? */
function canBuy(s: CoopState, h: Hero): boolean {
  return s.pool.on && s.pool.lives > 0 && h.player.dead && !h.left && (s.downT[h.index] ?? 0) >= poolTuning.wait && h.reviveT <= 0.05;
}

function teamGold(g: Game): number[] {
  return activeHeroes(g).map((x) => x.gold);
}

/** Spend a pool life and the team's gold to stand hero h back up. `auto`: the last hero fell (team wipe). */
export function tryBuyBack(g: Game, s: CoopState, h: Hero, auto: boolean): boolean {
  if (!s.pool.on || s.pool.lives <= 0 || !h.player.dead || h.left || g.pvp) return false;
  if (!auto && !canBuy(s, h)) return false;
  const payers = activeHeroes(g);
  const cost = poolCost(g.stage);
  const split = splitCost(payers.map((x) => x.gold), cost);
  if (!split) {
    if (!auto) {
      if (h === g.hero) g.hud.toast('NOT ENOUGH GOLD IN THE TEAM', 2);
      else g.tell(h, { t: 'toast', msg: 'NOT ENOUGH GOLD IN THE TEAM' });
    }
    return false;
  }
  payers.forEach((x, i) => {
    if (split[i] <= 0) return;
    x.gold -= split[i];
    if (x !== h) g.mvpShared(x, split[i]);
    g.vfx.num(x.player.x, 2.8, x.player.z, `-${split[i]}●`, 'score');
  });
  s.pool.lives--;
  s.downT[h.index] = 0;
  g.reviveHero(h, poolTuning.hp);
  h.player.invuln = Math.max(h.player.invuln, poolTuning.iframes);
  g.vfx.banner(auto ? 'SAVED BY THE POOL!' : 'BOUGHT BACK!', `${h.name.toUpperCase()} IS UP · -${cost}● FROM THE TEAM · ${s.pool.lives} ${s.pool.lives === 1 ? 'LIFE' : 'LIVES'} LEFT`, 1.8);
  g.vfx.sound('highFive', h.player.x, h.player.z);
  emit(g, s, 'bb', h.index, cost);
  return true;
}

/** onHeroDown hook: the whole team is down; a pool life (if the team can pay) saves the run. */
export function coopPoolSave(this: Game, h: Hero): boolean {
  const s = coopState(this);
  if (!s.pool.on || !this.coop || this.role === 'client') return false;
  return tryBuyBack(this, s, h, true);
}

// ---------------------------------------------------------------- team ultimate

function teamUltStep(g: Game, s: CoopState, dt: number): void {
  const u = s.ult;
  for (const h of g.heroes) {
    const t = h.left ? 0 : h.skill.ultT;
    if (t > 0 && !((u.prev[h.index] ?? 0) > 0)) u.fired[h.index] = g.runTime;
    u.prev[h.index] = t;
  }
  if (u.run) runTeamUlt(g, s, u.run, dt);
  if (u.run || g.pvp || g.runTime < u.cdUntil) return;
  const alive = g.aliveHeroes;
  if (alive.length < 2) return;
  if (!teamUltDue(alive.map((h) => u.fired[h.index] ?? -Infinity), g.runTime, u.last)) return;
  startTeamUlt(g, s, alive);
}

function startTeamUlt(g: Game, s: CoopState, parts: Hero[]): void {
  const u = s.ult;
  let x = 0;
  let z = 0;
  for (const h of parts) {
    x += h.player.x;
    z += h.player.z;
  }
  x /= parts.length;
  z /= parts.length;
  u.last = g.runTime;
  u.cdUntil = g.runTime + teamUltTuning.cooldown;
  u.count++;
  u.run = { t: 0, wave: 0, x, z, parts: parts.map((h) => h.index) };
  g.vfx.banner('TEAM ULTIMATE!', parts.map((h) => h.name.toUpperCase()).join(' + '), 2.2);
  g.vfx.flash(0.9);
  g.vfx.shake(x, z, 1.6);
  g.vfx.sound('legendaryPick', NaN, NaN);
  g.vfx.sound('bossPhase', x, z, 0.8);
  for (const h of parts) {
    const p = h.player;
    p.invuln = Math.max(p.invuln, teamUltTuning.iframes);
    p.skillGlow = Math.max(p.skillGlow, 2);
    g.vfx.ring(p.x, p.z, 0.6, 5, h.color, 0.5);
    g.vfx.burst(p.x, 1.2, p.z, { count: 30, color: h.color, color2: '#ffffff', speed: [4, 12], size: [0.15, 0.35], life: [0.4, 0.9], up: 10, gravity: 6 });
  }
  // Enemy bullets in the blast area are wiped.
  const R = radiusFor(parts.length);
  const b = g.bullets;
  for (let i = b.count - 1; i >= 0; i--) if (b.team[i] === Team.Enemy && Math.hypot(b.x[i] - x, b.z[i] - z) < R) b.kill(i);
  emit(g, s, 'tu', r2(x) * 100, r2(z) * 100, parts.reduce((m, h) => m | (1 << h.index), 0));
  if (g.role !== 'client') beat(g, s, x, z, parts.includes(g.hero));
}

function radiusFor(n: number): number {
  return teamUltTuning.radius + teamUltTuning.radiusPerHero * Math.max(0, n - 2);
}

const ultScratch: Enemy[] = [];

function runTeamUlt(g: Game, s: CoopState, run: TeamUltRun, dt: number): void {
  const T = teamUltTuning;
  run.t += dt;
  const n = run.parts.length;
  while (run.wave < T.waves && run.t >= (run.wave + 1) * T.waveGap) {
    const k = run.wave++;
    const R = radiusFor(n) * (0.55 + (0.45 * (k + 1)) / T.waves);
    const by = g.heroes[run.parts[k % n]] ?? g.hero;
    const colors = run.parts.map((i) => g.heroes[i]?.color ?? '#ffffff');
    g.vfx.ring(run.x, run.z, 1.5, R * 1.3, colors[k % colors.length], 0.45);
    g.vfx.ring(run.x, run.z, 1, R, '#ffffff', 0.3);
    g.vfx.shake(run.x, run.z, 0.7);
    g.vfx.sound('bomb', run.x, run.z, 0.8 + k * 0.1);
    const base = teamUltDamage(n) * power(g);
    for (const e of g.enemiesInRadius(run.x, run.z, R, ultScratch)) {
      if (e.pvpOwner >= 0) continue;
      const dx = e.x - run.x;
      const dz = e.z - run.z;
      const d = Math.hypot(dx, dz) || 1;
      g.damage(e, base * (bossLike(e) ? T.bossMul : 1), { source: 'teamult', tags: [], dirX: dx / d, dirZ: dz / d, knockback: 16, loud: k === T.waves - 1 }, by);
    }
    if (k === T.waves - 1) {
      for (const e of g.enemiesInRadius(run.x, run.z, R, ultScratch)) if (e.alive) e.frozen = Math.max(e.frozen, bossLike(e) ? T.stun * 0.15 : T.stun);
      for (const i of run.parts) {
        const h = g.heroes[i];
        if (!h || h.left || h.player.dead) continue;
        const healed = h.player.heal(h.player.maxHp * T.heal);
        if (healed > 0) g.vfx.num(h.player.x, 2.6, h.player.z, `+${Math.round(healed)}`, 'heal');
      }
      g.vfx.scar(run.x, run.z, 3.5, '#2b2440', 16);
      g.vfx.burst(run.x, 1, run.z, { count: 60, color: '#fff36b', color2: '#73eff7', speed: [6, 18], size: [0.2, 0.45], life: [0.5, 1.1], up: 9, gravity: 10 });
    }
  }
  if (run.wave >= T.waves && run.t > T.waves * T.waveGap + 0.4) s.ult.run = null;
}

/** Every machine: the camera beat (swing to the team's centre) and the HUD burst. */
function beat(g: Game, s: CoopState, x: number, z: number, mine: boolean): void {
  const me = g.hero.player;
  if (mine || Math.hypot(me.x - x, me.z - z) < 30) g.cam.killCam(x, z);
  g.juice.shake(0.6);
  s.beatT = 1.4;
  hud(g).teamUlt();
}

// ---------------------------------------------------------------- emotes

/** Host: hero h wants to emote (its own wheel, or a client's `emote`). Rate-limited per player. */
export function coopEmote(this: Game, h: Hero, k: string): void {
  const e = emoteOf(k);
  if (!e || h.left || this.mode === 'title' || this.role === 'client') return;
  const s = coopState(this);
  const lim = (s.lim[h.index] ??= new EmoteLimiter());
  if (!lim.allow(simNow(this))) return;
  emit(this, s, 'em', h.index, EMOTES.indexOf(e));
  showEmote(this, s, h, e);
}

/** This machine's wheel picked an emote: say it (host / solo) or ask the host. */
export function requestEmote(g: Game, id: string): void {
  if (g.role === 'client') g.client?.send({ t: 'emote', k: id });
  else g.coopEmote(g.hero, id);
}

function showEmote(g: Game, s: CoopState, h: Hero, e: EmoteDef): void {
  s.bubbles.set(h.index, [e, 2.4]);
  const me = g.hero.player;
  const dx = h.player.x - me.x;
  const d = Math.hypot(dx, h.player.z - me.z);
  if (h === g.hero || d < 40) playEmoteVoice(e, { heroId: h.heroDef.id, index: h.index, name: h.name, color: h.color, x: h.player.x, z: h.player.z }, h === g.hero, h === g.hero ? 0 : dx / 14, h === g.hero ? 1 : Math.max(0.35, 1 - d / 40));
}

// ---------------------------------------------------------------- help ghosts

/** The run ended: every hero that fell at a boss leaves a help ghost (yours to share; teammates' straight to your inbox). */
function recordGhosts(g: Game): void {
  if (g.pvp || g.onboarding.training) return;
  const bossName = g.role === 'client' ? g.netBoss?.name ?? '' : g.boss?.active ? g.boss.def.name : g.bossField.mini?.active ? g.bossField.mini.def.name : '';
  if (!bossName) return;
  const date = new Date().toISOString().slice(0, 10);
  const ghostOf = (h: Hero): HelpGhost => ({
    v: 1,
    name: h.name.slice(0, 12),
    hero: h.heroDef.id,
    color: h.color,
    look: h.player.look,
    level: g.level,
    stage: g.stage,
    boss: bossName,
    kit: [h.loadoutPick.primary, h.loadoutPick.secondary, h.loadoutPick.special, ...h.weapons.filter((w) => !w.def.slot).slice(0, 4).map((w) => w.def.id)],
    date,
  });
  const mine = cleanGhost(ghostOf(g.hero));
  if (mine && g.hero.player.dead) {
    saveMyGhost(mine);
    g.hud.toast('HELP GHOST SAVED · SHARE IT: EXTRAS > HELP GHOSTS', 4);
  }
  if (g.role !== 'host') return;
  // Teammates' ghosts go to everyone else's inbox.
  const list = g.heroes.filter((h) => !h.left && h.player.dead).map(ghostOf);
  for (const gh of list) if (gh.name !== g.hero.name) addToInbox(cleanGhost(gh)!);
  for (const h of g.heroes) if (h.peerId && !h.left) g.host?.send(h.peerId, { t: 'coghosts', list, you: h.name });
}

/** A hard moment for someone: low life with a crowd around. */
function hardMoment(g: Game): Hero | null {
  let worst: Hero | null = null;
  for (const h of g.aliveHeroes) {
    const p = h.player;
    if (p.hp > p.maxHp * ghostTuning.hardHp) continue;
    if (g.enemiesInRadius(p.x, p.z, 8, ultScratch).length < ghostTuning.hardCrowd) continue;
    if (!worst || p.hp / p.maxHp < worst.player.hp / worst.player.maxHp) worst = h;
  }
  return worst;
}

function ghostStep(g: Game, s: CoopState, dt: number): void {
  if (s.ghost) {
    runGhost(g, s, s.ghost, dt);
    return;
  }
  if (g.mode !== 'fight' || g.pvp || g.onboarding.training || s.ghostsUsed >= ghostTuning.perRun || settings.helpGhosts === false) return;
  // The boss has been out for a few seconds (its entrance is over; counted in play time, not render time).
  if (!g.boss?.active) s.bossSince = -1;
  else if (s.bossSince < 0) s.bossSince = g.runTime;
  if (g.stepN % 15 !== 0) return;
  const atBoss = s.bossSince >= 0 && g.runTime - s.bossSince > ghostTuning.bossDelay;
  const hard = atBoss ? null : hardMoment(g);
  if (!atBoss && !hard) return;
  // Reading the inbox means storage: look again at most every few seconds when it's empty.
  if (g.runTime < s.inboxNext) return;
  if (!ghostInbox().length) {
    s.inboxNext = g.runTime + 5;
    return;
  }
  const gh = takeFromInbox();
  if (gh) spawnGhost(g, s, gh, hard ?? lowest(g));
}

function lowest(g: Game): Hero {
  let best = g.aliveHeroes[0] ?? g.hero;
  for (const h of g.aliveHeroes) if (h.player.hp / h.player.maxHp < best.player.hp / best.player.maxHp) best = h;
  return best;
}

/** A ghostly hero body (cosmetic; used on the host and on clients). */
function ghostBody(g: Game, gh: { color: string; hero: string; look: string }): Player {
  const p = new Player(g.scene, gh.color);
  p.look = gh.look;
  const [w, h] = heroOf(gh.hero).build;
  p.rig.body.scale.set(w, h, w);
  p.buildScale = [w, h];
  p.reset(computeStats({}));
  p.invuln = 0;
  return p;
}

export function spawnGhost(g: Game, s: CoopState, gh: HelpGhost, near: Hero): void {
  s.ghostsUsed++;
  const player = ghostBody(g, gh);
  const hero = { index: -1, player, bombCharge: 0, skill: { ult: 0 }, play: { mechT: 1 } };
  const view = Object.create(g, { hero: { value: hero }, player: { value: player } }) as Game;
  s.ghost = { g: gh, t: 0, player, pilot: new Autopilot(), view, helped: near.index, shotT: 0.5, novaT: ghostTuning.novaEvery, trailT: 0 };
  const a = Math.random() * Math.PI * 2;
  player.teleport(near.player.x + Math.cos(a) * 2.5, near.player.z + Math.sin(a) * 2.5);
  const { x, z } = player.pos;
  g.vfx.banner(`${gh.name.toUpperCase()} CAME TO HELP!`, `A FRIEND'S GHOST · FELL TO ${gh.boss.toUpperCase()} ON STAGE ${gh.stage}`, 2.4);
  g.vfx.ring(x, z, 1, 8, '#73eff7', 0.6);
  g.vfx.burst(x, 1.2, z, { count: 40, color: '#73eff7', color2: '#ffffff', speed: [2, 8], size: [0.12, 0.3], life: [0.5, 1.2], up: 8, gravity: 2 });
  g.vfx.sound('powerUp', x, z, 1.3);
  emit(g, s, 'gh', 0);
}

function disposeGhost(s: CoopState): void {
  s.ghost?.player.dispose();
  s.ghost = null;
}

const fakeInput = { move: { x: 0, y: 0 } };

function runGhost(g: Game, s: CoopState, r: GhostRun, dt: number): void {
  const p = r.player;
  r.t += dt;
  if (r.t >= ghostTuning.duration || g.mode === 'dead') {
    g.vfx.ring(p.x, p.z, 1, 6, '#73eff7', 0.5);
    g.vfx.burst(p.x, 1.2, p.z, { count: 30, color: '#73eff7', color2: '#ffffff', speed: [1, 4], size: [0.12, 0.3], life: [0.6, 1.2], up: 10, gravity: -2 });
    g.vfx.toast(`${r.g.name.toUpperCase()}'S GHOST FADES AWAY`, 2.2);
    disposeGhost(s);
    return;
  }
  let helped = g.heroes[r.helped];
  if (!helped || helped.left || helped.player.dead) {
    helped = g.aliveHeroes[0] ?? helped;
    if (helped) r.helped = helped.index;
  }
  const o = r.pilot.decide(r.view);
  let mx = o.mx;
  let mz = o.mz;
  const l = Math.hypot(mx, mz) || 1;
  mx /= l;
  mz /= l;
  if (helped) {
    // Stay with the hero it came for.
    const dx = helped.player.x - p.x;
    const dz = helped.player.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > ghostTuning.leash) {
      const k = Math.min(2, (d - ghostTuning.leash) / 3 + 0.6);
      mx += (dx / d) * k * 2;
      mz += (dz / d) * k * 2;
    }
  }
  const ml = Math.hypot(mx, mz) || 1;
  fakeInput.move.x = mx / ml;
  fakeInput.move.y = mz / ml;
  p.update(dt, fakeInput as never, g.arena.colliders, false);
  const target = g.nearestEnemy(p.x, p.z, ghostTuning.range, (e) => e.pvpOwner >= 0);
  if (target) p.setAimPoint(target.x, target.z);
  const by = helped ?? g.hero;
  const scale = power(g) * (1 + r.g.level * ghostTuning.perLevel);
  r.shotT -= dt;
  if (target && r.shotT <= 0) {
    r.shotT = ghostTuning.rate;
    const mz2 = { x: 0, z: 0 };
    p.muzzle(mz2);
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    p.recoil = 1;
    g.vfx.star(mz2.x, 1.1, mz2.z, 0.7, '#73eff7', 0.06);
    g.vfx.star((mz2.x + target.x) / 2, 1, (mz2.z + target.z) / 2, 0.45, '#e8f4ff', 0.05);
    g.damage(target, ghostTuning.bolt * scale * (bossLike(target) ? ghostTuning.bossMul : 1), { source: 'ghost', fixed: true, tags: [], dirX: dx / d, dirZ: dz / d, knockback: 3, hx: target.x, hz: target.z, loud: true }, by);
    g.vfx.burst(target.x, 1, target.z, { count: 4, color: '#73eff7', color2: '#ffffff', speed: [2, 5], size: [0.1, 0.2], life: [0.15, 0.3], up: 2, gravity: 6 });
  }
  r.novaT -= dt;
  if (r.novaT <= 0) {
    const hits = g.enemiesInRadius(p.x, p.z, ghostTuning.novaRadius, ultScratch);
    if (hits.length >= 3) {
      r.novaT = ghostTuning.novaEvery;
      g.vfx.ring(p.x, p.z, 1, ghostTuning.novaRadius * 2.2, '#73eff7', 0.4);
      g.vfx.sound('telegraph', p.x, p.z, 1.4);
      for (const e of [...hits]) {
        if (e.pvpOwner >= 0) continue;
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        g.damage(e, ghostTuning.nova * scale * (bossLike(e) ? ghostTuning.bossMul : 1), { source: 'ghost', fixed: true, tags: [], dirX: dx / d, dirZ: dz / d, knockback: 10 }, by);
      }
    } else r.novaT = 0.3;
  }
}

// ---------------------------------------------------------------- snapshot (host -> client)

export function coopNet(this: Game, forHero: Hero): Record<string, unknown> {
  const s = coopState(this);
  const out: Record<string, unknown> = {};
  if (joinable(this)) out.j = [this.host!.code, activeHeroes(this).length];
  if (s.grace.length) out.ai = s.grace.map((x) => [x.index, Math.ceil(x.t)]);
  if (s.pool.on) out.pl = [s.pool.lives, poolCost(this.stage)];
  if (s.pool.on && forHero.player.dead && !forHero.left) {
    const split = splitCost(teamGold(this), poolCost(this.stage));
    out.bb = [r2(Math.min(1, (s.downT[forHero.index] ?? 0) / poolTuning.wait)), canBuy(s, forHero) && !!split ? 1 : 0];
  }
  const gh = s.ghost;
  if (gh) out.g = [gh.g.name, gh.g.hero, gh.g.color, gh.g.look, r2(gh.player.x), r2(gh.player.z), r2(gh.player.aim.x), r2(gh.player.aim.z), r2(gh.t / ghostTuning.duration)];
  const e: CoopEvent[] = [];
  const last = s.sent[forHero.index] ?? 0;
  for (const x of s.events) if (x.ev[0] > last) e.push(x.ev);
  s.sent[forHero.index] = s.seq;
  if (e.length) out.e = e;
  return out;
}

/** Client: mirror the host's `co` field and play its events. */
export function applyCoopNet(this: Game, data: unknown): void {
  const s = coopState(this);
  const d = (data ?? {}) as { j?: [string, number]; ai?: [number, number][]; pl?: [number, number]; bb?: [number, number]; g?: unknown[]; e?: CoopEvent[] };
  const n = s.net;
  n.joinable = d.j ?? null;
  n.ai = d.ai ?? [];
  n.pool = d.pl ?? null;
  n.buy = d.bb ?? null;
  const g = d.g;
  if (g && g.length >= 9) {
    n.ghost = { name: String(g[0]), hero: String(g[1]), color: String(g[2]), look: String(g[3]), x: Number(g[4]), z: Number(g[5]), ax: Number(g[6]), az: Number(g[7]), t01: Number(g[8]) };
    const key = `${n.ghost.name}|${n.ghost.hero}`;
    if (!n.ghostP || n.ghostKey !== key) {
      n.ghostP?.dispose();
      n.ghostP = ghostBody(this, n.ghost);
      n.ghostP.teleport(n.ghost.x, n.ghost.z);
      n.ghostKey = key;
    }
    n.ghostP.netSet(n.ghost.x, n.ghost.z, 0, 0, n.ghost.ax, n.ghost.az, false);
  } else if (n.ghostP) {
    n.ghostP.dispose();
    n.ghostP = null;
    n.ghost = null;
    n.ghostKey = '';
  }
  for (const ev of d.e ?? []) playEvent(this, s, ev);
}

function playEvent(g: Game, s: CoopState, ev: CoopEvent): void {
  const [, kind, a, b, c] = ev;
  if (kind === 'em') {
    const h = g.heroes[a];
    const e = EMOTES[b];
    if (h && e) showEmote(g, s, h, e);
  } else if (kind === 'tu') {
    const parts = g.heroes.filter((h) => c & (1 << h.index));
    beat(g, s, a / 100, b / 100, parts.includes(g.hero));
  }
}

// ---------------------------------------------------------------- client messages

/** Client: messages this lane adds (and a peek at the lobby). True if consumed. */
export function coopClientMsg(this: Game, m: Record<string, unknown>): boolean {
  const s = coopState(this);
  switch (m.t) {
    case 'lobby':
      hud(this).lobby(this, (m.co as LobbyCo | undefined) ?? null, false);
      return false;
    case 'cowait':
      s.net.waiting = String(m.msg ?? '');
      this.screens.setLobby({ code: '', players: [{ name: this.netName || 'You', color: HERO_COLORS[1] }], isHost: false, status: s.net.waiting });
      return true;
    case 'cojoin': {
      s.net.waiting = '';
      const p = this.player;
      p.teleport(Number(m.x) || 0, Number(m.z) || 0);
      p.invuln = Math.max(p.invuln, Number(m.inv) || 0);
      for (const h of this.heroes) h.player.showWhenDead = true;
      // One-off world state the joiner missed: chests, blown barrels, broken cover.
      this.chests.clear();
      for (const c of (m.ch as number[][]) ?? []) {
        this.chests.add(c[0], c[1], c[2]);
        if (c[3]) this.chests.open(this.chests.list.length - 1);
      }
      for (const i of (m.ba as number[]) ?? []) {
        const b = this.barrels.remove(i);
        if (b) this.removeBarrelCollider(b);
      }
      for (const i of (m.cv as number[]) ?? []) onCoverMsg(this, { i, s: m.cs });
      this.vfx.banner(m.back ? 'WELCOME BACK!' : 'YOU JOINED THE RUN!', m.back ? 'YOUR HERO WAS KEEPING YOUR SPOT' : 'YOUR HERO IS BUILT TO THE TEAM\'S LEVEL', 2.2);
      return true;
    }
    case 'roster': {
      const players = (m.players as { name: string; skin?: string; pet?: string; hero?: string; look?: string }[]) ?? [];
      const list = [...this.heroes];
      players.forEach((pl, i) => {
        const cur = list[i];
        if (i === this.local || (cur && cur.name === pl.name && cur.heroDef.id === (pl.hero ?? 'rookie'))) return;
        const h = this.makeHero(i, pl.name, [], '', pl.skin, pl.pet ?? 'none', pl.hero ?? 'rookie');
        h.player.look = cleanLook(pl.look);
        h.recomputeStats();
        h.player.reset(h.stats);
        h.player.showWhenDead = true;
        list[i] = h;
      });
      this.setHeroes(list);
      for (const h of this.heroes) h.player.showWhenDead = true;
      return true;
    }
    case 'coghosts': {
      const you = String(m.you ?? '');
      let n = 0;
      for (const x of (m.list as unknown[]) ?? []) {
        const gh = cleanGhost(x);
        if (gh && gh.name !== you && addToInbox(gh)) n++;
      }
      if (n) this.hud.toast(`${n} FRIEND GHOST${n > 1 ? 'S' : ''} WILL HELP IN YOUR NEXT RUN`, 4);
      return true;
    }
  }
  return false;
}

function clientStep(g: Game, s: CoopState): void {
  // Downed with the pool on: buy back with the team-move key.
  if (g.isCombatMode && g.player.dead && s.net.buy?.[1] && g.screens.current === 'none' && buyPressed(g)) {
    g.client?.send({ t: 'cobuy' });
    g.input.consumeAction('team');
    for (const b of PAD_TEAM) g.input.consumePad(b);
  }
}

// ---------------------------------------------------------------- lobby

export interface LobbyCo {
  /** Revive pool on, joinable after start, roles (and names) per player. */
  pool: boolean;
  join: boolean;
  roles: string[];
  names?: string[];
}

/** Host: what the lobby shows about this lane (sent in the `lobby` broadcast as `co`). */
export function coopLobby(this: Game): LobbyCo {
  const info: LobbyCo = { pool: settings.coopPool === true, join: settings.coopJoinable !== false, roles: this.lobby.map((p) => roleOf(p.hero)), names: this.lobby.map((p) => p.name) };
  hud(this).lobby(this, info, true);
  return info;
}

// ---------------------------------------------------------------- render (every machine)

function hud(g: Game): CoopHud {
  const s = coopState(g);
  return (s.hud ??= new CoopHud());
}

export function renderCoop2(this: Game, rdt: number, netA: number): void {
  const s = coopState(this);
  const ui = hud(this);
  s.ghostUi ??= new GhostScreen(this.screens); // EXTRAS > HELP GHOSTS
  const fighting = this.mode !== 'title' && this.isCombatMode;
  const client = this.role === 'client';
  // The ghost body: the host's simulated one, or the client's mirror.
  const gp = client ? s.net.ghostP : s.ghost?.player ?? null;
  if (gp) {
    gp.render(client ? netA : 1, rdt);
    const t = performance.now() / 1000;
    for (const m of gp.rig.materials) m.uniforms.uFlash.value.set(0.55, 0.92, 1, 0.6 + 0.1 * Math.sin(t * 9));
    gp.rig.root.visible = Math.floor(t * 20) % 6 !== 0;
    const gh = s.ghost;
    if (gh && rdt > 0) {
      gh.trailT -= rdt;
      if (gh.trailT <= 0) {
        gh.trailT = 0.08;
        this.particles.burst(gp.x, 0.6, gp.z, { count: 2, color: '#73eff7', color2: '#ffffff', speed: [0.2, 1], size: [0.1, 0.22], life: [0.4, 0.8], up: 2, gravity: -1, drag: 2 });
      }
    }
  }
  // Plain solo with nothing to show: skip the HUD work.
  const coop = this.heroes.filter((h) => !h.left).length > 1 || this.role !== 'solo';
  if (!coop && !gp && !s.bubbles.size && !s.grace.length && !coopDebugView.joinCode) {
    ui.idle();
    return;
  }
  // Bubbles over heroes and the ghost, positioned on screen.
  const tags: CoopHudView['tags'] = [];
  const project = (x: number, z: number, y: number) => {
    this.tmp.set(x, y, z).project(this.cam.camera);
    return { x: ((this.tmp.x + 1) / 2) * innerWidth, y: ((1 - this.tmp.y) / 2) * innerHeight, on: this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.05 && Math.abs(this.tmp.y) < 1.05 };
  };
  for (const [i, b] of s.bubbles) {
    b[1] -= rdt > 0 ? rdt : 1 / 60;
    const h = this.heroes[i];
    if (b[1] <= 0 || !h || h.left) {
      s.bubbles.delete(i);
      continue;
    }
    const r = h.player.rig.root.position;
    const q = project(r.x, r.z, 4.1);
    if (q.on) tags.push({ key: `e${i}`, x: q.x, y: q.y, text: b[0].say, color: h.color, glyph: b[0], fade: Math.min(1, b[1] / 0.3) });
  }
  const ai = client ? s.net.ai : s.grace.map((x) => [x.index, Math.ceil(x.t)] as [number, number]);
  for (const [i, t] of ai) {
    const h = this.heroes[i];
    if (!h || h.left || s.bubbles.has(i)) continue;
    const r = h.player.rig.root.position;
    const q = project(r.x, r.z, 4.1);
    if (q.on) tags.push({ key: `a${i}`, x: q.x, y: q.y, text: `AUTOPILOT ${t}S`, color: '#94b0c2', glyph: null, fade: 1 });
  }
  const ghost = client ? s.net.ghost : s.ghost ? { name: s.ghost.g.name, t01: s.ghost.t / ghostTuning.duration } : null;
  if (gp && ghost) {
    const q = project(gp.x, gp.z, 3.1);
    if (q.on) tags.push({ key: 'ghost', x: q.x, y: q.y, text: `${ghost.name.toUpperCase()} · GHOST ${Math.max(0, Math.ceil(ghostTuning.duration * (1 - ghost.t01)))}S`, color: '#73eff7', glyph: null, fade: 1 });
  }
  // Team panel: joinable code, roles and their bonus, the pool.
  const roles = this.heroes.filter((h) => !h.left).map((h) => ({ role: roleOf(h.heroDef.id), color: h.color, name: h.name }));
  const join = client ? s.net.joinable : joinable(this) ? ([this.host!.code, activeHeroes(this).length] as [string, number]) : coopDebugView.joinCode ? ([coopDebugView.joinCode, activeHeroes(this).length] as [string, number]) : null;
  const pool = client ? s.net.pool : s.pool.on ? ([s.pool.lives, poolCost(this.stage)] as [number, number]) : null;
  let buy: CoopHudView['buy'] = null;
  if (fighting && this.hero.player.dead && pool) {
    if (client) {
      const b = s.net.buy;
      buy = b ? { wait01: b[0], ok: !!b[1], cost: pool[1], lives: pool[0] } : null;
    } else {
      const split = splitCost(teamGold(this), poolCost(this.stage));
      buy = { wait01: Math.min(1, (s.downT[this.hero.index] ?? 0) / poolTuning.wait), ok: canBuy(s, this.hero) && !!split, cost: poolCost(this.stage), lives: s.pool.lives };
    }
  }
  s.beatT = Math.max(0, s.beatT - (rdt > 0 ? rdt : 0));
  ui.render({
    show: fighting && coop && !this.pvp,
    join,
    roles,
    bonus: roleBonus(roles.map((r) => r.role)),
    pool,
    buy,
    tags: fighting ? tags : [],
  });
}

// ---------------------------------------------------------------- tests and test links

/** The lane's per-Game state (tests, test links, debug panel). */
export function coop2Debug(g: Game): CoopState {
  return coopState(g);
}

/** Debug / test link: a ghost helps right now (from the inbox, else a made-up friend). */
export function debugGhost(g: Game, name = 'Buddy'): void {
  const s = coopState(g);
  if (s.ghost || g.role === 'client') return;
  const gh = takeFromInbox() ?? cleanGhost({ name, hero: 'ace', color: '#73eff7', look: '---00', level: Math.max(5, g.level), stage: g.stage, boss: 'King Bopper', kit: ['buster', 'charge', 'bomb'], date: '' })!;
  spawnGhost(g, s, gh, lowest(g));
}

/** Debug / test link: start a team ultimate now with every living hero. */
export function debugTeamUlt(g: Game): void {
  const s = coopState(g);
  if (g.role === 'client' || s.ult.run || g.aliveHeroes.length < 1) return;
  startTeamUlt(g, s, g.aliveHeroes);
}
