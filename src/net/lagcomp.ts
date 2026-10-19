/**
 * Lag compensation for clients' shots (netcode lane).
 *
 * A client draws enemies a little in the past (half the round trip plus its
 * playout delay), and its fire input reaches the host later still. So its
 * shots are aimed at where enemies were. The host keeps ~267 ms of enemy
 * positions (one row per simulation step) and, for bullets fired by a remote
 * hero, tests hits against where enemies were on that player's screen.
 *
 * Cheat-safety: the rewind comes from the step the client says it was looking
 * at (`vt` in its input), but it is clamped to `lagTuning.maxRewind` and to
 * what the host's own round-trip measurement allows (a client that claims a
 * big lag on a fast connection gets the fast connection's rewind). Only hit
 * tests rewind: damage, knockback and statuses land on the enemy as it is now.
 *
 * Positions are stored per uid in a fixed table (uid & mask), no allocation.
 */

export const lagTuning = {
  /** Longest rewind (s). */
  maxRewind: 0.25,
  /** The rewind can't exceed the host-measured round trip plus this (s): the client's playout delay. */
  delaySlack: 0.15,
  /** Without a host round-trip measurement yet, rewind at most this (s). */
  unmeasured: 0.1,
  /** Smoothing of a hero's rewind (share of each new input). */
  blend: 0.25,
  /** Extra search radius for rewound hit tests (m): how far an enemy can have moved in the rewind. */
  pad: 3,
  /** Off switch (debug panel / tests). */
  enabled: true,
};

/** Steps of history kept (at 60 Hz: 267 ms). */
export const HISTORY = 16;
const SLOTS = 4096;
const MASK = SLOTS - 1;

export interface Positioned {
  uid: number;
  x: number;
  z: number;
}

export class EnemyHistory {
  private xs = new Float32Array(SLOTS * HISTORY);
  private zs = new Float32Array(SLOTS * HISTORY);
  private uids = new Uint32Array(SLOTS);
  /** First recorded step of the uid in each slot. */
  private first = new Int32Array(SLOTS);
  /** Step each history row holds. */
  private rows = new Int32Array(HISTORY).fill(-1);
  /** Newest recorded step. */
  latest = -1;

  clear(): void {
    this.uids.fill(0);
    this.rows.fill(-1);
    this.latest = -1;
  }

  /** Record where every active enemy is at `step` (call once per step, after the simulation). */
  record<E extends Positioned & { active: boolean }>(step: number, list: readonly E[]): void {
    const row = ((step % HISTORY) + HISTORY) % HISTORY;
    this.rows[row] = step;
    this.latest = step;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.active) continue;
      const s = e.uid & MASK;
      if (this.uids[s] !== e.uid) {
        this.uids[s] = e.uid;
        this.first[s] = step;
      }
      this.xs[s * HISTORY + row] = e.x;
      this.zs[s * HISTORY + row] = e.z;
    }
  }

  /**
   * Where `e` was `back` steps (fractional) before the newest record. Writes
   * `out` and returns true, or returns false (not recorded that far back: use
   * the enemy where it is).
   */
  at(e: Positioned, back: number, out: { x: number; z: number }): boolean {
    if (this.latest < 0 || !(back > 0)) return false;
    const s = e.uid & MASK;
    if (this.uids[s] !== e.uid) return false;
    const t = this.latest - Math.min(back, HISTORY - 1);
    let s0 = Math.floor(t);
    if (s0 < this.first[s]) s0 = this.first[s];
    const f = Math.max(0, Math.min(1, t - s0));
    const r0 = ((s0 % HISTORY) + HISTORY) % HISTORY;
    if (this.rows[r0] !== s0 || this.latest - s0 >= HISTORY) return false;
    let x = this.xs[s * HISTORY + r0];
    let z = this.zs[s * HISTORY + r0];
    if (f > 0 && s0 + 1 <= this.latest) {
      const r1 = (s0 + 1) % HISTORY;
      if (this.rows[r1] === s0 + 1) {
        x += (this.xs[s * HISTORY + r1] - x) * f;
        z += (this.zs[s * HISTORY + r1] - z) * f;
      }
    }
    out.x = x;
    out.z = z;
    return true;
  }
}

/**
 * The rewind (in steps) the host allows for a hero: the steps between what the
 * client was looking at and when its input arrived, clamped by the tuning and
 * by the host-measured round trip (ms, 0 = not measured yet).
 */
export function allowedRewind(claimedSteps: number, rttMs: number): number {
  if (!lagTuning.enabled || !(claimedSteps > 0)) return 0;
  const cap = rttMs > 0 ? rttMs / 1000 + lagTuning.delaySlack : lagTuning.unmeasured;
  return Math.min(claimedSteps, Math.min(lagTuning.maxRewind, cap) * 60);
}
