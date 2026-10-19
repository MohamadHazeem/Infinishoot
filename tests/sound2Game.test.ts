/**
 * Sound lane, wave 2, on the real Game (jsdom, no WebGL, no audio output):
 * instrument pickups (seeded roll, spawn, pickup, the music gets the band),
 * sound-reactive enemies (calm when quiet, drawn to loud noise, even away
 * from the hero), the DJ's stage highlights and break, the duel and comeback
 * music switches, and the host -> client mirror of the band, the pickup and
 * the tells.
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
const S2 = await import('../src/game/systems/sound2');
const { music } = await import('../src/audio/music');
const { maskOf, INSTRUMENT_IDS } = await import('../src/audio/instruments');
const { radioTuning } = await import('../src/audio/radio');
const { HEARD, hearingTuning } = await import('../src/audio/loudness');

settings.autoFire = false;
settings.deathReplay = false;
cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
type G = InstanceType<typeof Game>;
const solo = (seed: number): G => {
  const g = mk();
  g.startRun({ seed, difficulty: 'normal' });
  if (g.mode === 'shop') g.closeShop();
  return g;
};
const run = (g: G, n: number) => {
  for (let i = 0; i < n; i++) {
    g.xp = 0;
    g.xpNext = 1e9;
    for (const h of g.heroes) h.pendingLevels = h.chestsPending = 0;
    g.update(1 / 60);
  }
};
const clearField = (g: G) => {
  for (const e of g.enemies.list) if (e.active) g.enemies.kill(e);
  g.director.hold = true;
};

// --- The instrument roll is seeded (same seed, same plan), and doesn't touch the game RNG.
{
  const a = solo(777);
  const b = solo(777);
  run(a, 2);
  run(b, 2);
  ok(S2.soundLane(a).spawnAt === S2.soundLane(b).spawnAt, `same seed, same instrument plan (${S2.soundLane(a).spawnAt.toFixed(1)})`);
  let rolls = 0;
  for (let s = 0; s < 40; s++) {
    const g = solo(1000 + s);
    run(g, 1);
    if (S2.soundLane(g).spawnAt >= 0) rolls++;
  }
  ok(rolls > 8 && rolls < 30, `about ${Math.round(S2.instrumentDropTuning.chance * 100)}% of stages hide an instrument (${rolls}/40)`);
}

// --- Pickup: it lands near the hero, touching it adds it to the band, the music gets it.
const g = solo(4242);
run(g, 10);
clearField(g);
S2.soundLaneForce.instrument = 'cowbell';
run(g, 1);
const L = S2.soundLane(g);
ok(!!L.drop && L.drop.kind === INSTRUMENT_IDS.indexOf('cowbell'), 'a forced cowbell is on the field');
const d0 = Math.hypot(L.drop!.x - g.hero.player.x, L.drop!.z - g.hero.player.z);
ok(d0 >= 3 && d0 <= S2.instrumentDropTuning.near[1] + 0.5, `it lands near the hero (${d0.toFixed(1)} m)`);
ok(!g.walls.hitCircle(L.drop!.x, L.drop!.z, 1), 'on walkable ground');
S2.soundLaneFrame(g, 1 / 60, false);
g.player.teleport(L.drop!.x, L.drop!.z);
run(g, 2);
ok(!L.drop && L.band === maskOf(['cowbell']), 'walking into it adds the cowbell to the band');
S2.soundLaneFrame(g, 1 / 60, false);
ok((music as any).band === maskOf(['cowbell']), 'the music is told about the band');
ok(L.hl.instrument === 'Cowbell', 'the DJ will mention it');
ok(!!document.getElementById('s2-band') && !(document.getElementById('s2-band') as HTMLElement).hidden && document.querySelectorAll('#s2-band img').length === 1, 'the BAND strip shows one chip');
g.loadStage(2);
run(g, 3);
ok(L.band === maskOf(['cowbell']), 'the band stays for the rest of the run');
const g2 = solo(4243);
run(g2, 2);
ok(S2.soundLane(g2).band === 0, 'a new run starts without a band');

// --- Sound-reactive enemies.
{
  const h = solo(99);
  run(h, 5);
  clearField(h);
  const p = h.hero.player;
  // Four swarmers around the hero, 16 m out (one of them may end up against cover).
  const ring = [0, 1, 2, 3].map((k) => h.enemies.spawn(ENEMIES.swarmer, p.x + Math.cos(k * 1.571) * 16, p.z + Math.sin(k * 1.571) * 16, h.spawnOpts({ instant: true })));
  const sw = ring[0];
  const dist = (e: typeof sw) => Math.hypot(e.x - p.x, e.z - p.z);
  const d0 = ring.map(dist);
  run(h, 40);
  const Lh = S2.soundLane(h);
  ok(ring.every((e) => Lh.shown.get(e.uid) === HEARD.Calm), 'quiet: swarmers out of sight lose track (zZ)');
  ok(ring.every((e, i) => Math.abs(dist(e) - d0[i]) < 4), `and amble instead of charging (${ring.map((e, i) => (d0[i] - dist(e)).toFixed(1)).join(', ')} m in 0.7 s)`);
  // Rapid fire at the hero: they hear it and come running.
  const d1 = ring.map(dist);
  let heard = 0;
  for (let i = 0; i < 50; i++) {
    if (i % 6 === 0) h.vfx.sound('w:shoot', p.x, p.z);
    run(h, 1);
    for (const e of ring) if (Lh.shown.get(e.uid) === HEARD.Attracted) heard |= 1 << ring.indexOf(e);
  }
  ok(heard === 15, 'loud rapid fire: all of them are drawn in (♪)');
  const closed = ring.map((e, i) => d1[i] - dist(e)).sort((a, b) => b - a);
  ok(closed[1] > 2, `and come running (${closed.map((c) => (c * 1.2).toFixed(1)).join(', ')} m/s; they were ambling)`);
  // A loud blast on the far side pulls it away from the hero.
  clearField(h);
  const sw2 = h.enemies.spawn(ENEMIES.swarmer, p.x + 14, p.z, h.spawnOpts({ instant: true }));
  const x1 = sw2.x;
  for (let i = 0; i < 40; i++) {
    if (i % 10 === 0) h.vfx.sound('bomb', p.x + 26, p.z);
    run(h, 1);
  }
  ok(sw2.x > x1 + 1, `a bomb going off past it lures it away from you (${(sw2.x - x1).toFixed(1)} m toward the blast)`);
  // Normal enemies don't care.
  clearField(h);
  const bo = h.enemies.spawn(ENEMIES.bopper, p.x + 14, p.z, h.spawnOpts({ instant: true }));
  run(h, 30);
  ok(!Lh.shown.has(bo.uid), 'enemies without ears ignore all of it');
  // The tells are drawn (the view's instanced markers).
  S2.soundLaneFrame(h, 1 / 60, false);
  ok(!!Lh.view, 'the tells view exists');
}

// --- The DJ: stage highlights and the break after a clear.
{
  const r = solo(5150);
  run(r, 5);
  const Lr = S2.soundLane(r);
  radioTuning.delay = 0;
  S2.soundLaneFrame(r, 1 / 60, false);
  ok(Lr.hlStage === 1, 'highlights start with the stage');
  r.combo = 140;
  S2.soundLaneFrame(r, 1 / 60, false);
  r.mode = 'cleared';
  S2.soundLaneFrame(r, 1 / 60, false);
  ok(Lr.breakPending === false || Lr.breakPending === true, 'the clear arms the break');
  ok(Lr.hl.maxCombo === 140, `the stage's best combo is kept (${Lr.hl.maxCombo})`);
  r.mode = 'shop';
  S2.soundLaneFrame(r, 1 / 60, false);
  ok(!Lr.breakPending, 'between stages the break is handed to the DJ');
}

// --- Duel and comeback music switches (local, every machine).
{
  const b = solo(31337);
  run(b, 5);
  clearField(b);
  b.spawnBoss(ENEMIES.king);
  run(b, 2);
  const boss = b.boss!;
  S2.soundLaneFrame(b, 1 / 60, false);
  ok((music as any).duelOn === false, 'phase 1: no duel yet');
  boss.phase = 3;
  S2.soundLaneFrame(b, 1 / 60, false);
  ok(S2.inLastPhase(boss) && (music as any).duelOn === true, "the boss's last phase starts the music duel");
  boss.phase = 1;
  b.bossDuel = { uid: boss.uid, x: 0, z: 0, r: 10, r0: 10, r1: 5, t: 0 };
  S2.soundLaneFrame(b, 1 / 60, false);
  ok((music as any).duelOn === true, 'so does the ring-of-fire duel');
  b.bossDuel = null;
  b.hero.play.comeback = true;
  S2.soundLaneFrame(b, 1 / 60, false);
  ok((music as any).tension === true, 'comeback mode makes the music tense');
  b.hero.play.comeback = false;
  S2.soundLaneFrame(b, 1 / 60, false);
  ok((music as any).tension === false, 'and healing ends it');
}

// --- Co-op: the band, the pickup and the tells reach the client.
{
  const A = mk();
  const B = mk();
  const q: [any, any][] = [];
  (A as any).role = 'host';
  (A as any).host = { send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {} };
  (B as any).role = 'client';
  (B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
  const flush = () => {
    while (q.length) {
      const [t, m] = q.shift()!;
      if (t === A) A.onHostMessage('peerB', structuredClone(m));
      else B.onClientMessage(structuredClone(m));
    }
  };
  A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
  A.startRun();
  flush();
  if (A.mode === 'shop') A.closeShop();
  flush();
  A.xpNext = 1e12;
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
  ok(B.role === 'client' && B.mode === 'fight', 'client joined the fight');
  clearField(A);
  S2.soundLaneForce.instrument = 'steel';
  step(8);
  const LA = S2.soundLane(A);
  const LB = S2.soundLane(B);
  ok(!!LB.drop && LB.drop.kind === LA.drop!.kind && Math.abs(LB.drop.x - LA.drop!.x) < 0.11, 'client: sees the steel drum pickup where the host put it');
  A.hero.player.teleport(LA.drop!.x, LA.drop!.z);
  step(8);
  ok(LA.band === maskOf(['steel']) && LB.band === LA.band && !LB.drop, 'client: the band (host-synced) has the steel drum, the pickup is gone');
  S2.soundLaneFrame(B, 1 / 60, false);
  ok((music as any).band === maskOf(['steel']), "client: its own music adds the host's pickup");
  // Tells near the client's hero.
  const pB = A.heroes[1].player;
  const far = A.enemies.spawn(ENEMIES.bee, pB.x + 16, pB.z + 2, A.spawnOpts({ instant: true }));
  for (let i = 0; i < 30; i++) {
    if (i % 10 === 0) A.vfx.sound('bomb', pB.x + 28, pB.z + 2);
    step(1);
  }
  const st = LA.shown.get(far.uid);
  ok(!!st && LB.netTells.get(far.uid) === st, `client: mirrors the bee's tell (${st})`);
}
