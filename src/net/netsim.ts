/**
 * A bad internet connection in a box (netcode lane). Wraps one direction of a
 * transport: every message is delivered after a one-way latency plus random
 * jitter, and a "lost" packet is resent after a retransmit timeout.
 *
 * The game's data channel is reliable and ordered (SCTP), so a lost packet is
 * never missing: it arrives late, and everything sent after it waits behind it
 * (head-of-line blocking). That is what this models, so every message still
 * arrives exactly once, in order, and the codecs' deltas stay valid.
 *
 * Turn it on for a client with `?netsim=<latency ms>,<jitter ms>,<loss 0..1>`
 * (e.g. `?netsim=90,30,0.03`), or at runtime in dev builds through
 * `window.netsim` / `setNetSim()`. `npm run coop` uses it for the client.
 */

export interface NetSimConfig {
  /** One-way delay (ms). */
  latency: number;
  /** Extra random delay, 0..jitter ms, per message. */
  jitter: number;
  /** Chance a message's packet is lost and resent (0..1). */
  loss: number;
  /** Retransmit timeout (ms); 0 = derived from the latency (about one round trip plus 100 ms). */
  rto?: number;
}

/** Set while a simulated connection is configured (shared by every transport that asks for it). */
export const netSimState: { config: NetSimConfig | null } = { config: null };

/** Parse `90,30,0.03` (latency, jitter, loss). Returns null for junk or an all-zero config. */
export function parseNetSim(s: string | null | undefined): NetSimConfig | null {
  if (!s) return null;
  const [lat, jit, loss] = s.split(',').map(Number);
  const c: NetSimConfig = {
    latency: Math.max(0, Math.min(2000, lat || 0)),
    jitter: Math.max(0, Math.min(1000, jit || 0)),
    loss: Math.max(0, Math.min(0.5, loss || 0)),
  };
  return c.latency || c.jitter || c.loss ? c : null;
}

export function setNetSim(c: NetSimConfig | null): void {
  netSimState.config = c && (c.latency || c.jitter || c.loss) ? { ...c } : null;
}

/** When a message sent at `now` is delivered: latency, jitter, retransmits, never before the previous one. */
export function deliveryTime(c: NetSimConfig, now: number, prevAt: number, rand: () => number): number {
  let at = now + c.latency + rand() * c.jitter;
  const rto = c.rto || c.latency * 2 + 100;
  // Each loss costs a retransmit timeout; a resend can be lost too (at most 3 in a row).
  for (let k = 0; k < 3 && rand() < c.loss; k++) at += rto;
  return Math.max(at, prevAt);
}

/** One direction of a connection, delayed. */
export class NetSim<T = unknown> {
  private q: { at: number; msg: T }[] = [];
  private head = 0;
  private lastAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Messages delivered / pushed (tests and the coop script). */
  sent = 0;
  delivered = 0;

  constructor(
    private deliver: (msg: T) => void,
    private config: () => NetSimConfig | null = () => netSimState.config,
    private rand: () => number = Math.random,
    private now: () => number = () => performance.now(),
    /** false: the owner calls pump() itself (unit tests). */
    private timers = true,
  ) {}

  /** Send through the simulated link (straight through when no config is set and nothing is queued). */
  push(msg: T): void {
    const c = this.config();
    this.sent++;
    if (!c && this.head >= this.q.length) {
      this.delivered++;
      this.deliver(msg);
      return;
    }
    const at = c ? deliveryTime(c, this.now(), this.lastAt, this.rand) : Math.max(this.now(), this.lastAt);
    this.lastAt = at;
    this.q.push({ at, msg });
    this.arm();
  }

  /** Deliver everything due by `now`. Returns how many were delivered. */
  pump(now = this.now()): number {
    let n = 0;
    while (this.head < this.q.length && this.q[this.head].at <= now) {
      const m = this.q[this.head++].msg;
      n++;
      this.delivered++;
      this.deliver(m);
    }
    if (this.head > 64 && this.head * 2 > this.q.length) {
      this.q.splice(0, this.head);
      this.head = 0;
    }
    return n;
  }

  /** Messages still in flight. */
  get pending(): number {
    return this.q.length - this.head;
  }

  /** The connection died: whatever was in flight is gone. */
  drop(): void {
    this.q.length = 0;
    this.head = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(): void {
    if (!this.timers || this.timer || this.head >= this.q.length) return;
    const wait = Math.max(0, this.q[this.head].at - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
      this.arm();
    }, wait);
  }
}
