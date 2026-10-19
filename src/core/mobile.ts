/** Device hints, never a user-agent sniff: tablets with a fine pointer also count. */
export function mobileDevice(
  touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
  shortSide = typeof screen === 'undefined' ? Infinity : Math.min(screen.width, screen.height),
  coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
): boolean {
  return coarse || (touchPoints > 0 && shortSide <= 1024);
}

/** A render-only gate. Simulation/input/network keep their normal fixed timestep. */
export class MobileFrameGate {
  private next = 0;
  private elapsed = 0;
  dt = 0;
  ready(now: number, dt: number, capped: boolean): boolean {
    this.elapsed += dt;
    if (capped && now + 0.5 < this.next) return false;
    this.next = capped ? Math.max(this.next + 1000 / 30, now) : now;
    this.dt = this.elapsed;
    this.elapsed = 0;
    return true;
  }
}
