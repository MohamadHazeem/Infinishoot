/**
 * RUN lane in the real game (jsdom, no WebGL): the route vote after the shop
 * (solo, Daily, Boss Rush, co-op host with votes, ties and the timer, the
 * client's messages), heat in a run and in the co-op `start` message, the
 * Weekly Challenge setup, heat milestones and the save's `heat` field.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { save, importFile, unlockedWeapons } = await import('../src/game/save');
const { saveHeatPick } = await import('../src/game/runMods');
const { rollRoutes, routeTuning } = await import('../src/data/routes');
const { isoWeek, weeklySeed } = await import('../src/data/modes');
const { weeklyMutators } = await import('../src/data/mutators');
const { ENEMIES } = await import('../src/data/enemies');
const { playerTuning } = await import('../src/game/player');

const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
cheats.unlockAll = true;
const ui = (a: string, i = 0) => (game as unknown as { ui(a: string, i: number): void }).ui(a, i);

/** Start a solo run in a mode and play up to the post-boss shop being closed. */
const toShopDone = (mode: string) => {
  settings.mode = mode;
  settings.difficulty = 'normal';
  game.startSolo();
  if (game.mode === 'shop') game.closeShop(); // starting shop
  game.stageClear();
  game.openShop();
  ui('done');
};

// ---------------------------------------------------------------- solo Standard: vote, then portal
saveHeatPick({});
toShopDone('standard');
ok(game.mode === 'shop' && game.screens.current === 'route' && !!game.runMods.vote, 'after the shop the route vote opens (world still frozen)');
const cards = game.runMods.vote!.cards;
ok(JSON.stringify(cards) === JSON.stringify(rollRoutes(game.seed, 2, false)), 'the cards come from the seed');
ok(game.runMods.vote!.left === -1, 'solo has no vote timer');
ui('route', 1);
ok(game.runMods.route === cards[1] && game.mode === 'portal' && game.screens.current === 'none', 'picking a card sets the route and opens the portal');
game.loadStage(2);
ok(game.stageSub(2).includes('ROUTE'), 'the stage banner names the route');
ok(document.querySelector('#timer .runtag')!.textContent!.length > 0, 'the HUD shows the route under the stage label');

// Each route's knobs reach the systems.
game.runMods.route = 'elite';
game.loadStage(2);
ok(game.director.mods.elite === routeTuning.eliteMul, 'ELITE HUNT: the director brings elites twice as often');
game.runMods.route = 'event';
game.loadStage(2);
ok(game.runEvents.mods.events === 2, 'EVENTFUL: two stage events');
game.runMods.route = 'shop';
ok(game.hero.price({ price: 10 } as never) === 7, 'BARGAIN: shop prices -30%');
game.runMods.route = 'cursed';
const curses = game.curses.length;
const relics = game.hero.relics.length;
game.applyRoute('cursed', 3);
ok(game.curses.length === curses + 1 && game.hero.relics.length === relics + 1, 'CURSED: a curse for the team, a relic for everyone');

// ---------------------------------------------------------------- Daily: fixed route, no vote; Boss Rush: none
toShopDone('daily');
ok(!game.runMods.vote && game.mode === 'portal' && game.runMods.route === rollRoutes(game.seed, 2, false)[0], 'Daily: the seed picks the route, no vote');
toShopDone('bossrush');
ok(!game.runMods.vote && game.mode === 'portal' && game.runMods.route === null, 'Boss Rush: no routes');

// ---------------------------------------------------------------- Weekly Challenge
saveHeatPick({ hp: 3 });
settings.mode = 'weekly';
settings.difficulty = 'hard';
game.startSolo();
const week = isoWeek();
ok(game.runMode === 'weekly' && game.seed === weeklySeed(week), 'Weekly: the seed comes from the ISO week');
ok(game.difficulty.id === 'normal' && game.runMods.heatTotal === 0, 'Weekly: Medium, no heat');
ok(JSON.stringify(game.runMods.mutators) === JSON.stringify(weeklyMutators(week)), "Weekly: this week's two mutators");
ok(game.runLabel.includes('WEEKLY'), 'Weekly runs are labelled on the score table');

// ---------------------------------------------------------------- heat in a run
settings.mode = 'standard';
settings.difficulty = 'normal';
saveHeatPick({});
game.startSolo();
const hp0 = game.spawnOpts().hpMul!;
saveHeatPick({ hp: 3, hunger: 1, iframes: 2 });
game.startSolo();
ok(game.runMods.heatTotal === 7, 'the saved heat pick applies to a Standard run (3 + 2 + 2 heat)');
ok(Math.abs(game.spawnOpts().hpMul! / hp0 - 1.45) < 1e-6, 'Thick Hides 3: enemies +45% life');
ok(game.runLabel.includes('HEAT 7'), 'the score label carries the heat');
const p = game.hero.player;
p.invuln = 0;
p.hp = p.maxHp;
cheats.god = false;
game.hurtHero(game.hero, 5, p.x + 1, p.z);
ok(Math.abs(p.invuln - playerTuning.hurtIframes * 0.4) < 1e-6, 'Thin Skin 2: 60% shorter i-frames after a hit');
const before = p.hp;
game.gainXp(game.xpNext);
ok(p.hp === before, 'Hunger: level-ups no longer heal');
// Volatile: some kills leave a telegraphed blast.
saveHeatPick({ volatile: 2 });
game.startSolo();
if (game.mode === 'shop') game.closeShop();
const strikes0 = game.strikes.length;
for (let i = 0; i < 80; i++) {
  const e = game.enemies.spawn(ENEMIES.swarmer, 10 + i * 0.1, 10, game.spawnOpts({ instant: true }));
  game.killEnemy(e, 'buster', game.hero);
}
ok(game.strikes.length > strikes0, 'Volatile: slain enemies sometimes leave a blast');
// Heat milestones: beating the final boss at heat 4+ records the best heat and grants the cosmetic.
saveHeatPick({ hp: 3, elites: 1 });
game.startSolo();
game.victories = 1;
game.checkAchievements();
ok(save.heat[game.hero.heroDef.id] === 5 && save.achievements.includes('heat_4') && !save.achievements.includes('heat_10'), 'a heat-5 clear records the best heat and unlocks the heat 4 skin');
saveHeatPick({});

