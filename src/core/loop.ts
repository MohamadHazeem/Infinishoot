/**
 * Fixed-timestep game loop. Simulation runs at a constant rate; rendering
 * runs every animation frame with an interpolation factor between the last
 * two simulation states.
 *
 * Hidden tabs get no animation frames and throttle main-thread timers, so
 * while `runHidden()` is true (a co-op host) a worker timer keeps the
 * simulation stepping without rendering. Worker timers aren't throttled.
 */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
const MAX_FRAME = 0.25; // clamp long frames (tab switch, breakpoints)

export interface LoopCallbacks {
  update(dt: number): void;
  render(alpha: number, frameDt: number): void;
  runHidden(): boolean;
}

const TICKER = 'setInterval(() => postMessage(0), 1000 / 60);';

export class GameLoop {
  private acc = 0;
  private last = 0;
  private rafId = 0;
  private running = false;
  private ticker: Worker | null = null;
  paused = false;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
    this.ticker = new Worker(URL.createObjectURL(new Blob([TICKER], { type: 'text/javascript' })));
    this.ticker.onmessage = this.hiddenTick;
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.ticker?.terminate();
    this.ticker = null;
  }

  /** Advances the simulation to `now`; returns the clamped frame time. */
  private step(now: number): number {
    const frameDt = Math.min(Math.max(now - this.last, 0) / 1000, MAX_FRAME);
    this.last = now;
    if (!this.paused) {
      this.acc += frameDt;
      while (this.acc >= SIM_DT) {
        this.cb.update(SIM_DT);
        this.acc -= SIM_DT;
      }
    }
    return frameDt;
  }

  private hiddenTick = (): void => {
    if (!this.running || !document.hidden) return;
    const now = performance.now();
    if (this.cb.runHidden()) this.step(now);
    else this.last = now; // don't fast-forward on return
  };

  private frame = (now: number): void => {
    if (!this.running) return;
    const frameDt = this.step(now);
    this.cb.render(this.paused ? 1 : this.acc / SIM_DT, frameDt);
    this.rafId = requestAnimationFrame(this.frame);
  };
}
