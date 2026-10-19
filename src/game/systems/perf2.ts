/** Per-game scratch only: never wire state or retained gameplay decisions. */
import type { Game } from '../game';
import type { Enemy } from '../enemies';

const bullets = new WeakMap<Game, Enemy[]>();

export function bulletCandidates(g: Game): Enemy[] {
  let out = bullets.get(g);
  if (!out) bullets.set(g, (out = []));
  return out;
}
