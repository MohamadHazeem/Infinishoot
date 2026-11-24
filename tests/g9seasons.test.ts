import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dom } from './jsdomEnv';
import service from '../server/leaderboard/telemetry.js';
import { dailySeed } from '../src/data/modes';
import { REPLAY_VERSION } from '../src/dev/replay';
import {
  RANKED_EPOCH,
  SEASON_LENGTH,
  bestFive,
  finishChecksum,
  killBonus,
  normalizeBook,
  rankedBoard,
  rankedSeason,
  rankBand,
  seasonEnd,
  seasonRules,
  type Finish,
} from '../src/data/seasons2';

assert.equal(rankedSeason(RANKED_EPOCH - 1), 0);
assert.equal(rankedSeason(RANKED_EPOCH), 1);
assert.equal(seasonEnd(1), RANKED_EPOCH + 42 * 86400000);
assert.equal(rankedSeason(seasonEnd(1) - 1), 1);
assert.equal(rankedSeason(seasonEnd(1)), 2);
assert.deepEqual([1, 2, 10, 11, 50, 51].map(rankBand), [
  'comet',
  'nova',
  'nova',
  'orbit',
  'orbit',
  'scout',
]);
for (const mode of ['standard', 'daily', 'abyss']) assert.equal(rankedBoard(mode, 'normal'), mode);
assert.equal(rankedBoard('standard', 'legend'), 'standard');
for (const [mode, difficulty] of [
  ['standard', 'easy'],
  ['standard', 'assist'],
  ['daily', 'hard'],
  ['abyss', 'invalid'],
  ['weekly', 'normal'],
])
  assert.equal(rankedBoard(mode, difficulty), null);
const choices = new Set<string>();
for (let season = 1; season <= 20; season++) {
  const rules = seasonRules(season);
  assert.deepEqual(rules, seasonRules(season));
  assert.equal(Object.keys(rules).length, 3);
  Object.values(rules).forEach((rule) => choices.add(rule));
  assert.equal(killBonus(rules, true, true, rules.distance === 'near' ? 16 : 81), 90);
  assert.equal(killBonus(rules, false, false, 25), 0);
}
assert.equal(choices.size, 6);
const good = { key: '00000000-deadbeef', points: 120 };
assert.deepEqual(bestFive([good, { ...good, points: 900 }, { key: 'bad', points: 1 }]), [good]);
assert.deepEqual(normalizeBook({ worn: 'comet', boards: [null], awards: [{ rank: 0 }] }), {
  boards: [],
  awards: [],
  worn: null,
});

// Exercise the deployed Worker entry and its actual SQL against SQLite. Its clock
// advances with the Worker clock so a final insertion can be tested across midnight.
const db = new DatabaseSync(':memory:');
db.exec(readFileSync('server/leaderboard/migrations/0003_seasonal_finish.sql', 'utf8'));
let now = RANKED_EPOCH + 86400000,
  databaseTime = now;
db.function('unixepoch', () => Math.floor(databaseTime / 1000));
const kv = new Map<string, { value: string; expires: number }>();
const env = {
  TELEMETRY: {
    prepare(query: string) {
      const statement = db.prepare(query);
      return {
        bind: (...args: (number | string)[]) => ({
          first: () => statement.get(...args),
          all: () => ({ results: statement.all(...args) }),
          run: () => ({ meta: { changes: statement.run(...args).changes } }),
        }),
      };
    },
  },
  SCORES: {
    get(key: string) {
      const v = kv.get(key);
      return v && v.expires > now ? v.value : null;
    },
    put(key: string, value: string, opt: { expirationTtl: number }) {
      kv.set(key, { value, expires: now + opt.expirationTtl * 1000 });
    },
  },
};
const realNow = Date.now,
  realFetch = globalThis.fetch;
const base = 'https://seasons.test';
const alice = 'a'.repeat(32),
  bob = 'b'.repeat(32);
