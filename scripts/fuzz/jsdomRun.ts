/**
 * One jsdom crash-fuzz run (bundled and spawned by scripts/fuzz.mjs --jsdom):
 *   node jsdomRun.mjs <seed> <seconds> [link]
 * Boots the game like src/main.ts (minus WebGL), applies the fuzz link for the seed
 * (src/dev/fuzzLinks.ts) or the given link, lets the autoplay bot play `seconds` of
 * game time with test-link timers on the simulation clock, and prints one
 * `FUZZRESULT {json}` line with every error caught.
 */
import { jsdomErrors, seedRandom, simTimers } from '../../tests/jsdomEnv';

const seed = Number(process.argv[2]) || 1;
const seconds = Number(process.argv[3]) || 8;
type Err = { kind: string; msg: string; stack: string };
const errors: Err[] = [];
const push = (kind: string, e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  if (errors.length < 20) errors.push({ kind, msg: err.message, stack: err.stack ?? err.message });
};
process.on('uncaughtException', (e) => push('uncaught', e));
process.on('unhandledRejection', (e) => push('rejection', e));
const cerr = console.error.bind(console);
console.error = (...a: unknown[]) => {
  const e = a.find((x) => x instanceof Error) as Error | undefined;
  push('console', e ?? new Error(a.map(String).join(' ')));
};
simTimers.onError = (e) => push('timer', e);
simTimers.install();
seedRandom(seed);

const { fuzzLink } = await import('../../src/dev/fuzzLinks');
const link = process.argv[4] || fuzzLink(seed);
const t0 = Date.now();
let steps = 0;
let mode = '';
try {
  const { Input } = await import('../../src/core/input');
  const { Game } = await import('../../src/game/game');
  const { installBot } = await import('../../src/dev/bot');
  const { applyTestLink } = await import('../../src/dev/testLinks');
  const { setupTouch } = await import('../../src/ui/touch');
  const { PhotoMode } = await import('../../src/ui/photoMode');
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const input = new Input(canvas);
  const game = new Game(input, 16 / 9, hud, document.getElementById('reticle')!);
  setupTouch(hud, input, () => game.isCombatMode && game.screens.current === 'none');
  game.photo = new PhotoMode(game, canvas);
  applyTestLink(game, link);
  installBot(game, input);
  const step = (window as unknown as { botStep(): void }).botStep;
  const n = Math.round(seconds * 60);
  for (; steps < n; steps++) {
    step();
    simTimers.advance(1000 / 60);
    if (steps % 10 === 0) game.render(1, 1 / 6);
    if (steps % 60 === 0) await new Promise((r) => setImmediate(r)); // let promise jobs (and their rejections) run
  }
  mode = game.mode;
} catch (e) {
  push('throw', e);
}
await new Promise((r) => setImmediate(r));
for (const j of jsdomErrors) if (errors.length < 20) errors.push({ kind: 'jsdom', msg: j.split('\n')[0], stack: j });
console.error = cerr;
console.log('FUZZRESULT ' + JSON.stringify({ seed, link, steps, mode, ms: Date.now() - t0, errors }));
process.exit(0);
