/**
 * MP lane, pure parts and worker routes: Overlord command validation, rate
 * limits and placement, the AI Overlord, the local co-op join model and pad
 * mapping, PadInput, the lobby directory route (fake KV, expiry, tokens,
 * filters) and the team board route, plus the game's clients for both routes
 * talking to the worker in-process.
 */
import { ok } from './check';
import { FakeKV, workerFetch } from './fakeKv';
import { Rng } from '../src/core/rng';
import { CARD_BY_ID, OVERLORD_CARDS, OverlordState, aiOverlordPick, cardBlock, edgePoint, markersFor, packOverlord, unpackOverlord, validateCommand, versusTuning, type VersusWorld } from '../src/game/versus';
import { KBM, LocalLobby, leashPoint, localCoopTuning, padMap, teamZoom } from '../src/game/localCoop';
import { PadInput, padEdges } from '../src/core/padInput';
import { LobbyService, regionOf, type PublicLobby } from '../src/net/lobbies';
import { TeamBoardService, cleanTeam } from '../src/net/teamboard';
import { loadoutOptions } from '../src/data/loadout';
// @ts-ignore: plain JS worker module
import worker from '../server/leaderboard/worker.js';
// @ts-ignore
import { LOBBY_TTL } from '../server/leaderboard/lobbies.js';

(globalThis as any).__APP_VERSION__ = '9.9.9';

