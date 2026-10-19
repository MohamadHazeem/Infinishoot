/**
 * pvp2 lane: PvP that's worth playing (rules and numbers in src/game/pvp.ts,
 * arenas in src/data/pvpArenas.ts, the duel step in systems/pvpFlow.ts).
 *
 * - Formats: free-for-all (up to 8) or 2v2 teams (friendly fire off, team
 *   colours, team win), one round or BEST OF 3 (first to 2, draws replayed).
 * - Every round is fought in a dedicated PvP arena (rotating, or the host's
 *   pick): host and clients build it from its id.
 * - Round flow on the host: 3-2-1, fight, the ring closes then collapses,
 *   at most one team standing -> scoreboard -> next round or the match end.
 * - Bots: the host can fill seats with AI opponents; they get a build matched
 *   to the players' levels and fight with a simple duel brain.
 * - Spectating: knocked-out players watch the others (click / A cycles) or
 *   fly a free camera (DASH toggles it, move to pan).
 *
 * Net: the host sends `p2round` (arena, round, spawn spots) and `p2board`
 * (scoreboard) messages, and the duel state in the snapshot's `p2` field.
 * Everything drawn here (ring, team rings, HUD, scoreboard) is local and
 * derived from that state.
 */
import * as THREE from 'three';
import type { Game, LobbyEntry } from '../game';
import type { Hero } from '../hero';
import { HERO_COLORS } from '../hero';
import { Autopilot } from '../autopilot';
import { Team } from '../bullets';
import { PVP_ARENAS, PVP_ARENA_BY_ID, type PvpArenaDef } from '../../data/pvpArenas';
import { HEROES } from '../../data/heroes';
import { validLoadout, type Loadout } from '../../data/loadout';
import { autoPickCount, autoPickIndex } from '../coop2';
import {
  PVP_TARGET,
  PVP_MAX_PLAYERS,
  DEFAULT_PVP_RULES,
  arenaForRound,
  cleanRules,
  finalRound,
  matchState,
  pvpTuning,
  spawnPoints,
  suddenDeathAt,
  zoneStartFor,
  type PvpRules,
} from '../pvp';
import { createFieldArena } from '../../world/fieldArena';
import { biomeByKey } from '../../data/biomes';
import { applyBiomeLook } from '../../render/biomeLook';
import { disposeObject } from '../../render/dispose';
import { StaticBoxGrid } from '../../core/spatialHash';
import { streaks } from '../streaks';
import { createRetroMaterial } from '../../render/retroMaterial';
import { loadJson, saveJson } from '../../core/storage';
import { save } from '../save';
import { samples } from '../../audio/samples';
import { caption } from '../../audio/captions';
import { voiceGate } from '../../audio/announcer';
import { prompt } from '../../ui/prompts';
import { localize, localizeHtml } from '../../i18n';
import { playerTuning } from '../player';
import { resolveCircleVsBoxes } from '../../world/collision';
import type { LobbyView } from '../../ui/screens';

/** Team colours (Sweetie 16): team A sky blue, team B orange. */
export const TEAM_COLORS = ['#41a6f6', '#ef7d57'];
export const TEAM_NAMES = ['BLUE', 'ORANGE'];
const ZONE_COLOR = '#b13e53';

export interface BoardRow {
  /** Hero index, name, colour, team, round wins (their team's), knockouts, damage dealt (life), out this round. */
  i: number;
  n: string;
  c: string;
  t: number;
  k: number;
  d: number;
  out: boolean;
}
export interface Board {
  round: number;
  /** Winning team of the round (-1 draw), wins per team, match decided and its winner team (-1 draw). */
  team: number;
  wins: number[];
  over: boolean;
  winner: number;
  format: PvpRules['format'];
  rounds: 1 | 3;
  rows: BoardRow[];
}

/** What the snapshot carries (`p2`). */
interface NetP2 {
  r: number;
  w: number[];
  tm: number[];
  z: number;
  zs: number;
  zt: number;
  cd: number;
  re: number;
  f: 0 | 1;
  bo: 1 | 3;
  a: string;
}

interface Pvp2State {
  rules: PvpRules;
  bots: Map<number, BotBrain>;
  /** Client: the latest duel state from the host (the host reads its own PvpState). */
  net: NetP2 | null;
  board: Board | null;
  boardT: number;
  /** Local presentation. */
  zoneMesh: THREE.Group | null;
  teamRings: THREE.Mesh[];
  hud: HTMLElement | null;
  big: HTMLElement | null;
  boardEl: HTMLElement | null;
  spec: HTMLElement | null;
  lastKey: string;
  lastCd: number;
  lastRound: number;
  freeCam: boolean;
  camX: number;
  camZ: number;
}

const states = new WeakMap<Game, Pvp2State>();
const RULES_KEY = 'pvp2.rules';

export function pvp2State(g: Game): Pvp2State {
  let s = states.get(g);
  if (!s) {
    s = {
      rules: cleanRules(loadJson(RULES_KEY, DEFAULT_PVP_RULES), PVP_ARENAS.map((a) => a.id)),
      bots: new Map(),
      net: null,
      board: null,
      boardT: 0,
      zoneMesh: null,
      teamRings: [],
      hud: null,
      big: null,
      boardEl: null,
      spec: null,
      lastKey: '',
      lastCd: -1,
      lastRound: 0,
      freeCam: false,
      camX: 0,
      camZ: 0,
    };
    states.set(g, s);
  }
  return s;
}

/** The host's saved PvP rules (lobby rows). */
export function pvpRules(g: Game): PvpRules {
  return pvp2State(g).rules;
}

