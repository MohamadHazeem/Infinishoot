/**
 * Spectate lane: watch your friends play (notes/lanes/spectate.md).
 *
 * Host:
 * - A `hello` with `spec: 1` (PLAY ONLINE > JOIN AS SPECTATOR), or one that
 *   finds the lobby or run full / closed, takes a spectator seat (up to
 *   `spectateTuning.max`). Spectators have no hero; they show in the lobby as
 *   WATCHING and are counted on the players' HUD ("2 WATCHING").
 * - When a run (or a PvP duel) is going, each spectator gets `spstart` (the run's
 *   `start` + `stage` messages and the one-off world state) and then a reduced
 *   snapshot: every 2nd snapshot (10 Hz), centred on the hero it follows (or its
 *   free camera) with a 1.3x interest box, and no gold, gears or Mods. The
 *   per-hero event cursors (skill, time, coop2) are swapped in and out around
 *   the build, so watching never eats a player's own events.
 * - `spv` (who / where the spectator looks), `emote` (rate-limited like coop2's),
 *   `spjoin` (play from the next stage: coop2's drop-in path when a slot opens).
 * Spectator (a client with `on`): skips the client hero loop; follows a hero
 * (CLICK / A next, dash previous), AUTO DIRECTOR or FREE CAM (move keys / stick,
 * wheel zoom), the broadcast overlay (src/ui/spectateUi.ts), emotes on 1-6.
 * Players: the `sp` snapshot field carries the watcher count, names and emotes.
 */
import type { Game } from '../game';
import { INTEREST, playerName } from '../game';
import type { Hero } from '../hero';
import { SnapEncoder } from '../../net/snapCodec';
import type { VfxEvent } from '../vfx';
import { modSession } from '../../mods/manager';
import { settings } from '../settings';
import { t } from '../../i18n';
import { sfx } from '../../audio/sfx';
import { brokenCover, onCoverMsg } from '../coverBreak';
import { EMOTES, EmoteLimiter, emoteOf } from '../coop2';
import { coopState, joinable } from './coop2';
import { heroTimeOf, timeState } from './time';
import { netcodeStep, netInterpAlpha } from './netcode';
import { netQualityTuning } from '../../net/netQuality';
import { rankOf } from '../style';
import { AutoDirector, clampView, cycleFollow, directorScore, seatFor, slotOpen, spectateTuning, type SeatReason } from '../spectate';
import { SpectateUi, type CastCard } from '../../ui/spectateUi';
import { PAD_TEAM, PAD_CASH, PAD_CASHPICK } from '../../core/keybinds';
import { heroPortrait } from './characters';
import { lobbyCap } from '../eightp';

export type CamMode = 'follow' | 'auto' | 'free';

/** A spectator's view of the snapshot: where its interest box sits and its own encoder. */
export interface SnapView {
  x: number;
  z: number;
  r: number;
  enc: SnapEncoder;
  peer: string;
}

interface Cursors {
  sk: number;
  ns: number;
  tm: number;
  co: number;
}

interface HostSpec {
  peerId: string;
  name: string;
  pid: string;
  hello: Record<string, unknown>;
  /** Hero it follows (its HUD shows them, even with the free camera). */
  follow: number;
  /** Free camera: the snapshot is centred on x, z instead. */
  free: boolean;
  x: number;
  z: number;
  enc: SnapEncoder;
  cur: Cursors;
  /** The run it was started into ('' = lobby). */
  runKey: string;
  lim: EmoteLimiter;
  wantJoin: boolean;
  /** Sent into coop2's drop-in queue. */
  joining: boolean;
}

interface SpecEmote {
  seq: number;
  name: string;
  k: number;
  at: number;
}

interface SpecState {
  // host
  specs: HostSpec[];
  fxBuf: VfxEvent[];
  tick: number;
  emotes: SpecEmote[];
  seq: number;
  recent: Set<string>;
  roster: string;
  stage: number;
  // spectator (client)
  want: boolean;
  on: boolean;
  starting: boolean;
  why: SeatReason | '';
  cam: CamMode;
  follow: number;
  fx: number;
  fz: number;
  director: AutoDirector;
  overlay: boolean;
  emoteSel: number;
  viewT: number;
  sentView: string;
  queued: boolean;
  joinMsg: string;
  me: [number, number, number] | null;
  pvpWait: boolean;
  /** Test links: the spectator view over a solo run (no connection; src/dev/spectateLinks.ts). */
  preview: boolean;
  // everyone
  watchers: { n: number; w: string[] };
  shown: number;
  lobbyNames: string[];
  ui: SpectateUi | null;
}

const states = new WeakMap<Game, SpecState>();

