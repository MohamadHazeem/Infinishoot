/**
 * Race lane: competitive extras. Rules live in src/game/raceRules.ts and
 * src/data/ranked.ts; the screens and HUD in src/ui/raceUi.ts.
 *
 * - RACE (online lobby GAME: RACE, 2-8 players): every machine plays the same
 *   seeded stage as a plain solo run (like PvP's stage: `role` 'solo' while the
 *   connection stays open). Clients report progress (`rcp`) twice a second; the
 *   host shares the board (`rcb`) and ends the race (`rcend`) when someone beats
 *   the boss, nobody is left racing or the clock runs out.
 * - CHALLENGE A FRIEND: a finished solo run becomes a short code; pasting it
 *   plays the same seed, mode, difficulty, hero and loadout with the friend's
 *   score to beat on the HUD.
 * - LOCAL TOURNAMENT: hot-seat race turns on one PC (`net` 'local'), or online
 *   matches recorded by hand / automatically from race and PvP results.
 * - RANKED: rating changes after online race and PvP results; lobby cards show
 *   rank badges (`rkme` client -> host, `rkl` host -> all).
 *
 * Per-Game UI state lives in a WeakMap; Game only gains the `race` field.
 * Shared-file hooks: game.ts (field, install, raceTick), screens.ts (ids, kind),
 * netClient.ts (kind parse), peer.ts (setMax), save.ts (`ranked`). Everything
 * else is chained onto Game methods at install time (endRun, leaveToTitle,
 * hostStart, refreshLobby, onHostMessage, onClientMessage, onClientLeft,
 * pvpOver, bankAndShow, startRun).
 */
import type { Game } from '../game';
import { cheats, playerName } from '../game';
import { HERO_COLORS } from '../hero';
import { persist, save, saveLock } from '../save';
import { settings } from '../settings';
import { randomSeed } from '../../core/rng';
import { loadJson, saveJson } from '../../core/storage';
import { samples } from '../../audio/samples';
import { caption } from '../../audio/captions';
import { sfx } from '../../audio/sfx';
import { applyMatch, rankedTuning, rollSeason, tierOf } from '../../data/ranked';
import { rankedLadder } from '../../net/rankedBoard';
import { HEROES } from '../../data/heroes';
import {
  CHALLENGE_MODES,
  autoRecord,
  cleanRow,
  cleanTourney,
  encodeChallenge,
  matchSeed,
  raceOver,
  raceProgress,
  raceTuning,
  recordTurn,
  standings,
  type Challenge,
  type ChallengeMode,
  type RaceRow,
  type Tourney,
  type TurnResult,
} from '../raceRules';
import { RaceUi } from '../../ui/raceUi';
import type { RunSummary } from '../../ui/screens';

/** Colours for racers 5-8 (the first four match co-op's hero colours). */
const EXTRA_COLORS = ['#ef7d57', '#b13e53', '#73eff7', '#a7f070'];
export function raceColor(i: number): string {
  return HERO_COLORS[i] ?? EXTRA_COLORS[(i - HERO_COLORS.length) % EXTRA_COLORS.length];
}

/** This machine's race (Game.race). */
export interface RaceRun {
  /** host / client: an online race; local: a hot-seat tournament turn. */
  net: 'host' | 'client' | 'local';
  seed: number;
  difficulty: string;
  /** Racers in lobby order; `you` is this machine's row. */
  rows: RaceRow[];
  you: number;
  /** Race clock (seconds since the start, menus included; clients follow the host's). */
  clock: number;
  limit: number;
  phase: 'run' | 'over';
  /** Host: lobby peer id per row. */
  peers: string[];
  reportT: number;
  goSaid: boolean;
  finalSaid: boolean;
  /** Final standings once over. */
  final: { row: RaceRow; place: number }[] | null;
  /** Ranked result for this machine (online races only). */
  rating: { delta: number; after: number; tierUp: boolean; tierDown: boolean } | null;
  /** Hot-seat: who plays and what happens with the result. */
  onDone?: (r: TurnResult) => void;
}

