/**
 * MP lane, whole-game checks (jsdom, no WebGL):
 * - Versus Swarm online: a host Game and a client Game wired in-process; the
 *   client is the Overlord. Its orders travel as `vcmd`, the host validates
 *   and rate-limits them, the client's purse and refusals come back, the
 *   benched Overlord still gets snapshots, and both win conditions end the
 *   match on both machines.
 * - Versus vs the AI Overlord (solo): the director spawns nothing, the AI does.
 * - Local co-op: three heroes on one Game, two driven by fake pads; the shared
 *   Input ignores pads; level-up and shop menus go round in turn.
 * - Weekly co-op online: the whole team plays the weekly seed and rules; the
 *   team's best is kept locally.
 * - Lobby rows: VERSUS / WEEKLY game types, the Overlord pick, PUBLIC.
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
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
// Gamepads the shared Input sees (navigator.getGamepads).
const btn = (down: number[] = []) => Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0, touched: false }));
let browserPads: any[] = [];
(dom.window.navigator as any).getGamepads = () => browserPads;
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { unlockedWeapons } = await import('../src/game/save');
const { validLoadout, DEFAULT_LOADOUT } = await import('../src/data/loadout');
const { mpState } = await import('../src/game/systems/mp');
const { isOverlord, versusOrder } = await import('../src/game/systems/versus');
const { versusTuning, CARD_BY_ID } = await import('../src/game/versus');
const { KBM } = await import('../src/game/localCoop');
const { localTeamBest } = await import('../src/net/teamboard');
const { weeklyChallenge } = await import('../src/data/weekly');
const { ENEMIES, bossForStage } = await import('../src/data/enemies');
const { lobbyService } = await import('../src/net/lobbies');
const { settings } = await import('../src/game/settings');
const { FakeKV, workerFetch } = await import('./fakeKv');
// @ts-ignore: plain JS worker module
const worker = (await import('../server/leaderboard/worker.js')).default;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const roots: HTMLElement[] = [];
const newRoot = () => {
  const r = document.createElement('div');
  document.body.appendChild(r);
  roots.push(r);
  return r;
};
const entry = (peerId: string, name: string) => ({ peerId, name, unlocked: unlockedWeapons(), loadout: validLoadout(DEFAULT_LOADOUT), skin: 'classic', pet: 'none', hero: 'rookie' });

/** A host and a client Game joined in-process (messages are structured-cloned and delivered on flush()). */
function pair() {
  const A = new Game(new Input(canvas), 16 / 9, newRoot(), document.createElement('div'));
  const B = new Game(new Input(canvas), 16 / 9, newRoot(), document.createElement('div'));
  const q: [any, any][] = [];
  const toB: any[] = [];
  (A as any).role = 'host';
  (A as any).host = { code: 'TESTA', clientIds: ['peerB'], send: (_id: string, m: any) => q.push([B, m]), broadcast: (m: any) => q.push([B, m]), close() {}, kick() {} };
  (B as any).role = 'client';
  (B as any).client = { send: (m: any) => q.push([A, m]), close() {} };
  const flush = () => {
    while (q.length) {
      const [g, m] = q.shift()!;
      if (g === A) A.onHostMessage('peerB', structuredClone(m));
      else {
        toB.push(m);
        B.onClientMessage(structuredClone(m));
      }
    }
  };
  A.lobby = [entry('', 'Host'), entry('peerB', 'Guest')];
  A.netName = 'Host';
  return { A, B, flush, toB };
}
const steps = (games: InstanceType<typeof Game>[], n: number, flush?: () => void) => {
  for (let i = 0; i < n; i++) {
    for (const g of games) g.update(1 / 60);
    flush?.();
  }
};

