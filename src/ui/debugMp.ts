import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { versusTuning } from '../game/versus';
import { localCoopTuning } from '../game/localCoop';
import { lobbyTuning } from '../net/lobbies';

/** Debug panel folder for the MP lane: Versus Swarm, local co-op, the lobby browser. */
export function addMpFolder(gui: GUI, game: Game): void {
  const f = gui.addFolder('Multiplayer: versus, local co-op').close();
  const V = versusTuning;
  const vs = f.addFolder('Versus Swarm');
  vs.add(V, 'pointsStart', 0, 100, 1).name('Points at start');
  vs.add(V, 'pointsPerSec', 0, 6, 0.1).name('Points / s');
  vs.add(V, 'pointsRamp', 0, 3, 0.05).name('Rate ramp');
  vs.add(V, 'pointsMax', 50, 400, 5).name('Points cap');
  vs.add(V, 'minGap', 0, 2, 0.05).name('Order gap s');
  vs.add(V, 'burstMax', 1, 20, 1).name('Orders per window');
  vs.add(V, 'markerRadius', 2, 12, 0.5).name('Beacon click radius');
  vs.add(V, 'markerBlock', 2, 20, 0.5).name('Beacon hero block');
  vs.add(V, 'edgeHeroDist', 2, 20, 0.5).name('Edge hero distance');
  vs.add(V, 'maxAlive', 50, 480, 10).name('Max alive');
  vs.add(V, 'meteorDamage', 0, 60, 1).name('Meteor damage');
  vs.add(V, 'novaDamage', 0, 40, 1).name('Nova damage');
  vs.add(V, 'aiThink', 0.2, 5, 0.1).name('AI think s');
  vs.add(V, 'aiSave', 0, 1, 0.05).name('AI save chance');
  vs.add(V, 'camZoom', 1, 2.2, 0.05).name('Command view zoom');
  const act = {
    practice: () => game.versusSolo(),
    points: () => {
      if (game.versus) game.versus.st.points = V.pointsMax;
    },
  };
  vs.add(act, 'practice').name('Versus vs AI');
  vs.add(act, 'points').name('Fill Overlord points');
  const L = localCoopTuning;
  const lc = f.addFolder('Local co-op');
  lc.add(L, 'leash', 6, 40, 0.5).name('Leash m');
  lc.add(L, 'zoomFrom', 0, 20, 0.5).name('Zoom from spread');
  lc.add(L, 'zoomPer', 0, 0.2, 0.005).name('Zoom per m');
  lc.add(L, 'zoomMax', 1, 2.2, 0.05).name('Zoom max');
  lc.add(L, 'countdown', 0, 5, 0.5).name('Start countdown');
  const lb = f.addFolder('Lobby browser');
  lb.add(lobbyTuning, 'heartbeat', 10, 110, 5).name('Heartbeat s');
  lb.add(lobbyTuning, 'minResend', 2, 60, 1).name('Min resend s');
}
