/** mods2: deterministic shop cards and a contact sheet rendered by the game's own icon renderer. */
import type { Game } from '../game/game';
import { MODS2, MOD_BY_ID } from '../data/mods';
import { iconHtml } from '../ui/pixelIcons';

export function mods2Links(g: Game, q: URLSearchParams): void {
  if (q.has('modoffers')) {
    g.hero.shopLocked = [];
    if (g.mode !== 'shop') g.openShop();
    // openShop rolls offers, so apply the explicit cards after it.
    g.hero.shopOffers = (q.get('modoffers') ?? '')
      .split(',')
      .map((id) => MOD_BY_ID[id])
      .filter(Boolean)
      .slice(0, 4);
    g.presentShop(g.hero);
  }
  if (q.has('modicons')) {
    const sheet = document.createElement('div');
    sheet.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#1a1c2c;color:#f4f4f4;display:grid;grid-template-columns:repeat(6,1fr);align-content:center;gap:24px;padding:32px;font-family:Silkscreen;text-align:center';
    sheet.innerHTML = MODS2.map(
      (d) => `<div>${iconHtml(d.id, d.color, d.icon)}<p>${d.name}</p></div>`,
    ).join('');
    const style = document.createElement('style');
    style.textContent =
      '.mods2-icons .px-icon { width:72px;height:72px;image-rendering:pixelated }';
    sheet.className = 'mods2-icons';
    document.head.appendChild(style);
    document.body.appendChild(sheet);
  }
}
