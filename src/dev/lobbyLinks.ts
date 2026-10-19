import type { Game } from '../game/game';
import { unlockedWeapons, save } from '../game/save';
import { DEFAULT_LOADOUT, validLoadout } from '../data/loadout';
import { partyState } from '../game/systems/party';
import { cleanProfile } from '../game/lobby';

/**
 * Test-link options for the lobby lane (called from applyTestLink):
 * - `lobbyx`: the online lobby as host with 3 fake players: cards with heroes, pets,
 *   profiles and pings, two of them ready, a few chat lines (`lobbyx=count`: everyone ready, counting down)
 * - `party`: a fake online game over with the PARTY screen open (2 votes in)
 * - `friends`: EXTRAS > FRIENDS with sample saved codes and recent teammates
 */
export function lobbyLinks(game: Game, q: URLSearchParams): void {
  const st = partyState(game);
  if (!st) return;
  const lx = q.get('lobbyx');
  if (lx !== null) {
    game.leaveToTitle();
    game.role = 'host';
    game.netName = game.hero.name;
    game.host = { code: 'K7QXP', clientIds: ['p2', 'p3', 'p4'], send() {}, broadcast() {}, close() {}, kick() {} } as unknown as Game['host'];
    const names = [game.hero.name || 'Mansour', 'Lina', 'Omar', 'Sky'];
    const heroes = ['rookie', 'bulwark', 'ace', 'dash'];
    const skins = ['classic', 'classic', 'classic', 'classic'];
    const pets = ['bit', 'sparky', 'none', 'guardian'];
    game.lobby = names.map((name, i) => ({ peerId: i ? `p${i + 1}` : '', name, unlocked: unlockedWeapons(), loadout: validLoadout(DEFAULT_LOADOUT), skin: skins[i], pet: pets[i], hero: heroes[i] }));
    [
      [42, 9, 4],
      [133, 3, 1],
      [260, 21, 6],
    ].forEach(([ping, lv, best], i) => {
      st.pings.set(`p${i + 2}`, ping);
      st.profiles.set(`p${i + 2}`, cleanProfile({ lv, best, runs: lv * 3, ach: lv, fc: 'ABCD' + (i + 2) })!);
    });
    const all = lx === 'count';
    st.ready.set('', all);
    st.ready.set('p2', true);
    st.ready.set('p3', all);
    st.ready.set('p4', true);
    st.chat.push({ n: 'Lina', c: '#ffcd75', s: 'READY!' }, { n: 'Omar', c: '#a7f070', s: 'one sec, picking my loadout' }, { n: '', c: '', s: 'SKY JOINED', sys: true }, { n: 'Sky', c: '#41a6f6', s: "LET'S GO!" });
    game.screens.showOnline(game.hero.name);
    game.refreshLobby();
    // The ready-up countdown runs in partyTick; hold it for the screenshot.
    if (all) setInterval(() => (st.cd = 2.5), 50);
  }
  if (q.has('party')) {
    game.role = 'host';
    game.host = { code: 'K7QXP', clientIds: ['p2'], send() {}, broadcast() {}, close() {}, kick() {} } as unknown as Game['host'];
    const mate = game.makeHero(1, 'Lina', unlockedWeapons(), 'p2', 'classic', 'bit', 'bulwark');
    game.setHeroes([game.hero, mate]);
    game.startRun();
    game.hero.damageBy = { buster: 48210, drones: 12000 };
    mate.damageBy = { buster: 31900 };
    game.stage = 3;
    game.kills = 2412;
    game.score = 184200;
    game.runTime = 9 * 60 + 41;
    game.level = 27;
    st.votes.set('p2', 'restart');
    game.mode = 'dead';
    game.endRun();
    game.screens.show('none');
    setTimeout(() => {
      (document.querySelector('[data-act=party-open]') as HTMLElement | null)?.click();
    }, 300);
    st.chat.push({ n: 'Lina', c: '#ffcd75', s: 'GG!' }, { n: 'Lina', c: '#ffcd75', s: 'again? that boss was so close' });
  }
  if (q.has('friends')) {
    save.friends.saved = [
      { name: 'Lina', code: 'LNA42' },
      { name: 'Omar', code: 'QMR7X' },
    ];
    save.friends.recent = [
      { name: 'Sky', code: 'SKY9P', last: new Date().toISOString().slice(0, 10), runs: 3 },
      { name: 'Lina', code: 'LNA42', last: '2026-10-17', runs: 7 },
      { name: 'Guest', code: '', last: '2026-09-02', runs: 1 },
    ];
    game.leaveToTitle();
    (document.querySelector('[data-act=fr-open-x]') as HTMLElement | null)?.click();
  }
}
