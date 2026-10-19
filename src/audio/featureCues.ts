/**
 * Proper sounds for the wave-1 features that used placeholder cues: the mech
 * suit (boot-up, servo steps, stomps, arm cannons, missile salvo, eject),
 * supply crates (flare, plane and parachute, landing), the Titan (rising
 * rumble, arm sweep, weak point breaking), world events (start stingers,
 * cracking floor, collapse, colossus steps, flood rush, eclipse drone, the
 * flower blooming, the volcano), comeback mode, the last stand's heartbeat and
 * clock, and the instrument pickups.
 *
 * They travel on the effects bus as 's2:<name>' (game.vfx.sound), so clients
 * hear them with no codec change; sfx.named plays them from LANE_CUES. Weapon
 * cues (the mech's guns) are 'w:<name>' through sfx.weapon's default branch.
 * A cue may also start a surround stinger (src/audio/surround.ts).
 */
import type { Bus, SynthKit } from './sfx';
import type { SurroundId } from './surround';

export interface LaneCue {
  /** Rate limit per cue (s). */
  gap: number;
  /** Voice-budget priority (0 swarm noise .. 4 big moments; see mix.ts). */
  priority: number;
  bus?: Bus;
  /** Also sweep this stinger around the listener. */
  surround?: SurroundId;
  recipe(k: SynthKit, pitch: number): void;
}

/** Set by src/audio/surround.ts when it loads (keeps sfx.ts free of the surround graph). */
export const laneHooks: { surround: ((id: SurroundId) => void) | null } = { surround: null };

const crackBurst = (k: SynthKit, n: number, delay: number, vol: number) => {
  for (let i = 0; i < n; i++) k.noise(0.05 + (i % 3) * 0.02, vol * (1 - i / (n * 1.5)), 2400 + ((i * 1777) % 2600), 900, 6, delay + i * 0.07 + ((i * 37) % 5) * 0.012);
};

/** A servo whirr into a heavy metal foot. */
function mechStep(k: SynthKit, p: number): void {
  k.tone('sawtooth', 260 * p, 380 * p, 0.12, 0.03);
  k.tone('sine', 90, 42, 0.2, 0.24, 0.1);
  k.noise(0.1, 0.18, 420, 160, 0.9, 0.1);
  k.tone('square', 1900, 1500, 0.03, 0.025, 0.11);
}

