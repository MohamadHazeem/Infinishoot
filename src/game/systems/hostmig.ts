/**
 * Host migration (hostmig lane): when the host leaves, crashes or loses its
 * connection, the run goes on with a new host instead of ending for everyone.
 *
 * - Host: every `hostmigTuning.every` seconds (and at once on any mode, stage,
 *   roster or route change) it sends each client a `mig` message, the
 *   migration snapshot (src/net/migration.ts): run and team state, director,
 *   every hero's full build (exportBuild) plus gold/life/menus, every enemy,
 *   pickup and chest, the route map, and `cands`, the players it still has
 *   connected. Leaving on purpose (or closing the tab) sends a fresh one plus
 *   `hmig` first, so nobody waits for a timeout.
 * - Client: when the host connection is lost, the netcode lane's reconnect
 *   loop starts (src/game/systems/netcode.ts). Unless the old host answers
 *   within `hostmigTuning.probe` s (a blip), every client elects the same new
 *   host from the last snapshot: the lowest join order (hero index) still
 *   connected (`electHost`). That player promotes itself: role -> host, a new
 *   room `<code>-M<epoch>H<index>` (src/net/peer.ts `migrationCode`), the
 *   simulation rebuilt from the snapshot. The others point their reconnect
 *   loop at that room; their `hello` (same player id) reclaims their hero
 *   through the coop2 drop-in path (start + stage + cojoin), even mid-menu.
 *   A candidate that can't be reached in `hostmigTuning.candidate` s is
 *   skipped for the next one. Alone, the last player carries on solo.
 * - The old host's hero joins the coop2 autopilot (grace), then leaves by the
 *   usual drop-out rules. Everyone sees NEW HOST: X with the `host_migrate`
 *   sample and the "New host. Keep fighting!" line.
 *
 * Not migrated (fresh on the new host): the per-lane host-only state that has
 * no plain fields here (boss move queues, Titan parts, world-event and
 * mini-game internals, time-lane votes, MVP tallies), PvP and Versus matches.
 */
import type { Game, LobbyEntry, Mode } from '../game';
import { xpForLevel } from '../game';
import type { Hero } from '../hero';
import { NetClient, NetHost, migrationCode } from '../../net/peer';
import { MIG_VERSION, applyPrims, baseCode, electHost, hostmigTuning, knownEnemy, packMigEnemies, packMigPickups, prims, unpackMigEnemies, unpackMigPickups, type Prims } from '../../net/migration';
import { exportBuild, applyBuild, type HeroBuild } from '../pvp';
import { coopState } from './coop2';
import { coopPlayerId, joinTuning } from '../coop2';
import { Autopilot } from '../autopilot';
import { helloMsg, netcodeJoined, netcodeLost, netcodeNote, netcodeState } from './netcode';
import { isBotPeer } from './pvp2';
import { ENEMIES } from '../../data/enemies';
import { MOD_BY_ID } from '../../data/mods';
import { DIFF_BY_ID, type DifficultyId, type ModeId } from '../../data/modes';
import { Rng } from '../../core/rng';
import { sfx } from '../../audio/sfx';
import { samples } from '../../audio/samples';
import { voiceGate } from '../../audio/announcer';
import { caption } from '../../audio/captions';
import { t } from '../../i18n';
import { cleanLook } from '../../data/customise';
import type { Offer } from '../../ui/screens';
import type { RouteRun } from './route';

export { hostmigTuning };

/** Game fields copied as they are (team run state). */
const RUN_KEYS = ['seed', 'stage', 'score', 'kills', 'combo', 'maxCombo', 'runTime', 'level', 'xp', 'xpNext', 'overloads', 'elitesRun', 'bossesRun', 'chestT', 'victories', 'comboT', 'damagedThisStage', 'modeT', 'arenaStage', 'preShop', 'secretShop', 'stageLoaded', 'heartT'] as const;

interface MigShop {
  offers: (string | null)[];
  locked: boolean[];
  rerolls: number;
  healed: boolean;
  done: boolean;
  secret: boolean;
  relics: string[];
  curse: string | null;
}

/** One hero in the migration snapshot. */
export interface MigHero {
  i: number;
  name: string;
  pid: string;
  left: boolean;
  dead: boolean;
  build: HeroBuild;
  gold: number;
  rr: number;
  bl: number;
  ban: string[];
  hp: number;
  x: number;
  z: number;
  rv: number;
  pl: number;
  cp: number;
  offers: Offer[];
  shop: MigShop | null;
  bomb: number;
  unlocked: string[];
  skin: string;
  pet: string;
  hero: string;
  look: string;
  dashes: number;
  dmg: Record<string, number>;
  ph: boolean;
  fk: number;
  sk: Prims;
  st: Prims;
  pp: Prims;
  pe: Prims;
}

