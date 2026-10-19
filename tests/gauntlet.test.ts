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
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const A = await import('../src/data/ascension');
const G = await import('../src/game/systems/gauntlet');
const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { settings } = await import('../src/game/settings');
const { ENEMIES } = await import('../src/data/enemies');
const { save } = await import('../src/game/save');
const { PickupType } = await import('../src/game/pickups');
const { modesForce } = await import('../src/game/systems/modes');
const { loadHighScores } = await import('../src/game/highscores');
modesForce.rhythm = false;
cheats.god = true;
settings.bossIntros = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mk = () => new Game(new Input(canvas), 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const g = mk();
const start = (mode = 'standard') => {
  Object.assign(A.gauntletProfile, A.normalizeGauntlet(null));
  settings.mode = mode; settings.difficulty = 'normal'; save.meta.heat = [];
  g.startSolo();
  if (g.mode === 'shop') g.closeShop();
  g.hero.pendingLevels = 0; g.mode = 'fight'; g.screens.show('none');
  g.finisherCatch = () => false;
  g.xpNext = 1e12;
};
const kill = (e: any) => { e.hp = 0; e.under = false; g.killEnemy(e, 'buster', g.hero); };

ok(A.ASCENSIONS.length === 20, 'twenty distinct cumulative ascension levels');
for (let n = 1; n <= 20; n++) {
  const p = A.ascensionRules(n - 1), r = A.ascensionRules(n);
  ok(r.hp >= p.hp && r.speed >= p.speed && r.damage >= p.damage && r.count >= p.count && r.chest <= p.chest && r.attacks >= p.attacks, `A${n} never removes an earlier modifier`);
}
ok(A.ascensionRules(5).doubleElites && A.ascensionRules(8).noHeal && A.ascensionRules(20).attacks === 3, 'milestone combat modifiers present');
ok(A.normalizeGauntlet({ selected: 30, unlocked: 4, cleared: 99, ng: true }).selected === 4 && !A.normalizeGauntlet({ ng: true }).ng, 'old / partial profiles migrate and locked choices clamp');
ok(A.gauntletScore(12.5, 4) === 50 && A.gauntletScore(-1, 100) === 0, 'time times kills score');
ok(A.loopMutators(16).join() === '0,0,0,0' && A.loopMutators(17).join() === '1,0,0,0' && A.loopMutators(29).join() === '1,1,1,1' && A.loopMutators(33).join() === '2,1,1,1', 'mutators start at loop five and continue stacking');
ok(G.rushRoster().some(d => d.id === 'titan') && G.rushRoster().some(d => d.id === 'omega') && G.rushRoster().every(d => !d.remixOf), 'boss roster includes Titan and Omega, excludes variants');

start('gauntlet');
const gs = G.challengeState(g), arena = g.arena;
ok(!g.preShop && g.mode === 'fight' && !g.portal.active, 'Gauntlet starts immediately without shop or portal');
G.gauntletRequests(g, 0.1);
const hp = g.spawnOpts().hpMul!;
gs.time = 30;
const waves = G.gauntletRequests(g, 0.1);
ok(waves.some(r => r.kind === 'enemy' && r.elite) && g.spawnOpts().hpMul! > hp, '30-second wave adds an elite and stronger enemies');
g.updateChestSpawns(300);
ok(g.chests.closedCount === 0, 'no timed chests in Gauntlet');
gs.time = 180;
G.gauntletRequests(g, 0.1);
ok(!!g.bossField.miniWarn, 'mini-boss warning at three minutes');
g.updateMiniBoss(2);
ok(!!g.bossField.mini, 'mini-boss really spawns after its warning');
gs.time = 360;
const bossReq = G.gauntletRequests(g, 0.1).find(r => r.kind === 'boss');
ok(!!bossReq, 'boss request at six minutes');
if (bossReq) g.spawnBoss(bossReq.def);
kill(g.boss!);
g.stageClear();
ok(g.mode === 'fight' && g.arena === arena && g.stage === 1 && !g.portal.active && g.bossesRun === 1, 'boss death keeps the same arena going and counts once');
ok(!Array.from(g.pickups.type.slice(0, g.pickups.count)).includes(PickupType.Chest), 'Gauntlet boss drops XP, no chest');
gs.time = 720;
ok(G.gauntletRequests(g, 0.1).some(r => r.kind === 'boss'), 'another boss on the next six-minute boundary');
g.kills = 10; gs.time = 12.5; g.score = 99999; g.meta.heat = ['armor'];
ok(g.summary(g.hero).score === 125, 'heat, combo and boss point bonuses never inflate Gauntlet score');
const oldScores = JSON.stringify(loadHighScores());
g.bankAndShow(g.summary(g.hero));
g.bankAndShow(g.summary(g.hero));
ok(G.loadGauntletScores().length === 1 && G.loadGauntletScores()[0].score === 125 && JSON.stringify(loadHighScores()) === oldScores, 'Gauntlet banks once into its separate table');
g.retry();
ok(G.challengeState(g).time === 0 && G.challengeState(g).splits.length === 0 && g.mode === 'fight', 'retry resets all challenge timers without a starting shop');

start('bossrush');
const roster = G.rushRoster();
for (let stage = 1; stage <= roster.length * 2; stage++) {
  ok(g.stage === stage, `Rush arrived at stage ${stage}`);
  const req = G.rushRequests(g, 3).find(r => r.kind === 'boss')!;
  g.spawnBoss(req.def);
  const base = roster[(stage - 1) % roster.length];
  const expected = stage > roster.length ? (await import('../src/data/bossRemix')).REMIX_OF[base.id] ?? base.id : base.id;
  ok(g.boss?.def.id === expected, `Rush slot ${stage}: ${expected}`);
  G.challengeState(g).time += 10;
  kill(g.boss!);
  g.stageClear();
  if (stage === roster.length * 2) break;
  g.openShop();
  if (stage % 2 === 0) {
    ok(g.mode === 'shop' && !g.secretShop && g.screens.current === 'shop' && G.challengeState(g).shopLeft === 20, 'normal timed shop every second boss');
    ok(document.querySelector('#scr-shop #g-shop-clock')?.textContent === 'NEXT BOSS IN 20s', 'Rush countdown lives inside the visible shop screen');
    G.gauntletMenuTick(g, 1);
    ok(document.getElementById('g-shop-clock')?.textContent === 'NEXT BOSS IN 19s', 'shop countdown updates while combat is frozen');
    g.paused = true; G.gauntletMenuTick(g, 10); g.paused = false;
    ok(G.challengeState(g).shopLeft === 19, 'paused shop does not consume time');
    G.gauntletMenuTick(g, 19.1);
    ok(!document.getElementById('g-shop-clock'), 'shop countdown is removed on departure');
  }
  g.hero.pendingLevels = 0; g.mode = 'fight'; g.screens.show('none');
}
ok(g.mode === 'dead' && g.victories === 1 && G.challengeState(g).splits.length === roster.length * 2, 'two laps complete with one victory and every split');
ok(G.challengeState(g).splits.every(s => s.time === 10), 'split timer excludes shops / transitions');
ok(save.history[0].cause === 'Boss Rush complete', 'completed Rush is recorded as a victory, not a quit');

start();
g.difficulty = { ...g.difficulty, id: 'hard' };
// Spawn Omega directly: on stage 1 the boss lane's rematch picker may swap the def for an earlier boss.
g.boss = g.enemies.spawn(ENEMIES.omega, g.hero.player.x + 12, g.hero.player.z, g.spawnOpts({ instant: true }));
kill(g.boss!);
ok(A.gauntletProfile.unlocked === 1 && A.gauntletProfile.victory, 'actual Hard Omega kill unlocks A1 and NG+');
A.gauntletProfile.selected = 1;
g.retry();
ok(G.challengeState(g).ascension === 1 && g.difficulty.id === 'hard' && /ASCENSION 1/.test(g.runLabel), 'selected ascension uses Hard and appears in run history label');
A.recordAscensionVictory(5, true);
ok(A.gauntletProfile.unlocked === 6 && A.gauntletProfile.title === 1, 'fifth clear grants the cosmetic title and next level');
A.gauntletProfile.title = 0; A.recordAscensionVictory(5, true);
ok(A.gauntletProfile.title === 0, 'repeat victories preserve the selected cosmetic title');
g.role = 'host'; G.startGauntlet(g);
ok(G.challengeState(g).ascension === 0 && !G.challengeState(g).ng, 'solo choices never leak into hosted co-op');
g.role = 'solo';
start();
G.challengeState(g).rules = A.ascensionRules(8);
g.hero.player.hp = 25;
g.stageClear();
ok(g.hero.player.hp === 25, 'A8 suppresses stage-clear healing');
g.loadStage(2); g.mode = 'fight';
g.spawnEnemy(ENEMIES.bopper, true, { x: 6, z: 6 }, 'shielded');
const elite = g.enemies.list.find(e => e.active && e.elite)!;
ok(elite.mod?.name === 'Double Shielded' && Math.abs(elite.shield - elite.maxHp * 1.2) < 2, 'A5 doubles actual elite modifier effect');
G.challengeState(g).rules = A.ascensionRules(7);
g.spawnBoss(ENEMIES.king); g.boss!.roarT = 0; g.boss!.state = 'chase'; g.bossIntro.stop(g.cam.camera);
G.gauntletTick(g, 8.1);
const bullets = g.bullets.count;
G.gauntletTick(g, 1.1);
ok(g.bullets.count >= bullets + 8, 'A7 adds a warned eight-bullet boss ring');

start(); g.loadStage(29);
const client = mk(); client.role = 'client'; client.clientStart(g.seed, 0, [{ name: 'Client', skin: 'blue' }]); client.clientStage(29, g.seed);
client.applySnapshot(g.buildSnapshot(g.hero, []));
ok(G.challengeState(client).mutators.join() === '1,1,1,1', 'late loop mutators round-trip through the real snapshot');
const e = g.enemies.spawn(ENEMIES.bopper, 5, 5, { instant: true }); const strikes = g.strikes.length; kill(e);
ok(g.strikes.length === strikes + 1, 'explosive-death mutator creates a delayed gameplay hazard');
g.loadStage(1); client.applySnapshot(g.buildSnapshot(g.hero, []));
ok(G.challengeState(client).mutators.every(n => n === 0), 'new loop-one stage clears client mutators');

G.renderGauntletOptions(document.getElementById('scr-modes')!);
G.gauntletOption('g-records', g.screens);
ok(g.screens.current === 'gauntlet' && document.querySelector('#scr-gauntlet .g-board')!.textContent!.includes('SURVIVAL GAUNTLET'), 'records screen registered and populated');
console.log('Gauntlet integration checks complete');
process.exit(process.exitCode ?? 0);
