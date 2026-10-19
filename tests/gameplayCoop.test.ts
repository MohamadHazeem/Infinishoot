/**
 * Gameplay lane, co-op: a host Game and a client Game wired together
 * in-process (jsdom, no WebGL). The client sees its own and the host's mech
 * suit, supply crates and mech drops, mutated enemies and comeback mode; its
 * cash-in key reaches the host; its super weapon fires on the host.
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
const SYS = await import('../src/game/systems/gameplay');
const GP = await import('../src/game/gameplay');

cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = {
  send: (_id: string, m: any) => q.push([B, m]),
  broadcast: (m: any) => q.push([B, m]),
  close() {},
};
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
A.xpNext = 1e12;
const guestA = A.heroes[1];
const step = (n: number) => {
  for (let i = 0; i < n; i++) {
    for (const h of A.heroes) h.pendingLevels = h.chestsPending = 0;
    A.update(1 / 60);
    flush();
    B.update(1 / 60);
    flush();
  }
};
step(40);
ok(B.role === 'client' && B.heroes.length === 2 && B.mode === 'fight', 'client joined the fight');

// Mech suit: the guest climbs in on the host; the client sees itself in it and can't dash.
SYS.startMech(A, guestA);
step(12);
ok(B.hero.play.mechT > 20 && B.hero.player.noDash, `client: its own mech suit (${B.hero.play.mechT.toFixed(1)} s) and no dashing`);
ok(B.hero.stats.moveSpeedMul < 0.8, `client: moves slower in the mech (x${B.hero.stats.moveSpeedMul.toFixed(2)})`);
SYS.startMech(A, A.hero);
step(8);
ok(B.heroes[0].play.mechT > 0, "client: sees the host's mech suit too");
guestA.play.mechT = 0.01;
A.hero.play.mechT = 0.01;
step(8);
ok(B.hero.play.mechT === 0 && !B.hero.player.noDash, 'client: out of the mech, dashing again');

// Supply crate and mech drop reach the client.
const W = SYS.gpWorld(A);
const WB = SYS.gpWorld(B);
SYS.spawnCrate(A, A.hero.player.x + 12, A.hero.player.z, 'railgun');
SYS.spawnMechDrop(A, A.hero.player.x - 12, A.hero.player.z);
step(8);
ok(WB.drops.length === 2 && WB.drops.some((d) => d.kind === 'railgun') && WB.drops.some((d) => d.kind === 'mech'), 'client: sees the falling crate and the mech drop');
const crate = W.drops.find((d) => d.kind === 'railgun')!;
guestA.remote = { ...(guestA.remote ?? { vx: 0, vz: 0, ax: 1, az: 0, ad: -1, firing: false, charging: false, dashing: false }), x: crate.x, z: crate.z } as any;
B.hero.player.pos.x = crate.x;
B.hero.player.pos.z = crate.z;
step(Math.ceil(GP.crateTuning.fall * 60));
ok(B.hero.play.superId === 'railgun' && WB.drops.length === 1, 'client: grabbed the crate, holds the Railgun');
for (const e of A.enemies.list) if (e.active) A.enemies.kill(e);
for (let i = 0; i < 16; i++) A.enemies.spawn(ENEMIES.chonk, crate.x + Math.cos(i / 2.546) * 4, crate.z + Math.sin(i / 2.546) * 4, A.spawnOpts({ instant: true })); // all round: the client's aim follows its (still) mouse
(B.input as any).device = 'kbm';
const { settings } = await import('../src/game/settings');
settings.autoFire = true;
step(80);
ok((guestA.damageBy.railgun ?? 0) > 0 && B.hero.play.superAmmo < GP.SUPERS.railgun.ammo, `client's railgun fires on the host (${Math.round(guestA.damageBy.railgun ?? 0)} damage)`);
settings.autoFire = false;

// Mutated enemies look mutated on the client.
for (const e of A.enemies.list) if (e.active) A.enemies.kill(e);
const m = A.enemies.spawn(ENEMIES.bopper, B.hero.player.x + 5, B.hero.player.z, A.spawnOpts({ instant: true }));
step(4);
SYS.mutate(A, W, m);
step(8);
const mirror = [...B.netEnemies.values()].find((e) => e.active && e.def.id === 'bopper');
ok(!!mirror && mirror.mutated && mirror.scale > 1.1, 'client: the mutant mirror is mutated and bigger');

// Cash-in from the client.
A.combo = 120;
A.comboT = 30;
step(4);
B.hero.play.cashSel = 0;
(B.input as any).pressed.add('KeyX');
step(4);
ok(A.combo < 10 && WB.cashUses === 1, `client's cash-in key spends the team combo on the host (combo ${A.combo}, uses ${WB.cashUses})`);

// Comeback mode for the guest.
guestA.revivesLeft = 0;
guestA.player.hp = 1;
step(8);
ok(guestA.comeback && B.hero.comeback, 'client: comeback mode on (hero.comeback mirrored)');
guestA.player.heal(guestA.player.maxHp);
step(8);
ok(!B.hero.comeback, 'client: comeback mode off after healing');
const gpw = JSON.stringify(A.gameplayNet(guestA)).length + JSON.stringify(A.gpHeroNet(guestA)).length * 2;
ok(gpw < 200, `this lane adds ~${gpw} B (JSON) per snapshot here`);
process.exit(process.exitCode ?? 0);
