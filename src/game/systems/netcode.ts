/**
 * Netcode lane: online play that survives the real internet.
 *
 * - Quality: the host probes every client (`np`, echoed) for its round trip
 *   and lost probes; clients report their snapshot rate, jitter and stall
 *   estimate (`nst`). The host sends everyone's numbers in the snapshot field
 *   `nq`, so every HUD can show the NETWORK panel and warn about a teammate
 *   with a bad connection (src/ui/netOverlay.ts).
 * - Playout: a real client applies snapshots through an adaptive jitter buffer
 *   (src/net/interp.ts) and draws remote things between two known states.
 * - Lag compensation: clients say which host step they were looking at (`vt`
 *   in their input); the host keeps enemy positions for 16 steps and tests a
 *   remote hero's bullets against where enemies were on that screen
 *   (src/net/lagcomp.ts, called from updateBullets in systems/statuses.ts).
 * - Reconnect: a silent connection is dropped on both sides (the host puts the
 *   hero on the coop2 autopilot), and the client keeps trying to get back in
 *   for 60 s with the same player id, so it reclaims its hero and build. A
 *   reloaded tab rejoins too (`infinishoot.net.rejoin`, kept 60 s).
 */
import type { Game } from '../game';
import type { Hero } from '../hero';
import { Playout, isTeleport, interpTuning } from '../../net/interp';
import { EnemyHistory, allowedRewind, lagTuning } from '../../net/lagcomp';
import { BulletDeltaDecoder } from '../../net/bulletCodec';
import { ProbeTracker, netLevel, netQualityTuning } from '../../net/netQuality';
import { NetClient } from '../../net/peer';
import { parseNetSim, setNetSim } from '../../net/netsim';
import { NetOverlay, type NetRow, type NetTag, type NetView } from '../../ui/netOverlay';
import { settings } from '../settings';
import { loadJson, saveJson } from '../../core/storage';
import { clientRtt } from '../netFeel';
import { coop2Debug } from './coop2';
import { coopPlayerId } from '../coop2';
import { localHero } from '../game';
import { unlockedLoadout, unlockedWeapons } from '../save';
import { validLoadout } from '../../data/loadout';
import { cleanLook } from '../../data/customise';
import type { Enemy } from '../enemies';
import type { NetBytes } from '../../net/bytes';
import { modSession } from '../../mods/manager';
import { myProfile } from './party';
import { profileSummary } from './meta2';

// A simulated bad connection for this machine's client side: `?netsim=90,30,0.03` (latency ms, jitter ms, loss).
if (typeof location !== 'undefined') {
  try {
    setNetSim(parseNetSim(new URLSearchParams(location.search).get('netsim')));
  } catch {
    // no URL (tests)
  }
}
if (typeof window !== 'undefined' && import.meta.env?.DEV) (window as unknown as { netsim: typeof setNetSim }).netsim = setNetSim;

/** Per-hero numbers the host shares: [rtt ms, loss %, snapshots/s, reconnect (s left, -1 not responding, 0 fine)]. */
export type NqRow = [number, number, number, number];

interface Reconnect {
  code: string;
  name: string;
  /** performance.now() when it gives up, when the next try goes, tries so far. */
  until: number;
  next: number;
  tries: number;
  /** A connection being set up. */
  pending: NetClient | null;
  /** Connected and said hello: waiting for the host's `start` (since helloAt). */
  hello: boolean;
  helloAt: number;
}

interface NetState {
  // client
  playout: Playout<Record<string, unknown>> | null;
  bullets: BulletDeltaDecoder;
  nextReport: number;
  rc: Reconnect | null;
  lastSnapStep: number;
  // host
  history: EnemyHistory;
  probes: Map<string, ProbeTracker>;
  nextProbe: number;
  reports: Map<string, { rate: number; loss: number; jitter: number; delay: number }>;
  lag: number[];
  pidByPeer: Map<string, string>;
  // both
  nq: NqRow[];
  overlay: NetOverlay | null;
  rejoinChecked: boolean;
  rejoinSaved: number;
  /** This machine's own loop stalled (a long frame, a hidden tab): don't blame the network until this time. */
  lastStepAt: number;
  stallUntil: number;
  /** Recent connection events (debugging, `npm run coop` prints them). */
  events: string[];
}

