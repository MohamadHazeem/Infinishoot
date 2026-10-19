import type GUI from 'lil-gui';
import { hudTuning } from './hud';
import { applyUiScale, uiScaleTuning } from './hudLayout';
import { styleHudTuning } from './styleMeter';
import { damageNumberTuning } from './damageNumbers';
import { promptState } from './prompts';
import { settings } from '../game/settings';

/** Debug panel "HUD" folder (HUD lane knobs). */
export function addHudFolder(gui: GUI): void {
  const f = gui.addFolder('HUD').close();
  const rescale = () => applyUiScale(settings.uiScale);
  f.add(settings, 'uiScale', uiScaleTuning.min, uiScaleTuning.max, 5).name('UI scale %').onChange(rescale);
  f.add(uiScaleTuning, 'fitW', 600, 1600, 10).name('Fit width per 100%').onChange(rescale);
  f.add(uiScaleTuning, 'fitH', 400, 1000, 10).name('Fit height per 100%').onChange(rescale);
  f.add(promptState, 'force', { auto: null, keyboard: 'kbm', xbox: 'xbox', playstation: 'ps', touch: 'touch' }).name('Prompts');
  f.add(settings, 'damageNumbers', ['all', 'mine', 'off']).name('Damage numbers');
  f.add(damageNumberTuning, 'life', 0.2, 2, 0.05).name('Number life');
  f.add(styleHudTuning, 'linger', 0, 2, 0.05).name('Style D linger');
  f.add(hudTuning, 'damageHold', 0, 1, 0.01).name('Life chunk hold');
}
