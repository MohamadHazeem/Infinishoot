/**
 * Host migration lane: the migration snapshot codecs, the election rule, room
 * codes, and (in-process, three games) a host lost mid-level-up whose run
 * moves to the next player with every build intact, a teammate reclaiming its
 * hero from the new host, then that host lost mid-shop and the last player
 * carrying on alone with the shop still open.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const MG = await import('../src/net/migration');
const { migrationCode, roomCode, normalizeCode } = await import('../src/net/peer');
const { ENEMIES } = await import('../src/data/enemies');

// ---------------------------------------------------------------- pure parts
{
  const p = MG.prims({ a: 1, b: 'x', c: true, d: { e: 1 }, f: [1], g: NaN, h: Infinity });
  ok(p.a === 1 && p.b === 'x' && p.c === true && !('d' in p) && !('f' in p) && !('g' in p) && p.h === Infinity, `prims: only primitive fields (${JSON.stringify(p)})`);
  const t = { a: 0, b: '', c: false, keep: 5 };
  MG.applyPrims(t, { a: 3, b: 'y', c: true, keep: 'nope', extra: 9 });
  ok(t.a === 3 && t.b === 'y' && t.c === true && t.keep === 5 && !('extra' in t), 'applyPrims: same-typed existing fields only');
}
{
  const def = (id: string) => ({ id });
  const boss = { active: true, def: def('king'), x: 1.234, z: -40.5, hp: 1234.5, maxHp: 50000, speedMul: 1.2, dmgMul: 3.4, shield: 0, elite: false, mod: null, phase: 2, enraged: true, mutated: false };
  const list = [
    boss,
    { active: true, def: def('swarmer'), x: -12.01, z: 7, hp: 3, maxHp: 10, speedMul: 1, dmgMul: 1.5, shield: 0, elite: false, mod: null, phase: 1, enraged: false, mutated: true },
    { active: true, def: def('chonk'), x: 100, z: -100, hp: 900, maxHp: 1000, speedMul: 1.75, dmgMul: 1.3, shield: 250, elite: true, mod: { id: 'shielded' }, phase: 1, enraged: false, mutated: false },
    { active: false, def: def('chonk'), x: 0, z: 0, hp: 1, maxHp: 1, speedMul: 1, dmgMul: 1, shield: 0, elite: false, mod: null, phase: 1, enraged: false, mutated: false },
    { active: true, def: { id: 'pvp_target', hidden: true }, x: 0, z: 0, hp: 1, maxHp: 1, speedMul: 1, dmgMul: 1, shield: 0, elite: false, mod: null, phase: 1, enraged: false, mutated: false },
  ];
  const buf = MG.packMigEnemies(list, boss, null);
  const back = MG.unpackMigEnemies(buf);
  ok(back.length === 3, `enemies: live, non-hidden ones only (${back.length})`);
  ok(back[0].id === 'king' && back[0].role === 1 && back[0].phase === 2 && back[0].enraged && Math.abs(back[0].x - 1.23) < 0.011 && Math.abs(back[0].hp - 1234.5) < 0.01, `enemies: the boss round-trips (${JSON.stringify(back[0])})`);
  ok(back[1].mutated && Math.abs(back[1].dmgMul - 1.5) < 0.01 && back[2].elite && back[2].mod === 'shielded' && back[2].shield === 250 && Math.abs(back[2].speedMul - 1.75) < 0.001, 'enemies: elites, modifiers, shields, multipliers');
  ok(buf.byteLength < 3 * 28 + 30, `enemies: compact (${buf.byteLength} B for 3)`);
  const many = Array.from({ length: 300 }, (_, i) => ({ ...list[1], x: i * 0.3, z: -i * 0.2 }));
  const mb = MG.packMigEnemies(many, null, null);
  ok(mb.byteLength < 300 * 27 && MG.unpackMigEnemies(new Uint8Array(mb)).length === 300, `enemies: 300 in ${mb.byteLength} B, and a Uint8Array view decodes (PeerJS chunking)`);
  ok(MG.knownEnemy('swarmer') && !MG.knownEnemy('nope'), 'enemies: unknown defs are skipped');
  ok(!!ENEMIES.king, 'enemies: the boss def exists');
}
{
  const n = 5;
  const p = { count: n, x: new Float32Array(n), z: new Float32Array(n), value: new Float32Array(n), type: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    p.x[i] = i * 1.5 - 3;
    p.z[i] = -i;
    p.value[i] = i === 4 ? 101 : 0.45 * i;
    p.type[i] = i % 7;
  }
  const back = MG.unpackMigPickups(MG.packMigPickups(p));
  ok(back.length === n && back[4].value === 101 && back[4].type === 4 && Math.abs(back[2].x - 0) < 0.01 && Math.abs(back[3].value - 1.35) < 1e-5, 'pickups: type, position, value round-trip (owned chest value kept)');
}
{
  ok(MG.electHost([1, 2, 3], 0, new Set()) === 1, 'elect: lowest join order still connected');
  ok(MG.electHost([3, 2], 0, new Set()) === 2, 'elect: order of the list does not matter');
  ok(MG.electHost([1, 2, 3], 0, new Set([1])) === 2, 'elect: an unreachable candidate is skipped');
  ok(MG.electHost([0, 2], 0, new Set()) === 2, 'elect: never the old host');
  ok(MG.electHost([], 0, new Set()) === -1 && MG.electHost([1], 0, new Set([1])) === -1, 'elect: nobody left');
  ok(migrationCode('abcde', 1, 2) === 'ABCDE-M1H2', 'room: derived code');
  ok(roomCode('abcde-m1h2') === 'ABCDE-M1H2' && roomCode(' ab-cde ') === 'ABCDE' && normalizeCode('ABCDE-M1H2') === 'ABCDE', 'room: migration codes keep their suffix, plain codes normalize');
  ok(MG.baseCode('ABCDE-M3H1') === 'ABCDE' && MG.baseCode('ABCDE') === 'ABCDE', 'room: base code');
}

// ---------------------------------------------------------------- in-process: three players
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const NC = await import('../src/game/systems/netcode');
const C2 = await import('../src/game/systems/coop2');
const HM = await import('../src/game/systems/hostmig');
const { exportBuild } = await import('../src/game/pvp');

settings.deathReplay = false;
settings.bossIntros = false;
HM.hostmigTuning.probe = 0; // in-process: no old host to wait for
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
type G = InstanceType<typeof Game>;

/** An in-process room: the same surface as NetHost. */
class Room {
  peers = new Map<string, G>();
  lastHeard = new Map<string, number>();
  onMessage: (from: string, m: unknown) => void = () => {};
  onLeave: (id: string) => void = () => {};
  onError: (msg: string) => void = () => {};
  ready = Promise.resolve();
  errorType = '';
  dead = false;
  constructor(public code: string) {}
  get clientIds(): string[] {
    return [...this.peers.keys()];
  }
  get size(): number {
    return this.peers.size;
  }
  send(id: string, m: unknown): void {
    const g = this.peers.get(id);
    if (g && !this.dead) q.push({ to: g, m, from: '', room: this });
  }
  broadcast(m: unknown): void {
    for (const id of this.peers.keys()) this.send(id, m);
  }
  kick(id: string): void {
    this.drop(id);
  }
  drop(id: string): void {
    if (!this.peers.delete(id)) return;
    this.lastHeard.delete(id);
    this.onLeave(id);
  }
  close(): void {
    this.broadcast({ t: 'end' });
  }
}
const rooms = new Map<string, Room>();
const q: { to: G | Room; m: unknown; from: string; room: Room }[] = [];
HM.hostmigNet.makeHost = (code: string) => {
  const r = new Room(code);
  rooms.set(code, r);
  return r as never;
};
const connect = (g: G, room: Room, id: string) => {
  room.peers.set(id, g);
  room.lastHeard.set(id, performance.now());
  (g as any).role = 'client';
  (g as any).client = {
    code: room.code,
    open: true,
    lastHeard: performance.now(),
    send: (m: unknown) => q.push({ to: room, m, from: id, room }),
    close() {},
    drop() {},
  };
};
const flush = () => {
  for (let guard = 0; q.length && guard < 20000; guard++) {
    const { to, m, from, room } = q.shift()!;
    if (to instanceof Room) {
      if (to.dead || !to.peers.has(from)) continue;
      to.lastHeard.set(from, performance.now());
      to.onMessage(from, structuredClone(m));
    } else if (!room.dead) to.onClientMessage(structuredClone(m) as never);
  }
};
let live: G[] = [];
const step = (n: number, autoPick = true) => {
  for (let i = 0; i < n; i++) {
    for (const g of live) {
      g.update(1 / 60);
      flush();
    }
    if (!autoPick) continue;
    for (const g of live) {
      if (g.screens.current === 'levelup') g.ui('pick', 0);
      if (g.screens.current === 'shop') g.ui('done');
    }
    flush();
  }
};
const lo = { primary: 'buster', secondary: 'charge', special: 'bomb' };
const buildOf = (h: any) => JSON.stringify({ ...exportBuild(h, 0), level: 0, dead: false });

