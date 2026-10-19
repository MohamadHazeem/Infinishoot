/** World lane: biome order, remixes, crusher timing (pure logic; the arena build is in worldGame.test.ts). */
import { ok } from './check';
import { BIOMES, BIOME_LOOP, BIOME_ORDER, allBiomeKeys, biomeByKey, biomeForStage, biomeKeyForStage, biomeKeysUpTo, biomeStagesUpTo as attractStages } from '../src/data/biomes';
import { crusherPhase, crusherSlammed, crusherTuning, biomeHazard, pressHeight } from '../src/game/hazards';
import { TRACK_BY_ID, trackUnlocked } from '../src/audio/music/composition';
import { BIOME_GRADES, isNightStage } from '../src/render/biomeLook';

// --- Biome order ---
const order = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => biomeKeyForStage(from + i)).join(',');
ok(order(1, 4) === 'meadow,dunes,peaks,magma', 'loop 1 is the classic tour, as before');
ok(order(5, 8) === 'factory,skyruins,peaks:aurora,magma:ashen', 'loop 2 brings the Toy Factory, Sky Ruins and two remixes');
ok(order(9, 12) === 'meadow:autumn,dunes:night,factory,skyruins', 'loop 3 remixes the other classics and revisits the new biomes');
ok(order(13, 16) === order(5, 8) && order(17, 20) === order(9, 12), 'later loops alternate rows 2 and 3');
ok(biomeKeyForStage(0) === 'meadow' && biomeKeyForStage(-3) === 'meadow' && biomeKeyForStage(2.7) === 'dunes', 'odd stage numbers are safe');
ok(BIOME_ORDER.every((row) => row.length === BIOME_LOOP), 'every row fills a loop');
ok(BIOME_ORDER.flat().every((k) => allBiomeKeys().includes(k)), 'every key in the order resolves');
const seen = new Set<string>();
for (let s = 1; s <= 12; s++) seen.add(biomeForStage(s).id);
ok(seen.size === 6, 'all six biomes show up by loop 3');

// --- Remixes ---
const autumn = biomeByKey('meadow:autumn');
ok(autumn.id === 'meadow' && autumn.variant === 'autumn' && autumn.name === 'Autumn Meadow', 'a remix keeps its biome id and gets its own name');
ok(autumn.hazard === 'thorns' && autumn.ground !== BIOMES[0].ground && autumn.weather === 'leaves', 'a remix changes the look but keeps the gameplay (hazard)');
ok(biomeByKey('meadow:autumn') === autumn, 'resolved biomes are cached');
ok(biomeByKey('meadow').variant === '' && biomeByKey('nope').id === 'meadow' && biomeByKey('meadow:nope').variant === '', 'unknown keys fall back safely');
for (const k of allBiomeKeys()) {
  const b = biomeByKey(k);
  ok(!!b.music && !!TRACK_BY_ID[b.music], `${k}: music track exists`);
  ok(['grass', 'sand', 'snow', 'metal'].includes(b.footstep) && ['meadow', 'dunes', 'peaks', 'magma'].includes(b.ambience), `${k}: footsteps and ambience reuse existing samples`);
  ok(!!(b.grade ?? BIOME_GRADES[b.id]), `${k}: has a colour grade`);
  // Enemy bullets are magenta (#ff3df0): keep floors, fog and the backdrop well away from it.
  for (const c of [b.fog, ...(b.tileColors ?? []), ...(b.edge.colors ?? [])]) {
    const n = parseInt(c.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const dist = Math.hypot(r - 0xff, g - 0x3d, bl - 0xf0);
    ok(dist > 90, `${k}: ${c} is far from the enemy-bullet magenta (${dist.toFixed(0)})`);
  }
}
ok(trackUnlocked('factory', 5, 0) && !trackUnlocked('factory', 4, 9) && trackUnlocked('skyruins', 6, 0), 'new biome tracks unlock in the jukebox when their stage is reached');

// --- Night ---
ok(!isNightStage(1) && isNightStage(3) && isNightStage(6) && !isNightStage(7), 'night every third stage still holds');
ok(isNightStage(10) && biomeForStage(10).variant === 'night', 'Night Dunes is always a night stage');

// --- Hazards ---
ok(biomeHazard('factory') === 'crusher' && biomeHazard('skyruins') === null && biomeHazard('peaks') === null, 'factory adds crushers, sky ruins uses wind lanes');
let slams = 0;
for (let t = 0; t < crusherTuning.period * 10; t += 1 / 60) if (crusherSlammed(t, t + 1 / 60, 0)) slams++;
ok(slams === 10, `one slam per cycle (${slams} in 10 periods)`);
ok(crusherPhase(1.234, 2) === crusherPhase(1.234, 2) && crusherPhase(0, 0) !== crusherPhase(0, 1), 'pads are deterministic and out of step');
ok(!crusherSlammed(5, 5, 0) && !crusherSlammed(6, 5, 0), 'no slam without time passing');
let low = Infinity;
let high = 0;
for (let p = 0; p < 1; p += 0.001) {
  const h = pressHeight(p);
  low = Math.min(low, h);
  high = Math.max(high, h);
}
ok(pressHeight(0.001) < 0.5 && pressHeight(0.5) > 4 && low > 0.2 && high < 5, 'the press slams at the start of a cycle and hovers mid-cycle');
ok(pressHeight(1 - 0.5 / crusherTuning.period) < pressHeight(0.5), 'the press winds down during the telegraph');

// --- Attract mode picks reached biomes ---
ok(attractStages(0).join() === '1' && attractStages(1).join() === '1', 'a fresh save demos the meadow');
ok(attractStages(4).length === 4 && attractStages(12).length === biomeKeysUpTo(12).length && attractStages(12).length === 10, 'reached biomes and remixes are all candidates');
ok(attractStages(12).every((s) => s >= 1 && s <= 12), 'each candidate is the first stage that shows it');
