import type GUI from 'lil-gui';
import { titanTuning } from '../game/titan';
import { duelTuning } from '../game/bossDuel';
import { remixTuning } from '../data/bossRemix';
import { bossLaneForce } from '../game/systems/bossLane';

/** Debug panel folder for the bosses lane (wave 1): the Titan, rematches and the boss duel. */
export function addBossLaneFolder(gui: GUI): void {
  const f = gui.addFolder('Titan, rematches & duel').close();
  f.add(bossLaneForce, 'titan').name('Next stage boss: Titan');
  f.add(bossLaneForce, 'remix').name('Next stage boss: remix');
  f.add(remixTuning, 'fromLoop', 1, 5, 1).name('Rematches from loop');
  f.add(remixTuning, 'titanFromLoop', 1, 5, 1).name('Titan from loop');
  const t = f.addFolder('Titan').close();
  t.add(titanTuning, 'zoom', 1, 2.2, 0.05).name('Camera pull-back');
  t.add(titanTuning, 'lean', 0, 12, 0.5).name('Camera lean (solo, m)');
  t.add(titanTuning, 'rise', 0.5, 6, 0.1).name('Rise (s)');
  t.add(titanTuning, 'roar', 0, 5, 0.1).name('Pause after a group breaks (s)');
  t.add(titanTuning, 'sweepTele', 0.4, 3, 0.05).name('Sweep telegraph (s)');
  t.add(titanTuning, 'sweepTime', 0.3, 2, 0.05).name('Sweep swing (s)');
  t.add(titanTuning, 'sweepDamage', 0, 60, 1).name('Sweep damage');
  t.add(titanTuning, 'stagger', 0, 2, 0.05).name('Double sweep stagger (s)');
  t.add(titanTuning, 'beamAim', 0.4, 3, 0.05).name('Beam aim (s)');
  t.add(titanTuning, 'beamTime', 0.4, 4, 0.05).name('Beam firing (s)');
  t.add(titanTuning, 'beamTurn', 0, 2, 0.05).name('Beam turn (rad/s)');
  t.add(titanTuning, 'beamDamage', 0, 30, 1).name('Beam damage per tick');
  t.add(titanTuning, 'debrisDamage', 0, 60, 1).name('Debris damage');
  const d = f.addFolder('Duel').close();
  d.add(duelTuning, 'enabled').name('Duel at the last phase');
  d.add(duelTuning, 'delay', 0, 5, 0.1).name('Delay before closing (s)');
  d.add(duelTuning, 'shrink', 2, 30, 0.5).name('Closing time (s)');
  d.add(duelTuning, 'rMin', 5, 20, 0.5).name('Final radius (m)');
  d.add(duelTuning, 'rMax', 12, 45, 1).name('Start radius cap (m)');
  d.add(duelTuning, 'dps', 0, 0.5, 0.01).name('Burn (max life / s)');
}
