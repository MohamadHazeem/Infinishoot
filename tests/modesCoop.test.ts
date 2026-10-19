/**
 * Modes lane, co-op: a host Game and a client Game wired together in-process (jsdom, no WebGL).
 * The rhythm stage's beat agrees on both machines (the client runs the host's clock function, it
 * never reads audio), the client sees the Pacifist road's rules and can't hurt anything there, and
 * both play the same mini-game at once, each earning their own gold.
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
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));
process.on('exit', () => {
  if (errors.length) console.error('FAIL runtime errors:\n' + errors.slice(0, 3).join('\n'));
});

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { ENEMIES } = await import('../src/data/enemies');
const { modesForce } = await import('../src/game/systems/modes');
const R = await import('../src/game/modes/rhythm');

cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const flush = () => {
  while (q.length) {
    const [g, m] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
modesForce.rhythm = true;
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
const guestA = A.heroes[1];
let maxDiff = 0;
const step = (n: number, check = false) => {
  for (let i = 0; i < n; i++) {
    A.xp = 0;
    A.xpNext = 1e12;
    for (const h of A.heroes) h.pendingLevels = h.chestsPending = 0;
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
    flush();
    if (check && B.modes.rhythm) {
      const d = Math.abs(A.modes.beat - B.modes.beat);
      maxDiff = Math.max(maxDiff, d);
    }
    if (i % 10 === 0) B.render(1, 1 / 6);
  }
};
step(40);
ok(B.role === 'client' && B.heroes.length === 2 && B.mode === 'fight', 'client joined the fight');

// Rhythm: the same beat on both machines.
step(600, true);
ok(A.modes.rhythm && B.modes.rhythm && A.modes.clock.bpm === B.modes.clock.bpm, `both machines on a rhythm stage (${B.modes.clock.bpm} BPM)`);
ok(maxDiff < 0.12, `client beat stays within ${maxDiff.toFixed(3)} beats of the host's (snapshots are 20 Hz)`);
const phaseA = R.beatPhase(A.modes.beat);
const phaseB = R.beatPhase(B.modes.beat);
ok(Math.abs(phaseA - phaseB) < 0.12 || Math.abs(phaseA - phaseB) > 0.88, `beat phase agrees (host ${phaseA.toFixed(2)}, client ${phaseB.toFixed(2)})`);
// Boss tempo: the clock follows the boss theme on both.
A.debugSkipToBoss();
maxDiff = 0;
step(300, true);
ok(!!A.boss && A.modes.clock.bpm === R.stageBpm(1, 1, true) && B.modes.clock.bpm === A.modes.clock.bpm && maxDiff < 0.12, `boss out: both switch to the boss tempo (${B.modes.clock.bpm} BPM), within ${maxDiff.toFixed(3)} beats through the entrance's slow motion`);
modesForce.rhythm = null;

// Pacifist road on the client.
for (const e of A.enemies.list) if (e.active) A.enemies.kill(e);
A.boss = null;
A.route.force = 'pacifist';
A.loadStage(2);
flush();
step(30);
ok(B.modes.pacifist && B.modes.holster && B.modes.pacLeft > 100, `client sees the Pacifist road (${B.modes.pacLeft.toFixed(1)} s left)`);
const foe = A.enemies.spawn(ENEMIES.chonk, guestA.player.x + 3, guestA.player.z, A.spawnOpts({ instant: true }));
const hp = foe.hp;
guestA.remote = { ...(guestA.remote ?? { vx: 0, vz: 0, ax: 1, az: 0, ad: -1, charging: false, dashing: false }), firing: true } as any;
step(60);
ok(foe.hp === hp && (guestA.damageBy.buster ?? 0) === 0, "pacifist: the guest's shots don't hurt");
A.route.force = null;

// Mini-game: both play, each earns their own gold.
for (const e of A.enemies.list) if (e.active) A.enemies.kill(e);
A.startMiniGame('coins');
flush();
step(20);
ok(B.modes.mg?.kind === 'coins' && B.mode === 'portal', 'client sees the mini-game');
const goldA0 = A.hero.gold;
const goldB0 = guestA.gold;
let got = false;
for (let i = 0; i < 60 * 28 && A.modes.mg; i++) {
  const coin = A.modes.mg.items.find((it) => it.by === -1 && it.age > 0.2);
  if (coin) {
    // Only the guest chases coins; the host stands far away.
    guestA.remote = { ...guestA.remote!, x: coin.x, z: coin.z } as any;
    guestA.player.pos.x = guestA.player.prev.x = coin.x;
    guestA.player.pos.z = guestA.player.prev.z = coin.z;
    B.hero.player.pos.x = coin.x;
    B.hero.player.pos.z = coin.z;
  }
  A.hero.player.pos.x = A.hero.player.prev.x = -40;
  A.hero.player.pos.z = A.hero.player.prev.z = -40;
  step(1);
  if (B.modes.mg && (B.modes.mg.gold[1] ?? 0) > 0) got = true;
}
flush();
step(3);
ok(guestA.gold > goldB0 && A.hero.gold === goldA0, `guest earned ${guestA.gold - goldB0} gold, host none`);
ok(got && (B as any).hero.gold === guestA.gold, `client's HUD shows its haul and gold (${(B as any).hero.gold})`);
ok(!A.modes.mg && A.portal.active && !B.modes.mg, 'game over: portal open, client back to normal');

ok(errors.length === 0, 'no runtime errors');
process.exit(process.exitCode ?? 0);
