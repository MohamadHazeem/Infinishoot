/**
 * Evolution sound layers: every evolved loadout item (track evolutions, keyed
 * "<item id>.<evo id>") and every auto weapon's partner evolution
 * ("<weapon id>.evo") adds a synth layer on top of its base cue, so an evolved
 * weapon sounds different from across the arena.
 *
 * Weapons send `w:<cue>|<key>` through the effects bus (src/game/systems/sound.ts
 * `weaponCue`), so clients hear the layer exactly where they hear the base cue;
 * specials and the Bomb send `evo:<key>` next to their own cue.
 */
import type { SynthKit } from './sfx';

/** Sound characters. Each evolution picks one, plus a pitch so siblings differ. */
export type EvoChar =
  | 'fire'
  | 'shock'
  | 'frost'
  | 'blast'
  | 'prism'
  | 'mirror'
  | 'void'
  | 'heavy'
  | 'swarm'
  | 'radiant'
  | 'cluster'
  | 'thunder';

export interface EvoLayer {
  char: EvoChar;
  /** Multiplies the character's frequencies (siblings of one character stay apart). */
  pitch: number;
  /** Layer loudness, 1 = default. */
  gain?: number;
}

export const evoTuning = {
  /** Overall layer gain on top of the base cue. */
  gain: 1,
};

export const EVO_LAYERS: Readonly<Record<string, EvoLayer>> = {
  'crosswind.evo': { char: 'swarm', pitch: 1.65, gain: 0.7 },
  'tesla.evo': { char: 'thunder', pitch: 1.6, gain: 0.65 },
  'swarm.evo': { char: 'cluster', pitch: 1.6, gain: 0.65 },
  'prism.evo': { char: 'prism', pitch: 1.7, gain: 0.75 },
  'whip.sunlash': { char: 'fire', pitch: 1.4, gain: 0.8 },
  'whip.twinlash': { char: 'shock', pitch: 1.5, gain: 0.8 },
  'sentry.cryo': { char: 'frost', pitch: 1.4, gain: 0.6 },
  'sentry.ember': { char: 'fire', pitch: 1.7, gain: 0.6 },
  // Left click
  'buster.flare': { char: 'fire', pitch: 1.2 },
  'buster.volt': { char: 'shock', pitch: 1.25 },
  'scatter.dragon': { char: 'fire', pitch: 0.8, gain: 1.2 },
  'scatter.flak': { char: 'cluster', pitch: 1 },
  'laser.prism': { char: 'prism', pitch: 1 },
  'laser.scorch': { char: 'fire', pitch: 0.65 },
  'orb.storm': { char: 'shock', pitch: 0.8 },
  'orb.cryo': { char: 'frost', pitch: 0.9 },
  'rail.ion': { char: 'blast', pitch: 1.3 },
  'rail.storm': { char: 'thunder', pitch: 1.2 },
  // Right click
  'charge.star': { char: 'radiant', pitch: 0.9, gain: 1.2 },
  'charge.lance': { char: 'shock', pitch: 0.6, gain: 1.2 },
  'grenade.cluster': { char: 'cluster', pitch: 0.8 },
  'grenade.thunder': { char: 'thunder', pitch: 0.9 },
  'well.horizon': { char: 'void', pitch: 0.8 },
  'well.cryo': { char: 'frost', pitch: 0.7 },
  'shield.mirror': { char: 'mirror', pitch: 1 },
  'shield.pyre': { char: 'fire', pitch: 1 },
  'orbital.sun': { char: 'radiant', pitch: 0.7 },
  'orbital.barrage': { char: 'thunder', pitch: 0.75 },
  // Specials (Q/E)
  'bomb.cluster': { char: 'cluster', pitch: 0.6, gain: 1.3 },
  'bomb.implode': { char: 'void', pitch: 0.6, gain: 1.3 },
  'storm.supercell': { char: 'thunder', pitch: 0.6, gain: 1.3 },
  'storm.firestorm': { char: 'fire', pitch: 0.55, gain: 1.3 },
  'blizzard.iceage': { char: 'frost', pitch: 0.55, gain: 1.3 },
  'blizzard.glacier': { char: 'blast', pitch: 0.7, gain: 1.2 },
  'meteor.extinction': { char: 'fire', pitch: 0.45, gain: 1.4 },
  'meteor.comet': { char: 'frost', pitch: 1.2, gain: 1.2 },
  'blackhole.supermassive': { char: 'void', pitch: 0.45, gain: 1.4 },
  'blackhole.whitehole': { char: 'radiant', pitch: 1.2, gain: 1.3 },
  // Auto weapons (partner-item evolutions)
  'drones.evo': { char: 'heavy', pitch: 1.4, gain: 0.7 },
  'aura.evo': { char: 'thunder', pitch: 1.1, gain: 0.7 },
  'lightning.evo': { char: 'thunder', pitch: 1.4 },
  'discs.evo': { char: 'swarm', pitch: 1.3, gain: 0.8 },
  'missiles.evo': { char: 'blast', pitch: 0.9 },
  'mines.evo': { char: 'cluster', pitch: 1.3, gain: 0.8 },
  'nova.evo': { char: 'frost', pitch: 1.1 },
  'fire.evo': { char: 'radiant', pitch: 1.5, gain: 0.7 },
  'sweeper.evo': { char: 'prism', pitch: 1.25, gain: 0.8 },
  'pellets.evo': { char: 'fire', pitch: 1.5, gain: 0.8 },
  'bouncer.evo': { char: 'swarm', pitch: 0.9, gain: 0.8 },
  'starfall.evo': { char: 'prism', pitch: 0.75 },
};

