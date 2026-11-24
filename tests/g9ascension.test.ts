import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import './jsdomEnv';
import worker from '../server/leaderboard/worker.js';

const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { settings } = await import('../src/game/settings');
const { save, saveLock } = await import('../src/game/save');
const {
  gauntletProfile: profile,
  normalizeGauntlet,
  recordAscensionVictory,
  ASCENSIONS,
} = await import('../src/data/ascension');
const { ABYSS_MUTATIONS: cards, mutationDeck } = await import('../src/data/abyssMutations');
const { abyss, abyssRecords, abyssBoard, mutationText } = await import('../src/game/abyss');
const G = await import('../src/game/systems/gauntlet');
const { ENEMIES } = await import('../src/data/enemies');
const { isoWeek } = await import('../src/data/weekly');
const { localize, setLanguage } = await import('../src/i18n');
const { visibleModes } = await import('../src/ui/menuRun');
const { ascensionBadge } = await import('../src/ui/ascensionBadges');

assert.equal(new Set(ASCENSIONS.map((t) => t.badge)).size, 20);
assert.equal(new Set(ASCENSIONS.map((_, i) => ascensionBadge(i + 1))).size, 20);
assert.equal(ascensionBadge(0), '');
const old = normalizeGauntlet({ selected: 17, unlocked: 19, cleared: 18, victory: true, title: 3 });
assert.deepEqual(
  [old.unlocked, old.selected, old.cleared, old.title, old.badge],
  [19, 17, 18, 3, 0],
);
Object.assign(profile, old);
recordAscensionVictory(19, true);
assert.deepEqual([profile.unlocked, profile.cleared, profile.badge], [20, 19, 19]);
profile.badge = 4;
recordAscensionVictory(19, true);
assert.equal(profile.badge, 4);
assert.equal(normalizeGauntlet({ ...old, badge: 20 }).badge, 18);
assert(!visibleModes(false, 'standard').some((m) => m.id === 'abyss'));
assert(visibleModes(true, 'standard').some((m) => m.id === 'abyss'));

assert.equal(cards.length, 30);
assert.equal(new Set(cards.map((c) => c.name)).size, 30);
assert.equal(new Set(mutationDeck(13, 0)).size, 30);
assert.deepEqual(mutationDeck(13, 0), mutationDeck(13, 0));
assert.notDeepEqual(mutationDeck(13, 0), mutationDeck(13, 1));
await setLanguage('ar');
for (const tier of ASCENSIONS)
  for (const value of [tier.name, tier.desc, tier.badge])
    assert.match(localize(value), /[\u0600-\u06ff]/);
for (let i = 0; i < cards.length; i++) {
  assert(ENEMIES[cards[i].enemy]);
  assert.match(localize(cards[i].name), /[\u0600-\u06ff]/);
  assert.match(mutationText(i), /[\u0600-\u06ff]/);
}
await setLanguage('en');
assert.deepEqual(abyssRecords({ best: 13, weekly: 7, week: 'old' }, 'now'), {
  best: 13,
  weekly: 0,
  week: 'now',
});
assert.equal(abyssRecords({ best: '99', weekly: -2 }).best, 0);

