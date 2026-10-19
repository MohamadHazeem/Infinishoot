import type GUI from 'lil-gui';
import { heroMarkerTuning } from '../render/rigOverlay';
import { outlineTuning } from '../render/outlines';
import { retroGlobals } from '../render/retroMaterial';
import { crowdTuning } from '../game/crowd';
import { scarTuning } from '../game/scars';

/** Debug panel folder for the readability lane: hero marker, crowd spacing, night rim, scars. */
export function addReadabilityFolder(gui: GUI): void {
  const f = gui.addFolder('Readability').close();
  const h = f.addFolder('Hero marker');
  h.add(heroMarkerTuning, 'xray').name('X-ray through enemies');
  h.add(heroMarkerTuning, 'xrayRimPx', 0, 4, 0.5).name('X-ray rim px');
  h.add(heroMarkerTuning, 'xrayLight', 0, 1, 0.05).name('X-ray light tone');
  h.add(heroMarkerTuning, 'xrayDark', 0, 1, 0.05).name('X-ray dark tone');
  h.add(heroMarkerTuning, 'xrayBias', 0, 1, 0.05).name('X-ray depth bias (m)');
  h.add(heroMarkerTuning, 'ring').name('Ground ring');
  h.add(heroMarkerTuning, 'ringRadius', 0.5, 2, 0.05).name('Ring radius (m)');
  h.add(heroMarkerTuning, 'ringUnlit', 0, 1, 0.05).name('Ring unlit');
  h.addColor(heroMarkerTuning, 'soloColor').name('Solo colour');
  const c = f.addFolder('Crowd spacing');
  c.add(crowdTuning, 'push', 0, 30, 0.5).name('Separation (m/s)');
  c.add(crowdTuning, 'jam', 0, 6, 0.1).name('Jam slow-down');
  c.add(crowdTuning, 'hardGap', 0, 1, 0.02).name('Hard overlap limit');
  c.add(crowdTuning, 'hardFix', 0, 1, 0.05).name('Hard fix per step');
  c.add(crowdTuning, 'heroGap', 0, 1, 0.02).name('Hero personal space');
  const n = f.addFolder('Night');
  n.add(retroGlobals.uNightRim, 'value', 0, 2, 0.05).name('Enemy rim');
  n.add(retroGlobals.uNightLift, 'value', 0, 1, 0.05).name('Enemy colour floor');
  n.add(outlineTuning, 'night', 0, 1, 0.05).name('Outline lift');
  const s = f.addFolder('Scars');
  s.add(scarTuning, 'scorchLife', 0.1, 2, 0.05).name('Scorch life x');
  s.add(scarTuning, 'scorchAlpha', 0, 1, 0.05).name('Scorch opacity');
  s.add(scarTuning, 'craterLife', 0.1, 2, 0.05).name('Crater life x');
  s.add(scarTuning, 'craterAlpha', 0, 1, 0.05).name('Crater opacity');
  s.add(scarTuning, 'otherLife', 0.1, 2, 0.05).name('Frost/goo life x');
  s.add(scarTuning, 'otherAlpha', 0, 1, 0.05).name('Frost/goo opacity');
  s.add(scarTuning, 'fade', 0.05, 1, 0.05).name('Fade share');
}
