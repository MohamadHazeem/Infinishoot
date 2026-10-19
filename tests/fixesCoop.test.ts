/**
 * Fixes lane, co-op: a host Game and a client Game wired together in-process
 * (jsdom, no WebGL). Round trips for the new messages: heartbeat, lagged
 * parry, online hit-stop events, smashed cover, ping-wheel pings, plus team
 * status combos and the ping wheel's slice picking.
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
const { ENEMIES } = await import('../src/data/enemies');
const NF = await import('../src/game/netFeel');
const CB = await import('../src/game/coverBreak');
const TP = await import('../src/game/teamPlay');

// ---- Ping wheel slices (pure) ----
ok(TP.wheelSlice(0, -50, 20) === 0, 'wheel: up picks the first ping (GO HERE)');
ok(TP.wheelSlice(0, 50, 20) === 3, 'wheel: down picks the opposite one');
ok(TP.wheelSlice(43, -25, 20) === 1 && TP.wheelSlice(-43, -25, 20) === 5, 'wheel: slices go clockwise');
ok(TP.wheelSlice(5, 5, 20) === -1, 'wheel: the middle is a dead zone (cancel)');
ok(TP.wheelSlice(0.6, 0, 0.45) === 2 || TP.wheelSlice(0.6, 0, 0.45) === 1, 'wheel: works with stick units');
ok(TP.pingKind('danger')?.label === 'DANGER!' && TP.pingKind('nope') === null && TP.pingKind(42) === null, 'ping kinds are validated');

cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
let echoes = 0;
(A as any).host = { send: (_id: string, m: any) => (m.t === 'hb' && echoes++, q.push([B, m])), broadcast: (m: any) => q.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const flush = () => {
  while (q.length) {
    const [g, m] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
    flush();
  }
};
step(30);

// ---- Heartbeat: the client measures its round trip ----
step(70);
ok(echoes >= 1 && (NF as any).feelState(B).nextHb > 0 && NF.clientRtt(B) >= 0, `client sends heartbeats and the host echoes them (${echoes})`);

// ---- A client parry carries its round trip; the host keeps the lag ----
(NF as any).feelState(B).rtt = 180;
const guest = A.heroes[1];
B.hero.skill.parryCd = 0;
B.input.pressed.add('KeyC');
B.update(1 / 60);
flush();
ok(NF.heroParryLag(A, guest) > 0.1, `the host rewinds the guest's parry by ${NF.heroParryLag(A, guest).toFixed(3)} s`);

// ---- Online hit-stop: the guest's heavy hit holds the guest's picture only ----
const e = A.enemies.spawn(ENEMIES.chonk, guest.player.x + 3, guest.player.z, A.spawnOpts({ instant: true }));
step(2);
const stopA = (NF as any).feelState(A).stopT;
A.skillHit(e, { source: 'rail', loud: true } as any, 50, true, guest);
step(4);
ok((NF as any).feelState(B).stopT > 0, 'the guest gets a render-side hit-stop for its own heavy hit');
ok((NF as any).feelState(A).stopT === stopA, "the host's picture doesn't stop for the guest's hit");
A.skillHit(e, { source: 'rail', loud: true } as any, 50, true, A.hero);
ok((NF as any).feelState(A).stopT > 0, 'the host gets one for its own heavy hit');
ok(A.juice.hitStop === 0, 'online, the simulation never freezes');

// ---- Smashed cover reaches the client ----
const map = A.arena.group.userData.coverRanges as Map<unknown, unknown>;
const box = A.arena.colliders.find((b) => map.has(b))!;
const same = (b: { minX: number; minZ: number }) => Math.abs(b.minX - box.minX) < 1e-6 && Math.abs(b.minZ - box.minZ) < 1e-6;
ok(B.arena.colliders.some(same), 'client has the same cover');
CB.smashCover(A, (box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2, 1);
step(2);
ok(CB.coverStats(B).broken === CB.coverStats(A).broken && CB.coverStats(B).broken >= 1 && !B.arena.colliders.some(same), `client drops the cover the host smashed (${CB.coverStats(A).broken}/${CB.coverStats(B).broken})`);

// ---- Ping wheel pings travel client -> host ----
const pingAt = guest.pingAt;
B.client!.send({ t: 'ping', x: 1, z: 2, k: 'danger' });
flush();
ok(guest.pingAt > pingAt, 'host takes a ping-wheel ping from the client');
const t0 = guest.pingAt;
B.client!.send({ t: 'ping', x: 1, z: 2, k: 'danger' });
flush();
ok(guest.pingAt === t0, 'pings stay rate-limited');

// ---- Team combos: my Burn + your Shock ----
step(60);
const T = TP.teamState(A);
const n0 = T.count;
const en = A.enemies.spawn(ENEMIES.chonk, A.hero.player.x + 6, A.hero.player.z, A.spawnOpts({ instant: true }));
step(2);
const gold0 = [A.heroes[0].gold, A.heroes[1].gold];
const style0 = [A.heroes[0].skill.style.points, A.heroes[1].skill.style.points];
A.ignite(en, 5, A.heroes[0]);
A.shock(en, A.heroes[1]);
ok(T.count === n0 + 1, 'host Burn + guest Shock is a team combo (Overload)');
ok(A.heroes[0].gold > gold0[0] && A.heroes[1].gold > gold0[1], 'both partners get a coin');
ok(A.heroes[0].skill.style.points > style0[0] && A.heroes[1].skill.style.points > style0[1], 'both partners get style');
step(40);
const en2 = A.enemies.spawn(ENEMIES.chonk, A.hero.player.x - 6, A.hero.player.z, A.spawnOpts({ instant: true }));
step(2);
const n1 = T.count;
A.shock(en2, A.heroes[0]);
A.ignite(en2, 5, A.heroes[0]);
ok(T.count === n1, 'one hero on their own makes a normal Overload, not a team combo');
step(40);
const en3 = A.enemies.spawn(ENEMIES.chonk, A.hero.player.x, A.hero.player.z + 6, A.spawnOpts({ instant: true }));
step(2);
const n2 = T.count;
A.shock(en3, A.heroes[1]);
A.ignite(en3, 5, A.heroes[0]);
ok(T.count === n2 + 1, 'guest Shock + host Burn the other way round works too');
step(40);
const en4 = A.enemies.spawn(ENEMIES.chonk, A.hero.player.x - 6, A.hero.player.z - 6, A.spawnOpts({ instant: true }));
step(2);
const n3 = T.count;
A.ignite(en4, 5, A.heroes[1]);
A.blast(en4.x, en4.z, 2, 10, '#ffffff', 'grenade', ['explosive'], false, A.heroes[0]);
ok(T.count === n3 + 1, "host blast catching the guest's Burn is a team Napalm");
