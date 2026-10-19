/**
 * Race lane, whole-game checks (jsdom, no WebGL): a host Game and a client Game
 * wired in-process (messages structured-cloned, delivered on flush()).
 * - RACE lobby: GAME: RACE, 8-player cap, rank badges (rkme / rkl).
 * - Race: same seed on both, progress board, the client beats the boss first,
 *   results and ratings on both; K.O. then the clock; a client leaving.
 * - CHALLENGE A FRIEND: code from a finished run, playing it back, score to beat.
 * - Tournament hot seat: two turns decide a match. PvP results move the rating.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent', 'location', 'history']) {
  try {
    (globalThis as any)[k] = (dom.window as any)[k];
  } catch {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
  }
}
(globalThis as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
(dom.window.navigator as any).getGamepads = () => [];
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { unlockedWeapons, save } = await import('../src/game/save');
const { validLoadout, DEFAULT_LOADOUT } = await import('../src/data/loadout');
const { raceState, playTurn, startChallenge } = await import('../src/game/systems/race');
const { decodeChallenge, createTourney, encodeChallenge } = await import('../src/game/raceRules');
const { DEFAULT_PVP_RULES } = await import('../src/game/pvp');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const newRoot = () => {
  const r = document.createElement('div');
  document.body.appendChild(r);
  return r;
};
const A = new Game(new Input(canvas), 16 / 9, newRoot(), document.createElement('div'));
const B = new Game(new Input(canvas), 16 / 9, newRoot(), document.createElement('div'));
const rootA = (A.screens as any).root as HTMLElement;
const rootB = (B.screens as any).root as HTMLElement;
const q: [any, any][] = [];
let maxSet = -1;
const connect = () => {
  (A as any).role = 'host';
  (A as any).host = { code: 'R4CE5', clientIds: ['peerB'], send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {}, kick() {}, setMax: (n: number) => (maxSet = n) };
  (B as any).role = 'client';
  (B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
};
const flush = () => {
  while (q.length) {
    const [g, m] = q.shift()!;
    if (g === A) A.onHostMessage('peerB', structuredClone(m));
    else B.onClientMessage(structuredClone(m));
  }
};
const steps = (n: number, games = [A, B]) => {
  for (let i = 0; i < n; i++) {
    for (const g of games) g.update(1 / 60);
    flush();
  }
};
const lobbyUp = () => {
  connect();
  A.netName = 'Host';
  B.netName = 'Guest';
  A.lobbyKind = 'race';
  A.lobby = [{ peerId: '', name: 'Host', unlocked: unlockedWeapons(), loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: 'rookie' }];
  A.screens.showOnline('Host');
  A.refreshLobby();
  B.screens.showOnline('Guest');
  A.onHostMessage('peerB', { t: 'hello', pid: 'pid-guest', name: 'Guest', unlocked: unlockedWeapons(), loadout: DEFAULT_LOADOUT, skin: 'classic', pet: 'none', hero: 'rookie', prof: {} });
  flush();
};
// Both "machines" share one save in this process: give each its own rating by swapping around their turns.
save.ranked.rating = 1200;

// ---------------------------------------------------------------- lobby
lobbyUp();
ok(maxSet === 7, 'RACE lobby takes up to 8 players (7 guests)');
const sa = raceState(A)!;
const sb = raceState(B)!;
ok(sa.ranks.get('peerB') === 1200 && sb.lobbyRanks.length === 2 && sb.lobbyRanks[1].r === 1200 && sb.lobbyRanks[0].r === 1200, 'ratings shared through the lobby: ' + JSON.stringify(sb.lobbyRanks));
ok(rootB.querySelectorAll('#scr-online .lobby-player .rk-badge').length === 2 && rootA.querySelectorAll('#scr-online .lobby-player .rk-badge').length === 2, 'rank badges on the lobby cards (both sides)');
ok((rootB.querySelector('#scr-online .mp-kind-row .on')?.textContent ?? '').includes('RACE'), 'client sees GAME: RACE');
A.lobbyKind = 'coop';
A.refreshLobby();
ok(maxSet === 3, 'other game types are back to 4 players');
A.lobbyKind = 'race';
A.refreshLobby();
flush();

// ---------------------------------------------------------------- race: client wins
A.hostStart();
flush();
ok(!!A.race && !!B.race && A.race.net === 'host' && B.race.net === 'client', 'both race');
ok(A.role === 'solo' && B.role === 'solo' && !!A.host && !!B.client, 'each plays solo, the connection stays open');
ok(A.seed === B.seed && A.race!.seed === B.race!.seed, 'same seed: ' + A.seed);
ok(B.race!.you === 1 && B.race!.rows.length === 2 && B.race!.rows[0].n === 'Host', 'client knows the field');
for (const g of [A, B]) if (g.mode === 'shop') g.closeShop();
steps(120);
ok(A.mode === 'fight' && B.mode === 'fight', 'both fight');
ok(A.race!.rows[1].p > 0 && B.race!.rows[0].p > 0, `progress crosses: host sees ${A.race!.rows[1].p.toFixed(3)}, client sees ${B.race!.rows[0].p.toFixed(3)}`);
ok(Math.abs(A.race!.clock - B.race!.clock) < 0.6, 'clocks agree');
const hud = rootB.querySelector<HTMLElement>('#race-hud')!;
ok(!hud.hidden && (hud.textContent ?? '').includes('Host') && (hud.textContent ?? '').includes('LEFT'), 'rival board on the client HUD: ' + hud.textContent?.replace(/\s+/g, ' ').trim());
// The client "beats the boss" (its stage moves on).
B.stage = 2;
steps(40);
ok(A.race!.phase === 'over' && B.race!.phase === 'over', 'race over on both');
ok(A.race!.final![0].row.n === 'Guest' && B.race!.final![0].row.n === 'Guest' && A.race!.final![0].row.s === 'done', 'Guest wins on both screens');
ok(A.screens.current === 'raceres' && B.screens.current === 'raceres', 'results on both');
ok(!!A.race!.rating && A.race!.rating.delta < 0 && !!B.race!.rating && B.race!.rating.delta > 0, `ratings: host ${A.race!.rating?.delta}, guest ${B.race!.rating?.delta}`);
ok((rootB.querySelector('#scr-raceres .rr-list')?.textContent ?? '').includes('FINISHED'), 'results list the finish time');
ok(A.mode === 'title' && B.mode === 'title', 'worlds stop');
A.leaveToTitle();
B.leaveToTitle();
ok(!A.race && !B.race && !A.host && !B.client, 'leaving clears the race and the connection');

// ---------------------------------------------------------------- race: K.O., then the clock
lobbyUp();
A.hostStart();
flush();
for (const g of [A, B]) if (g.mode === 'shop') g.closeShop();
steps(30);
A.hero.player.dead = true;
A.endRun(false);
ok(A.race!.rows[0].s === 'ko' && A.screens.current === 'raceres' && A.race!.phase === 'run', 'host K.O.: waiting screen while the race goes on');
steps(10);
ok(B.race!.rows[0].s === 'ko', 'the client sees the K.O.');
A.race!.clock = A.race!.limit - 0.1;
steps(40);
ok(A.race!.phase === 'over' && B.race!.phase === 'over' && B.race!.final![0].row.n === 'Guest', 'time: the one still standing wins');
A.leaveToTitle();
B.leaveToTitle();

// ---------------------------------------------------------------- race: a client leaves
lobbyUp();
A.hostStart();
flush();
A.onClientLeft('peerB');
ok(A.race!.rows[1].s === 'left' && A.race!.phase === 'run', 'a racer who leaves is marked LEFT');
A.leaveToTitle();
B.leaveToTitle();
q.length = 0;

// ---------------------------------------------------------------- co-op refuses a crowd
connect();
A.lobbyKind = 'coop';
A.lobby = Array.from({ length: 5 }, (_, i) => ({ peerId: i ? 'p' + i : '', name: 'P' + i, unlocked: unlockedWeapons(), loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: 'rookie' }));
A.hostStart();
ok(A.mode === 'title' && A.heroes.length === 1, 'co-op with 5 players is refused');
A.leaveToTitle();
B.leaveToTitle();
q.length = 0;

// ---------------------------------------------------------------- challenge a friend
A.startSolo();
if (A.mode === 'shop') A.closeShop();
steps(60, [A]);
A.score = 4321;
A.endRun(false);
const code = sa.lastCode;
ok(code.startsWith('IS1.'), 'game over makes a challenge code: ' + code);
ok(!!rootA.querySelector<HTMLElement>('#scr-gameover [data-act=go-chal]') && !rootA.querySelector<HTMLElement>('#scr-gameover [data-act=go-chal]')!.hidden, 'CHALLENGE A FRIEND on the game over screen');
const c = decodeChallenge(code);
ok(c.seed === A.seed && c.score >= 4321 && c.hero === A.hero.heroDef.id, 'the code carries the run');
const locked = { ...c, loadout: { primary: 'rail', secondary: 'orbital', special: 'meteor' }, hero: 'ace', score: 999999, name: 'Lina' };
startChallenge(B, decodeChallenge(encodeChallenge(locked)));
ok(B.seed === c.seed && B.hero.heroDef.id === 'ace' && B.hero.loadoutPick.primary === 'rail' && B.hero.loadoutPick.special === 'meteor', 'the friend plays the same seed, hero and kit (locked items too)');
ok(B.meta.heat.length === 0 && !!sb.chal, 'no heat, challenge active');
if (B.mode === 'shop') B.closeShop();
steps(12, [B]);
ok(!rootB.querySelector<HTMLElement>('#race-hud')!.hidden && (rootB.querySelector('#race-hud')!.textContent ?? '').includes('Lina'), 'score to beat on the HUD');
B.score = 1e6;
steps(2, [B]);
ok(sb.chalPassed, 'passing the score is noticed');
B.endRun(false);
ok((rootB.querySelector('#scr-gameover .go-chal-line')?.textContent ?? '').includes('YOU BEAT LINA'), 'game over says who won: ' + rootB.querySelector('#scr-gameover .go-chal-line')?.textContent);
B.startSolo();
ok(!sb.chal, 'a normal run drops the challenge');
A.leaveToTitle();
B.leaveToTitle();

// ---------------------------------------------------------------- tournament hot seat
sa.tourney = createTourney(['Ann', 'Bo', 'Cy', 'Di'], 'race', 11);
const t = sa.tourney;
playTurn(A, 0, 0, 'a');
ok(!!A.race && A.race.net === 'local' && A.hero.name === 'Ann', "Ann's turn is a local race");
const seedAnn = A.seed;
if (A.mode === 'shop') A.closeShop();
steps(30, [A]);
A.stage = 2; // Ann beats the boss
steps(40, [A]);
ok(!A.race && !!t.rounds[0][0].ra && t.rounds[0][0].ra.p === 2 && A.screens.current === 'tourney', "Ann's result recorded, back to the bracket");
playTurn(A, 0, 0, 'b');
ok(A.seed === seedAnn && A.hero.name === 'Di', 'Di plays the same seed');
if (A.mode === 'shop') A.closeShop();
steps(30, [A]);
A.hero.player.dead = true;
A.endRun(false);
ok(t.rounds[0][0].w === 0 && t.rounds[1][0].a === 0, 'Ann wins the match and moves on');
ok((rootA.querySelector('#scr-tourney .tn-msg')?.textContent ?? '').includes('ANN WINS THE MATCH'), 'bracket says who won');
A.leaveToTitle();

// ---------------------------------------------------------------- pvp result moves the rating
save.ranked.rating = 1000;
const games = save.ranked.games;
connect();
A.lobby = [
  { peerId: '', name: 'Host', unlocked: [], loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: 'rookie' },
  { peerId: 'peerB', name: 'Guest', unlocked: [], loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: 'rookie' },
];
sa.ranks.set('peerB', 1000);
A.netName = 'Host';
// The full PvpState shape: the pvp2 lane (rounds, teams, rules) added fields that pvpOver reads
// (`rules.rounds`, `wins`), so the old hand-built state from before that merge crashed it.
(A as any).pvp = {
  phase: 'duel', net: 'host', seed: 1, ready: new Map(), progress: new Map(), proxies: [], acc: [], lastHit: [], zoneR: 0, zoneT: 0, zoneTick: 0,
  rules: DEFAULT_PVP_RULES, teams: [0, 1], round: 1, wins: [1, 0], arena: '', zoneStart: 0, countdown: 0, roundEnd: 0, landT: [], stats: [], done: false,
};
A.pvpOver('Host');
ok(save.ranked.games === games + 1 && save.ranked.rating > 1000, 'PvP win raises the rating: ' + save.ranked.rating);

ok(errors.length === 0, 'no uncaught errors' + (errors.length ? ': ' + errors.join('\n') : ''));
process.exit(process.exitCode ?? 0);