// ---------------------------------------------------------------- Versus online, the client is the Overlord
{
  const { A, B, flush, toB } = pair();
  A.lobbyKind = 'versus';
  mpState(A)!.overlordPeer = 'peerB';
  A.refreshLobby();
  flush();
  const lobbyB = B.screens['els' as never] as any;
  const xB = (lobbyB.online as HTMLElement).querySelector('.mp-x')?.textContent ?? '';
  ok(xB.includes('OVERLORD') && xB.includes('GUEST'), 'the client lobby shows who the Overlord is: ' + xB.trim());
  const xA = ((A.screens['els' as never] as any).online as HTMLElement).querySelector('.mp-x')?.innerHTML ?? '';
  ok(xA.includes('data-act="mp-ol"') && xA.includes('PUBLIC'), 'the host lobby has the Overlord pick and PUBLIC');
  A.hostStart();
  flush();
  ok(!!A.versus && A.versus.overlord === 1, 'host started Versus with the client as Overlord');
  const ol = A.heroes[1];
  ok(ol.left && ol.player.dead && !A.coop, 'the Overlord hero sits out (not a co-op hero)');
  ok(A.director.players === 1, 'the director scales for the one real hero');
  if (A.mode === 'shop') A.heroAction(A.hero, 'done', 0, 1);
  flush();
  ok(A.mode === 'fight', 'the starting shop closes without the Overlord (mode ' + A.mode + ')');
  cheats.god = true;
  steps([A, B], 90, flush);
  ok(!!B.versus && isOverlord(B) && B.hero.left, 'the client knows it is the Overlord from the snapshot');
  const snaps = toB.filter((m) => m.t === 's').length;
  ok(snaps > 10, `the benched Overlord still gets snapshots (${snaps})`);
  ok(A.enemies.activeCount === 0, 'no director spawns in Versus (alive ' + A.enemies.activeCount + ')');
  ok(Math.abs(B.versus!.st.points - A.versus!.st.points) < 1.5, `the purse mirrors to the client (${B.versus!.st.points.toFixed(1)} vs ${A.versus!.st.points.toFixed(1)})`);
  // An order from the client.
  const m = A.versusWorld().markers.find((_, i) => A.versusWorld().markers[i] && Math.hypot(A.versusWorld().markers[i].x - A.hero.player.x, A.versusWorld().markers[i].z - A.hero.player.z) > versusTuning.markerBlock)!;
  const pts0 = A.versus!.st.points;
  versusOrder(B, { c: 'swarm', x: m.x, z: m.z });
  flush();
  const near = A.enemies.list.filter((e) => e.active && e.def.id === 'swarmer' && Math.hypot(e.x - m.x, e.z - m.z) < 4).length;
  ok(near === CARD_BY_ID.swarm.count, `the Overlord's Swarm Pack lands at the beacon (${near})`);
  ok(Math.abs(A.versus!.st.points - (pts0 - CARD_BY_ID.swarm.cost)) < 0.01, 'and costs its points');
  versusOrder(B, { c: 'boppers', x: m.x, z: m.z });
  flush();
  ok(B.versus!.note === 'TOO FAST', 'a second order straight away is refused (client sees: ' + B.versus!.note + ')');
  steps([A, B], 30, flush);
  versusOrder(B, { c: 'boss', x: 50, z: 0 });
  flush();
  ok(B.versus!.note === 'LOCKED', 'a locked card is refused (' + B.versus!.note + ')');
  ok(A.versusCommand(0, { c: 'swarm', x: 50, z: 0 }) === 'not the overlord', 'heroes cannot order');
  B.onHostMessage?.call(B, '', {});
  A.onHostMessage('peerB', { t: 'vcam', x: 30, z: -12 });
  ok(Math.round(ol.player.x) === 30 && Math.round(ol.player.z) === -12, "the Overlord's camera drives its interest box");
  // The boss (unlock it, fund it), then the heroes win by killing it.
  A.director.time = 160;
  A.versus!.st.points = 150;
  steps([A, B], 30, flush);
  versusOrder(B, { c: 'boss', x: 50, z: 0 });
  flush();
  ok(!!A.boss && A.director.bossSpawned && A.versus!.st.bossUsed, 'the Overlord unleashes the boss');
  steps([A, B], 200, flush); // the entrance cinematic
  const sent = toB.length;
  A.killEnemy(A.boss!, A.hero);
  for (let k = 0; k < 600 && !A.versus?.winner; k++) steps([A, B], 1, flush); // the finisher and the death slow-mo play first
  steps([A, B], 5, flush);
  ok(A.versus?.winner === 'heroes' && B.versus?.winner === 'heroes', 'boss down: the heroes win on both machines');
  steps([A, B], 200, flush);
  ok(!toB.slice(sent).some((m) => m.t === 'shop'), 'no post-boss shop in Versus');
  steps([A, B], Math.ceil(versusTuning.endHold * 60), flush);
  ok(A.mode === 'title' && !A.versus && !B.versus, 'everyone is back at the title after the result');
  cheats.god = false;
}

