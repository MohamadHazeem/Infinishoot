import type { Game } from '../game/game';
import { unlockedWeapons } from '../game/save';
import { LobbyService, type PublicLobby } from '../net/lobbies';
import { TeamBoardService, type TeamEntry } from '../net/teamboard';
import { mpState } from '../game/systems/mp';
import { KBM, type LocalSlot } from '../game/localCoop';
import { DEFAULT_LOADOUT, validLoadout } from '../data/loadout';
import type { PadSource } from '../core/padInput';
import { localTeamBest, recordTeamBest } from '../net/teamboard';
import { weeklyChallenge } from '../data/weekly';

/**
 * Test-link options for the MP lane (called from applyTestLink):
 * - `versus`: Versus Swarm vs the AI Overlord (you are the hero)
 * - `versus=ol`: you are the Overlord; a standing dummy hero (add `god`) is the other side
 * - `vstime=<s>` stage clock (unlocks cards), `vspts=<n>` Overlord points, `vssel=<i>` selected card,
 *   `vscam=x,z` command view focus, `vsgo=<s>` the AI (or you) drops the selected card every <s> s,
 *   `vsend=heroes|overlord` the result banner now
 * - `localcoop` the join screen (with `lcpads=3` fake pads; `lcjoin` they join, `lcready` they get ready)
 * - `localcoop=run&lcpads=2`: a local co-op run, keyboard + 2 fake pads walking in circles
 *   (`lcturn` opens a level-up so the menus go round)
 * - `browse` / `browse=fake`: PLAY ONLINE > BROWSE GAMES (fake lists sample lobbies)
 * - `teamboard` / `teamboard=fake`: the weekly co-op board (fake: sample teams, a local best)
 * - `lobby=coop|pvp|versus|weekly`: the online lobby as host with 3 fake players (no network)
 * - `mponline`: the PLAY ONLINE screen (HOST / BROWSE / WEEKLY / VERSUS VS AI); `mptitle`: the title
 */
export function mpLinks(game: Game, q: URLSearchParams): void {
  const st = mpState(game);
  if (!st) return;
  const vs = q.get('versus');
  if (vs !== null) startVersusLink(game, vs);
  if (game.versus) {
    const v = game.versus;
    if (q.get('vstime')) game.director.time = Number(q.get('vstime'));
    if (q.get('vspts')) v.st.points = Number(q.get('vspts'));
    if (q.get('vssel')) v.sel = Number(q.get('vssel'));
    const cam = (q.get('vscam') ?? '').split(',').map(Number);
    if (cam.length === 2 && cam.every(Number.isFinite)) [v.camX, v.camZ] = cam;
    const go = Number(q.get('vsgo'));
    if (go > 0) {
      setInterval(() => {
        if (!game.versus || game.mode !== 'fight') return;
        const h = game.aliveHeroes[0]?.player;
        const at = game.versus.markers[game.stepN % Math.max(1, game.versus.markers.length)] ?? { x: (h?.x ?? 0) + 14, z: h?.z ?? 0 };
        game.versusCommand(game.versus.overlord, { c: ['swarm', 'boppers', 'zippies', 'meteor', 'elite'][Math.floor(game.stepN / 60) % 5], x: at.x, z: at.z });
      }, go * 1000);
    }
    const end = q.get('vsend');
    if (end === 'heroes' || end === 'overlord') setTimeout(() => endNow(game, end), 400);
  }
  const lc = q.get('localcoop');
  const nPads = Math.max(0, Math.min(3, Number(q.get('lcpads') ?? 0)));
  if (lc !== null) {
    const src = fakePads(nPads);
    if (lc === 'run') {
      const slots: LocalSlot[] = [{ pad: KBM, hero: 'rookie', loadout: validLoadout(DEFAULT_LOADOUT), ready: true, row: 0 }];
      const heroes = ['bulwark', 'ace', 'dash'];
      for (let i = 0; i < nPads; i++) slots.push({ pad: i, hero: heroes[i], loadout: { primary: ['scatter', 'laser', 'orb'][i], secondary: ['grenade', 'well', 'shield'][i], special: ['storm', 'blizzard', 'meteor'][i] }, ready: true, row: 0 });
      game.localCoopStart(slots, q.get('lcmode') === 'weekly' ? 'weekly' : 'standard', src);
      if (game.mode === 'shop' && !q.has('lcshop')) {
        for (const h of game.heroes) h.shopDone = true;
        game.closeShop();
      }
      if (q.has('lcturn')) {
        setTimeout(() => {
          for (const h of game.heroes) h.pendingLevels = 1;
          game.openLevelUp();
        }, 1500);
      }
    } else {
      game.leaveToTitle();
      st.localUi.pads = src;
      st.localUi.open();
      if (q.has('lcjoin')) for (let i = 0; i < nPads; i++) st.localUi.lobby.join(i);
      if (q.has('lcjoin') && q.has('lckb')) st.localUi.lobby.join(KBM);
      if (q.has('lcready')) st.localUi.lobby.slots.forEach((s, i) => (s.ready = i !== 1));
      st.localUi.lobby.slots.forEach((s, i) => (s.row = i % 4));
      st.localUi.renderScreen();
    }
  }
  const br = q.get('browse');
  if (br !== null) {
    game.leaveToTitle();
    if (br === 'fake') (st.browser as unknown as { service: LobbyService }).service = new LobbyService('http://fake', fakeLobbyFetch);
    st.browser.open();
  }
  const tb = q.get('teamboard');
  if (tb !== null) {
    game.leaveToTitle();
    if (tb === 'fake') {
      (st.board as unknown as { service: TeamBoardService }).service = new TeamBoardService('http://fake', fakeTeamFetch);
      const w = weeklyChallenge().week;
      if (!localTeamBest(w)) recordTeamBest(w, { team: 'Bolt Brigade', members: ['Mansour', 'Lina'], score: 418_250, stage: 6, date: '2026-10-19' });
    }
    st.board.open();
  }
  if (q.has('mponline')) {
    game.leaveToTitle();
    game.screens.showOnline(game.hero.name);
  }
  if (q.has('mptitle')) game.leaveToTitle();
  const lob = q.get('lobby');
  if (lob) {
    game.leaveToTitle();
    game.role = 'host';
    game.netName = game.hero.name;
    game.host = { code: 'K7QXP', clientIds: ['p2', 'p3'], send() {}, broadcast() {}, close() {}, kick() {} } as unknown as Game['host'];
    const names = [game.hero.name || 'Mansour', 'Lina', 'Omar', 'Sky'];
    game.lobby = names.map((name, i) => ({ peerId: i ? `p${i + 1}` : '', name, unlocked: unlockedWeapons(), loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: 'rookie' }));
    game.lobbyKind = (['coop', 'pvp', 'versus', 'weekly'] as const).find((k) => k === lob) ?? 'coop';
    if (q.get('olpeer')) st.overlordPeer = q.get('olpeer') === 'ai' ? 'AI' : q.get('olpeer')!;
    game.screens.showOnline(game.hero.name);
    game.refreshLobby();
  }
}

