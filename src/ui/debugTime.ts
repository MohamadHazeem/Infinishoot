import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { timeDebug, timeTuning } from '../game/timeRules';
import { debugBulletTime } from '../game/systems/time';

/** Debug panel folder for the time lane (rewind, last stand, bullet time, death replay, clutch revives). */
export function addTimeFolder(gui: GUI, game: Game): void {
  const f = gui.addFolder('Time: rewind, last stand, replay').close();
  const T = timeTuning;
  f.add(T, 'rewindSeconds', 1, 5, 0.5).name('Rewind seconds');
  f.add(T, 'rewindPerStage', 0, 5, 1).name('Rewinds per stage');
  f.add(T, 'rewindPlay', 0.3, 3, 0.1).name('Rewind playback s');
  f.add(T, 'rewindIframes', 0, 3, 0.1).name('Rewind i-frames');
  f.add(T, 'voteTime', 2, 15, 0.5).name('Co-op vote s');
  f.add(T, 'standCombo', 0, 300, 5).name('Last stand combo');
  f.add(T, 'standMemory', 0, 10, 0.5).name('Combo memory s');
  f.add(T, 'standKills', 1, 100, 1).name('Last stand kills');
  f.add(T, 'standTime', 1, 15, 0.5).name('Last stand seconds');
  f.add(T, 'standHeal', 0.05, 1, 0.05).name('Last stand heal');
  f.add(T, 'standPerStage').name('Last stand per stage');
  f.add(T, 'btSlow', 0, 2, 0.05).name('Bullet time slow-mo s');
  f.add(T, 'btSwing', 0.3, 3, 0.05).name('Bullet time swing s');
  f.add(T, 'btYaw', 0, 1.5, 0.05).name('Swing angle');
  f.add(T, 'btCooldown', 0, 60, 1).name('Bullet time cooldown');
  f.add(T, 'btMargin', 0, 4, 0.1).name('Near-miss margin m');
  f.add(T, 'grazeNeed', 1, 40, 1).name('Graze needed');
  f.add(T, 'replayWindow', 0.5, 5, 0.1).name('Replay window s');
  f.add(T, 'replayPlay', 0.5, 8, 0.1).name('Replay length s');
  f.add(T, 'replayPitch', 5, 60, 1).name('Replay pitch');
  f.add(T, 'replayDist', 4, 25, 0.5).name('Replay distance');
  f.add(T, 'clutchHp', 0, 1, 0.05).name('Clutch rescuer life');
  f.add(T, 'clutchCrowd', 1, 60, 1).name('Clutch crowd');
  f.add(T, 'clutchCooldown', 0, 120, 1).name('Clutch cooldown');
  f.add(timeDebug, 'pin', -1, 1, 0.05).name('Pin progress (-1 off)');
  f.add({ go: () => game.requestRewind(game.hero) }, 'go').name('Rewind now');
  f.add({ go: () => debugBulletTime(game) }, 'go').name('Bullet time now');
}
