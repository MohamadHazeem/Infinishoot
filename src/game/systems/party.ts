/**
 * Lobby lane: getting friends together (notes/lanes/lobby.md).
 * - Lobby: READY-UP (the run starts when everyone is ready, or the host
 *   forces it), KICK, player cards (hero, profile level, best stage,
 *   cosmetics, ping), QUICK CHAT and a short, rate-limited, filtered TEXT CHAT.
 * - Party: after an online co-op game over the party stays connected; a PARTY
 *   screen shows the run and everyone votes RESTART or back to the LOBBY.
 * - Friends: recent teammates and the player's friend code (src/game/lobby.ts).
 * Game methods (`this` is the Game) installed on the class as fields, plus
 * per-Game state in a WeakMap so shared files only get small hooks.
 *
 * Wire messages (all prefixed `lb` so they never clash with other lanes):
 *   client -> host: lbready {on}, lbchat {s | q}, lbpong {s}, lbvote {v}
 *   host -> client: lbx (lobby view), lbchat {n, c, s}, lbchatno, lbping {s},
 *                   lbkick, lbparty (party view), lbtolobby
 */
import type { Game, LobbyEntry } from '../game';
import { playerName } from '../game';
import { HERO_COLORS } from '../hero';
import { persist, save, unlockedWeapons } from '../save';
import { today } from '../../data/modes';
import {
  allReady,
  ChatLimiter,
  chatTuning,
  cleanProfile,
  filterChat,
  lobbyTuning,
  makeFriendCode,
  noteRecent,
  profileLevel,
  QUICK_CHAT,
  tallyVotes,
  type PartyVote,
  type ProfileCard,
} from '../lobby';
import { LobbyUi } from '../../ui/lobbyScreen';
import { PartyUi } from '../../ui/partyScreen';
import { FriendsUi } from '../../ui/friendsScreen';
import { sfx } from '../../audio/sfx';

export interface ChatLine {
  n: string;
  c: string;
  s: string;
  /** System line (rate limit, joins), drawn grey. */
  sys?: boolean;
}

/** One player card in the lobby (index matches the lobby's player list). */
export interface LobbyCard {
  ready: boolean;
  /** Round trip to the host in ms (-1 unknown, 0 for the host itself). */
  ping: number;
  hero: string;
  skin: string;
  pet: string;
  prof: ProfileCard | null;
}

/** What every machine draws in the lobby, on top of the base player list. */
export interface LobbyXView {
  p: LobbyCard[];
  /** Seconds until the ready-up start (-1 = not counting). */
  cd: number;
  /** This machine's index in the list. */
  you: number;
}

export interface PartyRow {
  n: string;
  c: string;
  hero: string;
  dmg: number;
  dead: boolean;
  v: PartyVote;
}

export interface PartyView {
  stage: number;
  score: number;
  kills: number;
  time: number;
  level: number;
  rows: PartyRow[];
  you: number;
}

interface PartyState {
  lobbyUi: LobbyUi;
  partyUi: PartyUi;
  friendsUi: FriendsUi;
  /** Host: ready flags, pings, profiles and player ids by peer id ('' = the host). */
  ready: Map<string, boolean>;
  pings: Map<string, number>;
  profiles: Map<string, ProfileCard>;
  pids: Map<string, string>;
  /** Host: kicked players (pid or name) and when the ban ends (ms). */
  kicked: Map<string, number>;
  limiter: ChatLimiter;
  chat: ChatLine[];
  /** Host: ready-up countdown (-1 = off). */
  cd: number;
  pingT: number;
  /** Last lobby view drawn (the host builds its own; clients get it in `lbx`). */
  view: LobbyXView | null;
  /** Host: party votes by peer id. */
  votes: Map<string, PartyVote>;
  party: PartyView | null;
  partyKey: string;
  /** Client: the room code (to redraw the lobby after a party returns to it). */
  code: string;
  /** Client: the lobby's player names, in order. */
  names: string[];
  lastMode: string;
  /** The connection the state belongs to (a new host or client starts clean). */
  conn: unknown;
}

const states = new WeakMap<Game, PartyState>();

export function partyState(g: Game): PartyState | undefined {
  return states.get(g);
}

