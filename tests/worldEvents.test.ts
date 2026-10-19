/**
 * World-events lane, pure logic: the per-stage roll, plans, geometry and timelines are
 * deterministic and keep their promises (bridges stay open, sections avoid the plaza,
 * nothing that needs the dark happens at night twice, stealth layouts round-trip).
 */
import { ok } from './check';
import {
  WORLD_EVENT_KINDS,
  cellBox,
  collapseFallAt,
  collapsePlan,
  eclipseBurstAt,
  eclipseNight,
  eventLength,
  floodDepth,
  floodLevel,
  floodPlan,
  flowerPhase,
  giantPlan,
  giantStep,
  giantStepTime,
  kindsFor,
  lightAt,
  planWorldEvent,
  sightRange,
  splitBoxes,
  splitPlan,
  stealthLayout,
  stealthPlan,
  worldEventTuning as T,
  type WorldEventKind,
} from '../src/game/worldEvents';

// --- The roll: deterministic, biome rules, about the tuned rate.
let same = true;
const seen = new Map<string, Set<WorldEventKind>>();
let rolled = 0;
let stealthDay = 0;
let stealthNight = 0;
let nights = 0;
for (let s = 1; s <= 400; s++) {
  for (const b of ['meadow', 'magma', 'sky', 'neon']) {
    for (const night of [false, true]) {
      const a = planWorldEvent(s * 7919, 2 + (s % 6), b, night);
      const c = planWorldEvent(s * 7919, 2 + (s % 6), b, night);
      if (JSON.stringify(a) !== JSON.stringify(c)) same = false;
      if (night) nights++;
      if (!a) continue;
      if (a.kind === 'stealth') {
        if (night) stealthNight++;
        else stealthDay++;
        continue;
      }
      rolled++;
      if (!seen.has(b + night)) seen.set(b + night, new Set());
      seen.get(b + night)!.add(a.kind);
      if (a.at < T.from || a.at > T.to) same = false;
    }
  }
}
ok(same, 'the roll is deterministic and starts inside the tuned window');
ok(stealthDay === 0 && Math.abs(stealthNight / nights - T.stealthNight) < 0.06, `Night Raids only on night stages (${((stealthNight / nights) * 100).toFixed(0)}% of them)`);
const day = seen.get('meadowfalse')!;
ok(['collapse', 'flood', 'split', 'giant', 'eclipse', 'flower', 'volcano'].every((k) => day.has(k as WorldEventKind)), `every mid-stage event rolls on the meadow (${[...day].join(', ')})`);
ok(!seen.get('magmafalse')!.has('flood') && !seen.get('magmafalse')!.has('flower'), 'no floods or flowers on Magma Isle');
ok(['collapse', 'split', 'flood', 'volcano'].every((k) => !seen.get('skyfalse')!.has(k as WorldEventKind)), 'Sky Fortress: no collapse, split, flood or volcano');
ok(!!seen.get('meadowtrue')?.size && !seen.get('meadowtrue')!.has('eclipse'), 'no eclipse on a night stage');
ok(kindsFor('neon', false).includes('giant') && !kindsFor('neon', false).includes('flower'), 'biome filters (neon: giant yes, flower no)');
ok(planWorldEvent(1, 3, 'meadow', false, 'giant')?.kind !== 'giant', 'the last stage\'s kind is not repeated');
const r1 = [...Array(200).keys()].filter((s) => planWorldEvent(s * 31 + 5, 1, 'meadow', false)).length / 200;
const r2 = [...Array(200).keys()].filter((s) => planWorldEvent(s * 31 + 5, 3, 'meadow', false)).length / 200;
ok(Math.abs(r1 - T.chanceFirst) < 0.1 && Math.abs(r2 - T.chance) < 0.1, `rates: stage 1 ${(r1 * 100).toFixed(0)}%, later ${(r2 * 100).toFixed(0)}%`);
ok(rolled > 0 && WORLD_EVENT_KINDS.every((k) => eventLength(k) > 0), 'every kind has a length');

// --- Collapse: clusters around the team, never on the start plaza, avoid() respected, deterministic.
let collapseOk = true;
for (let s = 0; s < 100; s++) {
  const ax = (s % 9) * 6 - 24;
  const az = ((s * 7) % 9) * 5 - 20;
  const avoid = (x: number, z: number) => x > 10 && x < 20;
  const p = collapsePlan(s * 101, ax, az, 55, avoid);
  if (JSON.stringify(p) !== JSON.stringify(collapsePlan(s * 101, ax, az, 55, avoid))) collapseOk = false;
  if (p.length / 3 > T.waves * T.perWave || p.length < 3) collapseOk = false;
  for (let i = 0; i < p.length; i += 3) {
    const d = Math.hypot(p[i] - ax, p[i + 1] - az);
    if (d < T.collapseMin - 1e-6 || d > T.collapseMax + 1e-6 || Math.hypot(p[i], p[i + 1]) < 6 || avoid(p[i], p[i + 1]) || p[i + 2] >= T.waves) collapseOk = false;
  }
}
ok(collapseOk, 'collapse plans: deterministic, 6-24 m from the team, off the plaza, avoid() respected');
const cb = cellBox(12, -6);
ok(cb.gap === true && cb.maxX - cb.minX === T.cell && cb.maxX === 15, 'a section is a gap box (walking blocked, bullets fly over)');
ok(collapseFallAt(1) - collapseFallAt(0) === T.waveEvery && collapseFallAt(0) > T.crackTime, 'waves drop in order, after their cracks');

