/**
 * World-events lane on the real Game (jsdom, no WebGL): sections fall and become gap colliders
 * (walls grid rebuilt) on solo, host and client alike; heroes are thrown clear, enemies fall;
 * the chasm and its bridges match on host and client and go away with the stage; clients wade;
 * the eclipse speeds enemies up and dazzles them; lava bombs reach the client; Night Raid
 * awareness (patrol, hold fire, alerts that spread, caches) runs on the host and mirrors.
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
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const { startWorldEvent, worldEventOf, worldRun } = await import('../src/game/systems/worldEvents');
const { stealthHidden } = await import('../src/game/systems/stealth');
const W = await import('../src/game/worldEvents');
const T = W.worldEventTuning;

settings.autoFire = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
type G = InstanceType<typeof Game>;
const solo = (seed: number): G => {
  const g = mk();
  g.startRun({ seed, difficulty: 'normal' });
  if (g.mode === 'shop') g.closeShop();
  return g;
};
const run = (g: G, n: number, draw = false) => {
  for (let i = 0; i < n; i++) {
    g.xp = 0;
    g.xpNext = 1e9;
    g.update(1 / 60);
    if (draw && i % 6 === 0) g.render(1, 1 / 10);
  }
};
const gaps = (g: G) => g.arena.colliders.filter((b) => b.gap).length;

// --- The roll is seeded: two runs with the same seed plan the same event for each stage.
const p1 = solo(4242);
const p2 = solo(4242);
run(p1, 2);
run(p2, 2);
ok(JSON.stringify(worldRun(p1).planned) === JSON.stringify(worldRun(p2).planned), `same seed, same stage-1 plan (${JSON.stringify(worldRun(p1).planned)})`);
for (const st of [2, 3, 5]) {
  p1.loadStage(st);
  p2.loadStage(st);
  run(p1, 2);
  run(p2, 2);
  ok(JSON.stringify(worldRun(p1).planned) === JSON.stringify(worldRun(p2).planned), `same seed, same stage-${st} plan (${worldRun(p1).planned?.kind ?? 'none'})`);
}

// --- Solo collapse: the section under an enemy and a hero drops.
const S = solo(99);
run(S, 5);
startWorldEvent(S, 'collapse');
const ev = worldEventOf(S)!;
ok(ev && ev.kind === 'collapse' && ev.p.length >= 3 && ev.boxes.length === ev.p.length / 3, `collapse planned ${ev.p.length / 3} sections`);
const [cx, cz] = [ev.p[0], ev.p[1]];
const foe = S.enemies.spawn(ENEMIES.chonk, cx + 1, cz - 1, { instant: true });
foe.speedMul = 0;
const hero = S.hero.player;
hero.teleport(cx, cz);
hero.hp = hero.maxHp;
cheats.god = false;
const walls0 = S.walls;
const gaps0 = gaps(S);
const envBefore = S.toys.envKills;
run(S, Math.ceil((W.collapseFallAt(0) + 0.6) * 60), true);
ok(gaps(S) === gaps0 + T.perWave && S.walls !== walls0, `three sections became gap colliders and the walls grid was rebuilt (${gaps(S) - gaps0})`);
ok(S.walls.hitCircle(cx, cz, 0.3) && !S.walls.hitSolid(cx, cz, 0.3), 'a hole blocks walking but not bullets');
ok(!foe.active || foe.hp <= 0, 'the enemy on it fell');
ok(S.toys.envKills > envBefore, 'falling in counts as an environmental kill');
const b0 = ev.boxes[0].box;
const still = hero.x > b0.minX && hero.x < b0.maxX && hero.z > b0.minZ && hero.z < b0.maxZ;
ok(!hero.dead && hero.hp < hero.maxHp && !still, `the hero was hit and thrown clear, never dropped (hp ${Math.round(hero.hp)}/${hero.maxHp})`);
cheats.god = true;
run(S, 60 * 18, true);
ok(ev.done && gaps(S) === gaps0 + ev.boxes.length, `all ${ev.boxes.length} sections down; the holes stay for the stage`);
S.loadStage(2);
run(S, 2);
ok(gaps(S) === 0, 'a new stage starts with whole ground');

// --- Eclipse: faster in the dark, dazzled at the burst, speeds restored.
const E = solo(7);
run(E, 5);
startWorldEvent(E, 'eclipse');
const ee = E.enemies.spawn(ENEMIES.swarmer, E.hero.player.x + 8, E.hero.player.z, { instant: true });
const base = ee.speedMul;
run(E, Math.ceil((T.eclipseFade + 0.5) * 60), true);
ok(Math.abs(ee.speedMul - base * (1 + T.eclipseSpeed)) < 1e-6, 'enemies move faster in the dark');
run(E, Math.ceil((W.eclipseBurstAt() - T.eclipseFade) * 60));
ok(Math.abs(ee.speedMul - base) < 1e-6 && ee.slowT > 0, 'the sun bursts back: speed restored, enemies dazzled');

// --- Flower: heals heroes standing in the bloom.
const F = solo(11);
run(F, 5);
startWorldEvent(F, 'flower');
const fe = worldEventOf(F)!;
F.hero.player.teleport(fe.p[0], fe.p[1]);
F.hero.player.hp = 20;
run(F, Math.ceil((T.flowerGrow + 2) * 60), true);
ok(F.hero.player.hp > 20 + F.hero.player.maxHp * T.flowerHeal * 1.5, `the bloom heals (${Math.round(F.hero.player.hp)} hp)`);

// --- Co-op: host A, client B.
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const flush = () => { while (q.length) { const [g, m] = q.shift()!; if (g === A) A.onHostMessage('peerB', structuredClone(m)); else B.onClientMessage(structuredClone(m)); } };
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
T.enabled = false; // only the events this test starts
A.startRun({ seed: 42 });
flush();
if (A.mode === 'shop') A.closeShop();
flush();
const step = (n: number) => { for (let i = 0; i < n; i++) { A.xp = 0; A.xpNext = 1e9; A.update(1 / 60); flush(); B.update(1 / 60); if (i % 6 === 0) B.render(1, 1 / 10); flush(); } };
step(20);

// Split: the same chasm and bridges on both machines, then gone with the stage.
startWorldEvent(A, 'split');
step(Math.ceil((T.splitWarn + 0.6) * 60));
const ea = worldEventOf(A)!;
const eb = worldEventOf(B);
ok(!!eb && eb.kind === 'split' && JSON.stringify(eb.p) === JSON.stringify(ea.p), 'client mirrors the split plan');
ok(gaps(A) === ea.boxes.length && gaps(B) === ea.boxes.length && gaps(A) >= 2, `host and client both added the chasm's ${gaps(A)} gap boxes`);
const [axis, pos, br] = ea.p;
const mid = splitMid(ea.p);
const at = (a: number) => (axis === 0 ? [a, pos] : [pos, a]) as [number, number];
ok(A.walls.hitCircle(...at(mid), 0.3) && B.walls.hitCircle(...at(mid), 0.3), 'the chasm blocks walking on both machines');
ok(!A.walls.hitCircle(...at(br), 0.3) && !B.walls.hitCircle(...at(br), 0.3), 'its bridge stays open on both machines');
A.loadStage(2);
flush();
step(20);
ok(!worldEventOf(A) && !worldEventOf(B) && gaps(A) === 0 && gaps(B) === 0, 'the next stage drops the chasm on host and client');

function splitMid(p: number[]): number {
  const bs = p.slice(2).sort((a, b) => a - b);
  return (bs[0] + bs[1]) / 2;
}

// Flood: the client slows its own hero in the water.
startWorldEvent(A, 'flood');
step(Math.ceil((T.floodWarn + T.floodRise + 0.5) * 60));
const fb = worldEventOf(B)!;
const bp = B.hero.player;
bp.teleport(fb.p[0], fb.p[1]);
bp.prev.x = bp.pos.x - 1;
const x0 = bp.prev.x;
B.worldEventLocal(1 / 60);
ok(fb.kind === 'flood' && Math.abs(bp.pos.x - x0 - T.floodHeroSlow) < 0.02, `the client wades at ${T.floodHeroSlow * 100}% speed (${(bp.pos.x - x0).toFixed(2)})`);
A.loadStage(3);
flush();
step(10);

// Volcano: lava bombs and puddles reach the client.
startWorldEvent(A, 'volcano');
let sawBombs = 0;
for (let i = 0; i < 12 && !sawBombs; i++) {
  step(60);
  sawBombs = worldEventOf(B)?.bombs.length ?? 0;
}
ok(sawBombs > 0, `the client draws the host's lava bombs (${sawBombs} in flight)`);
A.loadStage(4);
flush();
step(10);

// Night Raid: unaware enemies patrol and are skipped by auto weapons; hits alert and spread; caches pay.
startWorldEvent(A, 'stealth');
step(5);
const sa = worldEventOf(A)!;
const st = sa.stealth!;
const L = st.layout;
// A dark spot away from lamps and searchlights.
let dark = { x: 0, z: 0 };
for (let k = 0; k < 900; k++) {
  const x = (k % 30) * 3 - 45;
  const z = Math.floor(k / 30) * 3 - 45;
  if (W.lightAt(L, sa.t, x, z) === T.baseLight && W.lightAt(L, sa.t + 10, x, z) === T.baseLight && !A.walls.hitCircle(x, z, 2) && !A.walls.hitCircle(x + 8, z, 2) && L.caches.every((c) => Math.hypot(c.x - x, c.z - z) > 6)) {
    dark = { x, z };
    break;
  }
}
for (const e of A.enemies.list) if (e.active) A.enemies.kill(e);
A.hero.player.teleport(dark.x, dark.z);
A.heroes[1].player.teleport(dark.x - 30, dark.z - 30);
B.hero.player.teleport(dark.x - 30, dark.z - 30);
const u1 = A.enemies.spawn(ENEMIES.swarmer, dark.x + 8, dark.z, { instant: true });
const u2 = A.enemies.spawn(ENEMIES.swarmer, dark.x + 8, dark.z + 4, { instant: true });
step(20);
ok(stealthHidden(u1) && !!A.enemyCtx.lure?.(u1), 'an enemy 8 m away in the dark stays unaware and patrols');
ok(A.nearestEnemy(dark.x, dark.z, 20) === null, 'auto weapons hold fire at unaware enemies');
A.damage(u1, 1, { source: 'charge' }, A.hero);
step(4);
ok(!stealthHidden(u1) && !A.enemyCtx.lure?.(u1), 'hit: it hunts you');
ok(!stealthHidden(u2), 'the alert spread to the enemy next to it');
ok(st.alerts >= 2 && worldEventOf(B)!.stealth!.alerts >= 2, `hunters counted on host and client (${st.alerts}, ${worldEventOf(B)!.stealth!.alerts})`);
// The client sees the alerts of enemies near its hero.
B.hero.player.teleport(dark.x, dark.z);
A.heroes[1].remote = { x: dark.x, z: dark.z, vx: 0, vz: 0, ax: 1, az: 0, ad: -1, firing: false, charging: false, dashing: false };
step(10);
const mirrored = [...B.netEnemies.keys()].filter((uid) => worldEventOf(B)!.stealth!.netAw.get(uid) === 2).length;
ok(mirrored >= 2, `the client marks the hunting enemies (${mirrored})`);
// Grab a cache.
const gold0 = A.hero.gold;
const c0 = L.caches[0];
A.hero.player.teleport(c0.x, c0.z);
step(Math.ceil((T.cacheTime + 0.3) * 60));
ok((st.got & 1) === 1 && A.hero.gold > gold0 && (worldEventOf(B)!.stealth!.got & 1) === 1, `cache taken: +${A.hero.gold - gold0} gold, mirrored`);
// The boss ends the raid.
A.director.time = A.director.duration;
step(3);
ok(sa.done && !stealthHidden(u2), 'the boss ends the raid: everything hunts');

ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 3).join('\n') : ''));
process.exit(process.exitCode ?? 0);
