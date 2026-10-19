/**
 * Content lane: biome-native enemies (director filter, codec sub-state,
 * veterans, lava puddles, snowball growth).
 */
import { ok } from './check';
import { ENEMIES, VETERAN_OF, biomeAllows } from '../src/data/enemies';
import { Director } from '../src/game/director';
import { Enemy } from '../src/game/enemies';
import { LavaPuddles, behaveBiome, syncSub, type BiomeOut } from '../src/game/biomeFoes';
import {
  packBullets,
  packEnemies,
  unpackBullets,
  unpackEnemies,
  type EnemyRecord,
} from '../src/net/codec';
import * as THREE from 'three';
import { Bullets, Team } from '../src/game/bullets';
import { BulletShape } from '../src/game/bulletShapes';
import { Rng } from '../src/core/rng';
import { HEROES } from '../src/data/heroes';
import { ACHIEVEMENTS } from '../src/data/meta';
import { HeroMech, heroMechTuning } from '../src/game/heroMechs';

const NATIVE: Record<string, string> = {
  bee: 'meadow',
  shark: 'dunes',
  roller: 'peaks',
  slug: 'magma',
  soldier: 'factory',
  kite: 'sky',
};

// ---------------------------------------------------------------- data
for (const [id, biome] of Object.entries(NATIVE)) {
  const d = ENEMIES[id];
  ok(!!d && d.biomes?.length === 1 && d.biomes[0] === biome, `${id} lives in ${biome}`);
  ok(
    biomeAllows(d, biome) && !biomeAllows(d, biome === 'meadow' ? 'dunes' : 'meadow'),
    `${id}: biomeAllows`,
  );
  ok(
    !!VETERAN_OF[id] && !!ENEMIES[VETERAN_OF[id]] && ENEMIES[VETERAN_OF[id]].biomes?.[0] === biome,
    `${id} has a veteran`,
  );
}
ok(
  biomeAllows(ENEMIES.swarmer, 'dunes') && biomeAllows(ENEMIES.swarmer, ''),
  'regular enemies spawn anywhere',
);

// ---------------------------------------------------------------- director pool
function poolAt(stage: number, biome: string, seconds: number): string[] {
  const d = new Director();
  d.start(stage);
  d.biome = biome;
  d.time = seconds;
  return d.pool().map((x) => x.id);
}
const late = 230;
ok(poolAt(1, 'meadow', late).includes('bee'), 'bees join the meadow');
ok(!poolAt(1, 'meadow', 10).includes('bee'), 'but not in the first seconds of stage 1');
ok(!poolAt(1, 'dunes', late).includes('bee'), 'no bees in the dunes');
ok(
  poolAt(2, 'dunes', 60).includes('shark') && !poolAt(2, 'dunes', 60).includes('roller'),
  'sharks in the dunes, no snowballs',
);
ok(poolAt(3, 'peaks', 60).includes('roller'), 'snowballs on the peaks');
ok(poolAt(4, 'magma', 60).includes('slug'), 'slugs on magma');
ok(
  poolAt(5, 'factory', 60).includes('soldier') && poolAt(5, 'sky', 60).includes('kite'),
  'loop-2 biomes get theirs',
);
ok(
  !poolAt(5, 'meadow', late).some((id) =>
    ['shark', 'roller', 'slug', 'soldier', 'kite'].includes(id),
  ),
  'loop-2 meadow only has bees',
);
ok(!poolAt(3, '', late).some((id) => id in NATIVE), 'unknown biome: no natives');
// Elites come from the same pool, so they respect the biome too.
{
  const d = new Director();
  d.start(2);
  d.biome = 'meadow';
  const rng = new Rng(7);
  let elites = 0;
  let bad = 0;
  for (let i = 0; i < 60 * 240; i++) {
    for (const r of d.update(1 / 60, 9999, () => 0, rng)) {
      if (r.kind !== 'enemy' || !r.elite) continue;
      elites++;
      if (r.def.biomes && !r.def.biomes.includes('meadow')) bad++;
    }
  }
  ok(elites > 0 && bad === 0, `elites stay in their biome (${elites} elites)`);
}

