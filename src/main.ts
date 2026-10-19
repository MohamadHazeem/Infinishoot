import '@fontsource/jersey-10/400.css';
import '@fontsource/jersey-15/400.css';
import '@fontsource/silkscreen/400.css';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { RetroRenderer } from './render/renderer';
import { retroGlobals } from './render/retroMaterial';
import { renderQuality } from './render/quality';
import { Game, cheats } from './game/game';
import { applySettings, autoQualityTick, settings } from './game/settings';
import { createDebugPanel } from './ui/debugPanel';
import { setupTouch } from './ui/touch';
import { applyTestLink } from './dev/testLinks';
import { prof } from './core/prof';
import { PhotoMode } from './ui/photoMode';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudEl = document.getElementById('hud')!;
const statsEl = document.getElementById('stats')!;
const reticleEl = document.getElementById('reticle')!;

const renderer = new RetroRenderer(canvas);
applySettings();
renderer.gl.setClearColor(retroGlobals.uFogColor.value);

const input = new Input(canvas);
const game = new Game(input, renderer.aspect, hudEl, reticleEl);
window.addEventListener('resize', () => game.cam.setAspect(renderer.aspect));
setupTouch(hudEl, input, () => game.isCombatMode && game.screens.current === 'none');
createDebugPanel(renderer, game, () => game.cam.setAspect(renderer.aspect));
// Photo mode (pause menu): free camera, filters, stickers, PNG.
const photo = new PhotoMode(game, canvas);
game.photo = photo;
// Test links (?test&stage=4&boss...): jump straight into a situation. See src/dev/testLinks.ts.
applyTestLink(game);

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

const loop = new GameLoop({
  // Co-op hosts keep simulating in a background tab so clients don't freeze.
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
    const t0 = prof.on ? performance.now() : 0;
    if (!game.paused && game.mode !== 'levelup') retroGlobals.uTime.value += frameDt;
    game.render(alpha, frameDt);
    photo.frame(frameDt);
    const t1 = prof.on ? performance.now() : 0;
    renderer.gl.setClearColor(retroGlobals.uFogColor.value); // follows the biome
    renderer.render(game.scene, game.cam.camera);
    photo.afterRender();
    if (prof.on) {
      const t2 = performance.now();
      const info = renderer.gl.info.render;
      prof.frames.push([profUpdate, t1 - t0, t2 - t1, frameDt * 1000, profSteps, info.calls, info.triangles]);
      profUpdate = profSteps = 0;
    }
    // Auto quality: measured while actually playing (menus and pauses don't count).
    autoQualityTick(frameDt, game.isCombatMode && !game.paused && game.screens.current === 'none' && !document.hidden);

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
