/**
 * Cheap phase timers for the benchmark (`npm run bench`, test link `&bench`).
 * Off by default: every call is one boolean test. When on, `lap(name)` adds the
 * time since the previous lap (or `lapStart()`) to that phase's total, and the
 * main loop records per-frame update / render / GL-submit times.
 * scripts/bench.mjs reads `window.__prof` and resets it after the warm-up.
 */
export const prof = {
  on: false,
  /** Accumulated ms per phase name (simulation phases `sim.*`, render phases `ren.*`). */
  phase: {} as Record<string, number>,
  /** Per rendered frame: [update ms (all sim steps), game.render ms, renderer.render ms, frame interval ms, sim steps]. */
  frames: [] as number[][],
  steps: 0,
  t: 0,
};

// Replay scopes replace performance.now with the simulation clock. Profiling must
// retain the native monotonic clock, including inside update/render callbacks.
const wallNow = performance.now.bind(performance);

export function lapStart(): void {
  if (prof.on) prof.t = wallNow();
}

export function lap(name: string): void {
  if (!prof.on) return;
  const now = wallNow();
  prof.phase[name] = (prof.phase[name] ?? 0) + (now - prof.t);
  prof.t = now;
}

export function profReset(): void {
  prof.phase = {};
  prof.frames = [];
  prof.steps = 0;
}
