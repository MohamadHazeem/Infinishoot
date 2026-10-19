/**
 * Eightp lane (8-player co-op): the pure scaling and layout rules, the
 * teammate weapon mix and particle LOD, then a whole team of eight in one
 * process (tests/eightpHarness.ts): lobby admission and the 9th player
 * refused, hostStart with 8 heroes on every machine, clients that move and
 * fire (the host follows them), enemy scaling for 8, owned boss chests for 8,
 * the team ultimate quorum, faster revives with extra helpers, far-hero
 * snapshot interest, and Versus still capped at 4.
 */
import { ok } from './check';
import { bootDom, makeTeam, summary } from './eightpHarness';

await bootDom();
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const E = await import('../src/game/eightp');
const { Director } = await import('../src/game/director');
const { teamUltDue, teamUltTuning, poolCost, teamUltDamage } = await import('../src/game/coop2');
const { teamScale } = await import('../src/game/teamMoves');
const { TeamWeaponMix, teamMixTuning } = await import('../src/audio/mix');
const { particleLod, lodState, lodTuning } = await import('../src/render/lod');

// ---------------------------------------------------------------- caps
ok(E.lobbyCap('coop') === 8 && E.lobbyCap('weekly') === 8 && E.lobbyCap('pvp') === 8 && E.lobbyCap('versus') === 4, 'lobby caps: co-op/weekly/PvP 8, Versus 4');

// ---------------------------------------------------------------- scaling: identity for 1-4
for (let n = 1; n <= 4; n++) {
  ok(E.countPlayers(n) === n && E.hpPlayers(n) === n && E.bossPlayers(n) === n && E.teamHeroes(n) === n, `${n} players: every factor is unchanged`);
  ok(E.lootMul(n) === 1 && E.poolStartFor(3, n) === 3 && E.poolMaxFor(6, n) === 6 && E.poolCostMul(n) === 1 && E.reviveHelperMul(3, n) === 1, `${n} players: loot, pool and revive rules unchanged`);
}
const d = new Director();
d.stage = 3;
d.time = 120;
const at = (n: number) => {
  d.players = n;
  return { alive: d.targetAlive, hp: d.hpMul, boss: d.bossHpMul };
};
const two = at(2);
for (const n of [3, 4]) {
  const r = at(n);
  ok(Math.abs(r.hp / two.hp - (1 + 0.45 * (n - 1)) / 1.45) < 1e-9 && Math.abs(r.boss / two.boss - (1 + 0.6 * (n - 1)) / 1.6) < 1e-9, `director: ${n} players keep the old HP and boss slopes`);
}
const four = at(4);
const eight = at(8);
const five = at(5);
ok(five.alive >= four.alive && eight.alive >= five.alive && eight.hp > five.hp && five.hp > four.hp && eight.boss > four.boss, 'director: 5-8 players still get more and tougher enemies');
// Enemy "work" (count x life) per hero should stay near the 4-player level instead of running away.
const work = (r: { alive: number; hp: number }, n: number) => (r.alive * r.hp) / n;
const ratio = work(eight, 8) / work(four, 4);
ok(ratio > 0.85 && ratio < 1.2, `director: horde work per hero at 8 is ${ratio.toFixed(2)}x the 4-player level (linear would be ${((1 + 0.5 * 7) * (1 + 0.45 * 7) / 8 / ((2.5 * 2.35) / 4)).toFixed(2)}x)`);
ok(eight.boss / four.boss > 1.7 && eight.boss / four.boss < 2, `boss life at 8 is ${(eight.boss / four.boss).toFixed(2)}x the 4-player boss (8 heroes' damage)`);
ok(E.poolStartFor(3, 8) === 5 && E.poolMaxFor(6, 8) === 10 && poolCost(2, 8) > poolCost(2, 4), 'revive pool for 8: 5 lives to start, 10 max, a slightly dearer buy-back');
ok(E.reviveHelperMul(1, 8) === 1 && E.reviveHelperMul(2, 8) > 1 && E.reviveHelperMul(7, 8) === E.eightpTuning.reviveMaxMul, 'revives in big teams: extra helpers speed it up, capped');
ok(teamScale(8) < 1 + 0.4 * 6 && teamScale(8) > teamScale(4) && teamUltDamage(8) < teamUltDamage(4) * 2, 'team moves and the team ultimate grow past 4 heroes, but slower');
ok(E.lootMul(8) > 1 && E.lootMul(8) < 1.5, 'hearts and coins: a bit more for 8');

