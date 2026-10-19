import { applyDesktopSettings } from '../platform/desktop';
import { displayOptions, type DisplayOptions } from '../../electron/logic.mjs';
import { mobileDevice } from '../core/mobile';
import { applyColorblind, type ColorblindMode } from '../render/colorblind';
import { applyTextScale } from '../ui/settingsScreen';
import { browserLanguage, type Language } from '../i18n';
import { applyLanguage } from '../i18n/layout';
import { spatialSettings } from '../audio/spatial';
import { loadJson, saveJson } from '../core/storage';
import { audioSettings, sfx } from '../audio/sfx';
import { ambienceSettings } from '../audio/ambienceAudio';
import { announcerSettings, announcer } from '../audio/announcer';
import { voiceSettings as synthVoiceSettings } from '../audio/heroVoice';
import { a11yAudio } from '../audio/captions';
import { voiceSettings } from '../audio/voices';
import { crowdSettings } from '../audio/crowd';
import { radioSettings } from '../audio/radio';
import { applyRetroStrength } from '../render/retroSettings';
import { postSettings } from '../render/renderer';
import { juiceTuning } from './juice';
import { fxQuality, weatherSettings } from './ambience';
import { streaks } from './streaks';
import { DEFAULT_LOADOUT, validLoadout, type Loadout } from '../data/loadout';
import { applyUiScale } from '../ui/hudLayout';
import { AUTO, AUTO_START, POTATO, qualitySettingLevel, QualityGovernor, renderQuality, setRenderQuality } from '../render/quality';

