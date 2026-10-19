/**
 * Trading lane LEGEND bench (not in npm test). LG_PLAYERS=1..4 LG_DIFF=nightmare|legend LG_SEED=n LG_SECS=s
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
const seed = Number(env.LG_SEED ?? 1);
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
const { save, unlockedWeapons } = await import('../src/game/save');
const { joinTuning } = await import('../src/game/coop2');
const LT = await import('../src/game/trading');
if (env.LG_HP) LT.legendTuning.hp = env.LG_HP.split(',').map(Number);
if (env.LG_DMG) LT.legendTuning.dmg = env.LG_DMG.split(',').map(Number);
if (env.LG_COUNT) LT.legendTuning.count = env.LG_COUNT.split(',').map(Number);
save.achievements.push('hard_stage3');
joinTuning.grace = 1e9; // dropped teammates stay on autopilot all run
settings.deathReplay = false;
settings.coopJoinable = false;
settings.helpGhosts = false;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
installBot(game, input);
const n = Number(env.LG_PLAYERS ?? 2);
settings.mode = 'standard';
settings.difficulty = env.LG_DIFF ?? 'legend';
settings.hero = 'rookie';
settings.pet = 'none';
settings.loadout = { primary: 'buster', secondary: 'charge', special: 'bomb' };
const g = game as any;
if (n > 1) {
  g.role = 'host';
  g.host = { code: 'BENCH', send() {}, broadcast() {}, close() {} };
  const heroes = ['rookie', 'ace', 'bulwark', 'dash'];
  g.setHeroes(Array.from({ length: n }, (_, i) => g.makeHero(i, `P${i}`, unlockedWeapons(), i ? `peer${i}` : '', 'classic', 'none', heroes[i])));
  g.lobby = g.heroes.map((h: any) => ({ peerId: h.peerId, name: h.name, unlocked: [], skin: 'classic', pet: 'none', hero: h.heroDef.id, loadout: g.hero.loadoutPick }));
  g.startRun();
  g.update(1 / 60); // coop2 starts its run bookkeeping first
  for (let i = 1; i < n; i++) g.onClientLeft(`peer${i}`); // autopilot
} else game.startSolo();
game.rng = new Rng(seed);
// Threat: raw damage aimed at the heroes (counted before god mode drops it), per hero-minute of fighting.
let raw = 0;
const hurt = g.hurtHero;
g.hurtHero = function (h: any, dmg: number, ...rest: any[]) {
  if (!h.player.dead && h.player.invuln <= 0) raw += dmg;
  return hurt.call(this, h, dmg, ...rest);
};
const t0 = Date.now();
// LG_GOD=1: nobody dies (power curve and threat); else until everyone is down (botRun stops on 'dead').
const r = (globalThis as any).window.botRun(Number(env.LG_SECS ?? 1500), env.LG_GOD === '1');
console.log(JSON.stringify({ n, diff: settings.difficulty, eff: { hp: game.difficulty.enemyHp, dmg: game.difficulty.enemyDmg, count: game.difficulty.enemyCount }, seed, mode: r.mode, stage: r.stage, t: r.t, level: r.level, runTime: Math.round(game.runTime), threat: Math.round(raw / Math.max(1, n * game.runTime / 60)), kills: r.kills, stages: r.stages, bosses: r.bosses, wall: Date.now() - t0 }));
process.exit(0);
