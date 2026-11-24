import './jsdomEnv';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { SpatialHash, StaticBoxGrid, type SpatialBucket } from '../src/core/spatialHash';
import { resolveCircleVsBoxes } from '../src/world/collision';
import { Bullets, Team } from '../src/game/bullets';
import { enemiesInRadius } from '../src/game/systems/combat';
import { Pickups, PickupType } from '../src/game/pickups';
import { Enemies, type Enemy } from '../src/game/enemies';
import { ENEMIES } from '../src/data/enemies';
import type { Game } from '../src/game/game';
import { WEAPONS } from '../src/data/weapons';
import { Missiles } from '../src/game/weapons/missiles';
import type { WeaponCtx } from '../src/game/weapons/base';

const boxes = [
  { minX: -65, minZ: -4.25, maxX: -62.75, maxZ: -1.25 },
  { minX: 3.1, minZ: 0, maxX: 5, maxZ: 6, gap: true },
  { minX: 63.75, minZ: 3, maxX: 65.5, maxZ: 7 },
];
const grid = new StaticBoxGrid(boxes);
for (const x of [-66, -64.25, -64, -63.1, -62, -61.9, 0, 2.9, 3.1, 5.2, 62.99, 63.9, 64, 66]) {
  for (let z = -6; z < 9; z += 0.25) for (const r of [0.1, 1, 1.01, 2.1]) {
    const pos = { x, z }, expected = { x, z };
    assert.equal(grid.resolveCircle(pos, r), resolveCircleVsBoxes(expected, r, boxes));
    assert.deepEqual(pos, expected);
    assert.equal(grid.hitSolid(x, z, r), resolveCircleVsBoxes({ x, z }, r, boxes.filter(b => !b.gap)));
  }
}

const hash = new SpatialHash<Enemy>();
const first = { x: 0, z: 0, radius: 2, alive: true, hp: 1 } as Enemy;
const second = { ...first } as Enemy;
const game = { hash } as Game;
hash.insert(first, 0, 0, 2);
hash.insert(second, 0, 0, 2);
const result: Enemy[] = [];
assert.deepEqual(enemiesInRadius.call(game, 0, 0, 4, result), [first, second]);
const nearby: SpatialBucket<Enemy>[] = [];
const nBuckets = hash.queryBuckets(0, 0, 4, nearby);
const entries: Enemy[] = [];
const nEntries = hash.queryInto(0, 0, 4, entries);
assert.deepEqual(nearby.slice(0, nBuckets).flatMap(b => b.items.slice(0, b.n)), entries.slice(0, nEntries));
first.hp = 0;
assert.deepEqual(enemiesInRadius.call(game, 0, 0, 4, result), [second]);
hash.clear();
hash.insert(first, 65536, 0, 0);
assert.equal(hash.queryInto(0, 0, 0, result), 1);
assert.equal(result[0], first);

const pool = new Enemies(new Scene());
const slug = Object.values(ENEMIES).find(def => def.ooze)!;
const normal = pool.spawn(slug, 0, 0);
pool.spawn({ ...slug, id: 'custom-slug' }, 2, 0);
assert.equal(pool.oozeCount, 2);
pool.kill(normal);
pool.kill(normal);
pool.spawn(ENEMIES.bee, 0, 0);
assert.equal(pool.oozeCount, 1);
pool.clear();
assert.equal(pool.oozeCount, 0);

// A volley shares its lookup, while each launch keeps its own random heading and target.
const missiles = new Missiles(WEAPONS.missiles, new Scene());
Object.defineProperty(missiles, 'p', { value: { count: 3, cd: 1, radius: 1, dmg: 1 } });
const options = [pool.spawn(ENEMIES.bee, 8, 0), pool.spawn(ENEMIES.bee, -8, 0)];
let lookups = 0;
const missileCtx = {
  player: { dead: false, x: 0, z: 0 }, stats: { cooldownMul: 1 }, hash: new SpatialHash<Enemy>(),
  inRadius: () => { lookups++; return options; }, particles: { burst() {} }, sound() {},
} as unknown as WeaponCtx;
const random = Math.random;
const rolls = [0, 0.8, 0, 0.1, 0, 0.9];
try {
  let draw = 0;
  Math.random = () => rolls[draw++];
  missiles.update(0.5, missileCtx);
  assert.equal(draw, rolls.length);
  assert.equal(lookups, 1);
  const volley = missiles as unknown as { list: { targetUid: number }[] };
  assert.deepEqual(volley.list.map(m => m.targetUid), [options[1].uid, options[0].uid, options[1].uid]);
} finally {
  Math.random = random;
}

const bullets = new Bullets(new Scene());
const spawn = { x: 0, z: 0, dirX: 1, dirZ: 0, speed: 1, life: 1, radius: 1, damage: 1, knockback: 0, team: Team.Player, color: '#9742cc', width: 1, length: 1 };
bullets.spawn(spawn);
bullets.spawn({ ...spawn, color: 0x31245a });
assert.equal(bullets.colorHex(0), 0x9742cc);
bullets.setColor(1, '#ffe890');
bullets.kill(0);
assert.equal(bullets.colorHex(0), 0xffe890);
bullets.clear();
bullets.spawn({ ...spawn, color: 0 });
assert.equal(bullets.colorHex(0), 0);