// --- Split: the chasm spans the island, bridges stay open.
let splitOk = true;
for (let s = 0; s < 200; s++) {
  const p = splitPlan(s * 13 + 1, (s % 11) * 8 - 40, ((s * 3) % 11) * 8 - 40, 55);
  const boxes = splitBoxes(p, 55);
  const [axis, pos] = p;
  const inside = (a: number) => boxes.some((b) => (axis === 0 ? a > b.minX && a < b.maxX && pos > b.minZ && pos < b.maxZ : a > b.minZ && a < b.maxZ && pos > b.minX && pos < b.maxX));
  for (const b of p.slice(2)) if (inside(b)) splitOk = false; // a bridge is never blocked
  if (!boxes.every((b) => b.gap)) splitOk = false;
  if (Math.abs(pos) < T.chasmWidth - 1e-6) splitOk = false; // the plaza stays whole
  let covered = 0;
  for (let a = -54; a <= 54; a += 0.5) if (inside(a)) covered++;
  if (covered < 160) splitOk = false; // most of the run is chasm
}
ok(splitOk, 'split: bridges always open, the chasm covers most of the run, the plaza stays whole');

// --- Flood timeline and depth.
const lv = [0, T.floodWarn, T.floodWarn + T.floodRise, T.floodWarn + T.floodRise + 5, eventLength('flood') + 1].map(floodLevel);
ok(lv[0] === 0 && lv[1] === 0 && lv[2] === 1 && lv[3] === 1 && lv[4] === 0, 'flood: warning, rise, hold, drain');
const fp = floodPlan(5, 10, 10, 55);
ok(fp.length === T.floodZones * 3 && floodDepth(fp, 1, fp[0], fp[1]) === 1 && floodDepth(fp, 1, 999, 999) === 0 && floodDepth(fp, 0, fp[0], fp[1]) === 0, 'flood: the first zone covers the team; depth 0 when dry');

// --- Colossus: alternating feet, steady stride, passes beside the team.
const gp = giantPlan(77, 4, -3);
const a0 = giantStep(gp, 0, { x: 0, z: 0 });
const s0 = { ...a0 };
const s2 = giantStep(gp, 2, { x: 0, z: 0 });
const s1 = giantStep(gp, 1, { x: 0, z: 0 });
let closest = Infinity;
for (let i = 0; i < T.giantSteps; i++) {
  const s = giantStep(gp, i, { x: 0, z: 0 });
  closest = Math.min(closest, Math.hypot(s.x - 4, s.z + 3));
}
ok(Math.abs(Math.hypot(s2.x - s0.x, s2.z - s0.z) - 2 * T.giantStride) < 1e-6, 'colossus: a steady stride');
const side = (s: { x: number; z: number }) => Math.sign((s.x - gp[0]) * gp[3] - (s.z - gp[1]) * gp[2]);
ok(side(s0) !== side(s1), 'colossus: feet alternate sides');
ok(closest > 1.5 && closest < T.giantOffsetMax + T.giantSide + 1, `colossus: passes beside the team (closest step ${closest.toFixed(1)} m)`);
ok(Math.abs(giantStepTime(1) - giantStepTime(0) - T.giantStepT) < 1e-9, 'colossus: one step per giantStepT');

// --- Eclipse and flower timelines.
ok(eclipseNight(0) === 0 && eclipseNight(T.eclipseFade + 1) === 1 && eclipseNight(eclipseBurstAt() + 0.01) === 0, 'eclipse: fades in, holds, bursts back');
const f0 = flowerPhase(1);
const f1 = flowerPhase(T.flowerGrow + 1);
const f2 = flowerPhase(T.flowerGrow + T.flowerBloom + 1);
ok(!f0.bloom && f0.grow > 0 && f0.grow < 1 && f1.bloom && f1.grow === 1 && !f2.bloom && f2.wilt > 0, 'flower: grows, blooms (heals), wilts');

// --- Stealth layout round-trip and light.
const sp = stealthPlan(12345, 55, (x, z) => Math.hypot(x - 20, z) < 3);
const L = stealthLayout(sp);
ok(L.caches.length === T.caches && L.lamps.length >= T.caches && L.search.length >= 1, `stealth layout: ${L.caches.length} caches, ${L.lamps.length} lamps, ${L.search.length} searchlights`);
ok(JSON.stringify(stealthPlan(12345, 55, (x, z) => Math.hypot(x - 20, z) < 3)) === JSON.stringify(sp), 'stealth layout is deterministic');
ok(L.caches.every((c) => Math.hypot(c.x - 20, c.z) >= 3), 'caches avoid blocked spots');
const lamp = L.lamps[0];
let darkSpot = { x: 0, z: 0 };
for (let k = 0; k < 400; k++) {
  const x = (k % 20) * 5 - 50;
  const z = Math.floor(k / 20) * 5 - 50;
  if (lightAt(L, 0, x, z) === T.baseLight) {
    darkSpot = { x, z };
    break;
  }
}
ok(lightAt(L, 0, lamp.x, lamp.z) > 0.8 && lightAt(L, 0, darkSpot.x, darkSpot.z) === T.baseLight, 'lit under a lamp, dark between them');
ok(sightRange(T.baseLight) === T.darkSight && sightRange(1) === T.litSight && sightRange(1, true) > T.litSight, 'enemies see farther when you are lit (elites farther still)');
