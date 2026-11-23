// Four bars of call and response. The same motif accelerates as each phase opens.
import type { Theme } from '../audio/music/composition';

export const maestroTempos = [108, 126, 144] as const;
export const maestroTheme: Theme = {
  chords: [0, 3, 4, 0],
  notes: [
    [0, 0, 3], [4, 2, 2], [8, 4, 3], [12, 7, 3],
    [16, 5, 4], [22, 4, 2], [24, 3, 4], [30, 2, 2],
    [32, 1, 3], [36, 3, 2], [40, 5, 3], [44, 8, 3],
    [48, 7, 4], [54, 4, 2], [56, 2, 2], [60, 0, 4],
  ],
};
