/**
 * Accessibility hub between audio and UI: captions for the announcer and hero
 * voice lines, and positions of threat telegraphs for the edge arrows. Audio
 * code emits; src/ui/audioA11y.ts draws. Both switches live in settings
 * (CAPTIONS, SOUND ARROWS).
 */
export const a11yAudio = { captions: false, arrows: false };

export interface Caption {
  who: string;
  text: string;
  color: string;
  kind: 'announcer' | 'voice';
}

/** Announcer recordings' lines (scripts/audio/sounds.mjs). */
export const ANNOUNCER_LINES: Readonly<Record<string, string>> = {
  mvp: 'M V P!',
  combo: 'Combo!',
  great: 'Great!',
  awesome: 'Awesome!',
  unstoppable: 'Unstoppable!',
  boss: 'Warning! Boss approaching!',
  elite: 'Elite!',
  legendary: 'Legendary!',
  level_up: 'Level up!',
  evolution: 'Evolution!',
  stage_clear: 'Stage clear!',
  perfect: 'Perfect!',
  parry: 'Parry!',
  rank_s: 'S rank!',
  rank_a: 'A rank!',
  ultimate: 'Ultimate!',
  game_over: 'Game over.',
  gauntlet: 'Gauntlet mode!',
  ascension: 'Ascension!',
  go: 'Ready... Go!',
  overdrive: 'Overdrive!',
};

type CaptionSink = (c: Caption) => void;
type ThreatSink = (cue: string, x: number, z: number) => void;
let captionSink: CaptionSink | null = null;
let threatSink: ThreatSink | null = null;

export function setCaptionSink(s: CaptionSink | null): void {
  captionSink = s;
}
export function setThreatSink(s: ThreatSink | null): void {
  threatSink = s;
}

/** Show a caption (if CAPTIONS is on and a UI is listening). */
export function caption(c: Caption): void {
  if (a11yAudio.captions) captionSink?.(c);
}

/** A threat telegraph played at world (x, z); the UI decides whether it's off-screen. */
export function threatAt(cue: string, x: number, z: number): void {
  if (a11yAudio.arrows && Number.isFinite(x) && Number.isFinite(z)) threatSink?.(cue, x, z);
}
