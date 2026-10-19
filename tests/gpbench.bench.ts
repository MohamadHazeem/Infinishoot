/**
 * Gameplay lane balance bench (not part of npm test: the file doesn't end in .test.ts).
 * Bundle and run: npx rolldown tests/gpbench.bench.ts ... then node it with
 * GP_CFG=on|off GP_SEED=n GP_SECS=s GP_GOD=1 GP_DIFF=normal GP_KIT=buster,charge,bomb.
 * Prints one JSON line: the dev bot's botRun report plus lane counters.
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
const on = env.GP_CFG !== 'off';
const seed = Number(env.GP_SEED ?? 1);
// Deterministic Math.random too (the bot and some spawns use it).
let s = seed * 2654435761;
Math.random = () => {
  s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) | 0;
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
};
const GP = await import('../src/game/gameplay');
if (!on) {
  GP.mechTuning.dropChance = GP.mechTuning.eliteChance = 0;
  GP.crateTuning.first = GP.crateTuning.every[0] = GP.crateTuning.every[1] = 1e9;
  GP.mutationTuning.enabled = false;
  GP.comebackTuning.enabled = false;
  for (const t of GP.cashTuning.tiers) t.cost = 1e9;
}
const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { Rng } = await import('../src/core/rng');
const { installBot } = await import('../src/dev/bot');
const { settings } = await import('../src/game/settings');
const { save } = await import('../src/game/save');
const SYS = await import('../src/game/systems/gameplay');
save.achievements.push('boss_slayer', 'elite_hunter', 'speedster', 'stage_3', 'hard_stage3', 'first_steps', 'maxed', 'evolved', 'exterminator', 'arsenal');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
installBot(game, input);
settings.mode = 'standard';
settings.difficulty = env.GP_DIFF ?? 'normal';
settings.hero = 'rookie';
settings.pet = 'none';
const kit = (env.GP_KIT ?? 'buster,charge,bomb').split(',');
settings.loadout = { primary: kit[0], secondary: kit[1], special: kit[2] };
game.applyLocalSkin();
game.startSolo();
game.rng = new Rng(seed);
// Lane counters.
const c = { mechs: 0, mechT: 0, supers: 0, mutated: 0, cash: 0, comebackT: 0, overloads: 0, finales: 0 };
const W = SYS.gpWorld(game);
let lastUses = 0;
const st = game.update.bind(game);
game.update = (dt: number) => {
  const h = game.hero;
  const wasMech = h.play.mechT > 0;
  const wasSuper = !!h.play.superId;
  const wasOver = h.play.overloadT > 0;
  const hadFinale = !!W.finale;
  st(dt);
  if (!hadFinale && W.finale) c.finales++;
  if (!wasMech && h.play.mechT > 0) c.mechs++;
  if (h.play.mechT > 0) c.mechT += dt;
  if (!wasSuper && h.play.superId) c.supers++;
  if (!wasOver && h.play.overloadT > 0) c.overloads++;
  if (h.comeback) c.comebackT += dt;
  if (W.cashUses > lastUses) c.cash += W.cashUses - lastUses;
  lastUses = W.cashUses;
};
let mutated = 0;
const killOrig = game.gpOnKill;
game.gpOnKill = function (e, src, by) {
  if (e.mutated) mutated++;
  return killOrig.call(this, e, src, by);
};
// GP_PERF=1: time this lane's two per-step calls.
const perf = { ms: 0, n: 0 };
if (env.GP_PERF) {
  const pre = game.gameplayPreWeapons;
  const upd = game.updateGameplay;
  game.gameplayPreWeapons = function (dt) { const t = performance.now(); pre.call(this, dt); perf.ms += performance.now() - t; };
  game.updateGameplay = function (dt) { const t = performance.now(); upd.call(this, dt); perf.ms += performance.now() - t; perf.n++; };
}
const t0 = Date.now();
const r = (globalThis as any).window.botRun(Number(env.GP_SECS ?? 600), env.GP_GOD === '1');
console.log(JSON.stringify({ cfg: on ? 'on' : 'off', seed, diff: settings.difficulty, kit: kit.join('/'), mode: r.mode, stage: r.stage, t: r.t, level: r.level, kills: r.kills, runTime: Math.round(game.runTime), stages: r.stages, bosses: r.bosses, avgMs: r.avgMs, ...c, mutantKills: mutated, laneMsPerStep: perf.n ? +(perf.ms / perf.n).toFixed(4) : undefined, wall: Date.now() - t0 }));
process.exit(0);