export function setPvpRules(g: Game, r: Partial<PvpRules>): void {
  const s = pvp2State(g);
  s.rules = cleanRules({ ...s.rules, ...r }, PVP_ARENAS.map((a) => a.id));
  saveJson(RULES_KEY, s.rules);
}

/** "FIGHT EVERYONE ELSE · BEST OF 3" for banners and the lobby. */
export function pvpRulesNote(r: PvpRules): string {
  return `${r.format === 'teams' ? 'FIGHT AS 2 TEAMS' : 'FIGHT EVERYONE ELSE'} · ${r.rounds === 3 ? 'BEST OF 3' : 'ONE ROUND'}`;
}

// ------------------------------------------------------------------ bots

export function isBotPeer(id: string): boolean {
  return id.startsWith('bot:');
}

const BOT_NAMES = ['BOLT BOT', 'PIXEL BOT', 'TURBO BOT', 'NOVA BOT', 'GIGA BOT', 'ZAPPY BOT', 'CHIP BOT'];

/** Host lobby: add an AI opponent (PvP lobbies only). */
export function addPvpBot(g: Game): boolean {
  if (g.role !== 'host' || g.lobby.length >= PVP_MAX_PLAYERS) return false;
  const n = g.lobby.filter((p) => isBotPeer(p.peerId)).length + 1;
  const heroes = HEROES.filter((h) => !h.unlock || save.achievements.includes(h.unlock));
  const k = (g.lobby.length * 7 + n * 3) % 97;
  const hero = heroes[k % heroes.length];
  const starters = { primary: ['buster', 'scatter'], secondary: ['charge', 'grenade'], special: ['bomb', 'storm'] };
  const loadout = validLoadout({ primary: starters.primary[k % 2], secondary: starters.secondary[(k >> 1) % 2], special: starters.special[(k >> 2) % 2] });
  const name = BOT_NAMES[(n - 1) % BOT_NAMES.length];
  const entry: LobbyEntry = { peerId: `bot:${n}:${k}`, name, unlocked: [], loadout, skin: 'default', pet: 'none', hero: hero.id };
  g.lobby.push(entry);
  g.refreshLobby();
  return true;
}

/** Host lobby: remove the last bot. */
export function removePvpBot(g: Game): boolean {
  for (let i = g.lobby.length - 1; i > 0; i--) {
    if (!isBotPeer(g.lobby[i].peerId)) continue;
    g.lobby.splice(i, 1);
    g.refreshLobby();
    return true;
  }
  return false;
}

/** A bot's build: the loadout, then automatic level-up picks for the players' average level. */
export function botHero(g: Game, h: Hero, loadout: Loadout, level: number): void {
  h.loadoutPick = { ...loadout };
  h.startRun();
  const n = autoPickCount(Math.round(level), 1);
  for (let i = 0; i < n; i++) {
    const offers = h.buildOffers();
    if (!offers.length) break;
    h.applyOffer(offers[autoPickIndex(offers)]);
  }
  h.pendingLevels = h.chestsPending = 0;
  h.offers = [];
  h.recomputeStats();
  h.player.reset(h.stats);
  h.loadoutDirty = true;
  void g;
}

/** A duel brain: strafe round the nearest opponent at range, stay in the ring, dodge shots, hold right click in bursts. */
export class BotBrain {
  readonly pilot = new Autopilot();
  private dir = 1;
  private turnT = 0;
  private rightT = 0;
  private dashCd = 0;
  constructor(private seed: number) {}

  step(g: Game, h: Hero, dt: number): void {
    const p = h.player;
    const pvp = g.pvp!;
    const r = (h.remote ??= { x: p.x, z: p.z, vx: 0, vz: 0, ax: p.aim.x, az: p.aim.z, ad: -1, firing: false, charging: false, dashing: false });
    r.dashing = false;
    if (p.dead || h.left) {
      r.x = p.x;
      r.z = p.z;
      r.vx = r.vz = 0;
      r.firing = r.charging = false;
      return;
    }
    // Nearest standing opponent.
    let tgt: Hero | null = null;
    let td = Infinity;
    for (const o of g.heroes) {
      if (o === h || o.left || o.player.dead || pvp.teams[o.index] === pvp.teams[h.index]) continue;
      const d = Math.hypot(o.player.x - p.x, o.player.z - p.z);
      if (d < td) [td, tgt] = [d, o];
    }
    this.turnT -= dt;
    if (this.turnT <= 0) {
      this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
      this.dir = this.seed & 1 ? 1 : -1;
      this.turnT = 1.5 + ((this.seed >>> 8) % 100) / 40;
    }
    let mx = 0;
    let mz = 0;
    if (tgt) {
      const dx = p.x - tgt.player.x;
      const dz = p.z - tgt.player.z;
      const d = td || 1;
      const want = (9 - d) * 0.25;
      mx = (-dz / d) * this.dir + (dx / d) * want;
      mz = (dx / d) * this.dir + (dz / d) * want;
    }
    // Stay well inside the ring.
    const rc = Math.hypot(p.x, p.z);
    const safe = Math.max(2, pvp.zoneR - 4);
    if (rc > safe) {
      mx -= (p.x / rc) * (rc - safe) * 0.6;
      mz -= (p.z / rc) * (rc - safe) * 0.6;
    }
    // Dodge: a dash away from an opponent's shot about to land.
    this.dashCd -= dt;
    let threat = false;
    for (let i = 0; i < g.bullets.count; i++) {
      if (g.bullets.team[i] !== Team.Player || g.bullets.owner[i] === h.index || pvp.teams[g.bullets.owner[i]] === pvp.teams[h.index]) continue;
      if (Math.hypot(g.bullets.x[i] - p.x, g.bullets.z[i] - p.z) < 1.8) {
        threat = true;
        break;
      }
    }
    if (threat && this.dashCd <= 0 && p.dashReady01 >= 1) {
      this.dashCd = 1.2;
      r.dashing = true;
      p.invuln = Math.max(p.invuln, playerTuning.dashTime + playerTuning.dashIframesExtra);
      p.dashT = Math.max(p.dashT, playerTuning.dashTime);
      g.onDash(h);
    }
    const l = Math.hypot(mx, mz);
    if (l > 0) {
      mx /= l;
      mz /= l;
    }
    const spd = playerTuning.maxSpeed * h.stats.moveSpeedMul * (r.dashing ? 2.2 : 1);
    const pos = { x: p.x + mx * spd * dt * 2, z: p.z + mz * spd * dt * 2 };
    resolveCircleVsBoxes(pos, p.radius, g.arena.colliders);
    r.x = pos.x;
    r.z = pos.z;
    r.vx = mx * spd;
    r.vz = mz * spd;
    if (tgt) {
      // Lead the target a little (shots take a moment to arrive), like a player would.
      const lead = Math.min(0.5, td / 30);
      const ax = tgt.player.x + tgt.player.vel.x * lead - p.x;
      const az = tgt.player.z + tgt.player.vel.z * lead - p.z;
      const d = Math.hypot(ax, az) || 1;
      r.ax = ax / d;
      r.az = az / d;
      r.ad = d;
    }
    const fighting = !!tgt && td < 30 && pvp.countdown <= 0;
    r.firing = fighting;
    this.rightT = (this.rightT + dt) % 1.6;
    r.charging = fighting && this.rightT < 1.4;
    if (fighting && td < 11 && h.bombCharge >= 1) g.tryBomb(h);
  }
}