// ---------------------------------------------------------------- team ultimate quorum
ok(E.ultQuorum(2) === 2 && E.ultQuorum(4) === 4 && E.ultQuorum(5) === 4 && E.ultQuorum(8) === 5, 'ultimate quorum: everyone up to 4, then 60% (at least 4)');
let same = true;
for (let k = 0; k < 400; k++) {
  const n = 2 + (k % 3);
  const fired = Array.from({ length: n }, (_, i) => ((k * 7 + i * 13) % 11 === 0 ? -Infinity : 10 + (((k * 31 + i * 17) % 40) / 10)));
  const a = teamUltDue(fired, 13, 5);
  const b = E.ultParticipants(fired, 13, 5, teamUltTuning.window);
  if (a !== !!b || (b && b.length !== n)) same = false;
}
ok(same, 'ultimate quorum: 2-4 heroes decide exactly like the old "everyone fired" rule');
const fired8 = [10, 10.4, 10.9, 11.2, 11.5, -Infinity, 3, 11.9];
const parts = E.ultParticipants(fired8, 12, 5, 2);
ok(!!parts && parts.join() === '0,1,2,3,4,7', `8 heroes: the six who fired inside 2 s team up, not the late or stale ones (${JSON.stringify(parts)})`);
ok(E.ultParticipants([10, 10.2, 10.4, -Infinity, -Infinity, -Infinity, -Infinity, 11], 11, 5, 2) === null, '8 heroes: four is not enough');

// ---------------------------------------------------------------- spots, framing, tags, pings
for (let n = 1; n <= 4; n++) for (let i = 0; i < n; i++) ok(E.spawnSpotFor(i, n).x === (i - (n - 1) / 2) * 2 && E.spawnSpotFor(i, n).z === 0, `spawn spot ${i}/${n} as before`);
const minDist = (pts: { x: number; z: number }[]) => Math.min(...pts.flatMap((p, i) => pts.slice(i + 1).map((q) => Math.hypot(p.x - q.x, p.z - q.z))));
ok(minDist(Array.from({ length: 8 }, (_, i) => E.spawnSpotFor(i, 8))) >= 2, '8 spawn spots in two rows, 2 m apart or more');
ok(minDist(Array.from({ length: 8 }, (_, i) => E.ownedChestSpot(i, 8))) >= 1.2 && E.ownedChestSpot(2, 4).x === 1.6, 'boss chests: a ring for 8 (row for up to 4)');
const xs = [3, 40, 10, -20, 5, 0, 25];
const zs = [0, 0, 10, 0, -5, 30, 0];
const picked: number[] = [];
const nf = E.pickFrameMates(0, 0, xs, zs, 7, picked);
ok(nf === 5 && picked[0] === 0 && picked[1] === 4 && !picked.slice(0, nf).includes(1), `framing: the nearest five within ${E.eightpTuning.frameRange} m (${picked.slice(0, nf)})`);
const tags = Array.from({ length: 7 }, (_, i) => ({ x: 400 + (i % 2) * 10, y: 300 + i * 3, name: `Player${i}`, down: i === 3, onScreen: i < 5, dist: 4 + i }));
tags[5].x = 2000;
tags[5].y = 310;
tags[6].x = 2100;
tags[6].y = 320;
E.declutterTags(tags, 8, 1280, 720);
let overlap = false;
for (let i = 0; i < 5; i++) for (let j = 0; j < i; j++) if (Math.abs(tags[i].x - tags[j].x) < E.eightpTuning.tagGapX && Math.abs(tags[i].y + tags[i].dy! - tags[j].y - tags[j].dy!) < E.eightpTuning.tagGapY - 0.01) overlap = true;
ok(!overlap, 'name tags: five crowded tags stack without overlapping');
ok(tags[0].mini === true && tags[3].mini === false, 'near teammates get a short tag; a downed one keeps its full tag');
const p5 = E.edgePin(tags[5].x, tags[5].y, 1280, 720);
const p6 = E.edgePin(tags[6].x, tags[6].y, 1280, 720);
ok(Math.abs(p5.y + tags[5].dy! - p6.y - tags[6].dy!) >= E.eightpTuning.edgeGap - 0.01, 'edge pointers in the same direction stack');
const small = tags.map((t) => ({ ...t }));
E.declutterTags(small, 4, 1280, 720);
ok(small.every((t) => !t.mini && !t.dy), 'up to 4 heroes: tags untouched');
const pings: number[] = [];
let sent = 0;
for (let i = 0; i < 20; i++) if (E.pingAllowed(pings, i * 0.1, 8)) sent++;
ok(sent === E.eightpTuning.pingBurst, `team ping budget for 8: ${sent} of 20 pings in 2 s`);
ok(E.pingAllowed([], 0, 4) && E.pingAllowed([0, 0, 0, 0, 0, 0], 0.1, 4), 'up to 4 heroes: no team ping budget');
ok(E.farHeroFresh(30, 3, 1) && [0, 1, 2, 3, 4].filter((k) => E.farHeroFresh(90, k, 2)).length === 1 && [0, 1, 2, 3].filter((k) => E.farHeroFresh(45, k, 2)).length === 2, 'weapon state: near teammates every snapshot, 36-60 m every 2nd, beyond 1 in 5');