/** The state for the current connection: a new host or client (or none) starts with a clean chat, flags and votes. */
function stateOf(g: Game): PartyState | undefined {
  const st = states.get(g);
  if (!st) return;
  const conn = g.host ?? g.client;
  if (conn !== st.conn) {
    st.conn = conn;
    resetState(st);
  }
  return st;
}

/** Build the lobby lane's screens and hooks (Game constructor, after installMp). */
export function installParty(g: Game, root: HTMLElement): void {
  const st: PartyState = {
    lobbyUi: null as unknown as LobbyUi,
    partyUi: null as unknown as PartyUi,
    friendsUi: null as unknown as FriendsUi,
    ready: new Map(),
    pings: new Map(),
    profiles: new Map(),
    pids: new Map(),
    kicked: new Map(),
    limiter: new ChatLimiter(),
    chat: [],
    cd: -1,
    pingT: 0,
    view: null,
    votes: new Map(),
    party: null,
    partyKey: '',
    code: '',
    names: [],
    lastMode: 'title',
    conn: null,
  };
  states.set(g, st);
  st.lobbyUi = new LobbyUi(root, g);
  st.partyUi = new PartyUi(root, g);
  st.friendsUi = new FriendsUi(root, g);
  // Chain onto the lobby hook (the MP lane draws its rows first).
  const prevLobby = g.screens.onLobby;
  g.screens.onLobby = (el, v) => {
    prevLobby?.(el, v);
    st.lobbyUi.render(el, v);
  };
  const prevShow = g.screens.onShow;
  g.screens.onShow = (name) => {
    prevShow?.(name);
    if (name === 'gameover') st.partyUi.onGameOver(partyOn(g));
  };
  // Invite links: ?join=CODE goes straight to joining (after the title is up).
  setTimeout(() => st.lobbyUi.checkInviteUrl(), 0);
}

/** Party flow applies: an online co-op (or weekly) game, not PvP or Versus. */
export function partyOn(g: Game): boolean {
  return g.role !== 'solo' && !g.pvp && !g.versus && !g.localCoop;
}

/** This save's friend code, made on first use. */
export function ensureFriendCode(): string {
  if (!save.friends.code) {
    save.friends.code = makeFriendCode();
    persist();
  }
  return save.friends.code;
}

/** This player's card for the lobby (sent in `hello`). */
export function myProfile(): ProfileCard {
  return { lv: profileLevel(save.lifetime, save.achievements.length), best: save.lifetime.bestStage, runs: save.lifetime.runs, ach: save.achievements.length, fc: ensureFriendCode() };
}

/** The room code a host uses: the friend code (so saved codes and links keep working), if that's on. */
export function hostCode(): string | undefined {
  return save.friends.useCode ? ensureFriendCode() : undefined;
}

// ---------------------------------------------------------------- views

function lobbyView(g: Game, st: PartyState, you: number): LobbyXView {
  return {
    p: g.lobby.map((e) => ({
      ready: !!st.ready.get(e.peerId),
      ping: e.peerId ? st.pings.get(e.peerId) ?? -1 : 0,
      hero: e.hero,
      skin: e.skin,
      pet: e.pet,
      prof: e.peerId ? st.profiles.get(e.peerId) ?? null : myProfile(),
    })),
    cd: st.cd < 0 ? -1 : Math.ceil(st.cd),
    you,
  };
}

/** Host: send the lobby view to everyone (each gets its own `you`) and redraw. */
function sendLobbyX(g: Game, st: PartyState): void {
  if (!g.host) return;
  g.lobby.forEach((e, i) => {
    if (e.peerId) g.host!.send(e.peerId, { t: 'lbx', v: lobbyView(g, st, i) });
  });
  st.view = lobbyView(g, st, 0);
  st.lobbyUi.renderCards();
}

/** The current lobby-lane view on this machine. */
export function lobbyX(g: Game): LobbyXView | null {
  return states.get(g)?.view ?? null;
}

export function chatLog(g: Game): ChatLine[] {
  return states.get(g)?.chat ?? [];
}

export function partyView(g: Game): PartyView | null {
  return states.get(g)?.party ?? null;
}

