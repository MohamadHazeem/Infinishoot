import type GUI from 'lil-gui';
import { lightTuning, lightUniforms } from '../render/lights';
import { outlineTuning } from '../render/outlines';
import { postfxTuning } from '../render/postfx';
import { governorTuning, QUALITY_LEVELS, renderQuality } from '../render/quality';
import { nightTuning, refreshLook } from '../render/biomeLook';
import { lookOverrides, lookTuning } from '../game/systems/look';
import { applyQualityLevel } from '../game/settings';

/** Debug panel folder for the look pass (lights, night, outlines, post, auto quality). */
export function addLookFolder(gui: GUI): void {
  const f = gui.addFolder('Lights & post').close();
  const night = { mode: 'stage' };
  f.add(night, 'mode', ['stage', 'night', 'day'])
    .name('Night')
    .onChange((v: string) => {
      lookOverrides.night = v === 'stage' ? null : v === 'night';
    });
  f.add(nightTuning, 'every', 0, 6, 1).name('Night every N stages').onChange(refreshLook);
  f.add(nightTuning, 'biomeTint', 0, 1, 0.01).name('Night biome tint').onChange(refreshLook);
  f.add(lookTuning, 'lanternRadius', 2, 20, 0.5);
  f.add(lookTuning, 'lanternIntensity', 0, 2, 0.05);
  f.add(lookTuning, 'bulletIntensity', 0, 2, 0.05);
  f.add(lookTuning, 'lavaIntensity', 0, 2, 0.05);
  f.add(lookTuning, 'ringMin', 0, 6, 0.1).name('Flash min ring (m)');
  f.add(lookTuning, 'waveMin', 0, 10, 0.1).name('Shockwave min ring (m)');
  f.add(lightTuning, 'dayScale', 0, 2, 0.05).name('Lights by day');
  f.add(lightTuning, 'nightScale', 0, 2, 0.05).name('Lights at night');
  f.add(lightUniforms.uLightMax, 'value', 0.2, 3, 0.05).name('Light cap');
  f.add(outlineTuning, 'px', 0, 3, 0.25).name('Outline px');
  f.add(outlineTuning, 'elitePx', 0, 4, 0.25).name('Elite outline px');
  f.add(postfxTuning, 'wavePx', 0, 15, 0.5).name('Shockwave px');
  f.add(postfxTuning, 'waveWidth', 0.05, 1, 0.05).name('Shockwave width');
  f.add(postfxTuning, 'heatPx', 0, 4, 0.1).name('Heat shimmer px');
  f.add(postfxTuning, 'bloomThreshold', 0, 1, 0.05).name('Bloom threshold');
  f.add(postfxTuning, 'bloomStrength', 0, 3, 0.05).name('Bloom strength');
  f.add(postfxTuning, 'nightVignette', 0, 1, 0.05).name('Night vignette');
  const q = { level: renderQuality.level };
  f.add(q, 'level', 0, QUALITY_LEVELS.length - 1, 1)
    .name('Quality rung (manual)')
    .onChange((v: number) => applyQualityLevel(v, false));
  f.add(governorTuning, 'downMs', 15, 40, 0.5).name('Auto: step down above (ms)');
  f.add(governorTuning, 'upMs', 8, 20, 0.1).name('Auto: step up below (ms)');
  f.add(governorTuning, 'upAfter', 2, 30, 1).name('Auto: calm before up (s)');
}
