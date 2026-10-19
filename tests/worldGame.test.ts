/**
 * World lane, in the real game (jsdom, no WebGL): new-biome arenas are
 * deterministic and match on a co-op client, crushers and wind lanes work,
 * boss dressing comes and goes, and the title attract demo plays without
 * touching the profile or leaving the title screen.
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
const { createFieldArena } = await import('../src/world/fieldArena');
const { allBiomeKeys, biomeByKey, biomeForce } = await import('../src/data/biomes');
const { crusherTuning } = await import('../src/game/hazards');
const { save, unlockedWeapons } = await import('../src/game/save');
const { attractRunning, attractStepMs, attractTuning } = await import('../src/game/systems/attract');
const { dressingOf } = await import('../src/world/worldRender');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);

// --- Arenas: same seed, same layout, for every biome and remix ---
const sig = (a: ReturnType<typeof createFieldArena>) => JSON.stringify([a.colliders, a.hazards, a.conveyors, a.barrels, a.props.map((p) => [p.kind, p.x, p.z]), a.pads, a.turrets, a.spots]);
for (const k of allBiomeKeys()) {
  const t0 = performance.now();
  const a = createFieldArena(777, biomeByKey(k), { conveyors: 3 });
  const ms = performance.now() - t0;
  const b = createFieldArena(777, biomeByKey(k), { conveyors: 3 });
  ok(sig(a) === sig(b), `${k}: same seed builds the same arena (${ms.toFixed(0)} ms)`);
  ok(a.colliders.length > 20 && a.spots.length >= 4 && a.chests.length >= 3, `${k}: arena has cover, objective spots and chests`);
}
const fac = createFieldArena(4242, biomeByKey('factory'), { conveyors: 3 });
ok(fac.hazards.filter((h) => h.kind === 'crusher').length >= 3 && fac.conveyors.length >= 4 && fac.anim.length === 1, `factory: crushers (${fac.hazards.filter((h) => h.kind === 'crusher').length}), extra belts (${fac.conveyors.length}) and gears`);
// A remix keeps its biome's gameplay: same hazard kinds as the base at the same seed.
const kinds = (k: string) => [...new Set(createFieldArena(99, biomeByKey(k), {}).hazards.map((h) => h.kind))].sort().join();
ok(kinds('meadow:autumn') === kinds('meadow') && kinds('dunes:night') === kinds('dunes') && kinds('magma:ashen') === kinds('magma'), 'remixes keep the hazards');

// --- Co-op: a client builds the same factory from the stage number ---
cheats.god = true;
const A = mk();
const B = mk();
const q: [any, any][] = [];
(A as any).role = 'host';
(A as any).host = { send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {} };
(B as any).role = 'client';
(B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
const flush = () => { while (q.length) { const [g, m] = q.shift()!; if (g === A) A.onHostMessage('peerB', structuredClone(m)); else B.onClientMessage(structuredClone(m)); } };
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
A.loadStage(6);
flush();
// Keep the team under its next level: a level-up waits for the fake guest's pick and would freeze the run.
const step = (n: number) => { for (let i = 0; i < n; i++) { A.xp = 0; A.xpNext = 1e9; A.update(1 / 60); flush(); B.update(1 / 60); B.render(1, 1 / 60); flush(); } };
step(10);
ok(A.arenaStage === 6 && B.arenaStage === 6 && sig(A.arena) === sig(B.arena), 'host and client build the same Toy Factory arena on stage 6');
// Crusher: an enemy parked on a pad is flattened at the slam; it counts as an environmental kill.
const pad = A.arena.hazards.find((h) => h.kind === 'crusher')!;
const def = (await import('../src/data/enemies')).ENEMIES.chonk;
const e = A.enemies.spawn(def, pad.x, pad.z, { instant: true });
e.speedMul = 0;
const envBefore = A.toys.envKills;
let killed = false;
for (let i = 0; i < 60 * (crusherTuning.period + 0.5) && !killed; i++) {
  e.x = pad.x;
  e.z = pad.z;
  step(1);
  killed = !e.alive || e.hp <= 0;
}
ok(killed && A.toys.envKills > envBefore, 'a crusher flattens an enemy on its pad (environmental kill)');
// The client sees the press move (its stage clock follows the synced timer).
ok(Math.abs((B as any).director.duration - B.netTimeLeft - A.director.time) < 0.5, 'client stage clock follows the host timer');
// Boss dressing appears with the boss on both machines and goes after it dies.
A.loadStage(6);
flush();
step(5);
A.debugBoss({ now: true, mini: false, phase: 0 });
step(90);
A.render(1, 1 / 60);
const before = [dressingOf(A), dressingOf(B)];
ok(A.boss != null, 'boss spawned');
if (A.boss) A.killEnemy(A.boss, 'buster', A.hero);
// The comic finisher (2.1 s), then the dressing lingers (1.5 s) and sinks (1.6 s).
for (let i = 0; i < 420; i++) {
  step(1);
  A.render(1, 1 / 60);
}
const after = [dressingOf(A), dressingOf(B)];
console.log('dressing', before, after);
ok(!!before[0] && before[0] === before[1] && !after[0] && !after[1], 'boss dressing is built on host and client and cleaned up after the fight');
cheats.god = false;
A.leaveToTitle();
B.leaveToTitle();

// --- Title attract mode ---
save.lifetime.bestStage = 12;
const G = mk();
const saveBefore = JSON.stringify(save);
const storeBefore = JSON.stringify(Object.entries(localStorage));
let sawEnemies = 0;
let biomes = new Set<number>();
const frames = (n: number) => {
  for (let i = 0; i < n; i++) {
    G.update(1 / 60);
    if (i % 4 === 0) G.render(1, 1 / 15);
    sawEnemies = Math.max(sawEnemies, G.enemies.activeCount);
    biomes.add(G.arenaStage);
  }
};
frames(60 * (attractTuning.delay + 25));
ok(attractRunning(G) && G.mode === 'title' && G.screens.current === 'title', 'the demo plays behind the title screen');
ok(sawEnemies > 10 && G.kills > 0, `the demo hero fights (${sawEnemies} enemies, ${G.kills} kills)`);
const ms = attractStepMs(G);
console.log('attract step', ms.toFixed(3), 'ms');
ok(ms < 4, `demo steps are cheap (${ms.toFixed(2)} ms)`);
// Restart every `length` seconds, in a new place.
attractTuning.length = 5;
frames(60 * 25);
attractTuning.length = 60;
ok(biomes.size >= 2, `the demo restarts in other biomes (${[...biomes].join(',')})`);
ok(JSON.stringify(save) === saveBefore && JSON.stringify(Object.entries(localStorage)) === storeBefore, 'the demo saves nothing (achievements, enemies met, stats, scores)');
// Opening a menu stops it at once; coming back resumes it.
G.screens.show('extras');
const t0 = G.director.time;
frames(30);
ok(G.director.time === t0 && G.mode === 'title', 'a menu over the title freezes the demo');
G.screens.show('title');
frames(30);
ok(G.director.time > t0, 'back on the title, the demo carries on');
// Starting a run wipes the demo's state.
biomeForce.key = null;
G.startSolo();
if (G.mode === 'shop') G.closeShop();
ok(G.mode === 'fight' && G.kills === 0 && G.level === 1 && G.xpNext < 1e6 && G.stage === 1 && G.arenaStage === 1 && G.director.time < 1, 'a real run starts fresh after the demo');
ok(G.hero.weapons.length <= 3 && G.chestT >= 0, 'the demo kit and chest block are gone');
for (let i = 0; i < 600; i++) G.update(1 / 60);
ok(G.mode === 'fight' || G.mode === 'levelup', 'the run plays on');
// Loop 2 and 3 with the autoplay bot: every new biome and remix plays (crushers, wind, night, new weather).
const { installBot } = await import('../src/dev/bot');
installBot(G, G.input);
const botRun = (globalThis as any).window.botRun as (s: number, god?: boolean) => Record<string, unknown>;
const played: string[] = [];
for (let st = 5; st <= 12; st++) {
  G.loadStage(st);
  const r = botRun(12, true);
  played.push(`${st}:${(await import('../src/data/biomes')).biomeForStage(st).name}:${r.kills}`);
}
console.log('loop 2-3', played.join(' | '));
ok(played.length === 8 && G.stage === 12, 'the bot plays every loop-2 and loop-3 stage');
ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 5).join('\n') : ''));
process.exit(process.exitCode ?? 0);