const states = new WeakMap<Game, NetState>();
function st(g: Game): NetState {
  let s = states.get(g);
  if (!s) {
    s = {
      playout: null,
      bullets: new BulletDeltaDecoder(),
      nextReport: 0,
      rc: null,
      lastSnapStep: -1,
      history: new EnemyHistory(),
      probes: new Map(),
      nextProbe: 0,
      reports: new Map(),
      lag: [],
      pidByPeer: new Map(),
      nq: [],
      overlay: null,
      rejoinChecked: false,
      rejoinSaved: 0,
      lastStepAt: 0,
      stallUntil: 0,
      events: [],
    };
    states.set(g, s);
  }
  return s;
}

function note(s: NetState, msg: string): void {
  s.events.push(`${(performance.now() / 1000).toFixed(1)}s ${msg}`);
  if (s.events.length > 40) s.events.shift();
}

/** Log a connection event (systems/netHost.ts). */
export function netcodeNote(g: Game, msg: string): void {
  note(st(g), msg);
}

/** The lane's state (tests, test links). */
export function netcodeState(g: Game): NetState {
  return st(g);
}

// ---------------------------------------------------------------- per step

/** Every step on every machine (from hostTick on solo/host, clientUpdate on clients). */
export function netcodeStep(g: Game, frozen = false): void {
  const s = st(g);
  const now = performance.now();
  // Our own loop stood still (loading, a hidden tab, a slow machine): messages may be waiting unread, so give them time.
  if (s.lastStepAt && now - s.lastStepAt > 1000) s.stallUntil = now + 3000;
  s.lastStepAt = now;
  if (!s.rejoinChecked) {
    s.rejoinChecked = true;
    tryRejoinAfterReload(g);
  }
  if (g.role === 'host') hostStep(g, s, now, frozen);
  else if (g.role === 'client') clientStep(g, s, now);
  else {
    if (s.rc) endReconnect(s);
    clearRejoin(s);
  }
}

function hostStep(g: Game, s: NetState, now: number, frozen: boolean): void {
  const host = g.host;
  if (!host) return;
  clearRejoin(s);
  // Enemy positions for lag compensation (only when someone remote can use them).
  if (!frozen && g.isCombatMode && g.heroes.some((h) => h.peerId)) s.history.record(g.stepN, g.enemies.list);
  // Player ids for lobby players (coop2 only records them for mid-run joiners), so a reconnect matches.
  const pids = coop2Debug(g).pids;
  for (const h of g.heroes) {
    if (!h.peerId) continue; // party restarts can renumber the remaining heroes
    const pid = s.pidByPeer.get(h.peerId);
    if (pid) pids[h.index] = pid;
  }
  if (g.mode === 'title') return;
  // Probes and silent connections.
  const T = netQualityTuning;
  const probe = now >= s.nextProbe;
  if (probe) s.nextProbe = now + T.probeEvery * 1000;
  for (const h of g.heroes) {
    if (!h.peerId) continue;
    let p = s.probes.get(h.peerId);
    if (!p) s.probes.set(h.peerId, (p = new ProbeTracker()));
    if (probe) {
      if (now > s.stallUntil) p.expire(now); // after our own stall, echoes may still be waiting unread
      host.send(h.peerId, { t: 'np', n: p.next(now) });
    }
    const heard = host.lastHeard?.get(h.peerId); // (in-process test transports have none)
    if (heard !== undefined && now - heard > T.dropMs && !h.left && now > s.stallUntil) {
      note(s, `host: ${h.name} silent ${Math.round(now - heard)} ms, dropped`);
      g.vfx.toast(`${h.name.toUpperCase()} STOPPED RESPONDING`, 2.5);
      host.drop?.(h.peerId); // onLeave -> coop2 autopilot grace (or a clean leave)
    }
  }
}