const A = mk();
const B = mk();
const C = mk();
const roomA = new Room('MIGRA');
rooms.set('MIGRA', roomA);
(A as any).role = 'host';
(A as any).host = roomA;
roomA.onMessage = (from, m) => A.onHostMessage(from, m as never);
roomA.onLeave = (id) => A.onClientLeft(id);
A.lobby = [{ peerId: '', name: 'ALPHA', unlocked: [], loadout: lo, skin: 'classic', pet: 'none', hero: 'rookie', look: '---00' } as any];
connect(B, roomA, 'peerB');
connect(C, roomA, 'peerC');
A.onHostMessage('peerB', { t: 'hello', pid: 'pid-bravo', name: 'BRAVO', loadout: lo });
A.onHostMessage('peerC', { t: 'hello', pid: 'pid-charlie', name: 'CHARLIE', loadout: lo });
ok(A.lobby.length === 3, 'run: three players in the lobby');
cheats.god = true;
A.hostStart();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
live = [A, B, C];
A.xpNext = 1e9;
step(40);
ok(B.mode === 'fight' && C.mode === 'fight' && C.heroes.length === 3, `run: everyone fighting (${A.mode}/${B.mode}/${C.mode})`);
// Give the run some shape: levels taken, gold, a Mod, enemies, an elite and a mini-boss-sized foe.
{
  for (const h of A.heroes) {
    h.pendingLevels = 3;
    h.gold = 40 + h.index * 7;
  }
  A.openLevelUp();
  flush();
  step(10); // everyone picks three times
  A.debugGiveMod((await import('../src/data/mods')).MODS[0].id);
  for (let i = 0; i < 25; i++) A.enemies.spawn(ENEMIES.swarmer, 10 + i, 5, A.spawnOpts());
  const el = A.enemies.spawn(ENEMIES.chonk, -8, 6, A.spawnOpts({ elite: true, eliteMod: 'shielded' }));
  el.hp = el.maxHp * 0.5;
  A.score = 12345;
  A.kills = 321;
  step(100);
}
const sB = HM.hostmigState(B);
const sC = HM.hostmigState(C);
ok(!!sB.mig && !!sC.mig && sB.mig.cands.join() === '1,2', `snapshot: both clients hold a migration snapshot naming the connected players (${sB.mig?.cands})`);
ok(!!sB.mig && sB.mig.heroes.length === 3 && sB.mig.en.byteLength > 20, 'snapshot: every hero and every enemy');

