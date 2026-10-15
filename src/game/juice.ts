import { sfx } from '../audio/sfx';

/**
 * Game-feel state shared by all systems: hit-stop (brief simulation freeze),
 * trauma-based random screen shake, and directional camera kicks (recoil,
 * impacts) that spring back to rest.
 */
export const juiceTuning = {
  shakeMax: 0.7, // world units of camera offset at full trauma
  shakeDecay: 1.6, // trauma lost per second
  hitStopScale: 1, // multiply all hit-stops (0 disables)
  shakeScale: 1, // multiply all shake and kicks (player setting)
  kickStiffness: 380,
  kickDamping: 26,
};

export class Juice {
  hitStop = 0;
  trauma = 0;
  private t = 0;
  private kx = 0;
  private kz = 0;
  private kvx = 0;
  private kvz = 0;

  /** Freeze the simulation for `seconds` (the longest pending request wins). */
  freeze(seconds: number): void {
    this.hitStop = Math.max(this.hitStop, seconds * juiceTuning.hitStopScale);
    // Big freezes also muffle the sound for a beat.
    if (seconds >= 0.08 && juiceTuning.hitStopScale > 0) sfx.muffle(seconds);
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount * juiceTuning.shakeScale);
  }

  /** Directional camera punch, e.g. opposite the aim when firing. */
  kick(dirX: number, dirZ: number, amount: number): void {
    const a = amount * juiceTuning.shakeScale;
    this.kvx += dirX * a;
    this.kvz += dirZ * a;
  }

  reset(): void {
    this.hitStop = this.trauma = this.kx = this.kz = this.kvx = this.kvz = 0;
  }

  /** Advances decay and springs; called every render frame (keeps going during hit-stop). */
  tick(frameDt: number): void {
    const dt = Math.min(frameDt, 1 / 30);
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - juiceTuning.shakeDecay * dt);
    const k = juiceTuning.kickStiffness;
    const c = juiceTuning.kickDamping;
    this.kvx += (-k * this.kx - c * this.kvx) * dt;
    this.kvz += (-k * this.kz - c * this.kvz) * dt;
    this.kx += this.kvx * dt;
    this.kz += this.kvz * dt;
  }

  /** Current camera offset (x, z): smooth pseudo-noise shake plus kick spring. */
  shakeOffset(out: { x: number; z: number }): void {
    const s = this.trauma * this.trauma * juiceTuning.shakeMax;
    const t = this.t * 40;
    out.x = this.kx + s * (Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.3 + 1.7) * 0.4);
    out.z = this.kz + s * (Math.sin(t * 1.3 + 4.1) * 0.6 + Math.sin(t * 2.9 + 0.3) * 0.4);
  }
}
