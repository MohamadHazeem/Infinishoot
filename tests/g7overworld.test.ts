import { seedRandom } from './jsdomEnv';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input';
import { CAMPAIGN_KEY, NEMESIS_HISTORY_KEY, loadJson, saveJson } from '../src/core/storage';
import { BIOMES, biomeForce } from '../src/data/biomes';
import { ISLANDS, ports, legCount } from '../src/data/islands';
import { ENEMIES } from '../src/data/enemies';
import { Game } from '../src/game/game';
import { allowedVoyage, liberate, normalizeChart } from '../src/game/overworld';
import { settings } from '../src/game/settings';
import { setLanguage } from '../src/i18n';

const ids = ISLANDS.map((s) => s.id);
assert.deepEqual(new Set(ids), new Set(BIOMES.map((b) => b.id)));
assert.equal(ISLANDS.length, new Set(ids).size);
assert.deepEqual(normalizeChart(null), { log: [], hunts: {} });
assert.deepEqual(
  normalizeChart({ log: ['fast', null, 'fast'], hunts: { dunes: { stories: [null] } } }).log,
  ['fast'],
);
const c = normalizeChart({ log: [], extraPower: 9999 });
assert.ok(!allowedVoyage(c, 1, 'coast'));
assert.ok(!allowedVoyage(c, -1, 'coast'));
assert.ok(!allowedVoyage(c, 0, 'market'));
for (let i = 0; i < ISLANDS.length; i++) {
  assert.ok(allowedVoyage(c, i, 'coast'));
  liberate(c, i, 'fast');
  liberate(c, i, 'shielded');
  assert.equal(c.log.length, i + 1);
  assert.equal(c.log[i], 'fast', 'replaying never overwrites the first liberation');
}
assert.deepEqual(ports(1, ISLANDS[1]), ['coast', 'market']);
assert.deepEqual(ports(2, ISLANDS[2]), ['coast', 'market', 'rest']);
assert.equal(legCount(ISLANDS[3], 'ferry'), 1);
assert.equal(legCount(ISLANDS[3], 'rest'), 2);

seedRandom(984);
settings.difficulty = 'normal';
const g = new Game(
  new Input(document.querySelector('canvas')!),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
const q = (s: string) => document.querySelector<HTMLElement>(s)!;
const click = (s: string) => {
  assert.ok(q(s), s);
  q(s).click();
};
const chart = () => normalizeChart(loadJson(CAMPAIGN_KEY, null));
function open() {
  g.screens.show('play');
  click('#scr-play [data-campaign]');
}
function sail() {
  click('#scr-overworld [data-sail]');
  assert.equal(g.preShop, true);
}
function bossClear() {
  g.boss = null;
  g.director.bossSpawned = true;
  g.stageClear();
}

open();
assert.equal(g.screens.current, 'overworld');
click('[data-island="3"]');
assert.equal(q('#scr-overworld [data-sail]'), null);
click('[data-island="0"]');
sail();
const power = () => [
  g.level,
  g.hero.gold,
  g.hero.player.hp,
  g.hero.stats.maxHp,
  g.hero.weapons.length,
  g.hero.synergy.slots.length,
];
const initialPower = power();
g.closeShop();
g.hero.dashes = 8;
bossClear();
assert.equal(g.screens.current, 'overworld');
assert.equal(chart().log[0], 'fast');
assert.equal(q('#scr-overworld h2').textContent, 'Sunset Dunes');
click('[data-passage="market"]');
sail();
assert.deepEqual(power(), initialPower);
g.closeShop();
assert.equal(biomeForce.key, 'dunes');
assert.equal(g.rollEliteMod(ENEMIES.charger), 'fast');
g.spawnBoss(ENEMIES.king);
assert.equal(g.boss, null, 'first leg ends at the harbour');
bossClear();
assert.equal(g.bossesRun, 0);
g.openShop();
assert.equal(g.mode, 'shop');
assert.equal(g.preShop, false);
g.closeShop();
assert.equal(g.mode, 'portal');
g.loadStage(2);
g.spawnBoss(ENEMIES.rex);
assert.ok(g.boss?.alive);
bossClear();
assert.equal(chart().log.length, 2);
click('[data-passage="rest"]');
sail();
g.closeShop();
bossClear();
g.player.hp = 10;
g.openShop();
assert.equal(g.player.hp, 10 + 0.2 * g.player.maxHp);
assert.equal(g.mode, 'portal');
g.loadStage(2);
bossClear();
click('[data-passage="ferry"]');
sail();
g.closeShop();
assert.equal(biomeForce.key, 'neon');
g.spawnBoss(ENEMIES.king);
assert.ok(g.boss?.alive, 'ferry gets the island boss on the first stage');

g.enemies.clear();
const killer = g.enemies.spawn(ENEMIES.charger, 6, 2);
g.hero.revivesLeft = 0;
g.hero.petState.reviveUsed = true;
g.player.invuln = 0;
g.player.hp = 1;
g.hurtHero(g.hero, 20, killer.x, killer.z, killer);
assert.equal(chart().hunts.neon.stories[0].foe, 'charger');
assert.equal(chart().log.length, 3);
g.endRun();
assert.equal(g.screens.current, 'gameover');
g.retry();
assert.equal(g.screens.current, 'overworld');
await setLanguage('ar');
assert.ok(q('.ow-rival').textContent!.includes('طليق'));
sail();
g.closeShop();
assert.equal(g.nemesis.history.stories[0].id, chart().hunts.neon.stories[0].id);
assert.deepEqual(power().slice(2), initialPower.slice(2));
g.director.time = 20;
for (let i = 0; i < 30 && !g.nemesis.uid; i++) {
  g.runTime += 1;
  g.nemesis.step(1);
}
assert.ok(g.nemesis.uid, 'the saved rival actually returns in the arena');
assert.equal(g.nemesis.story?.id, chart().hunts.neon.stories[0].id);
g.goTitle();
assert.equal(biomeForce.key, null);
assert.equal(loadJson(NEMESIS_HISTORY_KEY, null), null, 'ordinary hunts have their own history');

// Apply a real host chart through the reliable join and snapshot paths. The guest cannot
// launch, persist the shared chart, or leak the pinned biome into their next solo run.
const guest = { log: ['shielded'], hunts: {} };
saveJson(CAMPAIGN_KEY, guest);
g.role = 'client';
const remoteChart = chart();
remoteChart.log = ['fast', 'shielded', 'fast'];
const wire = JSON.stringify([{ index: 3, passage: 'ferry', won: false }, remoteChart]);
g.onClientMessage({ t: 'islandChart', seed: 28, chart: wire });
assert.equal(biomeForce.key, 'neon');
g.clientStart(28, 0, [{ name: 'Guest' }]);
g.clientStage(1, 28);
g.mode = 'shop';
remoteChart.log.push('shielded');
g.applyGameplayNet({
  chart: JSON.stringify([{ index: 3, passage: 'ferry', won: true }, remoteChart]),
});
assert.equal(g.screens.current, 'overworld');
assert.equal(q('#scr-overworld [data-sail]'), null);
assert.deepEqual(chart(), guest);
g.applyGameplayNet({ chart: wire });
g.host = { broadcast() {}, send() {} } as unknown as NonNullable<typeof g.host>;
g.role = 'host'; // migrated captain continues the shared chart in memory
g.mode = 'fight';
g.stageClear();
assert.deepEqual(chart(), guest);
g.host = null;
g.role = 'solo';
g.goTitle();
open();
assert.equal(q('.ow-count b').textContent!.includes('1'), true);
assert.deepEqual(chart(), guest);
assert.equal(biomeForce.key, null);