/** Host: everyone's connection numbers for the snapshot. */
function hostNq(g: Game, s: NetState, now: number): NqRow[] {
  const grace = coop2Debug(g).grace;
  return g.heroes.map((h): NqRow => {
    const gr = grace.find((x) => x.index === h.index);
    if (gr) return [0, 0, 0, Math.max(1, Math.ceil(gr.t))];
    if (!h.peerId) return [0, 0, 0, 0];
    const p = s.probes.get(h.peerId);
    const rep = s.reports.get(h.peerId);
    const heard = g.host?.lastHeard?.get(h.peerId);
    const silent = heard !== undefined && now - heard > netQualityTuning.staleMs;
    const loss = Math.max(p?.loss ?? 0, rep?.loss ?? 0);
    return [Math.round((p?.rtt ?? 0) / 5) * 5, Math.round(loss * 100), Math.round(rep?.rate ?? 0), silent ? -1 : 0];
  });
}

function clientStep(g: Game, s: NetState, now: number): void {
  const c = g.client;
  // Playout: apply what's due.
  if (s.playout) s.playout.update(now, (m) => applySnap(g, s, m));
  if (s.rc) {
    reconnectStep(g, s, now);
    return;
  }
  if (!c) return;
  const inRun = g.mode !== 'title' && !g.pvp;
  // Quality report to the host.
  if (inRun && now >= s.nextReport && c.open) {
    s.nextReport = now + netQualityTuning.reportEvery * 1000;
    const ps = s.playout?.stats;
    c.send({ t: 'nst', r: ps ? Math.round(ps.rate * 10) / 10 : 0, l: ps ? Math.round(ps.loss * 1000) / 1000 : 0, j: ps ? Math.round(ps.jitter) : 0, d: ps ? Math.round(ps.delay) : 0 });
  }
  // The host went quiet: give up on this connection (onClose starts the reconnect).
  if (inRun && c.lastHeard > 0 && now - c.lastHeard > netQualityTuning.hostSilentMs && now > s.stallUntil && c instanceof NetClient) {
    note(s, `client: host silent ${Math.round(now - c.lastHeard)} ms, dropping`);
    c.drop();
  }
  // Remember the run for a tab reload.
  if (inRun && now - s.rejoinSaved > 2000 && c instanceof NetClient) {
    s.rejoinSaved = now;
    saveJson('net.rejoin', { code: c.code, name: g.netName || 'Player', at: Date.now() });
  }
}

// ---------------------------------------------------------------- messages

/** Host: a quality message from a client's hero (or its pid in a hello). True if handled. */
export function netcodeHostMsg(g: Game, from: string, m: Record<string, unknown>): boolean {
  const s = st(g);
  if (m.t === 'np') {
    s.probes.get(from)?.answer(Number(m.n), performance.now());
    return true;
  }
  if (m.t === 'nst') {
    const n = (v: unknown, max: number) => Math.max(0, Math.min(max, Number(v) || 0));
    s.reports.set(from, { rate: n(m.r, 120), loss: n(m.l, 1), jitter: n(m.j, 5000), delay: n(m.d, 5000) });
    return true;
  }
  return false;
}

/**
 * Host: a `hello`. Remembers the player id, and if it belongs to a hero whose
 * old connection is still open (the host hasn't noticed the drop yet), drops
 * that connection first so the hello reclaims the hero instead of adding one.
 */
export function netcodeHello(g: Game, from: string, m: Record<string, unknown>): void {
  const s = st(g);
  const pid = typeof m.pid === 'string' ? m.pid.slice(0, 16) : '';
  if (!pid) return;
  s.pidByPeer.set(from, pid);
  if (g.role !== 'host' || g.mode === 'title' || g.pvp) return;
  const pids = coop2Debug(g).pids;
  const h = g.heroes.find((x) => pids[x.index] === pid && x.peerId && x.peerId !== from && !x.left);
  note(s, `host: hello from ${from.slice(0, 6)} pid ${pid.slice(0, 6)}${h ? `, dropping stale ${h.peerId.slice(0, 6)}` : ''}`);
  if (h) g.host?.drop?.(h.peerId);
}

