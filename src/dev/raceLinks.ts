import type { Game } from '../game/game';
import { unlockedWeapons, save } from '../game/save';
import { DEFAULT_LOADOUT, validLoadout } from '../data/loadout';
import { raceBegin, raceFinish, raceState, startChallenge } from '../game/systems/race';
import { createTourney, decodeChallenge, encodeChallenge, recordTurn, recordWin, type RaceRow } from '../game/raceRules';

/**
 * Test-link options for the race lane (called from applyTestLink):
 * - `racex`: an online race in progress as host with 5 fake rivals on the board (`racex=wait`: you're K.O. and waiting;
 *   `racex=end`: the results with a rating change)
 * - `chal=demo` (or `chal=<code>`): play a friend's challenge; `gochal`: a game over with the CHALLENGE A FRIEND button
 * - `compete=challenge|ranked|tourney`: EXTRAS > COMPETE on that tab (`rating=1620` sets the rating in memory, `rkhist` adds past seasons)
 * - `tourney=new|demo|champ`: the TOURNAMENT setup, a bracket mid-way, or a finished one
 * - `lobbyrace`: a host lobby, GAME: RACE, 6 fake players with rank badges
 */
export function raceLinks(game: Game, q: URLSearchParams): void {
  const st = raceState(game);
  if (!st) return;
  const fakeHost = (ids: string[]) => ({ code: 'R4CE5', clientIds: ids, send() {}, broadcast() {}, close() {}, kick() {}, setMax() {} }) as unknown as Game['host'];
  const names = [game.hero.name || 'Mohamad', 'Lina', 'Omar', 'Sky', 'Noor', 'Kai'];
  const ratings = [1180, 1320, 990, 1610, 1460, 1820];
  if (q.get('rating')) save.ranked.rating = Number(q.get('rating')) || save.ranked.rating;
  if (q.has('rkhist'))
    save.ranked.history = [
      { season: '2026-09', rating: 1288, peak: 1340, games: 31, wins: 12 },
      { season: '2026-08', rating: 1105, peak: 1150, games: 14, wins: 4 },
    ];

  const rx = q.get('racex');
  if (rx !== null) {
    game.leaveToTitle();
    game.host = fakeHost(['p2', 'p3', 'p4', 'p5', 'p6']);
    game.netName = names[0];
    raceBegin(game, { net: 'host', seed: 4242, difficulty: 'normal', names, ranks: ratings, you: 0, peers: ['', 'p2', 'p3', 'p4', 'p5', 'p6'] });
    if (game.mode === 'shop') game.closeShop();
    const R = game.race!;
    R.clock = 151;
    R.goSaid = true;
    const fake: Partial<RaceRow>[] = [{}, { p: 1.62, s: 'boss', b: 0.38, lv: 14 }, { p: 0.71, s: 'run', lv: 9 }, { p: 0.93, s: 'run', lv: 12 }, { p: 0.4, s: 'ko', t: 98, lv: 6 }, { p: 1.05, s: 'boss', b: 0.95, lv: 13 }];
    fake.forEach((f, i) => i && Object.assign(R.rows[i], f));
    // Keep the fakes from being reset by the host's report loop for screenshots.
    const iv = setInterval(() => {
      if (game.race !== R) return clearInterval(iv);
      fake.forEach((f, i) => i && R.phase === 'run' && Object.assign(R.rows[i], f));
    }, 100);
    if (rx === 'wait' || rx === 'end') {
      setTimeout(() => {
        game.hero.player.dead = true;
        game.endRun(false);
        if (rx === 'end') {
          const rows = R.rows.map((r) => ({ ...r }));
          rows[1] = { ...rows[1], s: 'done', p: 2, t: 262 };
          raceFinish(game, rows);
        }
      }, 1500);
    }
  }

  const ch = q.get('chal');
  if (ch !== null) {
    const demo = encodeChallenge({ seed: 77, mode: 'standard', difficulty: 'normal', hero: 'ace', loadout: { primary: 'scatter', secondary: 'grenade', special: 'storm' }, score: 52410, stage: 3, name: 'Lina' });
    try {
      startChallenge(game, decodeChallenge(ch === 'demo' || !ch ? demo : ch));
      if (game.mode === 'shop') game.closeShop();
    } catch (e) {
      game.hud.toast((e as Error).message, 4);
    }
  }

  if (q.has('gochal')) {
    game.startRun();
    game.score = 61230;
    game.stage = 3;
    game.kills = 1402;
    st.chal = decodeChallenge(encodeChallenge({ seed: game.seed, mode: 'standard', difficulty: 'normal', hero: 'rookie', loadout: validLoadout(DEFAULT_LOADOUT), score: 52410, stage: 3, name: 'Lina' }));
    setTimeout(() => {
      game.endRun(false);
      game.screens.show('gameover');
    }, 800);
  }

  const cp = q.get('compete');
  if (cp !== null) setTimeout(() => st.ui.openCompete(cp === 'ranked' || cp === 'tourney' ? cp : 'challenge'), 300);

  const tn = q.get('tourney');
  if (tn !== null) {
    if (tn !== 'new') {
      const t = createTourney(['Mohamad', 'Lina', 'Omar', 'Sky', 'Noor', 'Kai'], 'race', 99);
      recordTurn(t, 0, 1, 'a', { p: 2, t: 251, score: 30200 });
      recordTurn(t, 0, 1, 'b', { p: 1.4, t: 300, score: 28000 });
      recordWin(t, 0, 3, t.rounds[0][3].b);
      if (tn === 'champ') {
        recordWin(t, 1, 0, t.rounds[1][0].a);
        recordWin(t, 1, 1, t.rounds[1][1].b);
        recordWin(t, 2, 0, t.rounds[2][0].b);
      } else recordTurn(t, 1, 0, 'a', { p: 1.2, t: 300, score: 21000 });
      st.tourney = t;
    } else st.tourney = null;
    setTimeout(() => st.ui.openTourney(), 300);
  }

  if (q.has('lobbyrace')) {
    game.leaveToTitle();
    game.role = 'host';
    game.netName = names[0];
    game.host = fakeHost(['p2', 'p3', 'p4', 'p5', 'p6']);
    game.lobbyKind = 'race';
    game.lobby = names.map((name, i) => ({ peerId: i ? `p${i + 1}` : '', name, unlocked: unlockedWeapons(), loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: 'rookie' }));
    names.forEach((_, i) => i && st.ranks.set(`p${i + 1}`, ratings[i]));
    save.ranked.rating = ratings[0];
    game.screens.showOnline(names[0]);
    game.refreshLobby();
  }
}
