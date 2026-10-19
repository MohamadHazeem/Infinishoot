/**
 * Cinematics lane online (host + client in one process, messages passed by
 * hand like tests/timeCoop.test.ts): golden chests reach the client and pay
 * the guest who opens them (the reels play on the guest's screen only, the
 * host never holds), FLAWLESS! and the golden portal on both screens, the
 * sky fall on both clocks (the client waits in the clouds for its stage, both
 * land in it) with the golden bonus, the ending over the shop without
 * stalling the host or leaking key presses into the shop, and a client's own
 * legendary reveal playing locally.
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
const { Game, cheats, LOOP_STAGES } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { createWeapon } = await import('../src/game/weapons');
const { WEAPONS } = await import('../src/data/weapons');
const CS = await import('../src/game/systems/cinematics');
const { jackpotTuning, resetRevealed, skyTimes } = await import('../src/game/cinematics');

settings.bossIntros = false;
settings.deathReplay = false;
settings.cinematics = 'full';
resetRevealed();
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
    if (i % 3 === 0) {
      A.render(1, 1 / 60);
      B.render(1, 1 / 60);
    }
    if (A.mode === 'levelup') {
      (A as any).ui('pick', 0);
      (B as any).ui('pick', 0);
      flush();
    }
  }
};
cheats.god = true;
A.xpNext = 1e9;
A.enemies.clear();
step(30);
const sA = CS.cineState(A);
const sB = CS.cineState(B);
const guestA = A.heroes[1];

// ---- Golden chest: on the client's map, opened by the guest, reels on the guest's screen only
{
  jackpotTuning.goldShare = 1;
  B.player.pos.x = B.player.prev.x = 6;
  B.player.pos.z = B.player.prev.z = 0;
  step(20);
  CS.debugJackpotChest(A, 10, 0);
  step(6);
  ok(sB.chests.length === 1 && Math.abs(sB.chests[0].x - 10) < 0.01, 'the golden chest reaches the client (snapshot `cn`)');
  const gold = guestA.gold;
  const t0 = A.runTime;
  for (let i = 0; i < 60 && guestA.gold === gold; i++) {
    B.player.pos.x += 0.08;
    step(1);
  }
  ok(guestA.gold > gold, `the guest walks in and the host pays the guest (+${guestA.gold - gold})`);
  step(4);
  ok(!!sB.jack && !sA.jack, 'the reels spin on the guest’s screen, not the host’s');
  ok(guestA.player.invuln > 1, 'the guest is untouchable while the reels spin (online)');
  step(60);
  ok(A.runTime > t0 + 0.9 && A.mode === 'fight', 'the host never holds the world for it');
  ok(B.hero.gold === guestA.gold, 'the client shows the new gold');
  step(Math.ceil(jackpotTuning.full * 60));
  ok(!sB.jack, 'the reels close on their own');
  jackpotTuning.goldShare = 0.4;
}

// ---- A client's own legendary plays locally while the fight goes on
{
  const id = WEAPONS.starfall ? 'starfall' : Object.values(WEAPONS).find((w) => !w.slot && w.rarity === 'legendary')!.id;
  guestA.weapons.push(createWeapon(id, A.scene));
  guestA.loadoutDirty = true;
  CS.debugGainWindow(B); // as if the guest's level-up pick just closed
  const t0 = A.runTime;
  let seen = false;
  for (let i = 0; i < 40 && !seen; i++) {
    step(1);
    seen = !!sB.reveal;
  }
  ok(seen && sB.reveal?.item.key === `w:${id}` && sB.reveal.hold === false, 'the guest’s first legendary reveals on the guest’s screen (no hold)');
  ok(!sA.reveal, 'not on the host’s');
  step(30);
  ok(A.runTime > t0 + 0.4, 'the host keeps running');
  step(200);
}

// ---- Flawless, the golden portal, and the sky fall on both machines
{
  const stage = A.stage;
  CS.debugFlawless(A, true);
  step(6);
  ok(!!sA.flaw && !!sB.flaw, 'FLAWLESS! plays on both screens');
  ok(!!sA.portal?.active && !!sB.portal?.active && Math.abs(sA.portal!.x - sB.portal!.x) < 0.01, 'the golden portal is on both screens, in the same spot');
  const gold = B.hero.gold;
  A.hero.player.teleport(sA.portal!.x, sA.portal!.z);
  step(40);
  ok(A.mode === 'transition' && sA.goldenRide, 'the host steps in: the golden route');
  step(3);
  ok(B.mode === 'transition' && !!sB.sky && sB.sky.gold, 'the client falls too, through gold clouds');
  const T = skyTimes('full');
  step(Math.ceil(T.cut * 60) + 4);
  ok(A.stage === stage + 1 && B.stage === stage + 1, 'both build the next stage at the cut');
  ok(sB.sky?.loaded === true, 'the client knows its new stage is ready');
  step(Math.ceil((T.len - T.cut) * 60) + 10);
  ok(A.mode === 'fight' && B.mode === 'fight' && !sA.sky && !sB.sky, 'both land and fight');
  step(10);
  ok(B.hero.gold > gold, `the golden bonus reaches the guest (+${B.hero.gold - gold})`);
}

// ---- The ending: over the shop, local, no stall, presses swallowed
{
  A.loadStage(LOOP_STAGES);
  flush();
  step(10);
  A.stageClear();
  step(Math.ceil(1.8 * 60));
  ok(!!sA.end && !!sB.end, 'the ending plays on both screens after VICTORY');
  const t0 = A.modeT;
  step(60);
  ok(A.mode === 'shop' || A.modeT > t0, 'the host does not hold (the shop opens behind it)');
  ok(B.screens.current === 'shop' || A.mode === 'shop', 'the client’s shop is up behind the overlay');
  const goldB = B.hero.gold;
  B.input.pressed.add('Enter');
  step(1);
  ok(!sB.end && !!sA.end, 'the guest skipped it on their own screen');
  ok(B.hero.gold === goldB, 'the skip key did not buy anything in the shop');
}
