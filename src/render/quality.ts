/**
 * Graphics quality ladder and the auto-quality governor.
 *
 * The ladder runs from cheapest (0) to richest. The settings' LOW / MEDIUM /
 * HIGH pick a fixed rung (`MANUAL_LEVELS`); AUTO lets `QualityGovernor` move
 * between rungs from measured frame times to hold 60 fps. `renderQuality` is
 * the live rung, read by the renderer, the light picker, particles and the
 * other effects every frame.
 */

export interface QualityLevel {
  name: string;
  /** Internal vertical resolution (the low-res render target). */
  resolution: number;
  /** Dynamic point lights evaluated per frame (max MAX_LIGHTS). */
  lights: number;
  /** 0 = no glow, 1 = cheap glow taps, 2 = blurred bloom. */
  glow: 0 | 1 | 2;
  /** Screen-space shockwaves and heat shimmer. */
  distortion: boolean;
  /** Character outlines (an extra pass over every enemy and hero part: about a third of the scene's triangles in a big fight). */
  outlines: boolean;
  /** Particle density multiplier. */
  particles: number;
  /** Weather / grass density multiplier. */
  ambience: number;
  /** Motion streaks behind discs, missiles and charge shots. */
  streaks: boolean;
  /** Decorative smoke, debris, footprints, ground scars and destruction. */
  worldEffects: boolean;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { name: 'POTATO', resolution: 216, lights: 0, glow: 0, distortion: false, outlines: false, particles: 0.12, ambience: 0, streaks: false, worldEffects: false },
  { name: 'LOW', resolution: 216, lights: 2, glow: 0, distortion: false, outlines: false, particles: 0.3, ambience: 0.2, streaks: false, worldEffects: false },
  { name: 'LOW+', resolution: 240, lights: 6, glow: 1, distortion: true, outlines: true, particles: 0.75, ambience: 0.6, streaks: true, worldEffects: true },
  { name: 'MEDIUM', resolution: 270, lights: 10, glow: 2, distortion: true, outlines: true, particles: 1, ambience: 1, streaks: true, worldEffects: true },
  { name: 'HIGH', resolution: 360, lights: 16, glow: 2, distortion: true, outlines: true, particles: 1, ambience: 1, streaks: true, worldEffects: true },
];

/** Settings quality 0 / 1 / 2 (low / medium / high) to a ladder rung. 3 is AUTO. */
export const MANUAL_LEVELS = [1, 3, 4];
export const AUTO = 3;
/** Appended setting value: existing saves retain their preset. */
export const POTATO = 4;
/** Start conservatively: avoid compiling expensive shaders before the first frame. */
export const AUTO_START = 1;

/** Resolve a persisted preset without changing the meaning of old saves. */
export function qualitySettingLevel(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > POTATO || value === AUTO) return AUTO_START;
  return value === POTATO ? 0 : MANUAL_LEVELS[value];
}

/** Live rung. Headless consumers retain MEDIUM until applySettings selects the player preset. */
export const renderQuality: QualityLevel & { level: number; auto: boolean } = { ...QUALITY_LEVELS[MANUAL_LEVELS[1]], level: MANUAL_LEVELS[1], auto: true };

export function setRenderQuality(level: number, auto: boolean): void {
  const l = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, Number.isFinite(level) ? Math.round(level) : AUTO_START));
  Object.assign(renderQuality, QUALITY_LEVELS[l], { level: l, auto });
}

export const governorTuning = {
  /** Seconds of frames averaged per decision window. */
  window: 0.5,
  /** A window averaging slower than this (ms per frame) counts as bad. */
  downMs: 19,
  /** Frames slower than this count as stutters; too many make a window bad. */
  slowMs: 26,
  slowFrac: 0.2,
  /** Consecutive bad windows before stepping down. */
  downWindows: 3,
  /** A window averaging faster than this (with almost no stutters) counts as good. 60 Hz vsync is 16.7 ms. */
  upMs: 17.6,
  /** Seconds of good windows before trying the next rung up. */
  upAfter: 8,
  /** Seconds to ignore after any change (resolution changes hitch) and at start. */
  cooldown: 2,
  warmup: 1,
  /** Sustained frames below 30 fps take the fast descent path. */
  urgentMs: 33,
  urgentCooldown: 0.25,
  /** Stepping back down within this many seconds of stepping up marks that rung as too heavy... */
  probation: 10,
  /** ...and blocks retrying it for this long, doubling each failure up to the cap. */
  backoff: 20,
  backoffMax: 240,
  /** Frames longer than this are hitches (tab switch, GC, loading) and ignored. */
  ignoreMs: 200,
};

/**
 * Steps quality down when frames are slow and back up after a long calm, with
 * hysteresis: a rung that fails soon after stepping up is blocked for a
 * growing back-off, so the governor doesn't oscillate. Pure logic (no DOM).
 */
export class QualityGovernor {
  level: number;
  private clock = 0;
  private cool: number;
  private acc = 0;
  private n = 0;
  private slow = 0;
  private winT = 0;
  private bad = 0;
  private good = 0;
  private upAt = -1e9;
  private blockedUntil: number[];
  private backoff: number[];

  constructor(
    start = AUTO_START,
    readonly min = 0,
    readonly max = QUALITY_LEVELS.length - 1,
    private t = governorTuning,
  ) {
    this.level = start;
    this.cool = t.warmup;
    this.blockedUntil = new Array(max + 1).fill(0);
    this.backoff = new Array(max + 1).fill(t.backoff);
  }

  /** Feed one frame time (seconds). Returns the new rung when it changes, else -1. */
  sample(dt: number): number {
    const t = this.t;
    this.clock += dt;
    if (this.cool > 0) {
      this.cool -= dt;
      return -1;
    }
    const ms = dt * 1000;
    if (ms > t.ignoreMs || ms <= 0) return -1;
    this.acc += ms;
    this.n++;
    if (ms > t.slowMs) this.slow++;
    this.winT += dt;
    if (this.winT < t.window) return -1;

    const avg = this.acc / this.n;
    const slowFrac = this.slow / this.n;
    const win = this.winT;
    this.acc = this.n = this.slow = this.winT = 0;

    if (avg > t.downMs || slowFrac > t.slowFrac) {
      this.bad += avg >= t.urgentMs ? t.downWindows : 1;
      this.good = 0;
    } else {
      this.bad = 0;
      if (avg < t.upMs && slowFrac < 0.05) this.good += win;
      else this.good = 0;
    }

    if (this.bad >= t.downWindows && this.level > this.min) {
      const from = this.level;
      if (this.clock - this.upAt < t.probation) {
        // The rung we just climbed to can't hold 60 fps: stay off it for a while.
        this.blockedUntil[from] = this.clock + this.backoff[from];
        this.backoff[from] = Math.min(t.backoffMax, this.backoff[from] * 2);
      }
      const level = this.change(from - 1);
      if (avg >= t.urgentMs) this.cool = t.urgentCooldown;
      return level;
    }
    if (this.good >= t.upAfter && this.level < this.max && this.clock >= this.blockedUntil[this.level + 1]) {
      this.upAt = this.clock;
      return this.change(this.level + 1);
    }
    return -1;
  }

  /** Seconds the given rung is still blocked for (0 = free). For tests and the debug panel. */
  blockedFor(level: number): number {
    return Math.max(0, (this.blockedUntil[level] ?? 0) - this.clock);
  }

  private change(level: number): number {
    this.level = level;
    this.cool = this.t.cooldown;
    this.bad = this.good = 0;
    this.acc = this.n = this.slow = this.winT = 0;
    return level;
  }
}
