import { sayLine, voiceSettings, voiceTuning } from './voices';

export const BANTER_KINDS = ['nicesave', 'behind', 'thanks', 'groupup', 'onmyway', 'greatshot'] as const;
export type BanterKind = (typeof BANTER_KINDS)[number];
const HEROES = new Set(['rookie', 'bulwark', 'dash', 'ace', 'duelist', 'furnace', 'twin', 'ronin', 'tinker']);
export const PING_BANTER: Readonly<Record<string, BanterKind>> = { go: 'groupup', danger: 'behind', omw: 'onmyway', nice: 'greatshot' };
/** Encoded on the existing effects bus, with the emitting hero's coordinates. */
export function banterSample(cue: string): string | null {
  const [, hero, line] = cue.split(':');
  return HEROES.has(hero) && (BANTER_KINDS as readonly string[]).includes(line) ? `banter_${hero}_${line}` : null;
}
export function playBanter(cue: string, x: number, z: number, pan: number, distance: number): void {
  if (!voiceSettings.heroVoices) return;
  const id = banterSample(cue);
  if (id) sayLine(id, 5, voiceTuning.barkGain * distance, 1, 0, 0.8, { x, z, pan });
}