// ---------------------------------------------------------------- Versus: validation
const wall = { x: 20, z: 0, r: 3 };
const world = (o: Partial<VersusWorld> = {}): VersusWorld => {
  const walkable = (x: number, z: number) => Math.abs(x) < 54 && Math.abs(z) < 54 && Math.hypot(x - wall.x, z - wall.z) > wall.r;
  return { time: 200, duration: 240, half: 55, heroes: [{ x: 0, z: 0 }], markers: markersFor(55, walkable), alive: 0, bossOut: false, walkable, ...o };
};
{
  const w = world();
  ok(w.markers.length === 6, `six beacons (${w.markers.length})`);
  ok(w.markers.every((m) => w.walkable(m.x, m.z)), 'beacons stand on walkable ground');
  ok(w.markers.every((m) => Math.hypot(m.x - wall.x, m.z - wall.z) > wall.r), 'a beacon moves off a wall');
  const st = new OverlordState();
  st.points = 500;
  ok(!validateCommand(st, { c: 'nope', x: 0, z: 0 }, w, 10).ok, 'unknown card refused');
  ok(!validateCommand(st, { c: 'swarm', x: NaN, z: 0 }, w, 10).ok, 'bad coordinates refused');
  const early = validateCommand(new OverlordState(), { c: 'elite', x: 50, z: 0 }, world({ time: 10 }), 10);
  ok(!early.ok && early.reason === 'locked', 'cards stay locked until their time: ' + (early.ok ? '' : early.reason));
  const poor = new OverlordState();
  poor.points = 5;
  const p = validateCommand(poor, { c: 'swarm', x: 50, z: 0 }, w, 10);
  ok(!p.ok && p.reason === 'not enough points', 'needs the points');
  // A click near a beacon drops there; elsewhere at the field edge in that direction.
  const m = w.markers[0];
  const r1 = validateCommand(st, { c: 'swarm', x: m.x + 2, z: m.z - 1 }, w, 10);
  ok(r1.ok && r1.marker === 0 && r1.spot.x === m.x && r1.spot.z === m.z, 'click by a beacon drops at the beacon');
  const r2 = validateCommand(st, { c: 'swarm', x: 3, z: 1 }, w, 20);
  ok(r2.ok && r2.marker < 0 && Math.max(Math.abs(r2.spot.x), Math.abs(r2.spot.z)) > 45, 'other clicks drop at the field edge');
  ok(r2.ok && Math.sign(r2.spot.x) === 1, 'the edge drop is in the clicked direction');
  // Spend: points, cooldown, rate limit.
  if (r2.ok) st.spend(r2.card, 20);
  ok(st.points === 494 && st.cooldown('swarm') === CARD_BY_ID.swarm.cd, 'spending takes points and starts the cooldown');
  const cd = validateCommand(st, { c: 'swarm', x: 40, z: 0 }, w, 21);
  ok(!cd.ok && cd.reason === 'cooldown', 'cooldown refuses: ' + (cd.ok ? '' : cd.reason));
  const fast = validateCommand(st, { c: 'boppers', x: 40, z: 0 }, w, 20.1);
  ok(!fast.ok && fast.reason === 'too fast', 'orders closer than minGap are refused');
  const burst = new OverlordState();
  burst.points = 1000;
  let refused = '';
  for (let i = 0; i < versusTuning.burstMax + 1; i++) {
    const r = validateCommand(burst, { c: OVERLORD_CARDS[i % 8].id, x: 40, z: (i % 3) * 10 }, w, 30 + i * 0.5);
    if (r.ok) burst.spend(r.card, 30 + i * 0.5);
    else refused = r.reason;
  }
  ok(refused === 'too fast', `at most ${versusTuning.burstMax} orders per ${versusTuning.burstWindow} s (${refused})`);
  // Placement rules.
  const nearHero = world({ heroes: [{ x: m.x + 1, z: m.z }] });
  const blk = validateCommand(new OverlordState(), { c: 'swarm', x: m.x, z: m.z }, nearHero, 10);
  ok(!blk.ok && blk.reason.includes('beacon'), 'a beacon with a hero next to it is closed');
  const heroAtEdge = world({ heroes: [{ x: 50, z: 0 }] });
  const e = edgePoint(heroAtEdge, 30, 0);
  ok(!!e && Math.hypot(e.x - 50, e.z) >= versusTuning.edgeHeroDist, 'edge drops slide away from a hero standing there');
  const hz = validateCommand(st, { c: 'meteor', x: 300, z: -2 }, w, 40);
  ok(hz.ok && hz.spot.x <= 54 && hz.spot.z === -2, 'hazards land where clicked (clamped to the field)');
  const full = validateCommand(st, { c: 'boppers', x: 40, z: 0 }, world({ alive: versusTuning.maxAlive }), 50);
  ok(!full.ok && full.reason === 'field is full', 'groups stop at maxAlive');
  const b1 = new OverlordState();
  b1.points = 200;
  const bossOk = validateCommand(b1, { c: 'boss', x: 40, z: 0 }, w, 60);
  ok(bossOk.ok, 'the boss card is playable after its unlock');
  if (bossOk.ok) b1.spend(bossOk.card, 60);
  const again = validateCommand(b1, { c: 'boss', x: 40, z: 0 }, w, 70);
  ok(!again.ok && b1.bossUsed, 'the boss can only be sent once');
  ok(cardBlock(new OverlordState(), CARD_BY_ID.boss, world({ bossOut: true })) === 'boss already out', 'no boss card once the timer sent it');
  // Purse.
  const pu = new OverlordState();
  pu.points = 0;
  pu.cd.swarm = 1;
  pu.tick(1, 0, 240);
  ok(Math.abs(pu.points - versusTuning.pointsPerSec) < 1e-9 && pu.cd.swarm === 0, 'points accrue, cooldowns run down');
  pu.tick(1, 240, 240);
  ok(Math.abs(pu.points - versusTuning.pointsPerSec * (2 + versusTuning.pointsRamp)) < 1e-9, 'the rate ramps up over the stage');
  pu.tick(1000, 240, 240);
  ok(pu.points === versusTuning.pointsMax, 'points are capped');
  // Snapshot field.
  const s2 = new OverlordState();
  unpackOverlord(packOverlord(st, 2, 'heroes'), s2);
  ok(Math.floor(s2.points) === Math.floor(st.points) && Math.abs(s2.cooldown('swarm') - st.cooldown('swarm')) < 0.11, 'purse and cooldowns survive the snapshot');
  ok(unpackOverlord(packOverlord(st, 2, 'overlord'), s2)?.winner === 'overlord' && unpackOverlord(packOverlord(st, -1, ''), s2)?.overlord === -1, 'overlord index and winner travel');
}

