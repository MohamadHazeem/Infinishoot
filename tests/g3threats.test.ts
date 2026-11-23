import { seedRandom } from './jsdomEnv';
import { measureThreatDamage } from '../src/game/enemyBulletMeasure';

if (process.env.THREAT_MEASURE) {
  const { Game } = await import('../src/game/game');
  const { Input } = await import('../src/core/input');
  const { installBot } = await import('../src/dev/bot');
  const { settings } = await import('../src/game/settings');
  Object.assign(settings, {
    hero: 'rookie',
    mode: 'standard',
    difficulty: 'normal',
    tips: false,
    cinematics: 'off',
    finishers: false,
    bossIntros: false,
    deathReplay: false,
  });
  for (const seed of [42, 128, 305]) {
    for (const stage of [1, 2, 3, 4]) {
      seedRandom(seed);
      const input = new Input(document.querySelector('canvas')!);
      const g = new Game(
        input,
        16 / 9,
        document.getElementById('hud')!,
        document.getElementById('reticle')!,
      );
      installBot(g, input);
      g.startRun({ seed, difficulty: 'normal' });
      g.closeShop();
      if (stage > 1) g.loadStage(stage);
      const run = (window as unknown as { botRun(s: number, god: boolean): unknown }).botRun;
      console.log(
        seed,
        stage,
        await measureThreatDamage(g, (s) => run(s, false), stage === 1 ? 1600 : 120),
      );
    }
  }
}

const { default: assert } = await import('node:assert/strict');
const { Scene } = await import('three');
const { Bullets } = await import('../src/game/bullets');
const {
  Shot,
  Zone,
  zoneTuning: Z,
  zoneFor,
  shotFor,
  patternTuning: T,
} = await import('../src/data/patterns');
const { spawnPattern, steerPattern, forkShot, ricochet, patternedShot } =
  await import('../src/game/enemyBullets');
const { Denial, zoneClearance } = await import('../src/game/denial');
const { dodgeThreats } = await import('../src/game/enemyBulletDodge');
const { BulletDeltaEncoder, BulletDeltaDecoder } = await import('../src/net/bulletCodec');
const { ByteWriter } = await import('../src/net/bytes');
const { packBullets, unpackBullets } = await import('../src/net/codec');
const { Game, BULLET_KINDS } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { ENEMIES } = await import('../src/data/enemies');
const { StaticBoxGrid } = await import('../src/core/spatialHash');
const near = (a: number, b: number, tolerance = 0.002) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);

const b = new Bullets(new Scene());
const client = new Bullets(new Scene());
const enc = new BulletDeltaEncoder(),
  dec = new BulletDeltaDecoder(),
  writer = new ByteWriter();
function sync() {
  writer.reset();
  enc.encode(
    b,
    Array.from({ length: b.count }, (_, i) => i),
    writer,
  );
  dec.decode(writer.bytes(), client);
}
for (const k of [Shot.Delayed, Shot.Bounce, Shot.Curve, Shot.Split, Shot.Return])
  spawnPattern(b, k, 0, 0, 1, 0, 8, 10);
assert.deepEqual(
  Array.from(b.kind.slice(0, 5)).map((k) => BULLET_KINDS[k].source),
  ['delayed', 'ricochet', 'curve', 'split', 'boomerang'],
);
sync();
assert.deepEqual(client.kind.slice(0, 5), b.kind.slice(0, 5));
assert.deepEqual(client.shape.slice(0, 5), b.shape.slice(0, 5));
unpackBullets(packBullets(b, [0, 1, 2, 3, 4]), client);
assert.deepEqual(client.shape.slice(0, 5), b.shape.slice(0, 5));
enc.reset();
dec.reset();
sync();
b.integrate(0.6);
client.integrate(0.6);
sync();
near(client.x[0], 0);
near(b.x[0], 0);
b.integrate(0.4);
client.integrate(0.4);
sync();
near(client.x[0], 1.6);
near(b.x[0], 1.6);
b.team[0] = 0;
b.kind[0] = 13;
b.setColor(0, '#7df9ff');
sync();
assert.equal(client.shape[0], 0);
assert.equal(client.team[0], 0);
assert.equal(client.colorOf(0), '#7df9ff');
steerPattern(b, 2, 0.5);
assert.ok(b.vz[2] > 0);
near(Math.hypot(b.vx[2], b.vz[2]), 8);
b.age[4] = T.turnAt + T.returnBrake / 2;
steerPattern(b, 4, 0);
near(b.vx[4], 0);
b.age[4] += 1;
steerPattern(b, 4, 0);
assert.ok(b.vx[4] < 0);
const parentUid = b.uid[3];
const total = b.count;
forkShot(b, 3);
assert.equal(b.count, total + 1);
assert.equal(b.shape[b.count - 1], 0);
assert.equal(b.parentUid[b.count - 1], parentUid);
assert.ok(b.vz[b.count - 1] * b.vz[b.count - 2] < 0);
b.kill(1);
assert.equal(b.shape[1], 0);