// ---------------------------------------------------------------- Versus online, the host is the Overlord
{
  const { A, B, flush } = pair();
  A.lobbyKind = 'versus';
  mpState(A)!.overlordPeer = '';
  A.hostStart();
  flush();
  ok(A.versus?.overlord === 0 && isOverlord(A) && A.hero.left, 'the host can be the Overlord');
  if (A.mode === 'shop') A.heroAction(A.heroes[1], 'done', 0, 1);
  flush();
  ok(A.mode === 'fight', 'the guest hero closes the starting shop alone');
  cheats.god = true;
  steps([A, B], 60, flush);
  ok(!B.hero.left && !isOverlord(B) && B.versus?.overlord === 0, 'the client is the hero');
  const w = A.versusWorld();
  const m = w.markers.find((mk) => w.heroes.every((h) => Math.hypot(h.x - mk.x, h.z - mk.z) > versusTuning.markerBlock))!;
  versusOrder(A, { c: 'boppers', x: m.x, z: m.z });
  steps([A, B], 20, flush);
  const mirrored = [...B.netEnemies.values()].filter((e) => e.def.id === 'bopper').length;
  ok(mirrored === CARD_BY_ID.boppers.count, `the host Overlord's Bopper Gang reaches the hero's screen (${mirrored})`);
  cheats.god = false;
}

// ---------------------------------------------------------------- Versus: a client Overlord leaves, the AI takes over
{
  const { A, B, flush } = pair();
  A.lobbyKind = 'versus';
  mpState(A)!.overlordPeer = 'peerB';
  A.lobby.push(entry('peerC', 'Third'));
  (A.host as any).clientIds = ['peerB', 'peerC'];
  A.hostStart();
  flush();
  if (A.mode === 'shop') for (const h of A.heroes) if (!h.left) A.heroAction(h, 'done', 0, 1);
  steps([A, B], 10, flush);
  (A.host as any).clientIds = ['peerC'];
  A.onClientLeft('peerB');
  steps([A], 5, flush);
  ok(A.versus?.overlord === -1 && !A.versus.winner, 'the Overlord left: the AI takes over and the match goes on');
}

// ---------------------------------------------------------------- Versus: the Overlord wipes the team
{
  const { A, B, flush, toB } = pair();
  A.lobbyKind = 'versus';
  mpState(A)!.overlordPeer = 'peerB';
  A.hostStart();
  flush();
  if (A.mode === 'shop') A.heroAction(A.hero, 'done', 0, 1);
  steps([A, B], 30, flush);
  const p = A.hero.player;
  A.hero.revivesLeft = 0;
  A.hero.petState.reviveUsed = true;
  p.invuln = 0;
  if (p.hurt(p.hp + 1, 0, 1)) A.onHeroDown(A.hero);
  steps([A, B], 20, flush);
  ok(A.versus?.winner === 'overlord' && B.versus?.winner === 'overlord', 'every hero down: the Overlord wins on both machines');
  steps([A, B], 120, flush);
  ok(!toB.some((m) => m.t === 'over'), 'no normal game over in Versus');
}