export const LANE_CUES: Readonly<Record<string, LaneCue>> = {
  // ---------------------------------------------------------------- mech suit
  mechBoot: {
    gap: 0.5, priority: 4, recipe: (k) => {
      // Servos spool up, two heavy clunks lock in, hydraulics hiss, a ready chirp.
      k.swell('sawtooth', 90, 420, 0.9, 0.07, 0.5);
      k.swell('square', 180, 840, 0.9, 0.025, 0.6);
      k.noise(0.12, 0.35, 300, 120, 0.8, 0.45);
      k.tone('sine', 110, 50, 0.25, 0.3, 0.45);
      k.noise(0.12, 0.35, 260, 110, 0.8, 0.7);
      k.tone('sine', 95, 45, 0.25, 0.3, 0.7);
      k.noise(0.5, 0.16, 5000, 2500, 1.2, 0.85, 0.05);
      k.tone('square', 1320, 1320, 0.06, 0.05, 1.1);
      k.tone('square', 1760, 1760, 0.1, 0.05, 1.18);
    },
  },
  mechStep: { gap: 0.12, priority: 3, recipe: mechStep },
  mechStomp: {
    gap: 0.2, priority: 4, recipe: (k, p) => {
      // A step plus the shockwave thud and a hydraulic hiss.
      mechStep(k, p);
      k.tone('sine', 70, 26, 0.6, 0.3, 0.1);
      k.noise(0.4, 0.25, 300, 70, 0.6, 0.1);
      k.noise(0.45, 0.12, 5000, 2500, 1.2, 0.25, 0.04);
    },
  },
  mechEject: {
    gap: 0.5, priority: 4, recipe: (k) => {
      // Latches pop, a gas hiss, the empty suit clanks down.
      k.tone('square', 900, 500, 0.05, 0.08);
      k.tone('square', 760, 420, 0.05, 0.08, 0.07);
      k.noise(0.6, 0.3, 6000, 1800, 0.9, 0.05);
      k.tone('sine', 140, 40, 0.4, 0.28, 0.3);
      k.noise(0.25, 0.2, 1200, 500, 3, 0.32);
      k.tone('triangle', 620, 610, 0.5, 0.04, 0.34);
    },
  },
  mechDrop: {
    gap: 0.5, priority: 4, recipe: (k) => {
      // It hits the ground hard, then a beacon beeps.
      k.tone('sine', 120, 35, 0.45, 0.35);
      k.noise(0.3, 0.3, 500, 120, 0.8);
      for (let i = 0; i < 3; i++) k.tone('square', 1046, 1046, 0.07, 0.05, 0.35 + i * 0.22);
    },
  },
  // ---------------------------------------------------------------- supply crates
  crateDrop: {
    gap: 0.5, priority: 4, recipe: (k) => {
      // A flare sputters alight, a plane drones over, the chute snaps open and flutters down.
      k.noise(0.9, 0.18, 3500, 2600, 1.4, 0, 0.05);
      k.noise(0.06, 0.25, 1800, 900, 1, 0);
      k.swell('sawtooth', 98, 88, 2.2, 0.035, 0.9, 0.1);
      k.swell('sawtooth', 99.5, 89, 2.2, 0.03, 0.9, 0.1);
      k.noise(0.08, 0.3, 1400, 600, 1.2, 1.1);
      for (let i = 0; i < 9; i++) k.noise(0.06, 0.06, 800 + (i % 3) * 200, 500, 2, 1.2 + i * 0.17);
    },
  },
  crateLand: {
    gap: 0.3, priority: 4, recipe: (k) => {
      // Wood crate thud, a creak, the contents rattle.
      k.tone('sine', 150, 55, 0.3, 0.32);
      k.noise(0.18, 0.32, 700, 250, 1);
      k.tone('triangle', 240, 200, 0.25, 0.05, 0.12);
      for (let i = 0; i < 4; i++) k.tone('square', 1500 + i * 230, 1300, 0.03, 0.03, 0.16 + i * 0.05);
    },
  },
  // ---------------------------------------------------------------- the Titan
  titanRise: {
    gap: 2, priority: 4, recipe: (k) => {
      // The ground splits: a deep crack, then rock grinding upward for the 3 s rise.
      k.noise(0.4, 0.45, 600, 100, 0.8);
      k.tone('sine', 70, 30, 0.6, 0.4);
      k.swell('sine', 30, 46, 3, 0.3, 2);
      k.noise(3, 0.3, 120, 380, 0.7, 0.2, 2.2);
      crackBurst(k, 10, 0.4, 0.2);
    },
  },
  titanSweep: {
    gap: 0.25, priority: 4, recipe: (k) => {
      // A huge stone arm cutting the air.
      k.noise(0.75, 0.45, 260, 1400, 0.9, 0, 0.35);
      k.swell('sine', 60, 38, 0.8, 0.22, 0.4);
    },
  },
  titanBreak: {
    gap: 0.2, priority: 4, recipe: (k) => {
      // A weak point shatters: glassy crack, ringing shards, a power-down whine.
      k.noise(0.08, 0.5, 5000, 2500, 1.5);
      crackBurst(k, 8, 0.02, 0.25);
      [2637, 3136, 3951].forEach((f, i) => k.tone('sine', f, f * 0.98, 0.5 - i * 0.1, 0.05, 0.05 + i * 0.04));
      k.tone('sawtooth', 900, 120, 0.7, 0.06, 0.1);
    },
  },
  // ---------------------------------------------------------------- world events: start stingers
  ev_collapse: {
    gap: 2, priority: 4, recipe: (k) => {
      k.swell('sine', 45, 34, 2, 0.3, 0.8);
      k.noise(1.8, 0.2, 200, 120, 0.7, 0, 0.6);
      crackBurst(k, 8, 0.5, 0.18);
    },
  },
  ev_flood: {
    gap: 2, priority: 4, recipe: (k) => {
      // A distant roar of water getting closer, a dam-burst thump.
      k.noise(2.4, 0.3, 300, 1400, 0.6, 0, 1.6);
      k.noise(2.4, 0.12, 2500, 4500, 1, 0, 1.6);
      k.tone('sine', 80, 40, 0.5, 0.3, 1.6);
    },
  },
  ev_split: {
    gap: 2, priority: 4, recipe: (k) => {
      k.swell('sine', 40, 30, 2.4, 0.32, 1.2);
      crackBurst(k, 14, 0.2, 0.2);
      k.noise(2.2, 0.18, 160, 90, 0.6, 0.2, 1);
    },
  },
  ev_giant: {
    gap: 2, priority: 4, surround: 'colossus', recipe: (k) => {
      // Far-off footfalls getting closer.
      for (let i = 0; i < 3; i++) {
        k.tone('sine', 55, 32, 0.6, 0.12 + i * 0.08, i * 0.8);
        k.noise(0.4, 0.06 + i * 0.05, 200, 90, 0.7, i * 0.8);
      }
    },
  },
  ev_eclipse: {
    gap: 2, priority: 4, surround: 'eclipse', recipe: (k) => {
      // The light drains away: a falling shimmer into a low hum.
      [1568, 1318, 1046, 784, 659].forEach((f, i) => k.tone('sine', f, f * 0.94, 0.5, 0.04, i * 0.18));
      k.swell('sine', 110, 98, 3, 0.1, 1.5);
    },
  },
  ev_flower: {
    gap: 2, priority: 3, recipe: (k) => {
      // Something sprouting: a soft rising chime and a rustle.
      [523, 659, 784, 1046].forEach((f, i) => k.tone('triangle', f, f, 0.35, 0.07, i * 0.15));
      k.noise(0.6, 0.06, 3000, 5000, 2, 0.1, 0.2);
    },
  },
  ev_volcano: {
    gap: 2, priority: 4, recipe: (k) => {
      // A deep rumble builds, then the cone blows.
      k.swell('sine', 36, 30, 3, 0.35, 2.6);
      k.noise(3, 0.25, 90, 220, 0.6, 0, 2.6);
      k.noise(0.9, 0.35, 500, 80, 0.6, 2.8);
      k.tone('sine', 90, 28, 1.2, 0.3, 2.8);
    },
  },
  ev_stealth: {
    gap: 2, priority: 3, recipe: (k) => {
      // A hush: crickets, a low pad, a clock tick.
      for (let i = 0; i < 6; i++) k.tone('sine', 4200 + (i % 2) * 200, 4200, 0.04, 0.02, i * 0.12);
      k.swell('triangle', 147, 147, 2, 0.05, 0.8);
      k.tone('square', 1800, 1800, 0.02, 0.04, 1.2);
      k.tone('square', 1500, 1500, 0.02, 0.04, 1.7);
    },
  },
  // ---------------------------------------------------------------- world events: moments
  crack: {
    gap: 0.3, priority: 3, recipe: (k) => {
      // Stone splitting under your feet.
      crackBurst(k, 7, 0, 0.26);
      k.tone('sine', 60, 40, 0.5, 0.2);
    },
  },
  collapse: {
    gap: 0.4, priority: 4, recipe: (k) => {
      // Ground falling away into the void: a crunching roar that drops away.
      k.noise(1.4, 0.45, 400, 60, 0.6);
      k.tone('sine', 80, 25, 1.2, 0.4);
      crackBurst(k, 6, 0.1, 0.18);
      k.noise(1.2, 0.08, 1200, 200, 1, 0.3);
    },
  },
  giantStep: {
    gap: 0.4, priority: 4, recipe: (k) => {
      // A colossal stone foot: sub thump, rock crunch, a little debris patter.
      k.tone('sine', 52, 24, 0.9, 0.38);
      k.noise(0.5, 0.33, 260, 70, 0.6);
      for (let i = 0; i < 5; i++) k.noise(0.04, 0.08, 2200, 1500, 2, 0.25 + i * 0.09);
    },
  },
  sunBurst: {
    gap: 1, priority: 4, recipe: (k) => {
      // The sun returns: a bright major chord swell and shimmer.
      [523, 659, 784, 1046].forEach((f, i) => k.swell('triangle', f, f, 1.4, 0.07, 0.08, i * 0.02));
      k.noise(1.2, 0.12, 6000, 9000, 2, 0, 0.05);
      k.tone('sine', 2093, 2093, 0.8, 0.04, 0.1);
    },
  },
  bloom: {
    gap: 1, priority: 3, recipe: (k) => {
      // Petals opening: a harp-like run up and a soft whoosh of pollen.
      [392, 494, 587, 784, 988, 1175].forEach((f, i) => k.tone('triangle', f, f, 0.5, 0.07, i * 0.07));
      k.noise(0.9, 0.08, 1500, 5000, 1.2, 0.2, 0.3);
    },
  },
  floodRush: {
    gap: 0.6, priority: 2, recipe: (k) => {
      // Water surging in.
      k.noise(1.6, 0.22, 400, 900, 0.5, 0, 0.6);
      k.noise(1.6, 0.08, 3000, 2000, 1, 0, 0.6);
    },
  },
  floodLap: {
    gap: 0.4, priority: 1, recipe: (k, p) => {
      // A lapping splash.
      k.noise(0.25, 0.12, 900 * p, 400, 1.5, 0, 0.04);
      k.tone('sine', 500 * p, 260 * p, 0.1, 0.03, 0.04);
    },
  },
  eclipseDrone: {
    gap: 1, priority: 2, recipe: (k) => {
      // A low, uneasy drone while the sun is out (retriggered so it overlaps).
      k.swell('sine', 98, 96, 4.2, 0.07, 1.6);
      k.swell('sine', 103.8, 101, 4.2, 0.05, 1.8);
      k.noise(4.2, 0.035, 300, 260, 4, 0, 1.6);
    },
  },
  volcanoRumble: {
    gap: 1, priority: 2, recipe: (k) => {
      k.swell('sine', 34, 31, 2.8, 0.18, 1.1);
      k.noise(2.8, 0.14, 110, 160, 0.6, 0, 1.2);
    },
  },
  // ---------------------------------------------------------------- comeback, last stand
  comeback: {
    gap: 2, priority: 4, recipe: (k) => {
      // A low brass hit and a tense heartbeat.
      k.tone('sawtooth', 110, 104, 0.8, 0.12);
      k.tone('sawtooth', 165, 156, 0.8, 0.08);
      k.tone('sine', 65, 42, 0.18, 0.4, 0.55);
      k.tone('sine', 65, 42, 0.18, 0.3, 0.78);
    },
  },
  standBeat: {
    gap: 0.2, priority: 4, recipe: (k, p) => {
      // Lub-dub (louder as time runs out: pitch carries the urgency 1..2).
      k.tone('sine', 72, 44, 0.16, 0.35 * Math.min(1.4, p));
      k.tone('sine', 66, 40, 0.14, 0.26 * Math.min(1.4, p), 0.19);
    },
  },
  standTick: {
    gap: 0.08, priority: 4, recipe: (k, p) => {
      // A clock's tick-tock (tock a little lower).
      const f = p >= 1 ? 2100 : 1600;
      k.tone('square', f, f, 0.018, 0.045);
      k.noise(0.02, 0.05, 4000, 3000, 3);
    },
  },
  // ---------------------------------------------------------------- instruments
  instrumentAppear: {
    gap: 1, priority: 3, recipe: (k) => {
      [784, 988, 1175].forEach((f, i) => k.tone('triangle', f, f, 0.25, 0.06, i * 0.1));
    },
  },
  locator: {
    gap: 0.5, priority: 1, recipe: (k, p) => {
      // A little musical twinkle that tells you where the instrument is.
      k.tone('triangle', 1318 * p, 1318 * p, 0.12, 0.05);
      k.tone('triangle', 1975 * p, 1975 * p, 0.18, 0.04, 0.1);
    },
  },
  instrument: {
    gap: 0.5, priority: 4, recipe: (k) => {
      // It joins the band: a quick fanfare.
      [523, 659, 784, 1046, 784, 1046].forEach((f, i) => k.tone('square', f, f, 0.1, 0.06, i * 0.07));
      k.tone('triangle', 1318, 1318, 0.6, 0.08, 0.45);
      k.noise(0.4, 0.08, 4000, 8000, 2, 0.4);
    },
  },
  jackpot: {
    gap: 1, priority: 4, surround: 'jackpot', recipe: (k) => {
      [1046, 1318, 1568, 2093].forEach((f, i) => k.tone('square', f, f, 0.12, 0.05, i * 0.06));
    },
  },
};

/** The mech's guns (weapon cues from MechArsenal: 'w:mechCannon', 'w:mechMissile'). False if not one of them. */
export function playLaneWeapon(k: SynthKit, name: string, p: number): boolean {
  switch (name) {
    case 'mechCannon':
      // A heavy autocannon: a punchy low boom, a metallic clack and a shell casing.
      k.tone('square', 420 * p, 90, 0.09, 0.12);
      k.tone('sine', 120, 45, 0.18, 0.3);
      k.noise(0.12, 0.3, 1600, 400, 0.9);
      k.tone('triangle', 2400 * p, 2200, 0.04, 0.03, 0.12);
      return true;
    case 'mechMissile':
      // Four whooshing launches.
      for (let i = 0; i < 4; i++) {
        k.noise(0.35, 0.16, 500, 2600, 1.5, i * 0.07);
        k.tone('square', 300, 900, 0.08, 0.03, i * 0.07);
      }
      return true;
  }
  return false;
}

/** Priority of a lane cue name ('s2:<cue>'), for the voice budget. */
export function laneCuePriority(name: string): number {
  return LANE_CUES[name.slice(3)]?.priority ?? 2;
}