// ---------------------------------------------------------------- 1: the host is lost mid-level-up
for (const h of A.heroes) h.pendingLevels = 1;
A.openLevelUp();
flush();
step(30, false); // the level-up menus are open everywhere; nobody picks
ok(A.mode === 'levelup' && B.screens.current === 'levelup' && C.screens.current === 'levelup', `level-up open on every screen (${A.mode} ${B.screens.current} ${C.screens.current})`);
// A fresh snapshot (as every mode change sends), then the host's machine dies without a word.
const before = {
  builds: A.heroes.map(buildOf),
  gold: A.heroes.map((h) => h.gold),
  stage: A.stage,
  level: A.level,
  enemies: A.enemies.list.filter((e) => e.active && !e.def.hidden).length,
  elite: A.enemies.list.find((e) => e.active && e.elite),
  score: A.score,
};
roomA.dead = true;
live = [B, C];
for (const g of [B, C]) {
  NC.netcodeLost(g, (g as any).client);
  NC.netcodeState(g).rc!.next = Infinity; // no real PeerJS in Node: the test plays the reconnect itself
}
step(1, false);
ok(B.role === 'host' && B.host && (B.host as any).code === 'MIGRA-M1H1', `B (lowest join order) takes over in room ${(B.host as any)?.code} (${B.role})`);
ok(C.role === 'client' && NC.netcodeState(C).rc?.code === 'MIGRA-M1H1', `C points its reconnect at the new room (${NC.netcodeState(C).rc?.code})`);
ok(B.heroes.map(buildOf).join('|') === before.builds.join('|'), 'new host: every hero\'s build is the old host\'s');
ok(B.heroes.every((h, i) => h.gold === before.gold[i]), `new host: everyone's gold (${B.heroes.map((h) => h.gold)} vs ${before.gold})`);
ok(B.stage === before.stage && B.level === before.level && B.score >= before.score, `new host: stage ${B.stage}, level ${B.level}, score ${B.score}`);
const nEn = B.enemies.list.filter((e) => e.active).length;
ok(Math.abs(nEn - before.enemies) <= Math.max(3, before.enemies * 0.1), `new host: the whole horde, not just the mirrored part (${nEn} vs ${before.enemies})`);
const el2 = B.enemies.list.find((e) => e.active && e.elite);
ok(!!el2 && el2.mod?.id === 'shielded' && Math.abs(el2.hp - before.elite!.hp) < 1 && el2.maxHp === before.elite!.maxHp, 'new host: the elite with its modifier and life');
const cs = C2.coop2Debug(B);
ok(cs.grace.some((g) => g.index === 0) && cs.grace.some((g) => g.index === 2) && cs.pids[2] === 'pid-charlie', 'new host: the old host and C wait on the autopilot, C\'s player id known');
ok(HM.hostmigHolds(B, 2) && !HM.hostmigHolds(B, 0), 'new host: menus wait for C, not for the old host');
step(3, false);
ok(B.mode === 'levelup' && B.screens.current === 'levelup', `new host: the level-up is back on its screen (${B.mode}, ${B.screens.current})`);
// C reaches the new room (what its reconnect loop does over PeerJS).
const roomB = rooms.get('MIGRA-M1H1')!;
connect(C, roomB, 'peerC2');
NC.netcodeState(C).rc!.hello = true;
roomB.onMessage('peerC2', { t: 'hello', pid: 'pid-charlie', name: 'CHARLIE', loadout: lo });
flush();
step(3, false);
ok(!NC.netcodeState(C).rc && B.heroes[2].peerId === 'peerC2' && B.heroes.length === 3, `C reclaims its hero on the new host (peer ${B.heroes[2].peerId}, ${B.heroes.length} heroes)`);
ok(C.local === 2 && C.screens.current === 'levelup', `C's level-up comes back (${C.local}, ${C.screens.current})`);
ok(HM.hostmigState(C).migrations === 1 && HM.hostmigState(B).migrations === 1, 'both count one migration');
step(4); // B and C pick; the old host's hero is picked for by the autopilot
step(60);
ok(B.mode === 'fight' && C.mode === 'fight', `the run goes on (${B.mode}, ${C.mode})`);
ok(C.heroes[2].weapons.map((w) => w.def.id).join() === B.heroes[2].weapons.map((w) => w.def.id).join() && C.heroes.length === 3, 'C mirrors its build from the new host');
step(100);
ok(!!HM.hostmigState(C).mig && HM.hostmigState(C).mig!.ep === 1 && HM.hostmigState(C).mig!.hi === 1, 'the new host shares its own migration snapshots (epoch 1)');