export function spectateState(g: Game): SpecState {
  let s = states.get(g);
  if (!s) {
    s = {
      specs: [],
      fxBuf: [],
      tick: 0,
      emotes: [],
      seq: 0,
      recent: new Set(),
      roster: '',
      stage: 0,
      want: false,
      on: false,
      starting: false,
      why: '',
      cam: 'follow',
      follow: 0,
      fx: 0,
      fz: 0,
      director: new AutoDirector(),
      overlay: settings.spectateOverlay !== false,
      emoteSel: 1,
      viewT: 0,
      sentView: '',
      queued: false,
      joinMsg: '',
      me: null,
      pvpWait: false,
      preview: false,
      watchers: { n: 0, w: [] },
      shown: 0,
      lobbyNames: [],
      ui: null,
    };
    states.set(g, s);
  }
  return s;
}

/** This machine is watching (no hero of its own). */
export function spectating(g: Game): boolean {
  return g.role === 'client' && !!states.get(g)?.on;
}

/** Hello flag: the player pressed JOIN AS SPECTATOR. */
export function spectateWanted(g: Game): boolean {
  return !!states.get(g)?.want;
}

const now = () => performance.now() / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const inRun = (g: Game) => g.mode !== 'title';

// ---------------------------------------------------------------- install

/** Game constructor: the JOIN AS SPECTATOR button, lobby WATCHING rows and the overlay. */
export function installSpectate(g: Game, hudRoot: HTMLElement): void {
  const st = spectateState(g);
  st.ui = new SpectateUi(hudRoot);
  const root = hudRoot.ownerDocument;
  const online = root.querySelector<HTMLElement>('#scr-online');
  online?.querySelector('.join-row [data-act=mp-join]')?.insertAdjacentHTML('afterend', `<button data-nav data-act="sp-join" class="sp-joinbtn">${t('spec.joinAs')}</button>`);
  online?.querySelector('.lobby .players')?.insertAdjacentHTML('afterend', '<div class="sp-lobby" hidden></div>');
  online?.addEventListener(
    'click',
    (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (b?.dataset.act === 'mp-join') st.want = false;
      if (b?.dataset.act !== 'sp-join') return;
      st.want = true;
      const name = online.querySelector<HTMLInputElement>('#mp-name')?.value ?? playerName();
      const code = online.querySelector<HTMLInputElement>('#mp-code')?.value ?? '';
      void g.joinGame(name, code);
    },
    true,
  );
  const prev = g.screens.onLobby;
  g.screens.onLobby = (el, v) => {
    prev?.(el, v);
    renderLobbyWatchers(g, el, v.isHost);
  };
}

function renderLobbyWatchers(g: Game, el: HTMLElement, isHost: boolean): void {
  const st = spectateState(g);
  const box = el.querySelector<HTMLElement>('.sp-lobby');
  if (!box) return;
  const players = el.querySelector<HTMLElement>('.lobby .players');
  if (players && box.previousElementSibling !== players) players.after(box); // right under the player cards
  const names = isHost ? st.specs.map((s) => s.name) : st.lobbyNames;
  document.body.classList.toggle('sp-lobbywatch', !isHost && st.on); // no READY UP for spectators
  box.hidden = !names.length;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  box.innerHTML = names.map((n) => `<div class="lobby-player sp-watcher"><span class="eye" aria-hidden="true"></span><bdi>${esc(n)}</bdi> <small>${t('spec.lobbyRow')}</small></div>`).join('');
}

// ---------------------------------------------------------------- host: seats and messages

function specByPeer(st: SpecState, id: string): HostSpec | undefined {
  return st.specs.find((s) => s.peerId === id);
}

/** Host lobby broadcast: the spectators' names (`sp` on the `lobby` message). */
export function spectateLobby(g: Game): string[] | undefined {
  const st = states.get(g);
  return st?.specs.length ? st.specs.map((s) => s.name) : undefined;
}

/** Host, top of onHostMessage: spectator hellos and everything a spectator sends. True if consumed. */
export function spectateHostMessage(g: Game, from: string, m: Record<string, unknown>): boolean {
  if (g.role !== 'host' || !g.host) return false;
  const st = spectateState(g);
  const spec = specByPeer(st, from);
  if (m.t === 'hello') {
    if (spec) return true;
    return seatHello(g, st, from, m);
  }
  if (!spec) return false;
  switch (m.t) {
    case 'spv':
      spec.follow = Math.floor(Number(m.f));
      if (!Number.isFinite(spec.follow) || spec.follow < 0) spec.follow = 0;
      spec.free = !!m.free;
      spec.x = clampView(Number(m.x) || 0, g.arena.halfSize);
      spec.z = clampView(Number(m.z) || 0, g.arena.halfSize);
      break;
    case 'emote': {
      const e = emoteOf(m.k);
      if (e && spec.lim.allow(now())) addEmote(g, st, spec.name, EMOTES.indexOf(e));
      break;
    }
    case 'spjoin':
      spec.wantJoin = !!m.on;
      if (spec.wantJoin && !inRun(g)) toLobby(g, st, spec);
      break;
    case 'loadout':
      spec.hello.loadout = m.loadout;
      break;
    case 'hb':
      g.host.send(from, { t: 'hb', c: m.c });
      break;
  }
  return true; // spectators never reach the player paths
}