function cleanLobbyX(raw: unknown): LobbyXView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<LobbyXView>;
  if (!Array.isArray(r.p)) return null;
  return {
    p: r.p.slice(0, 4).map((c) => ({
      ready: !!c?.ready,
      ping: Number.isFinite(c?.ping) ? Number(c.ping) : -1,
      hero: String(c?.hero ?? ''),
      skin: String(c?.skin ?? ''),
      pet: String(c?.pet ?? ''),
      prof: cleanProfile(c?.prof),
    })),
    cd: Number.isFinite(r.cd) ? Number(r.cd) : -1,
    you: Number.isFinite(r.you) ? Number(r.you) : -1,
  };
}

// ---------------------------------------------------------------- actions (any role)

/** READY toggle (lobby). */
export function lobbyReady(this: Game, on?: boolean): void {
  const st = stateOf(this);
  if (!st || this.mode !== 'title') return;
  if (this.role === 'host') {
    st.ready.set('', on ?? !st.ready.get(''));
    sendLobbyX(this, st);
  } else if (this.role === 'client') {
    const me = st.view && st.view.you >= 0 ? st.view.p[st.view.you] : null;
    this.client?.send({ t: 'lbready', on: on ?? !me?.ready });
  }
}

/** Send a chat line: free text or a quick-chat index. */
export function lobbyChat(this: Game, text: string | number): void {
  const st = stateOf(this);
  if (!st) return;
  if (this.role === 'host') return hostChat(this, st, '', typeof text === 'number' ? { q: text } : { s: text });
  if (this.role !== 'client') return;
  // Local check first, so spamming gets instant feedback; the host checks again.
  if (!st.limiter.allow('', performance.now() / 1000)) return addLine(this, st, { n: '', c: '', s: 'SLOW DOWN A LITTLE...', sys: true });
  if (typeof text === 'number') this.client?.send({ t: 'lbchat', q: text });
  else if (filterChat(text)) this.client?.send({ t: 'lbchat', s: text.slice(0, chatTuning.maxLen * 2) });
}

/** Host: remove a player from the lobby (can't rejoin for a while). */
export function lobbyKick(this: Game, index: number): void {
  const st = stateOf(this);
  const e = this.lobby[index];
  if (!st || this.role !== 'host' || !this.host || !e || !e.peerId || this.mode !== 'title') return;
  const until = performance.now() + lobbyTuning.kickBan * 1000;
  st.kicked.set(st.pids.get(e.peerId) || 'name:' + e.name, until);
  this.host.send(e.peerId, { t: 'lbkick' });
  addLine(this, st, { n: '', c: '', s: `${e.name.toUpperCase()} WAS REMOVED FROM THE LOBBY`, sys: true }, true);
  const id = e.peerId;
  // Drop them from the list now; the connection closes a moment later (after the message lands).
  this.lobby = this.lobby.filter((p) => p.peerId !== id);
  forget(st, id);
  this.refreshLobby();
  sendLobbyX(this, st);
  setTimeout(() => this.host?.kick(id), 200);
}

/** Party vote (game over screen). */
export function partyVote(this: Game, v: PartyVote): void {
  const st = stateOf(this);
  if (!st || this.mode !== 'dead') return;
  if (this.role === 'host') {
    st.votes.set('', st.votes.get('') === v ? '' : v);
    partyStep(this, st, true);
  } else if (this.role === 'client') this.client?.send({ t: 'lbvote', v });
}

/** Host: skip the vote. */
export function partyForce(this: Game, what: 'restart' | 'lobby'): void {
  if (this.role !== 'host' || this.mode !== 'dead' || !partyOn(this)) return;
  if (what === 'restart') partyRestart(this);
  else partyToLobby(this);
}

// ---------------------------------------------------------------- host side

function forget(st: PartyState, id: string): void {
  st.ready.delete(id);
  st.pings.delete(id);
  st.votes.delete(id);
  st.limiter.forget(id);
}

function addLine(g: Game, st: PartyState, line: ChatLine, broadcast = false): void {
  st.chat.push(line);
  if (st.chat.length > chatTuning.keep) st.chat.splice(0, st.chat.length - chatTuning.keep);
  if (broadcast && g.role === 'host') g.host?.broadcast({ t: 'lbchat', ...line });
  st.lobbyUi.renderChat();
  st.partyUi.renderChat();
  if (!line.sys) sfx.ui('tick', 0.6);
}

