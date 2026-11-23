import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dom, seedRandom, simTimers, jsdomErrors } from './jsdomEnv';
dom.reconfigure({ url: 'http://localhost/?season=off' });
seedRandom(14);
simTimers.install();
const { decodeBoss, encodeBoss, sampleBoss, layoutOnly, resolveLayout, tellTime, moves } =
  await import('../src/game/bossMakerCode');
const { newArena } = await import('../src/editor/arenaData');
const { arenaCode } = await import('../src/editor/codec');
const { keepDesign, localDesigns } = await import('../src/game/bossMaker');
const { bosses, bossWeek } = await import('../server/leaderboard/bosses.js');
const { Game } = await import('../src/game/game');
const { ENEMIES } = await import('../src/data/enemies');
const { Input } = await import('../src/core/input');
const { settings } = await import('../src/game/settings');
const { installBot } = await import('../src/dev/bot');
const { enrageTarget } = await import('../src/game/bossRules');
const { setLanguage } = await import('../src/i18n');

const designs = Array.from({ length: 5 }, (_, i) => sampleBoss(i));
const codes = designs.map(encodeBoss);
assert.equal(new Set(codes).size, 5);
for (let i = 0; i < 5; i++) assert.deepEqual(decodeBoss(codes[i]), designs[i]);
assert.deepEqual(
  new Set(designs.flatMap((d) => d.phases.flat().map((c) => c.move))),
  new Set(moves),
);
for (const corrupt of [
  null,
  '',
  codes[0] + 'x',
  codes[0].replace('ISB1', 'ISB2'),
  codes[0].slice(0, -3),
  'x'.repeat(9999),
])
  assert.equal(decodeBoss(corrupt), null);
for (const phases of [[], [[], [], []], [Array(5).fill({ move: 'wall', tempo: 0 }), [], []]])
  assert.throws(() => encodeBoss({ ...designs[0], phases }));
for (const cue of [
  { move: 'summon', tempo: -1 },
  { move: 'rush', tempo: 1 },
  { move: 'ring', tempo: 3 },
])
  assert.throws(() => encodeBoss({ ...designs[0], phases: [[cue], [cue], [cue]] }));
assert(moves.every((move) => tellTime({ move, tempo: 0 }) >= 0.95));
const a = newArena();
a.rules.heat = ['armor'];
a.name = 'PRIVATE NAME';
const portable = arenaCode(layoutOnly(a));
assert(resolveLayout('2').pieces.every((p) => p.k !== 'lava' && p.k !== 'thorns'));
const tight = newArena();
tight.pieces.push({ k: 'pillar', x: 2, z: -14, r: 0 });
assert.throws(() => resolveLayout(arenaCode(layoutOnly(tight))));
assert.equal(resolveLayout(portable).name, 'CUSTOM ARENA');
assert.deepEqual(resolveLayout(portable).rules.heat, []);
assert.equal(decodeBoss(encodeBoss({ ...designs[0], arena: portable }))!.arena, portable);
a.pieces[1].z = a.pieces[0].z;
assert.throws(() => resolveLayout(arenaCode(layoutOnly(a))));
localStorage.setItem(
  'infinishoot.bossMaker.v1',
  JSON.stringify([false, codes[0], codes[0], 'bad']),
);
assert.deepEqual(localDesigns(), [codes[0]]);

