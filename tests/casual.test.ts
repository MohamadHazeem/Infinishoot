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

const A = await import('../src/game/systems/assists');
const { settings, SETTINGS_DEFAULTS } = await import('../src/game/settings');
const { save, normalize } = await import('../src/game/save');
const { Game, cheats } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { Team } = await import('../src/game/bullets');
const { ENEMIES } = await import('../src/data/enemies');
const { loadHighScores, dailyBest } = await import('../src/game/highscores');
const { setLanguage, t } = await import('../src/i18n');
const { playerTuning } = await import('../src/game/player');
const { modesForce } = await import('../src/game/systems/modes');
const { ghostStore } = await import('../src/game/modes/ghostStore');
const { SETTINGS_ROWS, resetSettingsTab } = await import('../src/ui/settingsScreen');
const { loadGauntletScores } = await import('../src/game/systems/gauntlet');

const off = () => { settings.gameSpeed = '100'; settings.oneStick = false; for (const k of A.ASSIST_KEYS) settings[k] = false; };
ok(!A.hasCasualOptions(SETTINGS_DEFAULTS as any), 'all casual options default off / normal speed');
const old = normalize({ version: 9, history: [{ score: 10 }, { score: 20, assisted: true }, { score: 30, assisted: 'true' }] });
ok(old.history[0].assisted === false && old.history[1].assisted === true && old.history[2].assisted === false, 'old saves migrate and assist flags require a true boolean');
const budget = new A.DashBudget();
ok(budget.take(0) && budget.take(1) && budget.take(2) && !budget.take(3) && !budget.take(59.99) && budget.take(60) && !budget.take(60.5) && budget.take(61), 'auto dash obeys a rolling 3-per-minute cap');
A.casualPreset();
ok(settings.gameSpeed === '85' && settings.oneStick && settings.assistDamage && settings.assistMagnet && !settings.assistDash && !settings.assistIframes && !settings.assistBullets, 'preset is a gentle explicit bundle');
for (const key of ['gameSpeed', 'oneStick', ...A.ASSIST_KEYS]) ok(SETTINGS_ROWS.some(r => r.key === key && r.tab === 'ACCESSIBILITY'), key + ' has its own accessibility row');
resetSettingsTab('ACCESSIBILITY'); ok(!A.hasCasualOptions(), 'accessibility reset restores normal play');

modesForce.rhythm = false;
settings.bossIntros = false; settings.deathReplay = false; settings.cinematics = 'off'; settings.finishers = false;
const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const g = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
const start = (mode = 'standard') => {
  off(); cheats.god = false; settings.mode = mode; settings.difficulty = 'normal'; save.meta.heat = [];
  g.startSolo(); if (g.mode === 'shop') g.closeShop();
  g.hero.pendingLevels = 0; g.mode = 'fight'; g.screens.show('none'); g.paused = false;
  g.enemies.clear(); g.strikes.length = 0; g.xpNext = 1e12;
  g.hero.player.pos.x = g.hero.player.pos.z = 0; g.hero.player.invuln = 0;
};
start();
for (const speed of ['100', '85', '70'] as const) {
  settings.gameSpeed = speed;
  ok(Math.abs(A.assistStep.call(g, 1) - Number(speed) / 100) < 1e-8, speed + '% simulation time');
}
g.paused = true; ok(A.assistStep.call(g, 1) === 1, 'pause menu remains at normal UI speed'); g.paused = false;
A.casualPreset();
for (const session of [{ role: 'host' }, { role: 'client' }, { pvp: {} }, { race: { net: 'host' } }, { race: { net: 'client' } }, { race: { net: 'local' } }, { host: {} }, { client: {} }]) {
  const fake = Object.assign(Object.create(g), session);
  ok(!A.assistsAllowed(fake) && !A.oneStickActive(fake) && A.magnetScale(fake) === 1 && A.assistDamage(fake, 9) === 9 && A.assistStep.call(fake, 1) === 1, 'online / competitive gate: ' + JSON.stringify(session));
}
A.resetAssists(g); A.assistStep.call(g, 1 / 60); off();
ok(A.assistedRun(g), 'turning options off never unmarks an assisted run');
A.resetAssists(g); ok(!A.assistedRun(g), 'new run resets eligibility');