// ---------------------------------------------------------------- 2: the new host is lost mid-shop; C carries on alone
B.stageClear();
step(1, false);
B.openShop();
flush();
step(5, false);
ok(B.mode === 'shop' && C.screens.current === 'shop', `shop open (${B.mode}, ${C.screens.current})`);
const cHero = B.heroes[2];
cHero.gold = 99;
B.presentShop(cHero);
flush();
step(110, false); // a migration snapshot at the usual cadence
const shopBefore = cHero.shopOffers.map((m) => m?.id ?? null).join();
const goldBefore = cHero.gold;
const buildC = buildOf(cHero);
rooms.get('MIGRA-M1H1')!.dead = true;
live = [C];
NC.netcodeLost(C, (C as any).client);
NC.netcodeState(C).rc!.next = Infinity;
step(1, false);
ok(C.role === 'solo' && !C.host, `the last player carries on alone (${C.role})`);
ok(C.mode === 'shop' && C.screens.current === 'shop', `the shop is still open (${C.mode}, ${C.screens.current})`);
ok(C.hero.shopOffers.map((m) => m?.id ?? null).join() === shopBefore && C.hero.gold === goldBefore && buildOf(C.hero) === buildC, 'same shop offers, gold and build');
ok(C2.coop2Debug(C).grace.length === 2, 'the two departed heroes are on the autopilot');
C.ui('done');
step(5, false);
ok(C.screens.current !== 'shop' && C.heroes.every((h) => h.shopDone), `the shop closes for the solo player (${C.screens.current})`);
for (let k = 0; k < 40 && C.route.open; k++) {
  C.routePick(0);
  step(30, false);
}
step(120);
ok(C.mode !== 'title' && C.mode !== 'dead' && HM.hostmigState(C).migrations === 2, `still in the run after two migrations (${C.mode})`);