interface RaceLaneState {
  ui: RaceUi;
  /** Host: ranked ratings by lobby peer id ('' = host). Clients: the host's list. */
  ranks: Map<string, number>;
  lobbyRanks: { n: string; r: number }[];
  /** The client connection we already sent our rating to. */
  rankSentTo: unknown;
  /** Active challenge for the current run. */
  chal: Challenge | null;
  chalPassed: boolean;
  /** Set while startChallenge runs startRun (so the startRun hook keeps the challenge). */
  starting: boolean;
  /** Last banked summary (for the challenge code on game over). */
  lastSum: RunSummary | null;
  /** The last run's challenge code ('' = that run can't make one) and the challenge it answered. */
  lastCode: string;
  lastChal: Challenge | null;
  lastHeat: boolean;
  tourney: Tourney | null;
  /** Hot-seat: the match being played. */
  turn: { round: number; match: number; side: 'a' | 'b' } | null;
  hudT: number;
}

const states = new WeakMap<Game, RaceLaneState>();
export function raceState(g: Game): RaceLaneState | undefined {
  return states.get(g);
}

const TOURNEY_KEY = 'tourney.v1';

// ---------------------------------------------------------------- audio

/** Announcer-style line on the UI bus with a caption (the announcer's own list doesn't know these lines). */
export function raceSay(id: string, text: string): void {
  if (saveLock.on) return;
  samples.play(id, { bus: 'ui', priority: 18, gain: 0.85, variation: 0, limit: 1 });
  caption({ who: 'ANNOUNCER', text, color: '#ffcd75', kind: 'announcer' });
}
export function raceSting(id: 'victory_fanfare' | 'defeat_sting' | 'trophy'): void {
  if (saveLock.on) return;
  if (!samples.play(id, { bus: 'ui', priority: 16, gain: 0.8, variation: 0, limit: 1 }) && id !== 'defeat_sting') sfx.legendaryPick();
}

// ---------------------------------------------------------------- install

/** Build the race lane's screens and HUD, and chain its hooks onto Game (Game constructor). */
export function installRace(g: Game, root: HTMLElement): void {
  const st: RaceLaneState = {
    ui: null as unknown as RaceUi,
    ranks: new Map(),
    lobbyRanks: [],
    rankSentTo: null,
    chal: null,
    chalPassed: false,
    starting: false,
    lastSum: null,
    lastCode: '',
    lastChal: null,
    lastHeat: false,
    tourney: cleanTourney(loadJson<unknown>(TOURNEY_KEY, null)),
    turn: null,
    hudT: 0,
  };
  states.set(g, st);
  st.ui = new RaceUi(root, g);

  const endRun = g.endRun;
  g.endRun = function (this: Game, quit = false) {
    if (this.race && this.race.phase === 'run') return raceRunEnded(this, quit);
    return endRun.call(this, quit);
  };
  const leave = g.leaveToTitle;
  g.leaveToTitle = function (this: Game) {
    this.race = null;
    st.chal = null;
    st.turn = null;
    st.lobbyRanks = [];
    st.ranks.clear();
    st.rankSentTo = null;
    if (this.host) this.host.setMax?.(3);
    return leave.call(this);
  };
  const startRun = g.startRun;
  g.startRun = function (this: Game, fixed?: { seed: number; difficulty: string }) {
    if (!st.starting) st.chal = null; // retries and new runs drop the challenge
    st.chalPassed = false;
    return startRun.call(this, fixed);
  };
  const hostStart = g.hostStart;
  g.hostStart = function (this: Game) {
    if (this.role !== 'host' || !this.host) return;
    if (this.lobbyKind === 'race') return raceHostStart(this);
    if (this.lobby.length > 4 && !['pvp', 'raid'].includes(this.lobbyKind)) {
      this.hud.toast(`ONLY RACE, PVP AND RAID TAKE MORE THAN 4 PLAYERS (${this.lobby.length} HERE)`, 3);
      return;
    }
    return hostStart.call(this);
  };
  const refresh = g.refreshLobby;
  g.refreshLobby = function (this: Game) {
    this.host?.setMax?.(['race', 'pvp', 'raid'].includes(this.lobbyKind) ? 7 : 3);
    refresh.call(this);
    if (!this.host) return;
    st.ranks.set('', save.ranked.rating);
    const l = this.lobby.map((p) => ({ n: p.name, r: st.ranks.get(p.peerId) ?? -1 }));
    st.lobbyRanks = l;
    this.host.broadcast({ t: 'rkl', l });
    st.ui.decorateLobby();
  };
  const onHost = g.onHostMessage;
  g.onHostMessage = function (this: Game, from: string, m: Record<string, unknown>) {
    if (raceHostMessage(this, from, m)) return;
    return onHost.call(this, from, m);
  };
  const onClient = g.onClientMessage;
  g.onClientMessage = function (this: Game, m: Record<string, unknown>) {
    if (raceClientMessage(this, m)) return;
    return onClient.call(this, m);
  };
  const left = g.onClientLeft;
  g.onClientLeft = function (this: Game, id: string) {
    st.ranks.delete(id);
    const R = this.race;
    if (R && R.net === 'host') {
      const i = R.peers.indexOf(id);
      if (i > 0 && R.rows[i] && R.rows[i].s !== 'done' && R.rows[i].s !== 'ko') {
        R.rows[i].s = 'left';
        R.rows[i].t = R.clock;
        this.hud.toast(`${R.rows[i].n.toUpperCase()} LEFT THE RACE`, 3);
      }
      this.lobby = this.lobby.filter((p) => p.peerId !== id);
      return;
    }
    return left.call(this, id);
  };
  const pvpOver = g.pvpOver;
  g.pvpOver = function (this: Game, winner: string) {
    if (this.pvp && this.pvp.phase !== 'over') pvpRated(this, winner);
    return pvpOver.call(this, winner);
  };
  const bank = g.bankAndShow;
  g.bankAndShow = function (this: Game, sum: RunSummary, quit = false) {
    if (!this.meta.banked) noteRunForChallenge(this, sum);
    return bank.call(this, sum, quit);
  };
  const prevShow = g.screens.onShow;
  g.screens.onShow = (name) => {
    prevShow?.(name);
    if (name === 'gameover') st.ui.onGameOver();
    if (name === 'online') st.ui.decorateLobby();
  };
  const prevLobby = g.screens.onLobby;
  g.screens.onLobby = (el, v) => {
    prevLobby?.(el, v);
    st.ui.decorateLobby();
  };
}