function hostChat(g: Game, st: PartyState, from: string, m: { s?: unknown; q?: unknown }): void {
  const entry = g.lobby.find((p) => p.peerId === from);
  const hero = g.mode === 'title' ? null : g.heroes.find((h) => (from ? h.peerId === from : h === g.hero));
  const name = entry?.name ?? hero?.name ?? (from ? '' : g.netName || playerName());
  if (!name) return;
  const idx = entry ? g.lobby.indexOf(entry) : hero ? hero.index : 0;
  const text = m.q !== undefined ? QUICK_CHAT[Math.floor(Number(m.q))] ?? '' : filterChat(m.s);
  if (!text) return;
  if (!st.limiter.allow(from, performance.now() / 1000)) {
    if (from) g.host?.send(from, { t: 'lbchatno' });
    else addLine(g, st, { n: '', c: '', s: 'SLOW DOWN A LITTLE...', sys: true });
    return;
  }
  addLine(g, st, { n: name, c: HERO_COLORS[idx % HERO_COLORS.length], s: text }, true);
}

/** Host: messages for this lane. True if handled (hello is only peeked at). */
export function lobbyHostMessage(this: Game, from: string, m: Record<string, unknown>): boolean {
  const st = stateOf(this);
  if (!st) return false;
  switch (m.t) {
    case 'hello': {
      const pid = typeof m.pid === 'string' ? m.pid.slice(0, 16) : '';
      const name = String(m.name ?? 'Player').slice(0, 12);
      const now = performance.now();
      for (const [k, until] of st.kicked) if (until < now) st.kicked.delete(k);
      if (st.kicked.has(pid) || st.kicked.has('name:' + name)) {
        this.host?.send(from, { t: 'full', reason: 'The host removed you from this lobby.' });
        return true;
      }
      if (pid) st.pids.set(from, pid);
      const prof = cleanProfile(m.prof);
      if (prof) st.profiles.set(from, prof);
      st.ready.set(from, false);
      st.pingT = 0.3; // ping the newcomer soon
      // Let the base hello add them first, then send the cards.
      setTimeout(() => this.mode === 'title' && this.role === 'host' && sendLobbyX(this, st), 0);
      return false;
    }
    case 'lbready':
      if (this.mode === 'title' && this.lobby.some((p) => p.peerId === from)) {
        st.ready.set(from, !!m.on);
        sendLobbyX(this, st);
      }
      return true;
    case 'lbchat':
      hostChat(this, st, from, m);
      return true;
    case 'lbpong': {
      const rtt = performance.now() - Number(m.s);
      if (Number.isFinite(rtt) && rtt >= 0 && rtt < 10000) st.pings.set(from, Math.round(rtt));
      return true;
    }
    case 'lbvote': {
      const v = (['restart', 'lobby', ''] as const).find((x) => x === m.v) ?? '';
      if (this.mode === 'dead' && this.heroByPeer(from)) {
        st.votes.set(from, st.votes.get(from) === v ? '' : v);
        partyStep(this, st, true);
      }
      return true;
    }
  }
  return false;
}

/** Host: a client's connection closed (before the base handler runs). */
export function lobbyLeft(this: Game, id: string): void {
  const st = stateOf(this);
  if (!st) return;
  const e = this.lobby.find((p) => p.peerId === id) ?? this.heroByPeer(id);
  if (e && this.mode === 'title') addLine(this, st, { n: '', c: '', s: `${e.name.toUpperCase()} LEFT`, sys: true }, true);
  forget(st, id);
  setTimeout(() => {
    if (this.role !== 'host') return;
    if (this.mode === 'title') sendLobbyX(this, st);
    else if (this.mode === 'dead') partyStep(this, st, true);
  }, 0);
}

/** The heroes still in the party (host first). */
function partyHeroes(g: Game) {
  return g.heroes.filter((h) => !h.left && (h === g.hero || h.peerId));
}