// ---------------------------------------------------------------- Versus solo vs the AI Overlord
{
  const C = new Game(new Input(canvas), 16 / 9, newRoot(), document.createElement('div'));
  cheats.god = true;
  C.versusSolo();
  C.versus!.aiT = 1e9; // the AI sits on its hands for now
  if (C.mode === 'shop') C.closeShop();
  for (let i = 0; i < 60 * 40; i++) C.update(1 / 60);
  ok(C.versus?.overlord === -1 && C.enemies.activeCount === 0, 'vs the AI: the director stays quiet (alive ' + C.enemies.activeCount + ')');
  C.versus!.aiT = 0;
  for (let i = 0; i < 60 * 40; i++) C.update(1 / 60);
  ok(C.enemies.activeCount > 5 && C.versus!.st.points < versusTuning.pointsMax, `...and the AI Overlord sends waves (alive ${C.enemies.activeCount}, purse ${C.versus!.st.points.toFixed(0)})`);
  cheats.god = false;
  C.leaveToTitle();
  ok(!C.versus, 'leaving clears the match');
}

// ---------------------------------------------------------------- local co-op
{
  const D = new Game(new Input(canvas), 16 / 9, newRoot(), document.createElement('div'));
  const fake: any[] = [];
  const src = () => fake;
  const pad = (i: number, axes: number[], down: number[] = []) => (fake[i] = { index: i, connected: true, axes, buttons: btn(down) });
  pad(0, [0, 0, 0, 0]);
  pad(1, [0, 0, 0, 0]);
  // The browser also reports these pads to the shared Input: player 1 is on the keyboard, so it must ignore them.
  browserPads = fake;
  D.localCoopStart(
    [
      { pad: KBM, hero: 'rookie', loadout: validLoadout(DEFAULT_LOADOUT), ready: true, row: 0 },
      { pad: 0, hero: 'bulwark', loadout: { primary: 'scatter', secondary: 'grenade', special: 'storm' }, ready: true, row: 0 },
      { pad: 1, hero: 'rookie', loadout: validLoadout(DEFAULT_LOADOUT), ready: true, row: 0 },
    ],
    'standard',
    src,
  );
  ok(D.heroes.length === 3 && D.role === 'solo' && D.coop, 'three local heroes, no network');
  ok(D.input.padIndex === -2, 'keyboard player 1: the shared Input reads no pad');
  ok(D.heroes[1].heroDef.id === 'bulwark' && D.heroes[1].loadoutPick.primary === 'scatter', "player 2's hero and loadout");
  ok(D.mode === 'shop' && D.screens.current === 'shop' && D.local === 0, 'the starting shop opens for player 1 first');
  D.heroAction(D.hero, 'done', 0, 1);
  D.update(1 / 60);
  ok(D.local === 1 && D.input.padIndex === 0 && D.screens.current === 'shop', 'then player 2 gets the shop, on pad 1');
  D.heroAction(D.heroes[1], 'done', 0, 1);
  D.update(1 / 60);
  ok(D.local === 2 && D.input.padIndex === 1, 'then player 3 on pad 2');
  D.heroAction(D.heroes[2], 'done', 0, 1);
  D.update(1 / 60);
  ok(D.mode === 'fight' && D.local === 0 && D.input.padIndex === -2, 'back to the fight: player 1 has the keyboard again');
  cheats.god = true;
  const x0 = D.heroes.map((h) => h.player.x);
  pad(0, [1, 0, 0, 0]);
  pad(1, [-1, 0, 0, 0]);
  for (let i = 0; i < 30; i++) D.update(1 / 60);
  ok(D.heroes[1].player.x > x0[1] + 1, `pad 1 moves player 2 right (${(D.heroes[1].player.x - x0[1]).toFixed(1)} m)`);
  ok(D.heroes[2].player.x < x0[2] - 1, `pad 2 moves player 3 left (${(D.heroes[2].player.x - x0[2]).toFixed(1)} m)`);
  ok(Math.abs(D.heroes[0].player.x - x0[0]) < 0.2, 'nobody touches the keyboard: player 1 stands still');
  const dashes = D.heroes[1].dashes;
  pad(0, [1, 0, 0, 0], [0]);
  D.update(1 / 60);
  pad(0, [1, 0, 0, 0]);
  for (let i = 0; i < 5; i++) D.update(1 / 60);
  ok(D.heroes[1].dashes === dashes + 1, "pad 1's A dashes player 2 (once)");
  pad(1, [0, 0, 1, 0]);
  for (let i = 0; i < 20; i++) D.update(1 / 60);
  ok(D.heroes[2].player.aim.x > 0.9 && D.heroes[2].ctx.firing, 'the right stick aims and fires for player 3');
  // The leash: player 2 walks far away and is held near the team.
  pad(0, [1, 0, 0, 0]);
  pad(1, [0, 0, 0, 0]);
  for (let i = 0; i < 400; i++) D.update(1 / 60);
  const c = { x: (D.heroes[0].player.x + D.heroes[2].player.x) / 2, z: (D.heroes[0].player.z + D.heroes[2].player.z) / 2 };
  const far = Math.hypot(D.heroes[1].player.x - c.x, D.heroes[1].player.z - c.z);
  ok(far <= 15.2, `the leash keeps player 2 near the team (${far.toFixed(1)} m)`);
  // Level-up cards go round: everyone picks in turn on their own device.
  pad(0, [0, 0, 0, 0]);
  for (const h of D.heroes) h.pendingLevels = 1;
  D.openLevelUp();
  D.update(1 / 60);
  ok(D.screens.current === 'levelup' && D.local === 0, 'level-up: player 1 picks first');
  D.heroAction(D.hero, 'pick', 0, 1);
  D.update(1 / 60);
  ok(D.screens.current === 'levelup' && D.local === 1 && D.input.padIndex === 0, "then player 2's cards, on pad 1");
  const lcTurn = (roots[roots.length - 1].querySelector('#lc-turn') as HTMLElement);
  D.render(1, 1 / 60);
  ok(!lcTurn.hidden && lcTurn.textContent!.includes('P2'), 'the turn tag names the player: ' + lcTurn.textContent);
  D.heroAction(D.heroes[1], 'pick', 0, 1);
  D.update(1 / 60);
  D.heroAction(D.heroes[2], 'pick', 0, 1);
  D.update(1 / 60);
  ok(D.mode === 'fight' && D.local === 0 && D.heroes.every((h) => !h.needsPick), 'everyone picked: back to the fight');
  // Panels for every player.
  D.render(1, 1 / 60);
  const panels = roots[roots.length - 1].querySelectorAll('#lc-hud .lc-p').length;
  ok(panels === 3, `a HUD panel per player (${panels})`);
  // A downed player is revived by a teammate, like online co-op.
  cheats.god = false;
  const p2 = D.heroes[1];
  p2.revivesLeft = 0;
  p2.petState.reviveUsed = true;
  p2.player.invuln = 0;
  if (p2.player.hurt(p2.player.hp + 1, 0, 1)) D.onHeroDown(p2);
  ok(p2.player.dead && D.mode === 'fight', 'one player down: the run goes on');
  D.heroes[0].player.teleport(p2.player.x + 1, p2.player.z);
  D.heroes[2].player.teleport(p2.player.x - 1, p2.player.z);
  cheats.god = true;
  // A team level-up can open the cards mid-revive: pick through them so the fight (and the revive) goes on.
  for (let i = 0; i < 60 * 8 && p2.player.dead; i++) {
    if (D.mode === 'levelup') for (const h of D.heroes) if (h.needsPick) D.heroAction(h, 'pick', 0, 1);
    D.update(1 / 60);
  }
  ok(!p2.player.dead, 'standing next to them revives them');
  cheats.god = false;
  D.leaveToTitle();
  ok(!D.localCoop && D.input.padIndex === -1 && D.heroes.length === 1, 'back at the title: one hero, the shared Input reads any pad again');
  browserPads = [];
}