// ---------------------------------------------------------------- race flow

/** Host: everyone in the lobby races the same seed. */
export function raceHostStart(g: Game): void {
  if (!g.host) return;
  if (g.lobby.length < 2) {
    g.hud.toast('RACE NEEDS AT LEAST 2 PLAYERS', 2.5);
    return;
  }
  const seed = randomSeed();
  const difficulty = g.lobbyDifficulty().id;
  const names = g.lobby.map((p) => p.name);
  const ranks = g.lobby.map((p) => (p.peerId ? states.get(g)?.ranks.get(p.peerId) ?? -1 : save.ranked.rating));
  g.lobby.forEach((p, i) => {
    if (p.peerId) g.host!.send(p.peerId, { t: 'rcgo', seed, difficulty, names, ranks, you: i, limit: raceTuning.limit });
  });
  raceBegin(g, { net: 'host', seed, difficulty, names, ranks, you: 0, peers: g.lobby.map((p) => p.peerId) });
}

export interface RaceStart {
  net: RaceRun['net'];
  seed: number;
  difficulty: string;
  names: string[];
  ranks?: number[];
  you: number;
  peers?: string[];
  limit?: number;
  banner?: [string, string];
  onDone?: (r: TurnResult) => void;
}

/** Every machine: play the race stage as a plain solo run. */
export function raceBegin(g: Game, o: RaceStart): void {
  const rows: RaceRow[] = o.names.map((n, i) => ({ n, c: raceColor(i), p: 0, s: 'run', t: 0, b: -1, lv: 1, r: o.ranks?.[i] ?? -1 }));
  g.role = 'solo';
  g.vfx.recording = false; // nothing to replay on other machines
  g.vfx.drain();
  g.runMode = 'standard';
  g.hero.name = o.net === 'local' ? o.names[o.you] : g.netName || playerName();
  if (o.net !== 'local') g.lobbyKind = 'race';
  // Heat is off in races (everyone plays the same rules).
  const heat = save.meta.heat;
  save.meta.heat = [];
  try {
    g.startRun({ seed: o.seed, difficulty: o.difficulty });
  } finally {
    save.meta.heat = heat;
  }
  // startRun clears it through leaveToTitle-free paths; set after so nothing resets it.
  g.race = {
    net: o.net,
    seed: o.seed,
    difficulty: o.difficulty,
    rows,
    you: o.you,
    clock: 0,
    limit: o.limit ?? raceTuning.limit,
    phase: 'run',
    peers: o.peers ?? [],
    reportT: 0,
    goSaid: false,
    finalSaid: false,
    final: null,
    rating: null,
    onDone: o.onDone,
  };
  const [title, sub] = o.banner ?? ['RACE!', `SAME STAGE FOR ALL ${rows.length}<br>FIRST TO BEAT THE BOSS WINS`];
  g.vfx.banner(title, sub, 3);
}