function buildParty(g: Game, st: PartyState, you: number): PartyView {
  return {
    stage: g.stage,
    score: Math.floor(g.score * (g.meta?.multiplier ?? 1)),
    kills: g.kills,
    time: g.runTime,
    level: g.level,
    rows: partyHeroes(g).map((h) => ({
      n: h.name,
      c: h.color,
      hero: h.heroDef.name,
      dmg: Math.round(Object.values(h.damageBy).reduce((a, b) => a + b, 0)),
      dead: h.player.dead,
      v: st.votes.get(h === g.hero ? '' : h.peerId) ?? '',
    })),
    you,
  };
}

/** Host: keep the party view current and act on a unanimous vote. */
function partyStep(g: Game, st: PartyState, force = false): void {
  if (g.role !== 'host' || g.mode !== 'dead' || !partyOn(g)) return;
  const list = partyHeroes(g);
  const view = buildParty(g, st, 0);
  const key = JSON.stringify(view);
  if (force || key !== st.partyKey) {
    st.partyKey = key;
    st.party = view;
    list.forEach((h, i) => {
      if (h.peerId) g.host?.send(h.peerId, { t: 'lbparty', v: { ...view, you: i } });
    });
    st.partyUi.render();
  }
  if (list.length < 1) return;
  const agreed = tallyVotes(list.map((h) => st.votes.get(h === g.hero ? '' : h.peerId) ?? ''));
  if (agreed === 'restart') partyRestart(g);
  else if (agreed === 'lobby') partyToLobby(g);
}

/** Lobby entries for the heroes still here (host first), keeping their picks. */
function lobbyFromHeroes(g: Game): LobbyEntry[] {
  return partyHeroes(g)
    .sort((a, b) => (a === g.hero ? -1 : b === g.hero ? 1 : a.index - b.index))
    .map((h) => ({ peerId: h === g.hero ? '' : h.peerId, name: h.name, unlocked: h.unlocked, loadout: { ...h.loadoutPick }, skin: h.skin.id, pet: h.pet, hero: h.heroDef.id, look: h.player.look }));
}

/** Host: same party, new run (everyone keeps hero and loadout). */
export function partyRestart(g: Game): void {
  const st = stateOf(g);
  if (!st || g.role !== 'host') return;
  st.votes.clear();
  st.partyKey = '';
  st.party = null;
  g.lobby = lobbyFromHeroes(g);
  g.vfx.toast('THE PARTY GOES AGAIN!', 2);
  g.hostStart();
}

/** Host: everyone back to the lobby, still connected (ready flags cleared, picks kept). */
export function partyToLobby(g: Game): void {
  const st = stateOf(g);
  if (!st || g.role !== 'host' || !g.host) return;
  st.votes.clear();
  st.partyKey = '';
  st.party = null;
  st.ready.clear();
  st.cd = -1;
  g.lobby = lobbyFromHeroes(g);
  g.host.broadcast({ t: 'lbtolobby' });
  const me = g.hero;
  g.setHeroes([me]);
  g.local = 0;
  g.goTitle();
  g.refreshLobby();
  sendLobbyX(g, st);
}

/** Every update (any role): pings, the ready-up countdown, the party view, recent teammates. */
export function partyTick(this: Game, dt: number): void {
  const st = stateOf(this);
  if (!st) return;
  // A run just started from the lobby: remember who we played with.
  if (st.lastMode === 'title' && this.mode !== 'title' && this.role !== 'solo') noteTeam(this, st);
  st.lastMode = this.mode;
  if (this.role !== 'host' || !this.host) return;
  if (this.mode === 'title' || this.mode === 'dead') {
    st.pingT -= dt;
    if (st.pingT <= 0) {
      st.pingT = lobbyTuning.pingEvery;
      const s = performance.now();
      this.host.broadcast({ t: 'lbping', s });
      if (this.mode === 'title' && this.lobby.length > 1) sendLobbyX(this, st);
    }
  }
  if (this.mode === 'title') {
    const go = allReady(this.lobby.map((p) => !!st.ready.get(p.peerId)));
    if (go) {
      const before = st.cd < 0 ? -1 : Math.ceil(st.cd);
      if (st.cd < 0) st.cd = lobbyTuning.countdown;
      st.cd -= dt;
      if (st.cd <= 0) {
        st.cd = -1;
        st.ready.clear();
        this.hostStart();
        if (this.mode === 'title') sendLobbyX(this, st); // refused (e.g. PvP needs 2): show the cleared flags
        return;
      }
      if (Math.ceil(st.cd) !== before) {
        if (before < 0) sfx.ui('confirm', 1);
        sendLobbyX(this, st);
      }
    } else if (st.cd >= 0) {
      st.cd = -1;
      sendLobbyX(this, st);
    }
  } else if (this.mode === 'dead' && partyOn(this)) partyStep(this, st);
  else if (st.votes.size) st.votes.clear();
}