const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('server/leaderboard/migrations/0002_boss_maker.sql', 'utf8'));
const kv = new Map<string, string>();
const env = {
  SCORES: { get: (k: string) => kv.get(k), put: (k: string, v: string) => kv.set(k, v) },
  TELEMETRY: {
    prepare: (s: string) => ({
      bind: (...args: (string | number)[]) => ({
        first: () => sql.prepare(s).get(...args),
        run: () => sql.prepare(s).run(...args),
        all: () => ({ results: sql.prepare(s).all(...args) }),
      }),
    }),
  },
};
const call = (path: string, body?: object, ip = 'test') => {
  const url = new URL('https://test.invalid' + path);
  const req = new Request(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'CF-Connecting-IP': ip },
    body: body ? JSON.stringify(body) : undefined,
  });
  return bosses(req, env, url, {
    json: (v: unknown, status = 200) => Response.json(v, { status }),
  });
};
assert.equal(await call('/scores'), null);
assert.equal((await call('/bosses?page=-1')).status, 400);
assert.equal((await call('/bosses', { code: 'bad' })).status, 400);
assert.equal((await call('/bosses', { code: 'a'.repeat(3000) })).status, 413);
const { id } = await (await call('/bosses', { code: codes[0] })).json();
assert.equal((await call('/bosses', { code: codes[1] })).status, 429);
assert.equal((await (await call('/bosses', { code: codes[0] }, 'second')).json()).id, id);
const vote = { id, ballot: 'abcdef01'.repeat(4), stars: 5 };
assert.equal((await call('/bosses/rate', { ...vote, stars: 6 })).status, 400);
assert.equal((await call('/bosses/rate', vote)).status, 200);
assert.equal((await call('/bosses/rate', vote)).status, 429);
assert.equal((await call('/bosses/rate', { ...vote, stars: 4 }, 'second')).status, 200);
const rows = (await (await call('/bosses')).json()).designs;
assert.equal(rows.length, 1);
assert.equal(rows[0].votes, 1);
assert.equal(rows[0].rating, 4);
assert.equal((await (await call('/bosses/weekly')).json()).designs.length, 0);
sql.prepare('UPDATE maker_vote SET week=?').run(bossWeek() - 1);
assert.equal((await (await call('/bosses/weekly')).json()).designs[0].id, id);
const rivals: string[] = [];
for (let i = 1; i < 5; i++) {
  const ip = 'rival-' + i;
  const design = await (await call('/bosses', { code: codes[i] }, ip)).json();
  rivals.push(design.id);
  assert.equal((await call('/bosses/rate', { ...vote, id: design.id, stars: i }, ip)).status, 200);
}
// During the current week, only the earlier four-star design qualifies for the route.
assert.deepEqual(
  (await (await call('/bosses/weekly')).json()).designs.map((r: { id: string }) => r.id),
  [id],
);
sql.prepare('UPDATE maker_vote SET week=?').run(bossWeek() - 1);
const top = (await (await call('/bosses/weekly')).json()).designs;
assert.deepEqual(
  top.map((r: { rating: number }) => r.rating),
  [4, 4, 3],
);
assert.deepEqual(
  new Set(top.map((r: { id: string }) => r.id)),
  new Set([id, rivals[3], rivals[2]]),
);
assert.deepEqual((await (await call('/bosses?page=1')).json()).designs, []);
assert.equal(bossWeek(Date.UTC(2026, 10, 23)) - bossWeek(Date.UTC(2026, 10, 22)), 1);
sql.close();

if (process.env.G8_WEEKLY_PILOT) {
  // Match scripts/skillbot.mjs. jsdom has no layout to measure during a long cohort.
  const { HudDock } = await import('../src/ui/hudLayout');
  const { MoreCue } = await import('../src/ui/menuFit');
  HudDock.prototype.tick = () => {};
  MoreCue.prototype.watch = () => {};
  const queryAll = document.querySelectorAll.bind(document);
  document.querySelectorAll = (selector: string) => {
    const match = /^#([\w-]+) (.+)$/.exec(selector);
    if (match && !selector.includes(',')) {
      const root = document.getElementById(match[1]);
      if (root) return root.querySelectorAll(':scope ' + match[2]);
    }
    return queryAll(selector);
  };
}
const input = new Input(document.querySelector('#game')!);
const g = new Game(
  input,
  16 / 9,
  document.querySelector('#hud')!,
  document.querySelector('#reticle')!,
);
installBot(g, input);
settings.cinematics = 'off';
settings.pet = 'none';
const update = g.update;
g.update = function (dt) {
  simTimers.advance(dt * 1000);
  update.call(this, dt);
};
Object.defineProperty(window.performance, 'now', {
  configurable: true,
  value: performance.now.bind(performance),
});
Object.defineProperty(performance, 'now', { configurable: true, value: () => simTimers.now });
const button = (act: string) =>
  document.querySelector<HTMLButtonElement>(`#scr-bossmaker [data-bm="${act}"]`)!;
