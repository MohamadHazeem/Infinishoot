import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { banterTuning, carryTuning, coopObjTuning, COOP_OBJECTIVE_KINDS, tetherTuning } from '../game/coopplay';
import { forceCoopObjective } from '../game/systems/coopplay';

/** Debug panel folder for the coopplay lane (co-op objectives, carrying, buddy tether, banter). */
export function addCoopplayFolder(gui: GUI, game: Game): void {
  const f = gui.addFolder('Co-op play: objectives, carry, tether, banter').close();
  const O = coopObjTuning;
  f.add(O, 'chance', 0, 1, 0.05).name('Co-op objective chance');
  f.add(O, 'holdTime', 0.2, 5, 0.1).name('Vault: hold together s');
  f.add(O, 'switchGap', 3, 15, 0.5).name('Vault: switch distance');
  f.add(O, 'escortSpeed', 0.5, 5, 0.1).name('Core speed m/s');
  f.add(O, 'coreHp', 20, 400, 10).name('Core life');
  f.add(O, 'coreDrain', 0, 10, 0.25).name('Core drain / enemy / s');
  f.add(O, 'zoneTime', 5, 60, 1).name('Zones: seconds');
  f.add(O, 'zoneRadius', 2, 6, 0.1).name('Zones: radius');
  f.add(O, 'bombSpeed', 0.3, 1, 0.05).name('Bomb carrier speed');
  f.add(O, 'bombFuse', 0.5, 6, 0.25).name('Bomb fuse s');
  f.add(O, 'bombBossFrac', 0, 0.4, 0.01).name('Bomb: boss life share');
  const C = carryTuning;
  f.add(C, 'pickRange', 1, 4, 0.1).name('Carry: reach');
  f.add(C, 'speed', 0.3, 1, 0.05).name('Carry: speed');
  const T = tetherTuning;
  f.add(T, 'range', 3, 12, 0.5).name('Tether range');
  f.add(T, 'ramp', 2, 60, 1).name('Tether ramp s');
  f.add(T, 'damage', 0, 0.5, 0.01).name('Tether damage (full)');
  f.add(T, 'regen', 0, 4, 0.1).name('Tether regen (full)');
  const B = banterTuning;
  f.add(B, 'gap', 0, 20, 0.5).name('Banter gap s');
  f.add(B, 'perLine', 0, 60, 1).name('Banter same line s');
  for (const k of COOP_OBJECTIVE_KINDS) f.add({ go: () => forceCoopObjective(game, k) }, 'go').name(`Co-op objective: ${k}`);
}