// Mouse-only players can still use the ordinary dash and special without keyboard keys.
settings.oneStick = true; A.assistStep.call(g, 1 / 60);
const dashMeter = document.querySelector<HTMLElement>('#dashpip')!, specialMeter = document.querySelector<HTMLElement>('#bombpip')!;
dashMeter.click(); specialMeter.click();
ok(dashMeter.getAttribute('role') === 'button' && input.actionPressed('dash') && input.actionPressed('bomb'), 'one-stick HUD meters accept mouse dash and special presses');
input.endStep(); settings.oneStick = false; A.assistStep.call(g, 1 / 60); dashMeter.click();
ok(!dashMeter.hasAttribute('role') && !input.actionPressed('dash'), 'ordinary controls keep noninteractive HUD meters');

// Real damage pipeline, including odd and single-point damage.
start(); const p = g.hero.player; p.hp = 100;
g.hurtHero(g.hero, 11, 1, 0); const ordinary = 100 - p.hp;
p.hp = 100; p.invuln = 0; settings.assistDamage = true; settings.assistIframes = true;
g.hurtHero(g.hero, 11, 1, 0);
ok(Math.abs(100 - p.hp - ordinary / 2) < 1e-8 && A.assistDamage(g, 1) === 0.5, 'damage is exactly halved, including odd hits');
ok(p.invuln === playerTuning.hurtIframes * 2, 'successful hit doubles recovery protection');
ok(A.magnetScale(g) === 1, 'magnet is independently off'); settings.assistMagnet = true; ok(A.magnetScale(g) === 2, 'magnet doubles radius');

// Pooled bullets: no permanent velocity mutations or compounded slowdown.
g.bullets.clear(); settings.assistBullets = true;
for (const team of [Team.Enemy, Team.Player]) g.bullets.spawn({ x: 0, z: 0, dirX: 1, dirZ: 0, speed: 10, life: 10, radius: 0.1, damage: 1, knockback: 0, team, color: '#ff3df0', width: 0.1, length: 0.2 });
for (let i = 0; i < 2; i++) { g.bullets.integrate(1); A.slowAssistBullets(g); }
ok(Math.abs(g.bullets.x[0] - 13) < 1e-5 && g.bullets.x[1] === 20 && g.bullets.vx[0] === 10 && g.bullets.life[0] === 8, 'enemy displacement is 65%; friendly speed, velocity and expiry stay intact');
settings.assistBullets = false; g.bullets.integrate(1); A.slowAssistBullets(g); ok(g.bullets.x[0] === 23, 'switching off restores full speed immediately');

