/**
 * The UI sound kit: one consistent palette for every menu. All cues are short
 * square/triangle blips on the C major pentatonic (C D E G A) with the same
 * envelope family; moving and ticking stay quiet, committing sounds brighter,
 * going back mirrors confirming downwards. Wired once in MenuNav (src/ui/menu.ts)
 * and the shared sfx menu methods, not per screen.
 */
import type { SynthKit } from './sfx';

export type UiCue = 'move' | 'hover' | 'confirm' | 'back' | 'toggle' | 'tick' | 'tab' | 'flip' | 'error' | 'purchase';
export const UI_CUES: readonly UiCue[] = ['move', 'hover', 'confirm', 'back', 'toggle', 'tick', 'tab', 'flip', 'error', 'purchase'];

export const uiKitTuning = { gain: 1 };

/** Pentatonic notes (Hz), C5 up: the whole kit picks from these. */
export const UI_NOTES = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760, 2093];

/** Slider tick pitch for a 0..1 position: steps up the pentatonic. */
export function tickNote(value: number): number {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return UI_NOTES[Math.round(v * (UI_NOTES.length - 1))];
}

export function playUi(k: SynthKit, cue: UiCue, value: number): void {
  const g = uiKitTuning.gain;
  if (g <= 0) return;
  const N = UI_NOTES;
  switch (cue) {
    case 'move':
      k.tone('square', N[5], N[5], 0.03, 0.045 * g);
      break;
    case 'hover':
      k.tone('triangle', N[7], N[7], 0.035, 0.06 * g);
      k.tone('triangle', N[8], N[8], 0.04, 0.04 * g, 0.03);
      break;
    case 'confirm':
      k.tone('square', N[3], N[3], 0.05, 0.08 * g);
      k.tone('square', N[6], N[6], 0.09, 0.08 * g, 0.05);
      break;
    case 'back':
      k.tone('square', N[6], N[6], 0.05, 0.07 * g);
      k.tone('square', N[3], N[3], 0.08, 0.07 * g, 0.05);
      break;
    case 'toggle':
      // On climbs, off drops.
      if (value > 0) {
        k.tone('square', N[4], N[4], 0.035, 0.07 * g);
        k.tone('square', N[7], N[7], 0.06, 0.07 * g, 0.035);
      } else {
        k.tone('square', N[7], N[7], 0.035, 0.06 * g);
        k.tone('square', N[4], N[4], 0.06, 0.06 * g, 0.035);
      }
      break;
    case 'tick': {
      const f = tickNote(value);
      k.tone('square', f, f, 0.022, 0.05 * g);
      break;
    }
    case 'tab':
      k.noise(0.02, 0.12 * g, 3000, 2000, 2);
      k.tone('triangle', N[2], N[2], 0.04, 0.07 * g);
      k.tone('triangle', N[4], N[4], 0.05, 0.06 * g, 0.035);
      break;
    case 'flip':
      // A card swish then a soft snap, rising like the reroll it marks.
      for (let i = 0; i < 3; i++) k.noise(0.04, 0.2 * g, 1600 + i * 700, 3800, 2, i * 0.04);
      k.tone('square', N[1], N[5], 0.16, 0.05 * g, 0.04);
      break;
    case 'error':
      k.tone('square', 196, 185, 0.08, 0.1 * g);
      k.tone('square', 175, 165, 0.12, 0.1 * g, 0.09);
      break;
    case 'purchase':
      // Register ka-ching: a click, a blip and a ringing pair.
      k.noise(0.04, 0.25 * g, 3500);
      k.tone('square', N[7], N[7], 0.06, 0.09 * g, 0.04);
      k.tone('triangle', N[9], N[9], 0.35, 0.12 * g, 0.1);
      k.tone('triangle', 2637, 2637, 0.3, 0.05 * g, 0.12);
      break;
  }
}
