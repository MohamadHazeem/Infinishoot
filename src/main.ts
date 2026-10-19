import './platform/desktop';
import { installDesktopUi } from './platform/help';
import { displayState } from './platform/display';
import { mods } from './mods/manager';
import '@fontsource/jersey-10/latin-400.css';
import '@fontsource/jersey-15/latin-400.css';
import '@fontsource/silkscreen/latin-400.css';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { RetroRenderer } from './render/renderer';
import { retroGlobals } from './render/retroMaterial';
import { renderQuality } from './render/quality';
import { Game, cheats } from './game/game';
import { applySettings, autoQualityTick, settings } from './game/settings';
import { setupTouch } from './ui/touch';
import { syncPrompts } from './ui/prompts';
import { withLoading } from './ui/loadingScreen';
import { samples } from './audio/samples';
import { prof } from './core/prof';
import type { PhotoMode } from './ui/photoMode';

performance.mark('infinishoot:modules');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudEl = document.getElementById('hud')!;
const statsEl = document.getElementById('stats')!;
const reticleEl = document.getElementById('reticle')!;

// Content must be ready before pooled meshes or a lobby can be created.
const modQuery = new URLSearchParams(location.search);
const modPreview = modQuery.has('test') && modQuery.has('modexample')
  ? [{ key: 'preview/mint', name: 'example.json', raw: (await import('../docs/mods/example.json?raw')).default, enabled: true }]
  : undefined;
await mods.initialize(modPreview);
applySettings();
const renderer = new RetroRenderer(canvas);
performance.mark('infinishoot:renderer');
renderer.gl.setClearColor(retroGlobals.uFogColor.value);

const input = new Input(canvas);
const game = new Game(input, renderer.aspect, hudEl, reticleEl);
performance.mark('infinishoot:game');
// Audio is optional and gesture-unlocked; report the core pack without delaying play.
let audioReported = false;
const reportAudio = () => {
  if (audioReported) return;
  audioReported = true;
  queueMicrotask(() => { void withLoading(() => Promise.race([samples.coreReady, new Promise<void>(resolve => setTimeout(resolve, 4000))]), 'menu.load.audio'); });
  window.removeEventListener('pointerdown', reportAudio);
  window.removeEventListener('keydown', reportAudio);
};
window.addEventListener('pointerdown', reportAudio);
window.addEventListener('keydown', reportAudio);
installDesktopUi(game.screens);
window.addEventListener('resize', () => game.cam.setAspect(renderer.aspect));
setupTouch(hudEl, input, () => game.isCombatMode && game.screens.current === 'none');
// Optional tools load only on their first use (including lil-gui and its tuning panels).
let debugLoading = false;
const openDebug = (e: KeyboardEvent) => {
  if (e.code !== 'Backquote' || e.repeat || debugLoading) return;
  debugLoading = true;
  void withLoading(() => import('./ui/debugPanel')).then(({ createDebugPanel }) => {
    createDebugPanel(renderer, game, () => game.cam.setAspect(renderer.aspect)).show();
    window.removeEventListener('keydown', openDebug);
  }).catch(() => {
    debugLoading = false;
    game.hud.toast('DEBUG PANEL COULD NOT LOAD. TRY AGAIN.', 3);
  });
};
window.addEventListener('keydown', openDebug);
let photo: PhotoMode | null = null;
let photoLoading = false;
const openPhoto = (e: MouseEvent) => {
  if (!(e.target as HTMLElement | null)?.closest?.('[data-act="photo"]') || photoLoading) return;
  photoLoading = true;
  void withLoading(() => import('./ui/photoMode')).then(({ PhotoMode }) => {
    photo = new PhotoMode(game, canvas);
    game.photo = photo;
    if (import.meta.env.DEV) Object.assign(window, { photo });
    document.removeEventListener('click', openPhoto);
    photo.open(); // open() rechecks the current session after the download.
  }).catch(() => {
    photoLoading = false;
    game.hud.toast('PHOTO MODE COULD NOT LOAD. TRY AGAIN.', 3);
  });
};
document.addEventListener('click', openPhoto);
// Production title loads no debug/test helpers. Test links still finish setup before the loop.
if (new URLSearchParams(location.search).has('test')) {
  const { applyTestLink } = await import('./dev/testLinks');
  applyTestLink(game);
}

// Leaving the tab mid-fight opens the pause menu.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});

// --- Stats ---
let fpsAcc = 0;
let fpsFrames = 0;
let statsTimer = 0;
// Benchmark timers (`&bench`): update time summed over this frame's sim steps.
let profUpdate = 0;
let profSteps = 0;

let titleMeasured = false;
let stageMeasured = false;
const loop = new GameLoop({
  // Co-op hosts keep simulating in a background tab so clients don't freeze.
  frameCap: () => displayState.cap,
  runHidden: () => game.role === 'host',

  update(dt) {
    const t0 = prof.on ? performance.now() : 0;
    input.poll();
    game.update(dt);
    if (prof.on) {
      profUpdate += performance.now() - t0;
      profSteps++;
    }
  },

  render(alpha, frameDt) {
    syncPrompts(input, frameDt); // button prompts follow the last used device
    const t0 = prof.on ? performance.now() : 0;
    if (!game.paused && game.mode !== 'levelup') retroGlobals.uTime.value += frameDt;
    game.render(alpha, frameDt);
    photo?.frame(frameDt);
    const t1 = prof.on ? performance.now() : 0;
    renderer.gl.setClearColor(retroGlobals.uFogColor.value); // follows the biome
    renderer.render(game.scene, game.cam.camera);
    photo?.afterRender();
    // Startup milestones: a submitted WebGL frame, not just constructed DOM.
    if (!titleMeasured && game.mode === 'title') {
      titleMeasured = true;
      performance.mark('infinishoot:title-frame');
    }
    if (!stageMeasured && game.stage === 1 && game.isCombatMode) {
      stageMeasured = true;
      performance.mark('infinishoot:stage1-frame');
    }
    if (prof.on) {
      const t2 = performance.now();
      const info = renderer.gl.info.render;
      prof.frames.push([profUpdate, t1 - t0, t2 - t1, frameDt * 1000, profSteps, info.calls, info.triangles]);
      profUpdate = profSteps = 0;
    }
    // Auto quality: measured while actually playing (menus and pauses don't count).
    autoQualityTick(frameDt * (displayState.cap === 30 ? 0.5 : 1), game.isCombatMode && !game.paused && game.screens.current === 'none' && !document.hidden);

    fpsAcc += frameDt;
    fpsFrames++;
    statsTimer += frameDt;
    if (statsTimer > 0.25) {
      statsEl.hidden = !settings.showFps;
      if (settings.showFps) {
        const info = renderer.gl.info.render;
        statsEl.textContent =
          `FPS ${Math.round(fpsFrames / fpsAcc)}\n` +
          `draws ${info.calls}  tris ${info.triangles}\n` +
          `enemies ${game.enemies.activeCount}  bullets ${game.bullets.count}\n` +
          `quality ${renderQuality.name}${renderQuality.auto ? ' (auto)' : ''}  ${renderer.height.value}p`;
      }
      fpsAcc = fpsFrames = statsTimer = 0;
    }
  },
});

loop.start();

// Dev-only handle for console debugging/profiling.
if (import.meta.env.DEV) {
  Object.assign(window, { game, renderer, input, loop, cheats, photo });
  void import('./dev/bot').then((m) => m.installBot(game, input));
}
