import type GUI from 'lil-gui';
import { bosses3Force, bosses3Tuning } from '../game/bosses3';

/** Debug panel folder for the biome bosses (bosses3 lane): Glitch DJ, Boxer Jack, Admiral Gale. */
export function addBosses3Folder(gui: GUI): void {
  const T = bosses3Tuning;
  const f = gui.addFolder('Biome bosses (DJ, Jack, Gale)').close();
  f.add(bosses3Force, 'move').name('Force attack (b3move)');
  const d = f.addFolder('Glitch DJ').close();
  d.add(T, 'pulseBeats', 2, 16, 1).name('Pulse beats');
  d.add(T, 'pulseBullets', 4, 24, 1).name('Pulse bullets');
  d.add(T, 'pulseDamage', 0, 40, 1).name('Pulse / grid ring damage');
  d.add(T, 'gridSpacing', 2.5, 8, 0.25).name('Grid gap (m)');
  d.add(T, 'gridHalf', 0.1, 1.2, 0.02).name('Grid line half-width (m)');
  d.add(T, 'gridHot', 0.05, 0.45, 0.01).name('Grid burn per beat (s)');
  d.add(T, 'gridBeats', 4, 24, 1).name('Grid beats');
  d.add(T, 'gridDamage', 0, 40, 1).name('Grid damage');
  d.add(T, 'dropBeats', 1, 8, 1).name('Drop count-in (beats)');
  d.add(T, 'dancers', 0, 10, 1).name('Dancers');
  const j = f.addFolder('Boxer Jack').close();
  j.add(T, 'crank', 0.3, 2, 0.05).name('Crank wind-up (s)');
  j.add(T, 'punchLength', 6, 30, 0.5).name('Punch length (m)');
  j.add(T, 'punchHalf', 0.3, 2, 0.05).name('Punch half-width (m)');
  j.add(T, 'punchDamage', 0, 60, 1).name('Punch damage');
  j.add(T, 'springAir', 0.3, 1.5, 0.05).name('Spring air time (s)');
  j.add(T, 'soldiers', 0, 10, 1).name('Toy soldiers');
  j.add(T, 'pinSpeed', 6, 30, 0.5).name('Pinball speed (m/s)');
  j.add(T, 'pinTime', 1, 8, 0.1).name('Pinball run (s)');
  j.add(T, 'pinWindup', 0.4, 3, 0.05).name('Pinball wind-up (s)');
  const g = f.addFolder('Admiral Gale').close();
  g.add(T, 'cannonSpeed', 4, 18, 0.5).name('Cannonball speed');
  g.add(T, 'cannonDamage', 0, 40, 1).name('Cannonball damage');
  g.add(T, 'gustTime', 0.5, 6, 0.1).name('Gust length (s)');
  g.add(T, 'gustTele', 0.2, 2, 0.05).name('Gust telegraph (s)');
  g.add(T, 'gustShove', 0, 8, 0.1).name('Gust shove (per 0.2 s)');
  g.add(T, 'gustBullets', 0, 20, 0.5).name('Gust on bullets (m/s²)');
  g.add(T, 'boarders', 0, 8, 1).name('Boarders per party');
  g.add(T, 'boltDelay', 0.4, 2.5, 0.05).name('Lightning telegraph (s)');
  g.add(T, 'boltDamage', 0, 50, 1).name('Lightning damage');
  g.add(T, 'stormEvery', 0.5, 5, 0.1).name('Storm interval (s)');
}
