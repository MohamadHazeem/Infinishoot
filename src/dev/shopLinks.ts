/**
 * Shop lane test links (called from applyTestLink, src/dev/testLinks.ts):
 *
 *   &mods=hoarder:2,momentum,echo,kindling   own these Mods (id:level) in slot order
 *   &shop                                    open the stage-clear shop now
 *   &levelup                                 open a level-up now
 *   &focus=buy:1                             hover a control once the menu is up (act:index,
 *                                            e.g. mod-left:2, mod-up:0, sell:1, lock:0, pick:2)
 *   &armban                                  arm BANISH on the level-up screen
 *   &locked=0,2                              lock shop offers 0 and 2 (with &shop)
 *
 *   ?test&gold=60&mods=hoarder:2,momentum:2,echo,kindling&shop&focus=mod-left:3
 */
import { MOD_BY_ID } from '../data/mods';
import type { Game } from '../game/game';

export function shopLinks(game: Game, q: URLSearchParams): void {
  const h = game.hero;
  const list = (k: string) => (q.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const m of list('mods')) {
    const [id, lv] = m.split(':');
    const def = MOD_BY_ID[id];
    if (!def || h.synergy.owns(id) || h.synergy.full) continue;
    h.synergy.add(def, def.price);
    const i = h.synergy.slots.length - 1;
    for (let k = 1; k < (Number(lv) || 1); k++) h.synergy.upgrade(i, h.upgradeCost(def, k));
  }
  if (q.has('mods')) h.recomputeStats();
  if (q.has('shop')) {
    game.openShop();
    const locks = list('locked').map(Number);
    if (locks.length) {
      for (const i of locks) h.toggleLock(i);
      game.presentShop(h);
    }
  } else if (q.has('levelup')) {
    h.pendingLevels = Math.max(1, h.pendingLevels);
    game.openLevelUp();
  }
  const focus = q.get('focus');
  const arm = q.has('armban');
  if (!focus && !arm) return;
  // After the cards have landed (level-up reels) or the shop has dealt.
  setTimeout(() => {
    const scr = document.querySelector<HTMLElement>(`#scr-${game.screens.current}`);
    if (arm) scr?.querySelector<HTMLElement>('[data-act=banish]')?.click();
    if (focus) {
      const [act, i] = focus.split(':');
      const el = scr?.querySelector<HTMLElement>(`[data-act="${act}"]${i !== undefined ? `[data-index="${i}"]` : ''}`);
      el?.onmouseenter?.(new MouseEvent('mouseenter'));
    }
  }, 1800);
}
