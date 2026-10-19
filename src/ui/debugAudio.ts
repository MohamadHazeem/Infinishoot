import type GUI from 'lil-gui';
import type { Game } from '../game/game';
import { sfx, audioSettings } from '../audio/sfx';
import { evoTuning, EVO_LAYERS } from '../audio/evoLayers';
import { familyTuning, FAMILIES, type Family } from '../audio/families';
import { threatTuning } from '../audio/threats';
import { voiceTuning, BARK_KINDS, type BarkKind } from '../audio/voice';
import { heroVoice, voiceSettings } from '../audio/heroVoice';
import { uiKitTuning, UI_CUES, type UiCue } from '../audio/uiKit';
import { styleLayerTuning, music } from '../audio/music';
import { a11yAudio, caption } from '../audio/captions';

/** Debug panel: sound lane knobs (evolution layers, telegraphs, voice, calls, UI kit, style layer) plus auditions. */
export function addAudioFolder(gui: GUI, game: Game): void {
  const f = gui.addFolder('Sound lane').close();
  f.add(evoTuning, 'gain', 0, 2, 0.05).name('Evo layer gain');
  f.add(threatTuning, 'gain', 0, 2, 0.05).name('Threat band gain');
  f.add(threatTuning, 'minGain', 0, 1, 0.05).name('Threat min distance gain');
  f.add(threatTuning, 'arrowTime', 0.3, 4, 0.1).name('Arrow time (s)');
  f.add(threatTuning, 'reaperRange', 10, 80, 1).name('Reaper toll range');
  f.add(familyTuning, 'perFamily', 0.2, 5, 0.1).name('Call gap / family');
  f.add(familyTuning, 'global', 0, 2, 0.05).name('Call gap / any');
  f.add(familyTuning, 'spawnChance', 0, 1, 0.05).name('Spawn call chance');
  f.add(familyTuning, 'gain', 0, 2, 0.05).name('Call gain');
  f.add(voiceSettings, 'enabled').name('Hero voice');
  f.add(audioSettings, 'voice', 0, 1, 0.05).name('Voice volume');
  f.add(voiceTuning, 'gain', 0, 2, 0.05).name('Voice gain');
  f.add(voiceTuning, 'speed', 0.5, 2, 0.05).name('Voice syllable length');
  f.add(voiceTuning, 'gap', 0, 2, 0.05).name('Voice gap');
  f.add(uiKitTuning, 'gain', 0, 2, 0.05).name('UI kit gain');
  f.add(styleLayerTuning, 'gain', 0, 2, 0.05).name('Style layer gain');
  f.add(a11yAudio, 'captions').name('Captions');
  f.add(a11yAudio, 'arrows').name('Sound arrows');
  const audition = {
    evo: Object.keys(EVO_LAYERS)[0],
    bark: 'levelUp' as BarkKind,
    family: 'robot' as Family,
    ui: 'confirm' as UiCue,
    playEvo: () => sfx.evoLayer(audition.evo),
    playBark: () => {
      const h = game.hero;
      heroVoice.reset();
      heroVoice.bark(audition.bark, { heroId: h.heroDef.id, index: h.index, name: h.heroDef.name, color: h.color }, { force: true });
    },
    playCall: () => sfx.call(audition.family),
    playUi: () => sfx.ui(audition.ui, 1),
    threats: () => ['threatSniper', 'threatMortar', 'chargerWindup', 'threatLeap', 'threatElite', 'threatReaper'].forEach((n, i) => setTimeout(() => sfx.named(n), i * 900)),
    testCaption: () => caption({ who: 'ANNOUNCER', text: 'Warning! Boss approaching!', color: '#ffcd75', kind: 'announcer' }),
  };
  f.add(audition, 'evo', Object.keys(EVO_LAYERS)).name('Evo layer');
  f.add(audition, 'playEvo').name('Play evo layer');
  f.add(audition, 'bark', [...BARK_KINDS]).name('Bark');
  f.add(audition, 'playBark').name('Play bark');
  f.add(audition, 'family', [...FAMILIES]).name('Family');
  f.add(audition, 'playCall').name('Play call');
  f.add(audition, 'ui', [...UI_CUES]).name('UI cue');
  f.add(audition, 'playUi').name('Play UI cue');
  f.add(audition, 'threats').name('Play all telegraphs');
  f.add(audition, 'testCaption').name('Test caption');
  f.add(music, 'style').name('Music style rank').listen().disable();
}
