import { loadJson, saveJson } from '../core/storage';
import { audioSettings, sfx } from '../audio/sfx';
import { applyRetroStrength } from '../render/retroSettings';
import { postSettings } from '../render/renderer';
import { juiceTuning } from './juice';

/** Player-facing settings, persisted between sessions. */
export interface Settings {
  volume: number;
  sfxVolume: number;
  musicVolume: number;
  uiVolume: number;
  retro: number;
  shake: number;
  autoFire: boolean;
  showFps: boolean;
  /** Hero skin id (src/data/skins.ts). */
  skin: string;
  glow: number;
  crt: boolean;
  pet: string;
  mode: string;
  difficulty: string;
}

const KEY = 'settings.v1';

export const settings: Settings = loadJson<Settings>(KEY, {
  volume: 0.6,
  sfxVolume: 1,
  musicVolume: 0.7,
  uiVolume: 0.8,
  retro: 0.5,
  shake: 1,
  autoFire: false,
  showFps: false,
  skin: 'classic',
  glow: 0.4,
  crt: false,
  pet: 'none',
  mode: 'standard',
  difficulty: 'normal',
});

/** Push settings into the systems that use them. */
export function applySettings(): void {
  audioSettings.volume = settings.volume;
  audioSettings.sfx = settings.sfxVolume;
  audioSettings.music = settings.musicVolume;
  audioSettings.ui = settings.uiVolume;
  sfx.applyVolumes();
  applyRetroStrength(settings.retro);
  juiceTuning.shakeScale = settings.shake;
  postSettings.glow = settings.glow;
  postSettings.crt = settings.crt ? 1 : 0;
}

export function saveSettings(): void {
  saveJson(KEY, settings);
  applySettings();
}