// ------------------------------------------------------------------ rounds (host)

/** Build the round's PvP arena (host and clients alike). */
export function loadPvpArena(g: Game, def: PvpArenaDef, seed: number): void {
  g.scene.remove(g.arena.group);
  disposeObject(g.arena.group);
  const biome = biomeByKey(def.biome);
  g.arenaStage = 1;
  g.arena = createFieldArena(seed, biome, { layout: def.build });
  applyBiomeLook(biome);
  g.scene.add(g.arena.group);
  g.walls = new StaticBoxGrid(g.arena.colliders);
  g.enemyCtx.colliders = g.arena.colliders;
  g.barrels.load(g.arena);
  g.loadToys();
  g.chests.clear();
  g.ambience.load(biome, seed, g.arena.halfSize, (x, z) => g.walls.hitCircle(x, z, 0.5));
  g.scars.clear();
  streaks.clear();
}

/** A spawn spot nudged toward the middle until it's clear of cover. */
function clearSpot(g: Game, x: number, z: number): { x: number; z: number } {
  for (let k = 0; k < 12; k++) {
    const f = 1 - k * 0.06;
    if (!g.walls.hitCircle(x * f, z * f, 0.9)) return { x: x * f, z: z * f };
  }
  return { x, z };
}

/** Host: start the next round in the next arena: everyone up at full life, on their spawn. */
export function pvpNextRound(g: Game): void {
  const pvp = g.pvp!;
  const s = pvp2State(g);
  pvp.round++;
  const ids = PVP_ARENAS.map((a) => a.id);
  pvp.arena = arenaForRound(pvp.rules, ids, pvp.seed, pvp.round);
  const def = PVP_ARENA_BY_ID[pvp.arena];
  const arenaSeed = (pvp.seed ^ Math.imul(pvp.round, 0x2545f491)) >>> 0;
  loadPvpArena(g, def, arenaSeed);
  g.clearWorld();
  const n = g.heroes.length;
  pvp.zoneStart = zoneStartFor(def.zone, n);
  pvp.zoneR = pvp.zoneStart;
  pvp.zoneT = pvp.zoneTick = 0;
  pvp.countdown = pvpTuning.countdown;
  pvp.roundEnd = 0;
  pvp.acc = g.heroes.map(() => 0);
  pvp.lastHit = g.heroes.map(() => -1);
  pvp.landT = g.heroes.map(() => 0);
  for (const st of pvp.stats) st.out = false;
  const spawnR = def.spawnR + Math.max(0, n - 4) * 1.5;
  const spots = spawnPoints(pvp.teams, pvp.rules.format, spawnR).map((sp) => ({ ...clearSpot(g, sp.x, sp.z), ax: sp.ax, az: sp.az }));
  pvp.proxies = [];
  g.heroes.forEach((h, i) => {
    const sp = spots[i];
    if (h.left) return;
    if (h.player.dead) g.reviveHero(h, 1, false);
    h.player.hp = h.player.maxHp;
    h.player.teleport(sp.x, sp.z);
    h.player.setAimDir(sp.ax, sp.az);
    h.remote = null;
    h.bombCharge = pvpTuning.specialStart;
    h.bombT = -1;
    h.phoenixUsed = false;
    const e = g.enemies.spawn(PVP_TARGET, sp.x, sp.z, { instant: true });
    e.pvpOwner = h.index;
    pvp.proxies[h.index] = e;
  });
  // Bots: one brain per bot hero.
  s.bots.clear();
  for (const h of g.heroes) if (isBotPeer(h.peerId)) s.bots.set(h.index, new BotBrain(pvp.seed + h.index * 977));
  g.host?.broadcast({ t: 'p2round', arena: pvp.arena, seed: arenaSeed, round: pvp.round, spawns: spots.map((sp) => [r2(sp.x), r2(sp.z), r2(sp.ax), r2(sp.az)]) });
  const final = finalRound(pvp.wins, pvp.rules, pvp.round - 1);
  g.vfx.banner(final && pvp.rules.rounds === 3 && pvp.round > 1 ? 'FINAL ROUND' : pvp.rules.rounds === 3 ? `ROUND ${pvp.round}` : 'DUEL!', `${def.name.toUpperCase()}<br>${def.blurb}`, 2.8);
  s.board = null;
}

