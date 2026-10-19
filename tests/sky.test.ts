/** Sky lane: time of day, cloud noise, the ground scar map, bullet looks and arc paths. */
import * as THREE from 'three';
import { ok } from './check';
import { cloudNoise, sunsetWeights, timeOfDay, skySunDir, SKY_PALETTES } from '../src/render/sky';
import { ScarMap, crackPattern, scarTuning } from '../src/render/groundScars';
import { bulletLook, BulletLook } from '../src/game/bullets';
import { arcPath } from '../src/game/trails';
import { scarKind, SCAR_COLORS } from '../src/game/scars';

// --- Time of day.
const w0 = sunsetWeights(0);
const w1 = sunsetWeights(1);
ok(w0.gold === 0 && w0.dusk === 0, 'midday: no golden hour, no sunset');
ok(w1.gold === 1 && w1.dusk === 1, 'sunset: full golden hour and sunset');
let mono = true;
for (let k = 0; k < 1; k += 0.02) {
  const a = sunsetWeights(k);
  const b = sunsetWeights(k + 0.02);
  if (b.gold < a.gold - 1e-9 || b.dusk < a.dusk - 1e-9) mono = false;
}
ok(mono, 'golden hour and sunset only grow over the stage');
ok(sunsetWeights(0.5).gold > 0.8 && sunsetWeights(0.5).dusk < 0.05, 'mid-stage is golden hour, not yet sunset');

const out = { sun: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color(), fog: new THREE.Color() };
const day = { sun: [0.72, 0.66, 0.52] as [number, number, number], sky: [0.5, 0.56, 0.78] as [number, number, number], ground: [0.36, 0.3, 0.4] as [number, number, number] };
timeOfDay('meadow', day, '#9fd8ff', 0, out);
ok(Math.abs(out.sun.r - 0.72) < 1e-6 && Math.abs(out.sky.b - 0.78) < 1e-6 && out.fog.getHexString() === '9fd8ff', 'midday keeps the biome light exactly');
timeOfDay('meadow', day, '#9fd8ff', 1, out);
ok(out.sun.r > out.sun.b + 0.3, `sunset sun is warm (${out.sun.toArray().map((v) => v.toFixed(2))})`);
ok(out.fog.r > out.fog.b, 'sunset fog turns warm');
for (const id of ['meadow', 'dunes', 'peaks', 'magma']) ok(!!SKY_PALETTES[id], `sky palette for ${id}`);
ok(SKY_PALETTES.magma.reflect === 0, 'the lava sea reflects nothing');
const s0 = skySunDir(0, new THREE.Vector3());
const s1 = skySunDir(1, new THREE.Vector3());
ok(s0.y > s1.y && s1.y > 0.1 && s1.z < 0, 'the sky sun sinks toward the far horizon (up-screen)');

// --- Cloud noise: full range, tileable, deterministic.
const N = 64;
const c = cloudNoise(N, 7);
let lo = 255;
let hi = 0;
for (const v of c) {
  lo = Math.min(lo, v);
  hi = Math.max(hi, v);
}
ok(lo === 0 && hi === 255, 'cloud noise spans the full range');
let seam = 0;
let inner = 0;
for (let y = 0; y < N; y++) {
  seam += Math.abs(c[y * N + N - 1] - c[y * N]);
  inner += Math.abs(c[y * N + N / 2] - c[y * N + N / 2 - 1]);
}
ok(seam < inner * 2.5 + N * 4, `cloud noise wraps without a seam (seam ${seam}, inner ${inner})`);
ok(cloudNoise(N, 7).every((v, i) => v === c[i]), 'cloud noise is deterministic');