// ---------------------------------------------------------------- Versus: the AI Overlord
{
  const rng = new Rng(42);
  const st = new OverlordState();
  let issued = 0;
  let invalid = 0;
  let boss = false;
  let saved = 0;
  const used = new Set<string>();
  let alive = 0;
  for (let t = 0; t < 240; t += versusTuning.aiThink) {
    st.tick(versusTuning.aiThink, t, 240);
    const w = world({ time: t, heroes: [{ x: Math.cos(t / 9) * 20, z: Math.sin(t / 9) * 20 }, { x: 5, z: -30 }], alive, bossOut: boss });
    const cmd = aiOverlordPick(st, w, rng);
    if (!cmd) {
      saved++;
      continue;
    }
    const r = validateCommand(st, cmd, w, t);
    if (!r.ok) {
      invalid++;
      continue;
    }
    st.spend(r.card, t);
    used.add(r.card.id);
    issued++;
    alive = Math.min(200, alive + (r.card.count ?? 1));
    if (r.card.kind === 'boss') boss = true;
  }
  ok(issued > 30, `the AI keeps the pressure on (${issued} orders in a stage)`);
  ok(invalid <= 2, `the AI's orders pass the host's checks (${invalid} refused)`);
  ok(used.size >= 7, `it plays most cards (${[...used].join(',')})`);
  ok(boss, 'it sends the boss once it can');
  ok(saved > 0, `it sometimes waits to save up (${saved})`);
  ok(aiOverlordPick(new OverlordState(), world({ heroes: [] }), rng) === null, 'no heroes: no orders');
}