/** Host: the round is decided: tally, scoreboard, then the next round or the match end. */
export function pvpRoundOver(g: Game, team: number): void {
  const pvp = g.pvp!;
  if (team >= 0) pvp.wins[team] = (pvp.wins[team] ?? 0) + 1;
  const m = matchState(pvp.wins, pvp.rules, pvp.round);
  pvp.roundEnd = pvpTuning.roundEnd;
  pvp.done = m.over;
  const board = makeBoard(g, team, m.over, m.winner);
  g.host?.broadcast({ t: 'p2board', board });
  showBoard(g, board);
  g.vfx.sound('jingle', NaN, NaN);
}

function teamLabel(g: Game, team: number): string {
  const pvp = g.pvp!;
  if (pvp.rules.format === 'teams') return `TEAM ${TEAM_NAMES[team] ?? team + 1}`;
  return (g.heroes[team]?.name ?? 'NOBODY').toUpperCase();
}

function makeBoard(g: Game, team: number, over: boolean, winner: number): Board {
  const pvp = g.pvp!;
  return {
    round: pvp.round,
    team,
    wins: [...pvp.wins],
    over,
    winner,
    format: pvp.rules.format,
    rounds: pvp.rules.rounds,
    rows: g.heroes.map((h) => ({
      i: h.index,
      n: h.name,
      c: h.color,
      t: pvp.teams[h.index] ?? h.index,
      k: pvp.stats[h.index]?.kos ?? 0,
      d: Math.round(pvp.stats[h.index]?.dealt ?? 0),
      out: h.player.dead || h.left,
    })),
  };
}

/** Host step inside updateDuel: bots, the round clock, slower specials. */
export function pvpDuelStep(g: Game, dt: number): void {
  const pvp = g.pvp!;
  const s = pvp2State(g);
  for (const [i, b] of s.bots) {
    const h = g.heroes[i];
    if (h) b.step(g, h, dt);
  }
  // Specials recharge slower in a duel (the meter already moved this step: take part of it back).
  const back = 1 - 1 / pvpTuning.specialCdMul;
  for (const h of g.heroes) {
    if (h.player.dead || h.left || h.bombT >= 0 || h.bombCharge >= 1) continue;
    h.bombCharge = Math.max(0, h.bombCharge - (dt / h.specialCooldown) * back);
  }
  if (pvp.countdown > 0) {
    pvp.countdown = Math.max(0, pvp.countdown - dt);
    for (const h of g.heroes) h.player.invuln = Math.max(h.player.invuln, 0.1);
  }
  if (pvp.roundEnd > 0) {
    pvp.roundEnd -= dt;
    if (pvp.roundEnd <= 0) {
      pvp.roundEnd = 0;
      if (pvp.done) {
        const b = s.board;
        const name = b && b.winner >= 0 ? teamLabel(g, b.winner) : '';
        g.host?.broadcast({ t: 'pvpend', winner: name, team: b?.winner ?? -1 });
        g.pvpOver(name, b?.winner ?? -1);
      } else pvpNextRound(g);
    }
  }
}

