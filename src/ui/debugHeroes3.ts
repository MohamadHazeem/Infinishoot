import type GUI from 'lil-gui';
import { heroes3Tuning } from '../game/heroes3';

/** Debug panel folder for the heroes3 lane: the Ronin and the Tinker (src/game/heroes3.ts). */
export function addHeroes3Folder(gui: GUI): void {
  const f = gui.addFolder('Ronin & Tinker').close();
  const r = heroes3Tuning.ronin;
  f.add(r, 'comboReset', 0.2, 2, 0.05).name('Ronin combo reset (s)');
  f.add(r, 'cleaveRecover', 1, 3, 0.05).name('Ronin cleave recovery x');
  f.add(r, 'cleaveStop', 0, 0.2, 0.005).name('Ronin cleave hit-stop');
  f.add(r, 'waveSpeed', 5, 40, 1).name('Ronin wave speed');
  f.add(r, 'counterDmg', 0, 10, 0.1).name('Ronin counter x dmg');
  f.add(r, 'dashSpeed', 10, 60, 1).name('Ronin dash speed');
  f.add(r, 'cutDelay', 0, 1, 0.02).name('Ronin cut delay (s)');
  const t = heroes3Tuning.tinker;
  f.add(t, 'buildEvery', 1, 15, 0.5).name('Tinker build every (s)');
  f.add(t, 'capMax', 1, 12, 1).name('Tinker max bots');
  f.add(t, 'teamBudget', 4, 64, 1).name('Team bot budget');
  f.add(t, 'zapDmg', 0, 40, 1).name('Bot zap damage');
  f.add(t, 'zapPerLevel', 0, 3, 0.05).name('Bot zap +/level');
  f.add(t, 'zapEvery', 0.2, 3, 0.05).name('Bot zap every (s)');
  f.add(t, 'speed', 2, 16, 0.5).name('Bot speed');
  const c = heroes3Tuning.cuts;
  f.add(c, 'dmg', 0, 10, 0.1).name('Thousand Cuts dmg');
  f.add(c, 'every', 0.02, 0.3, 0.01).name('Thousand Cuts every (s)');
  const l = heroes3Tuning.legion;
  f.add(l, 'count', 1, 12, 1).name('Scrap Legion mechs');
  f.add(l, 'dmg', 0, 10, 0.1).name('Scrap Legion dmg');
  f.add(l, 'life', 2, 20, 0.5).name('Scrap Legion life (s)');
}