// --- Ground scar map.
const m = new ScarMap(256, 60);
m.stamp('crater', 0, 0, 3);
ok(m.sample(0, 0, 3) > 0.75 && m.sample(0, 0, 0) > 0.9, 'a crater leaves a deep bowl and scorch at its centre');
ok(m.sample(10, 10, 0) === 0, 'nothing far from the crater');
const before = m.sample(0, 0, 0);
for (let i = 0; i < 10; i++) m.stamp('scorch', 0, 0, 3);
ok(m.sample(0, 0, 0) === before, 'blasts on the same spot merge (max), they never stack darker');
m.stamp('frost', 20, 0, 2);
ok(m.sample(20, 0, 2) > 0.5 && m.sample(20, 0, 0) === 0, 'frost goes in its own channel');
const heatNormal = m.sample(0, 0, 1);
const mm = new ScarMap(256, 60);
mm.magma = true;
mm.stamp('crater', 0, 0, 3);
ok(mm.sample(0, 0, 1) > heatNormal, 'craters on Magma Isle crack open hotter');
let rows = 0;
m.flush(() => rows++);
ok(rows > 0, `stamps mark dirty rows for upload (${rows})`);
rows = 0;
m.flush(() => rows++);
ok(rows === 0, 'a flushed map is clean');
// Fade: heat cools quickly, scorch lingers.
const h0 = m.sample(0, 0, 1);
for (let t = 0; t < 10; t += 0.1) m.fade(0.1);
ok(m.sample(0, 0, 1) < h0 * 0.2 + 0.01, 'heat cools within seconds');
ok(m.sample(0, 0, 0) > 0.8, 'scorch is still there after 10 s');
for (let t = 0; t < 400; t += 0.5) m.fade(0.5);
ok(m.sample(0, 0, 0) === 0 && m.sample(20, 0, 2) === 0, 'everything fades out over a few minutes');
// Budget: heavy coverage fades faster.
const light = new ScarMap(128, 60);
const heavy = new ScarMap(128, 60);
light.stamp('scorch', 0, 0, 4);
for (let x = -50; x <= 50; x += 6) for (let z = -50; z <= 50; z += 6) heavy.stamp('scorch', x, z, 4);
let peak = 0;
for (let t = 0; t < 60; t += 0.5) {
  light.fade(0.5);
  heavy.fade(0.5);
  peak = Math.max(peak, heavy.coverage);
}
ok(peak > scarTuning.budget, `heavy scarring goes over budget (${(peak * 100).toFixed(0)}% of the map)`);
ok(heavy.sample(0, 0, 0) < light.sample(0, 0, 0) - 0.05, `over budget, scars fade faster (${heavy.sample(0, 0, 0).toFixed(2)} vs ${light.sample(0, 0, 0).toFixed(2)})`);
m.clear();
ok(m.sample(0, 0, 0) === 0 && m.coverage === 0, 'a new stage starts clean');
const cr = crackPattern(64, 5);
const frac = cr.reduce((a, v) => a + (v ? 1 : 0), 0) / cr.length;
ok(frac > 0.05 && frac < 0.4, `crack pattern is lines, not fill (${(frac * 100).toFixed(0)}%)`);
ok(scarKind(SCAR_COLORS.crater) === 'crater' && scarKind(SCAR_COLORS.frost) === 'frost' && scarKind(SCAR_COLORS.scorch) === 'scorch' && scarKind('#5d275d') === null, 'scar colours route to the map; others stay splats');

// --- Bullet looks (from what clients know too).
ok(bulletLook(1, 0xff3df0, 0.5, 0.5) === BulletLook.Enemy, 'enemy shots look like enemy shots');
ok(bulletLook(0, 0xff7a2f, 0.32, 0.8) === BulletLook.Fire, 'orange shots burn');
ok(bulletLook(0, 0x7df9ff, 0.24, 1.3) === BulletLook.Shock, 'Volt Buster bolts crackle');
ok(bulletLook(0, 0x7df9ff, 0.34, 0.9) === BulletLook.Tracer, 'turret rounds are tracers');
ok(bulletLook(0, 0xffd23f, 0.2, 2.8) === BulletLook.Ribbon && bulletLook(0, 0xffd23f, 0.55, 1.1) === BulletLook.Ribbon, 'lances and big shots leave ribbons');
ok(bulletLook(0, 0xfff36b, 0.32, 0.8) === BulletLook.Plain, 'the Buster is plain');
ok(bulletLook(0, 0xffcd75, 0.22, 0.5) === BulletLook.Tracer, 'pellets are tracers');

// --- Arc paths.
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pts = new Float32Array(48);
const n = arcPath(pts, 0, 1, 0, 6, 1, 0, 0.5, rand);
ok(n >= 4 && n <= 11, `arc has a handful of kinks (${n} points)`);
ok(pts[0] === 0 && pts[2] === 0 && Math.abs(pts[(n - 1) * 3] - 6) < 1e-6 && Math.abs(pts[(n - 1) * 3 + 2]) < 1e-6, 'arc starts and ends exactly on its targets');
let maxOff = 0;
for (let i = 0; i < n; i++) maxOff = Math.max(maxOff, Math.abs(pts[i * 3 + 2]));
ok(maxOff > 0.02 && maxOff <= 0.5 + 1e-6, `arc wanders sideways within its jitter (${maxOff.toFixed(2)} m)`);
