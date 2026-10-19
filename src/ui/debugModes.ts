import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { modesForce } from '../game/systems/modes';
import { rhythmTuning } from '../game/modes/rhythm';
import { pacifistTuning } from '../game/modes/pacifist';
import { MINI_KINDS, miniTuning } from '../game/modes/minigames';
import { ghostTuning } from '../game/modes/ghost';
import { ghostStore } from '../game/modes/ghostStore';
import { demoGhost } from '../dev/modesLinks';

/** Debug panel folder for the modes lane: rhythm, pacifist, mini-game and ghost knobs, plus buttons to start each. */
export function addModesFolder(gui: GUI, game: Game): void {
  const f = gui.addFolder('Modes: rhythm, pacifist, mini-games, ghosts').close();
  const host = () => game.role !== 'client' && game.isCombatMode;
  const R = rhythmTuning;
  f.add(R, 'enabled').name('Rhythm stages');
  f.add(R, 'chance', 0, 1, 0.01).name('Rhythm chance per stage');
  f.add(R, 'early', 0, 0.3, 0.01).name('On-beat window before (s)');
  f.add(R, 'late', 0, 0.3, 0.01).name('On-beat window after (s)');
  f.add(R, 'killScore', 1, 8, 0.5).name('On-beat kill score x');
  f.add(R, 'low', 0, 1, 0.05).name('Enemy speed between beats');
  f.add(R, 'sharp', 1, 4, 0.5).name('Beat pulse sharpness');
  f.add(R, 'align', 0, 0.01, 0.0005).name('Music lock speed (s/frame)');
  f.add({ go: () => host() && ((modesForce.rhythm = true), (game.modes.stage = 0)) }, 'go').name('Rhythm stage now');
  f.add({ go: () => ((modesForce.rhythm = null), (game.modes.stage = 0)) }, 'go').name('Rhythm: back to rolled');
  const P = pacifistTuning;
  f.add(P, 'seconds', 30, 240, 5).name('Pacifist length (s)');
  f.add(P, 'count', -0.9, 0.5, 0.05).name('Pacifist enemy count');
  f.add(P, 'gold', 0, 200, 5).name('Pacifist gold');
  f.add({ go: () => host() && ((game.route.force = 'pacifist'), (game.modes.stage = 0)) }, 'go').name('Pacifist road now');
  const M = miniTuning;
  f.add(M, 'play', 5, 60, 1).name('Mini-game length (s)');
  f.add(M, 'galleryEvery', 0.2, 2, 0.05).name('Gallery: target every (s)');
  f.add(M, 'galleryShot', 0.05, 1, 0.01).name('Gallery: shot every (s)');
  f.add(M, 'coinEvery', 0.3, 4, 0.1).name('Coins: wave every (s)');
  f.add(M, 'whackEvery', 0.2, 2, 0.05).name('Whack: pop every (s)');
  f.add(M, 'stageMul', 0, 1, 0.05).name('Gold growth per stage');
  for (const k of MINI_KINDS) f.add({ go: () => host() && game.startMiniGame(k) }, 'go').name(`Mini-game: ${k}`);
  f.add(ghostTuning, 'alpha', 0.1, 1, 0.05).name('Ghost opacity (on reload)');
  f.add(
    {
      go: () => {
        modesForce.ghostAnyMode = true;
        ghostStore.setRival(demoGhost(game.meta.week || 'test', 0, game.hero.player.x, game.hero.player.z));
        game.modes.stage = 0;
      },
    },
    'go',
  ).name('Ghost: race a demo rival');
}
