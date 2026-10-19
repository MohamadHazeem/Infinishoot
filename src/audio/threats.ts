/**
 * Audio telegraphs for off-screen threats: sniper lock-on, mortar whistle,
 * charger wind-up, boss wind-ups, leaper crouch, elite arrival and the Reaper.
 * They play on the reserved `threat` bus (never ducked or muffled, priority
 * above everything but the announcer in the voice budget) and, with SOUND
 * ARROWS on, point at their source from the screen edge (src/ui/audioA11y.ts).
 */
import type { SynthKit } from './sfx';

export type ThreatId = 'sniper' | 'mortar' | 'charger' | 'boss' | 'leap' | 'elite' | 'reaper';

export const threatTuning = {
  /** Reserved-band gain (times the Effects volume). */
  gain: 1,
  /** Telegraphs never fade below this distance gain, so far ones stay audible. */
  minGain: 0.55,
  /** How long an edge arrow stays up after its sound (s). */
  arrowTime: 1.4,
  /** The Reaper's toll: interval far away -> right next to you (s), and the range it starts at (m). */
  reaperSlow: 2.2,
  reaperFast: 0.6,
  reaperRange: 40,
};

/** Effects-bus cue names that count as threats, and their arrow look. */
export const THREAT_CUES: Readonly<Record<string, { id: ThreatId; label: string; color: string }>> = {
  threatSniper: { id: 'sniper', label: 'SNIPER', color: '#b13e53' },
  threatMortar: { id: 'mortar', label: 'MORTAR', color: '#ef7d57' },
  chargerWindup: { id: 'charger', label: 'CHARGE', color: '#ffcd75' },
  bossWindup: { id: 'boss', label: 'BOSS', color: '#b13e53' },
  threatLeap: { id: 'leap', label: 'LEAP', color: '#a7f070' },
  threatElite: { id: 'elite', label: 'ELITE', color: '#ffcd75' },
  threatReaper: { id: 'reaper', label: 'REAPER', color: '#f4f4f4' },
};

export function threatOf(cue: string): (typeof THREAT_CUES)[string] | undefined {
  return THREAT_CUES[cue];
}

/** The Reaper toll interval for a distance (closer = faster). */
export function reaperInterval(dist: number): number {
  const T = threatTuning;
  const k = Math.max(0, Math.min(1, dist / T.reaperRange));
  return T.reaperFast + (T.reaperSlow - T.reaperFast) * k;
}

export function playThreat(k: SynthKit, id: ThreatId): void {
  switch (id) {
    case 'sniper':
      // Lock-on: three rising beeps then a held high tone.
      [1760, 2093, 2489].forEach((f, i) => k.tone('square', f, f, 0.045, 0.09, i * 0.09));
      k.tone('sine', 2960, 2960, 0.35, 0.08, 0.28);
      break;
    case 'mortar':
      // Incoming whistle: a falling sine with a slight wobble.
      k.tone('sine', 2600, 700, 0.75, 0.13);
      k.tone('sine', 2650, 720, 0.75, 0.05, 0.01);
      break;
    case 'leap':
      // Spring wind-up: a rising rubbery boing.
      k.tone('triangle', 160, 520, 0.3, 0.12);
      k.tone('square', 320, 1040, 0.3, 0.03);
      break;
    case 'elite':
      // Brassy two-tone horn.
      k.tone('sawtooth', 233, 233, 0.22, 0.09);
      k.tone('sawtooth', 311, 311, 0.32, 0.09, 0.2);
      k.tone('square', 466, 466, 0.32, 0.03, 0.2);
      break;
    case 'reaper':
      // Funeral toll: a low bell with inharmonic partials and a whisper.
      k.tone('sine', 110, 108, 1.1, 0.2);
      k.tone('sine', 263, 260, 0.8, 0.07);
      k.tone('triangle', 397, 395, 0.6, 0.04);
      k.noise(0.6, 0.08, 1800, 900, 3, 0.05);
      break;
    case 'charger':
    case 'boss':
      // These two keep their sfx methods (chargerWindup / bossWindup); nothing extra.
      break;
  }
}
