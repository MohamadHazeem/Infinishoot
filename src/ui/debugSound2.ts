import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { sfx } from '../audio/sfx';
import { crowd, crowdSettings, crowdTuning, CROWD_REACTIONS, type CrowdReaction } from '../audio/crowd';
import { radio, radioScript, radioSettings, radioTuning } from '../audio/radio';
import { playSurround, surroundTuning, SURROUND_IDS, type SurroundId } from '../audio/surround';
import { duelTuning, tensionTuning } from '../audio/musicDuel';
import { INSTRUMENT_IDS, instrumentTuning, type InstrumentId } from '../audio/instruments';
import { LANE_CUES } from '../audio/featureCues';
import { hearingTuning } from '../audio/loudness';
import { music } from '../audio/music';
import { crowdTriggerTuning, instrumentDropTuning, soundLane, soundLaneForce } from '../game/systems/sound2';

/** Debug panel: sound lane, wave 2 (duel music, crowd, radio DJ, instruments, ears, surround, feature cues). */
export function addSound2Folder(gui: GUI, game: Game): void {
  const f = gui.addFolder('Sound 2: duel, crowd, radio, band').close();
  const a = {
    reaction: 'cheer' as CrowdReaction,
    react: () => crowd.react(a.reaction, 1, true),
    dj: () => radio.start(radioScript(soundLane(game).hl)),
    surround: 'boss' as SurroundId,
    sweep: () => playSurround(a.surround, true),
    cue: Object.keys(LANE_CUES)[0],
    playCue: () => sfx.named('s2:' + a.cue),
    instrument: 'cowbell' as InstrumentId,
    spawn: () => (soundLaneForce.instrument = a.instrument),
    giveAll: () => (soundLane(game).band = (1 << INSTRUMENT_IDS.length) - 1),
    clearBand: () => (soundLane(game).band = 0),
  };
  const d = f.addFolder('Boss duel and comeback music');
  d.add(soundLaneForce, 'duel').name('Force duel music');
  d.add(soundLaneForce, 'tension').name('Force comeback music');
  d.add(duelTuning, 'bars', 1, 4, 1).name('Bars per phrase');
  d.add(duelTuning, 'heroStems', 0.5, 4, 0.1).name('Your stems (your phrase)');
  d.add(duelTuning, 'bossStems', 0, 1, 0.05).name('Your stems (boss phrase)');
  d.add(duelTuning, 'answerVol', 0, 1, 0.05).name('Answer volume');
  d.add(duelTuning, 'perKill', 0, 1, 0.05).name('Accent per kill');
  d.add(duelTuning, 'perHp', 0, 2, 0.05).name('Accent per 1% boss life');
  d.add(tensionTuning, 'cutoff', 300, 6000, 50).name('Comeback low-pass (Hz)');
  d.add({ get turn() { return music.duelTurn ?? '-'; } }, 'turn').name('Duel turn').listen().disable();
  const c = f.addFolder('Crowd');
  c.add(crowdSettings, 'enabled').name('Crowd');
  c.add(crowdTuning, 'gain', 0, 2, 0.05).name('Crowd gain');
  c.add(crowdTuning, 'bedMin', 0, 0.1, 0.002).name('Bed min');
  c.add(crowdTuning, 'bedMax', 0, 0.2, 0.002).name('Bed max');
  c.add(crowdTuning, 'speechDuck', 0, 1, 0.05).name('Under voices');
  c.add(crowdTuning, 'voices', 2, 12, 1).name('Voices per reaction');
  c.add(crowdTriggerTuning, 'booHit', 0.05, 0.5, 0.01).name('Boo at hit (life share)');
  c.add(crowdTriggerTuning, 'killBurst', 5, 80, 1).name('Cheer at kills / s');
  c.add(a, 'reaction', [...CROWD_REACTIONS]).name('Reaction');
  c.add(a, 'react').name('Play reaction');
  c.add(crowd, 'excitement').name('Excitement').listen().disable();
  const r = f.addFolder('Radio DJ');
  r.add(radioSettings, 'enabled').name('Radio DJ');
  r.add(radioTuning, 'gain', 0, 2, 0.05).name('DJ gain');
  r.add(radioTuning, 'f0', 80, 320, 5).name('DJ pitch (Hz)');
  r.add(radioTuning, 'syl', 0.04, 0.14, 0.005).name('Syllable (s)');
  r.add(radioTuning, 'lines', 1, 4, 1).name('Highlight lines');
  r.add(radioTuning, 'delay', 0, 6, 0.1).name('Delay after clear (s)');
  r.add(radioTuning, 'hiss', 0, 0.06, 0.002).name('Static');
  r.add(a, 'dj').name('DJ: this stage now');
  const s = f.addFolder('Surround stingers');
  s.add(surroundTuning, 'gain', 0, 2, 0.05).name('Stinger gain');
  s.add(surroundTuning, 'rearCutoff', 500, 8000, 100).name('Behind low-pass (Hz)');
  s.add(a, 'surround', [...SURROUND_IDS]).name('Stinger');
  s.add(a, 'sweep').name('Play stinger');
  const b = f.addFolder('Instruments');
  b.add(instrumentDropTuning, 'enabled').name('Pickups');
  b.add(instrumentDropTuning, 'chance', 0, 1, 0.05).name('Chance per stage');
  b.add(instrumentTuning, 'gain', 0, 3, 0.05).name('Band gain');
  b.add(a, 'instrument', [...INSTRUMENT_IDS]).name('Instrument');
  b.add(a, 'spawn').name('Spawn it near you');
  b.add(a, 'giveAll').name('Whole band');
  b.add(a, 'clearBand').name('No band');
  const h = f.addFolder('Sound-reactive enemies');
  h.add(hearingTuning, 'enabled').name('Ears');
  h.add(hearingTuning, 'range', 5, 50, 1).name('Hearing range (m)');
  h.add(hearingTuning, 'attract', 0.2, 3, 0.05).name('Attract at');
  h.add(hearingTuning, 'calm', 0, 1, 0.05).name('Calm below');
  h.add(hearingTuning, 'sight', 0, 15, 0.5).name('Sight (m)');
  h.add(hearingTuning, 'rushSpeed', 0.5, 2, 0.05).name('Rush speed');
  h.add(hearingTuning, 'calmSpeed', 0, 1, 0.05).name('Calm speed');
  h.add(hearingTuning, 'decay', 0.2, 4, 0.1).name('Noise decay (s)');
  const q = f.addFolder('Feature cues');
  q.add(a, 'cue', Object.keys(LANE_CUES)).name('Cue');
  q.add(a, 'playCue').name('Play cue');
}
