/**
 * Spectate lane online, in one process (host + a player + spectators, messages
 * passed by hand like tests/coop2Coop.test.ts): JOIN AS SPECTATOR in the lobby
 * (WATCHING rows), a full lobby seating a 5th friend as a spectator, the run
 * starting on the spectator's screen, reduced snapshots (10 Hz, no gold/Mods),
 * heroes mirrored, following and the free camera moving the host's interest
 * box, players' own events untouched by spectator snapshots, emotes (rate
 * limited, shown to players) and the WATCHING badge, inputs from spectators
 * ignored, playing from the next stage through coop2's drop-in, leaving, and
 * the 8-seat cap.
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

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const SP = await import('../src/game/systems/spectate');
const C2 = await import('../src/game/systems/coop2');
const { spectateTuning } = await import('../src/game/spectate');

settings.deathReplay = false;
settings.coopJoinable = true;
settings.coopPool = false;
settings.helpGhosts = false;
settings.spectators = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);

type G = InstanceType<typeof Game>;
const A = mk();
const peers = new Map<string, G>();
const q: [G, any, string][] = [];
(A as any).role = 'host';
(A as any).host = {
  code: 'SPEC1',
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
  (g as any).client = { send: (m: any) => q.push([A, m, id]), close() {}, code: 'SPEC1' };
};
const drop = (id: string) => {
  peers.delete(id);
  A.onClientLeft(id);
};
const got = new Map<G, Record<string, number>>();
const flush = () => {
  for (let guard = 0; q.length && guard < 5000; guard++) {
    const [g, m, from] = q.shift()!;
    if (g === A) A.onHostMessage(from, structuredClone(m));
    else if ([...peers.values()].includes(g)) {
      const c = got.get(g) ?? {};
      c[m.t] = (c[m.t] ?? 0) + 1;
      got.set(g, c);
      g.onClientMessage(structuredClone(m));
    }
  }
};
const clients = () => [...new Set(peers.values())];
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    for (const c of clients()) {
      c.update(1 / 60);
      flush();
    }
    if (i % 6 === 0) {
      A.render(1, 1 / 60);
      for (const c of clients()) c.render(1, 1 / 60);
    }
    if (A.mode === 'levelup') {
      (A as any).ui('pick', 0);
      for (const c of clients()) if (!SP.spectating(c)) (c as any).ui('pick', 0);
      flush();
    }
    if (A.mode === 'shop') {
      (A as any).ui('done');
      for (const c of clients()) if (!SP.spectating(c)) (c as any).ui('done');
      flush();
    }
  }
};
const hello = (name: string, pid: string, extra: Record<string, unknown> = {}) => ({ t: 'hello', pid, name, unlocked: unlockedWeapons(), loadout: A.hero.loadoutPick, skin: 'classic', pet: 'none', hero: 'rookie', look: '---00', ...extra });
const sA = SP.spectateState(A);

// ---- Lobby: a player joins, a friend picks JOIN AS SPECTATOR
A.lobby = [{ peerId: '', name: 'Host', unlocked: [], skin: 'classic', pet: 'none', hero: 'bulwark', loadout: A.hero.loadoutPick }];
const B = mk();
connect(B, 'peerB');
q.push([A, hello('Guest', 'pidguest0001', { hero: 'ace' }), 'peerB']);
flush();
ok(A.lobby.length === 2, 'a player joins the lobby');
ok(!!document.querySelector('#scr-online .join-row [data-act=sp-join]'), 'PLAY ONLINE has a JOIN AS SPECTATOR button');
const S = mk();
connect(S, 'peerS');
q.push([A, hello('Watcher', 'pidwatch0001', { spec: 1 }), 'peerS']);
flush();
ok(A.lobby.length === 2 && sA.specs.length === 1 && sA.specs[0].name === 'Watcher', 'JOIN AS SPECTATOR takes a spectator seat, not a lobby slot');
ok(SP.spectateState(S).on && (got.get(S)?.spwelcome ?? 0) === 1, 'the spectator is told it is watching');
ok(SP.spectateState(B).lobbyNames.join() === 'Watcher' && SP.spectateState(S).lobbyNames.join() === 'Watcher', 'everyone in the lobby sees the WATCHING row');
const row = document.querySelector('#scr-online .sp-lobby');
ok(!!row && (row.textContent ?? '').includes('Watcher') && (row.textContent ?? '').includes('WATCHING'), 'the lobby screen draws WATCHING rows');

// ---- A full lobby seats the 5th friend as a spectator
const fillers: G[] = [];
for (const n of ['P3', 'P4']) {
  const g = mk();
  connect(g, 'peer' + n);
  q.push([A, hello(n, 'pid' + n + '0000001'), 'peer' + n]);
  fillers.push(g);
}
flush();
ok(A.lobby.length === 4, 'the lobby fills up to 4 players');
const F = mk();
connect(F, 'peerF');
q.push([A, hello('Fifth', 'pidfifth0001'), 'peerF']);
flush();
ok(A.lobby.length === 4 && sA.specs.length === 2 && SP.spectateState(F).on && SP.spectateState(F).why === 'full', 'a 5th friend in a full lobby becomes a spectator ("THE GAME IS FULL")');
// The two fillers leave again (a 2-player run keeps slots open for later).
for (const n of ['P3', 'P4']) drop('peer' + n);
flush();
ok(A.lobby.length === 2, 'the fillers left the lobby');

// ---- The run starts: spectators get it too
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons(), '', 'classic', 'none', 'bulwark'), A.makeHero(1, 'Guest', [], 'peerB', 'classic', 'none', 'ace')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
cheats.god = true;
A.xpNext = 1e9;
step(20);
ok(B.mode === 'fight' && B.heroes.length === 2, 'the player is in the run');
ok(S.mode === 'fight' && S.heroes.length === 2 && SP.spectating(S) && S.role === 'client', 'the spectator is watching the run (no hero of its own)');
ok(S.stage === A.stage && S.seed === A.seed, 'same stage and seed on the spectator');
ok(document.body.classList.contains('spectating'), 'the spectator HUD hides the personal panels');

// ---- Reduced snapshots
got.clear();
A.heroes[0].gold = 40;
step(60);
const nB = got.get(B)?.s ?? 0;
const nS = got.get(S)?.s ?? 0;
ok(nB >= 18 && nB <= 21 && nS >= 9 && nS <= 11, `spectators get half the snapshots (player ${nB}, spectator ${nS} in 1 s)`);
ok(S.heroes[0].gold === 0 && S.netMods.length === 0, 'no private build data (gold, Mods) in a spectator snapshot');
A.heroes[0].player.teleport(10, -6);
A.heroes[1].player.teleport(-8, 4);
step(30);
const dx = (i: number) => Math.hypot(S.heroes[i].player.x - A.heroes[i].player.x, S.heroes[i].player.z - A.heroes[i].player.z);
ok(dx(0) < 0.6 && dx(1) < 1.5, `every hero is mirrored on the spectator (${dx(0).toFixed(2)} m, ${dx(1).toFixed(2)} m)`);
ok(Math.abs(S.heroes[1].player.hp - A.heroes[1].player.hp) < 1.01, 'with their life');

// ---- Following and the free camera move the host's interest box
const sS = SP.spectateState(S);
sS.follow = 1;
sS.cam = 'follow';
step(30);
ok(sA.specs.find((x) => x.peerId === 'peerS')!.follow === 1 && S.local === 1, 'following player 2: the host knows, the HUD shows them');
const p1 = A.heroes[1].player;
A.enemies.spawn(ENEMIES.chonk, p1.x, p1.z + 57, { ...A.spawnOpts(), instant: true });
A.enemies.spawn(ENEMIES.chonk, p1.x, p1.z - 80, { ...A.spawnOpts(), instant: true });
step(12);
const far = [...S.netEnemies.values()].filter((e) => e.def.id === 'chonk').length;
ok(far === 1, `the interest box is wider for spectators (a Chonk 57 m away arrives, one 80 m away doesn't: ${far})`);
sS.cam = 'free';
sS.fx = 30;
sS.fz = 30;
step(30);
const hs = sA.specs.find((x) => x.peerId === 'peerS')!;
ok(hs.follow === -1 && Math.abs(hs.x - 30) < 0.1 && Math.abs(hs.z - 30) < 0.1, 'free camera: the host centres the spectator snapshot on its view');
sS.cam = 'follow';
sS.follow = 0;
step(10);

// ---- Players' own events are untouched by spectator snapshots
const co = C2.coopState(A);
A.coopEmote(A.heroes[1], 'cheer');
step(12);
ok(C2.coop2Debug(B).bubbles.has(1), "the player's own emote still reaches them (event cursors kept per spectator)");
ok(C2.coop2Debug(S).bubbles.has(1), 'and the spectator sees it too');
ok(co.sent[1] === co.seq, 'the player cursor is the host sequence after both snapshots');

// ---- Spectator emotes: rate-limited, shown to players, badge
for (let i = 0; i < 5; i++) q.push([A, { t: 'emote', k: 'cheer' }, 'peerS']);
flush();
step(12);
ok(sA.seq === 1, `5 emotes at once from a spectator: 1 gets through (${sA.seq})`);
ok(SP.spectateState(B).shown === 1 && SP.spectateState(B).watchers.n === 2, 'the player sees the emote and "2 WATCHING"');
const feed = document.querySelectorAll('#sp-root .sp-feed > div');
ok(feed.length >= 1 && (feed[feed.length - 1].textContent ?? '').includes('WOO-HOO'), 'the emote shows in the feed');
q.push([A, { t: 'emote', k: 'nope' }, 'peerS']);
flush();
ok(sA.seq === 1, 'unknown emotes are ignored');

// ---- Inputs from spectators don't touch the game
const before = A.heroes.length;
const hx = A.heroes[1].player.x;
for (const m of [{ t: 'i', x: 99, z: 99, vx: 0, vz: 0, ax: 1, az: 0, f: true }, { t: 'bomb' }, { t: 'ui', a: 'pick', i: 0 }, { t: 'ping', x: 1, z: 1 }]) q.push([A, m, 'peerS']);
flush();
ok(A.heroes.length === before && Math.abs(A.heroes[1].player.x - hx) < 0.5, 'player messages from a spectator are ignored');

// ---- Play from the next stage
q.push([A, { t: 'spjoin', on: 1 }, 'peerS']);
flush();
ok(hs.wantJoin && !hs.joining, 'the request waits for the next stage');
step(30);
ok(A.heroes.length === 2, 'no join mid-stage');
A.loadStage(A.stage + 1);
flush();
step(30);
ok(A.heroes.length === 3 && A.heroes[2].peerId === 'peerS' && A.heroes[2].name === 'Watcher', 'the next stage: the spectator joins as hero 3 (coop2 drop-in)');
ok(!SP.spectating(S) && S.local === 2 && S.heroes.length === 3, 'and plays its own hero');
ok(!sA.specs.some((x) => x.peerId === 'peerS'), 'its seat is free again');
ok(!document.body.classList.contains('spectating') || SP.spectating(F), 'the spectator HUD is gone for the new player');
ok(SP.spectating(F) && F.heroes.length === 3, 'the other spectator gets the new roster');

// ---- Leaving, and the seat cap
drop('peerF');
ok(sA.specs.length === 0, 'a spectator who leaves frees the seat');
const crowd: G[] = [];
for (let i = 0; i < spectateTuning.max + 1; i++) {
  const g = mk();
  connect(g, 'peerW' + i);
  q.push([A, hello('W' + i, 'pidw' + i + '0000000', { spec: 1 }), 'peerW' + i]);
  crowd.push(g);
}
flush();
ok(sA.specs.length === spectateTuning.max, `${spectateTuning.max} seats fill`);
ok((got.get(crowd[spectateTuning.max])?.full ?? 0) === 1 && !SP.spectateState(crowd[spectateTuning.max]).on, 'the next one is told the seats are full');
step(10);
ok(crowd.slice(0, 3).every((g) => SP.spectating(g) && g.mode !== 'title'), 'late spectators are dropped straight into the run');
ok(SP.spectateState(B).watchers.n === spectateTuning.max, `the players see ${spectateTuning.max} WATCHING`);
console.log('spectate online checks done');
process.exit(process.exitCode ?? 0);
