import { samples, type SampleVoice } from './samples';
import { ANNOUNCER_LINES, caption } from './captions';

export const announcerSettings = { enabled: true };
/**
 * Shared voice channel (src/audio/voices.ts installs it): boss lines, hero barks and
 * the announcer never talk over each other. `blocks` may keep `retry` to say it later.
 */
export const voiceGate = {
  blocks: (_priority: number, _retry?: () => boolean): boolean => false,
  claim: (_priority: number, _seconds: number, _stop: () => void): void => {},
};
const priorities: Readonly<Record<string, number>> = {
  game_over: 10,
  boss: 9,
  stage_clear: 8,
  evolution: 7,
  legendary: 7,
  go: 6,
  ultimate: 6,
  overdrive: 6,
  rank_s: 6,
  rank_a: 5,
  parry: 4,
  perfect: 4,
  elite: 3,
  unstoppable: 3,
  awesome: 2,
  great: 2,
  combo: 1,
  level_up: 1,
};
export function announcementCooldown(id: string): number {
  return id === 'level_up'
    ? 45
    : id === 'elite'
      ? 18
      : /great|awesome|unstoppable|combo/.test(id)
        ? 30
        : 8;
}
class Announcer {
  private last = new Map<string, number>();
  private next = 0;
  private active: SampleVoice | null = null;
  private activeUntil = 0;
  private priority = 0;
  private clock = () => 0;
  private duck = (_seconds: number) => {};
  /** Called when a line starts playing (the announcer's portrait pops in). */
  onSay: ((id: string, seconds: number) => void) | null = null;
  configure(clock: () => number, duck: (seconds: number) => void): void {
    this.clock = clock;
    this.duck = duck;
  }
  /** Accepts either 'parry' or 'vo_parry'. No backlog of stale battle commentary. */
  say(id: string): boolean {
    id = id.replace(/^vo_/, '');
    const priority = priorities[id];
    if (!announcerSettings.enabled || priority === undefined) return false;
    const now = this.clock();
    if (now - (this.last.get(id) ?? -Infinity) < announcementCooldown(id)) return false;
    if (now < this.next && priority <= this.priority) return false;
    if (now < this.activeUntil && priority <= this.priority) return false;
    // Check availability before interrupting the line already playing.
    if (!samples.buffer('vo_' + id)) return false;
    if (voiceGate.blocks(10 + priority, priority >= 5 ? () => this.say(id) : undefined)) return false; // big lines wait their turn
    const voice = samples.play('vo_' + id, {
      bus: 'ui',
      priority: 10 + priority,
      gain: 0.85,
      variation: 0,
      limit: 1,
    });
    // Muted or silent buses still caption the line (CAPTIONS is for people who can't hear it).
    const silent = !voice && !samples.canPlay('ui');
    if (!voice && !silent) return false;
    this.active?.stop();
    this.active = voice;
    this.priority = priority;
    const duration = voice?.duration ?? 1.2;
    this.activeUntil = now + duration;
    this.next = this.activeUntil + 2.5;
    this.last.set(id, now);
    if (voice) {
      voiceGate.claim(10 + priority, duration, () => voice.stop());
      this.duck(duration);
    }
    this.onSay?.(id, duration);
    const line = ANNOUNCER_LINES[id];
    if (line) caption({ who: 'ANNOUNCER', text: line, color: '#ffcd75', kind: 'announcer' });
    return true;
  }
  reset(): void {
    if (this.activeUntil > this.clock()) this.duck(0);
    this.active?.stop();
    this.active = null;
    this.activeUntil = this.next = 0;
    this.priority = 0;
    this.last.clear();
  }
  update(): void {
    if (!announcerSettings.enabled) this.reset();
  }
}
export const announcer = new Announcer();
