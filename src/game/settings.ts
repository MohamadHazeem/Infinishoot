import { loadJson, saveJson } from '../core/storage';
import { audioSettings, sfx } from '../audio/sfx';
import { applyRetroStrength } from '../render/retroSettings';
import { postSettings } from '../render/renderer';
import { juiceTuning } from './juice';
import { fxQuality } from './ambience';
import { streaks } from './streaks';
import { DEFAULT_LOADOUT, validLoadout, type Loadout } from '../data/loadout';
import { AUTO, AUTO_START, MANUAL_LEVELS, QualityGovernor, renderQuality, setRenderQuality } from '../render/quality';

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
  /** Legacy manual quality (0 = low, 1 = medium, 2 = high); `graphics` replaced it. */
  quality: number;
  /** Graphics quality: 0 = low, 1 = medium, 2 = high, 3 = auto (holds 60 fps). */
  graphics: number;
  /** Screen-space shockwaves and heat shimmer. */
  distortion: boolean;
  /** Every third stage is at night. */
  nightStages: boolean;
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
  graphics: AUTO,
  distortion: true,
  nightStages: true,
  loadout: { ...DEFAULT_LOADOUT },
});
settings.loadout = validLoadout(settings.loadout);

/** Accessibility switches read by gameplay and effects code. */
export const access = { colorblind: false, reduceFlash: false };

let governor: QualityGovernor | null = null;

/** Switch the live quality rung (resolution, effects budget). */
export function applyQualityLevel(level: number, auto: boolean): void {
  setRenderQuality(level, auto);
  const q = renderQuality;
  if (postSettings.resolution !== q.resolution) {
    postSettings.resolution = q.resolution;
    window.dispatchEvent(new Event('resize'));
  }
  fxQuality.ambience = q.ambience;
  streaks.enabled = q.streaks;
}

/** Auto quality: feed every rendered frame's time while playing; steps quality to hold 60 fps. */
export function autoQualityTick(frameDt: number, active: boolean): void {
  if (!renderQuality.auto || !governor || !active) return;
  const l = governor.sample(frameDt);
  if (l >= 0) applyQualityLevel(l, true);
}

/** The auto-quality governor (debug panel / tests). */
export function qualityGovernor(): QualityGovernor | null {
  return governor;
}

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
  access.colorblind = settings.colorblind;
  access.reduceFlash = settings.reduceFlash;
  document.body.classList.toggle('reduce-flash', settings.reduceFlash);
  const g = Math.max(0, Math.min(AUTO, Math.round(settings.graphics)));
  if (g === AUTO) {
    // Keep the governor (and its rung) across unrelated settings changes.
    if (!governor || !renderQuality.auto) governor = new QualityGovernor(AUTO_START);
    applyQualityLevel(governor.level, true);
  } else {
    governor = null;
    settings.quality = g;
    applyQualityLevel(MANUAL_LEVELS[g], false);
  }
}

export function saveSettings(): void {
  saveJson(KEY, settings);
  applySettings();
}
