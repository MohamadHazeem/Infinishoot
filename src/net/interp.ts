/**
 * Client playout buffer (netcode lane): snapshots are applied on a steady
 * clock that runs a little behind the host, instead of the moment they arrive.
 *
 * Every snapshot carries the host's simulation step (`hs`). Arrival time minus
 * step time is the "offset"; its minimum over the last few seconds is the
 * fastest the network delivered (the base), and how far samples sit above it
 * is the jitter. The playout clock aims at `host now - delay`, where the delay
 * is one snapshot interval plus the jitter (adaptive, clamped), and it drifts
 * toward that target by a few percent (time warp) instead of jumping, unless
 * it is far off. Snapshots are applied when the clock reaches the previous
 * one, so remote things are always drawn between two known states; when the
 * buffer runs dry the picture extrapolates for a short, capped while.
 *
 * Pure (time is passed in), unit-tested in tests/netcode.test.ts.
 */

/** One host simulation step (ms). */
export const STEP_MS = 1000 / 60;

export const interpTuning = {
  /** Smallest and largest playout delay (ms). */
  minDelay: 50,
  maxDelay: 250,
  /** Added to interval + jitter (ms). */
  margin: 12,
  /** Share of the jitter spread (90th percentile) covered by the delay. */
  jitterCover: 1.1,
  /** How far the picture may run past the newest snapshot (ms) before it holds still. */
  extrapMax: 100,
  /** Clock speed change allowed when steering toward the target (0.08 = +-8%). */
  warp: 0.08,
  /** Further off than this (ms) and the clock jumps instead of steering. */
  snapErr: 400,
  /** Snapshots kept waiting at most (older ones are applied at once). */
  queueMax: 30,
  /** Offset samples in the base/jitter window (20 per second). */
  window: 64,
  /** A sample this much later than usual (ms, at least) counts as a stall (a resent packet). */
  stallMs: 70,
};

export interface PlayoutStats {
  /** Current playout delay (ms). */
  delay: number;
  /** Jitter spread, 90th percentile above the base (ms). */
  jitter: number;
  /** Snapshots per second over the last 2 s. */
  rate: number;
  /** Share of recent snapshots that started a stall (an estimate of packet loss, 0..1). */
  loss: number;
  /** Snapshots waiting. */
  queued: number;
  /** Host steps between snapshots (smoothed). */
  interval: number;
}

export class Playout<T> {
  private q: { step: number; item: T }[] = [];
  private offs: Float64Array;
  private scratch: Float64Array;
  private stall: Uint8Array;
  private n = 0;
  private k = 0;
  private base = 0;
  private lastPushStep = NaN;
  private lastLate = 0;
  private arrivals: number[] = [];
  /** Host step the picture shows (fractional), and when it was last advanced. */
  renderStep = NaN;
  private clockAt = 0;
  /** Host steps of the two applied snapshots the picture sits between. */
  prevStep = NaN;
  lastStep = NaN;
  readonly stats: PlayoutStats = { delay: interpTuning.minDelay, jitter: 0, rate: 0, loss: 0, queued: 0, interval: 3 };

  constructor() {
    const w = interpTuning.window;
    this.offs = new Float64Array(w);
    this.scratch = new Float64Array(w);
    this.stall = new Uint8Array(w);
  }

  /** Forget everything (a new connection or run). */
  reset(): void {
    this.q.length = 0;
    this.n = this.k = 0;
    this.lastPushStep = this.renderStep = this.prevStep = this.lastStep = NaN;
    this.arrivals.length = 0;
    this.lastLate = 0;
    Object.assign(this.stats, { delay: interpTuning.minDelay, jitter: 0, rate: 0, loss: 0, queued: 0, interval: 3 });
  }

