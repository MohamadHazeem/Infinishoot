import type { Game } from '../game/game';
import { PASSIVES } from '../data/passives';
import { cineDebug, jackpotTuning } from '../game/cinematics';
import { cineState, debugEnding, debugFlawless, debugGainWindow, debugJackpotChest, debugSkyfall } from '../game/systems/cinematics';
import { settings } from '../game/settings';

/**
 * Test-link options for the cinematics lane (called from applyTestLink). Times
 * are seconds of play (`later`), the `...at=<0..1>` options pin that
 * cinematic at a progress for screenshots:
 * - `skyfall=<s>`: leap into a portal and fall into the next stage (`skygold`:
 *   the golden route, gold clouds and the bonus on landing); `skyat=`.
 * - `ending=<s>`: the painterly ending after Omega (`endloop=<n>`); `endat=`.
 * - `reveal=<item id>`: gain that legendary at `revealgo=<s>` (default 1),
 *   e.g. starfall, vampire, or a fusion id; `revealat=`.
 * - `jackpot=<s>`: a golden chest appears under the hero and opens
 *   (`jackkind=gold|items`); `jackat=`. `jackchest`: a closed golden chest 4 m away.
 * - `flawless=<s>`: clear the stage without a hit (`portalnow` opens the normal
 *   and golden portals right away); `flawat=`.
 * - `titleplay=<s>`: back to the title after s wall seconds, the demo starts and
 *   the player holds the D key (the hero runs right while the menu stays put).
 * - `cine=short|off`: SETTINGS > CINEMATICS for this load.
 */
export function cinematicsLinks(game: Game, q: URLSearchParams): void {
  const lv = q.get('cine');
  if (lv === 'short' || lv === 'off' || lv === 'full') settings.cinematics = lv;
  const later = (key: string, fn: () => void, def = -1) => {
    const raw = q.get(key);
    if (raw === null) return;
    const s = Number(raw) || (def >= 0 ? def : 0.01);
    const t0 = game.runTime;
    const id = setInterval(() => {
      if (game.runTime - t0 < s) return;
      clearInterval(id);
      fn();
    }, 16);
  };
  const pinWhen = (key: string, ready: () => boolean) => {
    const at = q.get(key);
    if (at === null) return;
    const id = setInterval(() => {
      if (!ready()) return;
      cineDebug.pin = Math.max(0, Math.min(1, Number(at) || 0));
      clearInterval(id);
    }, 16);
  };
  const s = cineState(game);
  later('skyfall', () => debugSkyfall(game, q.has('skygold')));
  pinWhen('skyat', () => !!s.sky);
  later('ending', () => debugEnding(game, Number(q.get('endloop')) || 1));
  pinWhen('endat', () => !!s.end);
  const reveal = q.get('reveal');
  if (reveal) {
    const give = () => {
      const h = game.hero;
      debugGainWindow(game); // as if a level-up pick gave it
      if (PASSIVES[reveal]) {
        h.passives[reveal] = 1;
        h.recomputeStats();
        h.loadoutDirty = true;
      } else game.debugGiveWeapon(reveal);
    };
    const t = Number(q.get('revealgo') ?? 1) || 1;
    const t0 = game.runTime;
    const id = setInterval(() => {
      if (game.runTime - t0 < t) return;
      clearInterval(id);
      give();
    }, 16);
  }
  pinWhen('revealat', () => !!s.reveal);
  const kind = q.get('jackkind');
  if (kind === 'gold') jackpotTuning.goldShare = 1;
  else if (kind === 'items') jackpotTuning.goldShare = 0;
  later('jackpot', () => debugJackpotChest(game, game.hero.player.x, game.hero.player.z));
  if (q.has('jackchest')) debugJackpotChest(game, game.hero.player.x + 4, game.hero.player.z);
  pinWhen('jackat', () => !!s.jack);
  later('flawless', () => debugFlawless(game, q.has('portalnow')));
  pinWhen('flawat', () => !!s.flaw);
  const tp = q.get('titleplay');
  if (tp !== null) {
    setTimeout(() => {
      game.leaveToTitle();
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' })), 600);
    }, (Number(tp) || 0.5) * 1000);
  }
}
