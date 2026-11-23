import { seedRandom } from './jsdomEnv';
import assert from 'node:assert/strict';

const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { ENEMIES } = await import('../src/data/enemies');
const { setLanguage, t } = await import('../src/i18n');
const { settings } = await import('../src/game/settings');
const { packStations, stationAt, stations, validRoles, squadStations } =
  await import('../src/data/asymRoles');
const { mechTuning } = await import('../src/game/gameplay');

const make = () =>
  new Game(
    new Input(document.querySelector('canvas')!),
    16 / 9,
    document.getElementById('hud')!,
    document.getElementById('reticle')!,
  );
seedRandom(42);
const g = make();
const word = packStations([...stations, ...stations]);
for (let i = 0; i < 8; i++) assert.equal(stationAt(word, i), stations[i % 4]);
for (const bad of [null, undefined, 3, -1, 131072, Infinity, 65536.5, '65536'])
  assert.equal(validRoles(bad), 0);
for (const lead of stations) assert.equal(new Set(squadStations(lead)).size, 4);

settings.cinematics = 'off';
settings.squadBots = 3;
settings.squadHeroes = 'rookie,rookie,rookie';
g.asym.squadMode = true;
g.startSolo();
g.closeShop();
assert.equal(g.asym.word, packStations(stations));
const [gunner, pilot, scout, commander] = g.heroes;
assert.equal(g.asym.replaces(gunner, 'primary'), false);
assert.equal(g.asym.replaces(scout, 'primary'), false);
assert.equal(g.asym.replaces(scout, 'secondary'), true);
assert.equal(g.asym.replaces(commander, 'primary'), true);
assert.equal(g.asym.replaces(pilot, undefined), false);
const base = g.spawnOpts({ hpMul: 10 }).hpMul!;
pilot.player.dead = true;
assert.ok(Math.abs(g.spawnOpts({ hpMul: 10 }).hpMul! / base - 0.94) < 1e-8);
pilot.player.dead = false;

scout.player.teleport(0, 0);
scout.player.setAimPoint(4, 0);
const mob = g.enemies.spawn(ENEMIES.pumpkin, 4, 0, {});
mob.state = 'move';
scout.ctx.charging = pilot.ctx.charging = true;
commander.player.teleport(0, 0);
commander.player.setAimPoint(9, 0);
commander.ctx.firing = true;
g.asym.step(g, 1 / 60);
assert.equal(pilot.play.mechT, mechTuning.duration);
assert.ok(mob.exposeT > 0);
assert.equal(g.asym.readyAt[2], g.runTime + 4);
g.updateHero(scout, 1 / 60, true);
assert.ok(scout.stats.reviveSpeed >= 0.6);
const dummy = g.enemies.spawn(ENEMIES.pumpkin, 9, 0, {});
dummy.state = 'move';
g.hash.insert(dummy, dummy.x, dummy.z, dummy.radius);
for (let i = 0; i < 30; i++) g.asym.step(g, 1 / 60);
assert.ok(dummy.hp < dummy.maxHp, 'the directed ring hits the enemy under the cursor');
assert.ok(commander.damageBy.drones > 0, 'the commander owns drone hits');
const packet = g.buildSnapshot(commander, []);
const fields = packet.stations as number[];
assert.equal(fields.length, 6); // role mask, two cooldowns, three drone values
assert.ok(fields[3] >= 60 && fields[3] <= 70);
const guest = make();
guest.role = 'client';
guest.clientStart(
  g.seed,
  3,
  g.heroes.map((h) => ({ name: h.name, skin: 'classic', hero: 'rookie', pet: 'none' })),
);
guest.clientStage(1, g.seed);
guest.applySnapshot(packet);
assert.equal(guest.asym.word, g.asym.word);
assert.equal(guest.asym.readyAt[2], guest.runTime + 4);
guest.asym.step(guest, 1);
assert.equal(guest.bullets.count, 0);
commander.ctx.charging = true;
g.asym.step(g, 1 / 60);
g.stepN++;
assert.ok(g.asym.snapshot(g)![3] >= 60, 'the squad charge cycle does not recall a drone attack');
g.squadRun = false; // a human's secondary explicitly recalls that same formation
for (let i = 0; i < 30; i++) g.asym.step(g, 1 / 60);
g.stepN++;
assert.equal(g.asym.snapshot(g)![3], 0);
g.leaveToTitle();
assert.equal(g.asym.word, 0);
assert.equal(g.buildSnapshot(g.hero, []).stations, undefined);

g.lobbyKind = 'coop';
g.asym.lobbyMode = true;
g.lobby = [
  { peerId: '', name: 'Host' },
  { peerId: 'alice', name: 'Guest' },
] as typeof g.lobby;
g.onHostMessage('alien', { t: 'station', pick: 'pilot' });
g.onHostMessage('alice', { t: 'station', pick: 'unknown' });
assert.equal(g.lobby[1].station, undefined);
g.onHostMessage('alice', { t: 'station', pick: 'scout', slot: 0 });
assert.equal(g.lobby[1].station, 'scout');
assert.equal(g.lobby[0].station, undefined);
g.mode = 'fight';
g.onHostMessage('alice', { t: 'station', pick: 'pilot' });
assert.equal(g.lobby[1].station, 'scout');
await setLanguage('ar');
assert.equal(t('stations.commander'), 'القائد');
await setLanguage('en');
console.log(
  'ok   eight seats, squad assignments, role inputs, cooldowns, support scaling, client snapshot, recall, lobby authority',
);