  /** A snapshot for host step `step` arrived at `now` (ms). */
  push(step: number, now: number, item: T): void {
    const T = interpTuning;
    const w = this.offs.length;
    // A step older than the newest means the host restarted its clock (new run or host): start over.
    if (step < this.lastPushStep - 600) this.reset();
    if (Number.isFinite(this.lastPushStep) && step > this.lastPushStep) {
      const d = Math.min(30, step - this.lastPushStep);
      this.stats.interval += (d - this.stats.interval) * 0.1;
    }
    this.lastPushStep = Math.max(step, Number.isFinite(this.lastPushStep) ? this.lastPushStep : step);
    const off = now - step * STEP_MS;
    const slot = this.k;
    this.offs[slot] = off;
    this.k = (this.k + 1) % w;
    if (this.n < w) this.n++;
    // Base: the fastest recent delivery.
    let base = Infinity;
    for (let i = 0; i < this.n; i++) if (this.offs[i] < base) base = this.offs[i];
    this.base = base;
    // Jitter: 90th percentile above the base.
    const s = this.scratch.subarray(0, this.n);
    for (let i = 0; i < this.n; i++) s[i] = this.offs[i] - base;
    s.sort();
    const jitter = s[Math.min(this.n - 1, Math.floor(this.n * 0.9))];
    const median = s[this.n >> 1];
    this.stats.jitter = jitter;
    // Stalls: a sample much later than usual, where the previous one wasn't (one resent packet holds up the rest).
    const late = off - base > median + Math.max(T.stallMs, median * 2) ? 1 : 0;
    this.stall[slot] = late && !this.lastLate ? 1 : 0;
    this.lastLate = late;
    let stalls = 0;
    for (let i = 0; i < this.n; i++) stalls += this.stall[i];
    this.stats.loss = this.n >= 8 ? stalls / this.n : 0;
    this.arrivals.push(now);
    while (this.arrivals.length && now - this.arrivals[0] > 2000) this.arrivals.shift();
    this.stats.rate = this.arrivals.length / 2;
    this.stats.delay = Math.max(T.minDelay, Math.min(T.maxDelay, this.stats.interval * STEP_MS + jitter * T.jitterCover + T.margin));
    // Keep order (the data channel is ordered, but be safe).
    let i = this.q.length;
    while (i > 0 && this.q[i - 1].step > step) i--;
    this.q.splice(i, 0, { step, item });
    this.stats.queued = this.q.length;
  }

  /** The host step the picture should show at `now`. */
  target(now: number): number {
    return (now - this.base - this.stats.delay) / STEP_MS;
  }

  /** Advance the clock to `now` and apply what's due, oldest first. Returns how many were applied. */
  update(now: number, apply: (item: T, step: number) => void): number {
    const T = interpTuning;
    let applied = 0;
    if (!this.q.length && !Number.isFinite(this.lastStep)) return 0;
    const target = this.target(now);
    if (!Number.isFinite(this.renderStep) || Math.abs(target - this.renderStep) * STEP_MS > T.snapErr) this.renderStep = target;
    else {
      const dt = Math.max(0, now - this.clockAt) / STEP_MS;
      const err = target - (this.renderStep + dt); // how far off the clock would be at normal speed
      const rate = 1 + Math.max(-T.warp, Math.min(T.warp, err * 0.05));
      this.renderStep += dt * rate;
    }
    this.clockAt = now;
    // The very first snapshot shows at once (the game needs a world to draw).
    if (!Number.isFinite(this.lastStep) && this.q.length) {
      const s = this.q.shift()!;
      this.prevStep = this.lastStep = s.step;
      apply(s.item, s.step);
      applied++;
    }
    while (this.q.length && (this.renderStep >= this.lastStep || this.q.length > T.queueMax)) {
      const s = this.q.shift()!;
      this.prevStep = this.lastStep;
      this.lastStep = s.step;
      apply(s.item, s.step);
      applied++;
    }
    this.stats.queued = this.q.length;
    return applied;
  }

  /** Apply everything now (before a message that changes the world, like a new stage). */
  flush(apply: (item: T, step: number) => void): number {
    let n = 0;
    while (this.q.length) {
      const s = this.q.shift()!;
      this.prevStep = this.lastStep;
      this.lastStep = s.step;
      apply(s.item, s.step);
      n++;
    }
    if (n) this.renderStep = this.lastStep;
    this.stats.queued = 0;
    return n;
  }

  /** Drop what's waiting without applying it (the connection is gone). */
  clearQueue(): void {
    this.q.length = 0;
    this.stats.queued = 0;
  }

  /**
   * Where the picture sits between the two applied snapshots at `now`:
   * 0 = the older one, 1 = the newer, above 1 = extrapolating (capped).
   */
  alpha(now: number): number {
    const span = this.lastStep - this.prevStep;
    if (!(span > 0)) return 1;
    const rs = this.renderStep + Math.max(0, now - this.clockAt) / STEP_MS;
    const a = (rs - this.prevStep) / span;
    const max = 1 + interpTuning.extrapMax / STEP_MS / span;
    return a < 0 ? 0 : a > max ? max : a;
  }
}

/** Snap instead of blending when a remote thing moved further than this between two snapshots (m): a teleport. */
export const SNAP_DIST = 6;

/** True if a move from (ax, az) to (bx, bz) is a teleport (draw it at the new spot, don't slide). */
export function isTeleport(ax: number, az: number, bx: number, bz: number, dist = SNAP_DIST): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz > dist * dist;
}
