import type { Game } from '../game/game';
import { settings } from '../game/settings';
import { netDebugView } from '../game/systems/netcode';

/**
 * Test-link options for the netcode lane (solo screenshots of the network HUD;
 * use with the companion lane's `mate`, a dummy teammate):
 * - `netdemo`: the NETWORK panel with made-up numbers and a bad-connection
 *   warning over the teammate (`netdemo=rc`: the teammate is reconnecting,
 *   `netdemo=lost`: this player's own CONNECTION LOST banner)
 * - `netsim=<latency>,<jitter>,<loss>` (read at boot, src/net/netsim.ts): a
 *   simulated bad connection for this machine when it joins a game
 */
export function netcodeLinks(_game: Game, q: URLSearchParams): void {
  const demo = q.get('netdemo');
  if (demo === null) return;
  settings.netOverlay = true;
  netDebugView.on = true;
  netDebugView.mode = demo === 'rc' ? 'rc' : demo === 'lost' ? 'lost' : 'bad';
}