const loot = new Pickups(new Scene());
const collectors = [{ x: 0, z: 0, magnet: 1, alive: true }, { x: 15, z: 0, magnet: 3, alive: true }];
for (const x of [6, 8, 35]) loot.spawn(PickupType.Gem, x, 0);
loot.age.fill(1);
loot.vx.fill(0);
loot.vz.fill(0);
loot.update(1 / 60, collectors, () => assert.fail());
assert.deepEqual(Array.from(loot.pulled.slice(0, 3)), [0, 1, 0]);
loot.vacuum = true;
loot.update(1 / 60, collectors, () => assert.fail());
assert.deepEqual(Array.from(loot.pulled.slice(0, 3)), [1, 1, 1]);

const { RigOverlay } = await import('../src/render/rigOverlay');
const { createRetroMaterial } = await import('../src/render/retroMaterial');
const { BoxGeometry, Group, Mesh } = await import('three');
const root = new Group(), paint = createRetroMaterial({ color: '#ffcd75' });
const plateA = new Mesh(new BoxGeometry(), paint), plateB = new Mesh(new BoxGeometry(), paint);
root.add(plateA, plateB);
const overlay = new RigOverlay(root);
overlay.batchPlates();
const batch = root.getObjectByName('heroPlates') as typeof plateA;
assert.ok(batch.visible && plateA.layers.mask === 0 && plateB.layers.mask === 0);
assert.equal(batch.material.uniforms.uColor, paint.uniforms.uColor);
overlay.restorePlates();
assert.ok(!batch.visible && plateA.layers.mask === 1 && plateB.layers.mask === 1);
plateA.scale.x = -1;
overlay.batchPlates();
assert.ok(!batch.visible && plateB.layers.mask === 1);
plateA.scale.x = 1;
plateB.layers.set(2);
overlay.batchPlates();
assert.ok(!batch.visible && plateB.layers.mask === 4);
overlay.dispose();
assert.equal(root.getObjectByName('heroPlates'), undefined);

const { Hud } = await import('../src/ui/hud');
const { ToastQueue, titleCardUp } = await import('../src/ui/toastQueue');
const queue = new ToastQueue();
queue.push('first', 3, false);
queue.push('second', 3, false);
let visibilityChecks = 0;
const blocked = () => { visibilityChecks++; return true; };
assert.equal(queue.update(0.5, blocked), null);
assert.equal(visibilityChecks, 0);
assert.equal(queue.update(1, blocked), null);
assert.equal(visibilityChecks, 1);
assert.equal(queue.update(0, false)?.msg, 'second');
const reveal = document.createElement('div');
reveal.className = 'cn-reveal';
document.body.append(reveal);
assert.equal(titleCardUp(), true);
reveal.hidden = true;
assert.equal(titleCardUp(), false);
reveal.remove();
const minimap = document.createElement('canvas');
const view = { mmT: 100, el: () => minimap } as unknown as InstanceType<typeof Hud>;
const clock = performance.now;
try {
  performance.now = () => 165.99;
  assert.equal(Hud.prototype.minimapDue.call(view), false);
  minimap.hidden = true;
  assert.equal(Hud.prototype.minimapDue.call(view), true);
  minimap.hidden = false;
  performance.now = () => 166;
  assert.equal(Hud.prototype.minimapDue.call(view), true);
} finally {
  performance.now = clock;
}

// A slow encoder may hold one bitmap. Pause/reset must discard old replies
// and release snapshots that finish after their worker has terminated.
const { HighlightRecorder } = await import('../src/platform/clips');
const encoders: FakeEncoder[] = [];
class FakeEncoder {
  sent = 0;
  terminated = false;
  onmessage!: (event: { data: { time: number; blob: Blob } }) => void;
  constructor() { encoders.push(this); }
  postMessage() { this.sent++; }
  terminate() { this.terminated = true; }
}
const globals = ['Worker', 'OffscreenCanvas', 'createImageBitmap'] as const;
const saved = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
let closed = 0;
try {
  Object.assign(globalThis, {
    Worker: FakeEncoder,
    OffscreenCanvas: class {},
    createImageBitmap: async () => ({ close() { closed++; } }),
  });
  const recorder = new HighlightRecorder();
  Object.defineProperty(recorder, 'supported', { value: true });
  recorder.capture(minimap, 0.05);
  recorder.capture(minimap, 0.05);
  await Promise.resolve();
  assert.equal(encoders[0].sent, 1);
  const frame = { time: 0.05, blob: new Blob(['frame']) };
  encoders[0].onmessage({ data: frame });
  assert.deepEqual(recorder.ring.snapshot(), [frame]);
  recorder.capture(minimap, 0.05);
  recorder.reset();
  assert.ok(encoders[0].terminated);
  await Promise.resolve();
  assert.equal(closed, 1);
  recorder.capture(minimap, 0.05);
  encoders[0].onmessage({ data: frame });
  assert.equal(recorder.ring.count, 0);
  await Promise.resolve();
  assert.equal(encoders[1].sent, 1);
  encoders[1].onmessage({ data: frame });
  assert.equal(recorder.ring.count, 1);
  recorder.stop();
  assert.ok(encoders[1].terminated);
} finally {
  globals.forEach((key, i) => {
    if (saved[i]) Object.defineProperty(globalThis, key, saved[i]!);
    else Reflect.deleteProperty(globalThis, key);
  });
}
