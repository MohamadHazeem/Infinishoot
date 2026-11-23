import './jsdomEnv';
import assert from 'node:assert/strict';
import { Group, InstancedMesh } from 'three';
import { seedRandom } from './jsdomEnv';
import { Input } from '../src/core/input';
import { ENEMIES } from '../src/data/enemies';
import { machines, MACHINE_KINDS, SET_PIECES, type Machine } from '../src/data/setPieces';
import { h4World } from '../src/game/systems/heroes4';
import { forceCoopObjective } from '../src/game/systems/coopplay';
import {
  placePieces,
  localX,
  localZ,
  SetPieceView,
  worldX,
  worldZ,
  type MachineState,
} from '../src/world/setPieces';
import type { Arena } from '../src/world/fieldArena';
import { aabbFromCenter, overlapsAny } from '../src/world/collision';

seedRandom(37);
const { Game } = await import('../src/game/game');
const create = () =>
  new Game(
    new Input(document.querySelector('#game')!),
    16 / 9,
    document.querySelector('#hud')!,
    document.querySelector('#reticle')!,
  );
assert.ok(new Set(SET_PIECES.map((p) => p.id)).size >= 12);
for (const p of SET_PIECES)
  assert.ok(p.rows.length === 7 && p.rows.every((row) => /^[ A.T#*]{7}$/.test(row)));

const reserved = aabbFromCenter(10, 0, 8, 4);
const fixture = {
  seed: 0,
  halfSize: 55,
  colliders: [reserved],
  chests: [],
  spots: [],
  turrets: [],
  pads: [],
  hazards: [],
  conveyors: [],
} as unknown as Arena;
const found = new Set<number>();
for (let seed = 0; seed < 96; seed++) {
  fixture.seed = seed;
  const sites = placePieces(fixture, [0, 11]);
  assert.deepEqual(sites, placePieces(fixture, [0, 11]));
  assert.deepEqual(new Set(sites.map((p) => SET_PIECES[p.plan].kind)), new Set(MACHINE_KINDS));
  const occupied = [reserved, aabbFromCenter(0, 11, 6, 6), aabbFromCenter(0, 0, 20, 20)];
  for (const p of sites) {
    const f = aabbFromCenter(p.x, p.z, 8.4, 8.4);
    assert.equal(overlapsAny(f, occupied), false);
    occupied.push(f);
    found.add(p.plan);
    assert.equal(localX(p, worldX(p, -2, 3), worldZ(p, -2, 3)), -2);
    assert.equal(localZ(p, worldX(p, -2, 3), worldZ(p, -2, 3)), 3);
  }
}
assert.equal(found.size, SET_PIECES.length);
assert.deepEqual(
  placePieces({ ...fixture, halfSize: 8 }, []),
  [],
  'a tiny island never gets an out-of-bounds machine',
);

const g = create(),
  client = create();
function start(game: InstanceType<typeof Game>) {
  game.startRun({ seed: 42, difficulty: 'normal' });
  game.closeShop();
  game.mode = 'fight';
  game.enemies.clear();
  game.setHeroes([game.hero, game.makeHero(1, 'Blue', [])]);
}
start(g);
start(client);
client.role = 'client';
const system = g.setPieces;
assert.ok(forceCoopObjective(g, 'door'));
assert.ok(forceCoopObjective(client, 'door'));
g.biomeRules.update(g, 1 / 60);
system.update(g, 1 / 60);
assert.equal(system.pieces.length, 5);
const group = new Group(),
  view = new SetPieceView(group);
const batches = group.children as InstancedMesh[];
view.draw(system.pieces, 31, '#788d9b');
const allInstances = batches.reduce((n, mesh) => n + mesh.count, 0);
view.draw(system.pieces, 0, '#788d9b');
assert.ok(batches.every((mesh) => !mesh.visible && mesh.count === 0));
view.draw(system.pieces, 1, '#788d9b');
assert.ok(batches.some((mesh) => mesh.visible && mesh.count > 0));
assert.ok(batches.reduce((n, mesh) => n + mesh.count, 0) < allInstances);
function device(kind: Machine) {
  return system.pieces.find((p) => SET_PIECES[p.plan].kind === kind)!;
}
function step(seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    g.runTime += 1 / 60;
    g.stepN++;
    system.update(g, 1 / 60);
  }
}
function treadle(p: MachineState) {
  g.heroes[1].player.teleport(worldX(p, 0, 2.65), worldZ(p, 0, 2.65));
  step(1 / 60);
  assert.equal(p.phase, 'warning');
  assert.equal(p.owner, 1);
}
function foe(p: MachineState, x = 0, z = 0, hp = 100) {
  const e = g.enemies.spawn(ENEMIES.bopper, worldX(p, x, z), worldZ(p, x, z), { instant: true });
  e.state = 'move';
  e.hp = e.maxHp = hp;
  return e;
}
const recipient = {};
function sync() {
  const packet = system.snapshotFor(g, recipient)!;
  assert.ok(packet);
  const wire = g.buildSnapshot(g.heroes[1], []);
  assert.deepEqual(wire.machinery, packet);
  client.applySnapshot(wire);
  return packet;
}
const hostCount = g.arena.colliders.length;
const initial = sync();
assert.equal(client.arena.colliders.length, hostCount);
assert.deepEqual(client.arena.colliders, g.arena.colliders);
assert.ok(forceCoopObjective(g, 'door'));
client.applySnapshot(g.buildSnapshot(g.heroes[1], []));
assert.deepEqual(client.arena.colliders, g.arena.colliders, 'reinstalling a vault keeps collider order');
assert.deepEqual(system.pieces, client.setPieces.pieces);
client.setPieces.mirror(client, initial);
assert.equal(client.arena.colliders.length, hostCount, 'duplicate snapshot cannot duplicate walls');
assert.equal(system.snapshotFor(g, recipient), undefined);
assert.ok(system.snapshotFor(g, {}), 'new recipient sees current layout');
assert.ok(g.buildSnapshot(g.hero, []).machinery);
const spikes = device('spikes');
const e = foe(spikes, 0, 0, 1);
g.hero.player.teleport(spikes.x, spikes.z); // nearest hero is deliberately not the operator
const kills = g.toys.envKills,
  life = g.hero.player.hp;
treadle(spikes);
const boss = g.enemies.spawn(ENEMIES.rex, spikes.x, spikes.z, { instant: true });
boss.state = 'move';
boss.hp = 1;
step(machines.spikes.warning - 0.08);
assert.equal(e.hp, 1);
step(0.12);
assert.equal(g.hero.player.hp, life);
assert.equal(boss.hp, 1);
assert.equal(g.toys.envKills, kills + 1);
assert.equal(h4World(g).envKills[1], 1);
assert.equal(g.heroes[1].damageBy.floor_spikes, 1);
assert.equal(g.hero.damageBy.floor_spikes, undefined);
step(16);
assert.equal(system.uses.spikes, 1, 'standing on switch does not auto-repeat');
g.heroes[1].player.teleport(0, 0);
step(1 / 60);
treadle(spikes);
assert.equal(system.uses.spikes, 2);

const bridge = device('bridge');
const dropped = foe(bridge, 0, 0, 600),
  elite = foe(bridge, 0, 1, 600);
elite.elite = true;
const bridgeCredit = h4World(g).envKills[1];
const row = SET_PIECES[bridge.plan].rows.findIndex((r) => /[T*]/.test(r));
const postX = SET_PIECES[bridge.plan].rows[row].search(/[T*]/) - 3;
const relayX = worldX(bridge, postX, row - 3),
  relayZ = worldZ(bridge, postX, row - 3);
assert.equal(system.hitRelay(g, bridge.x, bridge.z, 0.2, 1), false);
assert.equal(client.setPieces.hitRelay(client, relayX, relayZ, 0.2, 1), false);
assert.equal(g.hitToys(relayX, relayZ, 0.2, 1, 1, 1, 0), true);
assert.equal(bridge.phase, 'warning');
assert.equal(bridge.owner, 1);
assert.equal(system.hitRelay(g, relayX, relayZ, 0.2, 0), false);
step(machines.bridge.warning + 0.03);
assert.ok(dropped.hp <= 0);
assert.equal(elite.hp, 450);
assert.equal(h4World(g).envKills[1], bridgeCredit + 1);
assert.ok(g.walls.hitCircle(bridge.x, bridge.z, 0.1));
assert.equal(g.walls.hitSolid(bridge.x, bridge.z, 0.1), false);
const bridgePacket = sync();
assert.ok(client.walls.hitCircle(bridge.x, bridge.z, 0.1));
assert.equal(client.arena.colliders.length, hostCount + 1);
client.setPieces.update(client, 100);
assert.equal(
  client.setPieces.pieces.find((p) => p.plan === bridge.plan)!.phase,
  'active',
  'client never fires or advances phases',
);
step(2.3);
sync();
assert.equal(g.walls.hitCircle(bridge.x, bridge.z, 0.1), false);
assert.equal(client.walls.hitCircle(bridge.x, bridge.z, 0.1), false);

const flood = device('flood'),
  swept = foe(flood, 0, -1.6);
treadle(flood);
step(machines.flood.warning + 0.03);
assert.ok(swept.hp < 100 && Math.hypot(swept.kx, swept.kz) > 0);
g.hero.player.teleport(swept.x, swept.z);
g.envHit(swept, 'lava', 500);
assert.equal(h4World(g).envKills[1], bridgeCredit + 2, 'the sluice operator keeps the lava kill');
const lure = device('lure'),
  crowd = [foe(lure, 3), foe(lure, -3), foe(lure, 0, 4)];
treadle(lure);
step(machines.lure.warning + 0.03);
for (const e of crowd) assert.ok((lure.x - e.x) * e.kx + (lure.z - e.z) * e.kz > 0);
const barrels = device('barrels'),
  far = foe(barrels, 0, -2.8);
treadle(barrels);
step(machines.barrels.warning + 0.02);
assert.equal(barrels.pulse, 1);
assert.equal(far.hp, 100, 'far drum has not fired');
step(machines.barrels.spacing * 2);
assert.equal(barrels.pulse, 3);
assert.ok(far.hp < 100);
client.clientStage(2, 42);
client.setPieces.mirror(client, bridgePacket);
assert.equal(client.walls.boxes, client.arena.colliders);
assert.equal(client.setPieces.snapshotFor(client, {}), undefined, 'old-arena snapshot rejected');
g.startRun({ seed: 42, difficulty: 'normal' });
assert.equal(system.uses.barrels, 0);
console.log(
  'ok   15 plans, deterministic reservations, five switches, co-op attribution, timers and bridge collision',
);
