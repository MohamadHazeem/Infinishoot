/**
 * Four-player co-op in one process (host + 3 clients, messages passed by hand
 * like tests/coop2Coop.test.ts), as `npm run coop4` plays it in real browsers:
 * the starting shop, level-ups for everyone, the boss and its owned chests,
 * the shop (with the secret merchant's relic screen), the route vote, the
 * portal into stage 2, a client dropping out during a level-up and coming
 * back. After every phase no screen may be stuck and every client must agree
 * with the host on mode, stage, team level and builds.
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
  try {
    (globalThis as any)[k] = (dom.window as any)[k];
  } catch {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
  }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const { Input } = await import('../src/core/input');
const { Game, cheats, xpForLevel } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { PickupType } = await import('../src/game/pickups');
const C2 = await import('../src/game/systems/coop2');

settings.deathReplay = false;
settings.coopJoinable = true;
settings.coopPool = true;
settings.helpGhosts = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);

type G = InstanceType<typeof Game>;
const A = mk();
const peers = new Map<string, G>();
const q: [G, any, string][] = [];
(A as any).role = 'host';
(A as any).host = {
  code: 'K7P2Q',
  send: (id: string, m: any) => {
    const g = peers.get(id);
    if (g) q.push([g, m, '']);
  },
  broadcast: (m: any) => {
    for (const g of new Set(peers.values())) q.push([g, m, '']);
  },
  close() {},
};
const connect = (g: G, id: string) => {
  peers.set(id, g);
  (g as any).role = 'client';
  (g as any).client = { send: (m: any) => q.push([A, m, id]), close() {} };
};
const drop = (id: string) => {
  peers.delete(id);
  A.onClientLeft(id);
};
const flush = () => {
  for (let guard = 0; q.length && guard < 20000; guard++) {
    const [g, m, from] = q.shift()!;
    if (g === A) A.onHostMessage(from, structuredClone(m));
    else if ([...peers.values()].includes(g)) g.onClientMessage(structuredClone(m));
  }
};
const clients = () => [...new Set(peers.values())];

/** What the dev bot does on each machine's menus (clients answer through UI messages). */
let answer = true;
/** Which road each player votes for (by hero index). */
let roadOf = (_i: number) => 0;
function bot(g: G): void {
  const s = g.screens.current;
  if (g.role === 'client') {
    if (s === 'levelup') (g as any).ui('pick', 0);
    else if (s === 'relic') (g as any).ui('relic', 0);
    else if (s === 'shop') (g as any).ui('done');
    else if (s === 'route' && g.routeLocalVote < 0) g.routePick(Math.min(roadOf(g.local), A.routeOptionCount() - 1));
    return;
  }
  if (g.mode === 'levelup' && g.hero.needsPick) (g as any).ui('pick', 0);
  if (g.mode === 'shop' && !g.hero.shopDone) {
    if (g.hero.relicOffers.length) (g as any).ui('relic', 0);
    (g as any).ui('done');
  }
  if (g.route.open && g.route.decided < 0 && g.route.votes[g.local] < 0) g.routePick(Math.min(roadOf(g.local), g.routeOptionCount() - 1));
}
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    for (const c of clients()) {
      c.update(1 / 60);
      flush();
    }
    if (i % 10 === 0) {
      A.render(1, 1 / 60);
      for (const c of clients()) c.render(1, 1 / 60);
    }
    if (answer && i % 6 === 0) {
      bot(A);
      for (const c of clients()) bot(c);
      flush();
    }
  }
};
/** Walk every living hero onto a spot (host side; clients follow from the snapshot for their own hero via teleport). */
const gather = (x: number, z: number) => {
  for (const g of [A, ...clients()]) g.hero.player.teleport(x + g.local * 0.3, z);
  for (const h of A.heroes) if (h.remote) Object.assign(h.remote, { x: h.player.x, z: h.player.z, vx: 0, vz: 0 });
};

const MENUS = ['levelup', 'relic', 'shop', 'wait', 'route'];
/** No client may sit on a menu the host has closed; everyone agrees with the host. */
function agree(tag: string): void {
  const bad: string[] = [];
  clients().forEach((c) => {
    const me = A.heroes[c.local];
    if (c.mode !== A.mode) bad.push(`client ${c.local} mode ${c.mode} vs ${A.mode}`);
    if (c.stage !== A.stage) bad.push(`client ${c.local} stage ${c.stage} vs ${A.stage}`);
    if (Math.abs(c.level - A.level) > 0) bad.push(`client ${c.local} level ${c.level} vs ${A.level}`);
    if (c.heroes.length !== A.heroes.length) bad.push(`client ${c.local} has ${c.heroes.length} heroes`);
    if (MENUS.includes(c.screens.current) && !(A.mode === 'levelup' || A.mode === 'shop' || A.route.open)) bad.push(`client ${c.local} stuck on ${c.screens.current} (host ${A.mode})`);
    A.heroes.forEach((h, j) => {
      const m = c.heroes[j];
      const key = (x: typeof h) => x.weapons.map((w) => w.def.id + ':' + (w.build ? w.buildKey : w.level)).join(' ');
      if (m && !h.left && key(h) !== key(m)) bad.push(`client ${c.local} hero ${j} build [${key(m)}] vs [${key(h)}]`);
    });
    if (me && me.gold !== c.hero.gold) bad.push(`client ${c.local} gold ${c.hero.gold} vs ${me.gold}`);
  });
  ok(!bad.length, `${tag}: every client agrees with the host and no screen is stuck${bad.length ? ` (${bad.slice(0, 4).join('; ')})` : ''}`);
}