/** Player-facing settings, persisted between sessions. */
export interface Settings extends DisplayOptions {
  highlightClips: boolean;
  language: Language;
  volume: number;
  sfxVolume: number;
  musicVolume: number;
  uiVolume: number;
  ambienceVolume: number;
  announcer: boolean;
  interactiveMusic: boolean;
  adaptiveSilence: boolean;
  lowHealthAudio: boolean;
  headphones3d: boolean;
  /** HERO VOICES: hero barks (recorded for the original heroes, synthesized for the rest; src/audio/voices.ts, heroVoice.ts). */
  heroVoices: boolean;
  /** VOICE volume for hero barks. */
  voiceVolume: number;
  /** Caption strip for the announcer and voice lines. */
  captions: boolean;
  /** Screen-edge arrows toward off-screen threat sounds. */
  soundArrows: boolean;
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
  /** Graphics quality: 0 = low, 1 = medium, 2 = high, 3 = auto (holds 60 fps), 4 = Potato. */
  graphics: number;
  /** Real sun shadows, active only on the HIGH quality rung. */
  dynamicShadows: boolean;
  /** Screen-space shockwaves and heat shimmer. */
  distortion: boolean;
  /** Every third stage is at night. */
  nightStages: boolean;
  /** Last loadout picked (left click, right click, special). */
  loadout: Loadout;
  /** Smart camera: auto zoom with the swarm and the boss kill-cam (off = plain follow camera). */
  dynamicCamera: boolean;
  /** Boss entrance cinematics (letterbox, camera pan, title card). */
  bossIntros: boolean;
  /** Slow-motion on perfect dashes and Mega Barrage (solo only). */
  slowMo: boolean;
  /** First-time tip panels during runs (src/game/tips.ts). */
  tips: boolean;
  /** UI SCALE in percent (75-150): zooms the HUD panels and menus. */
  uiScale: number;
  /** DAMAGE NUMBERS: automatic thinning, all, only your hits (co-op), or none. */
  damageNumbers: 'auto' | 'all' | 'mine' | 'off';
  /** Weather: rain, snow and other motes, lightning (off = always clear skies). */
  weather: boolean;
  /** Host/solo: stage weather that changes combat (independent of particles). */
  weatherEffects: boolean;
  /** Right click: hold to charge, or press once to start and again to release. */
  chargeMode: 'hold' | 'toggle';
  /** Pet zap sounds (pets zap often at high level). */
  petSounds: boolean;
  /** Comic finisher on a stage boss's killing blow. */
  finishers: boolean;
  /** Character portraits popping in (announcer, bosses, pings). */
  portraitPops: boolean;
  /** ANIME LOOK: ink outlines on everything, flat cel bands, speed lines, impact frames (graphics lane). */
  animeLook: boolean;
  /** CUSTOMISE: hero colours, accessory and weapon skin as a 5-character code (src/data/customise.ts). */
  look: string;
  /** Slow-motion replay of the hit that ended the run, before the game-over screen. */
  deathReplay: boolean;
  /** Online lobby (host): the team shares a pool of lives (coop2 lane, src/game/coop2.ts). */
  coopPool: boolean;
  /** Online (host): friends can join the run after it starts and come back if they drop. */
  coopJoinable: boolean;
  /** Friends' help ghosts appear in your runs (EXTRAS > HELP GHOSTS). */
  helpGhosts: boolean;
  /** CO-OP CAMERA (eightp lane): frame nearby teammates ('team') or follow only your hero ('me'). */
  coopCamera: 'team' | 'me';
  /** TEAMMATE WEAPONS (eightp lane): volume of other players' weapon sounds, 0-1 (yours always play in full). */
  mateWeapons: number;
  /** Online (host): friends may watch as spectators (spectate lane, up to 8). */
  spectators: boolean;
  /** Watching: the broadcast overlay (every player's card, clean HUD) starts on. */
  spectateOverlay: boolean;
  /** Online: the NETWORK panel with everyone's ping, packet loss and snapshot rate (netcode lane). */
  netOverlay: boolean;
  /** BUDDY TETHER: draw the energy link between nearby teammates (the bonus stays either way; coopplay lane). */
  tetherVisual: boolean;
  /** CINEMATICS: sky-fall transitions, the ending, legendary reveals, jackpot reels (full, short or off). */
  cinematics: 'full' | 'short' | 'off';
  /** Weekly co-op team name this machine hosts under (MP lane; '' = "<name>'s Team"). */
  teamName: string;
  /** Host lobbies as PUBLIC (listed in PLAY ONLINE > BROWSE GAMES when the online service is on). */
  lobbyPublic: boolean;
  /** CROWD: the invisible arena crowd (cheers, gasps, boos; src/audio/crowd.ts). */
  crowd: boolean;
  /** RADIO DJ: the radio host between stages (src/audio/radio.ts). */
  radioDj: boolean;
  /** Local display correction, independent of the legacy bullet palette. */
  colorblindMode: ColorblindMode;
  textScale: number;
  reduceScreenEffects: boolean;
  dashRunMode: 'hold' | 'toggle';
  rewindMode: 'hold' | 'toggle';
  teamMoveMode: 'hold' | 'toggle';
  aimAssist: boolean;
  mouseAimAssist: boolean;
  batterySaver: boolean;
  touchOpacity: number;
  touchAutoHide: boolean;
  /** VOICE CHAT (voicechat lane, src/net/voice.ts): off by default; turning it on asks for the microphone. */
  voiceChat: boolean;
  /** Push to talk (the talk key / L3) or an open mic gated by MIC SENSITIVITY. */
  voiceMode: 'ptt' | 'open';
  /** Open-mic sensitivity 0..1 (higher picks up quieter speech). */
  voiceSensitivity: number;
  /** Volume of teammates' voices. */
  voiceChatVolume: number;
  /** TEAM RADIO: hear every teammate at full volume, wherever they are. */
  teamRadio: boolean;
}

const KEY = 'settings.v1';