// ---------------------------------------------------------------- teammate weapon mix
const mix = new TeamWeaponMix();
mix.mates = 0;
ok([0, 0.001, 0.002].every((t) => mix.gain('w:shoot', 10, t) === 1), 'solo: nothing thinned');
mix.mates = 7;
mix.volume = 1;
ok([0, 0.001, 0.002, 0.003].every((t) => mix.gain('w:shoot', 0.5, t) === 1), 'your own weapon always plays in full');
let plays = 0;
for (let i = 0; i < 100; i++) if (mix.gain('w:laser', 8, 1 + i * 0.01) > 0) plays++;
ok(plays >= 4 && plays < 50, `7 teammates firing the same weapon every 10 ms: ${plays} of 100 cues play`);
let far = 0;
for (let i = 0; i < 100; i++) if (mix.gain('w:disc', 28, 3 + i * 0.01) > 0) far++;
ok(far < plays, `far teammates are thinned more (${far} vs ${plays})`);
mix.gain('w:shoot', 0, 5);
const ducked = mix.gain('w:missile', 10, 5.01);
ok(ducked > 0 && ducked < 1 - teamMixTuning.perMate * 6 + 1e-9, `teammates duck under your own shot (${ducked.toFixed(2)})`);
let burst = 0;
const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
for (const n of names) if (mix.gain('w:' + n, 10, 9) > 0) burst++;
ok(burst === teamMixTuning.windowMax, `at most ${teamMixTuning.windowMax} teammate weapon cues per 100 ms (${burst} of 10 different cues)`);
mix.volume = 0;
ok(mix.gain('w:zz', 10, 20) === 0 && mix.gain('w:zz', 0.2, 20.5) === 1, 'TEAMMATE WEAPONS 0 mutes them, never yours');

// ---------------------------------------------------------------- particle LOD
lodState.x = lodState.z = 0;
lodState.heroes = 1;
ok(particleLod(60, 0) === 1, 'solo: every particle');
lodState.heroes = 2;
ok(particleLod(60, 0) === 1, '2 players: every particle');
lodState.heroes = 8;
ok(particleLod(5, 5) === 1 && particleLod(60, 0) >= lodTuning.minMul && particleLod(60, 0) < 0.5 && particleLod(25, 0) > particleLod(40, 0), `8 players: full detail near you, ${particleLod(60, 0).toFixed(2)}x far away`);
lodState.heroes = 1;

