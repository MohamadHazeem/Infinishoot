import GUI from 'lil-gui';
import * as THREE from 'three';
import { retroGlobals } from '../render/retroMaterial';
import { postSettings, type RetroRenderer } from '../render/renderer';
import { applyRetroStrength, retro } from '../render/retroSettings';
import { cameraTuning } from '../game/cameraRig';
import { playerTuning } from '../game/player';
import { bombTuning, cheats, scoreTuning, type Game } from '../game/game';
import { directorTuning } from '../game/director';
import { juiceTuning } from '../game/juice';
import { WEAPONS } from '../data/weapons';
import { MODS } from '../data/mods';
import { audioSettings } from '../audio/sfx';

/** lil-gui tweak panel. Hidden by default; toggle with the backquote key. */
export function createDebugPanel(renderer: RetroRenderer, game: Game, onResize: () => void): GUI {
  const gui = new GUI({ title: 'InfiniShoot debug' });
  gui.hide();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') gui._hidden ? gui.show() : gui.hide();
  });

  const look = gui.addFolder('Retro look');
  look
    .add(retro, 'strength', 0, 1, 0.05)
    .name('Retro strength')
    .onChange((v: number) => {
      applyRetroStrength(v);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    });
  look
    .add(postSettings, 'resolution', { '240p': 240, '270p': 270, '360p': 360, '480p': 480, '720p': 720, native: 0 })
    .name('Internal res')
    .onChange(() => {
      renderer.resize();
      onResize();
    });
  look.add(retroGlobals.uSnapPx, 'value', 0, 3, 0.05).name('Vertex snap (px)');
  look.add(retroGlobals.uAffine, 'value', 0, 1, 0.05).name('Affine warp');
  look.add(postSettings, 'colorBits', 3, 8, 1).name('Colour bits');
  look.add(postSettings, 'dither', 0, 1, 0.05).name('Dither');
  look.add(postSettings, 'saturation', 0, 2, 0.05).name('Saturation');
  look.add(retroGlobals.uToonSteps, 'value', 0, 6, 1).name('Cel bands (0=off)');

  const light = gui.addFolder('Lighting & fog').close();
  const sun = { azimuth: 42, elevation: 53 };
  const setSun = () => {
    const az = THREE.MathUtils.degToRad(sun.azimuth);
    const el = THREE.MathUtils.degToRad(sun.elevation);
    retroGlobals.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  };
  setSun();
  light.add(sun, 'azimuth', -180, 180, 1).onChange(setSun);
  light.add(sun, 'elevation', 5, 90, 1).onChange(setSun);
  light.addColor(retroGlobals.uSunColor, 'value').name('Sun');
  light.addColor(retroGlobals.uSkyColor, 'value').name('Sky ambient');
  light.addColor(retroGlobals.uGroundColor, 'value').name('Ground ambient');
  light
    .addColor(retroGlobals.uFogColor, 'value')
    .name('Fog / clear')
    .onChange(() => renderer.gl.setClearColor(retroGlobals.uFogColor.value));
  light.add(retroGlobals.uFogNear, 'value', 0, 100, 1).name('Fog near');
  light.add(retroGlobals.uFogFar, 'value', 1, 200, 1).name('Fog far');

  const cam = gui.addFolder('Camera').close();
  cam.add(cameraTuning, 'pitchDeg', 30, 89, 1);
  cam.add(cameraTuning, 'distance', 8, 50, 0.5);
  cam.add(cameraTuning, 'fov', 15, 80, 1);
  cam.add(cameraTuning, 'follow', 1, 30, 0.5);
  cam.add(cameraTuning, 'lookAhead', 0, 0.6, 0.01);
  cam.add(cameraTuning, 'lookAheadMax', 0, 10, 0.5);

  const pl = gui.addFolder('Player').close();
  pl.add(playerTuning, 'maxSpeed', 1, 20, 0.5);
  pl.add(playerTuning, 'accel', 1, 60, 1);
  pl.add(playerTuning, 'friction', 1, 60, 1);
  pl.add(playerTuning, 'turnSpeed', 1, 60, 1);
  pl.add(playerTuning, 'dashSpeed', 5, 60, 1);
  pl.add(playerTuning, 'dashTime', 0.05, 0.5, 0.01);
  pl.add(playerTuning, 'dashCooldown', 0, 3, 0.05);
  pl.add(playerTuning, 'hurtIframes', 0, 3, 0.05);
  pl.add(cheats, 'god').name('God mode');

  const run = gui.addFolder('Run cheats').close();
  run.add(game, 'autoFire').name('Auto-fire (F)').listen();
  run.add({ xp: () => game.debugLevelUp() }, 'xp').name('Level up');
  const give = { weapon: 'drones' };
  run.add(give, 'weapon', Object.keys(WEAPONS)).name('Weapon');
  run.add({ g: () => game.debugGiveWeapon(give.weapon) }, 'g').name('Give / level / evolve weapon');
  const giveMod = { mod: MODS[0].id };
  run.add(giveMod, 'mod', MODS.map((m) => m.id)).name('Mod');
  run.add({ m: () => game.debugGiveMod(giveMod.mod) }, 'm').name('Give mod');
  run.add({ g: () => game.debugAddGold(20) }, 'g').name('+20 gold');
  run.add({ boss: () => game.debugSkipToBoss() }, 'boss').name('Skip to boss');
  run.add({ fill: () => (game.hero.bombCharge = 1) }, 'fill').name('Fill bomb');
  run.add({ restart: () => game.restart() }, 'restart').name('New run');

  const dir = gui.addFolder('Director').close();
  dir.add(directorTuning, 'stageSeconds', 30, 900, 10);
  dir.add(directorTuning, 'aliveStart', 0, 200, 1);
  dir.add(directorTuning, 'aliveEnd', 0, 450, 5);
  dir.add(directorTuning, 'spawnPerSecond', 1, 60, 1);
  dir.add(directorTuning, 'hpPerStage', 0, 3, 0.05);
  dir.add(directorTuning, 'hpPerMinute', 0, 1, 0.01);
  dir.add(directorTuning, 'ringEvery', 10, 120, 5);
  dir.add(scoreTuning, 'comboWindow', 0.5, 6, 0.1);
  dir.add(bombTuning, 'chargePerXp', 0, 0.05, 0.001).name('Bomb charge/XP');
  dir.add(bombTuning, 'damage', 0, 500, 5).name('Bomb damage');

  const fx = gui.addFolder('Juice & audio').close();
  fx.add(juiceTuning, 'hitStopScale', 0, 3, 0.1).name('Hit-stop x');
  fx.add(juiceTuning, 'shakeScale', 0, 3, 0.1).name('Shake x');
  fx.add(juiceTuning, 'shakeMax', 0, 2, 0.05);
  fx.add(juiceTuning, 'shakeDecay', 0.2, 5, 0.1);
  fx.add(audioSettings, 'volume', 0, 1, 0.05);
  fx.add(audioSettings, 'muted');

  return gui;
}
