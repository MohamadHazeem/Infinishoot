import type { Game } from '../game/game';
import type { Hero } from '../game/hero';
import { Autopilot } from '../game/autopilot';
import { pilotHero } from '../game/systems/coop2';
import { unlockedWeapons } from '../game/save';
import { validLoadout, DEFAULT_LOADOUT } from '../data/loadout';

/**
 * Test-link options for the eightp lane (8-player co-op), used with the
 * readability lane's `heroes=<n>` dummies (called from applyTestLink):
 * - `matebots`: every dummy teammate plays on the autopilot brain (moves, aims, fires, specials)
 * - `spread=<m>`: dummies stand on rings up to <m> m around you (framing, name tags, edge pointers)
 * - `matenames`: the dummies get player-like names instead of P2..P8
 * - `matedown=<k>`: k dummies go down after 2 s (revive tags, minimap crosses)
 * - `lobby8`: the online lobby as a host with 8 players (no connection)
 * Example: ?test&heroes=8&matebots&spread=24&matenames&god
 */
const NAMES = ['Mia', 'Bo', 'Kenji', 'Lulu', 'Ravi', 'Zoe', 'Maximilian'];

export function eightpLinks(game: Game, q: URLSearchParams): void {
  const mates = () => game.heroes.filter((h) => h !== game.hero);
  if (q.has('matenames')) mates().forEach((h, i) => (h.name = NAMES[i % NAMES.length]));
  const spread = Number(q.get('spread'));
  if (spread > 0) {
    const me = game.hero.player;
    const list = mates();
    list.forEach((h, i) => {
      const a = (i / Math.max(1, list.length)) * Math.PI * 2 + 0.4;
      const r = spread * (0.35 + 0.65 * ((i * 5) % list.length) / Math.max(1, list.length - 1));
      h.player.teleport(me.x + Math.cos(a) * r, me.z + Math.sin(a) * r);
    });
  }
  if (q.has('matebots')) {
    const pilots = new Map<Hero, Autopilot>();
    setInterval(() => {
      if (game.role === 'client') return;
      for (const h of mates()) {
        if (h.left) continue;
        let p = pilots.get(h);
        if (!p) pilots.set(h, (p = new Autopilot()));
        pilotHero(game, h, p, 1 / 60);
      }
    }, 16);
  }
  if (q.has('lobby8')) {
    game.leaveToTitle();
    game.role = 'host';
    game.netName = game.hero.name;
    game.host = { code: 'K7QXP', max: 7, clientIds: [], send() {}, broadcast() {}, close() {}, kick() {} } as unknown as Game['host'];
    const heroes = ['rookie', 'bulwark', 'ace', 'dash', 'twin', 'duelist', 'furnace', 'rookie'];
    game.lobby = [game.hero.name || 'Host', ...NAMES].map((name, i) => ({ peerId: i ? `p${i + 1}` : '', name, unlocked: unlockedWeapons(), loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: heroes[i] }));
    game.lobbyKind = 'coop';
    game.screens.showOnline(game.hero.name);
    game.refreshLobby();
  }
  const down = Number(q.get('matedown'));
  if (down > 0) {
    setTimeout(() => {
      for (const h of mates().slice(0, down)) {
        const p = h.player;
        h.revivesLeft = 0;
        h.petState.reviveUsed = true;
        p.invuln = 0;
        if (p.hurt(p.hp + 1, 1, 0)) game.onHeroDown(h);
      }
    }, 2000);
  }
}