const input = new Input(document.querySelector('canvas')!);
const g = new Game(
  input,
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
g.startRun({ seed: 42, difficulty: 'normal' });
g.closeShop();
const originalHurt = g.hurtHero;
await assert.rejects(measureThreatDamage(g, async () => { throw new Error('runner stopped'); }, 1), /runner stopped/);
assert.equal(g.hurtHero, originalHurt);
const laterHero = { player: { hp: 100 } };
const laterRun = {
  hero: laterHero, stage: 9, hurtHero: () => { laterHero.player.hp -= 6; },
} as unknown as InstanceType<typeof Game>;
const laterResult = await measureThreatDamage(laterRun, () => laterRun.hurtHero(laterRun.hero, 6, 0, 0), 1);
assert.deepEqual(laterResult.damage, [0, 0, 0, 0, 0, 0, 0, 0, 6]);
g.walls = new StaticBoxGrid([{ minX: 2, maxX: 3, minZ: -3, maxZ: 3 }]);
const pool = g.bullets;
pool.clear();
spawnPattern(pool, Shot.Bounce, 1.6, 0, 1, 0, 8, 8);
pool.integrate(0.05);
assert.ok(ricochet(g, 0));
near(pool.x[0], 1.6);
near(pool.vx[0], -8);
assert.equal(ricochet(g, 0), false);
pool.clear();
const p = g.player;
p.teleport(0, 0);
p.invuln = 0;
const shooter = g.enemies.spawn(ENEMIES.shooter, 0, 7, g.spawnOpts());
shooter.state = 'windup';
assert.ok(patternedShot(g, shooter, 0, -1, 8, 9));
assert.equal(patternedShot(g, shooter, 0, -1, 8, 9), false);
pool.clear();
spawnPattern(pool, Shot.Delayed, 0, 0, 0, 1, 8, 9);
const hp = p.hp;
g.updateBullets(1 / 60);
assert.equal(hp, p.hp);
assert.equal(pool.count, 1);
pool.life[0] = T.life - T.hang - 0.02;
g.updateBullets(1 / 60);
assert.ok(hp > p.hp);
pool.clear();
spawnPattern(pool, Shot.Delayed, 0, -2.9, 0, 1, 8, 9);
pool.life[0] = T.life - T.hang;
p.invuln = 0;
const move = { mx: 0, mz: -1 };
dodgeThreats(g, move);
assert.ok(move.mz > -0.99);

assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(zoneFor), [0, 1, 1, 2, 2, 3, 3, 4]);
assert.equal(shotFor(2, 'burst'), Shot.Plain);
assert.equal(shotFor(3, 'burst'), Shot.Bounce);
assert.equal(shotFor(5, 'spiral'), Shot.Curve);
assert.equal(shotFor(7, 'blaster'), Shot.Split);
assert.equal(shotFor(9, 'marksman'), Shot.Return);
const zones = g.bossField.denial,
  peer = new Denial(new Scene());
