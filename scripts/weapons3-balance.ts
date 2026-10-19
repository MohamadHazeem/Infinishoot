/** Reproducible fixed-build bot comparison. Bundle with rolldown (see lane notes). */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window as unknown as Record<string, unknown>;
const noop: any = new Proxy(function () {}, {
  get: (_t, k) =>
    k === 'data'
      ? new Uint8ClampedArray(4 * 64 * 64)
      : k === Symbol.toPrimitive
        ? () => 0
        : k === 'measureText'
          ? () => ({ width: 10 })
          : noop,
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, {
    get: (_t, k) =>
      k === 'createImageData' || k === 'getImageData'
        ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) })
        : k === 'canvas'
          ? this
          : noop[k as never],
  });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLInputElement',
  'Event',
  'KeyboardEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'innerWidth',
  'innerHeight',
  'addEventListener',
  'dispatchEvent',
  'Node',
  'MouseEvent',
  'PointerEvent',
]) {
  try {
    (globalThis as any)[k] = (dom.window as any)[k];
  } catch {
    Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
  }
}
(globalThis as any).Path2D = class {
  constructor(_d?: string) {}
};
(globalThis as any).__APP_VERSION__ = 'smoke';
(dom.window as any).Path2D = (globalThis as any).Path2D;
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};

(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
// Any crash must fail the test (a rejected top-level await can otherwise exit 0 silently).
process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});

const { Input } = await import('../src/core/input');
const { Game, cheats } = await import('../src/game/game');
const { installBot } = await import('../src/dev/bot');
const { settings } = await import('../src/game/settings');
const { createWeapon } = await import('../src/game/weapons');
const { WEAPONS } = await import('../src/data/weapons');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const game = new Game(
  input,
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
installBot(game, input);
settings.mode = 'standard';
settings.difficulty = 'normal';
settings.hero = 'rookie';
settings.pet = 'none';
cheats.unlockAll = true;
// Remove temporary weapons, cash-ins, map chests and event buffs from this comparison.
// These can replace a click weapon or alter its build while a bot is running.
game.gameplayPreWeapons = () => {};
game.updateGameplay = () => {};
game.gpOnKill = () => {};
game.gpCashIn = () => '';
game.updateChestSpawns = () => {};
game.openChest = () => {};
game.runEvents.update = () => {};
game.runEvents.onKill = () => {};
game.updateWorldEvent = () => {};

const all = [
  'crosswind',
  'discs',
  'tesla',
  'lightning',
  'swarm',
  'missiles',
  'prism',
  'bouncer',
  'whip',
  'laser',
  'sentry',
  'grenade',
];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all;
for (const id of ids)
  for (const tier of ['base', 'max', 'evo0', ...(WEAPONS[id].slot ? ['evo1'] : [])]) {
    const rows = [];
    for (const seed of [42, 77, 123]) {
      game.startRun({ seed, difficulty: 'normal' });
      if (game.mode === 'shop') game.closeShop();
      game.loadStage(2);
      game.director.time = 90;
      game.xpNext = 1e12;
      for (const w of game.hero.weapons) w.dispose();
      game.hero.weapons.length = 0;
      const w = createWeapon(id, game.scene);
      if (tier !== 'base') {
        if (w.build) for (let t = 0; t < 3; t++) for (let r = 0; r < 4; r++) w.addRank(t);
        else while (!w.maxed) w.levelUp();
        if (tier.startsWith('evo')) w.evolve(Number(tier.slice(-1)));
      }
      game.hero.weapons.push(w);
      game.hero.loadoutDirty = true;
      game.hero.setPet('none');
      game.hero.damageBy = {};
      // Only the tested weapon deals damage; the unmodified bot still moves, aims and clicks.
      game.tryBomb = () => {};
      game.tryUlt = () => {};
      const before = game.runTime;
      const report = (window as any).botRun(60, true);
      const seconds = game.runTime - before;
      rows.push({
        seed,
        dps: +((game.hero.damageBy[id] ?? 0) / seconds).toFixed(1),
        kills: game.kills,
        ms: report.avgMs,
      });
    }
    console.log(
      'BALANCE',
      JSON.stringify({
        id,
        tier,
        dps: +(rows.reduce((n, r) => n + r.dps, 0) / rows.length).toFixed(1),
        rows,
      }),
    );
  }
process.exit(0);