g.screens.show('extras');
document.querySelector<HTMLButtonElement>('#scr-extras [data-act=boss-maker]')!.click();
assert.equal(g.screens.current, 'bossmaker');
const share = () => document.querySelector<HTMLInputElement>('#scr-bossmaker input')!.value;
const original = share();
button('phase1').click();
button('move0').click();
button('add').click();
assert.notEqual(original, share());
assert.equal(decodeBoss(share())!.phases[1].length, 3);
button('time0').click();
button('del2').click();
button('body').click();
button('arena').click();
button('save').click();
assert(localDesigns().includes(share()));
await setLanguage('ar');
assert.equal(button('test').textContent, 'اختبر القتال');
await setLanguage('en');
localStorage.removeItem('infinishoot.bossMaker.v1');
assert(keepDesign(codes[0]));
g.startRun({ seed: 14, difficulty: 'normal' });
g.closeShop();
g.mode = 'shop';
assert(g.openRoute());
assert.equal(g.bossMaker.offer?.code, codes[0]);
assert(document.querySelector('#scr-route')?.textContent?.includes('WEEKLY BOSS'));
const choice = g.route.options.length - 1;
g.routePick(choice);
g.updateRoute(0.02);
g.updateRoute(0.6);
assert.equal(g.bossMaker.active?.stage, 2);
g.loadStage(2);
assert.equal(g.routeKind(), 'start');
assert.equal(g.arena.halfSize, 34);
g.spawnBoss(ENEMIES.rex);
assert.equal(g.boss!.def.id, 'king');
assert.equal(g.boss!.contactDamage, 0);
g.boss!.roarT = 0;
g.boss!.state = 'move';
const b = g.boss!,
  s = g.bossMaker.active!;
assert.equal(b.maxHp, Math.round(1750 * (g.spawnOpts({ hpMul: g.director.bossHpMul }).hpMul ?? 1)));
g.hero.player.teleport(0, 0);
b.x = 0;
b.z = -12;
b.dmgMul = 8; // Exercise the stage cap even with an extreme damage multiplier.
for (const move of moves) {
  s.design.phases[0] = [{ move, tempo: 0 }];
  b.phase = 2;
  g.bossMaker.step(g, 0.01);
  b.phase = 1;
  g.bossMaker.step(g, 0.5);
  assert.equal(b.state, 'windup');
  assert(b.t >= 0.95);
  assert(g.enemies.zones.length > 0);
  if (move === 'strike') assert.equal(g.strikes.at(-1)!.dmg, 20);
  if (move === 'wall') {
    assert(g.bossField.pendingWalls.length > 0);
    assert.equal(g.bossField.pendingWalls.at(-1)!.gap, 0);
    assert.equal(g.bossField.pendingWalls.at(-1)!.dmg * b.dmgMul, 20);
  }
  const count = g.bullets.count;
  g.bossMaker.step(g, tellTime({ move, tempo: 0 }) - 0.01);
  assert.equal(g.bullets.count, count);
  g.bossMaker.step(g, 0.02);
  if (move === 'fan' || move === 'ring') assert(g.bullets.count > count);
}
g.loadStage(3);
assert.equal(g.bossMaker.active, null);
g.loadStage(2);
g.onClientMessage({ t: 'makerStage', seed: g.seed, stage: 2, code: codes[1] });
assert.equal(g.arena.halfSize, 24); // Late design replaces the already loaded stock stage.
g.bossMaker.test(g, designs[0]);
assert.equal(g.boss?.def.id, 'king');
g.endRun(true);
assert.equal(g.screens.current, 'bossmaker');

if (process.env.G8_BOSS_PILOT) {
  for (let i = 0; i < 5; i++) {
    seedRandom(14 + i);
    g.bossMaker.test(g, designs[i]);
    const result = window.skillRun(65),
      fight = result.bosses[0];
    console.log('TEST FIGHT', i, JSON.stringify(fight), result.hp, result.mode);
    assert(fight?.killed && fight.seconds <= enrageTarget(1, 'normal'));
  }
}
if (process.env.G8_WEEKLY_PILOT) {
  const i = Number(process.env.G8_WEEKLY_PILOT) - 1;
  assert(i >= 0 && i < 5);
  localStorage.removeItem('infinishoot.bossMaker.v1');
  assert(keepDesign(codes[i]));
  seedRandom(14);
  g.startRun({ seed: 14, difficulty: 'normal' });
  const choose = g.routePick.bind(g);
  g.routePick = (n) =>
    choose(
      g.bossMaker.offer?.stage === 2 && g.route.phase === 'map' ? g.route.options.length - 1 : n,
    );
  let result = window.skillRun(1);
  for (
    let seconds = 1;
    seconds < 1000 && !result.died && !result.bosses.some((b) => b.stage === 2 && b.killed);
    seconds += 2
  )
    result = window.skillRun(2);
  const fight = result.bosses.find((b) => b.stage === 2);
  console.log(
    'WEEKLY',
    i,
    result.mode,
    result.stage,
    result.hp,
    result.causeOfDeath,
    JSON.stringify(fight),
  );
  assert.equal(fight?.id, designs[i].body);
  assert(fight?.killed && fight.seconds <= enrageTarget(2, 'normal'));
}
assert.deepEqual(jsdomErrors, []);
console.log('Boss Maker codec, arena, route, timing, UI and weekly ratings passed.');
