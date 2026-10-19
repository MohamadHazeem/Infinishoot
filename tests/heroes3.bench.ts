/**
 * heroes3 lane balance bench (not part of npm test: the file doesn't end in .test.ts).
 * Bundle and run (see notes/lanes/heroes3.md):
 *   npx rolldown tests/heroes3.bench.ts --format esm --platform node --external jsdom --inline-dynamic-imports -o node_modules/.tests/h3.mjs
 *   H3_HERO=ronin H3_SECS=600 H3_GOD=1 H3_SEED=1 node node_modules/.tests/h3.mjs
 * Prints one JSON line: the dev bot's botRun report (boss kill times per stage) plus damage by source.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

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
(globalThis as any).__APP_VERSION__ = 'bench';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const env = process.env;
const seed = Number(env.H3_SEED ?? 1);
let s = seed * 2654435761;
Math.random = () => {
  s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) | 0;
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
};
const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { Rng } = await import('../src/core/rng');
const { installBot } = await import('../src/dev/bot');
const { settings } = await import('../src/game/settings');
const { save } = await import('../src/game/save');
const { minionsOf } = await import('../src/game/heroes3');
save.achievements.push('boss_slayer', 'elite_hunter', 'speedster', 'stage_3', 'hard_stage3', 'first_steps', 'maxed', 'evolved', 'exterminator', 'arsenal', 'riposte', 'immovable', 'double_trouble', 'point_blank', 'workshop');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
installBot(game, input);
settings.mode = env.H3_MODE ?? 'standard';
settings.difficulty = env.H3_DIFF ?? 'normal';
settings.hero = env.H3_HERO ?? 'rookie';
settings.pet = 'none';
const kit = (env.H3_KIT ?? 'buster,charge,bomb').split(',');
settings.loadout = { primary: kit[0], secondary: kit[1], special: kit[2] };
game.applyLocalSkin();
game.startSolo();
game.rng = new Rng(seed);
// Damage by source, bots alive, ultimates fired.
let ults = 0;
let maxBots = 0;
const tu = game.tryUlt;
game.tryUlt = function (h) {
  const before = h.skill.ult;
  tu.call(this, h);
  if (before >= 1 && h.skill.ult < 1) ults++;
};
const st = game.update.bind(game);
game.update = (dt: number) => {
  st(dt);
  maxBots = Math.max(maxBots, minionsOf(game).count);
};
const t0 = Date.now();
const r = (globalThis as any).window.botRun(Number(env.H3_SECS ?? 600), env.H3_GOD === '1');
const dmg = Object.entries(game.hero.damageBy as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${Math.round(v)}`).join(' ');
console.log(JSON.stringify({ hero: settings.hero, seed, diff: settings.difficulty, kit: kit.join('/'), mode: r.mode, stage: r.stage, t: r.t, level: r.level, kills: r.kills, runTime: Math.round(game.runTime), hp: r.hp, stages: r.stages, bosses: r.bosses, firstEvo: r.firstEvo, weapons: r.weapons, ults, maxBots, dmg, avgMs: r.avgMs, wall: Date.now() - t0 }));
process.exit(0);
