import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { emoteTuning, ghostTuning, joinTuning, poolTuning, teamUltTuning } from '../game/coop2';
import { roleTuning } from '../data/coopRoles';
import { coop2Debug, debugGhost, debugTeamUlt } from '../game/systems/coop2';

/** Debug panel folder for the coop2 lane (drop-in, revive pool, roles, team ultimate, emotes, help ghosts). */
export function addCoop2Folder(gui: GUI, game: Game): void {
  const f = gui.addFolder('Co-op 2: join, pool, roles, team ult, ghosts').close();
  const J = joinTuning;
  f.add(J, 'grace', 0, 180, 5).name('Autopilot grace s');
  f.add(J, 'spawnProtect', 0, 10, 0.5).name('Join spawn i-frames');
  f.add(J, 'fairShare', 0, 1, 0.05).name('Joiner level share');
  f.add(J, 'goldShare', 0, 2, 0.05).name('Joiner gold share');
  const P = poolTuning;
  f.add(P, 'start', 0, 10, 1).name('Pool lives');
  f.add(P, 'perStage', 0, 3, 1).name('Pool lives per stage');
  f.add(P, 'wait', 0, 20, 0.5).name('Buy-back wait s');
  f.add(P, 'costBase', 0, 100, 1).name('Buy-back cost base');
  f.add(P, 'costPerStage', 0, 50, 1).name('Buy-back cost / stage');
  const R = roleTuning;
  f.add(R, 'armor', 0, 5, 0.5).name('Role: tank armor');
  f.add(R, 'regen', 0, 3, 0.1).name('Role: medic regen');
  f.add(R, 'damage', 0, 0.5, 0.01).name('Role: damage %');
  f.add(R, 'speed', 0, 0.5, 0.01).name('Role: support speed %');
  const U = teamUltTuning;
  f.add(U, 'window', 0.5, 6, 0.25).name('Team ult window s');
  f.add(U, 'dmg', 0, 100, 1).name('Team ult dmg / wave');
  f.add(U, 'synergy', 1, 3, 0.1).name('Team ult synergy');
  f.add(U, 'radius', 4, 40, 1).name('Team ult radius');
  f.add(U, 'cooldown', 0, 60, 1).name('Team ult cooldown');
  const E = emoteTuning;
  f.add(E, 'minGap', 0, 5, 0.1).name('Emote min gap s');
  f.add(E, 'burst', 1, 10, 1).name('Emotes per window');
  const G = ghostTuning;
  f.add(G, 'duration', 5, 90, 1).name('Ghost seconds');
  f.add(G, 'bolt', 0, 3, 0.05).name('Ghost bolt dmg');
  f.add(G, 'rate', 0.05, 1, 0.01).name('Ghost fire rate s');
  f.add(G, 'perRun', 0, 5, 1).name('Ghosts per run');
  f.add({ go: () => debugGhost(game) }, 'go').name('Help ghost now');
  f.add({ go: () => debugTeamUlt(game) }, 'go').name('Team ultimate now');
  f.add({ go: () => game.coopEmote(game.hero, 'cheer') }, 'go').name('Emote: cheer');
  f.add({ go: () => ((coop2Debug(game).pool.on = true), (coop2Debug(game).pool.lives = P.start)) }, 'go').name('Revive pool on');
}
