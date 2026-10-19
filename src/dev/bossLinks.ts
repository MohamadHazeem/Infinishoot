import type { Game } from '../game/game';
import { TITAN_PARTS } from '../data/bossRemix';
import type { TitanMove } from '../game/titan';
import { bossLaneForce, titanDebug } from '../game/systems/bossLane';

/**
 * Test-link options for the bosses lane (rematches, the Titan, the boss duel):
 *
 *   &titan              the stage boss is the Titan (with `bossnow`: right away)
 *   &titanphase=3       break the weak points before phase 3 once it has risen (4 = core exposed)
 *   &titanmove=beam     the Titan only uses this attack (sweep, sweep2, beam, debris, quake)
 *   &remix              the stage boss comes as its rematch (King Bopper EX, Rampage Rex: Inferno, Hive Queen: Nightshade)
 *   &duel               push the boss into its last phase once its entrance ends: the ring-of-fire duel
 *
 *   ?test&stage=6&bossnow&god                 loop 2's Titan (stage 6) the normal way
 *   ?test&stage=5&bossnow&remix&god&nointro   King Bopper EX
 *   ?test&stage=2&bossnow&duel&god&nointro    Rex's duel
 */
export function bossLinks(game: Game, q: URLSearchParams): void {
  bossLaneForce.titan = q.has('titan');
  bossLaneForce.remix = q.has('remix');
  bossLaneForce.move = (q.get('titanmove') ?? '') as TitanMove;
  if (q.has('duel')) game.bossField.debugPhase = 3; // every stage boss's last phase
  const ph = Number(q.get('titanphase')) || 0;
  if (ph > 1) {
    const timer = setInterval(() => {
      const d = titanDebug.call(game);
      if (!d.titan || d.titan.rise < 1) return;
      clearInterval(timer);
      d.parts.forEach((e, i) => {
        if (e && e.active && TITAN_PARTS[i].group < ph) game.killEnemy(e, 'debug', game.hero);
      });
    }, 250);
  }
}