/** Fallback for evolutions added later without a layer entry: a bright sparkle. */
const DEFAULT: EvoLayer = { char: 'prism', pitch: 1.1, gain: 0.7 };

export function evoLayerOf(key: string): EvoLayer {
  return EVO_LAYERS[key] ?? DEFAULT;
}

/** Add `key`'s layer to the voice the kit is building. `scale` lowers it when riding a weapon cue. */
export function playEvoLayer(k: SynthKit, key: string, scale: number): void {
  const L = evoLayerOf(key);
  const p = L.pitch;
  const v = (L.gain ?? 1) * scale * evoTuning.gain;
  if (v <= 0) return;
  switch (L.char) {
    case 'fire':
      // Crackle: three short band-passed pops over a low roar.
      for (let i = 0; i < 3; i++) k.noise(0.03, 0.22 * v, 2600 * p, 1400 * p, 3, i * 0.035 + Math.random() * 0.015);
      k.noise(0.22, 0.2 * v, 500 * p, 1500 * p, 1);
      k.tone('sawtooth', 110 * p, 70 * p, 0.2, 0.06 * v);
      break;
    case 'shock':
      // Buzzy zap: two detuned squares diving, plus a hiss.
      k.tone('square', 2200 * p, 700 * p, 0.09, 0.05 * v);
      k.tone('square', 2330 * p, 760 * p, 0.09, 0.04 * v, 0.01);
      k.noise(0.07, 0.18 * v, 6500, 3500, 3);
      break;
    case 'frost':
      // Glassy chime: high inharmonic sines and a sparkle.
      k.tone('sine', 2637 * p, 2600 * p, 0.28, 0.06 * v);
      k.tone('sine', 3520 * p, 3480 * p, 0.2, 0.04 * v, 0.03);
      k.noise(0.15, 0.08 * v, 8000, 9000, 6, 0.02);
      break;
    case 'blast':
      // Sub thump under the report.
      k.tone('sine', 110 * p, 34, 0.26, 0.24 * v);
      k.noise(0.18, 0.22 * v, 420 * p, 90, 0.8);
      break;
    case 'prism':
      // Bright rising triad.
      [1047, 1319, 1568].forEach((f, i) => k.tone('triangle', f * p, f * p, 0.09, 0.05 * v, i * 0.03));
      break;
    case 'mirror':
      // Metallic ring (inharmonic partials).
      k.tone('square', 1400 * p, 1380 * p, 0.16, 0.04 * v);
      k.tone('triangle', 1980 * p, 1960 * p, 0.22, 0.05 * v);
      k.tone('sine', 3070 * p, 3050 * p, 0.28, 0.03 * v, 0.02);
      break;
    case 'void':
      // Down-sweep into a rumble: the pull of a singularity.
      k.tone('sine', 700 * p, 55, 0.45, 0.12 * v);
      k.noise(0.4, 0.18 * v, 300 * p, 70, 2, 0.05);
      break;
    case 'heavy':
      // Octave-down saw thud.
      k.tone('sawtooth', 160 * p, 80 * p, 0.12, 0.07 * v);
      k.tone('sine', 90 * p, 45, 0.15, 0.12 * v);
      break;
    case 'swarm':
      // Chorus of three detuned triangles: a buzzing pack.
      for (let i = 0; i < 3; i++) k.tone('triangle', (440 + i * 9) * p, (880 + i * 13) * p, 0.14, 0.035 * v, i * 0.012);
      break;
    case 'radiant':
      // Shimmering rise: two sines climbing an octave.
      k.tone('sine', 1200 * p, 2400 * p, 0.24, 0.05 * v);
      k.tone('sine', 1800 * p, 3600 * p, 0.24, 0.03 * v, 0.02);
      k.noise(0.2, 0.07 * v, 5000, 9000, 4);
      break;
    case 'cluster':
      // A ripple of small pops after the main report.
      for (let i = 0; i < 4; i++) k.noise(0.05, 0.22 * v, (900 - i * 90) * p, 200, 1.2, 0.05 + i * 0.05);
      break;
    case 'thunder':
      // Lightning crack: a sharp noise snap and a falling square.
      k.noise(0.09, 0.3 * v, 4200 * p, 700, 1.5);
      k.tone('square', 1600 * p, 200 * p, 0.12, 0.05 * v);
      k.noise(0.3, 0.12 * v, 260, 90, 1, 0.06);
      break;
  }
}
