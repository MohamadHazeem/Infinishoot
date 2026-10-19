import type GUI from 'lil-gui';
import { biomeFoeTuning } from '../game/biomeFoes';
import { heroMechTuning } from '../game/heroMechs';
import { addHeroes3Folder } from './debugHeroes3';

/** Debug panel folder for the content lane: biome foes and hero mechanics. */
export function addContentFolder(gui: GUI): void {
  const f = gui.addFolder('Biome foes & heroes').close();
  f.add(biomeFoeTuning, 'puddleTick', 0.1, 2, 0.05).name('Lava puddle tick (s)');
  f.add(biomeFoeTuning, 'crashFreeze', 0, 4, 0.1).name('Snowball crash freeze');
  f.add(biomeFoeTuning, 'gustEnemies', 0, 2, 0.05).name('Gust push on enemies');
  f.add(biomeFoeTuning, 'sharkFin', 0.5, 3, 0.05).name('Shark fin size');
  const d = heroMechTuning.duelist;
  f.add(d, 'parryWindowMul', 1, 4, 0.1).name('Duelist parry window x');
  f.add(d, 'whiffCooldown', 0, 1, 0.05).name('Duelist whiff cooldown');
  f.add(d, 'chainMax', 1, 10, 1).name('Duelist chain max');
  f.add(d, 'chainDamage', 0, 0.5, 0.01).name('Duelist +dmg per chain');
  f.add(d, 'chainTime', 1, 10, 0.5).name('Duelist chain time');
  const fu = heroMechTuning.furnace;
  f.add(fu, 'heatRise', 0.05, 2, 0.05).name('Furnace heat rise/s');
  f.add(fu, 'heatDrop', 0.1, 10, 0.1).name('Furnace heat drop/s');
  f.add(fu, 'damageMax', 0, 2, 0.05).name('Furnace +dmg at full heat');
  f.add(fu, 'auraMax', 1, 8, 0.1).name('Furnace aura radius');
  f.add(fu, 'auraDamage', 0, 40, 1).name('Furnace aura damage');
  const t = heroMechTuning.twin;
  f.add(t, 'damage', 0, 1, 0.05).name('Twin damage x');
  f.add(t, 'side', 0.5, 3, 0.1).name('Twin distance');
  addHeroes3Folder(gui); // Ronin and Tinker (heroes3 lane)
}