/** Everyone: victory / defeat / draw voice when the match ends (`team` -2 = unknown: the old single-duel message). */
export function pvpMatchEndFx(g: Game, team: number): void {
  const pvp = g.pvp;
  if (!pvp) return;
  const mine = pvp.teams[g.local] ?? g.local;
  const id = team === -2 ? '' : team < 0 ? 'vo_draw' : team === mine ? 'vo_victory' : 'vo_defeat';
  if (id) say(id, id === 'vo_draw' ? 'Draw!' : id === 'vo_victory' ? 'Victory!' : 'Defeat!');
  playSample(team === mine ? 'victory_fanfare' : 'defeat_sting', 0.6);
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ------------------------------------------------------------------ net

/** Host: duel state for the snapshot (`p2`); null outside a duel. */
export function pvp2Net(g: Game): NetP2 | null {
  const pvp = g.pvp;
  if (!pvp || pvp.phase !== 'duel') return null;
  return {
    r: pvp.round,
    w: pvp.wins,
    tm: pvp.teams,
    z: r2(pvp.zoneR),
    zs: r2(pvp.zoneStart),
    zt: r2(pvp.zoneT),
    cd: r2(pvp.countdown),
    re: r2(pvp.roundEnd),
    f: pvp.rules.format === 'teams' ? 1 : 0,
    bo: pvp.rules.rounds,
    a: pvp.arena,
  };
}

/** Client: mirror the host's duel state. */
export function applyPvp2Net(g: Game, v: unknown): void {
  const pvp = g.pvp;
  if (!pvp || !v || typeof v !== 'object') return;
  const n = v as NetP2;
  pvp2State(g).net = n;
  pvp.round = n.r;
  pvp.wins = n.w ?? pvp.wins;
  pvp.teams = n.tm ?? pvp.teams;
  pvp.zoneR = n.z;
  pvp.zoneStart = n.zs;
  pvp.zoneT = n.zt;
  pvp.countdown = n.cd;
  pvp.roundEnd = n.re;
  pvp.arena = n.a;
  pvp.rules = { ...pvp.rules, format: n.f ? 'teams' : 'ffa', rounds: n.bo === 1 ? 1 : 3 };
}

/** Client: pvp2 messages. True when handled. */
export function pvp2ClientMessage(g: Game, m: Record<string, unknown>): boolean {
  const s = pvp2State(g);
  switch (m.t) {
    case 'p2lobby':
      s.rules = cleanRules(m.rules, PVP_ARENAS.map((a) => a.id));
      renderLobbyBox(g);
      return true;
    case 'p2round': {
      const pvp = g.pvp;
      const def = PVP_ARENA_BY_ID[String(m.arena)];
      if (!pvp || !def) return true;
      pvp.arena = def.id;
      pvp.round = Number(m.round) || 1;
      loadPvpArena(g, def, Number(m.seed) >>> 0);
      g.clearWorld();
      const spawns = (m.spawns as number[][]) ?? [];
      g.heroes.forEach((h, i) => {
        const sp = spawns[i];
        if (!sp) return;
        h.player.teleport(sp[0], sp[1]);
        h.player.setAimDir(sp[2], sp[3]);
      });
      s.board = null;
      s.freeCam = false;
      return true;
    }
    case 'p2board':
      showBoard(g, m.board as Board);
      return true;
  }
  return false;
}

// ------------------------------------------------------------------ lobby

/** Host lobby rows: format, rounds, arena and bots (PvP only). Hooked into the screens' onLobby chain. */
export function installPvp2(g: Game): void {
  const prev = g.screens.onLobby;
  g.screens.onLobby = (el, v) => {
    prev?.(el, v);
    lobbyRows(g, el, v);
  };
}

let lobbyEl: HTMLElement | null = null;
let lobbyView: LobbyView | null = null;

function lobbyRows(g: Game, el: HTMLElement, v: LobbyView): void {
  lobbyEl = el;
  lobbyView = v;
  // PvP lobbies take up to 8 (free-for-all); co-op and Versus keep 4.
  const host = g.host as unknown as { max?: number } | null;
  if (host && v.isHost) host.max = v.kind === 'pvp' ? PVP_MAX_PLAYERS - 1 : 3;
  if (v.isHost && v.kind === 'pvp' && g.host) g.host.broadcast({ t: 'p2lobby', rules: pvp2State(g).rules });
  if (v.isHost && v.kind !== 'pvp' && g.lobby.some((p) => isBotPeer(p.peerId))) {
    g.lobby = g.lobby.filter((p) => !isBotPeer(p.peerId)); // bots only play PvP
    queueMicrotask(() => g.refreshLobby());
  }
  renderLobbyBox(g);
}

function renderLobbyBox(g: Game): void {
  const el = lobbyEl;
  const v = lobbyView;
  if (!el || !v) return;
  ensureCss();
  let box = el.querySelector<HTMLElement>('.p2-x');
  if (!box) {
    el.querySelector('.mp-kind-note')?.insertAdjacentHTML('afterend', '<div class="p2-x"></div>');
    box = el.querySelector<HTMLElement>('.p2-x');
    if (!box) return;
    box.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-p2]');
      if (!b || g.role !== 'host') return;
      const [k, val] = (b.dataset.p2 ?? '').split('=');
      if (k === 'format') setPvpRules(g, { format: val === 'teams' ? 'teams' : 'ffa' });
      else if (k === 'rounds') setPvpRules(g, { rounds: val === '1' ? 1 : 3 });
      else if (k === 'arena') setPvpRules(g, { arena: val });
      else if (k === 'bot') (val === 'add' ? addPvpBot(g) : removePvpBot(g));
      g.refreshLobby();
    });
  }
  if (v.kind !== 'pvp' || (!v.code && !v.players.length)) {
    box.innerHTML = '';
    return;
  }
  const r = pvp2State(g).rules;
  const host = v.isHost;
  const btn = (key: string, label: string, on: boolean) =>
    `<button ${host ? 'data-nav' : 'disabled'} data-p2="${key}" class="diff ${on ? 'on' : ''}">${label}</button>`;
  const bots = g.lobby.filter((p) => isBotPeer(p.peerId)).length;
  const parts = [
    `<div class="section">FORMAT</div><div class="menu row diff-row">${btn('format=ffa', 'FREE-FOR-ALL', r.format === 'ffa')}${btn('format=teams', '2 TEAMS', r.format === 'teams')}${btn('rounds=1', 'ONE ROUND', r.rounds === 1)}${btn('rounds=3', 'BEST OF 3', r.rounds === 3)}</div>`,
    `<div class="section">ARENA</div><div class="menu row diff-row">${btn('arena=rotate', 'ROTATE', r.arena === 'rotate')}${PVP_ARENAS.map((a) => btn(`arena=${a.id}`, a.name.toUpperCase(), r.arena === a.id)).join('')}</div>`,
  ];
  if (host) parts.push(`<div class="menu row diff-row">${btn('bot=add', '+ ADD BOT', false)}${bots ? btn('bot=remove', '- REMOVE BOT', false) : ''}</div>`);
  const n = v.players.length;
  const teamNote = r.format === 'teams' ? (n % 2 ? ' Teams are uneven: alternate players join BLUE and ORANGE.' : ' Players alternate BLUE / ORANGE in lobby order. Friendly fire is off.') : '';
  parts.push(`<div class="note">${pvpRulesNote(r)} · UP TO ${PVP_MAX_PLAYERS} PLAYERS.${teamNote}</div>`);
  const html = localizeHtml(parts.join(''));
  if (box.innerHTML !== html) box.innerHTML = html;
}

// ------------------------------------------------------------------ presentation (every machine)

