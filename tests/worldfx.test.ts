/** World effects: rain rolls, lightning, decorative ponds, debris physics, decal fades. */
import { ok } from './check';
import { rollRain, flashCurve, rainTuning } from '../src/game/ambience';
import { decorPatches, inPatch } from '../src/render/surfaces';
import { stepDebris, debrisTuning } from '../src/game/debris';
import { markAlpha } from '../src/game/decals';

// Rain: deterministic per seed, only on meadow and peaks, about as often as tuned.
let wet = 0;
const N = 2000;
for (let s = 1; s <= N; s++) if (rollRain('meadow', s * 7919)) wet++;
ok(Math.abs(wet / N - rainTuning.chance.meadow) < 0.05, `meadow rains on ~${rainTuning.chance.meadow * 100}% of stages (${((wet / N) * 100).toFixed(1)}%)`);
ok(rollRain('meadow', 12345) === rollRain('meadow', 12345), 'rain roll is deterministic (co-op machines agree)');
let other = 0;
for (let s = 1; s <= 500; s++) if (rollRain('magma', s) || rollRain('dunes', s)) other++;
ok(other === 0, 'never rains on dunes or magma');

// Lightning flash curve.
ok(flashCurve(-0.1) === 0 && flashCurve(0.5) === 0, 'no flash outside the strike');
ok(flashCurve(0) === 1 && flashCurve(0.09) < flashCurve(0.15), 'flash flickers (bright, dip, bright)');
let mono = true;
for (let t = 0; t < 0.45; t += 0.01) if (flashCurve(t + 0.01, true) > flashCurve(t, true) + 1e-9) mono = false;
ok(mono && flashCurve(0.2, true) <= 1, 'reduced flash fades smoothly without flicker');

// Decorative ponds.
const blocked = (x: number, z: number) => Math.abs(x - 20) < 3 && Math.abs(z - 20) < 3; // one wall block
const a = decorPatches('meadow', 42, 55, blocked);
const b = decorPatches('meadow', 42, 55, blocked);
ok(JSON.stringify(a) === JSON.stringify(b), 'ponds are deterministic from the seed');
ok(a.length > 0 && a.length <= 4, `meadow gets up to 4 ponds (${a.length})`);
ok(decorPatches('peaks', 42, 55, blocked).length === 0 && decorPatches('magma', 42, 55, blocked).length === 0, 'no extra ponds where the biome already has pools');
let goodPlace = true;
for (let s = 1; s < 60; s++) {
  const ps = decorPatches(s % 2 ? 'meadow' : 'dunes', s, 55, blocked, [{ x: -20, z: -20, r: 4 }]);
  for (const p of ps) {
    if (Math.hypot(p.x, p.z) < 12 || Math.abs(p.x) > 55 - 8 || Math.abs(p.z) > 55 - 8) goodPlace = false;
    if (Math.hypot(p.x + 20, p.z + 20) < p.r + 4) goodPlace = false;
    if (Math.abs(p.x - 20) < 3 + p.r && Math.abs(p.z - 20) < 3 + p.r && blocked(p.x, p.z)) goodPlace = false;
    for (const q of ps) if (q !== p && Math.hypot(p.x - q.x, p.z - q.z) < p.r + q.r) goodPlace = false;
    if (!p.decor || p.kind !== 'water') goodPlace = false;
  }
}
ok(goodPlace, 'ponds stay off the start area, walls, other pools and each other');
ok(!!inPatch(a, a[0].x, a[0].z, 'water') && !inPatch(a, a[0].x, a[0].z, 'lava') && !inPatch(a, 999, 999, 'water'), 'inPatch finds the pond under a point');

// Debris: dropped from 3 m it bounces, loses energy and comes to rest on the ground.
const d = { y: 3, vx: 4, vy: 0, vz: 0, h: 0.1, spin: 10 };
let bounces = 0;
let lastVy = 0;
let below = false;
let steps = 0;
for (; steps < 600; steps++) {
  const moving = stepDebris(d, 1 / 60);
  if (lastVy < 0 && d.vy > 0) bounces++;
  lastVy = d.vy;
  if (d.y < d.h - 1e-6) below = true;
  if (!moving) break;
}
ok(bounces >= 1 && bounces <= 6, `debris bounces a few times (${bounces})`);
ok(!below, 'debris never sinks through the ground while live');
ok(steps < 300, `debris settles within 5 s (${(steps / 60).toFixed(2)} s)`);
ok(debrisTuning.max >= 200, 'debris pool is big enough for a boss death');

// Decal fade.
ok(markAlpha(0, 6, 0.5) === 0 && markAlpha(6, 6, 0.5) === 0, 'marks are invisible before and after their life');
ok(Math.abs(markAlpha(2, 6, 0.5) - 0.5) < 1e-9, 'marks hold full strength mid-life');
let inRange = true;
for (let t = 0; t <= 6; t += 0.05) {
  const v = markAlpha(t, 6, 0.5);
  if (v < 0 || v > 0.5) inRange = false;
}
ok(inRange && markAlpha(5.5, 6, 0.5) < markAlpha(4.5, 6, 0.5), 'marks fade out at the end');
