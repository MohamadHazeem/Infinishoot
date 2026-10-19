/**
 * Stage-1 pacing bench for the firstten lane (not part of `npm test`):
 *   npx rolldown tests/firstten.pacing.ts --format esm --platform node --external jsdom --inline-dynamic-imports -o node_modules/.tests/pacing.mjs && node node_modules/.tests/pacing.mjs
 * Plays the first 4 minutes of stage 1 with the dev bot on a fresh save (default kit),
 * mortal and god, over several seeds, and prints when the first moments land:
 * first level-up, first chest, first elite, the biggest multi-kill, levels per minute.
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
(globalThis as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'bench';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { installBot } = await import('../src/dev/bot');
const { Rng } = await import('../src/core/rng');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
installBot(game, input);
const W = (globalThis as any).window;
const botStep = W.botStep as () => void;
const cheats = (await import('../src/game/game')).cheats;
const seeds = (process.env.SEEDS ?? '11,22,33,44,55').split(',').map(Number);
const secs = Number(process.env.SECS ?? 240);

const rows: Record<string, unknown>[] = [];
for (const god of [false, true]) {
  for (const seed of seeds) {
    game.startSolo();
    game.rng = new Rng(seed);
    // The bot leaves the starting shop on its first step.
    cheats.god = god;
    const m = { god, seed, lv1: -1, chest: -1, chestOpen: -1, elite: -1, ring: -1, best1s: 0, best1sAt: -1, wow8: -1, died: -1, minHp: 999, lv30: 0, lv60: 0, lv90: 0, lv120: 0, lv240: 0, alive30: 0, alive60: 0, alive90: 0, levelups90: 0, hits60: 0 };
    const killsAt: number[] = [];
    let lastLevel = 1;
    let chestsOpened = 0;
    let hp0 = game.player.hp;
    for (let i = 0; i < secs * 60 * 1.5 && game.mode !== 'dead' && game.mode !== 'title'; i++) {
      botStep();
      if (game.mode !== 'fight' && game.mode !== 'levelup') continue;
      const t = game.director.time;
      if (t > secs || game.stage > 1) break;
      killsAt.push(game.kills);
      const k = killsAt.length;
      if (k > 60) {
        const d = killsAt[k - 1] - killsAt[k - 61];
        if (d > m.best1s) { m.best1s = d; m.best1sAt = Math.round(t); }
        if (d >= 8 && m.wow8 < 0) m.wow8 = Math.round(t);
      }
      if (game.level > lastLevel) {
        if (m.lv1 < 0) m.lv1 = +t.toFixed(1);
        if (t <= 90) m.levelups90 += game.level - lastLevel;
        lastLevel = game.level;
      }
      if (m.chest < 0 && game.chests.closedCount > 0) m.chest = Math.round(t);
      if (m.elite < 0 && game.enemies.list.some((e) => e.active && e.elite)) m.elite = Math.round(t);
      if (game.player.hp < hp0 && t <= 60) m.hits60++;
      hp0 = game.player.hp;
      m.minHp = Math.min(m.minHp, Math.round(game.player.hp));
      for (const s of [30, 60, 90, 120, 240]) if (Math.abs(t - s) < 1 / 120) (m as any)['lv' + s] = game.level;
      for (const s of [30, 60, 90]) if (Math.abs(t - s) < 1 / 120) (m as any)['alive' + s] = game.enemies.activeCount;
      void chestsOpened;
    }
    if (game.mode === 'dead') m.died = Math.round(game.director.time);
    rows.push(m);
    console.log(JSON.stringify(m));
    game.leaveToTitle();
  }
}
const avg = (god: boolean, k: string) => {
  const r = rows.filter((x) => x.god === god).map((x) => x[k] as number).filter((v) => v >= 0);
  return r.length ? +(r.reduce((a, b) => a + b, 0) / r.length).toFixed(1) : -1;
};
for (const god of [false, true]) console.log((god ? 'GOD   ' : 'MORTAL'), JSON.stringify(Object.fromEntries(['lv1', 'chest', 'elite', 'best1s', 'wow8', 'lv30', 'lv60', 'lv90', 'lv120', 'lv240', 'alive30', 'alive60', 'levelups90', 'hits60', 'died', 'minHp'].map((k) => [k, avg(god, k)]))), 'deaths', rows.filter((x) => x.god === god && (x.died as number) >= 0).length);
process.exit(0);
