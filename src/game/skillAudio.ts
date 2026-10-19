import { sfx } from '../audio/sfx';

/**
 * Sounds for the skill layer: the recorded perfect-dash and parry cues and
 * announcer lines (public/audio, loaded on first use into the effects bus so
 * the volume sliders apply), with synth fallbacks until they have loaded or
 * when they can't (offline file:// builds, no audio). Played locally on every
 * machine from skill events (src/game/systems/skill.ts), never recorded.
 */
export type SkillCue = 'perfect' | 'parry' | 'ult' | 'rankA' | 'rankS';

const FILES: Record<SkillCue, { sfx?: string; voice?: string }> = {
  perfect: { sfx: 'perfect_dash', voice: 'vo_perfect' },
  parry: { sfx: 'parry', voice: 'vo_parry' },
  ult: { voice: 'vo_ultimate' },
  rankA: { voice: 'vo_rank_a' },
  rankS: { voice: 'vo_rank_s' },
};

const buffers = new Map<string, AudioBuffer | null>();
const lastVoice = new Map<string, number>();
/** A voice line repeats at most this often (s). */
const VOICE_GAP = 6;

function load(name: string): AudioBuffer | null {
  if (buffers.has(name)) return buffers.get(name) ?? null;
  buffers.set(name, null);
  const out = sfx.output('sfx');
  if (!out || typeof fetch !== 'function') {
    buffers.delete(name); // try again once audio is unlocked
    return null;
  }
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? './';
  void fetch(`${base}audio/${name}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((data) => out.ctx.decodeAudioData(data))
    .then((buf) => buffers.set(name, buf))
    .catch(() => buffers.set(name, null));
  return null;
}

function play(name: string, gain: number): boolean {
  const buf = load(name);
  const out = sfx.output('sfx');
  if (!buf || !out) return false;
  const src = out.ctx.createBufferSource();
  src.buffer = buf;
  const g = out.ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(out.node);
  src.start();
  return true;
}

/** Start loading the cues (call when a run starts, after audio is unlocked). */
export function preloadSkillAudio(): void {
  for (const f of Object.values(FILES)) {
    if (f.sfx) load(f.sfx);
    if (f.voice) load(f.voice);
  }
}

/**
 * Play a skill cue. `mine` = it happened to this machine's hero (announcer
 * lines only play for your own moves); `gain` fades other players' cues.
 */
export function skillSound(cue: SkillCue, mine: boolean, gain = 1): void {
  if (gain <= 0.02) return;
  const f = FILES[cue];
  let played = false;
  if (f.sfx) played = play(f.sfx, 0.9 * gain);
  if (!played) {
    // Synth fallbacks from the existing sound set.
    if (cue === 'perfect') sfx.powerUp();
    else if (cue === 'parry') sfx.shieldBreak();
    else if (cue === 'ult') sfx.legendary();
  }
  if (mine && f.voice) {
    const now = performance.now() / 1000;
    if (now - (lastVoice.get(f.voice) ?? -99) >= VOICE_GAP && play(f.voice, 0.8)) lastVoice.set(f.voice, now);
  }
}
