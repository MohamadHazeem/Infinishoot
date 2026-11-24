import type { Game } from './game';

/** Run against a live game with either botRun(seconds, false) or the Gate 2 skill runner adapter. */
export async function measureThreatDamage(
  g: Game,
  run: (seconds: number) => unknown,
  seconds: number,
) {
  const damage = [0, 0, 0, 0];
  const original = g.hurtHero;
  g.hurtHero = (h, ...args) => {
    const before = h.player.hp,
      stage = g.stage;
    original.call(g, h, ...args);
    if (h === g.hero && stage >= 1) {
      while (damage.length < stage) damage.push(0);
      damage[stage - 1] += Math.max(0, before - h.player.hp);
    }
  };
  try {
    await run(seconds);
    return {
      damage: damage.map((n) => Math.round(n)),
      stage: g.stage,
      clearedLoop: g.victories > 0,
      elapsed: Math.round(g.runTime),
      mode: g.mode,
    };
  } finally {
    g.hurtHero = original;
  }
}
