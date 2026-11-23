import './jsdomEnv';
import assert from 'node:assert/strict';
import { seedRandom } from './jsdomEnv';
import { biomeByKey, allBiomeKeys, BIOMES, biomeForce } from '../src/data/biomes';
import { TERRAIN } from '../src/data/biomeRules';
import { RELIC_BY_ID } from '../src/data/relics';
import { ENEMIES } from '../src/data/enemies';
import { chamberRoll, type Chamber } from '../src/game/secrets2';

import { Input } from '../src/core/input';
import { Team } from '../src/game/bullets';
import { PickupType } from '../src/game/pickups';
import { en } from '../src/i18n/en';
import { ar } from '../src/i18n/ar';

seedRandom(19);
Object.assign(globalThis, { __APP_VERSION__: '2.0.1' });
const { Game } = await import('../src/game/game');
const { choose: consentTo, queue } = await import('../src/net/telemetryClient');
const { finishTelemetry } = await import('../src/game/systems/telemetry');
const rewards = new Set<string>();
for (const b of BIOMES) {
  const def = biomeByKey(b.id).rules!;
  assert.equal(new Set(def.terrain).size, 3, b.id);
  assert.ok(ENEMIES[def.guardian].miniboss && RELIC_BY_ID[def.relic]);
  rewards.add(def.relic);
  for (const k of def.terrain) assert.notEqual(en[TERRAIN[k].tip], ar[TERRAIN[k].tip]);
}
assert.equal(rewards.size, BIOMES.length);
for (const key of allBiomeKeys())
  assert.equal(biomeByKey(key).rules, biomeByKey(key.split(':')[0]).rules);
let rooms = 0,
  lairs = 0;
for (let seed = 0; seed < 1000; seed++) {
  const kind = chamberRoll(seed);
  assert.equal(kind, chamberRoll(seed));
  if (kind) rooms++;
  if (kind === 'lair') lairs++;
}
assert.ok(rooms > 800 && rooms < 920 && lairs > 45 && lairs < 110);

const g = new Game(
  new Input(document.querySelector('#game')!),
  16 / 9,
  document.querySelector('#hud')!,
  document.querySelector('#reticle')!,
);
const field = g.biomeRules;
function start(seed: number, biome = 'meadow') {
  biomeForce.key = biome;
  g.startRun({ seed, difficulty: 'normal' });
  g.closeShop();
  g.mode = 'fight';
  g.director.hold = true;
  g.enemies.clear();
  g.bullets.clear();
  field.update(g, 1 / 60);
  return field.snapshot(g)!;
}
function choose(kind: Chamber) {
  for (let seed = 1; ; seed++)
    if (chamberRoll((seed ^ Math.imul(1, 0x9e3779b1)) >>> 0) === kind) return seed;
}
function shoot(x: number, z: number, team: Team = Team.Player) {
  g.bullets.spawn({
    x: x - 1.5,
    z,
    dirX: 1,
    dirZ: 0,
    speed: 100,
    life: 1,
    radius: 0.12,
    damage: 4,
    knockback: 0,
    team,
    color: 0xffffff,
    width: 0.1,
    length: 0.3,
  });
}

