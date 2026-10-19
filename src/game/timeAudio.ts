import { sfx } from '../audio/sfx';

/**
 * Time lane cues, synthesized through the shared voice budget (sfx.play),
 * so the EFFECTS volume and ducking apply. Every machine plays them locally
 * from time events (src/game/systems/time.ts).
 */
export type TimeCue = 'rewind' | 'play' | 'stand' | 'standWin' | 'standFail' | 'bulletTime' | 'clutch' | 'replay' | 'deny' | 'vote';

export function timeSound(cue: TimeCue, gain = 1): void {
  const v = Math.max(0, Math.min(1, gain));
  if (v <= 0.01) return;
  switch (cue) {
    case 'rewind':
      // A tape spooling back: a falling-then-rising whir under hiss.
      sfx.play('tm-rewind', 0.4, 'sfx', (k) => {
        k.tone('sawtooth', 1400, 260, 0.35, 0.07 * v);
        k.tone('sawtooth', 260, 1700, 0.75, 0.06 * v, 0.33);
        k.tone('square', 90, 140, 1.05, 0.03 * v);
        k.noise(1.05, 0.1 * v, 2400, 6000, 2);
      });
      break;
    case 'play':
      // The PLAY button clunks down and the world snaps back.
      sfx.play('tm-play', 0.3, 'sfx', (k) => {
        k.noise(0.05, 0.25 * v, 900, 400, 1);
        k.tone('square', 220, 220, 0.05, 0.08 * v);
        k.tone('sine', 330, 660, 0.18, 0.1 * v, 0.06);
      });
      break;
    case 'stand':
      // A heavy heartbeat and a low alarm.
      sfx.play('tm-stand', 0.5, 'sfx', (k) => {
        k.tone('sine', 70, 45, 0.18, 0.4 * v);
        k.tone('sine', 70, 45, 0.18, 0.32 * v, 0.24);
        k.tone('sawtooth', 220, 110, 0.6, 0.08 * v, 0.1);
        k.tone('square', 440, 440, 0.12, 0.05 * v, 0.55);
        k.tone('square', 440, 440, 0.12, 0.05 * v, 0.75);
      });
      break;
    case 'standWin':
      sfx.play('tm-standWin', 0.5, 'sfx', (k) => {
        [523, 659, 784, 1047].forEach((f, i) => k.tone('triangle', f, f, 0.22, 0.12 * v, i * 0.07));
        k.noise(0.4, 0.08 * v, 2000, 7000, 1, 0.2);
      });
      break;
    case 'standFail':
      sfx.play('tm-standFail', 0.5, 'sfx', (k) => {
        k.tone('sawtooth', 300, 60, 0.7, 0.12 * v);
        k.tone('square', 150, 40, 0.7, 0.05 * v, 0.05);
      });
      break;
    case 'bulletTime':
      // Air sucked past the ears, then a low hum.
      sfx.play('tm-bt', 0.6, 'sfx', (k) => {
        k.noise(0.45, 0.22 * v, 5000, 300, 2);
        k.tone('sine', 900, 120, 0.5, 0.1 * v);
        k.tone('sine', 55, 55, 0.8, 0.12 * v, 0.1);
      });
      break;
    case 'clutch':
      sfx.play('tm-clutch', 0.8, 'sfx', (k) => {
        k.noise(0.08, 0.3 * v, 3000, 1200, 1);
        [392, 494, 587, 784].forEach((f, i) => k.tone('triangle', f, f, 0.5 - i * 0.05, 0.1 * v, 0.08 + i * 0.05));
      });
      break;
    case 'replay':
      // Tape slowing down.
      sfx.play('tm-replay', 0.6, 'sfx', (k) => {
        k.tone('sawtooth', 500, 70, 0.6, 0.08 * v);
        k.noise(0.6, 0.06 * v, 1500, 300, 1);
      });
      break;
    case 'deny':
      sfx.deny();
      break;
    case 'vote':
      sfx.play('tm-vote', 0.3, 'sfx', (k) => {
        k.tone('square', 660, 660, 0.08, 0.06 * v);
        k.tone('square', 880, 880, 0.1, 0.06 * v, 0.1);
      });
      break;
  }
}