function seatHello(g: Game, st: SpecState, from: string, m: Record<string, unknown>): boolean {
  const name = String(m.name ?? 'Player').slice(0, 12);
  const pid = typeof m.pid === 'string' ? m.pid.slice(0, 16) : '';
  const cs = coopState(g);
  const run = inRun(g);
  const reclaim = run && g.heroes.some((h, i) => i !== g.local && (pid ? cs.pids[i] === pid : h.name === name));
  const active = g.heroes.filter((h) => !h.left).length + cs.pending.filter((p) => p.reclaim < 0).length;
  const why = seatFor({
    asked: !!m.spec,
    allowed: settings.spectators !== false,
    wasSpectator: !!pid && st.recent.has(pid),
    full: run ? !slotOpen(active, lobbyCap(g.lobbyKind)) : g.lobby.length >= lobbyCap(g.lobbyKind) && !g.lobby.some((p) => p.peerId === from),
    closed: run && (!!g.pvp || g.mode === 'dead' || !joinable(g)),
    reclaim,
  });
  if (!why) return false;
  if (st.specs.length >= spectateTuning.max) {
    g.host!.send(from, { t: 'full', reason: t('spec.seatsFull') });
    return true;
  }
  const spec: HostSpec = { peerId: from, name, pid, hello: { ...m, spec: undefined }, follow: 0, free: false, x: 0, z: 0, enc: new SnapEncoder(), cur: { sk: 0, ns: 0, tm: 0, co: 0 }, runKey: '', lim: new EmoteLimiter(), wantJoin: false, joining: false };
  st.specs.push(spec);
  if (pid) st.recent.add(pid);
  g.host!.send(from, { t: 'spwelcome', why, max: spectateTuning.max });
  if (!run) g.refreshLobby();
  else g.vfx.toast(`${name.toUpperCase()} IS WATCHING`, 2);
  return true;
}

/** A spectator in the lobby takes a free player slot: it goes through the normal hello. */
function toLobby(g: Game, st: SpecState, spec: HostSpec): void {
  if (!slotOpen(g.lobby.length, lobbyCap(g.lobbyKind))) return;
  st.specs.splice(st.specs.indexOf(spec), 1);
  if (spec.pid) st.recent.delete(spec.pid);
  g.host!.send(spec.peerId, { t: 'spplay' });
  g.onHostMessage(spec.peerId, { ...spec.hello, t: 'hello', mods: modSession.hash });
}

/** Host: a connection closed. True if it was a spectator. */
export function spectateLeft(g: Game, id: string): boolean {
  const st = states.get(g);
  const spec = st && specByPeer(st, id);
  if (!st || !spec) return false;
  st.specs.splice(st.specs.indexOf(spec), 1);
  if (!inRun(g) && g.role === 'host') g.refreshLobby();
  return true;
}

function addEmote(g: Game, st: SpecState, name: string, k: number): void {
  st.emotes.push({ seq: ++st.seq, name, k, at: now() });
  if (st.emotes.length > 12) st.emotes.shift();
  if (g.role === 'host') showEmote(st, name, k); // the host sees it at once
}

// ---------------------------------------------------------------- host: every step and the snapshots

function runKey(g: Game): string {
  if (!inRun(g) || g.role !== 'host') return '';
  if (g.pvp) return g.pvp.phase === 'duel' ? `d|${g.seed}|${(g.pvp as { round?: number }).round ?? 0}` : '';
  return `r|${g.seed}`;
}

function roster(g: Game): { name: string; skin: string; pet: string; hero: string; look: string }[] {
  return g.heroes.map((x) => ({ name: x.name, skin: x.skin.id, pet: x.pet, hero: x.heroDef.id, look: x.player.look }));
}