function resetState(st: PartyState): void {
  for (const m of [st.ready, st.pings, st.profiles, st.pids, st.votes]) m.clear();
  st.limiter = new ChatLimiter();
  st.chat = [];
  st.cd = -1;
  st.view = null;
  st.party = null;
  st.partyKey = '';
  st.names = [];
  st.lobbyUi.renderChat();
}

/** Save recent teammates (with their friend codes) for EXTRAS > FRIENDS. */
function noteTeam(g: Game, st: PartyState): void {
  const v = st.view;
  const names = g.heroes.filter((h) => h !== g.hero).map((h) => h.name);
  if (!names.length) return;
  const order = g.role === 'host' ? g.lobby.map((e) => e.name) : st.names;
  const mates = names.map((n) => {
    const i = order.indexOf(n);
    const card = v && i >= 0 ? v.p[i] : null;
    return { name: n, code: card?.prof?.fc ?? '' };
  });
  save.friends.recent = noteRecent(save.friends.recent, mates, today(), save.friends.code);
  persist();
}

// ---------------------------------------------------------------- client side

/** Client: messages for this lane. True if handled ('lobby' and 'start' are only peeked at). */
export function lobbyClientMessage(this: Game, m: Record<string, unknown>): boolean {
  const st = stateOf(this);
  if (!st) return false;
  switch (m.t) {
    case 'lobby': {
      st.code = String(m.code ?? st.code);
      st.names = ((m.players as { name: string }[]) ?? []).map((p) => String(p?.name ?? '')); // for noteTeam
      return false;
    }
    case 'lbx':
      st.view = cleanLobbyX(m.v);
      st.lobbyUi.renderCards();
      return true;
    case 'lbchat':
      addLine(this, st, { n: String(m.n ?? '').slice(0, 12), c: String(m.c ?? '#f4f4f4'), s: m.sys ? String(m.s ?? '') : filterChat(m.s), sys: !!m.sys });
      return true;
    case 'lbchatno':
      addLine(this, st, { n: '', c: '', s: 'SLOW DOWN A LITTLE...', sys: true });
      return true;
    case 'lbping':
      this.client?.send({ t: 'lbpong', s: m.s });
      return true;
    case 'lbkick':
      this.leaveToTitle();
      this.hud.toast('THE HOST REMOVED YOU FROM THE LOBBY', 3);
      return true;
    case 'lbparty':
      st.party = cleanParty(m.v);
      st.partyUi.render();
      return true;
    case 'lbtolobby':
      clientToLobby(this, st);
      return true;
  }
  return false;
}

function cleanParty(raw: unknown): PartyView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PartyView>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    stage: n(r.stage),
    score: n(r.score),
    kills: n(r.kills),
    time: n(r.time),
    level: n(r.level),
    rows: (Array.isArray(r.rows) ? r.rows : []).slice(0, 4).map((x) => ({ n: String(x?.n ?? '').slice(0, 12), c: String(x?.c ?? '#f4f4f4'), hero: String(x?.hero ?? ''), dmg: n(x?.dmg), dead: !!x?.dead, v: (['restart', 'lobby'] as const).find((k) => k === x?.v) ?? '' })),
    you: n(r.you),
  };
}

/** Client: the host took the party back to the lobby. Same connection, a fresh title hero. */
function clientToLobby(g: Game, st: PartyState): void {
  st.party = null;
  st.view = null;
  const keep = g.makeHero(0, playerName(), unlockedWeapons());
  g.setHeroes([keep]);
  g.local = 0;
  g.applyLocalSkin();
  g.goTitle();
  g.screens.setLobby({ code: st.code || '?', players: [], isHost: false, status: 'Back in the lobby! Waiting for the host...' });
}