// ---------------------------------------------------------------- local co-op: join model and pads
{
  const L = new LocalLobby(() => ['rookie', 'bulwark', 'ace'], () => undefined);
  ok(L.join(0) === 0 && L.join(2) === 1, 'pads join in order');
  ok(L.join(0) === 0 && L.slots.length === 2, 'joining twice is a no-op');
  ok(L.join(KBM) === 0 && L.slots[1].pad === 0 && L.slots[2].pad === 2, 'the keyboard always takes player 1');
  ok(L.join(3) === 3 && L.join(4) === -1, 'four players at most');
  L.leave(3);
  L.nav(0, 0, 1);
  ok(L.slots[1].hero === 'bulwark', 'left/right cycles the hero');
  L.nav(0, 1, 1);
  const opts = loadoutOptions('primary');
  ok(L.slots[1].row === 1 && L.slots[1].loadout.primary === opts[(opts.indexOf('buster') + 1) % opts.length], 'down then right changes the left click');
  L.nav(0, -2, 0);
  ok(L.slots[1].row === 3, 'rows wrap');
  ok(!L.canStart, 'nobody ready: no start');
  for (const s of L.slots) L.toggleReady(s.pad);
  ok(L.canStart, 'everyone ready: start');
  const before = L.slots[1].hero;
  L.nav(0, 0, 1);
  ok(L.slots[1].hero === before, 'a ready player is locked in');
  const solo = new LocalLobby();
  solo.join(KBM);
  solo.toggleReady(KBM);
  ok(!solo.canStart, 'one player is not local co-op');
  const limited = new LocalLobby(() => ['rookie'], () => ['buster', 'scatter', 'charge', 'bomb']);
  limited.join(1);
  limited.nav(1, 1, 1);
  ok(limited.slots[0].loadout.primary === 'scatter', 'only unlocked loadout items are offered');

  const m1 = padMap([{ pad: KBM }, { pad: 0 }, { pad: 1 }]);
  ok(m1.mainPad === -2 && m1.pads.join() === ',0,1', 'keyboard player 1: the shared Input reads no pad, pads 0 and 1 drive heroes 2 and 3');
  const m2 = padMap([{ pad: 2 }, { pad: 0 }]);
  ok(m2.mainPad === 2 && m2.pads[1] === 0 && m2.pads[0] === null, 'pad player 1: the shared Input reads only that pad');

  // PadInput: sticks, deadzones, the d-pad, press edges.
  const btn = (n: number, down: number[]) => Array.from({ length: n }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0, touched: false }));
  let pads: any[] = [];
  const src = () => pads;
  const pi = new PadInput(1, src);
  pads = [null, { index: 1, connected: true, axes: [0.9, 0.1, 0, -0.9], buttons: btn(17, [0]) }];
  pi.poll();
  ok(pi.move.x > 0.8 && pi.move.y > 0 && pi.move.y < 0.15 && pi.padAim.x === 0 && pi.padAim.y === -1, 'stick move, aim deadzone and normalised aim');
  ok(pi.padButtonPressed(0) && pi.padButton(0), 'A press is an edge');
  pi.poll();
  ok(!pi.padButtonPressed(0) && pi.padButton(0), '...only on the first poll it is down');
  pads[1] = { index: 1, connected: true, axes: [0.1, 0, 0, 0], buttons: btn(17, [14, 12]) };
  pi.poll();
  ok(pi.move.x < 0 && pi.move.y < 0, 'the d-pad moves when the stick is idle');
  ok(!pi.keyPressed() && !pi.mouseDown() && !pi.actionPressed() && pi.device === 'pad', 'keys and mouse read idle');
  pads[1] = null;
  pi.poll();
  ok(!pi.connected && pi.move.x === 0, 'an unplugged pad reads idle');
  pi.rumble(1, 1, 50);
  const prev = new Map<number, boolean[]>();
  pads = [{ index: 0, connected: true, axes: [0, 0], buttons: btn(17, [0]) }];
  padEdges(src, prev);
  ok(padEdges(src, prev)[0].pressed.length === 0, 'join-screen edges: a held button is not a new press');

  ok(teamZoom(0) === 1 && teamZoom(100) === localCoopTuning.zoomMax && teamZoom(20) > 1, 'the shared camera zooms out with the team spread');
  const lp = leashPoint(40, 0, 0, 0);
  ok(lp.held && Math.abs(lp.x - localCoopTuning.leash) < 1e-9, 'the leash holds a hero at its length');
  ok(!leashPoint(3, 4, 0, 0).held, 'inside the leash nothing changes');
}

// ---------------------------------------------------------------- regions
{
  const cases: [string, string, string][] = [
    ['Europe/Berlin', '', 'EU'],
    ['America/New_York', '', 'NA'],
    ['America/Sao_Paulo', '', 'SA'],
    ['America/Argentina/Buenos_Aires', '', 'SA'],
    ['Asia/Tokyo', '', 'AS'],
    ['Asia/Dubai', '', 'ME'],
    ['Australia/Sydney', '', 'OC'],
    ['Africa/Lagos', '', 'AF'],
    ['', 'en-US', 'NA'],
    ['', 'de-DE', 'EU'],
  ];
  ok(cases.every(([tz, loc, want]) => regionOf(tz, loc) === want), 'regions from time zones: ' + cases.map(([tz, loc]) => regionOf(tz, loc)).join(','));
}

