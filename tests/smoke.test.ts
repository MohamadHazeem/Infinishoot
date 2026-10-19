/**
 * Smoke test: runs the real game headlessly (jsdom, no WebGL) with the
 * autoplay bot through every mode, difficulty and hero, then a mortal run
 * to game over, and fails on any runtime error. `npm run smoke`.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { ok } from './check';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window as unknown as Record<string, unknown>;
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
(globalThis as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};

(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
// Any crash must fail the test (a rejected top-level await can otherwise exit 0 silently).
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const errors: string[] = [];
process.on('uncaughtException', (e) => errors.push('uncaught ' + e.stack));

const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { installBot } = await import('../src/dev/bot');
const { settings } = await import('../src/game/settings');
const { save } = await import('../src/game/save');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
installBot(game, input);
const botRun = (globalThis as any).window.botRun as (s: number, god?: boolean) => Record<string, unknown>;
// Unlock everything so all heroes/difficulties/weapons get exercised.
save.achievements.push('boss_slayer', 'elite_hunter', 'speedster', 'stage_3', 'hard_stage3', 'first_steps', 'maxed', 'evolved', 'exterminator', 'arsenal', 'riposte', 'immovable', 'double_trouble');

const runs: [string, string, string, number][] = [
  ['standard', 'normal', 'rookie', 900],
  ['endless', 'hard', 'bulwark', 600],
  ['bossrush', 'nightmare', 'dash', 400],
  ['daily', 'easy', 'ace', 300],
  ['weekly', 'normal', 'rookie', 300],
  // Mechanic heroes (src/game/heroMechs.ts): parry-on-dash, heat aura, mirror twin.
  ['standard', 'normal', 'duelist', 240],
  ['endless', 'easy', 'furnace', 240],
  ['standard', 'hard', 'twin', 240],
];
// Heat for the non-challenge runs (src/data/heat.ts): every modifier at rank 1.
const { saveHeatPick } = await import('../src/game/runMods');
const { HEAT_MODS } = await import('../src/data/heat');
saveHeatPick(Object.fromEntries(HEAT_MODS.map((d) => [d.id, 1])));
for (const [mode, diff, hero, secs] of runs) {
  settings.mode = mode;
  settings.difficulty = diff;
  settings.hero = hero;
  // The Twin's clone copies the left click: give it a beam weapon so the clone's own weapon instance runs too.
  settings.loadout = { ...settings.loadout, primary: hero === 'twin' ? 'laser' : 'buster' };
  settings.pet = hero === 'rookie' ? 'sparky' : hero === 'dash' ? 'bit' : 'guardian';
  game.applyLocalSkin();
  try {
    game.startSolo();
    const t0 = Date.now();
    const r = botRun(secs, true);
    console.log(mode, diff, hero, JSON.stringify({ stage: r.stage, mode: r.mode, level: r.level, kills: r.kills, weapons: r.weapons, avgMs: r.avgMs, worstMs: r.worstMs, curses: game.curses, relics: game.hero.relics, route: game.runMods.route, heat: game.runMods.heatTotal, mutators: game.runMods.mutators, wall: Date.now() - t0 }));
    // Pause screen + extras screens render without throwing.
    game.pause();
    game.resume();
  } catch (e) {
    errors.push(mode + ': ' + (e as Error).stack?.split('\n').slice(0, 14).join('\n'));
  }
}
// The training field with the bot at the controls (onboarding lane): runs without errors and leaves cleanly.
try {
  game.onboarding.startTraining();
  const tr = botRun(40, false);
  console.log('training', JSON.stringify({ step: game.onboarding.training?.step, mode: tr.mode, screen: (game.screens as any).current }));
  game.onboarding.endTraining(false);
} catch (e) {
  errors.push('training: ' + (e as Error).stack?.split('\n').slice(0, 14).join('\n'));
}
// A mortal run: die, game over, run history.
settings.mode = 'standard';
settings.difficulty = 'nightmare';
game.startSolo();
const rr = botRun(900, false);
console.log('mortal', JSON.stringify({ stage: rr.stage, mode: rr.mode, t: rr.t, kills: rr.kills }));
// The bot can outlive the time budget (it parries well), so finish the run off deterministically.
if (game.mode !== 'dead') {
  const p = game.hero.player;
  game.hero.revivesLeft = 0;
  p.invuln = 0;
  if (p.hurt(p.hp + 1, 0, 1)) game.onHeroDown(game.hero);
}
for (let i = 0; i < 400; i++) game.update(1 / 60);
const goScreen = (game.screens as any).current;
console.log('after death: screen', goScreen, 'last cause', save.history[0]?.cause, 'label', save.history[0]?.label);
for (const s of ['extras', 'jukebox', 'wardrobe', 'modes', 'heat', 'controls', 'history', 'bestiary', 'settings', 'codex']) {
  try { (game.screens as any).show(s); } catch (e) { errors.push('screen ' + s + ': ' + (e as Error).stack); }
}
console.log('history', save.history.length, 'seen', save.seen.length);
ok(rr.mode === 'dead' || rr.mode === 'fight', 'mortal run plays out');
ok(goScreen === 'gameover' && save.history.length > 0, 'death shows game over and records the run');
ok(errors.length === 0, 'no runtime errors' + (errors.length ? ':\n' + errors.slice(0, 5).join('\n') : ''));
process.exit(process.exitCode ?? 0);