for (const kind of [Zone.Pool, Zone.Wall, Zone.Ring, Zone.Mine]) {
  zones.clear();
  zones.place(kind, 0, 0, 0, 10, 'Ground strike');
  peer.unpack(zones.pack());
  assert.deepEqual(peer.pack(), zones.pack());
  const q = zones.slots[0],
    age = Z.tell[kind] + 0.01;
  if (kind === Zone.Wall) {
    assert.ok(zoneClearance(q, 0, -Z.sweep, age) > p.radius);
    assert.ok(zoneClearance(q, 3, -Z.sweep, age) < 0);
    assert.ok(zoneClearance(q, 3, Z.sweep, Z.tell[kind] + Z.duration[kind] - 0.01) < 0);
  } else if (kind === Zone.Ring) {
    assert.ok(zoneClearance(q, 0, Z.ringR, age) > p.radius);
    assert.ok(zoneClearance(q, 0, -Z.ringR, age) < 0);
    assert.ok(zoneClearance(q, 0, 0, age) > 0);
    assert.ok(zoneClearance(q, 0, -Z.ringR * 0.6, Z.tell[kind] + Z.duration[kind] * 0.5) < 0);
  } else {
    p.invuln = 0;
    const before = p.hp;
    zones.advance(Z.tell[kind] - 0.05, g);
    assert.equal(before, p.hp);
    peer.advance(age);
    assert.equal(before, p.hp);
    zones.advance(0.06, g);
    assert.ok(p.hp < before);
    const after = p.hp;
    p.invuln = 0;
    zones.advance(0.02, g);
    assert.equal(after, p.hp);
  }
  zones.advance(10, g);
  assert.equal(zones.pack(), undefined);
}
zones.clear();
for (let i = 0; i < Z.cap; i++) assert.ok(zones.place(Zone.Mine, 0, 0, 0, 10, 'Ground strike'));
assert.equal(zones.place(Zone.Mine, 0, 0, 0, 10, 'Ground strike'), false);
g.clearWorld();
assert.equal(zones.pack(), undefined);
peer.unpack(undefined);
assert.equal(peer.pack(), undefined);
// Spawn from a real enemy windup; the shared cooldown and cover check protect the escape.
g.stage = 4;
p.teleport(0, 0);
g.walls = new StaticBoxGrid([]);
const elite = g.enemies.spawn(ENEMIES.shooter, 0, 6, g.spawnOpts());
elite.elite = true;
g.enemyCtx.onWindup(elite);
assert.equal(zones.slots[0].kind, Zone.Mine);
g.enemyCtx.onWindup(elite);
assert.equal(zones.pack()?.length, 1);
zones.clear();
g.walls = new StaticBoxGrid([{minX:-4,maxX:4,minZ:-4,maxZ:4}]);
g.enemyCtx.onWindup(elite);
assert.equal(zones.pack(), undefined);
g.walls = new StaticBoxGrid([]);
zones.place(Zone.Pool,0,2.5,0,8,elite.def.name);
zones.advance(1.1);
const intoPool = {mx:0, mz:1};
dodgeThreats(g,intoPool);
assert.ok(intoPool.mz < 0.99);
zones.clear();

const scene = new Scene();
const crowded = new Bullets(scene, { colorblind: true, reduceFlash: true });
for (let i = 0; i < 1024; i++) spawnPattern(crowded, Shot.Split, 0, 0, 1, 0, 8, 8);
crowded.render(1);
const shapeDraws = scene.children.filter(mesh => mesh.geometry?.getAttribute('glyph') && mesh.count);
assert.equal(shapeDraws.length, 1);
assert.equal(shapeDraws[0].count, 1024);
assert.equal(shapeDraws[0].material.uniforms.uColor.value.getHex(), 0xffffff);
crowded.age.fill(T.splitAt);
crowded.integrate(1/60, true);
assert.equal(crowded.count, 1024);
assert.ok(crowded.shape.every(k => k === Shot.Plain));

// Late join mid-tell and subsequent deltas use the same compact snapshot path as live co-op.
const mirror = new Game(new Input(document.querySelector('canvas')!), 16/9, document.getElementById('hud')!, document.getElementById('reticle')!);
mirror.startRun({seed:42, difficulty:'normal'});
mirror.closeShop();
mirror.role = 'client';
spawnPattern(g.bullets, Shot.Split, 1, 0, 1, 0, 8, 8);
zones.place(Zone.Wall, 2, 1, 0.4, 10, 'Ground strike');
zones.advance(0.72);
mirror.applySnapshot(g.buildSnapshot(g.hero, []));
assert.deepEqual(mirror.bossField.denial.pack(), zones.pack());
assert.equal(mirror.bullets.shape[0], Shot.Split);
zones.advance(1.1);
mirror.applySnapshot(g.buildSnapshot(g.hero, []));
assert.deepEqual(mirror.bossField.denial.pack(), zones.pack());
zones.clear(); g.bullets.clear();
mirror.applySnapshot(g.buildSnapshot(g.hero, []));
assert.equal(mirror.bossField.denial.pack(), undefined);
assert.equal(mirror.bullets.count, 0);
console.log(
  'Projectile motion, forks, reflection, binary snapshots, zone clocks, escape lanes and bot movement passed.',
);
process.exit(0);