// ---------------------------------------------------------------- a whole team of eight
const { settings } = await import('../src/game/settings');
const { cheats, OWNED_CHEST } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
const { PickupType } = await import('../src/game/pickups');
const C2 = await import('../src/game/systems/coop2');
settings.deathReplay = false;
settings.coopJoinable = true;
settings.finishers = false;
const T = await makeTeam(8, { bots: true });
const { A, clients } = T;
await new Promise((r) => setTimeout(r, 0));
T.flush();
ok(A.lobby.length === 8, `the lobby takes 8 players (${A.lobby.length})`);
// A 9th is refused in the lobby.
let refused = '';
(A as any).host.send = ((orig) => (id: string, m: any) => {
  if (id === 'peer9' && m.t === 'full') refused = String(m.reason ?? 'full');
  orig(id, m);
})((A as any).host.send);
A.onHostMessage('peer9', { t: 'hello', name: 'Nine', unlocked: [], hero: 'rookie' });
ok(A.lobby.length === 8 && !!refused, `a 9th player is refused (${refused})`);
// Versus keeps 4.
A.lobbyKind = 'versus';
A.hostStart();
ok(A.mode === 'title', 'Versus with 8 in the lobby does not start');
A.lobbyKind = 'coop';
A.hostStart();
T.flush();
for (let i = 0; i < 40 && A.mode !== 'fight'; i++) T.step(1);
ok(A.mode === 'fight' && A.heroes.length === 8, `co-op starts with 8 heroes (${A.mode}, ${A.heroes.length})`);
ok(clients.every((c, i) => c.heroes.length === 8 && c.local === i + 1 && c.mode === 'fight'), 'every client has the 8-hero roster and plays its own hero');
ok(A.director.players === 8, 'enemy scaling counts 8 players');
cheats.god = true;
A.xpNext = 1e9;
const start = clients.map((c) => ({ x: c.player.x, z: c.player.z }));
for (let i = 0; i < 6; i++) A.enemies.spawn(ENEMIES.swarmer, A.hero.player.x + 10 + i, A.hero.player.z + 4, { ...A.spawnOpts(), instant: true });
T.step(150);
const moved = clients.filter((c, i) => Math.hypot(c.player.x - start[i].x, c.player.z - start[i].z) > 1).length;
ok(moved >= 6, `clients move on their own (${moved} of 7)`);
const lag = clients.map((c) => Math.hypot(A.heroes[c.local].player.x - c.player.x, A.heroes[c.local].player.z - c.player.z));
ok(Math.max(...lag) < 2.5, `the host follows every client hero (worst ${Math.max(...lag).toFixed(2)} m)`);
const seen = clients.map((c) => c.heroes.filter((h, i) => i !== c.local && Math.hypot(h.player.x - A.heroes[i].player.x, h.player.z - A.heroes[i].player.z) < 3).length);
ok(seen.every((n) => n >= 6), `clients see their 7 teammates where the host has them (${seen.join(',')})`);
const bytes = summary([...T.stats.snapBytes.values()].flat());
ok(T.stats.snapBytes.size === 7 && bytes.avg > 0, `snapshots reach all 7 clients (avg ${Math.round(bytes.avg)} B, max ${bytes.max} B)`);

// Far-hero interest: a teammate 90 m away repeats its weapon list between refreshes.
const farH = A.heroes[7];
const nearH = A.heroes[1];
const keepX = farH.player.x;
const keepZ = farH.player.z;
farH.player.teleport(nearH.player.x + 64, nearH.player.z + 64);
const S = await import('../src/game/systems/eightp');
const lists = new Set<unknown>();
for (let k = 0; k < 10; k++) {
  A.stepN += 3;
  lists.add(S.heroWeaponsFor(A, nearH, farH, () => farH.weapons.map(() => k)));
}
ok(lists.size === 3, `a far teammate's weapons: sent once, then refreshed 2 times in 10 snapshots (${lists.size})`);
const nearLists = new Set<unknown>();
A.heroes[2].player.teleport(nearH.player.x + 3, nearH.player.z);
for (let k = 0; k < 4; k++) nearLists.add(S.heroWeaponsFor(A, nearH, A.heroes[2], () => A.heroes[2].weapons.map(() => k)));
ok(nearLists.size === 4, 'a near teammate refreshes every snapshot');
farH.player.teleport(keepX, keepZ);

