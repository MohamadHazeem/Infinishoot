import type { Game } from '../game/game';
import { hostmigDemo } from '../game/systems/hostmig';

/**
 * Test-link options for the host migration lane (solo screenshots; add the
 * companion lane's `mate` for a named teammate):
 * - `hostmig=probe`: the client's HOST LOST · FINDING A NEW HOST panel
 * - `hostmig=join`: the client's NEW HOST: <name> · CONNECTING panel
 * - `hostmig=banner`: the NEW HOST banner everyone sees (with the sample and the voice line)
 */
export function hostmigLinks(game: Game, q: URLSearchParams): void {
  const kind = q.get('hostmig');
  if (kind === null) return;
  const k = kind === 'join' ? 'join' : kind === 'banner' ? 'banner' : 'probe';
  // After the run's own STAGE 1 banner, so this one is what the screenshot shows.
  setTimeout(() => hostmigDemo(game, k), k === 'banner' ? 1500 : 0);
}
