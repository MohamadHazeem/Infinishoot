import { loadJson, saveJson } from '../core/storage';
import { audioSettings, sfx } from '../audio/sfx';
import { applyRetroStrength } from '../render/retroSettings';
import { postSettings } from '../render/renderer';
import { juiceTuning } from './juice';
import { fxQuality } from './ambience';
import { streaks } from './streaks';
import { DEFAULT_LOADOUT, validLoadout, type Loadout } from '../data/loadout';

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
  hero: string;
  rumble: boolean;
  colorblind: boolean;
  reduceFlash: boolean;
  /** 0 = low, 1 = medium, 2 = high. */
  quality: number;
  /** Last loadout picked (left click, right click, special). */
  loadout: Loadout;
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
  hero: 'rookie',
  rumble: true,
  colorblind: false,
  reduceFlash: false,
  quality: 1,
  loadout: { ...DEFAULT_LOADOUT },
});
settings.loadout = validLoadout(settings.loadout);

/** Accessibility switches read by gameplay and effects code. */
export const access = { colorblind: false, reduceFlash: false };

const QUALITY = [
  { resolution: 216, ambience: 0.35, streaks: false },
  { resolution: 270, ambience: 1, streaks: true },
  { resolution: 360, ambience: 1, streaks: true },
];

/** Push settings into the systems that use them. */
export function applySettings(): void {
  audioSettings.volume = settings.volume;
  audioSettings.sfx = settings.sfxVolume;
  audioSettings.music = settings.musicVolume;
  audioSettings.ui = settings.uiVolume;
  sfx.applyVolumes();
  applyRetroStrength(settings.retro);
  juiceTuning.shakeScale = settings.shake;
  postSettings.glow = settings.quality === 0 ? 0 : settings.glow;
  postSettings.crt = settings.crt ? 1 : 0;
  access.colorblind = settings.colorblind;
  access.reduceFlash = settings.reduceFlash;
  document.body.classList.toggle('reduce-flash', settings.reduceFlash);
  const q = QUALITY[Math.max(0, Math.min(2, Math.round(settings.quality)))];
  if (postSettings.resolution !== q.resolution) {
    postSettings.resolution = q.resolution;
    window.dispatchEvent(new Event('resize'));
  }
  fxQuality.ambience = q.ambience;
  streaks.enabled = q.streaks;
}

export function saveSettings(): void {
  saveJson(KEY, settings);
  applySettings();
}
