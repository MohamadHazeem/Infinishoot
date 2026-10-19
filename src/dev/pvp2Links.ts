import type { Game } from '../game/game';
import { cheats } from '../game/game';
import { pvpBegin } from '../game/systems/pvpFlow';
import { addPvpBot, pvp2State, setPvpRules } from '../game/systems/pvp2';
import { PVP_ARENA_BY_ID } from '../data/pvpArenas';

/**
 * Test-link options for the pvp2 lane (called from applyTestLink). A PvP match
 * on this machine as host against bots (no network):
 * - `pvp=ffa|teams` the match (`pvpn=<2..8>` heroes, default 4; `pvparena=<id>` garden|sandpit|frost|crucible;
 *   `pvprounds=1|3`); you are hero 1, the rest are bots
 * - `pvpfight` skip the 3-2-1; `pvpzone=<s>` jump the ring clock to that many seconds
 * - `pvpout` you are knocked out and spectate (`pvpfree` with the free camera)
 * - `pvpboard` the round-end scoreboard now; `pvpwatch` you're a bot too (hands-off bot duel)
 */
export function pvp2Links(game: Game, q: URLSearchParams): void {
  const kind = q.get('pvp');
  if (kind !== 'ffa' && kind !== 'teams') return;
  const n = Math.max(2, Math.min(8, Number(q.get('pvpn') ?? 4) || 4));
  const arena = q.get('pvparena') ?? 'rotate';
  setPvpRules(game, { format: kind, rounds: q.get('pvprounds') === '1' ? 1 : 3, arena: PVP_ARENA_BY_ID[arena] ? arena : 'rotate' });
  game.leaveToTitle();
  game.role = 'host';
  game.host = { code: 'TEST1', max: 7, clientIds: [], send() {}, broadcast() {}, close() {} } as unknown as Game['host'];
  game.lobby = [{ peerId: '', name: 'YOU', unlocked: [], skin: game.hero.skin.id, pet: 'none', hero: game.hero.heroDef.id, loadout: game.hero.loadoutPick }];
  game.lobbyKind = 'pvp';
  for (let i = 1; i < n; i++) addPvpBot(game);
  pvpBegin.call(game, 'host', Number(q.get('seed') ?? 7) || 7, 'normal', pvp2State(game).rules);
  if (game.mode === 'shop') game.closeShop();
  // Skip your own stage: hand in the build you have.
  game.pvpStageDone();
  const pvp = game.pvp!;
  if (q.has('pvpfight')) pvp.countdown = 0;
  const zt = Number(q.get('pvpzone'));
  if (zt > 0) {
    pvp.countdown = 0;
    pvp.zoneT = zt;
  }
  if (q.has('pvpwatch')) {
    game.hero.player.dead = true;
    game.hero.player.hp = 0;
  }
  if (q.has('pvpout')) {
    pvp.countdown = 0;
    cheats.god = false;
    const h = game.hero;
    h.player.invuln = 0;
    h.player.hp = 1;
    game.hurtHero(h, 999, 0, 0, null, 'test');
    if (q.has('pvpfree')) window.setTimeout(() => (pvp2State(game).freeCam = true), 300);
  }
  if (q.has('pvpboard')) {
    pvp.countdown = 0;
    window.setTimeout(() => {
      for (const h of game.heroes) if (h.index % 2 === 1) (game.pvp!.lastHit[h.index] = 0), (h.player.hp = 0), (h.player.dead = true);
      game.pvp!.stats[0].dealt = 412;
      game.pvpCheckWinner();
    }, 1500);
  }
}