// ---------------------------------------------------------------- four players start
const B = mk();
const C = mk();
const D = mk();
connect(B, 'pB');
connect(C, 'pC');
connect(D, 'pD');
const names = ['Host', 'Bee', 'Cee', 'Dee'];
const heroes = ['rookie', 'bulwark', 'ace', 'dash'];
const ids = ['', 'pB', 'pC', 'pD'];
// The real lobby path: each client says hello with its stable player id (localStorage in the game).
A.lobby = [{ peerId: '', name: 'Host', unlocked: unlockedWeapons(), skin: 'classic', pet: 'none', hero: 'rookie', loadout: A.hero.loadoutPick }];
for (let i = 1; i < 4; i++) A.onHostMessage(ids[i], { t: 'hello', pid: `pid-${names[i]}`, name: names[i], hero: heroes[i], loadout: A.hero.loadoutPick });
ok(A.lobby.length === 4, `4 players in the lobby (${A.lobby.length})`);
// A fifth player is turned away by the game with a reason (the transport keeps one spare connection for reconnects).
const toE: any[] = [];
const send0 = (A as any).host.send;
(A as any).host.send = (id: string, m: any) => (id === 'pE' ? toE.push(m) : send0(id, m));
A.onHostMessage('pE', { t: 'hello', pid: 'pid-Eve', name: 'Eve', hero: 'rookie', loadout: A.hero.loadoutPick });
(A as any).host.send = send0;
// Online co-op takes 8 since the eightp lane: the 5th player is seated, then leaves again so this test stays a 4-player run.
ok(A.lobby.length === 5 && !toE.some((m) => m.t === 'full'), `a 5th player in the lobby is seated (${A.lobby.length}, ${JSON.stringify(toE.map((m) => m.t))})`);
A.lobbyLeft('pE');
A.onClientLeft('pE');
ok(A.lobby.length === 4, `the 5th player left the lobby (${A.lobby.length})`);
A.hostStart();
flush();
cheats.god = true;
step(120);
ok(A.mode === 'fight' && clients().every((c) => c.mode === 'fight' && c.heroes.length === 4), `4 players through the starting shop into the fight (host ${A.mode}, clients ${clients().map((c) => c.mode)})`);
agree('start');

// ---------------------------------------------------------------- level-ups for everyone
A.gainXp(xpForLevel(A.level) + xpForLevel(A.level + 1) + 1);
step(6);
ok(A.mode === 'levelup' && clients().every((c) => c.screens.current === 'levelup' || c.screens.current === 'wait'), `a double level-up opens on every machine (clients ${clients().map((c) => c.screens.current)})`);
step(240);
ok(A.mode === 'fight' && A.heroes.every((h) => !h.needsPick), 'everyone picked both cards, the host is back in the fight');
agree('after level-ups');

// ---------------------------------------------------------------- the boss, its owned chests, the shop and the route
A.debugBoss({ now: true });
step(60);
ok(!!A.boss?.active, 'the stage boss is out');
const boss = A.boss!;
// The heroes stand together, a little off the boss: the chests drop between them and the boss.
gather(boss.x + 4, boss.z + 4);
// The secret merchant will run the shop (its relic screen comes first on every machine).
const secret = (A as any).routeSecretShop;
(A as any).routeSecretShop = () => true;
const relics0 = A.heroes.map((h) => h.relics.length);
A.killEnemy(boss, 'buster', A.heroes[2]);
let chests = -1;
const pending = () => A.heroes.map((h) => h.chestsPending + (h.needsPick ? 1 : 0));
for (let k = 0; k < 300 && A.mode !== 'shop'; k++) {
  step(5);
  chests = 0;
  for (let i = 0; i < A.pickups.count; i++) if (A.pickups.type[i] === PickupType.Chest) chests++;
}
ok(chests === 0, `every hero's boss chest reached its owner before the shop (${chests} left, mode ${A.mode})`);
(A as any).routeSecretShop = secret;
ok(A.mode === 'shop' && A.secretShop, `the secret shop opened (mode ${A.mode}, secret ${A.secretShop})`);
for (let k = 0; k < 80 && (A.mode === 'shop' || A.route.open); k++) step(10);
ok(A.heroes.every((h, i) => h.relics.length >= relics0[i] + 2), `everyone got the boss relic and took one at the secret merchant (${relics0} -> ${A.heroes.map((h) => h.relics.length)})`);
void pending;
ok(A.mode === 'portal' && !A.route.open, `shop and route vote done, the portal is open (mode ${A.mode})`);
agree('after shop and route');
gather(A.portal.x, A.portal.z);
for (let k = 0; k < 120 && !(A.stage === 2 && A.mode === 'fight'); k++) step(10);
ok(A.stage === 2 && A.mode === 'fight', `stage 2 (host stage ${A.stage}, ${A.mode})`);
step(60);
agree('stage 2');