/** The migration snapshot as it travels (`t: 'mig'`). */
export interface MigSnapshot {
  t: 'mig';
  v: number;
  /** Migrations so far in this run (the next host opens room epoch + 1). */
  ep: number;
  /** The run's base invite code. */
  code: string;
  /** The sender's hero index (the host being replaced). */
  hi: number;
  /** Hero indexes of the players the host still has connected (join order). */
  cands: number[];
  mode: Mode;
  resume: Mode;
  run: Prims;
  diff: string;
  runMode: string;
  curses: string[];
  rng: Prims;
  dir: Prims;
  ad: Prims;
  ev: { p: Prims; e: unknown; c: unknown };
  bf: Prims;
  route: RouteRun;
  portal: [number, number] | null;
  ch: [number, number, number, number][];
  heroes: MigHero[];
  en: ArrayBuffer;
  pk: ArrayBuffer;
}

type Phase = 'idle' | 'probe' | 'blip' | 'join';

interface HostmigState {
  // host
  epoch: number;
  base: string;
  nextSend: number;
  sentKey: string;
  sig: number;
  lastWho: string;
  /** The connected players the last regular snapshot listed. */
  cands: number[];
  /** performance.now() each hero index was last seen connected. */
  seenAt: number[];
  pagehide: boolean;
  /** New host: menus wait for these hero indexes until `holdUntil` (performance.now()). */
  waiting: Set<number>;
  holdUntil: number;
  /** New host: last peer id seen per hero index (a reclaim gets its menu again). */
  peerSeen: string[];
  // client
  mig: MigSnapshot | null;
  migAt: number;
  bye: boolean;
  phase: Phase;
  until: number;
  cand: number;
  joinAt: number;
  skip: Set<number>;
  /** New host that skipped unreachable candidates: their rooms, tried now and then while nobody joins here (healing a split). */
  yieldTo: string[];
  yieldUntil: number;
  yieldNext: number;
  yieldTry: NetClient | null;
  // both
  panel: HTMLElement | null;
  panelText: string;
  /** `npm run migrate`: leave without a goodbye, like a crash. */
  crashTest: boolean;
  /** Test links: a panel text to show whatever the state. */
  demo: string;
  migrations: number;
  /** Log lines for tests and `npm run migrate`. */
  events: string[];
}

const states = new WeakMap<Game, HostmigState>();

export function hostmigState(g: Game): HostmigState {
  let s = states.get(g);
  if (!s) {
    s = { epoch: 0, base: '', nextSend: 0, sentKey: '', sig: 0, lastWho: '', cands: [], seenAt: [], pagehide: false, waiting: new Set(), holdUntil: 0, peerSeen: [], mig: null, migAt: 0, bye: false, phase: 'idle', until: 0, cand: -1, joinAt: 0, skip: new Set(), yieldTo: [], yieldUntil: 0, yieldNext: 0, yieldTry: null, panel: null, panelText: '', crashTest: false, demo: '', migrations: 0, events: [] };
    states.set(g, s);
    (g as unknown as { hostmig: HostmigState }).hostmig = s; // tests and `npm run migrate` read it from window.game
  }
  return s;
}

function note(g: Game, msg: string): void {
  const s = hostmigState(g);
  s.events.push(`${(performance.now() / 1000).toFixed(1)}s ${msg}`);
  if (s.events.length > 40) s.events.shift();
  netcodeNote(g, `hostmig: ${msg}`);
}

/** Test hook: how a promoted machine opens its room (tests swap in an in-process transport). */
export const hostmigNet = {
  makeHost: (code: string): NetHost => new NetHost(3, code),
  makeClient: (code: string): NetClient => new NetClient(code),
};

/** A run that can move to another host: co-op (standard or weekly), not PvP, Versus or local co-op. */
function migratable(g: Game): boolean {
  return g.mode !== 'title' && g.mode !== 'dead' && !g.pvp && !g.versus && !g.localCoop && !g.onboarding.training;
}

// ---------------------------------------------------------------- host: sending

/** Every step (from hostTick, host and clients). */
export function hostmigTick(g: Game): void {
  const s = hostmigState(g);
  if (g.role === 'host') hostStep(g, s);
  else if (g.role === 'client') clientStep(g, s);
  else {
    if (s.phase !== 'idle' || s.mig) resetClient(s);
    healStep(g, s); // alone after skipping an unreachable host: join it if it turns up
  }
  renderPanel(g, s);
}

function connectedClients(g: Game): Hero[] {
  const grace = coopState(g).grace;
  return g.heroes.filter((h) => h.peerId && !h.left && !isBotPeer(h.peerId) && !grace.some((x) => x.index === h.index));
}

function hostStep(g: Game, s: HostmigState): void {
  const host = g.host;
  if (!host) return;
  if (!s.base) s.base = baseCode(host.code);
  if (!s.pagehide && typeof window !== 'undefined') {
    s.pagehide = true;
    window.addEventListener('pagehide', () => {
      if (g.role === 'host') hostmigLeaving(g);
    });
  }
  holdStep(g, s);
  healStep(g, s);
  if (!migratable(g)) return;
  const clients = connectedClients(g);
  const who = clients.map((h) => h.index).join();
  if (who !== s.lastWho) {
    note(g, `host: connected players [${who}]`);
    s.lastWho = who;
  }
  if (!clients.length) return;
  const now = performance.now();
  // Builds change without a mode change too (one hero's pick while others still pick, a chest item, a shop buy).
  if (g.stepN % 10 === 0) s.sig = buildSig(g);
  const key = `${g.mode}|${g.stage}|${g.route.open ? g.route.phase : ''}|${clients.map((h) => h.index).join()}|${g.heroes.length}|${s.sig}`;
  if (key === s.sentKey && now < s.nextSend) return;
  s.sentKey = key;
  s.nextSend = now + hostmigTuning.every * 1000;
  sendMig(g, clients, buildMig(g, s) as unknown as Record<string, unknown>);
}

