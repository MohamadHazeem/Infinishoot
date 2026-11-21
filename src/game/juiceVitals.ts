import { healthPressure, heartbeatPeriod } from '../audio/lowHealth';

/** The edge follows the local player's existing two-part heartbeat, even with the sound turned down. */
export class LifePulse {
  private age = 0;
  private remaining = 0;

  update(dt: number, hp: number, maxHp: number, low: boolean, still: boolean): number {
    if (!low || hp <= 0) {
      this.age = this.remaining = 0;
      return 0;
    }
    const pressure = healthPressure(hp, maxHp);
    dt = Math.min(0.1, Math.max(0, dt));
    this.remaining -= dt;
    this.age += dt;
    if (this.remaining <= 0) {
      this.remaining = heartbeatPeriod(pressure);
      this.age = 0;
    }
    if (still) return 0.14;
    const first = Math.max(0, 1 - this.age / 0.15);
    const second = this.age < 0.18 ? 0 : Math.max(0, 1 - (this.age - 0.18) / 0.13);
    return 0.10 + (0.12 + 0.13 * pressure) * Math.max(first, 0.65 * second);
  }
}
