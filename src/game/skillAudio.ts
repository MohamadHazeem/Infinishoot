import { sfx } from '../audio/sfx';
import { samples } from '../audio/samples';
import { announcer } from '../audio/announcer';

/**
 * Sounds for the skill layer: the recorded perfect-dash and parry cues through
 * the shared sample engine (voice budget, buses, mixing) and announcer lines
 * through the announcer (priorities, cooldowns, the ANNOUNCER setting), with
 * synth fallbacks until the samples have loaded. Played locally on every
 * machine from skill events (src/game/systems/skill.ts), never recorded.
 */
export type SkillCue = 'perfect' | 'parry' | 'ult' | 'rankA' | 'rankS';

const FILES: Record<SkillCue, { sfx?: string; voice?: string }> = {
  perfect: { sfx: 'perfect_dash', voice: 'perfect' },
  parry: { sfx: 'parry', voice: 'parry' },
  ult: { voice: 'ultimate' },
  rankA: { voice: 'rank_a' },
  rankS: { voice: 'rank_s' },
};

/** Kept for callers: the shared sample engine loads everything in the background. */
export function preloadSkillAudio(): void {}

/**
 * Play a skill cue. `mine` = it happened to this machine's hero (announcer
 * lines only play for your own moves); `gain` fades other players' cues.
 */
export function skillSound(cue: SkillCue, mine: boolean, gain = 1): void {
  if (gain <= 0.02) return;
  const f = FILES[cue];
  const played = f.sfx ? !!samples.play(f.sfx, { gain: 0.9 * gain, priority: 4, limit: 2 }) : false;
  if (!played) {
    // Synth fallbacks from the existing sound set.
    if (cue === 'perfect') sfx.powerUp();
    else if (cue === 'parry') sfx.shieldBreak();
    else if (cue === 'ult') sfx.legendary();
  }
  if (mine && f.voice) announcer.say(f.voice);
}