const CSS = `
#pvp2-hud{position:absolute;top:calc(24*var(--p));left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:calc(2*var(--p));pointer-events:none;z-index:6;font-family:var(--font);color:var(--white);text-shadow:var(--outline)}
#pvp2-hud[hidden]{display:none}
#pvp2-hud .rnd{font-family:var(--label);font-size:calc(4*var(--p));padding:calc(1*var(--p)) calc(3*var(--p));--bg:var(--night)}
#pvp2-hud .pips{display:flex;gap:calc(3*var(--p));align-items:center;font-family:var(--display);font-size:calc(7*var(--p))}
#pvp2-hud .pips b{display:inline-flex;align-items:center;gap:calc(1*var(--p))}
#pvp2-hud .pips i{display:inline-block;width:calc(3*var(--p));height:calc(3*var(--p));background:var(--ink);box-shadow:0 0 0 var(--p) var(--ink)}
#pvp2-hud .pips i.on{background:var(--c)}
#pvp2-hud .zone{font-family:var(--label);font-size:calc(3.5*var(--p));color:var(--yellow)}
#pvp2-hud .zone.hot{color:var(--red);animation:p2blink .5s steps(2) infinite}
#pvp2-big{position:absolute;top:64%;left:50%;transform:translate(-50%,-50%);font-family:var(--display);font-size:calc(34*var(--p));color:var(--yellow);text-shadow:var(--outline);pointer-events:none;z-index:7}
#pvp2-big[hidden]{display:none}
#pvp2-big.fight{color:var(--white);animation:p2pop .45s steps(4) both}
#pvp2-spec{position:absolute;bottom:calc(16*var(--p));left:50%;transform:translateX(-50%);font-family:var(--font);font-size:calc(6*var(--p));padding:calc(2*var(--p)) calc(5*var(--p));text-align:center;pointer-events:none;z-index:6;color:var(--white);text-shadow:var(--outline)}
#pvp2-spec[hidden]{display:none}
#pvp2-spec small{display:block;font-family:var(--label);font-size:calc(3.5*var(--p));color:var(--mist)}
#pvp2-board{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);min-width:calc(150*var(--p));max-width:calc(100vw - 32px);padding:calc(5*var(--p)) calc(7*var(--p));pointer-events:none;z-index:8;font-family:var(--font);color:var(--white);--bg:var(--ink);--hi:var(--night);--lo:#000;--ring:var(--yellow)}
#pvp2-board[hidden]{display:none}
#pvp2-board h2{margin:0 0 calc(1*var(--p));font-family:var(--display);font-size:calc(13*var(--p));color:var(--yellow);text-align:center;text-shadow:var(--outline);font-weight:normal}
#pvp2-board .sub{text-align:center;font-family:var(--label);font-size:calc(3.5*var(--p));color:var(--mist);margin-bottom:calc(3*var(--p))}
#pvp2-board table{width:100%;border-collapse:collapse;font-size:calc(6*var(--p))}
#pvp2-board th{font-family:var(--label);font-size:calc(3*var(--p));color:var(--mist);font-weight:normal;text-align:end;padding:0 calc(2*var(--p))}
#pvp2-board th:first-child,#pvp2-board td:first-child{text-align:start}
#pvp2-board td{padding:calc(.5*var(--p)) calc(2*var(--p));text-align:end}
#pvp2-board td .dot{display:inline-block;width:calc(3*var(--p));height:calc(3*var(--p));background:var(--c);margin-inline-end:calc(2*var(--p));box-shadow:0 0 0 var(--p) var(--ink)}
#pvp2-board tr.out td{color:var(--slate)}
#pvp2-board tr.win td{color:var(--yellow)}
#pvp2-board .tb{font-family:var(--label);font-size:calc(3*var(--p));color:var(--t)}
.p2-x .section{margin-top:calc(2*var(--p))}
body.pvp2-duel #timer,body.pvp2-duel #downed,body.pvp2-duel #ultpip,body.pvp2-duel #rewindpip,body.pvp2-duel #tags .rv{display:none!important}
@keyframes p2blink{50%{opacity:.35}}
@keyframes p2pop{0%{transform:translate(-50%,-50%) scale(2)}100%{transform:translate(-50%,-50%) scale(1)}}
`;
let cssDone = false;
function ensureCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
}

function ensureUi(g: Game, s: Pvp2State): void {
  if (s.hud && s.hud.isConnected) return;
  ensureCss();
  const root = document.getElementById('hud') ?? document.body;
  const mk = (id: string, cls = '') => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      if (cls) el.className = cls;
      el.hidden = true;
      root.appendChild(el);
    }
    return el;
  };
  s.hud = mk('pvp2-hud');
  s.big = mk('pvp2-big');
  s.spec = mk('pvp2-spec', 'px');
  s.boardEl = mk('pvp2-board', 'px');
  void g;
}

