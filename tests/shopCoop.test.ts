/**
 * Shop lane, co-op: a host Game and a client Game wired in-process (jsdom, no
 * WebGL). The client banishes a level-up card (BANISH armed, then a pick) and
 * locks a shop Mod; both travel as 'ui' messages, the host applies them and
 * the client's screens show the result (numbers, banishes left, the lock and
 * the order preview).
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
(globalThis as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { offerKey } = await import('../src/game/banish');
cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
// The client's menus get their own root, so the two Screens don't share element ids.
const hudB = document.createElement('div');
document.body.appendChild(hudB);
const A = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const B = new Game(new Input(canvas), 16 / 9, hudB, document.createElement('div'));
const sent: any[] = [];
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => (sent.push(m), q.push([A, m])), close() {} };
const flush = () => {
  while (q.length) {
    const [g, m] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', unlockedWeapons(), 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
const guest = A.heroes[1];
const scrB = (n: string) => hudB.querySelector<HTMLElement>(`#scr-${n}`)!;

// ---------------------------------------------------------------- banish from the client
guest.pendingLevels = 1;
A.hero.pendingLevels = 1;
A.openLevelUp();
flush();
ok(B.screens.current === 'levelup', 'client sees its level-up cards');
const banBtn = () => scrB('levelup').querySelector<HTMLElement>('[data-act=banish]');
ok(!!banBtn() && banBtn()!.textContent!.includes('2'), 'client shows BANISH with 2 charges: ' + banBtn()?.textContent);
ok(scrB('levelup').querySelectorAll('.cnums').length > 0, 'client cards carry their numbers');
const before = guest.offers.map(offerKey);
const target = guest.offers.findIndex((o) => ['weapon', 'passive', 'special', 'track', 'overdrive'].includes(o.kind));
banBtn()!.click();
ok(B.screens.banishArmed && scrB('levelup').classList.contains('banishing'), 'BANISH arms the screen');
(B as any).ui('pick', target);
ok(sent.at(-1)?.t === 'ui' && sent.at(-1)?.a === 'banish' && sent.at(-1)?.i === target, 'an armed pick is sent as a banish: ' + JSON.stringify(sent.at(-1)));
flush();
ok(guest.banished.has(before[target]) && guest.banishLeft === 1 && guest.needsPick, 'host banished the guest card; the level-up is still open');
ok(offerKey(guest.offers[target]) !== before[target], 'host redrew the banished card');
ok(!B.screens.banishArmed && banBtn()!.textContent!.includes('1'), 'client got the new cards and 1 banish left');
(B as any).ui('pick', 0);
flush();
ok(!guest.needsPick && guest.banished.size === 1, 'a normal pick after the banish still picks');
A.ui('pick', 0);
flush();

// ---------------------------------------------------------------- lock from the client
guest.gold = 50;
A.openShop();
flush();
ok(B.screens.current === 'shop', 'client is in the shop');
const lockBtn = () => scrB('shop').querySelector<HTMLElement>('[data-act=lock][data-index="2"]');
const offer = guest.shopOffers[2];
lockBtn()!.click();
flush();
ok(guest.shopLocked[2] === true, 'LOCK click reaches the host');
ok(!!scrB('shop').querySelector('.offer-slot.locked') && lockBtn()!.classList.contains('on'), 'client shows the lock');
(B as any).ui('sreroll');
flush();
ok(guest.shopOffers[2] === offer, 'the locked Mod stays through a client reroll');
ok(!!scrB('shop').querySelector('.mod-preview .pv'), 'client shows the order preview');
// Buy something, then the preview over a move arrow compares orders.
(B as any).ui('buy', 0);
(B as any).ui('buy', 1);
flush();
ok(guest.synergy.slots.length >= 1, `client bought ${guest.synergy.slots.length} Mod(s)`);
(B as any).ui('done');
A.ui('done');
flush();
ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 3).join('\n') : ''));
process.exit(process.exitCode ?? 0);
