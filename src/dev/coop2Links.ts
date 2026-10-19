import type { Game } from '../game/game';
import { Autopilot } from '../game/autopilot';
import { EMOTES, addToInbox, poolTuning, saveMyGhost } from '../game/coop2';
import { HERO_COLORS } from '../game/hero';
import { coop2Debug, coopDebugView, debugGhost, debugTeamUlt } from '../game/systems/coop2';
import { pinWheel } from '../game/teamPlay';

/**
 * Test-link options for the coop2 lane (called from applyTestLink after the
 * companion lane's `mate`, which adds a standing dummy teammate). Times are
 * seconds of play:
 * - `emote=<id>`: your hero emotes after 1 s (wave, cheer, thumbs, laugh, sorry, help);
 *   `mateemote=<id>`: the dummy teammate does too (every 2.5 s)
 * - `wheel=emotes`: the ping wheel opens on the EMOTES page (hold G)
 * - `pool`: the shared revive pool is on (`poollives=<n>`); `downme=<s>`: you go
 *   down after s seconds (the BUY BACK prompt; `gold=` to afford it)
 * - `autopilot`: the dummy teammate plays as a disconnected player on autopilot
 * - `joincode=<CODE>`: show the JOINABLE badge with this code (solo screenshots)
 * - `teamult=<s>`: a team ultimate after s seconds (with `mate`); `teamultloop=<s>`: one every s seconds (screenshots)
 * - `ghostgo=<s>`: a friend's help ghost arrives after s seconds
 * - `lobby`: the online lobby as a host would see it (roles, REVIVE POOL, JOIN ANYTIME), no connection
 * - `ghosts`: EXTRAS > HELP GHOSTS (`ghostdemo` fills it with a ghost of yours and two friends')
 */
export function coop2Links(game: Game, q: URLSearchParams): void {
  const later = (key: string, fn: () => void) => {
    const s = Number(q.get(key));
    if (!(s > 0)) return;
    const t0 = game.runTime;
    const id = setInterval(() => {
      if (game.runTime - t0 < s) return;
      clearInterval(id);
      fn();
    }, 16);
  };
  const st = coop2Debug(game);
  const em = q.get('emote');
  if (em) setTimeout(() => game.coopEmote(game.hero, em), 1000);
  const mem = q.get('mateemote');
  // The dummy can be gone by then (versus, local co-op or the title replace the heroes).
  if (mem && game.heroes[1]) setInterval(() => game.heroes[1] && game.coopEmote(game.heroes[1], mem === 'cycle' ? EMOTES[Math.floor(Math.random() * EMOTES.length)].id : mem), 2500);
  if (q.has('pool')) {
    const id = setInterval(() => {
      if (game.mode !== 'fight' || st.stage < 1) return;
      clearInterval(id);
      st.pool.on = true;
      st.pool.lives = Number(q.get('poollives')) || poolTuning.start;
    }, 50);
  }
  later('downme', () => {
    const h = game.hero;
    const p = h.player;
    h.revivesLeft = 0;
    h.petState.reviveUsed = true;
    p.invuln = 0;
    if (p.hurt(p.hp + 1, 1, 0)) game.onHeroDown(h);
    if (game.heroes[1]) game.heroes[1].player.teleport(p.x + 9, p.z + 6); // too far to revive
  });
  if (q.has('autopilot') && game.heroes[1]) st.grace.push({ index: 1, t: 45, pilot: new Autopilot() });
  const code = q.get('joincode');
  if (code) coopDebugView.joinCode = code.toUpperCase().slice(0, 5);
  // Screenshots of these moments: no level-up menu on top of them.
  if (q.has('teamult') || q.has('ghostgo')) game.xpNext = 1e12;
  later('teamult', () => debugTeamUlt(game));
  const loop = Number(q.get('teamultloop'));
  if (loop > 0) {
    game.xpNext = 1e12;
    setInterval(() => game.mode === 'fight' && debugTeamUlt(game), loop * 1000);
  }
  later('ghostgo', () => debugGhost(game, q.get('ghostname') || 'Pixel'));
  if (q.get('wheel') === 'emotes') setTimeout(() => pinWheel(game, 1), 1200);
  if (q.has('lobby')) {
    setTimeout(() => {
      game.lobby = [
        { peerId: '', name: 'Host', unlocked: [], skin: 'classic', pet: 'none', hero: 'bulwark', loadout: game.hero.loadoutPick },
        { peerId: 'b', name: 'Mia', unlocked: [], skin: 'classic', pet: 'none', hero: 'ace', loadout: game.hero.loadoutPick },
        { peerId: 'c', name: 'Bo', unlocked: [], skin: 'classic', pet: 'none', hero: 'rookie', loadout: game.hero.loadoutPick },
      ];
      game.screens.setLobby({ code: 'K7P2Q', players: game.lobby.map((p, i) => ({ name: p.name, color: HERO_COLORS[i], kit: 'Buster / Charge Shot / Bomb' })), isHost: true, status: 'Ready when you are!', difficulty: 'normal', kind: 'coop' });
      game.coopLobby();
    }, 800);
  }
  if (q.has('ghostdemo')) {
    saveMyGhost({ v: 1, name: 'Player', hero: 'ace', color: '#2f7bff', look: '---00', level: 21, stage: 3, boss: 'Hive Queen', kit: ['laser', 'well', 'meteor'], date: '2026-10-19' });
    addToInbox({ v: 1, name: 'Mia', hero: 'twin', color: '#22c76a', look: '---00', level: 17, stage: 2, boss: 'Rampage Rex', kit: ['buster', 'charge', 'bomb'], date: '2026-10-18' });
    addToInbox({ v: 1, name: 'Bo', hero: 'bulwark', color: '#ffb627', look: '---00', level: 30, stage: 4, boss: 'Omega Overlord', kit: ['rail', 'orbital', 'blizzard'], date: '2026-10-19' });
  }
  if (q.has('ghosts')) {
    const id = setInterval(() => {
      if (!st.ghostUi) return;
      clearInterval(id);
      st.ghostUi.open();
    }, 50);
  }
}
