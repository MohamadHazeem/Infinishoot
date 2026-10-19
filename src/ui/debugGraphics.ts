import type GUI from 'lil-gui';
import { shatterTuning } from '../render/shatter';
import { reflectTuning } from '../render/reflections';
import { volumeFogTuning, fogForce } from '../render/volumeFog';
import { cineTuning } from '../game/cineCam';
import { animeTuning, gfxTuning } from '../game/systems/graphics';
import { settings, saveSettings } from '../game/settings';

/** Debug panel folder for the graphics lane: destruction, ANIME LOOK, water, fog and shafts, crowd framing. */
export function addGraphicsFolder(gui: GUI): void {
  const f = gui.addFolder('Destruction, anime, water & fog').close();
  const d = f.addFolder('Destruction physics').close();
  d.add(shatterTuning, 'gravity', 5, 60, 1).name('Gravity');
  d.add(shatterTuning, 'bounce', 0, 0.9, 0.01).name('Bounce');
  d.add(shatterTuning, 'slide', 0, 1, 0.01).name('Bounce slide kept');
  d.add(shatterTuning, 'friction', 0, 20, 0.5).name('Ground friction');
  d.add(shatterTuning, 'speed', 0, 15, 0.1).name('Launch speed');
  d.add(shatterTuning, 'up', 0, 15, 0.1).name('Launch up');
  d.add(shatterTuning, 'life', 0, 30, 0.5).name('Lie time (s)');
  d.add(shatterTuning, 'sink', 0.1, 4, 0.1).name('Sink time (s)');
  d.add(shatterTuning, 'pileMax', 0, 3, 0.05).name('Pile max (m)');
  const a = f.addFolder('Anime look').close();
  const s = { on: !!settings.animeLook };
  a.add(s, 'on')
    .name('ANIME LOOK')
    .onChange((v: boolean) => {
      settings.animeLook = v;
      saveSettings();
    });
  a.add(animeTuning, 'inkPx', 0.5, 4, 0.25).name('Ink width (px @270p)');
  a.add(animeTuning, 'inkThreshold', 0.005, 0.3, 0.005).name('Ink edge threshold');
  a.add(animeTuning, 'inkFade', 10, 200, 1).name('Ink fade distance (m)');
  a.add(animeTuning, 'outlineScale', 1, 4, 0.25).name('Hull outline x');
  a.add(animeTuning, 'celSteps', 0, 6, 1).name('Cel bands');
  a.add(animeTuning, 'celSoft', 0, 0.5, 0.01).name('Cel band softness');
  a.add(animeTuning, 'speed', 0, 1, 0.05).name('Speed lines');
  a.add(animeTuning, 'speedLinger', 0, 1, 0.02).name('Speed line linger (s)');
  a.add(animeTuning, 'impactFrames', 0, 4, 1).name('Impact frames');
  a.add(animeTuning, 'impactCooldown', 0, 5, 0.1).name('Impact cooldown (s)');
  a.add(animeTuning, 'critRatio', 1, 6, 0.1).name('Impact: crit x average');
  a.add(animeTuning, 'hitStop', 0.02, 0.3, 0.005).name('Impact: hit-stop from (s)');
  const w = f.addFolder('Water & puddles').close();
  w.add(reflectTuning, 'strength', 0, 3, 0.05).name('Light reflections');
  w.add(reflectTuning, 'size', 0.1, 2, 0.05).name('Glint size (m)');
  w.add(reflectTuning, 'stretch', 1, 8, 0.1).name('Glint stretch');
  w.add(reflectTuning, 'ripple', 0, 1, 0.01).name('Ripple (m)');
  w.add(reflectTuning, 'puddleDark', 0, 1, 0.01).name('Puddle darkness');
  w.add(reflectTuning, 'puddleSky', 0, 1, 0.01).name('Puddle sheen');
  const v = f.addFolder('Volumetric fog & shafts').close();
  const force = { on: false, amount: 0.8 };
  const apply = () => (fogForce.amount = force.on ? force.amount : null);
  v.add(force, 'on').name('Force fog').onChange(apply);
  v.add(force, 'amount', 0, 1, 0.01).name('Forced amount').onChange(apply);
  v.add(volumeFogTuning, 'density', 0, 0.6, 0.01).name('Density per layer');
  v.add(volumeFogTuning, 'scatter', 0, 2, 0.05).name('Light in the mist');
  v.add(volumeFogTuning, 'reach', 0.2, 3, 0.05).name('Light reach (x radius)');
  v.add(volumeFogTuning, 'drift', 0, 3, 0.05).name('Drift');
  v.add(gfxTuning, 'fogFrom', 0, 1, 0.01).name('Fog from night');
  v.add(gfxTuning, 'shaftStrength', 0, 3, 0.05).name('Light shafts');
  v.add(gfxTuning, 'shaftReach', 0.1, 1.5, 0.05).name('Shaft reach (screens)');
  const c = f.addFolder('Crowd framing').close();
  c.add(cineTuning, 'pitchDrop', 0, 20, 0.5).name('Pitch drop (deg)');
  c.add(cineTuning, 'closer', 0, 0.3, 0.01).name('Closer');
  c.add(cineTuning, 'calm', 0, 30, 1).name('Full tilt below (enemies)');
  c.add(cineTuning, 'busy', 1, 80, 1).name('No tilt from (enemies)');
  c.add(cineTuning, 'inRate', 0.05, 3, 0.05).name('Settle rate /s');
  c.add(cineTuning, 'outRate', 0.1, 6, 0.1).name('Pull-up rate /s');
}
