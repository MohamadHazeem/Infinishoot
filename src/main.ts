import '@fontsource/jersey-10/400.css';
import '@fontsource/jersey-15/400.css';
import '@fontsource/silkscreen/400.css';
import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { RetroRenderer } from './render/renderer';
import { retroGlobals } from './render/retroMaterial';
import { Game, cheats } from './game/game';
import { applySettings, settings } from './game/settings';
import { createDebugPanel } from './ui/debugPanel';
import { setupTouch } from './ui/touch';

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

// Leaving the tab mid-fight opens the pause menu.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
});

// --- Stats ---
let fpsAcc = 0;
let fpsFrames = 0;
let statsTimer = 0;

const loop = new GameLoop({
  // Co-op hosts keep simulating in a background tab so clients don't freeze.
  runHidden: () => game.role === 'host',

  update(dt) {
    input.poll();
    game.update(dt);
  },

  render(alpha, frameDt) {
    if (!game.paused && game.mode !== 'levelup') retroGlobals.uTime.value += frameDt;
    game.render(alpha, frameDt);
    renderer.gl.setClearColor(retroGlobals.uFogColor.value); // follows the biome
    renderer.render(game.scene, game.cam.camera);

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
          `enemies ${game.enemies.activeCount}  bullets ${game.bullets.count}`;
      }
      fpsAcc = fpsFrames = statsTimer = 0;
    }
  },
});

loop.start();

// Dev-only handle for console debugging/profiling.
if (import.meta.env.DEV) {
  Object.assign(window, { game, renderer, input, loop, cheats });
  void import('./dev/bot').then((m) => m.installBot(game, input));
}
