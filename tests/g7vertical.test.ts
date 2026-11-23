import './jsdomEnv';
import assert from 'node:assert/strict';
import { Group, OrthographicCamera } from 'three';
import { Input } from '../src/core/input';
import { seedRandom } from './jsdomEnv';
import { DECK, HeightField, planHeights, rampWaypoint, siteX, siteZ } from '../src/world/height';
import { ENEMIES } from '../src/data/enemies';
import { Team } from '../src/game/bullets';
import { PickupType } from '../src/game/pickups';
import { packFloors, portalFloor, readFloors, terrainSight } from '../src/world/heightPlay';
import { segDist2 } from '../src/game/teamMoves';
import { aabbFromCenter } from '../src/world/collision';
import { StaticBoxGrid } from '../src/core/spatialHash';
import { viewCull } from '../src/render/viewCull';
import { buildHeightRoutes } from '../src/world/heightView';

for (let seed = 0; seed < 100; seed++) {
  const reserve = [aabbFromCenter(27, -28, 12, 12)];
  const field = planHeights(seed, 55, reserve);
  assert.ok(field.sites.length >= 2 && field.sites.length <= 4);
  for (const [i, a] of field.sites.entries())
    for (const b of field.sites.slice(i + 1)) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 16);
  assert.deepEqual(field.sites, planHeights(seed, 55, reserve).sites);
  assert.ok(!field.site(27, -28) && !field.site(0, 0));
}

for (const cross of [true, false]) {
  const s = { x: 0, z: 0, cross, bridge: true };
  const field = new HeightField([s]);
  let y = 0,
    px = siteX(s, -6),
    pz = siteZ(s, -6);
  const move = (u: number, v = 0) => {
    const p = { x: siteX(s, u, v), z: siteZ(s, u, v) };
    y = field.move(p, px, pz, y);
    px = p.x;
    pz = p.z;
    return p;
  };
  move(-3);
  assert.equal(y, DECK / 2);
  move(-1);
  move(1);
  assert.equal(y, DECK);
  move(1, 2.5);
  assert.ok(field.site(px, pz), 'deck side rail stops a drop');
  move(4);
  move(5.5);
  assert.equal(y, 0, 'open far lip drops to lower ground');
  move(4);
  assert.ok(!field.site(px, pz), 'cannot reverse the drop');
  px = siteX(s, 1, -2.5);
  pz = siteZ(s, 1, -2.5);
  move(1);
  assert.equal(y, 0);
  move(1, 2.5);
  assert.ok(!field.site(px, pz), 'underpass crosses both ways');
  if (!cross) {
    const corner = { x: 3.2, z: 2.2 };
    assert.equal(field.move(corner, 2.9, 1.9, 0), 0);
    assert.ok(
      corner.x < 3 && corner.z > 2,
      'a diagonal exit slides past the solid bridge abutment',
    );
  }
  assert.equal(field.shot(siteX(s, 5.1), siteZ(s, 5.1), 0, siteX(s, 4.8), siteZ(s, 4.8)), -1);
  assert.equal(field.shot(siteX(s, 4.8), siteZ(s, 4.8), DECK, siteX(s, 5.1), siteZ(s, 5.1)), 0);
  const bands = new Float32Array(96);
  const line = (charge: boolean) =>
    field.telegraphBands(
      siteX(s, 1),
      siteZ(s, 1),
      cross ? 1 : 0,
      cross ? 0 : 1,
      DECK,
      12,
      charge,
      bands,
    );
  assert.equal(line(false), 4);
  assert.ok(Math.abs(bands[0] - 2) <= 0.125 && Math.abs(bands[1] - DECK) < 1e-5);
  assert.deepEqual(
    [...bands.slice(2, 4)],
    [12, 0],
    'a sniper line lands on the lower target’s floor',
  );
  assert.equal(line(true), 2, 'a charge warning ends at the solid side rail');
  assert.ok(!field.clear(siteX(s, 7), siteZ(s, 7), 0, siteX(s, 0), siteZ(s, 0), true));
  // A charger approaches from behind the lip, circles the side and climbs.
  px = siteX(s, 6);
  pz = siteZ(s, 6);
  y = 0;
  const target = { x: 0, z: 0 };
  for (let i = 0; i < 500 && y < DECK - 0.01; i++) {
    rampWaypoint(s, px, pz, y, target);
    const dx = target.x - px,
      dz = target.z - pz,
      d = Math.hypot(dx, dz) || 1;
    const p = { x: px + (0.12 * dx) / d, z: pz + (0.12 * dz) / d };
    y = field.move(p, px, pz, y);
    px = p.x;
    pz = p.z;
  }
  assert.equal(y, DECK, 'ramp routing reaches the upper floor from the back');
}

seedRandom(41);
const { Game } = await import('../src/game/game');
const create = () =>
  new Game(
    new Input(document.querySelector('#game')!),
    16 / 9,
    document.querySelector('#hud')!,
    document.querySelector('#reticle')!,
  );
