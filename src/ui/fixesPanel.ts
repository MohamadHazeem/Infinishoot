import type GUI from 'lil-gui';
import { aiTuning } from '../game/enemies';
import { bossRuleTuning } from '../game/bossRules';
import { netFeelTuning } from '../game/netFeel';
import { lifestealTuning } from '../game/lifesteal';
import { teamTuning } from '../game/teamPlay';
import { coverTuning } from '../game/coverBreak';

/** Debug panel folder for the fixes lane's knobs (src/ui/debugPanel.ts adds it). */
export function addFixesFolder(gui: GUI): void {
  const f = gui.addFolder('Fixes: online, team, balance').close();
  f.add(aiTuning, 'losPad', 0, 1, 0.05).name('Shooter LOS pad');
  f.add(aiTuning, 'losRetry', 0.05, 1, 0.05).name('Shooter LOS retry');
  f.add(bossRuleTuning, 'freezeMul', 0, 1, 0.05).name('Boss/mini freeze x');
  f.add(coverTuning, 'reach', 0, 2, 0.1).name('Rex smash reach');
  f.add(lifestealTuning, 'killsPerSec', 1, 60, 1).name('Lifesteal kills/s');
  f.add(lifestealTuning, 'overflow', 0, 1, 0.05).name('Lifesteal overflow');
  f.add(netFeelTuning, 'stopScale', 0, 2, 0.1).name('Online hit-stop x');
  f.add(netFeelTuning, 'stopMax', 0, 0.3, 0.01).name('Online hit-stop max');
  f.add(netFeelTuning, 'maxRewind', 0, 0.5, 0.01).name('Parry rewind max');
  f.add(netFeelTuning, 'reachMaxExtra', 0, 1.5, 0.05).name('Parry reach + max');
  f.add(teamTuning, 'overloadMul', 1, 3, 0.05).name('Team Overload x');
  f.add(teamTuning, 'holdTime', 0.05, 1, 0.05).name('Ping wheel hold');
}
