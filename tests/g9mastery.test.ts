import './jsdomEnv';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import pkg from '../package.json';
import type { Game as GameType } from '../src/game/game';
import type { ReplayFile } from '../src/dev/replay';
import service from '../server/leaderboard/telemetry.js';
import {
  currentWeek,
  speedSeed,
  linkSplit,
  ReplayChain,
} from '../server/leaderboard/mastery/speedrunProtocol.js';

const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { rank, tracks, normalizeCabinet, addMarks, masterySkin } =
  await import('../src/data/mastery');
const { normalCabinet, keepCabinet } = await import('../src/game/mastery');
const { hardcoreProfile, bankLife, keepLife, localHardcoreBoard } =
  await import('../src/game/hardcore');
const { packSpeedrun, speedBest } = await import('../src/game/speedrun');
const { installReplay } = await import('../src/game/systems/ci2');
const { setLanguage } = await import('../src/i18n');
const { save, saveLock } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const { HEROES } = await import('../src/data/heroes');
const { WEAPONS } = await import('../src/data/weapons');

assert.equal(tracks().length, HEROES.length + Object.keys(WEAPONS).length);
const invalid = normalizeCabinet({
  skin: 'h.rookie',
  title: 'missing',
  tracks: { 'w.buster': { kills: -8, clears: Infinity, early: 'true' }, unknown: { kills: 500 } },
});
assert.deepEqual(invalid, {
  title: '',
  skin: '',
  tracks: { 'w.buster': { kills: 0, clears: 0, early: false, flawless: false } },
});
const cabinet = normalizeCabinet(null);
addMarks(cabinet.tracks, 'w.buster', 499);
assert.equal(rank(cabinet.tracks['w.buster']), 0);
addMarks(cabinet.tracks, 'w.buster', 5);
assert.equal(rank(cabinet.tracks['w.buster']), 1);
addMarks(cabinet.tracks, 'w.buster', 0, 0, true);
assert.equal(rank(cabinet.tracks['w.buster']), 2);
const skin = masterySkin('w.buster')!;
assert.equal('add' in skin, false);
keepCabinet({ ...cabinet, title: 'w.buster', skin: 'w.buster' });
assert.equal(normalCabinet().tracks['w.buster'].kills, 500);