function startVersusLink(game: Game, how: string): void {
  if (how !== 'ol') {
    game.versusSolo();
  } else {
    // You are the Overlord: hero 0 is benched, a dummy hero stands in the middle (use &god to keep it up).
    game.leaveToTitle();
    const mate = game.makeHero(1, 'Hero', unlockedWeapons());
    game.setHeroes([game.hero, mate]);
    game.startRun();
    game.versusBegin(0);
    mate.player.teleport(0, 0);
    setInterval(() => mate.player.tickTimers(1 / 30), 33);
  }
  if (game.mode === 'shop') {
    for (const h of game.heroes) h.shopDone = true;
    game.closeShop();
  }
}

function endNow(game: Game, w: 'heroes' | 'overlord'): void {
  game.mode = w === 'heroes' ? 'cleared' : 'dead';
  game.versusStep(0);
}

/** Pads 0..n-1 whose sticks walk in circles (and aim outward), so pad heroes move in screenshots. */
export function fakePads(n: number): PadSource {
  const t0 = performance.now();
  return () => {
    const t = (performance.now() - t0) / 1000;
    return Array.from({ length: n }, (_, i) => {
      const a = t * (0.6 + i * 0.25) + i * 2;
      return { index: i, connected: true, axes: [Math.cos(a) * 0.8, Math.sin(a) * 0.8, Math.cos(a + 1.5), Math.sin(a + 1.5)], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) } as unknown as Gamepad;
    });
  };
}

const sampleLobbies = (): PublicLobby[] => {
  const v = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
  return [
    { code: 'K7QXP', name: 'Mansour', players: 3, max: 4, mode: 'coop', difficulty: 'hard', region: 'EU', version: v },
    { code: 'RT4ZB', name: 'Lina', players: 1, max: 4, mode: 'versus', difficulty: 'normal', region: 'EU', version: v },
    { code: 'MW9HC', name: 'NeonFox', players: 2, max: 4, mode: 'weekly', difficulty: 'normal', region: 'NA', version: v },
    { code: 'PP2LA', name: 'Duelist99', players: 2, max: 4, mode: 'pvp', difficulty: 'nightmare', region: 'AS', version: v },
    { code: 'QZ8NN', name: 'OldTimer', players: 1, max: 4, mode: 'coop', difficulty: 'easy', region: 'EU', version: '1.5.0' },
  ];
};

const fakeLobbyFetch = async (url: string): Promise<Response> => {
  const q = new URL(url).searchParams;
  const rows = sampleLobbies().filter((l) => (!q.get('region') || l.region === q.get('region')) && (!q.get('difficulty') || l.difficulty === q.get('difficulty')) && (!q.get('mode') || l.mode === q.get('mode')));
  return new Response(JSON.stringify({ lobbies: rows }), { status: 200 });
};

const fakeTeamFetch = async (): Promise<Response> => {
  const teams: TeamEntry[] = [
    { team: 'Bolt Brigade', members: ['Mansour', 'Lina'], score: 418_250, stage: 6, date: '2026-10-19' },
    { team: 'Swarm Busters', members: ['Omar', 'Sky', 'Rin'], score: 301_900, stage: 5, date: '2026-10-18' },
    { team: 'Pixel Pals', members: ['Ana', 'Ben', 'Cy', 'Dee'], score: 188_400, stage: 4, date: '2026-10-19' },
  ];
  return new Response(JSON.stringify({ teams }), { status: 200 });
};