/** Send without ever breaking the host's loop (the transport packs synchronously and can throw). */
function sendMig(g: Game, to: Hero[], ...msgs: Record<string, unknown>[]): void {
  for (const h of to) {
    for (const m of msgs) {
      try {
        g.host?.send(h.peerId, m);
      } catch (e) {
        note(g, `host: couldn't send ${String(m.t)}: ${(e as Error)?.message ?? e}`);
      }
    }
  }
}

/** A cheap fingerprint of every hero's build (weapon levels and ranks, passives, Mods, relics). */
function buildSig(g: Game): number {
  let n = 0;
  for (const h of g.heroes) {
    n = (n * 31 + h.weapons.length * 7 + h.synergy.slots.length * 13 + h.relics.length * 17 + h.special.level) | 0;
    for (const w of h.weapons) n = (n * 31 + w.level * 3 + w.buildKey.length) | 0;
    for (const id in h.passives) n = (n * 31 + h.passives[id]) | 0;
    for (const sl of h.synergy.slots) n = (n * 31 + sl.level) | 0;
  }
  return n;
}

/** The host's migration snapshot. */
export function buildMig(g: Game, s = hostmigState(g), leaving = false): MigSnapshot {
  // Connected players, in join order. A closing tab tears its connections down around its goodbye:
  // that last snapshot keeps everyone the previous one listed, so all clients still elect the same host.
  // A player whose connection dropped in the last few seconds still counts: when a machine dies its connections often
  // go a moment before it does, and every client must elect from the same list.
  const now = performance.now();
  for (const h of connectedClients(g)) s.seenAt[h.index] = now;
  let cands = g.heroes.filter((h) => h !== g.hero && !h.left && now - (s.seenAt[h.index] ?? -Infinity) < hostmigTuning.recent * 1000).map((h) => h.index);
  if (leaving) cands = [...new Set([...s.cands, ...cands])].filter((i) => g.heroes[i] && !g.heroes[i].left).sort((a, b) => a - b);
  else s.cands = cands;
  const cs = coopState(g);
  const run: Prims = {};
  for (const k of RUN_KEYS) {
    const v = (g as unknown as Record<string, unknown>)[k];
    if (typeof v === 'number' || typeof v === 'boolean') run[k] = v;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    t: 'mig',
    v: MIG_VERSION,
    ep: s.epoch,
    code: s.base || baseCode(g.host?.code ?? ''),
    hi: g.local,
    cands,
    mode: g.mode,
    resume: g.resumeMode,
    run,
    diff: g.difficulty.id,
    runMode: g.runMode,
    curses: [...g.curses],
    rng: prims(g.rng),
    dir: prims(g.director),
    ad: prims(g.director.adaptive),
    ev: { p: prims(g.runEvents), e: plain(g.runEvents.event), c: plain(g.runEvents.challenge) },
    bf: prims(g.bossField),
    route: plain(g.route) as RouteRun,
    portal: g.portal.active ? [r2(g.portal.x), r2(g.portal.z)] : null,
    ch: g.chests.list.map((c) => [r2(c.x), r2(c.z), r2(c.facing), r2(c.openT)]),
    heroes: g.heroes.map((h) => migHero(g, h, cs.pids[h.index] ?? '')),
    en: packMigEnemies(g.enemies.list, g.boss, g.bossField.mini),
    pk: packMigPickups(g.pickups),
  };
}

function migHero(g: Game, h: Hero, pid: string): MigHero {
  const p = h.player;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    i: h.index,
    name: h.name,
    pid: pid || (h === g.hero ? coopPlayerId() : ''),
    left: h.left,
    dead: p.dead,
    build: exportBuild(h, g.level),
    gold: h.gold,
    rr: h.rerollsLeft,
    bl: h.banishLeft,
    ban: [...h.banished],
    hp: r2(p.hp),
    x: r2(p.x),
    z: r2(p.z),
    rv: r2(h.reviveT),
    pl: h.pendingLevels,
    cp: h.chestsPending,
    offers: plain(h.offers) as Offer[],
    shop: g.mode === 'shop' ? { offers: h.shopOffers.map((m) => m?.id ?? null), locked: [...h.shopLocked], rerolls: h.shopRerolls, healed: h.shopHealed, done: h.shopDone, secret: h.secretShop, relics: [...h.relicOffers], curse: h.curseOffer } : null,
    bomb: r2(h.bombCharge),
    unlocked: [...h.unlocked],
    skin: h.skin.id,
    pet: h.pet,
    hero: h.heroDef.id,
    look: h.player.look,
    dashes: h.dashes,
    dmg: { ...h.damageBy },
    ph: h.phoenixUsed,
    fk: h.fangKills,
    sk: prims(h.skill),
    st: prims(h.skill.style),
    pp: prims(h.play),
    pe: prims(h.petState),
  };
}