consentTo('yes');
const seed = choose('vault');
const first = start(seed);
const v = start(seed);
assert.deepEqual(v, first);
assert.ok(!v.xy.includes(127));
const vault = field.room!;
shoot(vault.x, vault.z, Team.Enemy);
field.update(g, 1 / 60);
assert.equal(field.finds, 0);
g.role = 'client';
shoot(vault.x, vault.z);
field.update(g, 1 / 60);
assert.equal(field.finds, 0);
g.role = 'solo';
field.update(g, 1 / 60);
assert.equal(field.finds, 1);
assert.equal(vault.phase, 'open');
const gold = g.hero.gold;
const life = g.player.maxHp;
g.player.hp = life - 10;
g.player.teleport(vault.x, vault.z);
field.update(g, 1 / 60);
field.update(g, 1 / 60);
assert.equal(g.hero.gold, gold + 2);
assert.equal(g.player.maxHp, life + 30);
assert.equal(g.player.hp, life + 20);
assert.equal(g.hero.relics.filter((r) => r === 'r_ironheart').length, 1);
const snapshot = g.buildSnapshot(g.hero, []).island;
assert.deepEqual(snapshot, field.snapshot(g));
assert.equal(
  g.buildSnapshot(g.hero, []).island,
  undefined,
  'the static layout is sent only once between keyframes',
);
const mirror = new (await import('../src/game/biomeRules')).IslandField();
mirror.mirror(g, snapshot);
mirror.mirror(g, snapshot);
assert.deepEqual(mirror.room?.phase, 'claimed');
assert.equal(g.hero.gold, gold + 2);
g.loadStage(2);
field.update(g, 1 / 60);
assert.equal(field.finds, 1);
finishTelemetry(g, 'quit');
assert.deepEqual(queue().at(-1)?.stages[0].ranks['secret:meadow'], [1, 1]);
consentTo('no');
start(choose('shrine'));
assert.equal(field.finds, 0);
const shrine = field.room!;
shoot(shrine.x, shrine.z);
field.update(g, 1 / 60);
g.player.teleport(shrine.x + 1.5, shrine.z);
field.update(g, 1 / 60);
assert.equal(shrine.phase, 'open');
g.player.teleport(shrine.x - 1.5, shrine.z);
field.update(g, 1 / 60);
assert.equal(shrine.phase, 'lit');
g.player.teleport(shrine.x + 1.5, shrine.z);
field.update(g, 1 / 60);
assert.equal(shrine.phase, 'claimed');

start(choose('lair'), 'sky');
const lair = field.room!;
shoot(lair.x, lair.z);
field.update(g, 1 / 60);
g.player.teleport(lair.x, lair.z);
for (let i = 0; i < 100; i++) field.update(g, 1 / 60);
assert.equal(lair.phase, 'warning');
for (let i = 0; i < 165; i++) field.update(g, 1 / 60);
assert.equal(lair.guardianUid, -1, 'never lands on an occupant');
g.player.teleport(lair.x + 6, lair.z);
for (let i = 0; i < 40; i++) field.update(g, 1 / 60);
const guard = g.enemies.list.find((e) => e.uid === lair.guardianUid)!;
assert.equal(guard.def.id, 'squall');
assert.equal(g.boss, null);
g.killEnemy(guard, 'buster', g.hero);
assert.equal(lair.phase, 'claimed');
assert.ok(g.hero.relics.includes('r_feather'));
field.kill(g, guard.uid);
assert.equal(g.hero.relics.filter((r) => r === 'r_feather').length, 1);

for (const kind of Object.keys(TERRAIN) as (keyof typeof TERRAIN)[]) {
  const biome = BIOMES.find((b) => biomeByKey(b.id).rules!.terrain.includes(kind))!;
  const net = start(13, biome.id);
  const i = biomeByKey(biome.id).rules!.terrain.indexOf(kind) * 2;
  const x = net.xy[i],
    z = net.xy[i + 1];
  assert.notEqual(x, 127);
  g.player.teleport(x, z);
  const e = g.enemies.spawn(ENEMIES.bopper, x + 0.5, z, { instant: true });
  e.state = 'move';
  e.vx = 3;
  g.hash.clear();
  g.hash.insert(e, e.x, e.z, e.radius);
  g.hero.bombCharge = 0;
  if (kind === 'shelter') shoot(x, z, Team.Enemy);
  g.pickups.clear();
  g.pickups.spawn(PickupType.Gem, x + 6, z);
  field.update(g, 0.21);
  switch (kind) {
    case 'roots':
      assert.equal(e.slowAmt, 0.35);
      break;
    case 'prism':
      assert.ok(e.exposeT > 0);
      break;
    case 'magnet':
      assert.equal(g.pickups.pulled[0], 1);
      break;
    case 'spring':
      assert.ok(g.hero.bombCharge > 0);
      break;
    case 'shelter':
      assert.equal(g.bullets.count, 0);
      break;
    case 'ice':
    case 'tide':
      assert.ok(e.kx > 0);
      break;
  }
}
biomeForce.key = null;
console.log(
  'ok   nine biome families, seed rolls, authority, snapshots, ordered shrine, guarded reward and seven terrain effects',
);