function showBoard(g: Game, b: Board | null): void {
  const s = pvp2State(g);
  s.board = b;
  s.boardT = b ? 1 : 0;
  if (!b) return;
  ensureUi(g, s);
  const el = s.boardEl!;
  const team = b.format === 'teams';
  const winTeam = b.over ? b.winner : b.team;
  const name = (t: number) => (team ? `TEAM ${TEAM_NAMES[t] ?? t + 1}` : (b.rows.find((r) => r.t === t)?.n ?? '').toUpperCase());
  const title = b.over ? (b.winner >= 0 ? `${name(b.winner)} WINS!` : 'DRAW!') : b.team >= 0 ? `${name(b.team)} TAKES ROUND ${b.round}` : `ROUND ${b.round} · DRAW`;
  const sub = b.over ? 'MATCH OVER' : b.team < 0 ? 'NOBODY LEFT STANDING · NO POINT' : b.rounds === 3 ? `FIRST TO ${pvpTuning.roundsToWin} · NEXT ROUND SOON` : '';
  const rows = [...b.rows].sort((a, c) => (b.wins[c.t] ?? 0) - (b.wins[a.t] ?? 0) || c.k - a.k || c.d - a.d);
  const body = rows
    .map((r) => {
      const tb = team ? ` <span class="tb" style="--t:${TEAM_COLORS[r.t]}">${TEAM_NAMES[r.t]}</span>` : '';
      return `<tr class="${r.t === winTeam ? 'win' : ''} ${r.out ? 'out' : ''}"><td><span class="dot" style="--c:${r.c}"></span><bdi>${esc(r.n)}</bdi>${tb}</td><td>${b.wins[r.t] ?? 0}</td><td>${r.k}</td><td>${r.d}</td></tr>`;
    })
    .join('');
  el.innerHTML = localizeHtml(`<h2>${esc(title)}</h2><div class="sub">${sub}</div><table><tr><th>PLAYER</th><th>ROUNDS</th><th>KOS</th><th>DAMAGE</th></tr>${body}</table>`);
  el.hidden = false;
  playSample('round_bell', 0.7);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function playSample(id: string, gain: number): void {
  try {
    samples.play(id, { bus: 'ui', gain, variation: 0, limit: 1, priority: 9 });
  } catch {
    /* audio not started */
  }
}

function say(id: string, text: string): void {
  try {
    const v = samples.play(id, { bus: 'ui', gain: 0.85, variation: 0, limit: 1, priority: 18 });
    if (v) voiceGate.claim(18, v.duration, () => v.stop());
  } catch {
    /* audio not started */
  }
  caption({ who: 'ANNOUNCER', text, color: '#ffcd75', kind: 'announcer' });
}

function ensureZone(g: Game, s: Pvp2State): THREE.Group {
  if (s.zoneMesh) {
    if (!s.zoneMesh.parent) g.scene.add(s.zoneMesh);
    return s.zoneMesh;
  }
  const grp = new THREE.Group();
  const wallMat = createRetroMaterial({ color: '#7a2236', unlit: 1, transparent: true, side: THREE.DoubleSide });
  const floorMat = createRetroMaterial({ color: '#3a0f1c', unlit: 1, transparent: true });
  const lineMat = createRetroMaterial({ color: ZONE_COLOR, unlit: 1 });
  for (const m of [wallMat, floorMat]) {
    m.blending = THREE.AdditiveBlending;
    m.depthWrite = false;
  }
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3.2, 64, 1, true), wallMat);
  wall.position.y = 1.6;
  wall.renderOrder = 2;
  const floor = new THREE.Mesh(new THREE.RingGeometry(1, 6, 64).rotateX(-Math.PI / 2), floorMat);
  floor.position.y = 0.06;
  floor.renderOrder = 1;
  const line = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 64).rotateX(-Math.PI / 2), lineMat);
  line.position.y = 0.07;
  grp.add(wall, floor, line);
  grp.userData.parts = { wall, floor, line };
  g.scene.add(grp);
  s.zoneMesh = grp;
  return grp;
}

function teamRing(g: Game, s: Pvp2State, i: number): THREE.Mesh {
  let m = s.teamRings[i];
  if (!m) {
    m = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.95, 20).rotateX(-Math.PI / 2), createRetroMaterial({ color: '#ffffff', unlit: 1 }));
    m.position.y = 0.05;
    s.teamRings[i] = m;
  }
  if (!m.parent) g.scene.add(m);
  return m;
}

