import type { Game } from '../game/game';
import { HERO_COLORS } from '../game/hero';
import { RELICS } from '../data/relics';
import { MODS } from '../data/mods';
import { settings } from '../game/settings';
import { save } from '../game/save';
import { tradingDebug } from '../game/systems/trading';

/**
 * Test-link options for the trading lane (after the companion lane's `mate`
 * and the shop lane's `shop`):
 * - `tradedemo`: wallets for screenshots (you: 60 gold, 2 gears, 3 relics; the mate: 18 gold, 1 gear, 1 relic)
 *   and titles (`title=<id>` for you, `matetitle=<id>` for the mate; default PATRON and LEGEND)
 * - `trade=<s>`: open the TRADE quick menu after s seconds (1 by default); `traderelic`: with your relic picker open
 * - `tradepool`: in the shop, the mate opens a pool on its first offer and chips in; you chip 10
 * - `tradelobby`: the online lobby as a host with 3 players, titles and LEGEND picked (no connection)
 */
export function tradingLinks(game: Game, q: URLSearchParams): void {
  const st = tradingDebug(game);
  if (q.has('tradedemo')) {
    st.forceTitle[0] = q.get('title') ?? 'co_patron';
    st.forceTitle[1] = q.get('matetitle') ?? 'co_legend';
    const h = game.hero;
    h.gold = 60;
    h.rerollsLeft = 2;
    h.relics = RELICS.slice(0, 3).map((r) => r.id);
    h.recomputeStats();
    const m = game.heroes[1];
    if (m) {
      m.gold = 18;
      m.rerollsLeft = 1;
      m.relics = [RELICS[5].id];
      m.recomputeStats();
    }
  }
  if (q.has('trade')) {
    const s = Number(q.get('trade')) || 1;
    setTimeout(() => {
      game.openTrade();
      if (q.has('traderelic')) document.querySelector<HTMLElement>('#scr-trade [data-tr=relics]:not(.cant)')?.click();
    }, s * 1000);
  }
  if (q.has('tradepool')) {
    st.later.push(() => {
      const m = game.heroes[1];
      if (!m || game.mode !== 'shop' || game.stepN < 30) return false;
      // A pricey Mod, so the pool shows a few chips.
      m.shopOffers[0] = MODS.filter((x) => !x.cursed && !x.coop && x.price >= 12).sort((x, y) => y.price - x.price)[0] ?? m.shopOffers[0];
      game.tradeMessage(m, { t: 'tr', a: 'pool', i: 0 });
      const p = st.pools.list[0];
      if (!p) return true;
      st.clock += 1;
      game.tradeMessage(m, { t: 'tr', a: 'chip', p: p.id, n: Math.floor(p.price / 3) });
      st.clock += 1;
      game.tradeAct({ a: 'chip', p: p.id, n: Math.floor(p.price / 4) });
      game.presentShop(game.hero);
      return true;
    });
  }
  if (q.has('tradelobby')) {
    if (!save.achievements.includes('hard_stage3')) save.achievements.push('hard_stage3');
    settings.difficulty = 'legend';
    setTimeout(() => {
      game.lobby = [
        { peerId: '', name: 'Host', unlocked: [], skin: 'classic', pet: 'none', hero: 'bulwark', loadout: game.hero.loadoutPick },
        { peerId: 'b', name: 'Mia', unlocked: [], skin: 'classic', pet: 'none', hero: 'ace', loadout: game.hero.loadoutPick },
        { peerId: 'c', name: 'Bo', unlocked: [], skin: 'classic', pet: 'none', hero: 'rookie', loadout: game.hero.loadoutPick },
      ];
      st.titles.set('b', 'co_mythic');
      st.titles.set('c', 'co_pool');
      game.screens.setLobby({
        code: 'K7P2Q',
        players: game.lobby.map((p, i) => ({ name: p.name, color: HERO_COLORS[i], kit: 'Buster / Charge Shot / Bomb', title: game.lobbyTitle(p.peerId) })),
        isHost: true,
        status: 'Ready when you are!',
        difficulty: game.lobbyDifficulty().id,
        kind: 'coop',
      });
    }, 800);
  }
}
