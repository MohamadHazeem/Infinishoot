import { samples } from '../../audio/samples';
import { sfx, audioSettings } from '../../audio/sfx';
import { voiceChannel } from '../../audio/voices';

/** Recorded narration uses the real VOICE bus, so all mixer/mute settings apply. */
export class StoryNarrator {
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private id = '';
  private played = false;
  private claimed = false;
  duration = 0;
  cue(id: string): void {
    this.stop();
    this.id = id;
    this.played = false;
    this.duration = 0;
    if (id) samples.buffer(id);
  }
  tick(): void {
    if (!this.id || this.played) return;
    const buffer = samples.buffer(this.id),
      out = sfx.output('voice');
    if (
      !buffer ||
      !out ||
      audioSettings.muted ||
      audioSettings.voice <= 0 ||
      audioSettings.volume <= 0
    )
      return;
    const now = performance.now() / 1000;
    if (!voiceChannel.canStart(20, now)) return;
    const source = out.ctx.createBufferSource(),
      gain = out.ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = 0.9;
    source.connect(gain).connect(out.node);
    this.source = source;
    this.gain = gain;
    this.played = true;
    this.duration = buffer.duration;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (this.source === source) this.source = null;
    };
    voiceChannel.claim(20, now, buffer.duration, () => this.stop());
    this.claimed = true;
    source.start();
  }
  stop(): void {
    if (this.claimed && voiceChannel.current === 20)
      voiceChannel.claim(20, performance.now() / 1000, 0, () => {});
    this.claimed = false;
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    this.gain?.disconnect();
    this.gain = null;
    this.id = '';
  }
}