/** Host, in hostTick before the snapshot cadence: run starts, joins, roster changes. */
export function spectateHostStep(g: Game): void {
  const st = states.get(g);
  if (!st?.specs.length || !g.host) return;
  // Admitted as a player through coop2: no longer a spectator.
  for (let i = st.specs.length - 1; i >= 0; i--) {
    const s = st.specs[i];
    if (g.heroByPeer(s.peerId)) {
      st.specs.splice(i, 1);
      if (s.pid) st.recent.delete(s.pid);
    }
  }
  // A spectator that went silent (closed tab, lost link) frees its seat, like a silent player (netcode lane).
  const tNow = performance.now();
  for (const s of [...st.specs]) {
    const heard = g.host.lastHeard?.get(s.peerId); // (in-process test transports have none)
    if (heard !== undefined && tNow - heard > netQualityTuning.dropMs) g.host.drop?.(s.peerId); // onLeave -> spectateLeft
  }
  const key = runKey(g);
  for (const s of st.specs) {
    if (key && s.runKey !== key) startSpectator(g, st, s, key);
    else if (!key && !inRun(g)) s.runKey = '';
  }
  if (!key) return;
  const sig = g.heroes.map((h) => `${h.name}|${h.heroDef.id}`).join(',');
  if (sig !== st.roster) {
    st.roster = sig;
    for (const s of st.specs) if (s.runKey === key) g.host.send(s.peerId, { t: 'roster', players: roster(g) });
  }
  // Play from the next stage: a new stage started (or we're between stages) and a slot is free.
  const nextStage = g.stage !== st.stage;
  st.stage = g.stage;
  const between = g.mode === 'cleared' || g.mode === 'portal' || g.mode === 'transition';
  if (!nextStage && !between) return;
  const cs = coopState(g);
  for (const s of st.specs) {
    if (!s.wantJoin || s.joining || g.pvp || !joinable(g)) continue;
    const busy = g.heroes.filter((h) => !h.left).length + cs.pending.filter((p) => p.reclaim < 0).length;
    if (!slotOpen(busy, lobbyCap(g.lobbyKind))) continue;
    s.joining = true;
    if (s.pid) st.recent.delete(s.pid);
    g.coopHello(s.peerId, { ...s.hello, t: 'hello' }); // waits for coop2's safe moment, then `start` with join: 1
  }
}

function startSpectator(g: Game, st: SpecState, s: HostSpec, key: string): void {
  s.runKey = key;
  s.enc = new SnapEncoder(); // a keyframe for the new run
  if (!g.heroes[s.follow] || g.heroes[s.follow].left) s.follow = Math.max(0, g.heroes.findIndex((h) => !h.left));
  // Event cursors: start from now (no replay of the run's old events).
  s.cur = {
    sk: Math.max(0, ...g.heroes.map((h) => h.skill.sentEv)),
    ns: -1,
    tm: timeState(g).seq,
    co: coopState(g).seq,
  };
  st.stage = g.stage;
  const meta = { heat: g.meta.heat, week: g.meta.week, clears: g.victories };
  g.host!.send(s.peerId, {
    t: 'spstart',
    start: { t: 'start', mods: modSession.hash, season: g.halloween.season, candyBaseline: g.halloween.earned, meta, seed: g.seed, difficulty: g.difficulty.id, you: s.follow, players: roster(g) },
    stage: { t: 'stage', season: g.halloween.season, stage: g.stage, seed: g.seed },
    ch: g.chests.list.map((c) => [r2(c.x), r2(c.z), r2(c.facing), c.openT >= 0 ? 1 : 0]),
    ba: g.barrels.list.map((b, i) => (b.alive ? -1 : i)).filter((i) => i >= 0),
    cv: brokenCover(g),
    cs: g.arenaStage,
  });
  st.roster = '';
}

/** Swap a spectator's event cursors onto the hero its snapshot is built for (and back). */
function swapCursors(g: Game, h: Hero, c: Cursors): Cursors {
  const ht = heroTimeOf(g, h);
  const cs = coopState(g);
  const was: Cursors = { sk: h.skill.sentEv, ns: h.skill.netSeq, tm: ht.sentEv, co: cs.sent[h.index] ?? 0 };
  h.skill.sentEv = c.sk;
  h.skill.netSeq = c.ns;
  ht.sentEv = c.tm;
  cs.sent[h.index] = c.co;
  return was;
}

/** Host, in hostTick after the players' snapshots: every 2nd one goes to the spectators too. */
export function spectateSend(g: Game, events: VfxEvent[]): void {
  const st = states.get(g);
  if (!st?.specs.length || !g.host) return;
  for (const e of events) st.fxBuf.push(e);
  if (++st.tick % spectateTuning.snapEvery !== 0) return;
  const key = runKey(g);
  if (key) {
    const r = INTEREST * spectateTuning.interestMul;
    for (const s of st.specs) {
      if (s.runKey !== key) continue;
      const fh = g.heroes[s.follow];
      const forHero = fh && !fh.left ? fh : (g.heroes.find((h) => !h.left) ?? g.heroes[0]);
      const follow = s.free ? null : forHero;
      if (!forHero) continue;
      const x = follow ? follow.player.x : s.x;
      const z = follow ? follow.player.z : s.z;
      const was = swapCursors(g, forHero, s.cur);
      let snap: Record<string, unknown>;
      try {
        snap = g.buildSnapshot(forHero, st.fxBuf, { x, z, r, enc: s.enc, peer: s.peerId });
      } finally {
        s.cur = swapCursors(g, forHero, was);
      }
      g.host.send(s.peerId, snap);
    }
  }
  st.fxBuf.length = 0;
}