// ---------------------------------------------------------------- codec sub-state
{
  const roller = new Enemy(ENEMIES.roller);
  roller.reset(1, 2, {});
  roller.state = 'move';
  roller.sub = 5;
  const shark = new Enemy(ENEMIES.shark);
  shark.reset(3, 4, {});
  shark.sub = 1;
  const king = new Enemy(ENEMIES.king);
  king.reset(0, 0, {});
  king.action = 'slam';
  const got: Record<string, EnemyRecord> = {};
  unpackEnemies(packEnemies([roller, shark, king]), (r) => (got[r.def.id] = { ...r }));
  ok(got.roller?.sub === 5, 'snowball size step survives the record');
  ok(got.shark?.sub === 1, 'shark underground survives the record');
  ok(got.king?.action === 'slam', 'boss actions still decode');
  const c = new Enemy(ENEMIES.roller);
  c.reset(0, 0, {});
  c.sub = got.roller.sub;
  syncSub(c);
  ok(
    Math.abs(c.scale - (1 + ENEMIES.roller.roll!.growth * 5)) < 1e-6 &&
      c.radius > ENEMIES.roller.radius,
    'client snowball grows from the sub-state',
  );
  const s = new Enemy(ENEMIES.shark);
  s.reset(0, 0, {});
  s.state = 'move';
  s.sub = 1;
  syncSub(s);
  ok(s.under && !s.alive, 'a shark under the sand cannot be hit (alive is false)');
}

// ---------------------------------------------------------------- behaviour
function fakeCtx(tx: number, tz: number) {
  const hash = { queryInto: () => 0, query: () => {} };
  const walls = { hitCircle: () => false, resolveCircle: () => false };
  return {
    targets: [],
    target: { x: tx, z: tz, radius: 0.5 },
    targetAlive: true,
    hash,
    colliders: [],
    walls,
    onWindup: () => {},
    onEnrage: () => {},
    fireBullet: () => {},
    spawnChild: () => {},
    detonate: () => {},
    slam: () => {},
    strike: () => {},
    land: () => {},
    heal: () => {},
    rally: () => {},
    sparkle: () => {},
    escape: () => {},
    bounds: () => 55,
  } as unknown as Parameters<typeof behaveBiome>[2];
}
{
  // A snowball rolling away from its target grows a step every growEvery metres, then stops at maxSteps.
  const e = new Enemy(ENEMIES.roller);
  e.reset(0, 0, { instant: true });
  e.state = 'move';
  const ctx = fakeCtx(0, -1000);
  const out: BiomeOut = { x: 0, z: 0, rigid: false };
  const hp0 = e.maxHp;
  for (let i = 0; i < 60 * 30; i++) {
    behaveBiome(e, 1 / 60, ctx, 0, -1000, 0, -1, 1000, ENEMIES.roller.speed, out);
    e.x += out.x / 60;
    e.z += out.z / 60;
  }
  ok(e.sub === ENEMIES.roller.roll!.maxSteps, `snowball grows to its max (${e.sub})`);
  ok(e.maxHp > hp0 * 2 && e.scale > 2, 'and gets tougher and bigger');
}
{
  // A shark dives under on its first step, then surfaces with a bite.
  const e = new Enemy(ENEMIES.shark);
  e.reset(0, 0, { instant: true });
  e.state = 'move';
  let bit = 0;
  const ctx = fakeCtx(2, 0);
  (ctx as unknown as { land: () => void }).land = () => bit++;
  const out: BiomeOut = { x: 0, z: 0, rigid: false };
  behaveBiome(e, 1 / 60, ctx, 2, 0, 1, 0, 2, 3, out);
  ok(e.under && e.sub === 1 && !e.alive, 'shark burrows');
  let surfaced = false;
  for (let i = 0; i < 60 * 6 && !bit; i++) {
    e.t -= 1 / 60;
    behaveBiome(e, 1 / 60, ctx, 2 - e.x, -e.z, 1, 0, Math.max(0.1, 2 - e.x), 3, out);
    if (!e.under) surfaced = true;
  }
  ok(
    surfaced && bit === 1 && e.alive && e.state === 'recover',
    'shark bursts out, bites once and lies exposed',
  );
}

// ---------------------------------------------------------------- lava puddles
{
  const lp = new LavaPuddles();
  const e = new Enemy(ENEMIES.slug);
  e.reset(0, 0, { instant: true });
  e.state = 'move';
  for (let i = 0; i < 120; i++) {
    e.x += 2 / 60;
    lp.tick(1 / 60, [e]);
  }
  const small = lp.list.length;
  ok(small >= 3, `a moving slug leaves puddles (${small})`);
  e.state = 'windup';
  lp.tick(1 / 60, [e]);
  e.state = 'move';
  lp.tick(1 / 60, [e]);
  ok(
    lp.list.length === small + 1 && lp.list[lp.list.length - 1].r >= ENEMIES.slug.ooze!.spillR,
    'a swell ends in a big spill',
  );
  ok(!!lp.at(e.x, e.z, 0) && !lp.at(e.x + 50, e.z, 0), 'puddle lookup');
  for (let i = 0; i < 60 * 8; i++) lp.tick(1 / 60, []);
  ok(lp.list.length === 0, 'puddles dry up');
}

