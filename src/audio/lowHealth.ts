export const lowHealthTuning = { threshold: 0.25, bigHit: 0.18, ringCooldown: 3, cutoff: 1800, healthyCutoff: 20000 };
export function healthPressure(hp: number, maxHp: number): number {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0 || hp <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - hp / maxHp / lowHealthTuning.threshold));
}
export function heartbeatPeriod(pressure: number): number { return 1.05 - 0.6 * Math.max(0, Math.min(1, pressure)); }
export function healthCutoff(pressure: number): number {
  return lowHealthTuning.healthyCutoff * (lowHealthTuning.cutoff / lowHealthTuning.healthyCutoff) ** Math.max(0, Math.min(1, pressure));
}
/** Local state only; no timers, allocations or dependence on the simulation clock. */
export class LowHealthState {
  pressure = 0;
  beat = false;
  ring = false;
  private hp = -1;
  private maxHp = 0;
  private heart = 0;
  private cooldown = 0;
  reset(): void { this.hp = -1; this.maxHp = this.heart = this.cooldown = this.pressure = 0; }
  update(dt: number, hp: number, maxHp: number, active: boolean): void {
    dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    this.beat = this.ring = false;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.pressure = active ? healthPressure(hp, maxHp) : 0;
    if (active && hp > 0 && this.hp >= 0 && maxHp === this.maxHp && (this.hp - hp) / maxHp >= lowHealthTuning.bigHit && this.cooldown === 0) {
      this.ring = true;
      this.cooldown = lowHealthTuning.ringCooldown;
    }
    this.hp = active ? hp : -1;
    this.maxHp = maxHp;
    if (this.pressure > 0) {
      this.heart -= dt;
      if (this.heart <= 0) { this.beat = true; this.heart = heartbeatPeriod(this.pressure); }
    } else this.heart = 0;
  }
}