/** Client: messages for this lane. True if handled. */
export function netcodeClientMsg(g: Game, m: Record<string, unknown>): boolean {
  const s = st(g);
  switch (m.t) {
    case 'np':
      g.client?.send({ t: 'np', n: m.n });
      return true;
    case 'start':
    case 'stage':
    case 'over':
    case 'end':
    case 'cojoin':
    case 'lbtolobby':
      // The world changes under the snapshots: show what's waiting first (a new run: drop it).
      if (s.playout) {
        if (m.t === 'start' || m.t === 'lbtolobby') {
          s.playout.reset();
          s.bullets.reset();
        } else s.playout.flush((x) => applySnap(g, s, x));
      }
      if (m.t === 'start' && s.rc) {
        note(s, `client: back in after ${s.rc.tries} tries`);
        s.rc = null; // back in
        g.hud.toast('RECONNECTED!', 2);
        g.vfx.sound('reconnect', g.player.x, g.player.z);
      }
      return false;
  }
  return false;
}

/** Client: a snapshot arrived. Buffered on a real connection, applied at once otherwise (tests, in-process). */
export function netcodeSnapshot(g: Game, m: Record<string, unknown>): void {
  const s = st(g);
  if (s.playout && typeof m.hs === 'number') {
    s.playout.push(m.hs, performance.now(), m);
    if (!Number.isFinite(s.playout.lastStep)) s.playout.update(performance.now(), (x) => applySnap(g, s, x));
    return;
  }
  applySnap(g, s, m);
}

function applySnap(g: Game, s: NetState, m: Record<string, unknown>): void {
  if (typeof m.hs === 'number') s.lastSnapStep = m.hs;
  g.applySnapshot(m);
}

/** Client: bullets from a snapshot (`bd`, deltas). */
export function netcodeBullets(g: Game, bd: NetBytes): void {
  st(g).bullets.decode(bd, g.bullets);
}

/** Client: the host's quality numbers from a snapshot. */
export function applyNq(g: Game, v: unknown): void {
  if (Array.isArray(v)) st(g).nq = v as NqRow[];
}

/** Host: the `nq` snapshot field (null when nothing to share). */
export function netNq(g: Game): NqRow[] | null {
  if (g.role !== 'host' || g.heroes.length < 2) return null;
  const s = st(g);
  s.nq = hostNq(g, s, performance.now());
  return s.nq;
}

// ---------------------------------------------------------------- interpolation

/** Render: where clients draw remote things between the last two snapshots (above 1 extrapolates, capped). */
export function netInterpAlpha(g: Game): number {
  const p = st(g).playout;
  if (p && Number.isFinite(p.lastStep)) return p.alpha(performance.now());
  return Math.min(1, (performance.now() - g.snapTime) / Math.max(16, g.snapInterval));
}

/** Client: a remote position jumped (teleport, respawn): draw it there instead of sliding across the map. */
export function snapIfTeleported(prev: { x: number; z: number }, cur: { x: number; z: number }): void {
  if (isTeleport(prev.x, prev.z, cur.x, cur.z)) {
    prev.x = cur.x;
    prev.z = cur.z;
  }
}

/** Client: the host step on screen (sent with inputs for lag compensation), or -1. */
export function clientViewStep(g: Game): number {
  const s = st(g);
  const p = s.playout;
  if (p && Number.isFinite(p.renderStep)) return Math.round(p.renderStep * 10) / 10;
  return s.lastSnapStep;
}

// ---------------------------------------------------------------- lag compensation (host)

