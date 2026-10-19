import type GUI from 'lil-gui';
import { biome3Tuning, biome3Force } from '../game/biome3Brain';
export function addBiome3Folder(gui: GUI): void {
  const f = gui.addFolder('Candy / Ruins').close();
  f.add(biome3Force, 'move');
  for (const key of Object.keys(biome3Tuning) as (keyof typeof biome3Tuning)[])
    f.add(biome3Tuning, key, 0.1, key.includes('Damage') ? 40 : 20, 0.1);
}