// ---------------------------------------------------------------- lobby directory route
const kv = new FakeKV();
let now = 1_000_000;
kv.clock = () => now;
const realNow = Date.now;
Date.now = () => now;
const env = { SCORES: kv };
let ip = '1.1.1.1';
const call = workerFetch(worker, env, () => ip);
const post = (path: string, body: unknown) => call(`https://w${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = async (path: string) => (await call(`https://w${path}`)).json();
const lob = (o: Partial<PublicLobby> = {}) => ({ code: 'ABCDE', token: 'tok12345abc', name: 'Mansour', players: 1, max: 4, mode: 'coop', difficulty: 'normal', region: 'EU', version: '9.9.9', ...o });
{
  ok((await post('/lobbies', lob())).status === 200, 'host registers a public lobby');
  ok((await post('/lobbies', lob({ code: 'FGHJK', token: 'other1234x', mode: 'versus', region: 'NA', difficulty: 'hard', players: 2, version: '1.0.0' }))).status === 200, 'a second lobby');
  let r = await get('/lobbies');
  ok(r.lobbies.length === 2 && !('token' in r.lobbies[0]), 'GET lists open lobbies without tokens');
  r = await get('/lobbies?version=9.9.9');
  ok(r.lobbies[0].code === 'ABCDE', 'same-version lobbies come first');
  ok((await get('/lobbies?region=NA')).lobbies.map((l: any) => l.code).join() === 'FGHJK', 'region filter');
  ok((await get('/lobbies?difficulty=normal')).lobbies.map((l: any) => l.code).join() === 'ABCDE', 'difficulty filter');
  ok((await get('/lobbies?mode=versus')).lobbies.map((l: any) => l.code).join() === 'FGHJK', 'game type filter');
  ok((await post('/lobbies', lob({ token: 'thief99999' }))).status === 409, 'another token cannot take a listed code');
  ok((await post('/lobbies', lob({ players: 2 }))).status === 429, 'heartbeats faster than 8 s are refused');
  now += 9000;
  ok((await post('/lobbies', lob({ players: 2 }))).status === 200, 'heartbeat updates the lobby');
  ok((await get('/lobbies?region=EU')).lobbies[0].players === 2, '...with the new player count');
  for (const bad of [lob({ code: 'abc' }), lob({ token: 'x' }), lob({ mode: 'chess' }), lob({ difficulty: 'ultra' }), lob({ region: 'MARS' }), lob({ players: 9 }), lob({ max: 1 })]) {
    if ((await post('/lobbies', bad)).status !== 400) ok(false, 'bad lobby accepted: ' + JSON.stringify(bad));
  }
  ok(true, 'malformed lobbies are refused');
  now += 9000;
  await post('/lobbies', lob({ players: 4 }));
  ok(!(await get('/lobbies')).lobbies.some((l: any) => l.code === 'ABCDE'), 'a full lobby is not listed');
  // Expiry: no heartbeat for longer than the TTL.
  now += (LOBBY_TTL + 1) * 1000;
  ok((await get('/lobbies')).lobbies.length === 0, `lobbies without a heartbeat for ${LOBBY_TTL} s drop off`);
  ok((await post('/lobbies', lob({ token: 'newhost1234' }))).status === 200, 'an expired code can be hosted again');
  ok((await post('/lobbies', { code: 'ABCDE', token: 'newhost1234', close: true })).status === 200 && (await get('/lobbies')).lobbies.length === 0, 'closing unlists it');
  // New lobbies per IP.
  ip = '9.9.9.9';
  const codes = ['QWERT', 'YUPAS', 'DFGHJ', 'KLZXC', 'VBNMQ', 'WERTY', 'UPASD'];
  const res = [];
  for (const c of codes) res.push((await post('/lobbies', lob({ code: c, token: 'iptest1234' }))).status);
  ok(res.slice(0, 6).every((s) => s === 200) && res[6] === 429, 'one IP can open 6 new lobbies per 10 minutes: ' + res.join(','));
  ok((await call('https://w/lobbies', { method: 'PUT' })).status === 405, 'other methods are refused');

  // The game's client against the worker.
  ip = '5.5.5.5';
  now += 700_000;
  const svc = new LobbyService('https://w', call);
  ok(svc.enabled && !new LobbyService('').enabled, 'service is on only with a base URL');
  ok((await new LobbyService('').list()) === null, 'offline list is null (invite codes only)');
  ok((await svc.register({ code: 'MNBVC', name: 'Lina', players: 1, max: 4, mode: 'weekly', difficulty: 'easy', region: 'OC', version: '9.9.9' }, 'clienttok12')) === '', 'client registers');
  const list = await svc.list({ region: 'OC' });
  ok(!!list && list.length === 1 && list[0].mode === 'weekly' && list[0].name === 'Lina', 'client lists with a filter');
  ok((await svc.register({ code: 'MNBVC', name: 'Lina', players: 1, max: 4, mode: 'weekly', difficulty: 'easy', region: 'OC', version: '9.9.9' }, 'clienttok12')) === 'slow down', 'client sees refusals');
  ok((await svc.close('MNBVC', 'clienttok12')) === '' && (await svc.list({ region: 'OC' }))!.length === 0, 'client unlists');
}

// ---------------------------------------------------------------- team board route
{
  let n = 0;
  ip = '7.0.0.0';
  const tpost = (body: unknown) => {
    ip = `7.0.0.${++n}`; // the board allows one post per IP per minute
    return post('/teamboard', body);
  };
  const run = (o: Record<string, unknown> = {}) => ({ week: '2026-W43', team: 'Bolt Brigade', members: ['Mansour', 'Lina'], score: 50_000, stage: 3, kills: 900, time: 900, version: '9.9.9', ...o });
  let r = await (await tpost(run())).json();
  ok(r.rank === 1, 'a team posts its run');
  r = await (await tpost(run({ score: 20_000 }))).json();
  ok(r.rank === 1 && r.best === 50_000, 'a worse run keeps the best');
  await tpost(run({ score: 80_000, stage: 4 }));
  await tpost(run({ team: 'Swarm Busters', members: ['Omar', 'Sky', 'Rin'], score: 60_000 }));
  await tpost(run({ members: ['Ana', 'Ben'], score: 10_000 })); // same name, other people: their own entry
  const top = (await get('/teamboard?week=2026-W43')).teams;
  ok(top.length === 3 && top[0].score === 80_000 && top[0].stage === 4, 'one entry per team per week, best first: ' + top.map((t: any) => t.score).join(','));
  ok(top.filter((t: any) => t.team === 'Bolt Brigade').length === 2, 'two groups sharing a team name stay apart');
  ok(!('id' in top[0]) && !('kills' in top[0]), 'GET shows name, members, score, stage, date');
  ok((await get('/teamboard?week=2026-W44')).teams.length === 0, 'weeks have their own board');
  ok((await tpost(run({ members: ['Solo'] }))).status === 400, 'a team needs 2+ players');
  ok((await tpost(run({ week: '2026-43' }))).status === 400 && (await call('https://w/teamboard?week=bad')).status === 400, 'bad week ids are refused');
  ok((await tpost(run({ score: 1e12 }))).status === 400, 'implausible scores are refused');
  ip = '8.8.8.8';
  await post('/teamboard', run({ score: 5 }));
  ok((await post('/teamboard', run({ score: 6 }))).status === 429, 'one post per IP per minute');
  ok(cleanTeam('<b>Bolt</b> Brigade!!') === 'bBoltb Brigade' && cleanTeam('') === 'Team', 'team names are cleaned');
  ip = '6.6.6.6';
  const tb = new TeamBoardService('https://w', call);
  ok((await tb.submit('2026-W45', { team: 'Pixel Pals', members: ['A', 'B'], score: 1000, stage: 1, kills: 50, time: 100 })) === 1, 'client submits a team run');
  const t2 = await tb.top('2026-W45');
  ok(!!t2 && t2[0].team === 'Pixel Pals' && t2[0].members.join() === 'A,B', 'client reads the board');
  ok((await new TeamBoardService('').top('2026-W45')) === null, 'offline: no global board');
}
ok((await call('https://w/scores?board=standard-normal')).status === 200, 'the scores route still answers next to the new routes');
Date.now = realNow;
