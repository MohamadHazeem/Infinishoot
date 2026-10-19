import type GUI from 'lil-gui';
import { eightpTuning } from '../game/eightp';
import { lodTuning } from '../render/lod';
import { teamMixTuning } from '../audio/mix';

/** Debug panel folder for the eightp lane (5-8 player scaling, framing, tags, LOD, teammate weapon mix). */
export function addEightpFolder(gui: GUI): void {
  const f = gui.addFolder('8-player co-op').close();
  const T = eightpTuning;
  f.add(T, 'countPast4', 0, 1, 0.05).name('Enemy count / player past 4');
  f.add(T, 'hpPast4', 0, 1, 0.05).name('Enemy life / player past 4');
  f.add(T, 'bossPast4', 0, 1.5, 0.05).name('Boss life / player past 4');
  f.add(T, 'capHpMax', 1, 2.5, 0.05).name('Alive-cap life comp max');
  f.add(T, 'teamPast4', 0, 1, 0.05).name('Team moves / hero past 4');
  f.add(T, 'lootPerPlayer', 0, 0.5, 0.01).name('Loot / player past 4');
  f.add(T, 'reviveHelper', 0, 1, 0.05).name('Revive speed / extra helper');
  f.add(T, 'ultQuorum', 0.3, 1, 0.05).name('Team ult quorum share');
  f.add(T, 'frameRange', 8, 60, 1).name('Camera frame range m');
  f.add(T, 'frameMax', 1, 7, 1).name('Camera frame mates');
  f.add(T, 'tagNear', 0, 30, 1).name('Short tag within m');
  f.add(T, 'midHero', 10, 80, 1).name('Net: mid hero m');
  f.add(T, 'farHero', 20, 120, 1).name('Net: far hero m');
  f.add(T, 'staggerFrom', 1, 99, 1).name('Net: stagger from clients');
  const L = lodTuning;
  f.add(L, 'near', 0, 40, 1).name('LOD full detail m');
  f.add(L, 'far', 10, 80, 1).name('LOD far m');
  f.add(L, 'farMul', 0.1, 1, 0.05).name('LOD far particles');
  f.add(L, 'perHero', 0, 0.3, 0.01).name('LOD per hero');
  const M = teamMixTuning;
  f.add(M, 'gap', 0, 0.2, 0.005).name('Mix: mate cue gap s');
  f.add(M, 'gapPerMate', 0, 0.1, 0.002).name('Mix: gap per mate');
  f.add(M, 'perMate', 0, 0.2, 0.01).name('Mix: gain cut / mate');
  f.add(M, 'duck', 0, 1, 0.05).name('Mix: duck under yours');
  f.add(M, 'windowMax', 1, 20, 1).name('Mix: mate cues / 100 ms');
}
