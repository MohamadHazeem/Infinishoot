/** Arena lane: hazards, objectives and toy helpers (src/game/hazards.ts, objectives.ts, interactives.ts). */
import { ok } from './check';
import { biomeHazard, envKillScore, hazardAt, hazardTuning, heroGroundMul, knockedIn, type HazardZone } from '../src/game/hazards';
import { Objective, OBJECTIVE_KINDS, objectiveGold, objectiveMax, objectiveTuning, pickObjective, totemHp } from '../src/game/objectives';

// --- hazards ---
const zones: HazardZone[] = [
  { x: 0, z: 0, r: 2, kind: 'lava' },
  { x: 10, z: 0, r: 3, kind: 'quicksand' },
  { x: -10, z: 0, r: 2, kind: 'thorns' },
];
ok(hazardAt(zones, 0.5, 0.5) === 0 && hazardAt(zones, 3, 0) === -1, 'hazardAt finds the pool under a point');
ok(hazardAt(zones, 10, 1, 'lava') === -1 && hazardAt(zones, 10, 1, 'quicksand') === 1, 'hazardAt filters by kind');
ok(!knockedIn(1, 1) && knockedIn(hazardTuning.knockSpeed + 1, 0), 'walking in is not being knocked in');
ok(heroGroundMul(zones, 10, 0) === hazardTuning.sandHero && heroGroundMul(zones, -10, 0) === hazardTuning.thornHero && heroGroundMul(zones, 0, 0) === 1, 'quicksand and thorns slow heroes, lava does not');
ok(envKillScore(3, 2) === (hazardTuning.envScore + 3 * hazardTuning.envScorePerStage) * 2, 'env kill score scales with stage and multiplier');
ok(biomeHazard('dunes') === 'quicksand' && biomeHazard('meadow') === 'thorns' && biomeHazard('magma') === null, 'biome extra hazards');

// --- objective picking is seeded ---
let same = true;
const seen = new Set<string>();
for (let seed = 1; seed < 200; seed++) {
  for (let stage = 1; stage <= 4; stage++) {
    const k = pickObjective(seed, stage);
    if (k !== pickObjective(seed, stage)) same = false;
    seen.add(k);
  }
}
ok(same, 'same seed and stage give the same objective');
ok(OBJECTIVE_KINDS.every((k) => seen.has(k)), 'every objective kind shows up');
const perStage = new Set([1, 2, 3, 4].map((s) => pickObjective(12345, s)));
ok(perStage.size > 1, 'stages of one run vary their objective');

// --- objective progress ---
const t = new Objective('totems', 2);
ok(t.max === objectiveTuning.totems && t.active, 'totems need 3');
ok(!t.progress() && !t.progress() && t.progress() && t.state === 'done', 'third totem completes it');
ok(!t.progress() && t.cur === t.max, 'no progress after completion');
ok(objectiveMax('envkills', 1) === objectiveTuning.envKills && objectiveMax('envkills', 99) === 30, 'env kill target grows and caps');
ok(totemHp(3) > totemHp(1) && objectiveGold(2) > objectiveGold(1), 'totem life and gold reward scale with stage');

// Beacon: charges while a hero stands in it; enemies drain it.
const b = new Objective('beacon', 1);
let r: string | null = null;
for (let i = 0; i < 60 * 31 && !r; i++) r = b.beaconStep(1 / 60, 1, 0);
ok(r === 'done' && b.state === 'done', 'beacon completes after 30 s of charging');
const b2 = new Objective('beacon', 1);
for (let i = 0; i < 60 * 10; i++) b2.beaconStep(1 / 60, 0, 0);
ok(b2.cur === 0 && b2.active, 'beacon does not charge with nobody in it');
let r2: string | null = null;
for (let i = 0; i < 60 * 60 && !r2; i++) r2 = b2.beaconStep(1 / 60, 1, 6);
ok(r2 === 'failed' && b2.state === 'failed', 'a swarmed beacon is lost');

// Net round trip.
const n = new Objective('beacon', 1);
n.beaconStep(5, 1, 1);
const m = new Objective('beacon', 1);
m.setNet(n.net());
ok(m.cur === n.cur && m.state === n.state && Math.abs(m.hp - n.hp) < 1 && m.charging === n.charging, 'objective survives the snapshot');
