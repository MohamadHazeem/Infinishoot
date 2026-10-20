import type { Game } from '../game/game';
import { save } from '../game/save';
import { CHALLENGE_BY_ID, SEASON_ITEMS, claimNext, rollSeasonPass, seasonClock, syncOwnedRewards, themeFor, xpForTier } from '../data/season';
import { equipSeasonItem, seasonUi } from '../game/systems/season';

/**
 * SEASON track test links (seasonpass lane):
 * - `spmonth=2027-03` pretends it is that month (picks its theme).
 * - `sptier=17` sets season XP to that tier (+ a little); `spclaim=12` claims that many tiers first.
 * - `spweek=0.5` sets the weekly challenges to that fraction (1 = all done).
 * - `spown=all` owns every season cosmetic; `spequip=sp_neon_hat,sp_neon_trail` wears them.
 * - `sppast` adds a few finished seasons; `spscroll` scrolls the SEASON screen down; `spclickclaim` presses CLAIM (the reveal); `spgo=8` shows the game-over summary after 8 s (with `die=`); `spscreen=season` opens EXTRAS > SEASON (`screen=title` shows the title banner).
 */
export function seasonLinks(game: Game, q: URLSearchParams): void {
  const m = /^(\d{4})-(\d{2})$/.exec(q.get('spmonth') ?? '');
  if (m) {
    const at = new Date(Number(m[1]), Number(m[2]) - 1, 12, 12);
    seasonClock.now = () => at;
  }
  const sp = save.seasonPass;
  rollSeasonPass(sp);
  if (q.has('sptier')) {
    const t = Math.max(0, Math.min(50, Number(q.get('sptier')) || 0));
    sp.xp = xpForTier(t) + (t < 50 ? 120 : 0);
  }
  if (q.has('spclaim')) for (let i = Number(q.get('spclaim')) || 0; i > 0 && claimNext(sp); i--);
  if (q.has('spweek')) {
    const f = Math.max(0, Math.min(1, Number(q.get('spweek')) || 0));
    sp.prog = sp.ch.map((id) => Math.floor(f * CHALLENGE_BY_ID[id].goal));
    sp.done = sp.ch.map(() => f >= 1);
  }
  if (q.get('spown') === 'all') {
    sp.owned = SEASON_ITEMS.map((i) => i.id);
    syncOwnedRewards(sp.owned);
  }
  for (const id of (q.get('spequip') ?? '').split(',').filter(Boolean)) equipSeasonItem(game, id);
  if (q.has('sppast')) sp.past = ['2026-09', '2026-08', '2026-07'].map((season, i) => ({ season, theme: themeFor(season).id, tier: [34, 50, 12][i] }));
  // With &die=0.5: skip past the MVP card to the game-over summary (its SEASON strip).
  if (q.has('spgo')) setTimeout(() => game.screens.show('gameover'), Number(q.get('spgo')) * 1000 || 8000);
  if (q.get('spscreen') === 'season') {
    // Opened a moment later: the run's opening (sky fall, starting shop) may still switch screens.
    const open = () => {
      if (game.screens.current === 'season') return;
      game.paused = true;
      seasonUi(game).open();
      if (q.has('spclickclaim')) setTimeout(() => document.querySelector<HTMLElement>('#scr-season [data-sp=claim]')?.click(), 300);
      if (q.has('spscroll')) document.querySelector('#scr-season .sp-wrap')?.scrollTo(0, 9999);
    };
    open();
    for (let ms = 1000; ms <= 8000; ms += 1000) setTimeout(open, ms);
  }
}
