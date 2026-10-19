import type { Game } from '../game/game';
import { bosses3Force } from '../game/bosses3';

/**
 * Test-link options for the biome bosses (bosses3 lane):
 *
 *   &biome=neon|factory|sky   that biome's own boss (Glitch DJ, Boxer Jack, Admiral Gale) on any stage
 *   &b3move=grid              the biome boss only uses this attack
 *                             DJ: ring, grid, drop, summon, spiral; Jack: punch, slam, ring, summon, pinball;
 *                             Gale: volley, rain, gust, summon, waves (thunder ring, phase 3)
 *
 *   ?test&biome=neon&bossnow&god                     Glitch DJ with its entrance
 *   ?test&biome=factory&bossnow&god&nointro&phase=3  Boxer Jack's pinball phase
 *   ?test&biome=sky&bossnow&god&nointro&b3move=gust  Admiral Gale's gusts
 *   &b3near                   once the boss is in, move it 6 m to the hero's right (screenshots)
 *   &b3pose                   ...and keep it posing there (idle, invulnerable) for model close-ups
 *   ?test&stage=5&miniboss&god                       a loop-2 mini-boss (MC Static, Jack Jr. or Commodore Squall by stage)
 */
export function bosses3Links(game: Game, q: URLSearchParams): void {
  bosses3Force.move = q.get('b3move') ?? '';
  if (!q.has('b3near') && !q.has('b3pose')) return;
  const pose = q.has('b3pose');
  const timer = setInterval(() => {
    const b = game.boss;
    if (!b || !b.active) return;
    if (!pose) clearInterval(timer);
    const p = game.hero.player;
    b.x = b.px = p.x + 5;
    b.z = b.pz = p.z - 2;
    if (pose) {
      b.roarT = 5;
      b.facing = 0.35;
    }
  }, 100);
}