/** Host: a remote hero's input said it was looking at host step `vt`. */
export function noteViewStep(g: Game, h: Hero, vt: number): void {
  if (!(vt >= 0) || g.role !== 'host') return;
  const s = st(g);
  const claimed = g.stepN - vt;
  const rtt = h.peerId ? (s.probes.get(h.peerId)?.rtt ?? 0) : 0;
  const allowed = allowedRewind(claimed, rtt);
  const prev = s.lag[h.index] ?? allowed;
  s.lag[h.index] = prev + (allowed - prev) * lagTuning.blend;
}

/** Host: how many steps to rewind enemies for a bullet owned by hero index `owner` (0 = none). */
export function lagSteps(g: Game, owner: number): number {
  if (g.role !== 'host' || !lagTuning.enabled) return 0;
  const h = g.heroes[owner];
  if (!h || !h.remote || !h.peerId) return 0;
  return st(g).lag[owner] ?? 0;
}

/** Scratch output of rewindEnemy (no allocation). */
export const lagOut = { x: 0, z: 0 };

/** Host: where enemy `e` was `steps` ago (into lagOut). False: use where it is. */
export function rewindEnemy(g: Game, e: Enemy, steps: number): boolean {
  return st(g).history.at(e, steps, lagOut);
}

export { lagTuning };

// ---------------------------------------------------------------- input edges (host)

/**
 * A client's inputs can arrive bunched (jitter, a resent packet holding the ones behind it) and the host
 * keeps only the newest, so a right-click press or release, or a left-click tap, shorter than one bunch
 * would never be seen: no Charge Shot release, no beacon or shield press. Per hero and button: if a state
 * no host step has read yet was an edge and the newer input undoes it, the next step sees that edge first.
 */
interface ButtonEdge {
  /** Newest state received, whether a step has read it, the state the last step used, an edge to replay. */
  cur: boolean;
  used: boolean;
  applied: boolean;
  edge: boolean | null;
}
const edges = new WeakMap<Hero, { firing: ButtonEdge; charging: ButtonEdge }>();
const edgeOf = (h: Hero) => {
  let e = edges.get(h);
  if (!e) edges.set(h, (e = { firing: { cur: false, used: true, applied: false, edge: null }, charging: { cur: false, used: true, applied: false, edge: null } }));
  return e;
};

/** Host: a remote input message arrived with these buttons. */
export function remoteButtonsIn(h: Hero, firing: boolean, charging: boolean): void {
  const e = edgeOf(h);
  for (const [b, v] of [[e.firing, firing], [e.charging, charging]] as const) {
    if (!b.used && b.cur !== b.applied && v === b.applied) b.edge = b.cur;
    b.cur = v;
    b.used = false;
  }
}

/** Host step: the button state a remote hero's weapons see (`latest` is h.remote's). */
export function remoteButton(h: Hero, which: 'firing' | 'charging', latest: boolean): boolean {
  const b = edgeOf(h)[which];
  let v = latest;
  if (b.edge !== null) {
    v = b.edge;
    b.edge = null;
  } else b.used = true;
  b.applied = v;
  return v;
}

// ---------------------------------------------------------------- connections

/** Client: a real connection to the host was made (online.ts): buffer snapshots, remember the run. */
export function netcodeJoined(g: Game, c: NetClient): void {
  const s = st(g);
  s.playout ??= new Playout();
  s.playout.reset();
  s.bullets.reset();
  s.lastSnapStep = -1;
  c.onIce = (state) => {
    // ICE 'disconnected' often recovers by itself; 'failed' never does.
    if (state !== 'connected' && state !== 'completed') note(st(g), `client: ICE ${state}`);
    if (state === 'failed' && g.client === c) c.drop();
  };
}

/** Client: the connection closed. True if the lane takes over (reconnecting mid-run); false: leave as before. */
export function netcodeLost(g: Game, c: NetClient): boolean {
  const s = st(g);
  if (g.client !== c || g.mode === 'title' || g.mode === 'dead' || g.pvp || s.rc) return !!s.rc;
  const now = performance.now();
  s.rc = { code: c.code, name: g.netName || 'Player', until: now + netQualityTuning.reconnectFor * 1000, next: now + 500, tries: 0, pending: null, hello: false, helloAt: 0 };
  s.playout?.clearQueue();
  note(s, 'client: connection lost, reconnecting');
  g.vfx.toast('CONNECTION LOST · RECONNECTING', 2.5);
  return true;
}