// ---------------------------------------------------------------- the shared Input's pad choice
{
  const inp = new Input(canvas);
  browserPads = [
    { index: 0, connected: true, axes: [1, 0, 0, 0], buttons: btn() },
    { index: 1, connected: true, axes: [0, 1, 0, 0], buttons: btn() },
  ];
  inp.poll();
  ok(inp.move.x > 0.9, 'default: the first connected pad');
  inp.padIndex = 1;
  inp.poll();
  ok(inp.move.y > 0.9 && inp.move.x === 0, 'padIndex 1: only that pad');
  inp.padIndex = -2;
  inp.poll();
  ok(inp.move.x === 0 && inp.move.y === 0 && inp.device === 'pad', 'padIndex -2: no pad at all');
  browserPads = [];
}

// ---------------------------------------------------------------- weekly co-op online
{
  const { A, B, flush } = pair();
  A.lobbyKind = 'weekly';
  A.refreshLobby();
  flush();
  const xB = ((B.screens['els' as never] as any).online as HTMLElement).querySelector('.mp-x')?.textContent ?? '';
  ok(xB.includes('TEAM'), 'clients see the weekly team: ' + xB.trim());
  A.hostStart();
  flush();
  const w = weeklyChallenge();
  ok(A.runMode === 'weekly' && A.meta.week === w.week && A.seed === w.seed, 'the host plays this week\'s seed');
  ok(A.heroes.every((h) => h.heroDef.id === 'rookie' && h.loadoutPick.primary === 'buster'), 'everyone gets the weekly Rookie kit');
  steps([A, B], 10, flush);
  ok(B.runMode === 'weekly' && B.meta.week === w.week && B.meta.rules.join() === A.meta.rules.join(), 'the client has the same weekly rules');
  A.score = 12345;
  A.mode = 'dead';
  A.modeT = 2;
  A.gameOverShown = false;
  steps([A], 2, flush);
  flush();
  const best = localTeamBest(w.week);
  ok(!!best && best.members.join() === 'Host,Guest' && best.score >= 12345, 'the team best is kept on this PC: ' + JSON.stringify(best));
}

