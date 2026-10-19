import type GUI from 'lil-gui';
import { skyOverrides, skyTuning } from '../render/sky';
import { scarTuning } from '../render/groundScars';
import { trailTuning } from '../game/trails';
import { bulletFxTuning } from '../game/bullets';
import { skyFxTuning } from '../game/systems/sky';

/** Debug panel folder for the sky lane: time of day, clouds, reflections, shafts, ground scars, trails. */
export function addSkyFolder(gui: GUI): void {
  const f = gui.addFolder('Sky, scars & trails').close();
  const tod = { follow: true, k: 0.5 };
  const apply = () => (skyOverrides.tod = tod.follow ? null : tod.k);
  f.add(tod, 'follow').name('Time of day: follow stage').onChange(apply);
  f.add(tod, 'k', 0, 1, 0.01).name('Time of day (0 noon, 1 sunset)').onChange(apply);
  f.add(skyTuning, 'cloudStrength', 0, 1, 0.01).name('Cloud shadows');
  f.add(skyTuning, 'cloudCut', 0, 1, 0.01).name('Cloud cover cut');
  f.add(skyTuning, 'cloudSoft', 0.01, 0.6, 0.01).name('Cloud edge');
  f.add(skyTuning, 'cloudTile', 20, 200, 1).name('Cloud size (m)');
  f.add(skyTuning, 'windX', -6, 6, 0.1).name('Wind x (m/s)');
  f.add(skyTuning, 'windZ', -6, 6, 0.1).name('Wind z (m/s)');
  f.add(skyTuning, 'reflect', 0, 1, 0.01).name('Sea reflection');
  f.add(skyTuning, 'shafts', 0, 12, 1).name('Sun shafts');
  f.add(skyTuning, 'shaftAlpha', 0, 1, 0.01).name('Sun shaft strength');
  f.add(skyTuning, 'moonbeamAlpha', 0, 1, 0.01).name('Moonbeam strength');
  f.add(skyTuning, 'hazeDay', 0, 0.6, 0.01).name('Sky light (day)');
  f.add(skyTuning, 'hazeSunset', 0, 0.6, 0.01).name('Sky light (sunset)');
  f.add(skyTuning, 'hazeNight', 0, 0.6, 0.01).name('Sky light (night)');
  f.add(skyTuning, 'stars', 0, 2, 0.05).name('Stars');
  f.add(scarTuning, 'scorchAlpha', 0, 1, 0.01).name('Scar: scorch darkness');
  f.add(scarTuning, 'craterAlpha', 0, 1, 0.01).name('Scar: crater darkness');
  f.add(scarTuning, 'budget', 0.01, 0.5, 0.01).name('Scar budget (map share)');
  f.add(scarTuning, 'overBudget', 1, 20, 0.5).name('Scar over-budget fade x');
  f.add(scarTuning, 'scorchFade', 0, 0.05, 0.0005).name('Scorch fade /s');
  f.add(scarTuning, 'heatFade', 0, 1, 0.01).name('Heat fade /s');
  f.add(scarTuning, 'heatFadeMagma', 0, 1, 0.005).name('Lava crack fade /s');
  f.add(scarTuning, 'frostFade', 0, 0.2, 0.001).name('Frost fade /s');
  f.add(trailTuning, 'intensity', 0, 2, 0.05).name('Trail glow');
  f.add(trailTuning, 'branchChance', 0, 1, 0.05).name('Arc branches');
  f.add(trailTuning, 'arcRate', 5, 60, 1).name('Arc flicker /s');
  f.add(bulletFxTuning, 'fire', 0, 200, 1).name('Fire ribbons / frame');
  f.add(bulletFxTuning, 'ribbon', 0, 200, 1).name('Big shot ribbons / frame');
  f.add(bulletFxTuning, 'enemyPulse', 0, 0.4, 0.01).name('Enemy shot throb');
  f.add(skyFxTuning, 'heat', 0, 2, 0.05).name('Fire heat haze');
  f.add(skyFxTuning, 'crackle', 0, 30, 1).name('Shock crackles');
}