export const SETTINGS_DEFAULTS: Readonly<Settings> = {
  windowMode: 'windowed', resolutionScale: 100, frameCap: '60', vsync: true, autoUpdate: true,
  highlightClips: true,
  language: browserLanguage(),
  volume: 0.6,
  sfxVolume: 1,
  musicVolume: 0.7,
  uiVolume: 0.8,
  ambienceVolume: 0.45,
  announcer: true,
  interactiveMusic: true,
  adaptiveSilence: true,
  lowHealthAudio: true,
  headphones3d: false,
  heroVoices: true,
  voiceVolume: 0.8,
  captions: false,
  soundArrows: false,
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
  dynamicShadows: false,
  distortion: true,
  nightStages: true,
  loadout: { ...DEFAULT_LOADOUT },
  dynamicCamera: true,
  bossIntros: true,
  slowMo: true,
  tips: true,
  uiScale: 100,
  damageNumbers: 'auto',
  weather: true,
  weatherEffects: true,
  chargeMode: 'hold',
  petSounds: true,
  finishers: true,
  portraitPops: true,
  animeLook: false,
  look: '---00',
  deathReplay: true,
  coopPool: false,
  coopJoinable: true,
  helpGhosts: true,
  coopCamera: 'team',
  mateWeapons: 0.8,
  spectators: true,
  spectateOverlay: true,
  netOverlay: false,
  tetherVisual: true,
  cinematics: 'full',
  teamName: '',
  lobbyPublic: false,
  crowd: true,
  radioDj: true,
  colorblindMode: 'off',
  textScale: 100,
  reduceScreenEffects: false,
  dashRunMode: 'hold',
  rewindMode: 'toggle',
  teamMoveMode: 'toggle',
  aimAssist: true,
  mouseAimAssist: false,
  batterySaver: false,
  touchOpacity: 70,
  touchAutoHide: true,
  voiceChat: false,
  voiceMode: 'ptt',
  voiceSensitivity: 0.5,
  voiceChatVolume: 0.9,
  teamRadio: false,
};
export const settings: Settings = loadJson<Settings>(KEY, { ...SETTINGS_DEFAULTS, loadout: { ...DEFAULT_LOADOUT } });
Object.assign(settings, displayOptions(settings));
settings.highlightClips = settings.highlightClips !== false;
settings.damageNumbers ??= 'auto';
settings.batterySaver = settings.batterySaver === true;
settings.touchOpacity = Number.isFinite(settings.touchOpacity) ? Math.max(25, Math.min(100, settings.touchOpacity)) : 70;
settings.touchAutoHide = settings.touchAutoHide !== false;
settings.language = settings.language === 'ar' || settings.language === 'en' ? settings.language : browserLanguage();
// Screenshot/test locale override. Subsequent explicit settings changes persist normally.
if (typeof location !== 'undefined') {
  const lang = new URLSearchParams(location.search).get('lang');
  if (lang === 'ar' || lang === 'en') settings.language = lang;
}
settings.dynamicCamera ??= true;
settings.tips ??= true;
settings.weather ??= true;
settings.weatherEffects ??= true;
settings.petSounds ??= true;
settings.finishers ??= true;
settings.portraitPops ??= true;
settings.animeLook ??= false;
settings.look ??= '---00';
settings.deathReplay ??= true;
settings.coopPool ??= false;
settings.coopJoinable ??= true;
settings.helpGhosts ??= true;
settings.coopCamera = settings.coopCamera === 'me' ? 'me' : 'team';
settings.mateWeapons = Number.isFinite(settings.mateWeapons) ? Math.max(0, Math.min(1, settings.mateWeapons)) : 0.8;
settings.spectators ??= true;
settings.spectateOverlay ??= true;
settings.netOverlay ??= false;
settings.tetherVisual ??= true;
settings.cinematics ??= 'full';
settings.teamName ??= '';
settings.lobbyPublic ??= false;
settings.crowd ??= true;
settings.radioDj ??= true;
settings.voiceChat = settings.voiceChat === true;
settings.voiceMode = settings.voiceMode === 'open' ? 'open' : 'ptt';
settings.voiceSensitivity = Number.isFinite(settings.voiceSensitivity) ? Math.max(0, Math.min(1, settings.voiceSensitivity)) : 0.5;
settings.voiceChatVolume = Number.isFinite(settings.voiceChatVolume) ? Math.max(0, Math.min(1, settings.voiceChatVolume)) : 0.9;
settings.teamRadio = settings.teamRadio === true;
settings.loadout = validLoadout(settings.loadout);