// Target selection skips untargetable enemies and line-of-sight blockers.
start(); const spawn = (id: string, x: number, z: number) => { const e = g.enemies.spawn(ENEMIES[id], x, z, {}); e.state = 'move'; e.under = false; return e; };
const close = spawn('bopper', 2, 0), farther = spawn('bopper', 0, 5);
const originalBoxes = g.arena.colliders;
g.arena.colliders = [];
ok(A.casualTarget(g, g.hero) === close, 'one stick selects nearest visible target');
close.state = 'spawning'; ok(A.casualTarget(g, g.hero) === farther, 'spawn telegraphs are not targets'); close.state = 'move';
g.arena.colliders = [{ minX: 0.8, maxX: 1.2, minZ: -1, maxZ: 1 }];
ok(A.casualTarget(g, g.hero) === farther, 'one stick skips enemies behind cover');
g.arena.colliders = [];
settings.oneStick = true; input.device = 'pad'; input.move.x = 1; input.move.y = 0;
g.updateHero(g.hero, 1 / 60, true);
ok(g.hero.ctx.firing && p.aim.x > 0.99, 'one stick auto fires on controller and aims at target');
const beforeMove = p.x; g.updateHero(g.hero, 1 / 60, true); ok(p.x > beforeMove, 'movement stick still moves');
input.move.x = input.move.y = 0; input.device = 'kbm';
const originalAim = g.mouseAimPoint; g.mouseAimPoint = () => g.aimHit.set(0, 0, 8);
const canvas = document.getElementById('game')!;
canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100 }));
A.assistInput.call(g, g.hero, input, 1 / 60); ok(input.move.y > 0.9, 'mouse click creates a movement destination');
A.restoreAssistInput(g, g.hero, input); input.endStep();
ok(input.move.x === 0 && input.move.y === 0, 'synthetic movement is restored between fixed steps');
A.assistInput.call(g, g.hero, input, 1 / 60); ok(input.move.y > 0.9, 'click destination survives mouse release'); A.restoreAssistInput(g, g.hero, input);
input.move.x = 1; A.assistInput.call(g, g.hero, input, 1 / 60); A.restoreAssistInput(g, g.hero, input); input.move.x = 0;
A.assistInput.call(g, g.hero, input, 1 / 60); ok(input.move.y === 0, 'manual movement cancels click destination');
canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); A.assistInput.call(g, g.hero, input, 1 / 60); A.restoreAssistInput(g, g.hero, input); input.endStep();
g.paused = true; A.assistStep.call(g, 1 / 60); g.paused = false;
A.assistInput.call(g, g.hero, input, 1 / 60); ok(input.move.y === 0, 'opening a menu cancels click destination');
g.mouseAimPoint = originalAim; g.arena.colliders = originalBoxes;

// Real dash stock and onDash path are used, independently for each hero.
start(); settings.assistDash = true;
g.strikes.push({ x: 0, z: 0, r: 4, t: 0.08, dmg: 20 });
p.dashStock = p.dashMax; const stocks = p.dashStock;
const onDash = g.onDash; let spent = false;
g.onDash = h => { spent = h.player.dashStock === stocks - 1; onDash.call(g, h); };
g.updateHero(g.hero, 1 / 60, true); g.onDash = onDash;
ok(p.dashing && spent && p.invuln > 0, 'imminent strike spends normal dash stock and grants normal i-frames (perfect-dash refund still applies)');
input.endStep();
// Repeated automatic dodges stop at the cap; a normal button still works.
for (let n = 0; n < 3; n++) {
  p.invuln = p.dashT = 0; p.dashStock = p.dashMax;
  A.assistInput.call(g, g.hero, input, 1 / 60);
  ok(input.actionPressed('dash') === (n < 2), 'automatic dash rolling budget attempt ' + (n + 2));
  A.restoreAssistInput(g, g.hero, input); input.endStep();
}
input.pressAction('dash'); g.updateHero(g.hero, 1 / 60, true); ok(p.dashing, 'manual dash works after assist cap'); input.endStep();
A.resetAssists(g); p.invuln = p.dashT = 0; p.dashStock = p.dashMax; g.strikes.length = 0;
const jumper = spawn('omega', 0, 0); jumper.action = 'slam'; jumper.targetX = p.x; jumper.targetZ = p.z; jumper.t = 0.08; jumper.state = 'windup';
A.assistInput.call(g, g.hero, input, 1 / 60); ok(!input.actionPressed('dash'), 'slam assistance waits for landing instead of wasting a dash at takeoff');
jumper.state = 'attack'; A.assistInput.call(g, g.hero, input, 1 / 60); ok(input.actionPressed('dash'), 'slam landing warning triggers assistance'); A.restoreAssistInput(g, g.hero, input); input.endStep();

