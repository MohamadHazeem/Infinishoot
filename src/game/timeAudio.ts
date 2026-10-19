import { sfx } from '../audio/sfx';
import { crowd } from '../audio/crowd';
import { radioEvents } from '../audio/radio';

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
      radioEvents.rewinds++;
      // A tape spooling back (sound lane): the transport clunks, the motor whines up, the sound of
      // the last seconds chatters past backwards at speed (chipmunk blips), hiss and wow over it.
      sfx.play('tm-rewind', 0.4, 'sfx', (k) => {
        k.noise(0.05, 0.25 * v, 900, 400, 1);
        k.tone('square', 180, 180, 0.04, 0.06 * v);
        k.swell('sawtooth', 220, 1900, 1.05, 0.06 * v, 0.6, 0.04);
        k.swell('square', 110, 950, 1.05, 0.02 * v, 0.6, 0.04);
        for (let i = 0; i < 14; i++) {
          const f = 900 + ((i * 1597) % 1700);
          k.tone('square', f * 1.3, f, 0.035, 0.035 * v, 0.1 + i * 0.065);
        }
        k.noise(1.05, 0.09 * v, 2400, 7000, 2, 0.04, 0.2);
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
      crowd.react('gasp', v);
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
      crowd.react('roar', v);
      if (v >= 1) radioEvents.standWins++; // full gain = this machine's hero
      sfx.play('tm-standWin', 0.5, 'sfx', (k) => {
        [523, 659, 784, 1047].forEach((f, i) => k.tone('triangle', f, f, 0.22, 0.12 * v, i * 0.07));
        k.noise(0.4, 0.08 * v, 2000, 7000, 1, 0.2);
      });
      break;
    case 'standFail':
      crowd.react('aww', v);
      sfx.play('tm-standFail', 0.5, 'sfx', (k) => {
        k.tone('sawtooth', 300, 60, 0.7, 0.12 * v);
        k.tone('square', 150, 40, 0.7, 0.05 * v, 0.05);
      });
      break;
    case 'bulletTime':
      crowd.react('gasp', 1); // the arena crowd gasps at the near miss
      radioEvents.closeCalls++; // only played for this machine's hero
      // Air sucked past the ears, then a low hum.
      sfx.play('tm-bt', 0.6, 'sfx', (k) => {
        k.noise(0.45, 0.22 * v, 5000, 300, 2);
        k.tone('sine', 900, 120, 0.5, 0.1 * v);
        k.tone('sine', 55, 55, 0.8, 0.12 * v, 0.1);
      });
      break;
    case 'clutch':
      crowd.react('cheer', 1, true);
      sfx.play('tm-clutch', 0.8, 'sfx', (k) => {
        k.noise(0.08, 0.3 * v, 3000, 1200, 1);
        [392, 494, 587, 784].forEach((f, i) => k.tone('triangle', f, f, 0.5 - i * 0.05, 0.1 * v, 0.08 + i * 0.05));
      });
      break;
    case 'replay':
      // Slow motion (sound lane): a reverse-cymbal swell sucks in, then everything drops into a deep,
      // dragged-out whoosh and the tape slurs down.
      sfx.play('tm-replay', 0.6, 'sfx', (k) => {
        k.noise(0.7, 0.14 * v, 2500, 9000, 1.2, 0, 0.65);
        k.noise(1.8, 0.2 * v, 1400, 140, 0.8, 0.65, 0.3);
        k.swell('sine', 90, 38, 1.8, 0.2 * v, 0.4, 0.65);
        k.tone('sawtooth', 500, 60, 0.9, 0.07 * v, 0.6);
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
