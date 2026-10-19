import type { Game } from '../game/game';
import { spectateFakeEmote, spectateFakeLobby, spectateFakeWatchers, spectatePreview, type CamMode } from '../game/systems/spectate';

/**
 * Test-link options for the spectate lane (after the companion lane's `mate`,
 * which adds a dummy teammate). No connection: the views are drawn over a solo run.
 * - `spectest`: the spectator's view (follow card, camera chips, controls, broadcast overlay);
 *   `spcam=follow|auto|free`, `spfollow=<hero index>`, `spoverlay=0` (overlay off)
 * - `spwatchers=<n>`: the players' "n WATCHING" badge; `spemote=<id>`: a spectator emote in the feed every 2 s
 * - `splobby`: the online lobby with WATCHING rows (host view)
 */
export function spectateLinks(game: Game, q: URLSearchParams): void {
  if (q.has('spectest')) {
    const cam = (['follow', 'auto', 'free'] as const).find((c) => c === q.get('spcam')) ?? 'follow';
    const id = setInterval(() => {
      if (game.mode !== 'fight') return;
      clearInterval(id);
      spectatePreview(game, cam as CamMode, Number(q.get('spfollow')) || 0, q.get('spoverlay') !== '0');
    }, 50);
  }
  const n = Number(q.get('spwatchers'));
  const names = ['Mia', 'Bo', 'Kai', 'Nova', 'Rex', 'Pip', 'Juno', 'Zed'];
  if (n > 0) spectateFakeWatchers(game, names.slice(0, Math.min(8, n)));
  const em = q.get('spemote');
  if (em) {
    let k = 0;
    setTimeout(() => spectateFakeEmote(game, names[k++ % names.length], em), 600);
    setInterval(() => spectateFakeEmote(game, names[k++ % names.length], em === 'cycle' ? ['wave', 'cheer', 'thumbs', 'laugh'][k % 4] : em), 2000);
  }
  if (q.has('splobby')) {
    setTimeout(() => {
      game.screens.setLobby({ code: 'K7P2Q', players: [{ name: 'Host', color: '#2f7bff', kit: 'Buster / Charge Shot / Bomb' }, { name: 'Mia', color: '#22c76a', kit: 'Laser / Well / Meteor' }], isHost: false, status: 'Watching! Waiting for the host to start...', difficulty: 'normal', kind: 'coop' });
      spectateFakeLobby(game, ['Bo', 'Kai']);
    }, 800);
  }
}