/** Snapshot field `sp`: watchers, their emotes (last few seconds) and, for a spectator, its join state. */
export function spectateNet(g: Game, view?: SnapView): Record<string, unknown> | undefined {
  const st = states.get(g);
  if (!st || (!st.specs.length && !st.emotes.length)) return undefined;
  const tNow = now();
  while (st.emotes.length && tNow - st.emotes[0].at > spectateTuning.emoteShow) st.emotes.shift();
  const out: Record<string, unknown> = { n: st.specs.length, w: st.specs.map((s) => s.name) };
  if (st.emotes.length) out.e = st.emotes.map((e) => [e.seq, e.name, e.k]);
  if (view) {
    const spec = specByPeer(st, view.peer);
    const cs = coopState(g);
    const busy = g.heroes.filter((h) => !h.left).length + cs.pending.filter((p) => p.reclaim < 0).length;
    out.me = [spec?.wantJoin || spec?.joining ? 1 : 0, Math.max(0, 4 - busy), joinable(g) && !g.pvp ? 1 : 0];
  }
  return out;
}

// ---------------------------------------------------------------- client: messages

/** Client, top of onClientMessage (after the mods check). True if consumed. */
export function spectateClientMsg(g: Game, m: Record<string, unknown>): boolean {
  const st = spectateState(g);
  switch (m.t) {
    case 'spwelcome': {
      st.on = true;
      st.want = false;
      st.why = (String(m.why) as SeatReason) || 'chosen';
      g.hud.toast(t(st.why === 'full' ? 'spec.welcomeFull' : st.why === 'closed' ? 'spec.welcomeClosed' : 'spec.welcomeChosen'), 3);
      if (!inRun(g)) g.screens.setLobby({ code: g.client?.code ?? '', players: [], isHost: false, status: t('spec.lobbyStatus') });
      return true;
    }
    case 'spstart':
      beginWatching(g, st, m);
      return true;
    case 'spplay':
      st.on = false;
      st.queued = false;
      return true;
    case 'lobby':
      st.lobbyNames = Array.isArray(m.sp) ? (m.sp as unknown[]).map((x) => String(x).slice(0, 12)) : [];
      if (st.on && !inRun(g)) {
        // The base lobby view says "Connected!"; the client is a spectator.
        queueMicrotask(() => {
          const s = g.screens.current === 'online' ? document.querySelector('#scr-online .mp-status') : null;
          if (s && st.on) s.textContent = t('spec.lobbyStatus');
        });
      }
      return false;
  }
  if (!st.on) return false;
  switch (m.t) {
    case 'start':
      if (!st.starting) stopWatching(g, st, true); // coop2 admitted us as a player
      return false;
    case 'cowait':
      st.joinMsg = String(m.msg ?? '');
      return true;
    case 'full':
      if (!inRun(g)) return false;
      st.queued = false;
      g.hud.toast(String(m.reason ?? t('spec.noSlot')), 3);
      return true;
    case 'pvpgo':
      st.pvpWait = true;
      g.screens.showWait([], t('spec.pvpWait'));
      return true;
    case 'pvpstat':
      if (!inRun(g) || st.pvpWait) g.screens.showWait((m.rows as string[]) ?? [], t('spec.pvpWait'));
      return true;
    case 'lbtolobby':
      st.pvpWait = false;
      hideRunUi(st);
      return false;
  }
  return false;
}

