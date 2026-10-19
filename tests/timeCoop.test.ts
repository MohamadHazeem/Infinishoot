/**
 * Time lane online (host + client in one process, messages passed by hand
 * like tests/fixesCoop.test.ts): the TEAM REWIND vote, the team rewind
 * (the host holds and plays back, the client holds and lands where the host
 * put it), a vote that times out, a client's last stand judged on the host,
 * bullet time and clutch revives as presentation only (the shared
 * simulation never slows), and the team-wipe replay before game over.
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
const { settings } = await import('../src/game/settings');
const { timeTuning: T } = await import('../src/game/timeRules');
const TS = await import('../src/game/systems/time');

settings.deathReplay = true;
settings.slowMo = true;
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
    if (i % 6 === 0) {
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
const sA = TS.timeState(A);
const sB = TS.timeState(B);
const guestA = A.heroes[1];

// ---- A vote that nobody joins times out
step(60 * 2);
ok(sA.tl.span > 1, `host records history (${sA.tl.span.toFixed(1)} s)`);
B.input.pressed.add('KeyB');
step(1);
ok(!!sA.vote && sA.vote.yes.length === 1 && sA.vote.yes[0] === 1, "the guest's REWIND opens a team vote on the host");
step(2);
ok(!!sB.net.vote && sB.net.vote.yes === 1 && sB.net.vote.need === 2 && sB.net.vote.mine, 'the client sees the vote (1/2, its own yes)');
step(Math.ceil(T.voteTime * 60) + 10);
ok(!sA.vote && !sA.hold && sA.rewindsUsed === 0, 'nobody else agreed: no rewind, the charge is kept');

// ---- Team rewind: both agree (the guest walks east meanwhile)
for (let i = 0; i < 60 * 6; i++) {
  B.player.pos.x += 0.04;
  step(1);
}
const target = sA.tl.at(sA.tl.indexBack(T.rewindSeconds));
// Where the guest stood 5 s ago (host's copy follows the client's own movement).
B.input.pressed.add('KeyB');
step(1);
A.input.pressed.add('KeyB');
step(1);
ok(sA.hold?.kind === 'rewind', 'everyone agreed: the host rewinds the team');
const recPos = { x: sA.tl.at(sA.hold!.to).heroX(1), z: sA.tl.at(sA.hold!.to).heroZ(1) };
void target;
step(3);
ok(sB.net.hold === 1, 'the client holds during the playback');
const bz = B.player.z;
const bx = B.player.x;
step(30);
ok(B.player.x < bx - 1 && Math.abs(B.player.z - bz) < 1, `the client's own hero runs back west with the host's playback (${bx.toFixed(1)} -> ${B.player.x.toFixed(1)})`);
for (let i = 0; i < 200 && sA.hold; i++) step(1);
step(4);
ok(!sA.hold && sB.net.hold === 0 && sA.rewindsUsed === 1, 'the playback ends on both');
ok(Math.abs(B.player.x - recPos.x) < 0.05 && Math.abs(B.player.z - recPos.z) < 0.05, `the client lands where the team was (${B.player.x.toFixed(2)},${B.player.z.toFixed(2)} vs ${recPos.x.toFixed(2)},${recPos.z.toFixed(2)})`);
ok(Math.abs(guestA.player.x - recPos.x) < 0.3 && Math.abs(guestA.player.z - recPos.z) < 0.3, "and the host's copy of the guest agrees");
ok(sB.net.used, 'the client shows the team charge as spent');

// ---- A client's last stand, judged on the host
cheats.god = false;
A.combo = T.standCombo + 10;
step(1);
A.combo = T.standCombo + 10;
const gp = guestA.player;
gp.invuln = 0;
gp.hp = 1;
(sA as any).lastCombo = A.combo;
A.hurtHero(guestA, 999, gp.x + 1, gp.z, null, 'test');
ok(!gp.dead && sA.heroes[1].standT > 0, "a killing blow on the guest opens the guest's last stand");
ok(A.juice.hitStop === 0, 'online, the world never freezes for it');
step(3);
ok(!!sB.net.stand && sB.net.stand.need === T.standKills && !B.player.dead, 'the client shows its LAST STAND counter');
for (let i = 0; i < T.standKills; i++) {
  const e = A.enemies.spawn(ENEMIES.swarmer, gp.x + 3, gp.z, A.spawnOpts({ instant: true }));
  A.killEnemy(e, 'buster', guestA);
}
step(3);
ok(sA.heroes[1].standT === 0 && !gp.dead && !sB.net.stand, 'the guest earns its life back; the counter goes away');
cheats.god = true;

// ---- Bullet time online: presentation only
A.slowMoT = 0;
TS.debugBulletTime(A, guestA);
step(2);
ok(A.slowMoT === 0, 'online bullet time never slows the shared simulation');
ok(sB.view?.kind === 'bt', "the dodging guest's camera swings on its own screen");
ok(sA.view?.kind !== 'bt', "the host's camera doesn't");

// ---- Clutch revive online
B.player.hp = B.player.maxHp; // (client mirror)
const hostHero = A.hero;
gp.invuln = 0;
if (gp.hurt(gp.hp + 1, 1, 0)) A.onHeroDown(guestA);
step(2);
ok(gp.dead && A.mode === 'fight', 'the guest is down; the host still stands');
hostHero.player.teleport(gp.x + 1, gp.z);
hostHero.player.hp = hostHero.player.maxHp * 0.2;
let sawB = false;
for (let i = 0; i < 60 * 4 && !sawB; i++) {
  step(1);
  sawB = sB.view?.kind === 'revive';
}
ok(!gp.dead, 'the host revives the guest');
ok(sawB && sA.view?.kind === 'revive', 'a rescue on 20% life plays the clutch cutscene on both screens');
ok(A.slowMoT === 0, 'and never slows the simulation online');

// ---- Team wipe: the replay holds both, then game over
cheats.god = false;
A.combo = 0;
(sA as any).lastCombo = 0;
step(60);
for (const h of A.heroes) TS.heroTimeOf(A, h).standUsed = true; // stands spent: this is about the replay
for (const h of A.heroes) {
  h.player.invuln = 0;
  h.revivesLeft = 0;
  h.player.hp = 1;
  (sA as any).lastCombo = 0;
  A.combo = 0;
  A.hurtHero(h, 999, h.player.x + 1, h.player.z, null, 'test');
}
ok(A.mode === 'dead', 'everyone is down');
let replayB = false;
for (let i = 0; i < 60 * 8 && (B.screens as any).current !== 'gameover'; i++) {
  step(1);
  replayB ||= sB.net.hold === 2;
}
ok(replayB, 'the client holds for the team-wipe replay');
ok((A.screens as any).current === 'gameover' && (B.screens as any).current === 'gameover', 'then both reach game over');
cheats.god = false;
console.log('time coop: done');
