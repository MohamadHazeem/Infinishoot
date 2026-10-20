import type { Game } from '../game/game';
import { h4World } from '../game/systems/heroes4';

/**
 * Test-link options for the heroes4 lane (Medic, Brawler), for screenshots:
 *
 *   &hero=medic&aim=1,0       the mending beam (a held stick aim fires the left click)
 *   &hero=medic&beacongo=1    press right click after 1 s (heroes3Links): the revive drone (shield solo; add &mate&downmate=0.5 to revive)
 *   &hero=brawler&strikego=1  hold right click 0.7 s from 1 s in (heroes3Links): grab, carry, throw
 *   &holdgo=1:1.4             hold right click from 1 s for 1.4 s (a longer carry / Giant Swing)
 *   &lowlife=0.15             your life drops to 15% (Lifesaver)
 *   &envkills=19              your Wrecking Crew count
 *   &ultgo=1                  (testLinks.ts) Field Hospital / Wrecking Ball
 */
export function heroes4Links(game: Game, q: URLSearchParams): void {
  const h = game.hero;
  const hold = (q.get('holdgo') ?? '').split(':').map(Number);
  if (hold[0] > 0) {
    const v = game.input.virtual;
    setTimeout(() => {
      v.active = true;
      v.buttons[2] = true;
      setTimeout(() => (v.buttons[2] = false), (hold[1] || 1) * 1000);
    }, hold[0] * 1000);
  }
  const low = Number(q.get('lowlife'));
  if (low > 0) setTimeout(() => (h.player.hp = h.player.maxHp * low), 300);
  const ek = Number(q.get('envkills'));
  if (ek > 0) h4World(game).envKills[h.index] = ek;
}