function beginWatching(g: Game, st: SpecState, m: Record<string, unknown>): void {
  const start = (m.start ?? {}) as Record<string, unknown>;
  st.on = true;
  st.starting = true;
  st.pvpWait = false;
  try {
    g.onClientMessage(start);
    g.onClientMessage((m.stage ?? {}) as Record<string, unknown>);
  } finally {
    st.starting = false;
  }
  if (g.mode === 'title') return; // refused (mods mismatch): onClientMessage left already
  // One-off world state from before we came: chests, blown barrels, broken cover (as coop2's cojoin).
  g.chests.clear();
  for (const c of (m.ch as number[][]) ?? []) {
    g.chests.add(c[0], c[1], c[2]);
    if (c[3]) g.chests.open(g.chests.list.length - 1);
  }
  for (const i of (m.ba as number[]) ?? []) {
    const b = g.barrels.remove(i);
    if (b) g.removeBarrelCollider(b);
  }
  for (const i of (m.cv as number[]) ?? []) onCoverMsg(g, { i, s: m.cs });
  for (const h of g.heroes) h.player.showWhenDead = true;
  st.follow = Math.max(0, Math.min(g.heroes.length - 1, Number(start.you) || 0));
  st.director = new AutoDirector();
  st.director.target = st.follow;
  st.queued = false;
  st.joinMsg = '';
  st.sentView = '';
  st.shown = 0;
  const p = g.heroes[st.follow]?.player;
  st.fx = p?.x ?? 0;
  st.fz = p?.z ?? 0;
  document.body.classList.add('spectating');
  g.screens.show('none');
}

function hideRunUi(st: SpecState): void {
  document.body.classList.remove('spectating', 'sp-cast');
  st.ui?.hideRun();
}

function stopWatching(g: Game, st: SpecState, joined: boolean): void {
  st.on = false;
  st.queued = false;
  st.pvpWait = false;
  hideRunUi(st);
  if (joined) g.hud.toast(t('spec.joined'), 2.5);
}

/** Players and spectators: the `sp` snapshot field. */
export function applySpectateNet(g: Game, raw: unknown): void {
  const st = spectateState(g);
  const d = (raw ?? null) as { n?: number; w?: string[]; e?: [number, string, number][]; me?: [number, number, number] } | null;
  st.watchers.n = Number(d?.n) || 0;
  st.watchers.w = (d?.w ?? []).map((x) => String(x).slice(0, 12));
  st.me = d?.me ?? null;
  if (st.on && st.me) st.queued = !!st.me[0];
  for (const e of d?.e ?? []) {
    if (e[0] <= st.shown) continue;
    st.shown = e[0];
    showEmote(st, String(e[1]), Number(e[2]));
  }
}

function showEmote(st: SpecState, name: string, k: number): void {
  const e = EMOTES[k];
  if (!e) return;
  st.ui?.emote(name, e);
  sfx.ui('flip', 0.4);
}

// ---------------------------------------------------------------- client: the spectator's step

/** Top of clientUpdate: a spectator's own loop instead of the hero's. True if it ran. */
export function spectateClientUpdate(g: Game, dt: number): boolean {
  const st = states.get(g);
  if (!st?.on) return false;
  if (!g.client) {
    stopWatching(g, st, false);
    return false;
  }
  if (!inRun(g)) return false; // the lobby: the normal client menus
  netcodeStep(g); // playout clock, quality reports (systems/netcode.ts)
  const input = g.input;
  if (g.screens.current === 'none' && (input.keyPressed('Escape') || input.actionPressed('pause') || input.padButtonPressed(9))) {
    g.pause();
    input.endStep();
    return true;
  }
  g.screens.update(input, dt);
  if (g.paused && g.screens.current === 'none') g.paused = false;
  if (g.screens.current === 'none') controls(g, st, dt);
  directorStep(g, st, dt);
  if (st.cam !== 'free' && g.heroes[st.follow] && g.local !== st.follow) {
    g.local = st.follow; // the HUD (life, loadout, style) shows who we watch
    g.hero.loadoutDirty = true;
  }
  sendView(g, st, dt);
  g.runTime += dt;
  if (g.mode !== 'levelup' && g.mode !== 'shop') {
    g.bullets.integrate(dt);
    for (let i = 0; i < g.bullets.count; i++) if (g.bullets.life[i] <= 0) g.bullets.kill(i--);
  }
  if (g.isCombatMode) g.modesLocal(dt); // the rhythm stage's beat keeps moving between snapshots
  g.biomeFoesClient(dt);
  g.particles.update(dt);
  g.fx.update(dt);
  if (g.fadeT > 0) g.fadeT -= dt;
  coopState(g).net.buy = null; // nothing to buy back: we have no hero
  input.endStep();
  return true;
}

function watchable(g: Game): boolean[] {
  return g.heroes.map((h) => !h.left && !h.player.dead);
}

