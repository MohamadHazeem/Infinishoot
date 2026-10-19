/**
 * Stability lane (notes/lanes/crashfuzz.md): regression tests for the crashes and leaks found by
 * the crash fuzzer (scripts/fuzz.mjs) and the soak test (scripts/soak.mjs). Each block replays the
 * situation that broke, in a jsdom game with test-link timers on the simulation clock.
 */
import { seedRandom, simTimers } from './jsdomEnv';
import { ok } from './check';

process.on('unhandledRejection', (e) => {
  console.error('FAIL unhandled rejection', e);
  process.exit(1);
});
const timerErrors: string[] = [];
simTimers.onError = (e) => timerErrors.push((e as Error).stack ?? String(e));
simTimers.install();
seedRandom(7);

const { Input } = await import('../src/core/input');
const { Game } = await import('../src/game/game');
const { installBot } = await import('../src/dev/bot');
const { applyTestLink } = await import('../src/dev/testLinks');
const { fuzzLink } = await import('../src/dev/fuzzLinks');

const input = new Input(document.getElementById('game') as HTMLCanvasElement);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
installBot(game, input);
const botStep = (window as unknown as { botStep(): void }).botStep;
/** Plays `s` seconds with the bot, test-link timers on the game clock. Returns the first error thrown. */
const play = (s: number): string => {
  try {
    for (let i = 0; i < s * 60; i++) {
      botStep();
      simTimers.advance(1000 / 60);
      if (i % 10 === 0) game.render(1, 1 / 6);
    }
  } catch (e) {
    return (e as Error).stack ?? String(e);
  }
  return timerErrors.shift() ?? '';
};
const clearTimers = () => (simTimers.list.length = 0);

// ---------------------------------------------------------------- fuzz link generator
{
  const a = fuzzLink(1234);
  ok(a === fuzzLink(1234) && a.startsWith('?test') && a !== fuzzLink(1235), 'fuzz links are reproducible from their seed');
}

// ---------------------------------------------------------------- dev links: the dummy teammate leaves
// Fuzz: `?test&mate&mateemote=help&versus` threw every 2.5 s (coopEmote on hero 1 after Versus replaced the
// heroes), and `&downmate=4` threw once the dummy was gone. Both now check the dummy is still there.
{
  applyTestLink(game, '?test&god&mate&mateemote=help&downmate=2');
  ok(game.heroes.length === 2, 'dev link: the dummy teammate joins');
  game.leaveToTitle();
  ok(game.heroes.length === 1, 'dev link: back at the title the dummy is gone');
  const err = play(4);
  ok(err === '', 'dev link: the dummy\'s emote and down timers survive it leaving' + (err ? ':\n' + err.split('\n').slice(0, 4).join('\n') : ''));
  clearTimers();
}

// ---------------------------------------------------------------- autopilot: a wall between the hero and the portal
// Soak: the god bot sat in portal mode for good (stage 21 of the first soak; stages 8 and 25 in a stall hunt) pushing into a wall: after a
// flawless stage it heads for the golden portal, placed clear of the normal portal but not of where the hero had
// kited to, and it walked in a straight line. It now steps round walls (Autopilot.steer).
{
  applyTestLink(game, '?test&god&seed=11');
  const w = game.walls;
  const wall = game.arena.colliders.find((b) => b.maxX - b.minX >= 4 && b.maxX - b.minX <= 12 && b.maxZ - b.minZ <= 3 && !w.hitCircle((b.minX + b.maxX) / 2, b.minZ - 1.2, 0.8) && !w.hitCircle((b.minX + b.maxX) / 2, b.maxZ + 1.6, 1.2));
  ok(!!wall, 'autopilot: found a wall to hide the portal behind');
  if (wall) {
    game.enemies.clear();
    const cx = (wall.minX + wall.maxX) / 2;
    game.hero.player.teleport(cx, wall.minZ - 1.2);
    game.portal.open(cx, wall.maxZ + 1.6);
    game.mode = 'portal';
    game.modeT = 0;
    ok(!w.segmentClear(cx, wall.minZ - 1.2, cx, wall.maxZ + 1.6, 0.3), 'autopilot: the wall blocks the straight line');
    let t = 0;
    while (game.mode === 'portal' && t < 20) {
      botStep();
      t += 1 / 60;
    }
    ok(game.mode !== 'portal', `autopilot: the bot walks round the wall into the portal (${t.toFixed(1)} s, mode ${game.mode})`);
  }
  clearTimers();
}

// ---------------------------------------------------------------- shop: one waiting listener per animated title
// Churn soak (a fresh run every 20 s): +1 event listener per run. Opening the shop restarts its title's slam-in
// animation with a once-listener for animationend; the shop closed before the animation ended (the starting shop
// skipped at once), which cancels the animation without an animationend, so every opening left one more listener.
{
  applyTestLink(game, '?test&god');
  const h1 = document.querySelector<HTMLElement>('#scr-shop h1');
  let adds = 0;
  const add = HTMLElement.prototype.addEventListener;
  HTMLElement.prototype.addEventListener = function (this: HTMLElement, type: string, ...rest: unknown[]) {
    if (this === h1 && type === 'animationend') adds++;
    return (add as (...a: unknown[]) => void).call(this, type, ...rest);
  } as typeof add;
  for (let i = 0; i < 6; i++) {
    game.openShop();
    game.closeShop();
  }
  HTMLElement.prototype.addEventListener = add;
  ok(!!h1 && adds <= 1, `shop: six quick shop visits add at most one waiting animationend listener to its title (${adds})`);
  clearTimers();
}

process.exit(process.exitCode ?? 0);