const game = new Game(
  new Input(document.querySelector('canvas')!),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
const click = (action: string) => {
  const el = document.querySelector<HTMLButtonElement>('#scr-mastery [data-mx="' + action + '"]');
  assert.ok(el, action);
  assert.ok(el.hasAttribute('data-nav'));
  el.click();
};
settings.cinematics = 'off';
settings.finishers = false;
const ordinary = game.hero.heroDef.id;
game.startRun({ seed: 51, difficulty: 'normal' });
game.closeShop();
const h = game.hero;
const enemy = game.enemies.spawn(ENEMIES.slug, 3, 3);
game.killEnemy(enemy, 'buster', h);
const marks = game.summary(h).mastery!;
assert.equal(marks['h.' + ordinary].kills, 1);
assert.equal(marks['w.buster'].kills, 1);
const mate = game.makeHero(1, 'Mate', [], 'guest');
game.setHeroes([h, mate]);
mate.startRun();
game.spawnBoss(ENEMIES.rex);
game.mvpHurt(h, 1);
game.killEnemy(game.boss!, 'buster', mate);
assert.equal(marks['h.' + ordinary].flawless, false);
assert.equal(game.summary(mate).mastery!['h.' + mate.heroDef.id].flawless, true);
game.stageClear();
assert.equal(marks['w.buster'].clears, 1);
game.loadStage(2);
const buster = h.weapons.find((w) => w.def.id === 'buster')!;
buster.evolve(0);
game.evolveFx(h, buster.name, buster.color);
assert.equal(marks['w.buster'].early, true);
const transfer = structuredClone(game.mastery.checkpoint());
for (const step of [180, 181, 182, 183]) {
  game.stepN = step;
  const packet = game.buildSnapshot(mate, []);
  assert.equal(!!packet.mastery, step < 183, 'staggered 5–8 player checkpoints');
}
game.role = 'client';
game.mastery.mirror(transfer);
game.role = 'solo';
assert.deepEqual(game.summary(mate).mastery, transfer!.marks[1]);
game.setHeroes([h]);
game.endRun(true);
assert.equal(normalCabinet().tracks['h.' + ordinary].kills, 1);
const normalState = JSON.stringify(normalCabinet());
const ordinarySave = JSON.stringify(save);
game.screens.show('extras');
const masteryEntry = [...document.querySelectorAll<HTMLButtonElement>('#scr-extras button')].find(
  (b) => b.textContent === 'MASTERY',
)!;
assert.ok(masteryEntry);
masteryEntry.click();
click('hardcore');
click('warn');
await setLanguage('ar');
assert.equal(game.mastery.mode, null);
assert.match(document.querySelector('#scr-mastery h1')!.textContent!, /[\u0600-\u06ff]/);
click('cancel');
click('warn');
click('confirm');
assert.equal(game.mastery.mode, 'hardcore');
assert.equal(game.hero.phoenixUsed, true);
const life = hardcoreProfile().life;
assert.ok(life);
game.closeShop();
game.killEnemy(game.enemies.spawn(ENEMIES.slug, 3, 3), 'buster', game.hero);
game.runTime = 61;
game.quitRun();
assert.equal(hardcoreProfile().cabinet.tracks['w.buster'].kills, 1);
assert.equal(localHardcoreBoard().length, 1);
click('back');
assert.equal(saveLock.on, false);
assert.equal(JSON.stringify(save), ordinarySave);
click('warn');
click('confirm');
assert.equal(hardcoreProfile().life, life);
game.hero.revivesLeft = 1;
game.hero.player.dead = true;
game.onHeroDown(game.hero);
assert.equal(hardcoreProfile().life, '');
assert.equal(game.hero.revivesLeft, 1);
game.endRun();
click('back');
assert.equal(bankLife(life, marks), false);
keepLife({ life, cabinet });
assert.deepEqual(hardcoreProfile().cabinet, normalizeCabinet(null));
assert.equal(JSON.stringify(normalCabinet()), normalState);
assert.equal(JSON.stringify(save), ordinarySave);

await setLanguage('en');
installReplay(game);
click('speedrun');
click('race');
const attempt = game.mastery.speed!;
assert.equal(game.seed, speedSeed(currentWeek()));
assert.equal(game.hero.heroDef.id, 'rookie');
assert.equal(game.route.on, false);
for (let i = 0; i < 60; i++) game.update(1 / 60);
assert.equal(attempt.clock, 0);
game.closeShop();
for (let i = 0; i < 60; i++) game.update(1 / 60);
const live = (window as any).replay.export() as ReplayFile;
const chain = new ReplayChain(game.seed, live.header.keys.length, live.strings.length);
for (const chunk of live.data) chain.chunk(chunk);
assert.ok(Number.isInteger(chain.finish(live.steps, live.hash!)), 'actual recorder layout');
assert.throws(() => chain.finish(live.steps + 1, live.hash!));
const fill = (g: GameType) => {
  for (let stage = 1; stage <= 4; stage++) {
    if (stage > 1) g.loadStage(stage);
    // Compress the survival stretch here. Exercise real boss spawn, clear, clock and result hooks.
    g.mastery.step(31);
    g.stepN += 1860;
    g.spawnBoss(ENEMIES.rex);
    g.mastery.step(1);
    g.stepN += 60;
    g.stageClear();
  }
};
fill(game);
assert.equal(attempt.splits.length, 8);
assert.equal(game.screens.current, 'mastery');
assert.equal(speedBest()?.ms, attempt.splits[7].ms);
assert.equal(attempt.saveBest(game), false);
click('back');
click('race');
assert.equal(game.mastery.speed!.rival?.stage, 4);
assert.equal(game.mastery.speed!.rival?.week, attempt.week);
game.quitRun();
click('back');
assert.equal(saveLock.on, false);
assert.equal(JSON.stringify(save), ordinarySave);
assert.equal(currentWeek(Date.UTC(2021, 0, 1)), '2020-W53');
assert.notEqual(speedSeed('2020-W53'), speedSeed('2021-W01'));

// Use SQLite for D1's uniqueness and ordering. The same compressed protocol is used in production.
const wallNow = Date.now;
const boardTime = wallNow();
Date.now = () => boardTime; // Check retries in the same rate-limit window even on a loaded runner.
const sql = new DatabaseSync(':memory:');
const db = {
  prepare(q: string) {
    const prepare = (args: (string | number)[]) => ({
      run: () => sql.prepare(q).run(...args),
      all: () => ({ results: sql.prepare(q).all(...args) }),
    });
    return { ...prepare([]), bind: (...args: (string | number)[]) => prepare(args) };
  },
  batch: async (statements: { run(): unknown }[]) => statements.map((s) => s.run()),
};
const kv = new Map<string, unknown>();
const env = {
  TELEMETRY: db,
  SCORES: { get: (k: string) => kv.get(k), put: (k: string, v: unknown) => kv.set(k, v) },
};
const send = (route: string, body?: BodyInit, ip = 'a') =>
  service.fetch(
    new Request('https://board.test/' + route, {
      method: body ? 'POST' : 'GET',
      body,
      headers: { 'CF-Connecting-IP': ip },
    }),
    env,
  );
const hc = { id: crypto.randomUUID(), ms: 95000, kills: 111, stage: 2, score: 4000 };
assert.equal((await send('hardcore', JSON.stringify({ ...hc, stage: 100 }))).status, 400);
assert.equal((await send('hardcore', JSON.stringify(hc))).status, 200);
assert.equal((await send('hardcore', JSON.stringify(hc))).status, 429);
assert.equal((await send('hardcore', JSON.stringify(hc), 'b')).status, 200);
assert.equal((await (await send('hardcore')).json()).rows.length, 1);

const week = currentWeek(),
  seed = speedSeed(week);
let tick = 0,
  link = seed;
const splits = Array.from({ length: 8 }, (_, i) => {
  tick += i % 2 ? 60 : 1800;
  const ms = Math.round((tick * 1000) / 60),
    state = i + 1;
  link = linkSplit(link, i, ms, tick, state);
  return { ms, tick, link, state };
});
const width = 51 + 2 * Math.ceil(live.header.keys.length / 26);
const values: number[] = [];
for (let i = 1; i <= tick; i++) {
  const step = Array(width + 1).fill(0);
  step[1] = 1 / 60;
  step[width] = i % 60 === 0 ? i : -1;
  values.push(...step);
}
const data: number[][] = [];
for (let i = 0; i < values.length; i += 16384) data.push(values.slice(i, i + 16384));
const tape = {
  ...live,
  steps: tick,
  hash: tick,
  complete: true,
  data,
  strings: [''],
  header: { ...live.header, heroes: [{ ...live.header.heroes[0], name: 'PRIVATE PILOT' }] },
};
Object.assign(globalThis, { __APP_VERSION__: pkg.version });
const packed = await packSpeedrun(week, splits, tape);
const res = await send('speedrun', packed);
assert.equal(res.status, 200, await res.clone().text());
const { id } = await res.json();
assert.ok(kv.has('speedrun:tape:' + id));
const archive = await new Response(
  new Blob([kv.get('speedrun:tape:' + id) as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip')),
).text();
assert.equal(archive.includes('PRIVATE PILOT'), false);
assert.equal((await send('speedrun', packed)).status, 429);
assert.equal((await send('speedrun', packed, 'b')).status, 200);
assert.equal((await (await send('speedrun')).json()).rows.length, 1);
assert.equal((await send('speedrun?week=broken')).status, 400);
const bytes = new Uint8Array(await packed.arrayBuffer());
bytes[0] ^= 1;
assert.equal((await send('speedrun', bytes, 'c')).status, 400);
const falseSplits = splits.map((s) => ({ ...s }));
falseSplits[3].ms++;
assert.equal(
  (await send('speedrun', await packSpeedrun(week, falseSplits, tape), 'd')).status,
  400,
);
const wrongKit = {
  ...tape.header,
  heroes: [
    {
      ...tape.header.heroes[0],
      loadout: { primary: 'laser', secondary: 'charge', special: 'bomb' },
    },
  ],
};
assert.equal(
  (await send('speedrun', await packSpeedrun(week, splits, { ...tape, header: wrongKit }), 'e'))
    .status,
  400,
);
assert.equal(
  (
    await send(
      'speedrun',
      await packSpeedrun(week, splits, { ...tape, strings: ['["debugSkipToBoss",[]]'] }),
      'f',
    )
  ).status,
  400,
);
assert.equal((await send('speedrun', new Blob(['x'.repeat(100)]), 'g')).status, 400);
assert.equal((await service.fetch(new Request('https://board.test/hardcore'), {})).status, 503);
sql.close();
Date.now = wallNow;
console.log(
  'Mastery progression, one-life isolation, race ghost, recorder framing and Worker boards passed.',
);