/** A JSON copy (plain lane objects and offers; drops functions and class wiring). */
function plain<T>(v: T): T {
  if (v === null || v === undefined) return v;
  try {
    return JSON.parse(JSON.stringify(v)) as T;
  } catch {
    return null as T;
  }
}

/** Host: leaving on purpose (or the tab closing). Clients migrate at once instead of waiting for a timeout. */
export function hostmigLeaving(g: Game): void {
  if (g.role !== 'host' || !g.host || !migratable(g) || hostmigState(g).crashTest) return;
  const clients = connectedClients(g);
  if (!clients.length) return;
  const s = hostmigState(g);
  sendMig(g, clients, buildMig(g, s, true) as unknown as Record<string, unknown>, { t: 'hmig', bye: 1 });
  note(g, 'host: leaving, clients migrate');
}

// ---------------------------------------------------------------- client: receiving and electing

/** Client: messages for this lane (before anything else sees them). True if handled. */
export function hostmigClientMsg(g: Game, m: Record<string, unknown>): boolean {
  const s = hostmigState(g);
  switch (m.t) {
    case 'mig':
      if (Number(m.v) === MIG_VERSION && Array.isArray(m.heroes)) {
        s.mig = m as unknown as MigSnapshot;
        s.migAt = performance.now();
      }
      return true;
    case 'hmig':
      s.bye = true;
      note(g, 'client: the host is leaving');
      // Its connection may linger (a closing tab): don't wait for it, the migration snapshot is already here.
      if (s.mig && migratable(g)) setTimeout(() => g.role === 'client' && g.client?.drop(), 0);
      return true;
    case 'end':
      // The host left on purpose mid-run: migrate instead of going back to the title.
      if (s.bye && s.mig && migratable(g)) {
        g.client?.drop();
        return true;
      }
      return false;
    case 'start':
      s.bye = false;
      return false;
  }
  return false;
}

function resetClient(s: HostmigState): void {
  s.mig = null;
  s.phase = 'idle';
  s.bye = false;
  s.skip.clear();
  s.cand = -1;
}

function clientStep(g: Game, s: HostmigState): void {
  const ns = netcodeState(g);
  const rc = ns.rc;
  const now = performance.now();
  if (!rc) {
    if (s.phase === 'join') {
      note(g, `client: joined the new host (hero ${s.cand})`);
      s.migrations++;
    }
    if (s.phase !== 'idle') {
      s.phase = 'idle';
      s.skip.clear();
    }
    if (!migratable(g)) s.mig = null;
    return;
  }
  const m = s.mig;
  // However old: it's the last word from that host (a starved machine can take a minute to notice the loss).
  if (!m || !migratable(g)) return;
  if (s.phase === 'idle') {
    s.phase = 'probe';
    s.until = now + (s.bye ? 0 : hostmigTuning.probe * 1000);
    s.skip.clear();
    note(g, `client: host lost, ${s.bye ? 'it said goodbye' : 'probing it'}`);
  }
  if (s.phase === 'probe') {
    if (rc.hello) {
      s.phase = 'blip'; // the old host answered: the netcode lane's reconnect takes it from here
      s.until = now + hostmigTuning.blip * 1000;
      note(g, 'client: the old host answered, no migration');
      return;
    }
    if (now >= s.until) decide(g, s, m);
    return;
  }
  if (s.phase === 'blip' && (!rc.hello || now >= s.until)) {
    // It answered but never let us back in (it died meanwhile, or hangs): look for a new host after all.
    s.phase = 'probe';
    s.until = now + (s.bye ? 0 : hostmigTuning.probe * 1000);
    note(g, 'client: the old host went quiet again, probing it');
    return;
  }
  if (s.phase === 'join' && !rc.hello && now >= s.until) {
    // The room exists (signalling worked, the direct route didn't yet: a busy machine, a slow ICE): it's alive, keep at it.
    if (/^Found the game/.test(rc.lastError ?? '') && now < s.joinAt + hostmigTuning.candidate * hostmigTuning.aliveMul * 1000) {
      s.until = now + 4000;
      rc.lastError = '';
      return;
    }
    note(g, `client: hero ${s.cand}'s room never answered, next candidate`);
    s.skip.add(s.cand);
    decide(g, s, m);
  }
}

/** Elect the new host and act on it (promote this machine, or point the reconnect loop at its room). */
function decide(g: Game, s: HostmigState, m: MigSnapshot): void {
  const cand = electHost(m.cands, m.hi, s.skip);
  const now = performance.now();
  note(g, `client: electing from snapshot epoch ${m.ep} of hero ${m.hi}, connected [${m.cands}], skipping [${[...s.skip]}] -> ${cand}`);
  if (cand < 0 || cand === g.local) {
    promote(g, s, m, cand < 0 || m.cands.filter((i) => i !== m.hi && !s.skip.has(i)).length <= 1);
    return;
  }
  const rc = netcodeState(g).rc;
  if (!rc) return;
  s.cand = cand;
  s.phase = 'join';
  s.until = now + hostmigTuning.candidate * 1000;
  s.joinAt = now;
  rc.pending?.close();
  rc.pending = null;
  rc.hello = false;
  rc.code = migrationCode(m.code, m.ep + 1, cand);
  rc.until = Math.max(rc.until, now + (hostmigTuning.candidate + 50) * 1000);
  rc.next = now + 300;
  const name = m.heroes.find((h) => h.i === cand)?.name ?? `P${cand + 1}`;
  note(g, `client: new host is hero ${cand} (${name}), room ${rc.code}`);
  announce(g, name, false);
}