// Team ultimate: five of eight firing together is a team ultimate.
const sA = C2.coop2Debug(A);
const u0 = sA.ult.count;
for (const h of A.heroes) h.skill.ult = 1;
A.tryUlt(A.hero);
for (const i of [1, 2, 3, 4]) T.peers.get(`peer${i}`) && A.onHostMessage(`peer${i}`, { t: 'ult' });
T.step(3);
ok(sA.ult.count === u0 + 1, `5 of 8 ultimates within 2 s: a TEAM ULTIMATE (${sA.ult.count - u0})`);
T.step(60);

// Revives: three helpers bring a teammate back faster than one.
const downed = A.heroes[5];
const reviveTime = (helpers: number) => {
  cheats.god = false;
  downed.revivesLeft = 0;
  downed.petState.reviveUsed = true;
  downed.phoenixUsed = true;
  downed.player.invuln = 0;
  if (!downed.player.dead && downed.player.hurt(downed.player.hp + 1, 1, 0)) A.onHeroDown(downed);
  cheats.god = true;
  const p = downed.player;
  A.heroes.forEach((h, i) => {
    if (h === downed) return;
    const k = [0, 1, 2, 3, 4, 6, 7].indexOf(i);
    if (k < helpers) h.player.teleport(p.x + Math.cos(k) * 1.2, p.z + Math.sin(k) * 1.2);
    else h.player.teleport(p.x + 30 + k * 2, p.z + 30);
  });
  // Hold everyone in place: no client input moves them during the measurement.
  for (const c of clients) (T.inputs.get(c) as any).keys.clear();
  let n = 0;
  downed.reviveT = 0;
  while (downed.player.dead && n < 600) {
    A.heroes.forEach((h, i) => {
      if (h === downed || h.player.dead) return;
      const k = [0, 1, 2, 3, 4, 6, 7].indexOf(i);
      const tx = k < helpers ? p.x + Math.cos(k) * 1.2 : p.x + 30 + k * 2;
      const tz = k < helpers ? p.z + Math.sin(k) * 1.2 : p.z + 30;
      h.player.teleport(tx, tz);
      if (h.remote) Object.assign(h.remote, { x: tx, z: tz, vx: 0, vz: 0 });
    });
    A.updateRevives(1 / 60);
    n++;
  }
  return n;
};
const one = reviveTime(1);
const three = reviveTime(3);
ok(three < one * 0.8, `revive with 3 helpers ${three} steps vs 1 helper ${one}`);

// Boss: one owned chest per hero, apart from each other.
A.debugSkipToBoss();
for (let i = 0; i < 900 && !A.enemies.list.some((e) => e.active && e.def.boss); i++) T.step(1);
const boss = A.enemies.list.find((e) => e.active && e.def.boss);
ok(!!boss, 'the boss is in');
if (boss) {
  boss.hp = 0;
  A.killEnemy(boss, 'test', A.hero);
  const chests: { x: number; z: number; v: number }[] = [];
  for (let i = 0; i < A.pickups.count; i++) if (A.pickups.type[i] === PickupType.Chest && A.pickups.value[i] >= OWNED_CHEST) chests.push({ x: A.pickups.x[i], z: A.pickups.z[i], v: A.pickups.value[i] - OWNED_CHEST });
  const owners = new Set(chests.map((c) => c.v));
  ok(owners.size === 8, `8 owned boss chests (${[...owners].sort().join(',')})`);
  ok(chests.length < 2 || minDist(chests) > 0.9, 'and they lie apart (a ring)');
}
cheats.god = false;
console.log('eightp checks done');