// ---------------------------------------------------------------- evolved bullet shapes
{
  const scene = new THREE.Scene();
  const a = new Bullets(scene);
  const base = {
    x: 1,
    z: 2,
    dirX: 1,
    dirZ: 0,
    speed: 10,
    life: 1,
    radius: 0.2,
    damage: 5,
    knockback: 1,
    color: '#ff7a2f',
    width: 0.3,
    length: 0.8,
  };
  a.spawn({ ...base, team: Team.Player, kind: 6 }); // Flare Buster
  a.spawn({ ...base, team: Team.Player, kind: 5 }); // Flak Cannon
  a.spawn({ ...base, team: Team.Player, kind: 7 }); // Volt Buster
  a.spawn({ ...base, team: Team.Player, kind: 9 }); // Lance Shot
  a.spawn({ ...base, team: Team.Player, kind: 0 }); // plain Buster
  a.spawn({ ...base, team: Team.Enemy, color: '#ff3df0' });
  ok(
    a.shape[0] === BulletShape.Flame &&
      a.shape[1] === BulletShape.Star &&
      a.shape[2] === BulletShape.Bolt &&
      a.shape[3] === BulletShape.Lance,
    'evolved kinds get their silhouettes',
  );
  ok(
    a.shape[4] === BulletShape.Gem && a.shape[5] === BulletShape.Gem,
    'plain and enemy bullets stay gems',
  );
  const b = new Bullets(scene);
  unpackBullets(packBullets(a, [0, 1, 2, 3, 4, 5]), b);
  ok(
    b.count === 6 &&
      [0, 1, 2, 3, 4, 5].every((i) => b.shape[i] === a.shape[i] && b.team[i] === a.team[i]),
    'shapes and teams survive the bullet record',
  );
  a.kill(0);
  ok(
    a.shape[0] === BulletShape.Gem && a.count === 5,
    'killing a bullet moves the last one (with its shape) into the slot',
  );
  a.render(1); // the shape meshes draw without throwing
  ok(true, 'bullets with shapes render');
}

// ---------------------------------------------------------------- hero mechanics
for (const id of ['duelist', 'furnace', 'twin']) {
  const h = HEROES.find((x) => x.id === id);
  ok(
    !!h && h.mech === id && !!ACHIEVEMENTS.find((a) => a.id === h.unlock),
    `${id}: hero with its mechanic and an unlock`,
  );
}
{
  const m = new HeroMech();
  m.id = 'furnace';
  for (let i = 0; i < 60 * 4; i++) m.tickHeat(1 / 60, 0, true);
  ok(
    m.heat === 1 && Math.abs(m.damageMul - (1 + heroMechTuning.furnace.damageMax)) < 1e-9,
    'furnace: full heat after standing still',
  );
  ok(m.auraR === heroMechTuning.furnace.auraMax, 'furnace: aura at full size');
  for (let i = 0; i < 30; i++) m.tickHeat(1 / 60, 7, true);
  ok(m.heat === 0 && m.auraR === 0, 'furnace: moving vents the heat');
  for (let i = 0; i < 60 * 3; i++) m.tickHeat(1 / 60, 0, false);
  ok(m.heat === 0, 'furnace: no heat outside the fight');
  for (let i = 0; i < 60 * 21; i++) m.trackStill(1 / 60, 0.5, true);
  ok(m.stillBest >= 20, 'standing still is tracked for the Immovable achievement');
}
{
  const m = new HeroMech();
  m.id = 'duelist';
  for (let i = 0; i < 9; i++) m.chainParry();
  const T = heroMechTuning.duelist;
  ok(
    m.chain === T.chainMax && Math.abs(m.damageMul - (1 + T.chainDamage * T.chainMax)) < 1e-9,
    'duelist: parry chain stacks to its cap',
  );
  m.tickChain(T.chainTime - 0.1);
  ok(m.chain === T.chainMax, 'duelist: chain holds while fresh');
  m.tickChain(0.2);
  ok(m.chain === 0 && m.damageMul === 1, 'duelist: chain drops without parries');
  const plain = new HeroMech();
  plain.chainParry();
  ok(plain.damageMul === 1, 'other heroes get no chain damage');
}