const host = create(),
  client = create();
for (const g of [host, client]) {
  g.startRun({ seed: 11, difficulty: 'normal' });
  g.closeShop();
  g.mode = 'fight';
}
const s = host.arena.heights!.sites[0];
assert.deepEqual(client.arena.heights!.sites, host.arena.heights!.sites);
assert.ok(host.arena.pads.length <= 6, 'the shared jump pad mesh holds every generated pad');
const pad = host.toys.pads.findIndex((p) => p.tx === siteX(s, 4) && p.tz === siteZ(s, 4));
assert.ok(pad >= 0);
host.player.teleport(siteX(s, 8), siteZ(s, 8));
for (let i = 0; i < 100; i++) {
  host.player.prev.x = host.player.x;
  host.player.prev.z = host.player.z;
  host.arenaMoveHero(host.hero, 1 / 60);
  if (i === 0) {
    const route = host.toys.pads[pad];
    const exit = portalFloor(host, host.player.x, host.player.z, {
      x: siteX(s, 14),
      z: siteZ(s, 14),
    });
    assert.ok(host.arena.heights!.clear(route.tx, route.tz, DECK, exit.x, exit.z, true));
    assert.ok(
      segDist2(route.x, route.z, route.tx, route.tz, exit.x, exit.z) > 1.4 ** 2,
      'a portal opened during a bridge launch is approachable from the landing without relaunching',
    );
  }
}
assert.equal(host.player.x, siteX(s, 4));
assert.equal(host.player.z, siteZ(s, 4));
assert.equal(host.hero.floorY, DECK);
const x = siteX(s, 1),
  z = siteZ(s, 1);
host.player.teleport(x, z);
const b = host.bullets;
const shot = {
  x,
  z,
  dirX: 0,
  dirZ: 1,
  speed: 5,
  life: 2,
  radius: 0.2,
  damage: 10,
  knockback: 0,
  team: Team.Player,
  color: '#ffcd75',
  width: 0.3,
  length: 0.5,
};
b.clear();
b.spawn(shot);
assert.ok(Math.abs(b.damage[0] - 10.6) < 1e-5);
b.spawn(shot);
b.kill(0);
assert.ok(Math.abs(b.floorY[0] - DECK) < 1e-5);
const e = host.enemies.spawn(ENEMIES.bopper, x, z, { instant: true });
e.floorY = 0;
host.hash.insert(e, x, z, e.radius);
assert.ok(b.hasHit(0, e.uid), 'deck stops a hit on the enemy beneath');
e.floorY = DECK;
assert.ok(!b.hasHit(0, e.uid));
host.pickups.spawn(PickupType.Heart, x, z);
assert.equal(host.pickups.floor(host.pickups.count - 1), 0);
client.hero.player.teleport(x, z);
client.bullets.spawn(shot);
client.bullets.uid[0] = b.uid[0];
const mirror = client.enemies.spawn(ENEMIES.bopper, x, z, { instant: true });
client.netEnemies.set(e.uid, mirror);
readFloors(client, packFloors(host, x, z, 50));
assert.equal(client.hero.floorY, DECK);
assert.equal(mirror.floorY, DECK);
assert.ok(Math.abs(client.bullets.floorY[0] - DECK) < 1e-5);
host.hero.floorY = e.floorY = b.floorY[0] = 0;
readFloors(client, packFloors(host, x, z, 50));
assert.equal(client.hero.floorY, 0);
assert.equal(mirror.floorY, 0);
assert.equal(client.bullets.floorY[0], 0);
// Exercise the ordinary host broadcast, including the clear packet, with decoded entity identities.
client.role = 'client';
host.hero.floorY = e.floorY = b.floorY[0] = DECK;
client.applySnapshot(host.buildSnapshot(host.hero, []));
assert.equal(client.netEnemies.get(e.uid)?.floorY, DECK);
assert.ok(Math.abs(client.bullets.floorY[0] - DECK) < 1e-5);
host.hero.floorY = e.floorY = b.floorY[0] = 0;
client.applySnapshot(host.buildSnapshot(host.hero, []));
assert.equal(client.netEnemies.get(e.uid)?.floorY, 0);
assert.equal(client.bullets.floorY[0], 0);

const normalDamage = host.damage;
host.damage = (_target, amount) => amount;
host.player.teleport(siteX(s, 6), siteZ(s, 6));
e.x = siteX(s, -6);
e.z = siteZ(s, -6);
assert.equal(host.hero.ctx.damage(e, 10, { source: 'laser' }), 0);
assert.equal(
  host.hero.ctx.damage(e, 10, { source: 'rail' }),
  10,
  'same-level rail retains cover penetration',
);
e.x = siteX(s, 4);
e.z = siteZ(s, 4);
e.floorY = DECK;
assert.equal(host.hero.ctx.damage(e, 10, { source: 'rail' }), 0, 'rail cannot shoot up the lip');
host.damage = normalDamage;

