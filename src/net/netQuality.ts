/**
 * Connection quality numbers (netcode lane): the host's ping probes per
 * client, and how good or bad a connection reads on the HUD. Pure, tested in
 * tests/netcode.test.ts.
 */

export const netQualityTuning = {
  /** Seconds between host probes (`np`) to each client. */
  probeEvery: 1,
  /** A probe not answered within this (ms) counts as lost (on the reliable channel: badly late). */
  probeLost: 1500,
  /** Probe results kept for the loss figure. */
  probeWindow: 20,
  /** Smoothing of the round trip (share of each new sample). */
  rttBlend: 0.25,
  /** Seconds between a client's quality reports (`nst`) to the host. */
  reportEvery: 2,
  /** Ping (ms) from which a connection reads poor / bad. */
  pingPoor: 130,
  pingBad: 220,
  /** Loss (%) from which a connection reads poor / bad. */
  lossPoor: 2,
  lossBad: 6,
  /** Snapshot rate (per s) below which a connection reads poor / bad (only while fighting). */
  ratePoor: 14,
  rateBad: 9,
  /** Host: a client silent this long (ms) shows as not responding... */
  staleMs: 2500,
  /** ...and this long (ms) is dropped (its hero goes on autopilot and waits for a reconnect). */
  dropMs: 8000,
  /** Client: the host silent this long (ms) and the client gives up on the connection and reconnects. */
  hostSilentMs: 6000,
  /** Client: keep trying to get back into the run for this long (s). Matches the host's autopilot wait. */
  reconnectFor: 60,
  /** Client: seconds between reconnect attempts. */
  retryEvery: 2,
};

export type NetLevel = 'good' | 'poor' | 'bad';

/** How a connection reads: rtt (ms), loss (%), snapshot rate (per s, 0 = unknown or not relevant). */
export function netLevel(rtt: number, loss: number, rate = 0): NetLevel {
  const T = netQualityTuning;
  if (rtt >= T.pingBad || loss >= T.lossBad || (rate > 0 && rate < T.rateBad)) return 'bad';
  if (rtt >= T.pingPoor || loss >= T.lossPoor || (rate > 0 && rate < T.ratePoor)) return 'poor';
  return 'good';
}

/** Host side: probes to one client, their round trip and how many never came back in time. */
export class ProbeTracker {
  private seq = 0;
  private out = new Map<number, number>();
  private results: number[] = [];
  rtt = 0;
  last = 0;

  /** A new probe id to send at `now`. */
  next(now: number): number {
    const n = ++this.seq;
    this.out.set(n, now);
    this.last = now;
    return n;
  }

  /** The client echoed probe `n` (sent at `sentAt`) at `now`. */
  answer(n: number, now: number): void {
    const sent = this.out.get(n);
    if (sent === undefined) return; // already counted as lost, or junk
    this.out.delete(n);
    const sample = now - sent;
    if (!(sample >= 0 && sample < 10000)) return;
    this.rtt = this.rtt > 0 ? this.rtt + (sample - this.rtt) * netQualityTuning.rttBlend : sample;
    this.push(0);
  }

  /** Count probes that are overdue as lost. */
  expire(now: number): void {
    for (const [n, at] of this.out) {
      if (now - at < netQualityTuning.probeLost) continue;
      this.out.delete(n);
      this.push(1);
    }
  }

  /** Lost share of recent probes (0..1). */
  get loss(): number {
    if (!this.results.length) return 0;
    let s = 0;
    for (const r of this.results) s += r;
    return s / this.results.length;
  }

  private push(lost: number): void {
    this.results.push(lost);
    if (this.results.length > netQualityTuning.probeWindow) this.results.shift();
  }
}