function controls(g: Game, st: SpecState, dt: number): void {
  const input = g.input;
  const any = (bs: readonly number[]) => bs.some((b) => input.padButtonPressed(b));
  let w = watchable(g);
  if (!w.some(Boolean)) w = g.heroes.map((h) => !h.left);
  if (input.mousePressed(0) || input.padButtonPressed(0)) setFollow(st, cycleFollow(st.follow, w, 1));
  if (input.actionPressed('dash') || input.padButtonPressed(4)) setFollow(st, cycleFollow(st.follow, w, -1));
  if (input.actionPressed('reroll') || input.padButtonPressed(3)) {
    st.cam = st.cam === 'follow' ? 'auto' : st.cam === 'auto' ? 'free' : 'follow';
    if (st.cam === 'auto') st.director.target = st.follow;
    if (st.cam === 'free') centreFree(g, st);
    sfx.ui('toggle');
  }
  if (input.actionPressed('bomb') || input.padButtonPressed(5) || input.keyPressed('KeyO')) {
    st.overlay = !st.overlay;
    sfx.ui('toggle');
  }
  if (input.actionPressed('team') || any(PAD_TEAM)) requestJoin(g, st);
  for (let k = 0; k < EMOTES.length; k++) if (input.keyPressed(`Digit${k + 1}`)) sendEmote(g, st, k);
  if (input.actionPressed('cashpick') || any(PAD_CASHPICK)) st.emoteSel = (st.emoteSel + EMOTES.length - 1) % EMOTES.length;
  if (input.actionPressed('cash') || any(PAD_CASH)) st.emoteSel = (st.emoteSel + 1) % EMOTES.length;
  if (input.padButtonPressed(2)) sendEmote(g, st, st.emoteSel);
  // Free camera: the move keys / left stick pan (and switch to it).
  const mx = input.move.x;
  const mz = input.move.y;
  if (Math.abs(mx) + Math.abs(mz) > 0.2) {
    if (st.cam !== 'free') {
      centreFree(g, st);
      st.cam = 'free';
    }
    const sp = spectateTuning.freeSpeed * (0.6 + 0.4 * g.cam.zoom) * dt;
    st.fx = clampView(st.fx + mx * sp, g.arena.halfSize);
    st.fz = clampView(st.fz + mz * sp, g.arena.halfSize);
  }
}

function centreFree(g: Game, st: SpecState): void {
  st.fx = g.playerPos.x;
  st.fz = g.playerPos.z;
}

function setFollow(st: SpecState, i: number): void {
  st.follow = i;
  if (st.cam !== 'follow') st.cam = 'follow';
  sfx.ui('move');
}

function directorStep(g: Game, st: SpecState, dt: number): void {
  const fh = g.heroes[st.follow];
  // Follow mode: if they go down, watch someone still standing (after a beat, like the downed camera).
  if (st.cam === 'follow' && fh && (fh.left || fh.player.dead)) {
    st.director.held += dt;
    if (st.director.held > 2.5) {
      const w = watchable(g);
      if (w.some(Boolean)) st.follow = cycleFollow(st.follow, w, 1);
      st.director.held = 0;
    }
  }
  if (st.cam !== 'auto') return;
  const boss = g.boss && g.boss.active ? g.boss : null;
  const scores = g.heroes.map((h) => {
    const p = h.player;
    let crowd = 0;
    for (const e of g.enemies.list) if (e.active && Math.abs(e.x - p.x) < 10 && Math.abs(e.z - p.z) < 10) crowd++;
    return directorScore({
      alive: !h.left && !p.dead,
      hp01: h.stats.maxHp > 0 ? p.hp / h.stats.maxHp : 1,
      bossDist: boss ? Math.hypot(boss.x - p.x, boss.z - p.z) : Infinity,
      crowd,
      rank: rankOf(h.skill.style.points),
      ult: h.skill.ultT > 0,
      hurt: p.hurtFlash > 0,
    });
  });
  const pick = st.director.step(dt, scores);
  if (pick >= 0) st.follow = pick;
}

function sendView(g: Game, st: SpecState, dt: number): void {
  st.viewT -= dt;
  if (st.viewT > 0) return;
  const f = st.follow;
  const free = st.cam === 'free' ? 1 : 0;
  const key = `${f}|${free}|${Math.round(st.fx)}|${Math.round(st.fz)}`;
  if (key === st.sentView && st.viewT > -1) return; // nothing new: a keep-alive every ~1.25 s
  st.viewT = spectateTuning.viewEvery;
  st.sentView = key;
  g.client?.send({ t: 'spv', f, free, x: r2(st.fx), z: r2(st.fz) });
}

function sendEmote(g: Game, st: SpecState, k: number): void {
  const e = EMOTES[k];
  if (!e) return;
  st.emoteSel = k;
  g.client?.send({ t: 'emote', k: e.id });
}

function requestJoin(g: Game, st: SpecState): void {
  if (g.pvp || (st.me && !st.me[2])) {
    g.hud.toast(t('spec.closed'), 2.5);
    return;
  }
  st.queued = !st.queued;
  g.client?.send({ t: 'spjoin', on: st.queued ? 1 : 0 });
  sfx.ui(st.queued ? 'confirm' : 'back');
}