// ---------------------------------------------------------------- promotion

/** This machine becomes the host (or plays on alone), rebuilt from the migration snapshot. */
function promote(g: Game, s: HostmigState, m: MigSnapshot, solo: boolean): void {
  const ns = netcodeState(g);
  ns.rc?.pending?.close();
  ns.rc = null;
  ns.playout?.reset();
  const old = g.client;
  g.client = null;
  try {
    old?.close();
  } catch {
    // already gone
  }
  restoreRun(g, m);
  // Candidates before us that we couldn't reach may be hosting anyway (a slow route, not a dead machine): try to join them for a while.
  const now = performance.now();
  s.yieldTo = [...s.skip].filter((i) => i < g.local && i !== m.hi).sort((a, b) => a - b).map((i) => migrationCode(m.code, m.ep + 1, i));
  s.yieldUntil = now + hostmigTuning.heal * 1000;
  s.yieldNext = now + 3000;
  s.epoch = m.ep + 1;
  s.base = m.code;
  s.phase = 'idle';
  s.mig = null;
  s.bye = false;
  s.skip.clear();
  s.migrations++;
  const others = g.heroes.filter((h) => h !== g.hero && !h.left);
  s.waiting = new Set(m.cands.filter((i) => i !== g.local && i !== m.hi));
  s.holdUntil = performance.now() + hostmigTuning.hold * 1000;
  s.peerSeen = g.heroes.map(() => '');
  s.seenAt = [];
  s.sentKey = '';
  // Everyone else waits on the coop2 autopilot: migrating players reclaim their hero, the old host's drops out after the grace time.
  const cs = coopState(g);
  cs.grace.length = 0;
  cs.pending.length = 0;
  for (const h of others) {
    const p = h.player;
    h.remote = { x: p.x, z: p.z, vx: 0, vz: 0, ax: p.aim.x, az: p.aim.z, ad: -1, firing: false, charging: false, dashing: false };
    cs.grace.push({ index: h.index, t: joinTuning.grace, pilot: new Autopilot() });
  }
  if (solo) {
    g.role = 'solo';
    g.host = null;
    note(g, `promoted: alone now (epoch ${s.epoch})`);
  } else {
    g.role = 'host';
    const code = migrationCode(m.code, s.epoch, g.local);
    const host = hostmigNet.makeHost(code);
    g.host = host;
    host.onMessage = (from, msg) => g.onHostMessage(from, msg as Record<string, unknown>);
    host.onLeave = (id) => {
      g.lobbyLeft(id);
      g.onClientLeft(id);
    };
    host.onError = (msg) => note(g, `new host room error: ${msg}`);
    host.ready?.catch?.(() => {});
    note(g, `promoted: new host in room ${code} (epoch ${s.epoch}, level ${g.level}, picks waiting ${g.heroes.map((h) => h.pendingLevels + h.chestsPending).join('/')})`);
  }
  // coop2: this run continues (no fresh-run reset on the next step), with everyone's player ids.
  cs.stage = g.stage;
  cs.lastRun = g.runTime;
  cs.lastMode = g.mode;
  cs.pids = m.heroes.map((h) => h.pid);
  g.lobby = lobbyFrom(g, m);
  g.director.players = Math.max(1, g.heroes.filter((h) => !h.left).length);
  announce(g, g.hero.name, true, solo);
}

function lobbyFrom(g: Game, m: MigSnapshot): LobbyEntry[] {
  const order = [g.local, ...m.heroes.map((h) => h.i).filter((i) => i !== g.local)];
  const out: LobbyEntry[] = [];
  for (const i of order) {
    const h = m.heroes.find((x) => x.i === i);
    if (!h || h.left) continue;
    out.push({ peerId: '', name: h.name, unlocked: h.unlocked, loadout: { ...h.build.loadout }, skin: h.skin, pet: h.pet, hero: h.hero, look: h.look });
  }
  return out;
}

