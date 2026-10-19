/**
 * How loud things are, for sound-reactive enemies (enemy defs with `ears`).
 * Every gameplay sound the host plays (Vfx.sound) leaves a noise blob at its
 * position; blobs decay, and nearby blobs merge. Enemies with ears are drawn
 * to loud blobs (rapid fire, explosions, grenades, the mech) and lose track of
 * you when it's quiet (right-click shots, auras, drones, sneaking).
 *
 * Loudness is per effects-bus cue (weapon cues are 'w:<cue>' with an optional
 * '|<evolution>' tag). Unlisted cues make no noise, so enemy sounds, pickups
 * and UI never attract anything.
 */

/** Loudness per cue (1 = one Buster shot). Documented in notes/lanes/sound2.md. */
export const LOUDNESS: Readonly<Record<string, number>> = {
  // Left clicks (rapid fire is the loud stuff).
  'w:shoot': 1, 'w:scatter': 1.3, 'w:pellets': 0.7, 'w:rail': 1.4, 'w:laser': 0.5, 'w:orb': 0.4,
  // Right clicks: quiet on purpose (a charge shot, a lob, a vortex, the shield).
  'w:chargeShot': 0.25, 'w:chargeFull': 0.3, 'w:charge': 0, 'w:lob': 0.6, 'w:vortex': 0.15, 'w:blackhole': 0.4,
  'w:shieldUp': 0.1, 'w:block': 0.2, 'w:uplink': 0.2, 'w:beam': 0.7, 'w:ready': 0,
  // Auto weapons: mostly quiet, explosions aren't.
  'w:drone': 0.2, 'w:bouncer': 0.3, 'w:disc': 0.35, 'w:missile': 0.9, 'w:mine': 0.5, 'w:lightning': 0.7, 'w:zap': 0.6,
  'w:storm': 1, 'w:meteor': 1.2, 'w:sweeper': 0.4, 'w:flame': 0.5, 'w:nova': 0.5, 'w:freeze': 0.3, 'w:aura': 0.1, 'w:explode': 1.3,
  // Blasts and specials.
  explode: 1.4, bomb: 2.5, impact: 0.6,
  // The mech suit and supply drops (sound lane cues).
  'w:mechCannon': 1.8, 'w:mechMissile': 1.4, 's2:mechStep': 1.1, 's2:mechStomp': 2, 's2:mechBoot': 1.5, 's2:mechEject': 2.2,
  's2:crateLand': 1.6,
};

export const hearingTuning = {
  enabled: true,
  /** Hearing range (m) at ears = 1 (heard loudness falls off linearly to 0 there). */
  range: 40,
  /** A blob this loud (after distance falloff) pulls an eared enemy toward it. */
  attract: 0.6,
  /** Below this everywhere in range (and no hero in sight) the enemy loses track and calms down. */
  calm: 0.3,
  /** An eared enemy keeps track of heroes this close whatever the noise (m): only enemies out at the screen edge calm down. */
  sight: 12,
  /** Lured enemies stop luring (and attack) this close to a hero (m). */
  engage: 4.5,
  /** Speed while rushing to a noise / wandering calmly (x its speed). */
  rushSpeed: 1.25,
  calmSpeed: 0.4,
  /** Blob decay time constant (s), merge radius (m), how much a repeat adds on top of its loudness. */
  decay: 1.1,
  merge: 4,
  stack: 0.15,
  cap: 4,
};

export function cueLoudness(name: string): number {
  const bar = name.indexOf('|');
  return LOUDNESS[bar < 0 ? name : name.slice(0, bar)] ?? 0;
}

/** 0 none, 1 drawn to a loud noise (♪ tell), 2 lost track and calm (zZ tell). */
export type Heard = 0 | 1 | 2;
export const HEARD = { None: 0, Attracted: 1, Calm: 2 } as const;

/** Fixed slots of noise blobs: allocation-free. */
export class NoiseField {
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly level: Float32Array;
  constructor(readonly size = 16) {
    this.x = new Float32Array(size);
    this.z = new Float32Array(size);
    this.level = new Float32Array(size);
  }

  /** A sound of loudness `loud` at (x, z). */
  add(x: number, z: number, loud: number): void {
    if (!(loud > 0) || !Number.isFinite(x) || !Number.isFinite(z)) return;
    const T = hearingTuning;
    let weakest = 0;
    for (let i = 0; i < this.size; i++) {
      const L = this.level[i];
      if (L > 0.02 && Math.abs(this.x[i] - x) < T.merge && Math.abs(this.z[i] - z) < T.merge) {
        // Merge: the blob drifts toward the newest sound, repeats stack up a little.
        const w = loud / (L + loud);
        this.x[i] += (x - this.x[i]) * w;
        this.z[i] += (z - this.z[i]) * w;
        this.level[i] = Math.min(T.cap, Math.max(L, loud) + loud * T.stack);
        return;
      }
      if (L < this.level[weakest]) weakest = i;
    }
    this.x[weakest] = x;
    this.z[weakest] = z;
    this.level[weakest] = Math.min(T.cap, loud);
  }

  decay(dt: number): void {
    const k = Math.exp(-dt / hearingTuning.decay);
    for (let i = 0; i < this.size; i++) this.level[i] = this.level[i] < 0.02 ? 0 : this.level[i] * k;
  }

  /** The loudest blob as heard from (x, z) within `range` (linear falloff). Writes its spot into `out`; returns the heard level. */
  loudest(x: number, z: number, range: number, out: { x: number; z: number }): number {
    let best = 0;
    for (let i = 0; i < this.size; i++) {
      const L = this.level[i];
      if (L <= 0) continue;
      const d = Math.hypot(this.x[i] - x, this.z[i] - z);
      if (d >= range) continue;
      const heard = L * (1 - d / range);
      if (heard > best) {
        best = heard;
        out.x = this.x[i];
        out.z = this.z[i];
      }
    }
    return best;
  }

  clear(): void {
    this.level.fill(0);
  }
}

/**
 * Pure decision for one eared enemy: given the loudest heard level and the
 * nearest hero distance, is it attracted (go to the noise), calm (wander),
 * or neither (normal chase / attack)?
 */
export function hearDecision(heard: number, heroDist: number, noiseDist: number): Heard {
  const T = hearingTuning;
  if (heroDist < T.engage) return HEARD.None;
  if (heard >= T.attract && noiseDist > 1.5) return HEARD.Attracted;
  if (heard < T.calm && heroDist > T.sight) return HEARD.Calm;
  return HEARD.None;
}