// ---------------------------------------------------------------- a client drops out during a level-up, then comes back
answer = false;
A.gainXp(xpForLevel(A.level) + 1);
step(4);
ok(A.mode === 'levelup', 'a level-up is open');
drop('pD');
step(4);
answer = true;
step(60);
ok(A.mode === 'fight', `the dropped player's autopilot picked its card, nobody waits (mode ${A.mode})`);
ok(C2.coop2Debug(A).grace.some((g) => g.index === 3), 'hero 3 plays on autopilot');
// The stage-2 boss, shop and route map with an empty seat: its autopilot closes the shop and votes, nobody waits out the vote timer.
A.debugBoss({ now: true });
step(60);
if (A.boss?.active) {
  gather(A.boss.x + 4, A.boss.z + 4);
  A.killEnemy(A.boss, 'buster', A.heroes[0]);
}
// A split vote (2 for the first road, 1 for the second): no majority until the empty seat votes.
roadOf = (i) => (i === 2 ? 1 : 0);
for (let k = 0; k < 400 && !A.route.open; k++) step(5);
ok(A.route.open, `the route map opened with hero 3 on autopilot (mode ${A.mode})`);
let routeSteps = 0;
for (; routeSteps < 900 && A.route.open; routeSteps += 5) step(5);
roadOf = () => 0;
ok(!A.route.open && routeSteps < 360, `the vote finished in ${(routeSteps / 60).toFixed(1)} s, well inside the 10 s timer`);
agree('route with an empty seat');
const D2 = mk();
connect(D2, 'pD2');
D2.netName = 'Dee';
// Same player (same stable id) on a new connection: it must get its own hero back, not be refused as a 5th player.
A.onHostMessage('pD2', { t: 'hello', name: 'Dee', pid: 'pid-Dee', loadout: A.hero.loadoutPick, hero: 'dash' });
step(60);
ok(D2.local === 3 && D2.heroes.length === 4 && A.heroes[3].peerId === 'pD2' && !A.heroes[3].left, `the player is back on hero 3 (local ${D2.local}, peer ${A.heroes[3].peerId})`);
step(60);
agree('after the drop-in');

// ---------------------------------------------------------------- host cost with four players (printed, not asserted)
{
  const { wireBytes } = await import('../src/dev/netSize');
  let snapMs = 0;
  let snapN = 0;
  const bytes = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  const build = A.buildSnapshot;
  (A as any).buildSnapshot = function (h: any, ev: any) {
    const t = performance.now();
    const r = build.call(this, h, ev);
    snapMs += performance.now() - t;
    snapN++;
    bytes[h.index] += wireBytes({ t: 's', ...r });
    counts[h.index]++;
    return r;
  };
  // Whatever stage it is, get into a fight with a big horde around the team.
  for (let k = 0; k < 600 && A.mode !== 'fight'; k++) {
    if (A.mode === 'portal') gather(A.portal.x, A.portal.z);
    step(5);
  }
  const { ENEMIES } = await import('../src/data/enemies');
  const kinds = ['swarmer', 'bopper', 'zippy', 'shooter', 'chonk'].filter((k) => ENEMIES[k]);
  let spawned = 0;
  const horde = () => {
    for (let i = 0; A.enemies.activeCount < 160 && i < 200; i++, spawned++) {
      const h = A.heroes[spawned % 4].player;
      const a = spawned * 2.4;
      A.enemies.spawn(ENEMIES[kinds[spawned % kinds.length]], h.x + Math.cos(a) * (9 + (spawned % 9)), h.z + Math.sin(a) * (9 + (spawned % 9)), A.spawnOpts({ instant: true }));
    }
  };
  A.director.time = 0; // no boss during the measurement
  A.xpNext = 1e9; // and no level-up menus
  let upd = 0;
  let n = 0;
  let alive = 0;
  for (let i = 0; i < 1200; i++) {
    if (i % 30 === 0) horde();
    alive += A.enemies.activeCount;
    const t = performance.now();
    A.update(1 / 60);
    upd += performance.now() - t;
    n++;
    flush();
    for (const c of clients()) {
      c.update(1 / 60);
      flush();
    }
    if (i % 6 === 0) {
      bot(A);
      for (const c of clients()) bot(c);
      flush();
    }
  }
  (A as any).buildSnapshot = build;
  console.log(`info host with 4 players (jsdom, no rendering, stage ${A.stage} ${A.mode}): ${(upd / n).toFixed(2)} ms per step on average with ${Math.round(alive / n)} enemies alive; buildSnapshot ${(snapMs / Math.max(1, snapN)).toFixed(3)} ms per client; snapshot bytes per client ${bytes.map((b, i) => Math.round(b / Math.max(1, counts[i]))).slice(1).join(' / ')}`);
}