// ---------------------------------------------------------------- a host leaving on purpose
{
  const H = mk();
  const K = mk();
  const room = new Room('BYEBY');
  rooms.set('BYEBY', room);
  (H as any).role = 'host';
  (H as any).host = room;
  room.onMessage = (from, m) => H.onHostMessage(from, m as never);
  room.onLeave = (id) => H.onClientLeft(id);
  H.lobby = [{ peerId: '', name: 'HOSTY', unlocked: [], loadout: lo, skin: 'classic', pet: 'none', hero: 'rookie', look: '---00' } as any];
  connect(K, room, 'peerK');
  H.onHostMessage('peerK', { t: 'hello', pid: 'pid-kilo', name: 'KILO', loadout: lo });
  H.hostStart();
  flush();
  if (H.mode === 'shop') H.closeShop();
  live = [H, K];
  step(60);
  let wentToTitle = false;
  const orig = K.leaveToTitle.bind(K);
  K.leaveToTitle = () => {
    wentToTitle = true;
    orig();
  };
  (K as any).client.drop = () => NC.netcodeLost(K, (K as any).client);
  H.leaveToTitle(); // hmig + mig, then 'end'
  flush();
  live = [K];
  if (NC.netcodeState(K).rc) NC.netcodeState(K).rc!.next = Infinity;
  step(2, false);
  ok(!wentToTitle && K.role === 'solo' && K.mode !== 'title', `a host quitting hands the run to the last player (${K.role}, ${K.mode})`);
  ok(HM.hostmigState(K).events.some((e) => /said goodbye/.test(e)), 'the client knew the host was leaving (no probe wait)');
}
