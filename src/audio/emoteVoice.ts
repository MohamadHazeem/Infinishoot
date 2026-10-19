/**
 * Emote voice lines (coop2 lane): heroes with recorded barks say their closest
 * recorded line (src/audio/voices.ts); the others speak with the synthesized
 * voice (src/audio/heroVoice.ts). Captions show the emote's own words for the
 * synthesized voice (recorded lines caption themselves). Local to each machine;
 * the host only sends which emote played (snapshot `co.e`).
 */
import { RECORDED_VOICES, VOICE_PRIORITY, barkSample, sayLine, voiceSettings, voiceTuning } from './voices';
import { heroVoice, type Speaker } from './heroVoice';
import { caption } from './captions';
import type { EmoteDef } from '../game/coop2';

export function playEmoteVoice(e: EmoteDef, sp: Speaker, mine: boolean, pan: number, gain: number): void {
  if (RECORDED_VOICES.has(sp.heroId)) {
    if (!voiceSettings.heroVoices) return;
    // Emotes are chosen, so they outrank the automatic barks but not the announcer or bosses.
    sayLine(barkSample(sp.heroId, e.rec), VOICE_PRIORITY.bark.revive, voiceTuning.barkGain * gain, mine ? voiceTuning.barkDuck : 1, 0, 1);
    return;
  }
  const u = heroVoice.bark(e.synth, sp, { pan, gain, caption: false, force: true });
  if (u) caption({ who: sp.name.toUpperCase(), text: e.say.charAt(0) + e.say.slice(1).toLowerCase(), color: sp.color, kind: 'voice' });
}
