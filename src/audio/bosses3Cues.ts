/**
 * Synth cues for the biome bosses (bosses3 lane): the DJ's record scratch and
 * bass drop, Boxer Jack's crank, spring and pop, Admiral Gale's horn and
 * cannons. They travel on the effects bus as 's2:b3<name>' and play through
 * sfx.laneCue, so clients hear them with no codec change. Roars and voice
 * lines are recorded (roar_glitch / boss_glitch_* ..., src/audio/voices.ts).
 */
import { LANE_CUES, type LaneCue } from './featureCues';

const CUES: Record<string, LaneCue> = {
  b3scratch: {
    gap: 0.4,
    priority: 3,
    recipe: (k) => {
      // A record pulled back and forth.
      k.noise(0.12, 0.3, 900, 3200, 4);
      k.noise(0.1, 0.26, 3000, 700, 4, 0.13);
      k.tone('sawtooth', 220, 660, 0.12, 0.05);
      k.tone('sawtooth', 640, 180, 0.1, 0.05, 0.13);
    },
  },
  b3drop: {
    gap: 0.4,
    priority: 4,
    recipe: (k) => {
      // The bass drops: a sub sweep with a kick and a fizz on top.
      k.tone('sine', 120, 32, 0.9, 0.45);
      k.tone('square', 60, 30, 0.6, 0.08);
      k.noise(0.3, 0.22, 200, 60, 0.7);
      k.noise(0.4, 0.08, 8000, 3000, 1, 0.05);
    },
  },
  b3crank: {
    gap: 0.25,
    priority: 3,
    recipe: (k, p) => {
      // Clicking wind-up crank plus a music-box tinkle.
      for (let i = 0; i < 5; i++) k.noise(0.025, 0.16, 3200, 2400, 8, i * 0.09);
      k.tone('triangle', 1568 * p, 1568 * p, 0.12, 0.05, 0.05);
      k.tone('triangle', 1319 * p, 1319 * p, 0.12, 0.05, 0.2);
      k.tone('triangle', 1175 * p, 1175 * p, 0.16, 0.05, 0.35);
    },
  },
  b3boing: {
    gap: 0.15,
    priority: 3,
    recipe: (k, p) => {
      // Spring: a wobbling pitch bend.
      k.tone('sine', 180 * p, 520 * p, 0.12, 0.3);
      k.tone('sine', 520 * p, 260 * p, 0.25, 0.2, 0.12);
      k.tone('triangle', 260 * p, 380 * p, 0.2, 0.08, 0.3);
    },
  },
  b3pop: {
    gap: 0.3,
    priority: 3,
    recipe: (k) => {
      k.noise(0.06, 0.4, 1800, 600, 1.2);
      k.tone('square', 660, 1320, 0.08, 0.1);
      k.tone('triangle', 990, 1980, 0.2, 0.08, 0.08);
    },
  },
  b3bounce: {
    gap: 0.12,
    priority: 3,
    recipe: (k) => {
      // Pinball bumper.
      k.tone('square', 880, 440, 0.07, 0.12);
      k.tone('square', 1320, 660, 0.07, 0.08, 0.05);
      k.noise(0.08, 0.2, 1200, 500, 1);
    },
  },
  b3cannon: {
    gap: 0.18,
    priority: 3,
    recipe: (k) => {
      k.noise(0.35, 0.4, 700, 90, 0.8);
      k.tone('sine', 110, 38, 0.4, 0.35);
      k.noise(0.6, 0.08, 3000, 800, 0.6, 0.08, 0.05);
    },
  },
  b3horn: {
    gap: 0.6,
    priority: 3,
    recipe: (k) => {
      // Ship's horn.
      k.swell('sawtooth', 146, 140, 0.7, 0.12, 0.08);
      k.swell('square', 220, 214, 0.7, 0.05, 0.08);
    },
  },
  b3remix: {
    gap: 1,
    priority: 4,
    recipe: (k) => {
      // A tape rewind into a stutter.
      k.swell('sawtooth', 900, 120, 0.5, 0.06, 0.02);
      for (let i = 0; i < 4; i++) k.tone('square', 330, 330, 0.05, 0.08, 0.5 + i * 0.08);
      k.noise(0.3, 0.2, 400, 1600, 3, 0.5);
    },
  },
};

for (const [id, c] of Object.entries(CUES)) (LANE_CUES as Record<string, LaneCue>)[id] = c;

/** Effects-bus name of a cue. */
export const b3Sound = (cue: string): string => `s2:b3${cue}`;