/** Accessibility switches read by gameplay and effects code. */
export const access = { colorblind: false, reduceFlash: false };

let governor: QualityGovernor | null = null;

/** Switch the live quality rung (resolution, effects budget). */
export function applyQualityLevel(level: number, auto: boolean): void {
  setRenderQuality(level, auto);
  const q = renderQuality;
  const resolution = Math.round(q.resolution * settings.resolutionScale / 100);
  if (postSettings.resolution !== resolution) {
    postSettings.resolution = resolution;
    window.dispatchEvent(new Event('resize'));
  }
  fxQuality.ambience = q.ambience;
  streaks.enabled = q.streaks && !settings.reduceScreenEffects;
}

/** Auto quality: feed every rendered frame's time while playing; steps quality to hold 60 fps. */
export function autoQualityTick(frameDt: number, active: boolean): void {
  if (!renderQuality.auto || !governor || !active || settings.batterySaver) return;
  const l = governor.sample(frameDt);
  if (l >= 0) applyQualityLevel(l, true);
}

/** The auto-quality governor (debug panel / tests). */
export function qualityGovernor(): QualityGovernor | null {
  return governor;
}

/** Push settings into the systems that use them. */
export function applySettings(): void {
  applyDesktopSettings(settings);
  applyLanguage(settings.language);
  audioSettings.volume = settings.volume;
  audioSettings.sfx = settings.sfxVolume;
  audioSettings.music = settings.musicVolume;
  audioSettings.ui = settings.uiVolume;
  audioSettings.interactiveMusic = settings.interactiveMusic;
  audioSettings.adaptiveSilence = settings.adaptiveSilence;
  audioSettings.lowHealth = settings.lowHealthAudio;
  spatialSettings.headphones = settings.headphones3d;
  sfx.applyVolumes();
  ambienceSettings.volume = settings.ambienceVolume;
  announcerSettings.enabled = settings.announcer;
  audioSettings.voice = settings.voiceVolume;
  synthVoiceSettings.enabled = settings.heroVoices !== false;
  a11yAudio.captions = settings.captions;
  a11yAudio.arrows = settings.soundArrows;
  announcer.update();
  voiceSettings.heroVoices = settings.heroVoices !== false;
  crowdSettings.enabled = settings.crowd !== false;
  radioSettings.enabled = settings.radioDj !== false;
  applyRetroStrength(settings.retro);
  juiceTuning.shakeScale = settings.reduceScreenEffects ? 0 : settings.shake;
  postSettings.glow = settings.glow;
  postSettings.crt = settings.crt ? 1 : 0;
  access.colorblind = settings.colorblind;
  access.reduceFlash = settings.reduceFlash || settings.reduceScreenEffects;
  weatherSettings.enabled = settings.weather;
  document.body.classList.toggle('reduce-flash', access.reduceFlash);
  applyColorblind(settings.colorblindMode);
  applyTextScale(settings.textScale);
  applyUiScale(settings.uiScale);
  const g = Number.isInteger(settings.graphics) && settings.graphics >= 0 && settings.graphics <= POTATO ? settings.graphics : AUTO;
  settings.graphics = g;
  if (g === AUTO) {
    // Keep the governor (and its rung) across unrelated settings changes.
    if (!governor || !renderQuality.auto) governor = new QualityGovernor(mobileDevice() ? 0 : AUTO_START);
    applyQualityLevel(governor.level, true);
  } else {
    governor = null;
    settings.quality = g;
    applyQualityLevel(qualitySettingLevel(g), false);
  }
}

export function saveSettings(): void {
  saveJson(KEY, settings);
  applySettings();
}