// ---------------------------------------------------------------- render (every machine)

/** Render, after pvp2Frame and before the camera rig: the spectator's camera and every overlay. */
export function spectateFrame(g: Game, frameDt: number): void {
  const st = states.get(g);
  if (!st?.ui) return;
  const watching = st.on && (g.role === 'client' || st.preview) && inRun(g);
  if (watching && st.preview) directorStep(g, st, frameDt);
  if (watching) {
    const fh = g.heroes[st.follow];
    if (st.cam === 'free' || !fh) g.playerPos.set(st.fx, 0, st.fz);
    else {
      fh.player.renderPos(netInterpAlpha(g), g.playerPos);
      st.fx = g.playerPos.x;
      st.fz = g.playerPos.z;
    }
    g.lead.set(0, 0, 0);
    g.cam.frameTeam(0, 0, 1);
  }
  if (!st.ui.due(frameDt)) return;
  if (watching) {
    document.body.classList.add('spectating');
    document.body.classList.toggle('sp-cast', st.overlay);
  }
  const showRun = inRun(g) && (g.role !== 'solo' || watching || st.watchers.n > 0);
  const n = g.role === 'host' ? st.specs.length : st.watchers.n;
  st.ui.update({
    watching,
    badge: showRun ? n : 0,
    cast: watching && st.overlay ? castCards(g) : null,
    follow: watching && st.cam !== 'free' ? followCard(g, st) : null,
    focus: st.cam === 'free' ? -1 : st.follow,
    cam: st.cam,
    emoteSel: st.emoteSel,
    emotes: EMOTES,
    join: watching ? joinText(g, st) : '',
    status: watching ? statusText(g) : '',
    stage: g.stage,
    level: g.level,
    over: watching && g.mode === 'dead' ? t('spec.overSub', { stage: g.stage, score: Math.round(g.score).toLocaleString('en-US') }) : '',
  });
}

function heroCard(g: Game, h: Hero): CastCard {
  const p = h.player;
  return {
    i: h.index,
    name: h.name,
    color: h.color,
    hp01: h.stats.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / h.stats.maxHp)) : 0,
    hp: Math.max(0, Math.ceil(p.hp)),
    down: p.dead && !h.left,
    left: h.left,
    rank: rankOf(h.skill.style.points),
    ult: h.skill.ultT > 0,
    weapons: h.weapons.map((wp) => ({ id: wp.def.id, color: wp.def.color, icon: wp.def.icon, level: wp.level, slot: wp.def.slot ?? 'auto' })),
    look: heroPortrait(g, h),
  };
}

function castCards(g: Game): CastCard[] {
  return g.heroes.filter((h) => !h.left).map((h) => heroCard(g, h));
}

function followCard(g: Game, st: SpecState): CastCard | null {
  const h = g.heroes[st.follow];
  return h ? heroCard(g, h) : null;
}

function joinText(g: Game, st: SpecState): string {
  if (g.pvp) return '';
  if (st.joinMsg) return st.joinMsg.toUpperCase();
  if (st.queued) return t('spec.joinQueued');
  if (st.me && !st.me[2]) return '';
  const free = st.me ? st.me[1] : 4 - g.heroes.filter((h) => !h.left).length;
  return free > 0 ? `${t('spec.join')} · ${t('spec.slots', { n: free })}` : t('spec.noSlot');
}

function statusText(g: Game): string {
  if (g.mode === 'levelup') return t('spec.levelup');
  if (g.mode === 'shop') return t('spec.shop');
  return '';
}

// ---------------------------------------------------------------- dev / tests

/** Test links: a local preview of the spectator view over a solo run (no connection). */
export function spectatePreview(g: Game, cam: CamMode, follow: number, overlay: boolean): void {
  const st = spectateState(g);
  st.on = st.preview = true;
  st.cam = cam;
  st.follow = follow;
  st.director.target = follow;
  st.overlay = overlay;
  st.fx = g.player.x + 6;
  st.fz = g.player.z - 4;
}

/** Test links: fake watchers (names) for the players' badge, and a spectator emote in the feed. */
export function spectateFakeWatchers(g: Game, names: string[]): void {
  const st = spectateState(g);
  st.watchers.n = names.length;
  st.watchers.w = names;
}

export function spectateFakeLobby(g: Game, names: string[]): void {
  spectateState(g).lobbyNames = names;
  const el = document.querySelector<HTMLElement>('#scr-online');
  if (el) renderLobbyWatchers(g, el, false);
}

export function spectateFakeEmote(g: Game, name: string, id: string): void {
  const e = emoteOf(id);
  if (e) showEmote(spectateState(g), name, EMOTES.indexOf(e));
}