/** This machine's own row from its run. */
function updateMine(g: Game, R: RaceRun): void {
  const me = R.rows[R.you];
  if (!me || me.s === 'done' || me.s === 'ko' || me.s === 'left') return;
  const finished = g.mode === 'cleared' || g.stage > 1 || g.mode === 'portal' || g.mode === 'transition' || (g.director.bossSpawned && !g.boss && g.mode === 'shop');
  const bossFrac = g.boss && g.boss.active ? Math.max(0, g.boss.hp / Math.max(1, g.boss.maxHp)) : -1;
  me.p = raceProgress(g.director.time, g.director.duration, bossFrac, finished);
  me.b = bossFrac;
  me.lv = g.level;
  me.r = save.ranked.rating;
  me.t = R.clock;
  if (finished) {
    me.s = 'done';
    me.p = 2;
    g.vfx.banner('BOSS DOWN!', `FINISHED IN ${fmt(R.clock)}`, 2.5);
  } else if (g.mode === 'dead') {
    me.s = 'ko';
  } else me.s = bossFrac >= 0 ? 'boss' : 'run';
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

/** Every update (any role). */
export function raceTick(g: Game, dt: number): void {
  const st = states.get(g);
  if (!st) return;
  const R = g.race;
  // Lobby cards can redraw from other lanes' messages: keep the rank badges on them.
  if (!R && g.screens.current === 'online' && g.stepN % 30 === 0) st.ui.decorateLobby();
  if (st.chal) challengeTick(g, st);
  if (R && R.phase === 'run') {
    R.clock += dt;
    updateMine(g, R);
    if (!R.goSaid && g.mode === 'fight') {
      R.goSaid = true;
      raceSay('vo_race_go', 'Race start! Go go go!');
    }
    if (!R.finalSaid && R.limit - R.clock <= raceTuning.finalCue && R.clock > 5) {
      R.finalSaid = true;
      raceSay('vo_final_round', 'Final round!');
      g.hud.toast('ONE MINUTE LEFT IN THE RACE', 2.5);
    }
    R.reportT -= dt;
    if (R.reportT <= 0) {
      R.reportT = raceTuning.report;
      if (R.net === 'client') g.client?.send({ t: 'rcp', row: R.rows[R.you] });
      else if (R.net === 'host') {
        g.host?.broadcast({ t: 'rcb', rows: R.rows, clock: R.clock });
        if (raceOver(R.rows, R.clock, R.limit)) {
          g.host?.broadcast({ t: 'rcend', rows: R.rows, clock: R.clock });
          raceFinish(g, R.rows);
        }
      } else if (raceOver(R.rows, R.clock, R.limit)) localTurnDone(g, R);
    }
  }
  st.hudT -= dt;
  if (st.hudT <= 0) {
    st.hudT = 0.1;
    st.ui.renderHud();
  }
}

/** endRun while racing: you were knocked out (or quit). Wait for the others. */
function raceRunEnded(g: Game, quit: boolean): void {
  const R = g.race!;
  const me = R.rows[R.you];
  if (me.s !== 'done') {
    me.s = quit ? 'left' : 'ko';
    me.t = R.clock;
  }
  R.reportT = 0;
  if (R.net === 'local') return localTurnDone(g, R);
  if (R.net === 'client') g.client?.send({ t: 'rcp', row: me });
  g.mode = 'title';
  g.paused = false;
  g.hud.setVisible(false);
  states.get(g)?.ui.showResults(true);
}

/** Every machine: the race is over. Standings, rating, tournament, results screen. */
export function raceFinish(g: Game, rows: RaceRow[]): void {
  const R = g.race;
  const st = states.get(g);
  if (!R || !st || R.phase === 'over') return;
  // Keep our own final row (the host's copy can be half a second old).
  const mine = R.rows[R.you];
  R.rows = rows.map((r, i) => (i === R.you && mine ? { ...r, ...(mine.s === 'done' || mine.s === 'ko' || mine.s === 'left' ? mine : {}) } : r));
  R.phase = 'over';
  R.final = standings(R.rows);
  const me = R.final.find((x) => x.row === R.rows[R.you]);
  const place = me?.place ?? R.rows.length;
  if (R.net !== 'local' && R.rows.length >= 2 && !saveLock.on) {
    const others = R.final.filter((x) => x.row !== R.rows[R.you]).map((x) => ({ rating: x.row.r >= 0 ? x.row.r : rankedTuning.start, place: x.place }));
    R.rating = applyMatch(save.ranked, { place }, others);
    persist();
    submitLadder(g);
  }
  if (st.tourney && st.tourney.champion < 0 && R.final[0] && R.final[0].place === 1 && R.final.filter((x) => x.place === 1).length === 1) {
    if (autoRecord(st.tourney, R.final[0].row.n, R.rows.map((r) => r.n))) {
      storeTourney(g);
      g.hud.toast('TOURNAMENT MATCH RECORDED', 3);
    }
  }
  g.mode = 'title';
  g.paused = false;
  g.hud.setVisible(false);
  st.ui.showResults(false);
  if (place === 1) {
    raceSay('vo_victory', 'Victory!');
    raceSting('victory_fanfare');
  } else raceSting('defeat_sting');
}

/** Hot seat: this player's turn is over. */
function localTurnDone(g: Game, R: RaceRun): void {
  if (R.phase === 'over') return;
  R.phase = 'over';
  const me = R.rows[R.you];
  if (me.s === 'run' || me.s === 'boss') me.t = R.clock;
  const r: TurnResult = { p: me.p, t: me.t, score: Math.floor(g.score) };
  const done = R.onDone;
  g.mode = 'title';
  g.paused = false;
  g.hud.setVisible(false);
  done?.(r);
}

// ---------------------------------------------------------------- messages

function raceHostMessage(g: Game, from: string, m: Record<string, unknown>): boolean {
  const st = states.get(g);
  if (!st) return false;
  if (m.t === 'rkme') {
    const r = Number(m.r);
    if (Number.isFinite(r)) st.ranks.set(from, Math.max(rankedTuning.floor, Math.min(rankedTuning.ceil, Math.round(r))));
    if (g.mode === 'title' && !g.race) g.refreshLobby();
    return true;
  }
  if (m.t === 'rcp') {
    const R = g.race;
    if (!R || R.net !== 'host' || R.phase !== 'run') return true;
    const i = R.peers.indexOf(from);
    const row = cleanRow(m.row);
    if (i <= 0 || !row) return true;
    const old = R.rows[i];
    if (old.s === 'done' || old.s === 'ko' || old.s === 'left') return true; // a finish is final
    R.rows[i] = { ...row, n: old.n, c: old.c, t: row.s === 'done' || row.s === 'ko' || row.s === 'left' ? R.clock : row.t };
    if (row.s === 'done') R.reportT = 0; // end the race on the next step
    return true;
  }
  return false;
}

function raceClientMessage(g: Game, m: Record<string, unknown>): boolean {
  const st = states.get(g);
  if (!st) return false;
  switch (m.t) {
    case 'lobby':
      // Not consumed: the lobby still draws. Send our rating once per connection.
      if (st.rankSentTo !== g.client) {
        st.rankSentTo = g.client;
        rollSeason(save.ranked);
        g.client?.send({ t: 'rkme', r: save.ranked.rating });
      }
      if (m.kind === 'race') g.lobbyKind = 'race';
      return false;
    case 'rkl':
      st.lobbyRanks = Array.isArray(m.l) ? (m.l as { n: string; r: number }[]).slice(0, 8).map((x) => ({ n: String(x?.n ?? '').slice(0, 12), r: Number(x?.r) || -1 })) : [];
      st.ui.decorateLobby();
      return true;
    case 'rcgo': {
      const names = Array.isArray(m.names) ? (m.names as unknown[]).slice(0, 8).map((n) => String(n ?? 'Player').slice(0, 12)) : [];
      const ranks = Array.isArray(m.ranks) ? (m.ranks as unknown[]).map((r) => Number(r)) : [];
      const you = Math.max(0, Math.min(names.length - 1, Number(m.you) || 0));
      if (names.length < 2) return true;
      ranks[you] = save.ranked.rating;
      raceBegin(g, { net: 'client', seed: Number(m.seed) >>> 0, difficulty: String(m.difficulty ?? 'normal'), names, ranks, you, limit: Number(m.limit) || raceTuning.limit });
      return true;
    }
    case 'rcb': {
      const R = g.race;
      if (!R || R.net !== 'client' || R.phase !== 'run' || !Array.isArray(m.rows)) return true;
      const rows = (m.rows as unknown[]).map(cleanRow);
      rows.forEach((r, i) => {
        if (r && i !== R.you && R.rows[i]) R.rows[i] = { ...r, c: R.rows[i].c };
      });
      const c = Number(m.clock);
      if (Number.isFinite(c)) R.clock = c;
      if (g.screens.current === 'raceres') st.ui.showResults(true);
      return true;
    }
    case 'rcend': {
      const R = g.race;
      if (!R || !Array.isArray(m.rows)) return true;
      const rows = (m.rows as unknown[]).map((r, i) => cleanRow(r) ?? R.rows[i]).filter(Boolean) as RaceRow[];
      rows.forEach((r, i) => (r.c = R.rows[i]?.c ?? r.c));
      raceFinish(g, rows);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- ranked

/** PvP result: winner first, everyone else second (a draw is a draw for all). */
function pvpRated(g: Game, winner: string): void {
  const st = states.get(g);
  if (!st || saveLock.on) return;
  const names = g.role === 'host' || g.pvp?.net === 'host' ? g.lobby.map((p) => ({ n: p.name, r: p.peerId ? st.ranks.get(p.peerId) ?? -1 : save.ranked.rating })) : st.lobbyRanks;
  if (names.length < 2) return;
  const meName = (g.netName || g.hero.name).toLowerCase();
  const placeOf = (n: string) => (!winner || n.toLowerCase() === winner.toLowerCase() ? 1 : 2);
  let mine = names.findIndex((x) => x.n.toLowerCase() === meName);
  if (mine < 0) mine = g.pvp?.net === 'host' ? 0 : -1;
  if (mine < 0) return;
  const others = names.filter((_, i) => i !== mine).map((x) => ({ rating: x.r >= 0 ? x.r : rankedTuning.start, place: placeOf(x.n) }));
  const res = applyMatch(save.ranked, { place: placeOf(names[mine].n) }, others);
  persist();
  submitLadder(g);
  const t = tierOf(res.after);
  window.setTimeout(() => g.hud.toast(`RANKED ${res.delta >= 0 ? '+' : ''}${res.delta} · ${t.name.toUpperCase()} ${res.after}${res.tierUp ? ' · RANK UP!' : ''}`, 4), 1500);
  if (st.tourney && st.tourney.champion < 0 && winner && autoRecord(st.tourney, winner, names.map((x) => x.n))) {
    storeTourney(g);
    window.setTimeout(() => g.hud.toast('TOURNAMENT MATCH RECORDED', 3), 3000);
  }
}

function submitLadder(g: Game): void {
  if (!rankedLadder.enabled) return;
  const r = save.ranked;
  if (!r.id) {
    r.id = Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    persist();
  }
  void rankedLadder.submit({ id: r.id, season: r.season, name: g.netName || playerName(), rating: r.rating, games: r.games, wins: r.wins });
}

// ---------------------------------------------------------------- challenge a friend

function noteRunForChallenge(g: Game, sum: RunSummary): void {
  const st = states.get(g);
  if (!st) return;
  st.lastSum = sum;
  st.lastChal = st.chal;
  st.lastHeat = g.meta.heat.length > 0;
  const mode = CHALLENGE_MODES.find((m) => m === g.runMode);
  st.lastCode =
    g.role === 'solo' && !g.pvp && !g.race && !g.versus && !g.localCoop && !g.onboarding.training && mode && !st.lastHeat && sum.score > 0
      ? encodeChallenge({ seed: g.seed, mode, difficulty: g.difficulty.id, hero: g.hero.heroDef.id, loadout: { ...g.hero.loadoutPick }, score: sum.score, stage: sum.stage, name: g.hero.name || playerName() })
      : '';
  if (st.lastCode) saveJson('challenge.last', st.lastCode);
}

/** Play a friend's challenge: their seed, mode, difficulty, hero and loadout (locked items included: it's their kit). */
export function startChallenge(g: Game, c: Challenge): void {
  const st = states.get(g);
  if (!st) return;
  g.leaveToTitle();
  g.hero.name = playerName();
  g.applyLocalSkin();
  if (HEROES.some((h) => h.id === c.hero)) g.hero.setHeroDef(c.hero);
  g.runMode = c.mode as ChallengeMode;
  const keep = { loadout: settings.loadout, unlockAll: cheats.unlockAll, heat: save.meta.heat };
  settings.loadout = { ...c.loadout };
  cheats.unlockAll = true;
  save.meta.heat = [];
  st.starting = true;
  try {
    g.startRun({ seed: c.seed, difficulty: c.difficulty });
  } finally {
    settings.loadout = keep.loadout;
    cheats.unlockAll = keep.unlockAll;
    save.meta.heat = keep.heat;
    st.starting = false;
  }
  st.chal = c;
  st.chalPassed = false;
  g.vfx.banner('CHALLENGE!', `BEAT ${c.name.toUpperCase()}: ${c.score.toLocaleString('en-US')}<br>SAME SEED, SAME KIT`, 3.2);
  raceSay('vo_round_fight', 'Round one... Fight!');
}

function challengeTick(g: Game, st: RaceLaneState): void {
  const c = st.chal!;
  if (st.chalPassed || g.mode === 'title' || g.mode === 'dead') return;
  if (Math.floor(g.score * g.meta.multiplier) > c.score) {
    st.chalPassed = true;
    g.vfx.banner('NEW LEADER!', `YOU PASSED ${c.name.toUpperCase()}'S SCORE`, 2.2);
    sfx.legendaryPick();
  }
}

// ---------------------------------------------------------------- tournament

export function storeTourney(g: Game): void {
  const st = states.get(g);
  if (!st) return;
  saveJson(TOURNEY_KEY, st.tourney);
}

/** Hot seat: play one side of the open match. */
export function playTurn(g: Game, round: number, match: number, side: 'a' | 'b'): void {
  const st = states.get(g);
  const t = st?.tourney;
  const m = t?.rounds[round]?.[match];
  if (!st || !t || !m || m.w >= 0) return;
  const player = side === 'a' ? m.a : m.b;
  const foe = side === 'a' ? m.b : m.a;
  if (player < 0 || foe < 0) return;
  g.leaveToTitle();
  g.applyLocalSkin();
  st.turn = { round, match, side };
  const final = round === t.rounds.length - 1;
  const name = t.names[player];
  raceBegin(g, {
    net: 'local',
    seed: matchSeed(t, round, match),
    difficulty: 'normal',
    names: [name],
    you: 0,
    banner: [`${name.toUpperCase()}'S TURN`, `${final ? 'FINAL' : 'MATCH'} VS ${t.names[foe].toUpperCase()}<br>BEAT THE BOSS AS FAST AS YOU CAN`],
    onDone: (r) => {
      const won = recordTurn(t, round, match, side, r);
      storeTourney(g);
      st.turn = null;
      g.leaveToTitle();
      st.ui.openTourney({ turn: { name, r }, won });
    },
  });
  raceSay(final ? 'vo_final_round' : 'vo_round_fight', final ? 'Final round!' : 'Round one... Fight!');
}
