/** Presentation-only cap. Simulation continues at its original fixed 60 Hz. */
export const displayState = { cap: 60 };
export class FramePacer {
  private next = 0;
  private previous = 0;
  private cap = -1;
  dt = 0;
  ready(now: number, cap: number): boolean {
    if (this.cap !== cap || now - this.previous > 250) { this.cap = cap; this.next = now; this.previous = now; }
    if (cap > 0 && now + 0.1 < this.next) return false;
    this.dt = Math.min(0.25, Math.max(0, (now - this.previous) / 1000));
    this.previous = now;
    if (cap > 0) {
      const interval = 1000 / cap;
      this.next = Math.max(this.next + interval, now + interval * 0.1);
    } else this.next = now;
    return true;
  }
}