function reconnectStep(g: Game, s: NetState, now: number): void {
  const rc = s.rc!;
  if (now > rc.until) {
    note(s, `client: gave up after ${rc.tries} tries`);
    endReconnect(s);
    g.leaveToTitle();
    g.hud.toast("COULDN'T RECONNECT TO THE HOST", 3.5);
    return;
  }
  // The host can hold a returning player until a calm moment (no menus); past 20 s, try a fresh connection.
  if (rc.hello && now - rc.helloAt > 20000 && g.client) {
    note(s, 'client: no answer to hello, retrying');
    rc.hello = false;
    rc.next = now;
  }
  if (rc.pending || rc.hello || now < rc.next) return;
  rc.tries++;
  note(s, `client: reconnect try ${rc.tries}`);
  const c = new NetClient(rc.code);
  rc.pending = c;
  c.onMessage = (m) => {
    if (g.client === c) g.onClientMessage(m as Record<string, unknown>);
  };
  c.onClose = () => {
    if (g.client !== c) {
      if (s.rc?.pending === c) {
        s.rc.pending = null;
        s.rc.next = performance.now() + netQualityTuning.retryEvery * 1000;
      }
      return;
    }
    if (netcodeLost(g, c)) {
      if (s.rc) {
        s.rc.hello = false;
        s.rc.next = performance.now() + netQualityTuning.retryEvery * 1000;
      }
      return;
    }
    g.leaveToTitle();
    g.hud.toast('DISCONNECTED FROM HOST', 3);
  };
  c.ready.then(
    () => {
      if (s.rc !== rc || g.role !== 'client') {
        c.close();
        return;
      }
      rc.pending = null;
      rc.hello = true;
      rc.helloAt = performance.now();
      note(s, 'client: connected, hello sent');
      const old = g.client;
      g.client = c;
      if (old && old !== c) old.close();
      netcodeJoined(g, c);
      c.send(helloMsg(rc.name));
    },
    (e) => {
      note(s, `client: try failed (${(e as Error)?.message ?? e})`);
      if (rc.pending === c) rc.pending = null;
      rc.next = performance.now() + netQualityTuning.retryEvery * 1000;
    },
  );
}

function endReconnect(s: NetState): void {
  s.rc?.pending?.close();
  s.rc = null;
}

/** The hello a client sends (the same as PLAY ONLINE > JOIN, systems/online.ts). */
export function helloMsg(name: string): Record<string, unknown> {
  return { t: 'hello', mods: modSession.hash, pid: coopPlayerId(), name, unlocked: unlockedWeapons(), loadout: validLoadout(settings.loadout, unlockedLoadout()), skin: settings.skin, pet: settings.pet, hero: localHero(), look: cleanLook(settings.look), prof: myProfile(), pf: profileSummary() };
}

/** Client: reconnecting right now (seconds left), or null. */
export function reconnectingFor(g: Game): number | null {
  const rc = st(g).rc;
  return rc ? Math.max(0, Math.ceil((rc.until - performance.now()) / 1000)) : null;
}

// ---------------------------------------------------------------- tab reload

interface RejoinRecord {
  code: string;
  name: string;
  at: number;
}

function clearRejoin(s: NetState): void {
  if (s.rejoinSaved < 0) return;
  s.rejoinSaved = -1;
  saveJson('net.rejoin', null);
}

/** On boot: a run this tab was in less than a minute ago? Join it again (reclaims the hero). */
function tryRejoinAfterReload(g: Game): void {
  const r = loadJson<RejoinRecord | null>('net.rejoin', null);
  if (!r || typeof r.code !== 'string' || !r.code) return;
  const age = Date.now() - Number(r.at);
  saveJson('net.rejoin', null);
  if (!(age >= 0 && age < netQualityTuning.reconnectFor * 1000) || g.role !== 'solo') return;
  g.hud.toast('REJOINING YOUR RUN...', 3);
  void g.joinGame(String(r.name || 'Player'), r.code);
}