/** Rebuild the authoritative run on this machine from a migration snapshot (it was a client's mirror). */
export function restoreRun(g: Game, m: MigSnapshot): void {
  // The 20 Hz snapshots this machine mirrored are newer than the migration snapshot: keep what they say where they say it.
  const mirror = {
    stage: g.stage,
    level: g.level,
    xp01: g.xpNext > 0 ? g.xp / g.xpNext : 0,
    score: g.score,
    kills: g.kills,
    runTime: g.runTime,
    heroes: g.heroes.map((h) => ({ x: h.player.x, z: h.player.z, hp: h.player.hp, dead: h.player.dead, gold: h.gold })),
  };
  // The arena on screen must be the snapshot's stage (it is, unless a stage change raced the snapshot).
  if (typeof m.run.stage === 'number' && m.run.stage !== g.stage) g.clientStage(m.run.stage, Number(m.run.seed) || g.seed);
  // Team state
  const G = g as unknown as Record<string, unknown>;
  for (const k of RUN_KEYS) {
    const v = m.run[k];
    if (typeof v === typeof G[k]) G[k] = v;
  }
  const sameStage = mirror.stage === g.stage;
  if (sameStage) {
    g.score = Math.max(g.score, mirror.score);
    g.kills = Math.max(g.kills, mirror.kills);
    g.runTime = Math.max(g.runTime, mirror.runTime);
  }
  const extraLevels = sameStage ? Math.max(0, Math.min(5, mirror.level - g.level)) : 0;
  if (extraLevels > 0) {
    g.level = mirror.level;
    g.xpNext = xpForLevel(g.level);
    g.xp = Math.max(0, Math.min(0.999, mirror.xp01)) * g.xpNext;
  }
  g.difficulty = DIFF_BY_ID[m.diff as DifficultyId] ?? DIFF_BY_ID.normal;
  g.runMode = m.runMode as ModeId;
  g.curses = [...(m.curses ?? [])];
  g.rng = new Rng(g.seed ^ 0x5bd1e995);
  applyPrims(g.rng, m.rng);
  applyPrims(g.director, m.dir);
  applyPrims(g.director.adaptive, m.ad);
  applyPrims(g.runEvents, m.ev?.p);
  (g.runEvents as { event: unknown }).event = m.ev?.e ?? null;
  (g.runEvents as { challenge: unknown }).challenge = m.ev?.c ?? null;
  applyPrims(g.bossField, m.bf);
  if (m.route && typeof m.route === 'object') g.route = { ...g.route, ...m.route };
  g.resumeMode = m.resume ?? 'fight';
  g.paused = false;
  g.netBoss = null;

  // World: the mirror goes, the snapshot's world comes back.
  g.enemies.clear();
  g.netEnemies.clear();
  g.bullets.clear();
  g.strikes.length = 0;
  g.boss = null;
  g.bossField.mini = null;
  g.slowMoT = 0;
  g.introLeft = 0;
  for (const r of unpackMigEnemies(m.en)) {
    if (!knownEnemy(r.id)) continue;
    const e = g.enemies.spawn(ENEMIES[r.id], r.x, r.z, { instant: true, elite: r.elite, eliteMod: r.mod ?? undefined });
    e.maxHp = r.maxHp;
    e.hp = Math.min(r.maxHp, r.hp);
    e.speedMul = r.speedMul;
    e.dmgMul = r.dmgMul;
    e.shield = r.shield;
    e.phase = r.phase;
    e.enraged = r.enraged;
    e.mutated = r.mutated;
    if (r.role === 1) g.boss = e;
    else if (r.role === 2) g.bossField.mini = e;
  }
  g.pickups.clear();
  for (const p of unpackMigPickups(m.pk)) g.pickups.spawn(p.type as Parameters<typeof g.pickups.spawn>[0], p.x, p.z, p.value);
  if (Array.isArray(m.ch)) {
    g.chests.clear();
    m.ch.forEach(([x, z, f, open], i) => {
      g.chests.add(x, z, f);
      const c = g.chests.list[i];
      if (c && open >= 0) c.openT = Math.max(open, 1);
    });
  }
  if (m.portal && !g.portal.active) g.portal.open(m.portal[0], m.portal[1]);
  else if (!m.portal && g.portal.active) g.portal.close();

  // Heroes: rebuilt from their builds, then the run's numbers on top.
  const list = [...g.heroes];
  for (const mh of m.heroes) {
    let h = list[mh.i];
    if (!h) {
      h = g.makeHero(mh.i, mh.name, mh.unlocked, '', mh.skin, mh.pet, mh.hero);
      h.player.look = cleanLook(mh.look);
      list[mh.i] = h;
    }
  }
  g.setHeroes(list.filter(Boolean));
  for (const mh of m.heroes) {
    const h = g.heroes[mh.i];
    if (!h) continue;
    (h as unknown as { peerId: string }).peerId = '';
    h.remote = null;
    h.name = mh.name;
    h.unlocked = [...mh.unlocked];
    if (mh.left) {
      h.left = true;
      h.player.dead = true;
      h.player.showWhenDead = false;
      h.pendingLevels = h.chestsPending = 0;
      h.shopDone = true;
      h.disposeWeapons();
      continue;
    }
    h.left = false;
    applyBuild(h, mh.build, g.scene);
    h.gold = mh.gold;
    h.rerollsLeft = mh.rr;
    h.banishLeft = mh.bl;
    h.banished = new Set(mh.ban);
    h.pendingLevels = mh.pl;
    h.chestsPending = mh.cp;
    h.offers = Array.isArray(mh.offers) ? mh.offers : [];
    h.bombCharge = mh.bomb;
    h.dashes = mh.dashes;
    h.damageBy = { ...mh.dmg };
    h.phoenixUsed = mh.ph;
    h.fangKills = mh.fk;
    h.reviveT = mh.rv;
    applyPrims(h.skill, mh.sk);
    applyPrims(h.skill.style, mh.st);
    applyPrims(h.play, mh.pp);
    applyPrims(h.petState, mh.pe);
    if (mh.shop) {
      h.shopOffers = mh.shop.offers.map((id) => (id ? (MOD_BY_ID[id] ?? null) : null));
      h.shopLocked = [...mh.shop.locked];
      h.shopRerolls = mh.shop.rerolls;
      h.shopHealed = mh.shop.healed;
      h.shopDone = mh.shop.done;
      h.secretShop = mh.shop.secret;
      h.relicOffers = [...mh.shop.relics];
      h.curseOffer = mh.shop.curse;
    }
    const p = h.player;
    // Position, life and downed state: the mirror is newer (this machine's own hero moved here first-hand).
    const mm = sameStage ? mirror.heroes[mh.i] : undefined;
    const dead = mm ? mm.dead : mh.dead;
    p.teleport(mm ? mm.x : mh.x, mm ? mm.z : mh.z);
    p.hp = Math.max(0, Math.min(p.maxHp, mm && !mm.dead ? mm.hp : mh.hp));
    if (h === g.hero && mm) h.gold = mm.gold;
    h.pendingLevels += extraLevels;
    p.invuln = Math.max(p.invuln, 1.5);
    p.showWhenDead = g.heroes.length > 1;
    if (dead) {
      p.dead = true;
      p.hp = 0;
    } else if (p.hp <= 0) p.hp = 1;
    h.loadoutDirty = true;
  }

  // Where the run was: menus come back for this machine; teammates get theirs when they reconnect.
  let mode = m.mode;
  if (mode === 'transition') {
    if (!m.run.stageLoaded) {
      g.loadStage(g.stage + 1);
      mode = 'fight';
    } else mode = 'fight';
    g.hud.setFade(0);
  }
  if (mode === 'levelup') mode = g.resumeMode === 'levelup' ? 'fight' : g.resumeMode; // reopens on the next step for whoever still has picks
  g.mode = mode;
  g.screens.show('none');
  if (mode === 'shop') {
    if (g.heroes.every((h) => h.left || h.shopDone)) g.closeShop();
    else presentMenu(g, g.hero);
  }
  if (g.route.open) g.routeShow();
  if (g.boss && g.boss.hp <= 0) g.killEnemy(g.boss, 'finisher', null); // the finisher was playing: the boss falls now
}