// End-to-end eligibility: achievements/profile continue, scores and ghosts do not.
start('daily'); settings.assistDamage = true; A.assistStep.call(g, 1 / 60); off();
g.score = 123456; g.kills = 300; g.checkAchievements();
const board = JSON.stringify(loadHighScores()), daily = dailyBest(g.runDate), runs = save.lifetime.runs;
g.bankAndShow(g.summary(g.hero));
ok(save.history[0].assisted === true && save.lifetime.runs === runs + 1, 'assisted history and lifetime progression bank normally');
ok(JSON.stringify(loadHighScores()) === board && dailyBest(g.runDate) === daily, 'assisted daily run enters neither local board nor daily best');
ok(save.achievements.includes('first_steps'), 'assisted runs still grant achievements');
g.screens.show('history'); ok(!!document.querySelector('#scr-history .casual-badge'), 'history shows an assist badge');
start('weekly'); settings.oneStick = true; A.assistStep.call(g, 1 / 60); const week = g.meta.week;
const priorWeekly = JSON.stringify(save.meta.weekly), priorGhost = JSON.stringify(ghostStore.mine(week));
g.score = 999999; g.bankAndShow(g.summary(g.hero));
ok(JSON.stringify(save.meta.weekly) === priorWeekly && JSON.stringify(ghostStore.mine(week)) === priorGhost, 'assisted weekly runs never save a best or competitive ghost');
start('gauntlet'); settings.assistMagnet = true; A.assistStep.call(g, 1 / 60);
const gauntlet = JSON.stringify(loadGauntletScores()); g.kills = 100; g.bankAndShow(g.summary(g.hero));
ok(JSON.stringify(loadGauntletScores()) === gauntlet, 'assisted gauntlet does not enter challenge table');
start(); g.score = 22222; g.bankAndShow(g.summary(g.hero));
ok(save.history[0].assisted === false && loadHighScores().some(r => r.score === 22222), 'normal runs retain score eligibility');

// Shared-screen co-op traverses the same hook with independent controller input.
const { DEFAULT_LOADOUT } = await import('../src/data/loadout');
const pad = { index: 0, connected: true, axes: [1, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), mapping: 'standard', id: 'test', timestamp: 0 } as unknown as Gamepad;
g.localCoopStart([-1, 0].map(n => ({ pad: n, hero: 'rookie', loadout: { ...DEFAULT_LOADOUT }, ready: true, row: 0 })), 'standard', () => [pad]);
g.preShop = false; g.mode = 'fight'; g.screens.show('none'); g.paused = false;
settings.oneStick = true; settings.gameSpeed = '70';
const mate = g.heroes[1]; mate.player.pos.x = mate.player.pos.z = 0; mate.player.invuln = 0;
g.enemies.clear(); spawn('bopper', 0, 5); const boxes = g.arena.colliders; g.arena.colliders = [];
g.updateHero(mate, 1 / 60, true);
ok(mate.ctx.firing && mate.player.aim.z > 0.99 && mate.player.x > 0 && input === g.input && g.local === 0, 'local co-op pad auto-aims/fires/moves and restores the shared controller');
ok(A.assistStep.call(g, 1) === 0.7, 'shared-screen co-op uses the selected speed');
g.arena.colliders = boxes; g.leaveToTitle();

// Preset is present on a fresh mode screen and explicit click persists it.
off(); g.screens.show('modes');
const preset = document.querySelector<HTMLButtonElement>('[data-casual-preset]')!;
ok(!!preset && preset.hasAttribute('data-nav') && !A.hasCasualOptions(), 'first-launch mode screen offers preset without enabling it');
preset.click(); ok(settings.oneStick && settings.gameSpeed === '85' && JSON.parse(localStorage.getItem('infinishoot.settings.v1')!).assistDamage, 'preset click saves the advertised bundle');
setLanguage('ar'); g.screens.show('modes');
ok(document.querySelector('[data-casual-preset]')!.textContent === t('casual.preset') + ' ✓', 'Arabic mode preset uses translated copy');
g.screens.show('settings'); g.screens.settingsScreen.selectTab(4);
ok(document.querySelector('.casual-assists-heading')!.textContent === t('casual.heading'), 'Arabic assists heading translates');
setLanguage('en');
dom.window.close();