// ---------------------------------------------------------------- HUD

const tmpV = { x: 0, y: 0, z: 0 };

/** Test links (src/dev/netcodeLinks.ts): show the network HUD in solo with made-up numbers. */
export const netDebugView = { on: false, mode: 'bad' as 'bad' | 'rc' | 'lost' };

/** Render: the NETWORK panel, warnings over teammates and the reconnect banner. */
export function renderNetcode(g: Game): void {
  const s = st(g);
  if (netDebugView.on && g.role === 'solo' && g.mode !== 'title') {
    const m = netDebugView.mode;
    s.nq = g.heroes.map((_, i): NqRow => (i === 0 ? [0, 0, 0, 0] : i === 1 ? (m === 'rc' ? [0, 0, 0, 42] : [265, 7, 11, 0]) : [48, 0, 20, 0]));
    s.overlay ??= new NetOverlay();
    const v = netView(g, s);
    if (m === 'lost') v.lost = { secs: 47, tries: 3 };
    s.overlay.render(v);
    return;
  }
  const online = g.role !== 'solo' && g.mode !== 'title';
  if (!online && !s.overlay) return;
  s.overlay ??= new NetOverlay();
  if (!online) {
    s.overlay.idle();
    return;
  }
  s.overlay.render(netView(g, s));
}

function netView(g: Game, s: NetState): NetView {
  const client = g.role === 'client';
  const fighting = g.isCombatMode;
  const rows: NetRow[] = [];
  const tags: NetTag[] = [];
  const myRtt = client ? clientRtt(g) : 0;
  const ps = s.playout?.stats;
  g.heroes.forEach((h, i) => {
    if (h.left && !(s.nq[i]?.[3] > 0)) return;
    const q = s.nq[i] ?? [0, 0, 0, 0];
    const isHost = i === 0 && (g.role === 'host' ? h === g.hero : true);
    const you = h === g.hero;
    let rtt = q[0];
    let loss = q[1];
    let rate = q[2];
    // A client knows its own numbers first-hand.
    if (you && client) {
      rtt = myRtt || rtt;
      if (ps) {
        loss = Math.max(loss, Math.round(ps.loss * 100));
        rate = ps.rate;
      }
    }
    const rc = q[3];
    const level = isHost ? 'good' : netLevel(rtt, loss, fighting ? rate : 0);
    rows.push({ name: h.name || `P${i + 1}`, color: h.color, rtt, loss, rate, you, host: isHost, rc, level });
    if (you || isHost && !rc) return;
    if (!rc && level === 'good') return;
    const r = h.player.rig.root.position;
    tmpV.x = r.x;
    tmpV.y = 4.6;
    tmpV.z = r.z;
    const v = g.tmp.set(tmpV.x, tmpV.y, tmpV.z).project(g.cam.camera);
    if (v.z >= 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return;
    const text = rc > 0 ? `RECONNECTING... ${rc}S` : rc < 0 ? 'NOT RESPONDING' : `${rtt > 0 ? `${rtt}MS` : ''}${loss >= 2 ? ` ${loss}% LOSS` : ''}`.trim() || 'LAGGING';
    tags.push({ key: `n${i}`, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, level: rc ? 'rc' : level, text });
  });
  const rc = reconnectingFor(g);
  return {
    panel: settings.netOverlay === true,
    rows,
    buffer: client && ps ? { delay: ps.delay, jitter: ps.jitter } : null,
    tags: fighting ? tags : [],
    lost: rc !== null ? { secs: rc, tries: Math.max(1, s.rc?.tries ?? 1) } : null,
  };
}

/** Debug: knobs for the debug panel. */
export const netcodeKnobs = { interp: interpTuning, lag: lagTuning, quality: netQualityTuning };