const call = (path: string, body?: object, ip = 'local', bindings = env) =>
  service.fetch(
    new Request(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'CF-Connecting-IP': ip },
      body: body && JSON.stringify(body),
    }),
    bindings,
  );
const board = async (mode = 'standard', season = 1) =>
  (await (await call('/seasons2?board=' + mode + '&season=' + season)).json()).rows;
const history = async (token = alice) =>
  (await (await call('/seasons2/history', { token })).json()).placements;
const post = (f: Finish, token = alice, ip = 'local') =>
  call('/seasons2', { ...f, token, check: finishChecksum(f), version: '2.0.1' }, ip);
function finish(i: number): Finish {
  return {
    season: 1,
    board: 'standard',
    score: 1000 * i,
    bonus: 30,
    stage: 2,
    kills: 20,
    time: 100,
    seed: i,
    hash: 100 + i,
    replayVersion: REPLAY_VERSION,
    difficulty: 'normal',
    day: '2026-11-24',
  };
}
const advance = () => {
  now += 61000;
  databaseTime = now;
};
try {
  Date.now = () => now;
  assert.equal((await call('/seasons2?board=nope')).status, 400);
  assert.equal(
    (
      await call('/seasons2?board=standard', undefined, 'local', {
        ...env,
        TELEMETRY: undefined,
      } as never)
    ).status,
    503,
  );
  const first = finish(1);
  assert.equal((await post(first)).status, 200);
  assert.equal((await post(first)).status, 200);
  assert.equal((await post(first, bob)).status, 409);
  assert.equal((await post({ ...first, score: 1234 })).status, 409);
  assert.equal((await post({ ...first, board: 'abyss' })).status, 409);
  assert.equal((await post(finish(2))).status, 429);
  assert.equal((await post(finish(2), alice, 'different-ip')).status, 429);
  assert.deepEqual(await board(), []);
  assert.deepEqual((await history())[0], {
    season: 1,
    board: 'standard',
    rank: null,
    points: 1030,
    runs: 1,
    band: null,
  });
  for (let i = 2; i <= 6; i++) {
    advance();
    assert.equal((await post(finish(i))).status, 200);
  }
  const total = 20150;
  const leaders = await board();
  assert.equal(leaders[0].points, total);
  assert.deepEqual(Object.keys(leaders[0]).sort(), ['pilot', 'points', 'rank']);
  assert.match(leaders[0].pilot, /^[a-f\d]{8}$/);
  assert.notEqual(leaders[0].pilot, alice.slice(0, 8));
  for (let i = 2; i <= 6; i++) {
    advance();
    assert.equal((await post({ ...finish(i), hash: 200 + i }, bob)).status, 200);
  }
  assert.deepEqual(
    (await board()).map((r: { rank: number }) => r.rank),
    [1, 1],
  );
  assert.deepEqual(await board('abyss'), []);
  assert.deepEqual(await board('daily'), []);
  advance();
  const daily = { ...finish(9), board: 'daily' as const, seed: dailySeed(first.day) };
  assert.equal((await post({ ...daily, seed: 2 })).status, 400);
  assert.equal((await post(daily)).status, 200);
  for (const change of [
    { difficulty: 'assist' },
    { bonus: 9999 },
    { time: 1 },
    { kills: 9000000 },
    { replayVersion: 99 },
    { season: 2 },
  ])
    assert.equal((await post({ ...first, ...change })).status, 400);
  assert.equal(
    (await call('/seasons2', { ...first, token: alice, check: 1, version: '2.0.1' })).status,
    400,
  );
  assert.equal((await call('/seasons2', { token: 'a'.repeat(5000) })).status, 413);
  advance();
  assert.equal((await post({ ...finish(8), board: 'abyss' })).status, 200);
  const active = await history();
  assert.ok(active.every((r: { band: unknown }) => r.band === null));
  assert.equal(active.length, 3);
  databaseTime = seasonEnd(1);
  assert.equal((await post(finish(7))).status, 429);
  now = databaseTime;
  assert.equal((await post(finish(7))).status, 400);
  assert.equal((await post(first)).status, 200);
  assert.equal((await post(daily)).status, 200);
  const closed = await history();
  assert.equal(closed.find((r: Finish) => r.board === 'standard').band, 'comet');
  assert.equal(closed.find((r: Finish) => r.board === 'daily').band, null);
  assert.deepEqual(await board('standard', 2), []);

  // Route the real game client to the Worker in memory. Test-link qualification
  // ends before startSolo. No request leaves this process.
  dom.reconfigure({ url: 'http://localhost/?test&server=' + encodeURIComponent(base) });
  const { Game, cheats } = await import('../src/game/game');
  const { Input } = await import('../src/core/input');
  const { settings } = await import('../src/game/settings');
  const { ENEMIES } = await import('../src/data/enemies');
  const { save } = await import('../src/game/save');
  const { saveJson } = await import('../src/core/storage');
  const { seasonBook, syncSeasonHistory, wearBand, RankedSeasonRun } =
    await import('../src/game/seasons2');
  const { openRankedSeason, framedTitle } = await import('../src/ui/rankedSeasons');
  const { seasonUi } = await import('../src/game/systems/season');
  const { setLanguage } = await import('../src/i18n');
  const { replayHash } = await import('../src/game/systems/ci2');
  const { timeState } = await import('../src/game/systems/time');
  dom.reconfigure({ url: 'http://localhost/' });
  (globalThis as any).__APP_VERSION__ = '2.0.1';
  let submitted: Promise<Response> | undefined;
  globalThis.fetch = (url, init) => {
    const path = new URL(String(url), base);
    if (path.origin !== base || !path.pathname.startsWith('/seasons2'))
      return Promise.resolve(new Response('{}', { status: 503 }));
    const response = call(path.pathname + path.search, init?.body && JSON.parse(String(init.body)));
    if (path.pathname === '/seasons2' && init?.method === 'POST')
      submitted = response.then((r) => r.clone());
    return response;
  };
  assert.deepEqual(await syncSeasonHistory(), []);
  assert.equal(localStorage.getItem('infinishoot.rankedPilot.v1'), null);
  saveJson('rankedPilot.v1', alice);
  assert.equal((await syncSeasonHistory())?.length, 3);
  assert.equal(seasonBook().awards.length, 1);
  await syncSeasonHistory();
  assert.equal(seasonBook().awards.length, 1);
  wearBand('nova');
  assert.equal(framedTitle(), '');
  wearBand('comet');
  assert.match(framedTitle(), /Comet Captain/);
  settings.mode = 'standard';
  settings.difficulty = 'normal';
  settings.cinematics = 'off';
  const g = new Game(
    new Input(document.querySelector('#game')!),
    16 / 9,
    document.querySelector('#hud')!,
    document.querySelector('#reticle')!,
  );
  g.startSolo();
  g.closeShop();
  const timeline = timeState(g).tl;
  const beforeKills = timeline.record(g);
  for (let i = 0; i < 10; i++) {
    const e = g.enemies.spawn(
      ENEMIES.swarmer,
      g.hero.player.x + 3,
      g.hero.player.z,
      g.spawnOpts({ instant: true }),
    );
    e.exposeT = 1;
    e.state = 'windup';
    g.killEnemy(e, 'buster', g.hero);
  }
  const mirror = new RankedSeasonRun();
  const boss = g.enemies.spawn(
    ENEMIES.pumpking,
    g.hero.player.x,
    g.hero.player.z,
    g.spawnOpts({ instant: true }),
  );
  const reward = seasonRules(2).supply;
  const wallet = () => (reward === 'gold' ? g.hero.gold : g.hero.rerollsLeft);
  const opening = wallet();
  g.rankedSeason.kill(g, boss, null);
  assert.equal(wallet(), opening + (reward === 'gold' ? 2 : 1));
  const packet = g.rankedSeason.snapshot()!.slice();
  mirror.mirror(g, packet);
  assert.deepEqual(mirror.snapshot(), packet);
  mirror.kill(g, boss, null);
  assert.equal(wallet(), opening + (reward === 'gold' ? 2 : 1));
  mirror.mirror(g, undefined);
  assert.equal(mirror.snapshot(), undefined);
  const afterKills = timeline.record(g);
  timeline.restore(g, beforeKills, 'visual');
  assert.deepEqual(g.rankedSeason.snapshot(), packet);
  timeline.restore(g, beforeKills, 'full');
  assert.equal(g.rankedSeason.snapshot()![3], 0);
  assert.equal(g.rankedSeason.snapshot()![4], 0);
  timeline.restore(g, afterKills, 'full');
  assert.deepEqual(g.rankedSeason.snapshot(), packet);
  g.runTime = 100;
  const sum = g.summary(g.hero),
    hash = replayHash(g),
    xp = save.seasonPass.xp;
  g.bankAndShow(sum);
  assert.equal((await submitted)?.status, 200);
  const stored = db.prepare('SELECT * FROM seasonal_finish WHERE season=2').get()!;
  assert.equal(stored.hash, hash);
  assert.equal(stored.score, sum.score);
  assert.ok(Number(stored.bonus) >= 600);
  assert.equal(seasonBook().boards[0].runs[0].points, stored.points);
  assert.ok(save.seasonPass.xp > xp);
  g.bankAndShow(sum);
  assert.equal(seasonBook().boards[0].runs.length, 1);
  // A watched solo replay is opened with ?seed. It needs the same boss supplies,
  // while both the device record and the live board must ignore its finish.
  for (const preview of ['seed=7', 'season=off']) {
    dom.reconfigure({ url: 'http://localhost/?' + preview });
    g.startRun({ seed: 7, difficulty: 'normal' });
    g.closeShop();
    const replayWallet = wallet();
    g.rankedSeason.kill(g, boss, null);
    assert.equal(wallet(), replayWallet + (reward === 'gold' ? 2 : 1));
    g.runTime = 30;
    g.score = 1000;
    submitted = undefined;
    g.bankAndShow(g.summary(g.hero));
    assert.equal(submitted, undefined);
    assert.equal(seasonBook().boards[0].runs.length, 1);
  }
  dom.reconfigure({ url: 'http://localhost/' });
  g.startRun();
  g.closeShop();
  g.score = 100;
  g.runTime = 15;
  g.bankAndShow(g.summary(g.hero), true);
  g.startRun();
  g.closeShop();
  cheats.god = true;
  g.update(1 / 60);
  cheats.god = false;
  g.score = 100;
  g.runTime = 15;
  g.bankAndShow(g.summary(g.hero));
  assert.equal(seasonBook().boards[0].runs.length, 1);
  // The trophy remains usable offline, even when the configured service goes away.
  globalThis.fetch = async () => {
    throw Error('offline');
  };
  assert.equal(await syncSeasonHistory(), null);
  assert.equal(seasonBook().worn, 'comet');
  await setLanguage('ar');
  seasonUi(g).open();
  document.querySelector<HTMLButtonElement>('[data-sp=ranked]')!.click();
  assert.equal(g.screens.current, 'ranked-season');
  document.querySelector<HTMLButtonElement>('[data-board=daily]')!.click();
  assert.equal(document.querySelector('[data-board=daily]')?.getAttribute('aria-pressed'), 'true');
  assert.match(document.querySelector('#scr-ranked-season')!.textContent!, /المواسم التنافسية/);
  document.querySelector<HTMLButtonElement>('#scr-ranked-season [data-back]')!.click();
  assert.equal(g.screens.current, 'season');
  openRankedSeason(g);
  assert.match(framedTitle(), /قائد المذنّب/);
  console.log(
    'Season calendar, six rules, D1 receipts, placement, rollover, cosmetics, game banking and Arabic navigation passed.',
  );
} finally {
  Date.now = realNow;
  globalThis.fetch = realFetch;
  db.close();
}