const g = new Game(
  new Input(document.querySelector('canvas')!),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
settings.mode = 'standard';
settings.difficulty = 'normal';
settings.bossIntros = false;
save.lifetime.runs++;
g.screens.show('modes');
const previousBadge = profile.badge;
document.querySelector<HTMLButtonElement>('[data-act=g-badge]')!.click();
assert.equal(profile.badge, previousBadge + 1);
profile.selected = 20;
g.startSolo();
assert.equal(g.ascensionTier, 20);
assert.equal(g.difficulty.id, 'hard');
assert.equal(g.hero.shopHealed, true);
g.hero.gold = 99;
g.hero.shopRerolls = 1;
assert(g.hero.reroll());
assert.equal(g.hero.gold, 99);
assert.equal(g.hero.interest, 0);
g.hero.player.hp = 1;
assert.equal(g.hero.heal(), 'HEALING SEALED');
g.closeShop();
g.hero.gold = 99;
g.hero.rerollsLeft = 3;
g.loadStage(2);
assert.equal(g.rollEliteMod(ENEMIES.zippy), 'shielded');
assert.equal(G.challengeState(g).shieldIssued, true);
assert.equal(g.hero.rerollsLeft, 0);
assert.equal(g.hero.gold, 10);
assert.equal(G.challengeState(g).mutators[3], 1);
g.stageClear();
g.openShop();
assert.equal(g.hero.rerollCost, 0);
assert.equal(G.challengeState(g).shopLeft, 20);
if (g.screens.current === 'relic') {
  G.gauntletMenuTick(g, 3);
  assert.equal(G.challengeState(g).shopLeft, 20);
  g.screens.show('shop');
}
G.gauntletMenuTick(g, 2);
assert.equal(G.challengeState(g).shopLeft, 18);
g.route.open = true;
G.gauntletMenuTick(g, 30);
assert.equal(G.challengeState(g).shopLeft, 18);
g.route.open = false;

settings.mode = 'abyss';
settings.difficulty = 'easy';
profile.selected = 19;
g.startSolo();
const d = abyss(g)!;
assert.equal(g.difficulty.id, 'normal');
assert.equal(g.ascensionTier, 0);
assert.equal(g.runMode, 'abyss');
assert.equal(g.director.duration, 45);
assert.equal(d.floor, 1);
assert.equal(
  d.stacks.reduce((a, b) => a + b),
  1,
);
g.closeShop();
g.mode = 'fight';
G.gauntletTick(g, 44.5);
assert.equal(g.stage, 1);
g.mode = 'dead';
G.gauntletTick(g, 3);
assert.equal(g.stage, 1);
g.mode = 'fight';
G.gauntletTick(g, 0.5);
assert.equal(g.stage, 2);
assert.equal(g.summary(g.hero).score, 2);
assert.equal(abyssRecords().weekly, 2);
assert.match(await abyssBoard(), /Local floor 2/);
g.loadStage(31);
assert.equal(
  d.stacks.reduce((a, b) => a + b),
  31,
);
assert.equal(d.stacks[d.current], 2);
assert.equal(d.stacks.filter((s) => s === 0).length, 0);
const e = g.enemies.spawn(ENEMIES.zippy, 5, 5, { instant: true });
assert(e.shield > 0);
const b = g.enemies.spawn(ENEMIES.bopper, 5, 5, { instant: true });
assert(b.speedMul > 1);
const marks = g.strikes.length;
G.gauntletKill(g, b);
assert.equal(g.strikes.length, marks + 1);
assert.equal(g.strikes.at(-1)!.t, 1.25);
saveLock.on = true;
g.loadStage(32);
assert.equal(abyssRecords().best, 31);
saveLock.on = false;
g.retry();
assert.equal(abyss(g)!.floor, 1);
settings.mode = 'standard';
profile.selected = 0;
g.startSolo();
assert.equal(abyss(g), undefined);
assert.equal(g.enemies.spawn(ENEMIES.zippy, 5, 5, { instant: true }).shield, 0);
Object.assign(profile, normalizeGauntlet(null));
save.achievements = [];
settings.mode = 'abyss';
g.startSolo();
assert.equal(g.runMode, 'standard');
profile.victory = true;
g.role = 'host';
g.host = { broadcast() {}, send() {} } as typeof g.host;
g.runMode = 'abyss';
g.startRun();
assert.equal(g.runMode, 'standard');
assert.equal(abyss(g), undefined);

const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('server/leaderboard/migrations/0003_abyss.sql', 'utf8'));
const db = {
  prepare(q: string) {
    const s = sql.prepare(q);
    return {
      bind: (...args: (string | number)[]) => ({
        first: () => s.get(...args),
        all: () => ({ results: s.all(...args) }),
        run: () => ({ meta: s.run(...args) }),
      }),
    };
  },
  batch: async (ops: { run(): unknown }[]) => {
    sql.exec('BEGIN');
    try {
      const result = ops.map((o) => o.run());
      sql.exec('COMMIT');
      return result;
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  },
};
const send = (body?: object, ip = 'one') =>
  worker.fetch(
    new Request(
      'https://example.invalid/abyss',
      body
        ? { method: 'POST', body: JSON.stringify(body), headers: { 'CF-Connecting-IP': ip } }
        : {},
    ),
    { TELEMETRY: db, SCORES: {} },
  );
const now = Date.now;
try {
  let clock = Date.UTC(2026, 10, 23, 4);
  Date.now = () => clock;
  const week = isoWeek(new Date(clock));
  const a = await (await send({ start: week })).json();
  assert(a.ticket && a.pilot);
  assert.equal((await send({ start: week })).status, 429);
  const other = await (await send({ start: week }, 'two')).json();
  assert.equal((await send({ ticket: a.ticket, floor: 2 })).status, 422);
  clock += 45000;
  assert.equal((await send({ ticket: a.ticket, floor: 2 })).status, 200);
  assert.equal((await send({ ticket: other.ticket, floor: 2 })).status, 200);
  assert.equal((await send({ ticket: a.ticket, floor: 2 })).status, 200);
  assert.deepEqual((await (await send()).json()).rows, [{ floor: 2, pilot: a.pilot }]);
  clock += 90000;
  assert.equal((await send({ ticket: a.ticket, floor: 4 })).status, 200);
  assert.equal((await send({ ticket: a.ticket, floor: 3 })).status, 422);
  assert.equal((await send({ ticket: a.ticket, floor: 5 })).status, 422);
  assert.equal((await send({ ticket: a.ticket, floor: 1.1 })).status, 400);
  assert.equal((await send({ extra: 'x'.repeat(400) })).status, 413);
  clock += 7 * 86400000;
  assert.deepEqual((await (await send()).json()).rows, []);
  assert.equal((await send({ ticket: a.ticket, floor: 3 })).status, 422);
} finally {
  Date.now = now;
  sql.close();
}
console.log(
  'ok 20 cosmetic tiers, 30 cumulative mutations, floor simulation and weekly first claims',
);