/** Show (or send) the current menu to one hero. */
function presentMenu(g: Game, h: Hero): void {
  if (h.left) return;
  if (g.mode === 'levelup') {
    if (h.needsPick) {
      if (!h.offers.length) h.offers = h.buildOffers();
      g.presentLevelUp(h);
    } else g.presentWait(h);
  } else if (g.mode === 'shop') {
    if (!h.shopDone) g.presentShop(h);
    else g.presentWait(h);
  }
}

// ---------------------------------------------------------------- healing a split

/**
 * A new host that skipped an earlier candidate it couldn't reach keeps trying
 * that candidate's room while nobody has joined here. If it answers, the
 * others are most likely there: this machine closes its room and joins as a
 * client (its hero waits on that host's autopilot and is reclaimed as usual).
 */
function healStep(g: Game, s: HostmigState): void {
  if (!s.yieldTo.length) return;
  const now = performance.now();
  if (now > s.yieldUntil || connectedClients(g).length > 0 || !migratable(g)) {
    s.yieldTo = [];
    s.yieldTry?.close();
    s.yieldTry = null;
    return;
  }
  if (s.yieldTry || now < s.yieldNext) return;
  const code = s.yieldTo[0];
  s.yieldTo.push(s.yieldTo.shift()!);
  const c = hostmigNet.makeClient(code);
  s.yieldTry = c;
  c.onMessage = (m) => {
    if (g.client === c) g.onClientMessage(m as Record<string, unknown>);
  };
  c.ready.then(
    () => {
      if (s.yieldTry !== c || g.role === 'client' || !migratable(g) || connectedClients(g).length > 0) {
        c.close();
        return;
      }
      s.yieldTry = null;
      joinInstead(g, s, c, code);
    },
    () => {
      if (s.yieldTry !== c) return;
      s.yieldTry = null;
      s.yieldNext = performance.now() + 4000;
    },
  );
}

function joinInstead(g: Game, s: HostmigState, c: NetClient, code: string): void {
  note(g, `host: room ${code} answered, joining it instead of hosting alone`);
  const host = g.host;
  g.host = null;
  try {
    host?.close();
  } catch {
    // already gone
  }
  s.yieldTo = [];
  s.waiting.clear();
  g.role = 'client';
  g.client = c;
  c.onClose = () => {
    if (g.client !== c) return;
    if (netcodeLost(g, c)) return;
    g.leaveToTitle();
  };
  netcodeJoined(g, c);
  c.send(helloMsg(g.netName || g.hero.name));
}

// ---------------------------------------------------------------- new host: holding menus for returning players

/** coop2 graceStep: menus and votes wait for this hero (a migrating player) instead of the autopilot answering. */
export function hostmigHolds(g: Game, index: number): boolean {
  const s = states.get(g);
  return !!s && s.waiting.has(index) && performance.now() < s.holdUntil;
}

/** coop2 admitPending: migrating players get back in at once, menus or not. */
export function hostmigAdmitNow(g: Game): boolean {
  const s = states.get(g);
  return !!s && s.waiting.size > 0 && performance.now() < s.holdUntil;
}

