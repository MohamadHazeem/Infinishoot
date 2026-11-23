import { seedRandom } from './jsdomEnv';
const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const g = new Game(
  new Input(document.querySelector('canvas')!),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
if (process.env.NEMESIS_MEASURE) {
  const { installBot } = await import('../src/dev/bot');
  installBot(g, g.input);
  const { botRun } = window as unknown as { botRun(s: number, god: boolean): unknown };
  const { measureHunts } = await import('../src/game/nemesis');
  console.log(JSON.stringify(await measureHunts(g, (s) => botRun(s, false), seedRandom)));
  process.exit(0);
}

const { default: assert } = await import('node:assert/strict');
const { AdaptiveResistance, damageFamily } = await import('../src/game/adaptive');
const { TROPHY_CHEST, normalizeHistory } = await import('../src/game/nemesis');
const { ENEMIES } = await import('../src/data/enemies');
const { RELICS, RELIC_BY_ID } = await import('../src/data/relics');
const { installPlan, planMods } = await import('../src/mods/registry');
installPlan(planMods([]));
assert.equal(RELIC_BY_ID.r_vendetta?.add?.magnet, 0.2);
assert.ok(!RELICS.some((r) => r.id === 'r_vendetta'), 'mod registry rebuild keeps trophy out of ordinary loot');
const { loadJson, NEMESIS_HISTORY_KEY, saveJson } = await import('../src/core/storage');
const { PickupType } = await import('../src/game/pickups');
const { buildMig, restoreRun } = await import('../src/game/systems/hostmig');
const { setLanguage } = await import('../src/i18n');
const { rivalName } = await import('../src/ui/nemesisUi');

const a = new AdaptiveResistance();
assert.equal(damageFamily(['projectile', 'fire']), 1);
function bin(fire: number, other: number, uid: number) {
  a.record(1, fire);
  a.record(2, other);
  return a.step(10, uid);
}
for (let i = 0; i < 12; i++) bin(60, 40, 1);
assert.equal(a.family, -1, 'exactly 60% does not qualify');
for (let i = 0; i < 11; i++) assert.equal(bin(61, 39, i), false);
assert.equal(a.levels(999), 0);
assert.equal(bin(61, 39, 12), true);
for (let i = 0; i < 20; i++) bin(65, 35, 13 + i);
assert.equal(a.levels(11), 0);
assert.equal(a.levels(12), 1, 'an early spawn never inherits a later tier');
assert.equal(a.levels(100), 5);
bin(50, 50, 100);
assert.equal(a.levels(100), 4);
for (let i = 0; i < 4; i++) bin(0, 0, 100);
assert.equal(a.family, -1);
assert.deepEqual(normalizeHistory({ stories: [42, null, { foe: '__proto__', id: 1, mark: 0 }] }).stories, []);

g.startRun({ seed: 99, difficulty: 'normal' });
g.closeShop();
const rival = g.enemies.spawn(ENEMIES.charger, 6, 2);
const other = g.enemies.spawn(ENEMIES.bopper, -7, 1);
const mate = g.makeHero(1, 'Mate', []),
  third = g.makeHero(2, 'Third', []);
g.setHeroes([g.hero, mate, third]);
const down = (h: typeof mate, attacker: typeof rival) => {
  h.revivesLeft = 0;
  h.petState.reviveUsed = true;
  h.player.invuln = 0;
  h.player.hp = 1;
  g.hurtHero(h, 20, attacker.x, attacker.z, attacker);
};
// Distinct seats. The last hitter loses the vote to the enemy that downed two teammates.
down(mate, rival);
down(third, rival);
down(g.hero, other);
const history = () => normalizeHistory(loadJson(NEMESIS_HISTORY_KEY, null));
assert.equal(history().stories.length, 1);
assert.equal(history().stories[0].foe, 'charger');
assert.equal(g.nemesis.metrics.appearances, 0);
g.setHeroes([g.hero]);
g.startRun({ seed: 100, difficulty: 'normal' });
g.closeShop();
g.director.time = 18;
g.nemesis.step(1 / 60);
const story = g.nemesis.story!;
assert.equal(story.id, history().stories[0].id);
assert.equal(g.nemesis.metrics.appearances, 1);
const hunter = g.enemies.list.find((e) => e.active && e.uid === g.nemesis.uid)!;
assert.ok(hunter.shield > 0 || hunter.hp > ENEMIES.charger.hp * g.spawnOpts().hpMul!);
assert.equal(hunter.dmgMul, g.spawnOpts().dmgMul);
const packet = g.buildSnapshot(g.hero, []);
const migration = buildMig(g);
const client = new Game(
  new Input(document.querySelector('canvas')!),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
client.role = 'client';
client.clientStart(g.seed, 0, [{ name: 'Guest', skin: 'blue' }] as Parameters<typeof client.clientStart>[2]);
client.applySnapshot(packet);
assert.equal(client.nemesis.uid, hunter.uid);
assert.equal(client.nemesis.story?.id, story.id);
assert.ok(client.netEnemies.has(hunter.uid));
await setLanguage('ar');
assert.match(rivalName(story), /[\u0600-\u06ff]/);
await setLanguage('en');
restoreRun(client, migration);
client.role = 'solo';
client.nemesis.step(1 / 60);
assert.equal(client.nemesis.story?.id, story.id);
assert.ok(
  client.enemies.list.some((e) => e.active && e.uid === client.nemesis.uid && e.def.id === 'charger'),
  'migration follows rebuilt UID',
);

g.damage(hunter, 1e6, { source: 'buster' }, g.hero);
assert.equal(history().stories[0].ended, true);
assert.equal(g.nemesis.metrics.defeated, 1);
const chest = g.pickups.value
  .slice(0, g.pickups.count)
  .findIndex((v, i) => v === TROPHY_CHEST && g.pickups.type[i] === PickupType.Chest);
assert.ok(chest >= 0);
const magnet = g.hero.stats.magnet;
g.collect(g.hero, PickupType.Chest, TROPHY_CHEST);
assert.ok(Math.abs(g.hero.stats.magnet - magnet - 0.2) < 1e-8);
g.collect(g.hero, PickupType.Chest, TROPHY_CHEST);
assert.equal(g.hero.relics.filter((id) => id === 'r_vendetta').length, 1);
assert.ok(!RELICS.some((r) => r.id === 'r_vendetta'));
g.nemesis.step(10);
assert.equal(g.nemesis.metrics.appearances, 1);
g.startRun({ seed: 101, difficulty: 'normal' });
g.closeShop();
g.director.time = 18;
g.nemesis.step(1);
assert.equal(g.nemesis.metrics.appearances, 0);

// Real hits from two heroes contribute actual HP loss, capped at overkill.
const old = g.enemies.spawn(ENEMIES.charger, 4, 4);
old.maxHp = old.hp = 100000;
const tag = { source: 'buster', tags: ['fire'] as import('../src/data/tags').Tag[], noStatus: true };
for (let i = 0; i < 12; i++) {
  g.damage(old, 40, tag, g.hero);
  g.damage(old, 60, tag, mate);
  g.nemesis.step(10);
}
const fresh = g.enemies.spawn(ENEMIES.charger, 4, 5);
fresh.maxHp = fresh.hp = 1000;
assert.equal(g.damage(old, 100, tag, g.hero), 100);
assert.equal(g.damage(fresh, 100, tag, g.hero), 96);
assert.equal(g.damage(fresh, 100, { ...tag, tags: ['frost'] }, g.hero), 100);
assert.equal(g.damage(fresh, 100, { ...tag, fixed: true }, g.hero), 100);
g.hero.revivesLeft = 0;
g.hero.petState.reviveUsed = true;
g.player.invuln = 0;
g.player.hp = 1;
g.hurtHero(g.hero, 100, 0, 0, null, 'Lava');
assert.equal(history().stories.length, 1, 'an environmental wipe invents no killer');

// A returned killer can win again and keeps the same identity.
const pending = { ...story, ended: false, wins: 0 };
saveJson(NEMESIS_HISTORY_KEY, { serial: 1, stories: [pending] });
g.startRun({ seed: 102, difficulty: 'normal' });
g.closeShop();
g.director.time = 18;
g.nemesis.step(1);
const returned = g.enemies.list.find((e) => e.active && e.uid === g.nemesis.uid)!;
down(g.hero, returned);
assert.equal(g.nemesis.metrics.wins, 1);
assert.equal(history().stories.length, 1);
assert.equal(history().stories[0].wins, 1);
// A projectile outlives its shooter. The original sniper still wins the vote.
saveJson(NEMESIS_HISTORY_KEY, null);
g.startRun({ seed: 103, difficulty: 'normal' });
g.closeShop();
const sniper = g.enemies.spawn(ENEMIES.sniper, g.player.x - 3, g.player.z);
g.enemyCtx.fireBullet(sniper, 1, 0, 10, 60);
const slot = g.bullets.count - 1;
g.enemies.kill(sniper);
const recycled = g.enemies.spawn(ENEMIES.charger, 15, 15);
assert.equal(recycled, sniper);
g.player.invuln = 0;
g.player.hp = 1;
g.hero.revivesLeft = 0;
g.hero.petState.reviveUsed = true;
g.bullets.x[slot] = g.player.x;
g.bullets.z[slot] = g.player.z;
g.updateBullets(0);
assert.equal(history().stories[0].foe, 'sniper');

// Even with another outstanding story, killing the first cannot schedule a second
// in the same stage. The next stage can inherit that unspent encounter.
const next = { ...pending, id: pending.id + 1, foe: 'bopper', ended: false };
saveJson(NEMESIS_HISTORY_KEY, { serial: 2, stories: [pending, next] });
g.startRun({ seed: 104, difficulty: 'normal' });
g.closeShop();
g.director.time = 18;
g.nemesis.step(1);
const first = g.enemies.list.find((e) => e.active && e.uid === g.nemesis.uid)!;
g.damage(first, 1e6, { source: 'buster', fixed: true }, g.hero);
g.nemesis.step(10);
assert.equal(g.nemesis.metrics.appearances, 1);
g.loadStage(2);
g.director.time = 20;
g.nemesis.step(2);
assert.equal(g.nemesis.metrics.appearances, 2);
assert.equal(g.nemesis.story?.id, next.id);

// An existing guest profile keeps its other rivals when the host confirms a hunt.
const unrelated = { ...next, id: 999999, foe: 'sniper' };
saveJson(NEMESIS_HISTORY_KEY, { serial: 3, stories: [unrelated] });
client.role = 'client';
client.nemesis.reset();
client.applyGameplayNet(g.gameplayNet(g.hero));
assert.deepEqual(
  history().stories.map((s) => s.id),
  [unrelated.id, next.id],
);
const actual = history().stories.find((s) => s.id === next.id)!;
assert.equal(actual.mark, next.mark);
client.applyGameplayNet(g.gameplayNet(g.hero));
assert.equal(history().stories.length, 2, 'snapshot polling does not duplicate a story');

console.log('ok  adaptive cohorts, co-op down attribution, snapshot, migration, scar names and exclusive trophy');
process.exit(0);