/** Every render frame (any role), before the camera rig: ring, team rings, HUD, voice cues and the spectator camera. */
export function pvp2Frame(g: Game, frameDt: number): void {
  const pvp = g.pvp;
  const s = pvp2State(g);
  const duel = !!pvp && (pvp.phase === 'duel' || pvp.phase === 'over') && g.isCombatMode;
  document.body.classList.toggle('pvp2-duel', duel);
  if (!duel) {
    if (s.zoneMesh?.parent) s.zoneMesh.parent.remove(s.zoneMesh);
    for (const m of s.teamRings) m?.parent?.remove(m);
    if (s.hud && !s.hud.hidden) s.hud.hidden = true;
    if (s.big && !s.big.hidden) s.big.hidden = true;
    if (s.spec && !s.spec.hidden) s.spec.hidden = true;
    if (s.boardEl && !s.boardEl.hidden) s.boardEl.hidden = true;
    s.lastRound = 0;
    s.lastCd = -1;
    return;
  }
  ensureUi(g, s);
  // The ring.
  const z = ensureZone(g, s);
  const r = Math.max(0.01, pvp.zoneR);
  z.scale.set(r, 1, r);
  z.visible = pvp.zoneR < 60;
  // Team rings (2 teams only).
  const teams = pvp.rules.format === 'teams';
  g.heroes.forEach((h, i) => {
    if (!teams) return void s.teamRings[i]?.parent?.remove(s.teamRings[i]);
    const m = teamRing(g, s, i);
    const root = h.player.rig.root;
    m.visible = !h.left && !h.player.dead && root.visible;
    m.position.set(root.position.x, 0.05, root.position.z);
    (m.material as unknown as { uniforms: { uColor: { value: THREE.Color } } }).uniforms.uColor.value.set(TEAM_COLORS[pvp.teams[i]] ?? '#ffffff');
  });
  // Round start: bell and voice.
  if (pvp.round !== s.lastRound && pvp.round > 0) {
    s.lastRound = pvp.round;
    s.freeCam = false;
    playSample('round_bell', 0.8);
    const final = pvp.rules.rounds === 3 && pvp.round > 1 && finalRound(pvp.wins, pvp.rules, pvp.round - 1);
    say(final ? 'vo_final_round' : 'vo_round_fight', final ? 'Final round!' : 'Round... fight!');
  }
  // 3-2-1 FIGHT.
  const big = s.big!;
  const cd = Math.ceil(pvp.countdown);
  if (pvp.countdown > 0) {
    if (cd !== s.lastCd) {
      s.lastCd = cd;
      big.textContent = String(cd);
      big.className = '';
      big.hidden = false;
    }
  } else if (s.lastCd > 0) {
    s.lastCd = 0;
    big.textContent = localize('FIGHT!');
    big.className = 'fight';
    big.hidden = false;
    window.setTimeout(() => {
      if (s.lastCd === 0) big.hidden = true;
    }, 700);
  }
  // Top strip: round, wins, ring.
  const hud = s.hud!;
  const nTeams = pvp.wins.length;
  const label = pvp.rules.rounds === 3 ? `ROUND ${pvp.round} · FIRST TO ${pvpTuning.roundsToWin}` : 'ONE ROUND · LAST ONE STANDING';
  const left = new Set(g.heroes.filter((h) => !h.left && !h.player.dead).map((h) => pvp.teams[h.index])).size;
  const sudden = suddenDeathAt(pvp.zoneStart);
  const zoneTxt =
    pvp.countdown > 0 || pvp.roundEnd > 0
      ? ''
      : pvp.zoneT < pvpTuning.zoneDelay
        ? `RING CLOSES IN ${Math.ceil(pvpTuning.zoneDelay - pvp.zoneT)}`
        : pvp.zoneT < sudden
          ? 'RING CLOSING'
          : 'SUDDEN DEATH';
  const pips = Array.from({ length: nTeams }, (_, t) => {
    const color = teams ? TEAM_COLORS[t] : g.heroes[t]?.color ?? HERO_COLORS[t % HERO_COLORS.length];
    const need = pvp.rules.rounds === 3 ? pvpTuning.roundsToWin : 1;
    const cells = Array.from({ length: need }, (_, k) => `<i class="${k < (pvp.wins[t] ?? 0) ? 'on' : ''}"></i>`).join('');
    return `<b style="--c:${color};color:${color}">${cells}</b>`;
  }).join('');
  const key = `${label}|${pips}|${zoneTxt}|${left}`;
  if (key !== s.lastKey) {
    s.lastKey = key;
    hud.innerHTML = localizeHtml(`<div class="rnd px">${label} · ${teams ? `${left} TEAMS LEFT` : `${left} LEFT`}</div><div class="pips">${pips}</div>${zoneTxt ? `<div class="zone ${zoneTxt === 'SUDDEN DEATH' ? 'hot' : ''}">${zoneTxt}</div>` : ''}`);
  }
  hud.hidden = false;
  // Scoreboard timeout.
  if (s.board) {
    s.boardT -= frameDt;
    // Shown while the host's round-end clock runs (synced), plus a moment's grace for the message arriving first.
    if (s.boardT <= 0 && pvp.roundEnd <= 0 && pvp.phase !== 'over') {
      s.board = null;
      s.boardEl!.hidden = true;
    }
  } else if (s.boardEl && !s.boardEl.hidden) s.boardEl.hidden = true;
  spectate(g, s, frameDt);
}

/** Knocked out: watch someone (click / A cycles, as in co-op) or fly a free camera (DASH toggles, move pans). */
function spectate(g: Game, s: Pvp2State, frameDt: number): void {
  const me = g.hero;
  const spec = s.spec!;
  const pvp = g.pvp!;
  if (!me.player.dead || pvp.phase !== 'duel' || g.screens.current !== 'none') {
    if (!spec.hidden) spec.hidden = true;
    if (!me.player.dead) s.freeCam = false;
    return;
  }
  const input = g.input;
  if (input.actionPressed('dash') || input.padButtonPressed(4) || input.padButtonPressed(6)) {
    s.freeCam = !s.freeCam;
    s.camX = g.playerPos.x;
    s.camZ = g.playerPos.z;
  }
  if (input.mousePressed(0) || input.padButtonPressed(0) || input.actionPressed('ping')) s.freeCam = false; // the co-op handler cycles who you watch
  const watch = g.spectateTarget();
  if (s.freeCam || !watch) {
    if (!s.freeCam) {
      s.freeCam = true;
      s.camX = g.playerPos.x;
      s.camZ = g.playerPos.z;
    }
    const sp = 16 * frameDt;
    s.camX = Math.max(-45, Math.min(45, s.camX + input.move.x * sp));
    s.camZ = Math.max(-45, Math.min(45, s.camZ + input.move.y * sp));
    g.playerPos.set(s.camX, 0, s.camZ);
    g.lead.set(0, 0, 0);
  }
  const who = !s.freeCam && watch ? g.heroes.find((h) => h.player === watch) : null;
  const html = localizeHtml(
    `YOU'RE OUT · ${who ? `WATCHING <bdi>${esc(who.name.toUpperCase())}</bdi>` : 'FREE CAMERA'}<small>${prompt('fire')} NEXT PLAYER · ${prompt('dash')} FREE CAMERA${s.freeCam ? ` · ${prompt('move')} MOVE` : ''}</small>`,
  );
  if (spec.innerHTML !== html) spec.innerHTML = html;
  spec.hidden = false;
}