// ---------------------------------------------------------------- co-op host: votes, ties, timer
const sent: [string, any][] = [];
const stub = { code: 'TEST', send: (id: string, m: unknown) => sent.push([id, m]), broadcast: (m: unknown) => sent.push(['*', m]), close() {} };
game.leaveToTitle();
saveHeatPick({ hp: 1 });
game.role = 'host';
(game as any).host = stub;
game.setHeroes([game.hero, game.makeHero(1, 'Bob', unlockedWeapons(), 'p1')]);
game.startRun();
const start = sent.find(([id, m]) => id === 'p1' && m.t === 'start')?.[1];
ok(start && start.heat?.hp === 1, "the co-op start message carries the host's heat");
if (game.mode === 'shop') {
  ui('done');
  game.onHostMessage('p1', { t: 'ui', a: 'done', i: 0 });
}
game.stageClear();
game.openShop();
ui('done');
game.onHostMessage('p1', { t: 'ui', a: 'done', i: 0 });
const v = game.runMods.vote;
const view = sent.filter(([id, m]) => id === 'p1' && m.t === 'route' && m.view).pop()?.[1].view;
ok(!!v && v.left === routeTuning.voteSeconds && view?.coop && view.cards.length === 3, 'co-op: everyone gets the vote, with a timer');
ui('route', 0);
ok(!!game.runMods.vote, 'the vote waits for every player');
const cardsCoop = v!.cards;
game.onHostMessage('p1', { t: 'ui', a: 'route', i: 1 });
ok(!game.runMods.vote && game.runMods.route === cardsCoop[0] && game.mode === 'portal', "a 1-1 tie goes to the host's pick");
ok(sent.some(([id, m]) => id === 'p1' && m.t === 'route' && m.done === cardsCoop[0]), 'the client hears the decided route');
// Next stage: nobody votes, the timer decides.
game.loadStage(2);
game.stageClear();
game.openShop();
ui('done');
game.onHostMessage('p1', { t: 'ui', a: 'done', i: 0 });
const cards3 = game.runMods.vote!.cards;
game.onHostMessage('p1', { t: 'ui', a: 'route', i: 2 });
for (let i = 0; i < 60 * (routeTuning.voteSeconds + 1) && game.runMods.vote; i++) game.update(1 / 60);
ok(!game.runMods.vote && game.runMods.route === cards3[2] && game.mode === 'portal', 'when time runs out the votes cast so far decide');
// A player who leaves mid-vote doesn't block it.
game.loadStage(3);
game.stageClear();
game.openShop();
ui('done');
game.onHostMessage('p1', { t: 'ui', a: 'done', i: 0 });
ui('route', 1);
game.onClientLeft('p1');
ok(!game.runMods.vote && game.mode === 'portal', 'a player leaving mid-vote lets it finish');

// ---------------------------------------------------------------- client side
const csent: any[] = [];
game.role = 'client';
(game as any).client = { send: (m: unknown) => csent.push(m), close() {} };
game.onClientMessage({ t: 'route', view: { stage: 4, biome: 'Magma Isle', final: true, cards: [{ id: 'treasure', voters: [] }, { id: 'elite', voters: [] }], mine: -1, left: 12, coop: true } });
ok(game.screens.current === 'route' && document.querySelectorAll('#scr-route [data-route]').length === 2, 'client: the vote shows the host\'s cards');
ui('route', 1);
ok(csent.some((m) => m.t === 'ui' && m.a === 'route' && m.i === 1), 'client: a vote goes to the host');
game.onClientMessage({ t: 'route', done: 'elite' });
ok(game.runMods.route === 'elite' && game.screens.current === 'none', 'client: the decided route closes the vote');
game.onClientMessage({ t: 'start', seed: 5, difficulty: 'normal', heat: { speed: 2 }, you: 1, players: [{ name: 'A' }, { name: 'B' }] });
ok(game.runMods.heatTotal === 2, "client: the host's heat arrives with start");
game.role = 'solo';
(game as any).client = null;
(game as any).host = null;
game.leaveToTitle();

// ---------------------------------------------------------------- save: heat bests survive a file round trip
importFile(JSON.stringify({ game: 'InfiniShoot', save: { version: 3, achievements: [], heat: { rookie: 7, bulwark: 'x', ace: -2 } } }));
ok(save.heat.rookie === 7 && !('bulwark' in save.heat) && !('ace' in save.heat), 'the save keeps valid heat bests (v4)');
importFile(JSON.stringify({ game: 'InfiniShoot', save: { version: 3, achievements: [] } }));
ok(save.heat && Object.keys(save.heat).length === 0, 'an older save loads with no heat bests');
process.exit(process.exitCode ?? 0);
