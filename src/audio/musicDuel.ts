/**
 * Pure rules for two music moods (src/audio/music.ts plays them):
 *
 * Boss music duel: in a boss's last phase (and while the ring-of-fire duel
 * runs) the boss theme turns into call and response. Phrases of `bars` bars
 * alternate: the boss's phrase (its lead, doubled an octave down, your weapon
 * stems pulled back), then yours (the boss lead drops out, your stems play
 * louder and a lead answers the boss's phrase, echoing its rhythm a third up).
 * Hits on the boss and kills during your phrase add accents (bell stabs on
 * chord tones) and make the answer louder.
 *
 * Comeback tension: while the local hero is in comeback mode the song turns
 * minor (the major third, sixth and seventh flattened), a low-pass closes and
 * a heartbeat kick pulses under it. Tempo and the beat clock never change.
 */

export const duelTuning = {
  /** Bars per phrase (boss, then you). */
  bars: 2,
  /** Your weapon stems during the boss's phrase / yours (x their normal gain). */
  bossStems: 0.25,
  heroStems: 2.4,
  /** Accent left after each stab, and the most that can build up. */
  accentDecay: 0.62,
  accentMax: 1.6,
  /** The answer lead's volume (before accents). */
  answerVol: 0.5,
  /** Accent per kill and per 1% of boss life taken during your phrase. */
  perKill: 0.25,
  perHp: 0.6,
};

export const tensionTuning = {
  /** Low-pass while the song is tense (Hz). */
  cutoff: 1500,
};

/** 0 = no duel, 1 = the boss's phrase, 2 = yours. */
export type DuelTurn = 0 | 1 | 2;

/** Whose phrase a bar belongs to (the duel starts with the boss's call). */
export function duelTurnAt(bar: number, bars = duelTuning.bars): 1 | 2 {
  return Math.floor(Math.max(0, bar) / Math.max(1, bars)) % 2 === 0 ? 1 : 2;
}

/** A scale turned minor: major 3rd, 6th and 7th flattened (others kept). */
export function minorScale(scale: readonly number[]): number[] {
  return scale.map((s) => (s === 4 || s === 9 || s === 11 ? s - 1 : s));
}

/** The answer to a called degree: the same rhythm, a third up. */
export function answerDegree(call: number): number {
  return call + 2;
}
