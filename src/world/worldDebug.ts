import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { allBiomeKeys, biomeForce } from '../data/biomes';
import { crusherTuning } from '../game/hazards';
import { attractTuning } from '../game/systems/attract';
import { bossDressingTuning } from './bossDressing';

/** Debug panel folder for the world lane: biomes, crushers, wind lanes, boss dressing, title demo. */
export function worldDebugFolder(gui: GUI, game: Game): void {
  const f = gui.addFolder('World: biomes & title demo').close();
  const pin = { biome: biomeForce.key ?? 'by stage' };
  f.add(pin, 'biome', ['by stage', ...allBiomeKeys()])
    .name('Biome (next stage)')
    .onChange((v: string) => (biomeForce.key = v === 'by stage' ? null : v));
  f.add({ reload: () => game.role === 'solo' && game.isCombatMode && game.loadStage(game.stage) }, 'reload').name('Reload this stage');
  f.add(crusherTuning, 'period', 2, 12, 0.1).name('Crusher cycle (s)');
  f.add(crusherTuning, 'warn', 0.4, 3, 0.05).name('Crusher warning (s)');
  f.add(crusherTuning, 'heroDmg', 0, 60, 1).name('Crusher hero damage');
  f.add(crusherTuning, 'eliteFrac', 0, 1, 0.05).name('Crusher elite share');
  f.add(bossDressingTuning, 'radius', 6, 16, 0.5).name('Boss dressing radius');
  f.add(bossDressingTuning, 'rise', 0.2, 4, 0.1).name('Dressing rise (s)');
  f.add(bossDressingTuning, 'sink', 0.2, 4, 0.1).name('Dressing sink (s)');
  f.add(attractTuning, 'enabled').name('Title demo');
  f.add(attractTuning, 'delay', 0, 10, 0.5).name('Demo delay (s)');
  f.add(attractTuning, 'length', 10, 180, 5).name('Demo length (s)');
  f.add(attractTuning, 'crowd', 0.2, 1.5, 0.05).name('Demo crowd');
  f.add(attractTuning, 'frameX', -12, 12, 0.5).name('Demo framing (m)');
}