host.enemies.clear();
host.hash.clear();
const highTarget = { x: siteX(s, 4), z: siteZ(s, 4), radius: 0.5, alive: true, floorY: DECK };
const ctx = { ...host.enemyCtx, walls: new StaticBoxGrid([]), targets: [highTarget] };
const charger = host.enemies.spawn(ENEMIES.charger, siteX(s, 6), siteZ(s, 6), { instant: true });
for (let i = 0; i < 1400 && charger.floorY < DECK; i++) host.enemies.update(1 / 60, ctx);
assert.equal(
  charger.floorY,
  DECK,
  'the normal charger brain walks the approach instead of charging into a wall',
);
host.enemies.clear();
const sniper = host.enemies.spawn(ENEMIES.sniper, siteX(s, 4), siteZ(s, 4), { instant: true });
sniper.floorY = DECK;
sniper.timerA = 0;
highTarget.x = siteX(s, 25);
highTarget.z = siteZ(s, 25);
highTarget.floorY = 0;
host.enemies.update(1 / 60, ctx); // finish the spawn pop
host.enemies.update(1 / 60, ctx);
assert.equal(sniper.state, 'windup', 'perched sniper winds up at 21 m');
assert.ok(sniper.t > 1, 'the extra reach keeps the long sniper tell');
host.enemies.clear();
host.player.teleport(0, 0);
ctx.walls = terrainSight(host, new StaticBoxGrid([]));
const onGrate = host.enemies.spawn(ENEMIES.sniper, x, z, { instant: true });
onGrate.floorY = DECK;
onGrate.timerA = 0;
highTarget.x = siteX(s, 16);
highTarget.z = siteZ(s, 16);
host.enemies.update(1 / 60, ctx);
host.enemies.update(1 / 60, ctx);
assert.equal(
  onGrate.state,
  'windup',
  'the upper sniper sees across the solid lip beyond its grate',
);
highTarget.x = siteX(s, 35, 20);
highTarget.z = siteZ(s, 35, 20);
onGrate.state = 'move';
for (let i = 0; i < 400 && onGrate.floorY > 0; i++) host.enemies.update(1 / 60, ctx);
assert.equal(onGrate.floorY, 0, 'a sniper uses the marked drop to pursue an out-of-range target');
host.enemies.clear();
highTarget.x = siteX(s, 16);
highTarget.z = siteZ(s, 16);
const climbing = host.enemies.spawn(ENEMIES.sniper, siteX(s, 0, 2.8), siteZ(s, 0, 2.8), {
  instant: true,
});
for (let i = 0; i < 1400 && climbing.floorY < DECK; i++) host.enemies.update(1 / 60, ctx);
assert.equal(climbing.floorY, DECK, 'a grounded sniper reaches a nearby firing perch');
host.enemies.clear();
ctx.walls = terrainSight(host, new StaticBoxGrid([aabbFromCenter(siteX(s, 8), siteZ(s, 8), 2, 2)]));
const screened = host.enemies.spawn(ENEMIES.sniper, siteX(s, 0, 2.8), siteZ(s, 0, 2.8), {
  instant: true,
});
host.enemies.update(1 / 60, ctx);
host.enemies.update(1 / 60, ctx);
assert.equal(screened.perch, undefined, 'a sniper skips a perch with cover across its sight line');
host.enemies.clear();
ctx.walls = terrainSight(host, new StaticBoxGrid([]));
const shooter = host.enemies.spawn(ENEMIES.shooter, x, z, { instant: true });
shooter.floorY = DECK;
highTarget.x = siteX(s, 17.5);
highTarget.z = siteZ(s, 17.5);
host.enemies.update(1 / 60, ctx);
shooter.timerA = 0;
host.enemies.update(1 / 60, ctx);
assert.equal(
  shooter.state,
  'windup',
  'an ordinary shooter on the grate can see a ground target beyond 15 m',
);

for (let stage = 1; stage <= 12; stage++) {
  host.loadArena(109 + stage * 881, stage);
  const sites = host.arena.heights!.sites;
  assert.ok(
    sites.length >= 2 && sites.length <= 4,
    'two to four actual features on stage ' + stage,
  );
  for (const site of sites)
    assert.equal(host.walls.hitCircle(siteX(site, 4), siteZ(site, 4), 0.65), false);
}
const scenery = new Group();
const updateRoutes = buildHeightRoutes(
  scenery,
  new HeightField([
    { x: -30, z: 0, cross: true, bridge: true },
    { x: 30, z: 0, cross: false, bridge: false },
  ]),
  12,
);
const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
camera.up.set(0, 0, -1);
for (const x of [0, -30, 30]) {
  camera.position.set(x, 30, 0);
  camera.lookAt(x, 0, 0);
  viewCull.update(camera);
  updateRoutes(x, 0, 0);
  assert.equal(
    scenery.children[0].visible,
    x !== 0,
    'submit the combined mesh only when a route can be seen',
  );
}
console.log(
  'Height routes, ramp entry, ledges, bridge floors, one-way drops, pads, shot damage, loot and host floors passed.',
);