// ---------------------------------------------------------------- PUBLIC lobbies: heartbeat, browse, join, unlist
{
  const kv = new FakeKV();
  const call = workerFetch(worker, { SCORES: kv });
  (lobbyService as any).base = 'https://w';
  (lobbyService as any).fetchFn = call;
  const { A, B, flush } = pair();
  settings.lobbyPublic = true;
  A.lobbyKind = 'versus';
  A.refreshLobby();
  steps([A], 2, flush);
  await new Promise((r) => setTimeout(r, 30));
  let list = await lobbyService.list();
  ok(!!list && list.length === 1 && list[0].code === 'TESTA' && list[0].mode === 'versus' && list[0].players === 2, 'a PUBLIC lobby registers itself: ' + JSON.stringify(list));
  const writes = kv.writes;
  steps([A], 60, flush);
  ok(kv.writes === writes, 'no extra writes between heartbeats');
  // Browse: the list shows it; picking a row joins with its code.
  const C = new Game(new Input(canvas), 16 / 9, newRoot(), document.createElement('div'));
  const joined: string[] = [];
  (C as any).joinGame = async (_n: string, code: string) => void joined.push(code);
  const st = mpState(C)!;
  st.browser.open();
  await new Promise((r) => setTimeout(r, 30));
  const row = roots[roots.length - 1].querySelector<HTMLElement>('#scr-mpbrowse [data-act=lb-join]');
  ok(!!row && row.textContent!.includes('VERSUS') && C.screens.current === 'mpbrowse', 'BROWSE GAMES lists it: ' + row?.textContent?.replace(/\s+/g, ' '));
  row?.click();
  ok(joined[0] === 'TESTA', 'clicking a public game joins it by its code');
  // The game starts: the listing goes away.
  mpState(A)!.overlordPeer = 'AI';
  A.hostStart();
  flush();
  steps([A], 2, flush);
  await new Promise((r) => setTimeout(r, 30));
  list = await lobbyService.list();
  ok(!!list && list.length === 0, 'starting the game unlists it');
  ok(A.versus?.overlord === -1 && A.heroes.every((h) => !h.left), 'an AI Overlord online: everyone in the lobby is a hero');
  settings.lobbyPublic = false;
  (lobbyService as any).base = '';
}

// Enemy defs used by the Overlord cards exist.
ok(Object.values(CARD_BY_ID).every((c) => !c.enemy || !!ENEMIES[c.enemy]) && Object.values(CARD_BY_ID).every((c) => (c.pool ?? []).every((id) => !!ENEMIES[id])) && !!bossForStage(1), 'every Overlord card points at a real enemy');
ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 5).join('\n') : ''));
process.exit(process.exitCode ?? 0);
