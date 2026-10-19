/**
 * pvp2 lane: PvP formats, rounds, ring, arenas, bots, and a whole match online
 * in one process (host + clients, messages passed by hand like
 * tests/coop2Coop.test.ts):
 * - pure rules: teams, round and match results, the ring, spawns, damage pacing
 * - every PvP arena builds the same way on every machine, spawns and pads are clear
 * - 2v2 best of 3 (host + 3 clients): stage builds -> duel, the same arena and
 *   spawns on every screen, friendly fire off, round wins, scoreboard, final
 * - free-for-all with 8 (host + 2 clients + 5 bots): bots fight, the ring
 *   collapses, someone wins
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
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
// Timers (the match-end return to the title) run right away in this test.
(globalThis as any).setTimeout = (dom.window as any).setTimeout = (f: () => void) => (pendingTimers.push(f), 0);
const pendingTimers: (() => void)[] = [];

const P = await import('../src/game/pvp');
const { PVP_ARENAS } = await import('../src/data/pvpArenas');
const { createFieldArena } = await import('../src/world/fieldArena');
const { biomeByKey } = await import('../src/data/biomes');
const { StaticBoxGrid } = await import('../src/core/spatialHash');

// ------------------------------------------------------------------ pure rules
{
  const T = P.pvpTuning;
  ok(P.teamsFor(4, 'teams').join() === '0,1,0,1' && P.teamsFor(3, 'ffa').join() === '0,1,2', 'teams alternate in lobby order; free-for-all is everyone alone');
  ok(!P.roundState([0, 1], [0, 1, 0, 1]).over, 'two teams standing: the round goes on');
  const r1 = P.roundState([0, 2], [0, 1, 0, 1]);
  ok(r1.over && r1.team === 0, 'only team A standing: team A takes the round');
  const r2 = P.roundState([], [0, 1]);
  ok(r2.over && r2.team === -1, 'nobody standing: a draw');
  ok(!P.matchState([1, 0], { rounds: 3 }, 1).over, 'best of 3: one win is not enough');
  const m = P.matchState([2, 1], { rounds: 3 }, 3);
  ok(m.over && m.winner === 0, 'best of 3: first to 2 takes the match');
  ok(!P.matchState([0, 0], { rounds: 3 }, 2).over, 'draws are replayed...');
  const capped = P.matchState([1, 1], { rounds: 3 }, T.maxRounds);
  ok(capped.over && capped.winner === -1, `...up to ${T.maxRounds} rounds, then a tie is a draw`);
  const one = P.matchState([0, 1, 0], { rounds: 1 }, 1);
  ok(one.over && one.winner === 1, 'one round: the round winner takes the match');
  ok(P.matchState([0, 0], { rounds: 1 }, 1).over && P.matchState([0, 0], { rounds: 1 }, 1).winner === -1, 'one round, nobody standing: a draw');
  ok(P.finalRound([1, 1], { rounds: 3 }, 2) && !P.finalRound([1, 0], { rounds: 3 }, 1), 'the final round is announced when both sides are a win away');
  // The ring.
  const S = 30;
  ok(P.zoneRadius(0, S) === S && P.zoneRadius(T.zoneDelay, S) === S, 'the ring waits first');
  let prev = S;
  let mono = true;
  for (let t = 0; t < 400; t += 0.5) {
    const z = P.zoneRadius(t, S);
    if (z > prev + 1e-9) mono = false;
    prev = z;
  }
  ok(mono && P.zoneRadius(1000, S) === 0, 'it only ever closes, and collapses to nothing (every round ends)');
  const sd = P.suddenDeathAt(S);
  ok(Math.abs(P.zoneRadius(sd - 1, S) - T.zoneMin) < 1e-9 && P.zoneRadius(sd + 4, S) < T.zoneMin, `it holds at ${T.zoneMin} m until sudden death (${sd.toFixed(0)} s), then collapses`);
  ok(P.zoneDpsAt(sd + 20, S) > P.zoneDpsAt(10, S), 'sudden death burns harder');
  ok(P.zoneStartFor(30, 2) === 30 && P.zoneStartFor(30, 8) === Math.min(T.zoneCap, 30 + 6 * T.zonePerPlayer), 'bigger free-for-alls start with a wider ring');
  // Arenas per round.
  const ids = ['a', 'b', 'c', 'd'];
  ok(P.arenaForRound({ arena: 'c' }, ids, 5, 2) === 'c', "the host's arena pick holds every round");
  const rot = [1, 2, 3, 4].map((r) => P.arenaForRound({ arena: 'rotate' }, ids, 7, r));
  ok(new Set(rot).size === 4, `rotate: a new arena each round (${rot.join(',')})`);
  // Spawns.
  const tsp = P.spawnPoints([0, 1, 0, 1], 'teams', 20);
  ok(tsp[0].x < 0 && tsp[2].x < 0 && tsp[1].x > 0 && tsp[3].x > 0, 'teams spawn on opposite sides');
  ok(Math.hypot(tsp[0].x - tsp[2].x, tsp[0].z - tsp[2].z) > 4, 'teammates side by side');
  const fsp = P.spawnPoints(P.teamsFor(8, 'ffa'), 'ffa', 20);
  let minD = Infinity;
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) minD = Math.min(minD, Math.hypot(fsp[i].x - fsp[j].x, fsp[i].z - fsp[j].z));
  ok(minD > 14, `8 free-for-all spawns spread out (closest ${minD.toFixed(1)} m)`);
  ok(fsp.every((s) => Math.abs(Math.hypot(s.ax, s.az) - 1) < 1e-6 && s.ax * s.x + s.az * s.z < 0), 'everyone starts facing the middle');
  // Damage pacing.
  ok(P.pvpLanding(1000, 0, 100) === 100 * T.maxDps * T.landEvery, `a burst lands as at most ${(T.maxDps * T.landEvery * 100).toFixed(1)}% life per hit`);
  ok(Math.abs(P.pvpLanding(5, 5, 100) - 5 / (1 + T.armorPct * 5)) < 1e-9, 'armor shrinks duel hits by a share, not a flat amount');
  ok(P.pvpFriendly([0, 1, 0, 1], 2, 0) && !P.pvpFriendly([0, 1, 0, 1], 1, 0) && P.pvpFriendly([0, 1], 0, 0) && !P.pvpFriendly(null, -1, 0), 'friendly stand-ins: your own and your teammates\'');
  const cr = P.cleanRules({ format: 'teams', rounds: 1, arena: 'nope' }, ids);
  ok(cr.format === 'teams' && cr.rounds === 1 && cr.arena === 'rotate', 'rules from the wire are cleaned');
  ok(P.cleanRules(null, ids).format === 'ffa' && P.cleanRules(null, ids).rounds === 3, 'default: free-for-all, best of 3');
}

// ------------------------------------------------------------------ arenas
{
  ok(PVP_ARENAS.length === 4 && new Set(PVP_ARENAS.map((a) => a.biome)).size === 4, '4 PvP arenas, each in its own biome style');
  for (const a of PVP_ARENAS) {
    const A1 = createFieldArena(11, biomeByKey(a.biome), { layout: a.build });
    const A2 = createFieldArena(99, biomeByKey(a.biome), { layout: a.build });
    const key = (x: typeof A1) => x.colliders.map((c) => [c.minX, c.minZ, c.maxX, c.maxZ].map((v) => v.toFixed(2)).join(':')).join('|');
    ok(key(A1) === key(A2) && A1.hazards.length === A2.hazards.length && A1.pads.length === A2.pads.length, `${a.name}: the same cover, hazards and pads from any seed`);
    ok(A1.colliders.length > 15 && A1.chests.length === 0 && A1.turrets.length === 0 && A1.conveyors.length === 0, `${a.name}: authored cover only (${A1.colliders.length} colliders), no chests/turrets/belts`);
    const grid = new StaticBoxGrid(A1.colliders);
    for (const n of [2, 4, 8]) {
      for (const f of ['ffa', 'teams'] as const) {
        const sp = P.spawnPoints(P.teamsFor(n, f), f, a.spawnR + Math.max(0, n - 4) * 1.5);
        const bad = sp.filter((s) => grid.hitCircle(s.x, s.z, 0.9)).length;
        ok(bad <= 1, `${a.name}: ${n} players ${f}: spawns clear of cover (${bad} need a nudge)`);
        ok(sp.every((s) => Math.hypot(s.x, s.z) < P.zoneStartFor(a.zone, n) - 4), `${a.name}: ${n} ${f}: spawns well inside the ring`);
      }
    }
    ok(A1.pads.every((p) => !grid.hitCircle(p.tx, p.tz, 0.7) && !grid.hitCircle(p.x, p.z, 0.7)), `${a.name}: jump pads and their landings are clear (${A1.pads.length})`);
    ok(!grid.hitCircle(0, 0, 0.5) || a.id === 'crucible', `${a.name}: the middle is open (the Crucible has its obsidian pillar)`);
  }
}

// ------------------------------------------------------------------ online match: 2v2, best of 3
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const P2 = await import('../src/game/systems/pvp2');
settings.deathReplay = false;
settings.bossIntro = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
type G = InstanceType<typeof Game>;

function net(A: G) {
  const peers = new Map<string, G>();
  const q: [G, any, string][] = [];
  (A as any).role = 'host';
  (A as any).host = {
    code: 'PVP22',
    max: 3,
    clientIds: [] as string[],
    send: (id: string, m: any) => {
      const g = peers.get(id);
      if (g) q.push([g, m, '']);
    },
    broadcast: (m: any) => {
      for (const g of new Set(peers.values())) q.push([g, m, '']);
    },
    close() {},
  };
  const connect = (g: G, id: string, name: string) => {
    peers.set(id, g);
    (g as any).role = 'client';
    (g as any).client = { send: (m: any) => q.push([A, m, id]), close() {} };
    g.netName = name;
    A.lobby.push({ peerId: id, name, unlocked: [], skin: 'classic', pet: 'none', hero: 'rookie', loadout: { primary: 'buster', secondary: 'charge', special: 'bomb' } });
  };
  const flush = () => {
    for (let guard = 0; q.length && guard < 20000; guard++) {
      const [g, m, from] = q.shift()!;
      if (g === A) A.onHostMessage(from, structuredClone(m));
      else if ([...peers.values()].includes(g)) g.onClientMessage(structuredClone(m));
    }
  };
  const clients = () => [...new Set(peers.values())];
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      A.update(1 / 60);
      flush();
      for (const c of clients()) {
        c.update(1 / 60);
        flush();
      }
      if (i % 10 === 0) {
        A.render(1, 1 / 60);
        for (const c of clients()) c.render(1, 1 / 60);
      }
    }
  };
  return { connect, flush, step, clients, peers };
}

{
  const A = mk();
  const N = net(A);
  A.netName = 'Host';
  A.lobby = [{ peerId: '', name: 'Host', unlocked: [], skin: 'classic', pet: 'none', hero: 'rookie', loadout: A.hero.loadoutPick }];
  const C = [mk(), mk(), mk()];
  C.forEach((c, i) => N.connect(c, `peer${i}`, `Guest${i + 1}`));
  A.lobbyKind = 'pvp';
  P2.setPvpRules(A, { format: 'teams', rounds: 3, arena: 'rotate' });
  A.hostStart();
  N.flush();
  ok(!!A.pvp && C.every((c) => c.pvp?.phase === 'stage' && c.pvp.rules.format === 'teams'), 'PVP: everyone starts their own stage with the 2-team rules');
  N.step(20);
  // Skip the stages: everyone hands in the build they have.
  for (const c of C) c.pvpStageDone();
  N.flush();
  ok(A.pvp!.phase === 'stage', 'the duel waits for the host too');
  A.pvpStageDone();
  N.flush();
  ok(A.pvp!.phase === 'duel' && A.heroes.length === 4, 'all builds in: the duel starts with 4 heroes');
  ok(A.pvp!.teams.join() === '0,1,0,1', 'two teams, alternating');
  ok(C.every((c) => c.pvp?.phase === 'duel' && c.role === 'client' && c.heroes.length === 4), 'clients are in the duel');
  const arena0 = A.pvp!.arena;
  const key = (g: G) => g.arena.colliders.length + ':' + g.arena.hazards.length;
  ok(C.every((c) => key(c) === key(A)), `every screen built the same arena (${arena0}: ${key(A)})`);
  ok(C.every((c, i) => Math.hypot(c.player.x - A.heroes[i + 1].player.x, c.player.z - A.heroes[i + 1].player.z) < 0.3), 'each client starts on the spawn the host gave it');
  ok(A.heroes[0].player.x < 0 && A.heroes[2].player.x < 0 && A.heroes[1].player.x > 0 && A.heroes[3].player.x > 0, 'team BLUE west, team ORANGE east');
  N.step(12);
  ok(C.every((c) => c.pvp!.teams.join() === '0,1,0,1' && c.pvp!.countdown > 0), 'clients get the teams and the 3-2-1 through the snapshot');
  // Countdown: no damage yet.
  const e1 = A.pvp!.proxies[1];
  ok(A.pvpHit(e1, 100, { source: 'buster' } as any, A.heroes[0]) === 0, 'no damage during the 3-2-1');
  N.step(Math.ceil(P.pvpTuning.countdown * 60) + 2);
  ok(A.pvp!.countdown === 0, 'FIGHT');
  // Friendly fire off, opponents take hits.
  const mate = A.pvp!.proxies[2];
  ok(A.pvpHit(mate, 100, { source: 'buster' } as any, A.heroes[0]) === 0, 'friendly fire is off');
  ok(A.pvpHit(e1, 100, { source: 'buster' } as any, A.heroes[0]) > 0, 'opponents take hits');
  ok(A.heroes[0].ctx.nearest(e1.x, e1.z, 3, undefined) === e1 && A.heroes[0].ctx.nearest(mate.x, mate.z, 0.5, undefined) === null, "weapons aim at opponents, never at a teammate's stand-in");
  const hp0 = A.heroes[1].player.hp;
  N.step(30);
  ok(A.heroes[1].player.hp < hp0, `pending damage lands as hits (${hp0.toFixed(0)} -> ${A.heroes[1].player.hp.toFixed(0)})`);
  ok(A.heroes[1].player.hp >= hp0 - A.heroes[1].player.maxHp * P.pvpTuning.maxDps * 0.6, 'and never faster than the cap');
  // Round 1: BLUE knocks out ORANGE.
  const ko = (g: G, i: number, by: number) => {
    const h = g.heroes[i];
    g.pvp!.lastHit[i] = by;
    h.player.invuln = 0;
    h.player.hp = 1;
    g.hurtHero(h, 999, 0, 0, null, 'test');
  };
  ko(A, 1, 0);
  ko(A, 3, 2);
  N.flush();
  ok(A.pvp!.wins.join() === '1,0' && A.pvp!.roundEnd > 0, 'round 1 to BLUE');
  ok(A.pvp!.stats[0].kos === 1 && A.pvp!.stats[2].kos === 1, 'knockouts credited to whoever hit last');
  ok(C.every((c) => !!P2.pvp2State(c).board && P2.pvp2State(c).board!.team === 0), 'every screen shows the round scoreboard');
  // Spectating: an eliminated client.
  N.step(3);
  const out = C[0]; // hero 1, ORANGE, knocked out
  ok(out.player.dead && !!out.spectateTarget(), 'a knocked-out player watches a hero still standing');
  N.step(Math.ceil(P.pvpTuning.roundEnd * 60) + 5);
  ok(A.pvp!.round === 2 && A.heroes.every((h) => !h.player.dead && h.player.hp === h.player.maxHp), 'round 2: everyone back up at full life');
  ok(C.every((c) => c.pvp!.arena === A.pvp!.arena && key(c) === key(A)), `round 2 arena on every screen (${A.pvp!.arena}${A.pvp!.arena !== arena0 ? ', rotated' : ''})`);
  N.step(10);
  ok(!out.player.dead, 'the knocked-out client is back in for round 2');
  // Round 2: ORANGE; round 3 (final): ORANGE takes the match.
  N.step(Math.ceil(P.pvpTuning.countdown * 60) + 2);
  ko(A, 0, 1);
  ko(A, 2, 3);
  N.flush();
  ok(A.pvp!.wins.join() === '1,1', 'round 2 to ORANGE: 1 - 1');
  N.step(Math.ceil(P.pvpTuning.roundEnd * 60) + 5);
  ok(A.pvp!.round === 3, 'round 3 (the final round)');
  N.step(Math.ceil(P.pvpTuning.countdown * 60) + 2);
  ko(A, 0, 3);
  ko(A, 2, 1);
  N.flush();
  ok(A.pvp!.done && P2.pvp2State(A).board?.over && P2.pvp2State(A).board?.winner === 1, 'ORANGE takes the match 2 - 1');
  N.step(Math.ceil(P.pvpTuning.roundEnd * 60) + 5);
  ok(A.pvp?.phase === 'over' && C.every((c) => c.pvp?.phase === 'over'), 'match over on every screen');
  const runTimers = () => {
    while (pendingTimers.length) pendingTimers.shift()!();
  };
  runTimers();
  ok(A.mode === 'title' && !A.pvp && C.every((c) => c.mode === 'title'), 'everyone goes back to the title');
}

// ------------------------------------------------------------------ free-for-all with 8 (2 clients + 5 bots), one round
{
  const A = mk();
  const N = net(A);
  A.netName = 'Host';
  A.lobby = [{ peerId: '', name: 'Host', unlocked: [], skin: 'classic', pet: 'none', hero: 'rookie', loadout: A.hero.loadoutPick }];
  const C = [mk(), mk()];
  C.forEach((c, i) => N.connect(c, `p${i}`, `Guest${i + 1}`));
  A.lobbyKind = 'pvp';
  P2.setPvpRules(A, { format: 'ffa', rounds: 1, arena: 'frost' });
  for (let i = 0; i < 6; i++) P2.addPvpBot(A);
  ok(A.lobby.length === 8 && !P2.addPvpBot(A), `bots fill the lobby to ${P.PVP_MAX_PLAYERS}, no more`);
  A.hostStart();
  N.flush();
  N.step(5);
  A.hero.player.hp = A.hero.player.maxHp;
  for (const c of C) c.pvpStageDone();
  A.pvpStageDone();
  N.flush();
  ok(A.pvp!.phase === 'duel' && A.heroes.length === 8 && A.pvp!.arena === 'frost', '8-player free-for-all in Frost Court');
  const bots = A.heroes.filter((h) => P2.isBotPeer(h.peerId));
  ok(bots.length === 5 && bots.every((h) => h.weapons.length >= 2), 'bots have builds');
  ok(new Set(A.pvp!.teams).size === 8, 'everyone for themselves');
  ok(C.every((c) => c.heroes.length === 8), 'clients see all 8 heroes');
  // Humans stand still in god mode (a person would fight); the bots fight it out until one is left or the ring decides.
  cheats.god = false;
  for (const h of [A.heroes[0], A.heroes[1], A.heroes[2]]) {
    h.player.hp = 0;
    h.player.dead = true;
  }
  A.pvpCheckWinner();
  let t = 0;
  const t0 = performance.now();
  while (A.pvp?.phase === 'duel' && !A.pvp.done && t < 260) {
    N.step(60);
    t++;
  }
  const ms = (performance.now() - t0) / (t * 60);
  const aliveBots = bots.filter((h) => !h.player.dead).length;
  const dealt = A.pvp ? A.pvp.stats.map((s) => Math.round(s.dealt)) : [];
  ok(!!A.pvp && A.pvp.done, `the bots finish the round in ${t} s (${aliveBots} left, damage ${dealt.join('/')}, ${ms.toFixed(2)} ms per step with 3 machines)`);
  ok(dealt.slice(3).some((d) => d > 0), 'bots hurt each other');
  ok(C.every((c) => c.pvp!.zoneR === A.pvp!.zoneR || Math.abs(c.pvp!.zoneR - A.pvp!.zoneR) < 1), 'the ring is the same size on every screen');
}
