/**
 * Biomes lane: Neon City and Sky Fortress (src/data/biomes.ts, src/world/fieldArena.ts,
 * src/game/wind.ts). Pure checks first, then real arenas and a solo game in jsdom (no WebGL).
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
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { BIOMES, BIOME_BY_ID, biomeIdForStage, biomeForStage, biomeOverride, FIRST_LOOP, LATER_ROTATION } = await import('../src/data/biomes');
const { BIOME_GRADES } = await import('../src/render/biomeLook');
const { biomeAudio, groundAudio } = await import('../src/audio/mix');
const { biomeTrack, TRACKS } = await import('../src/audio/music/composition');
const { roomTuning } = await import('../src/audio/ambienceAudio');
const { createFieldArena, skyGaps, gapRects, GAP_VOID } = await import('../src/world/fieldArena');
const { gustAt, windAt, windTuning } = await import('../src/game/wind');
const { Rng } = await import('../src/core/rng');
const { StaticBoxGrid } = await import('../src/core/spatialHash');

// --- Rotation: loop 1 unchanged, both new areas in loop 2, bosses still by stage ---
ok([1, 2, 3, 4].map(biomeIdForStage).join() === 'meadow,dunes,peaks,magma', 'loop 1 keeps meadow, dunes, peaks, magma');
const loop2 = [5, 6, 7, 8].map(biomeIdForStage);
ok(loop2.includes('neon') && loop2.includes('sky') && loop2[3] === 'magma', `loop 2 brings Neon City and Sky Fortress, Omega back on magma (${loop2.join()})`);
const seen = new Set<string>();
for (let s = 5; s < 5 + 12; s++) seen.add(biomeIdForStage(s));
ok(seen.size === 6, 'every area shows up within three later loops');
ok(biomeIdForStage(5) === biomeIdForStage(5 + LATER_ROTATION.length) && biomeIdForStage(0) === 'meadow' && biomeIdForStage(NaN) === 'meadow', 'rotation repeats; bad stages fall back to the meadow');
ok([...FIRST_LOOP, ...LATER_ROTATION].every((id) => BIOME_BY_ID[id]), 'every rotation id has a def');
biomeOverride.id = 'sky';
ok(biomeForStage(1).id === 'sky', 'test-link override wins');
biomeOverride.id = null;
ok(biomeForStage(1).id === 'meadow', 'override off follows the stage');

// --- Every biome is complete: grade, track, room, footsteps ---
for (const b of BIOMES) ok(!!BIOME_GRADES[b.id] && !!roomTuning[b.id] && ['grass', 'sand', 'snow', 'metal'].includes(groundAudio(b.id)), `${b.id}: grade, reverb room and footsteps`);
ok(biomeAudio(5) === 'neon' && biomeAudio(7) === 'sky', 'ambience/footsteps use the actual biome id');
ok(biomeTrack(5) === 'neon' && biomeTrack(7) === 'sky' && TRACKS.some((t) => t.id === 'neon') && TRACKS.some((t) => t.id === 'sky'), 'music: Neon City and Sky Fortress tracks');

// --- Sky gaps: islands stay connected, the centre stays solid, rects cover exactly the void ---
const n = 55;
let connected = true;
let centre = true;
let exact = true;
for (let seed = 1; seed <= 60; seed++) {
  const m = skyGaps(new Rng(seed), n);
  const mid = Math.floor(n / 2);
  for (let z = mid - 4; z <= mid + 4; z++) for (let x = mid - 4; x <= mid + 4; x++) if (m[z * n + x] === GAP_VOID) centre = false;
  // Flood fill over walkable cells (ground and bridges) from the centre.
  const seenCells = new Uint8Array(n * n);
  const stack = [mid * n + mid];
  seenCells[mid * n + mid] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const x = c % n;
    const z = (c / n) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const k = nz * n + nx;
      if (seenCells[k] || m[k] === GAP_VOID) continue;
      seenCells[k] = 1;
      stack.push(k);
    }
  }
  for (let i = 0; i < n * n; i++) if (m[i] !== GAP_VOID && !seenCells[i]) connected = false;
  const cover = new Uint8Array(n * n);
  for (const [x0, z0, w, d] of gapRects(m, n)) for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) cover[z * n + x]++;
  for (let i = 0; i < n * n; i++) if (cover[i] !== (m[i] === GAP_VOID ? 1 : 0)) exact = false;
}
ok(connected, 'every walkable tile is reachable from the start (bridges join the islands)');
ok(centre, 'the start area is never a chasm');
ok(exact, 'gap rectangles cover each void tile exactly once');

// --- Wind: deterministic, bounded, gusts come and go ---
const w1 = windAt(42, 33.3, { x: 0, z: 0, s: 0, gust: 0, t: 0 });
const w2 = windAt(42, 33.3, { x: 0, z: 0, s: 0, gust: 0, t: 0 });
ok(w1.x === w2.x && w1.s === w2.s, 'wind is a pure function of seed and clock (co-op machines agree)');
let gusts = 0;
let maxS = 0;
let unit = true;
let prev = 0;
for (let t = 0; t < 240; t += 0.05) {
  const w = windAt(7, t, w1);
  const g = gustAt(7, t);
  if (g > 0.5 && prev <= 0.5) gusts++;
  prev = g;
  maxS = Math.max(maxS, w.s);
  if (Math.abs(Math.hypot(w.x, w.z) - 1) > 1e-6) unit = false;
}
ok(unit, 'wind direction is a unit vector');
ok(gusts >= 18 && gusts <= 23, `a gust about every ${windTuning.period} s (${gusts} in 4 minutes)`);
ok(maxS <= windTuning.base + windTuning.gust + 1e-9 && maxS > windTuning.base + windTuning.gust * 0.9, `strength peaks at base + gust (${maxS.toFixed(2)})`);

// --- Real arenas ---
for (const id of ['neon', 'sky']) {
  const biome = BIOME_BY_ID[id];
  let fine = true;
  let chestsOk = true;
  let lights = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const a = createFieldArena(seed * 1013, biome, { conveyors: 3 });
    const b = createFieldArena(seed * 1013, biome, { conveyors: 3 });
    if (JSON.stringify(a.colliders) !== JSON.stringify(b.colliders) || JSON.stringify(a.deco) !== JSON.stringify(b.deco)) fine = false;
    const grid = new StaticBoxGrid(a.colliders);
    if (grid.hitCircle(0, 0, 1.5)) fine = false;
    for (const c of [...a.chests, ...a.spots, ...a.turrets]) if (grid.hitCircle(c.x, c.z, 0.4)) chestsOk = false;
    lights += a.deco?.lights.length ?? 0;
    if (id === 'sky') {
      const gaps = a.colliders.filter((c) => c.gap);
      if (!gaps.length || gaps.length !== a.deco!.gaps.length) fine = false;
      // Bullets fly over chasms; walking is blocked.
      const g = gaps[0];
      const cx = (g.minX + g.maxX) / 2;
      const cz = (g.minZ + g.maxZ) / 2;
      if (!grid.hitCircle(cx, cz, 0.3) || grid.hitSolid(cx, cz, 0.05)) fine = false;
      if (a.deco!.flags.length < 6 || a.deco!.airships !== 3) fine = false;
    } else if (!a.deco!.holos.length || !a.deco!.vents.length) fine = false;
  }
  ok(fine, `${id}: seeded arenas are identical, the start is clear, the set dressing is there`);
  ok(chestsOk, `${id}: chest, objective and turret spots are walkable`);
  if (id === 'neon') ok(lights > 40, `neon: signs and lamps light the roof (${lights} over 6 arenas)`);
}
const meadow = createFieldArena(99, BIOME_BY_ID.meadow);
ok(!meadow.deco && !meadow.colliders.some((c) => c.gap), 'older biomes get no gaps or neon dressing');

// --- A solo game on the Sky Fortress: wind pushes bullets and light enemies, chasm falls are env kills ---
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
const { Team } = await import('../src/game/bullets');
const { sampleWind } = await import('../src/game/wind');
cheats.god = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const g = new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
g.startSolo();
if (g.mode === 'shop') g.closeShop();
g.loadStage(7);
ok(biomeForStage(g.arenaStage).id === 'sky' && !!g.arena.deco?.gaps.length, 'stage 7 is the Sky Fortress');
g.director.time = 20;
const wind = sampleWind(g, 0);
ok(wind.s > 0, `wind blows on the Sky Fortress (${wind.s.toFixed(2)} m/s²)`);
g.bullets.spawn({ x: 0, z: 0, dirX: 1, dirZ: 0, speed: 0, radius: 0.2, damage: 1, knockback: 0, life: 5, team: Team.Enemy, color: '#ff3df0', width: 1, length: 1 });
const bi = g.bullets.count - 1;
const swarm = ENEMIES.swarmer;
const e = g.enemies.spawn(swarm, 3, 3, { instant: true });
(e as any).state = 'move'; // skip the spawn telegraph
const ex = e?.x ?? 0;
const ez = e?.z ?? 0;
for (let i = 0; i < 30; i++) g.updateWind(1 / 60);
const bv = g.bullets.vx[bi] * wind.x + g.bullets.vz[bi] * wind.z;
ok(bv > 0, `enemy bullets drift downwind (${bv.toFixed(2)} m/s after 0.5 s)`);
ok(!!e && (e.x - ex) * wind.x + (e.z - ez) * wind.z > 0.01, 'light enemies are blown downwind');
// Knock an enemy hard toward a chasm: it falls.
const gap = g.arena.deco!.gaps.find((b) => b.maxX - b.minX >= 3.9 && b.maxZ - b.minZ >= 3.9)!;
const v = g.enemies.spawn(swarm, (gap.minX + gap.maxX) / 2, gap.maxZ + 0.6, { instant: true });
if (v) {
  (v as any).state = 'move';
  v.kx = 0;
  v.kz = -14;
  const kills = g.kills;
  g.updateWind(1 / 60);
  ok(!v.alive || v.hp <= 0 || g.kills > kills, 'an enemy knocked into a chasm falls (environmental kill)');
} else ok(false, 'spawned an enemy by the chasm');
g.loadStage(5);
ok(biomeForStage(g.arenaStage).id === 'neon' && sampleWind(g, 0).s === 0, 'stage 5 is Neon City, no wind there');
for (let i = 0; i < 120; i++) g.update(1 / 60);

// --- Co-op: a host and a client in-process; the client rebuilds the same chasms and feels the same wind ---
const { unlockedWeapons } = await import('../src/game/save');
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
    const [to, m] = q.shift()!;
    if (to === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
A.setHeroes([A.makeHero(0, 'Host', unlockedWeapons()), A.makeHero(1, 'Guest', [], 'peerB')]);
A.startRun();
flush();
if (A.mode === 'shop') A.closeShop();
flush();
A.loadStage(7);
flush();
for (let i = 0; i < 90; i++) {
  A.update(1 / 60);
  flush();
  B.update(1 / 60);
  flush();
}
const gapsA = JSON.stringify(A.arena.deco?.gaps);
ok(biomeForStage(B.arenaStage).id === 'sky' && gapsA === JSON.stringify(B.arena.deco?.gaps) && A.arena.colliders.filter((c) => c.gap).length === B.arena.colliders.filter((c) => c.gap).length, 'client builds the same Sky Fortress chasms');
const wa = { ...sampleWind(A, 0) };
const wb = { ...sampleWind(B, 0) };
ok(Math.abs(wa.t - wb.t) < 0.6 && Math.abs(wa.x * wb.x + wa.z * wb.z - 1) < 0.01, `client wind matches the host (clock ${wa.t.toFixed(2)} vs ${wb.t.toFixed(2)})`);
ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 3).join('\n') : ''));
process.exit(process.exitCode ?? 0);