function holdStep(g: Game, s: HostmigState): void {
  if (!s.waiting.size) return;
  if (performance.now() >= s.holdUntil) {
    s.waiting.clear();
    return;
  }
  for (const i of [...s.waiting]) {
    const h = g.heroes[i];
    if (!h || h.left) {
      s.waiting.delete(i);
      continue;
    }
    if (!h.peerId || h.peerId === s.peerSeen[i]) continue;
    // Back in: their menu again (their client was just rebuilt by start + stage + cojoin).
    s.peerSeen[i] = h.peerId;
    s.waiting.delete(i);
    s.sentKey = '';
    presentMenu(g, h);
    if (g.route.open) g.routeShow();
    note(g, `host: hero ${i} (${h.name}) is back`);
  }
}

// ---------------------------------------------------------------- banner, sound, panel

function announce(g: Game, name: string, me: boolean, solo = false, seconds = 2.6): void {
  const title = solo ? t('hostmig.solo') : t('hostmig.newHost', { name: name.toUpperCase() });
  const sub = t(solo ? 'hostmig.subSolo' : me ? 'hostmig.subMe' : 'hostmig.subOther');
  g.hud.showBanner(title, sub, seconds);
  try {
    sfx.named('hostMigrate');
  } catch {
    // audio not started
  }
  try {
    const v = samples.play('vo_host_migrated', { bus: 'ui', gain: 0.85, variation: 0, limit: 1, priority: 16 });
    if (v) voiceGate.claim(16, v.duration, () => v.stop());
  } catch {
    // audio not started
  }
  caption({ who: 'ANNOUNCER', text: t('hostmig.line'), color: '#ffcd75', kind: 'announcer' });
}

const CSS = `
#hm-panel {
  --bg: var(--ink);
  --hi: var(--plum);
  --lo: var(--night);
  position: absolute;
  left: 50%;
  top: 22%;
  transform: translateX(-50%);
  zoom: var(--ui, 1);
  padding: calc(2 * var(--p)) calc(4 * var(--p));
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--lo),
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    0 calc(2 * var(--p)) 0 0 var(--ink);
  color: var(--white);
  text-shadow: var(--outline);
  text-align: center;
  pointer-events: none;
  white-space: nowrap;
}
#hm-panel[hidden] { display: none; }
/* While a migration runs this panel says more than the netcode lane's CONNECTION LOST banner, in its place. */
body.hm-active #net-lost { display: none; }
#hm-panel .hd { font: 9px var(--label); letter-spacing: 1px; color: var(--orange); }
#hm-panel .nm { font: 20px var(--heading, var(--font)); color: var(--yellow); line-height: 1.1; }
#hm-panel .ft { font: 8px var(--label); letter-spacing: 1px; color: var(--mist); animation: hm-blink 1s steps(2) infinite; }
@keyframes hm-blink { 50% { opacity: 0.35; } }
.reduce-flash #hm-panel .ft { animation: none; }
`;

function renderPanel(g: Game, s: HostmigState): void {
  if (typeof document === 'undefined') return;
  let text = s.demo;
  if (!text && g.role === 'client' && (s.phase === 'probe' || s.phase === 'join') && s.mig) {
    const rc = netcodeState(g).rc;
    if (s.phase === 'probe') text = `${t('hostmig.lost')}|${t('hostmig.finding')}|${t('hostmig.safe')}`;
    else {
      const name = s.mig.heroes.find((h) => h.i === s.cand)?.name ?? '?';
      text = `${t('hostmig.left')}|${name.toUpperCase()}|${t(rc?.hello ? 'hostmig.gettingIn' : 'hostmig.connecting')}`;
    }
  }
  if (text === s.panelText) return;
  s.panelText = text;
  if (!s.panel) {
    if (!text) return;
    if (!document.getElementById('hm-css')) {
      const st = document.createElement('style');
      st.id = 'hm-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    s.panel = document.createElement('div');
    s.panel.id = 'hm-panel';
    (document.getElementById('hud') ?? document.body).appendChild(s.panel);
  }
  s.panel.hidden = !text;
  document.body.classList.toggle('hm-active', !!text);
  if (!text) return;
  // Player names come from the network: text only, never markup.
  const [hd, nm, ft] = text.split('|');
  s.panel.replaceChildren(
    ...([['hd', hd], ['nm', nm], ['ft', ft]] as const).map(([cls, v]) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = v ?? '';
      if (cls === 'nm') d.setAttribute('translate', 'no');
      return d;
    }),
  );
}

/** Test links: the client-side migration panel or the NEW HOST banner in solo (src/dev/hostmigLinks.ts). */
export function hostmigDemo(g: Game, kind: 'probe' | 'join' | 'banner'): void {
  const s = hostmigState(g);
  const mate = (g.heroes[1]?.name ?? 'BRAVO').toUpperCase();
  if (kind === 'banner') announce(g, mate, false, false, 30);
  else s.demo = kind === 'probe' ? `${t('hostmig.lost')}|${t('hostmig.finding')}|${t('hostmig.safe')}` : `${t('hostmig.left')}|${mate}|${t('hostmig.connecting')}`;
}
