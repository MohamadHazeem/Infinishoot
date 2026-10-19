import GUI from 'lil-gui';
import * as THREE from 'three';
import { retroGlobals } from '../render/retroMaterial';
import { postSettings, type RetroRenderer } from '../render/renderer';
import { applyRetroStrength, retro } from '../render/retroSettings';
import { cameraTuning } from '../game/cameraRig';
import { camDirTuning } from '../game/animMath';
import { enemyAnimTuning } from '../game/enemyAnim';
import { heroAnimTuning } from '../game/heroModel';
import { playerTuning } from '../game/player';
import { cheats, scoreTuning, type Game } from '../game/game';
import { specialTuning } from '../data/specials';
import { directorTuning } from '../game/director';
import { aiTuning, bossTuning, eliteTuning, goldenTuning, squadTuning } from '../game/enemies';
import { arenaTuning } from '../game/interactives';
import { hazardTuning } from '../game/hazards';
import { objectiveTuning } from '../game/objectives';
import { juiceTuning } from '../game/juice';
import { WEAPONS } from '../data/weapons';
import { MODS } from '../data/mods';
import { ELITE_MOD_IDS } from '../data/eliteMods';
import { ENEMIES } from '../data/enemies';
import { audioSettings } from '../audio/sfx';
import { addLookFolder } from './debugLook';
import { rainTuning, weatherForce } from '../game/ambience';
import { worldFxTuning } from '../game/particles';
import { debrisTuning } from '../game/debris';
import { decalTuning } from '../game/decals';
import { surfaceTuning } from '../render/surfaces';
import { worldDustTuning } from '../game/systems/worldFx';
import { skillTuning, styleTuning } from '../game/style';
import { ultTuning } from '../game/ultimates';
import { addHudFolder } from './debugHud';

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

  addLookFolder(gui);

  const cam = gui.addFolder('Camera').close();
  cam.add(cameraTuning, 'pitchDeg', 30, 89, 1);
  cam.add(cameraTuning, 'distance', 8, 50, 0.5);
  cam.add(cameraTuning, 'fov', 15, 80, 1);
  cam.add(cameraTuning, 'follow', 1, 30, 0.5);
  cam.add(cameraTuning, 'lookAhead', 0, 0.6, 0.01);
  cam.add(cameraTuning, 'lookAheadMax', 0, 10, 0.5);
  // Smart camera and animation (animation lane).
  const anim = cam.addFolder('Smart camera & animation').close();
  anim.add(camDirTuning, 'autoMin', 0.6, 1, 0.01);
  anim.add(camDirTuning, 'autoMax', 1, 2, 0.01);
  anim.add(camDirTuning, 'swarmOut', 0, 0.6, 0.01);
  anim.add(camDirTuning, 'edgeOut', 0, 0.6, 0.01);
  anim.add(camDirTuning, 'coopMax', 1, 2.2, 0.05);
  anim.add(camDirTuning, 'killCamTime', 0.5, 5, 0.1);
  anim.add(camDirTuning, 'killCamZoom', 0.3, 1, 0.05);
  anim.add(heroAnimTuning, 'legSwing', 0, 2, 0.05);
  anim.add(heroAnimTuning, 'leanFwd', 0, 0.8, 0.01);
  anim.add(heroAnimTuning, 'dashStretch', 0, 1, 0.05);
  anim.add(enemyAnimTuning, 'gait', 0, 2, 0.05).name('Enemy gait');
  anim.add(enemyAnimTuning, 'hitWobble', 0, 2, 0.05);
  anim.add(enemyAnimTuning, 'flingSpeed', 0, 20, 0.5);
  anim.add(enemyAnimTuning, 'corpseLife', 0.1, 2, 0.05);

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
  const elite = { enemy: 'bopper', mod: ELITE_MOD_IDS[0] };
  run.add(elite, 'enemy', Object.keys(ENEMIES).filter((id) => !ENEMIES[id].boss)).name('Elite enemy');
  run.add(elite, 'mod', ELITE_MOD_IDS).name('Elite modifier');
  run.add({ e: () => game.debugSpawnElite(elite.enemy, elite.mod) }, 'e').name('Spawn elite');
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
  dir.add(directorTuning, 'hpPerStage2', 0, 1, 0.01);
  dir.add(directorTuning, 'bossPerStage', 0, 3, 0.05);
  dir.add(directorTuning, 'bossPerStage2', 0, 1, 0.01);
  dir.add(directorTuning, 'dmgPerStage', 0, 2, 0.05);
  dir.add(directorTuning, 'dmgPerStage2', 0, 0.5, 0.01);
  dir.add(directorTuning, 'hpPerMinute', 0, 1, 0.01);
  dir.add(directorTuning, 'ringEvery', 10, 120, 5);
  dir.add(directorTuning, 'coopEase', 0.5, 1.2, 0.05).name('Co-op ease');
  dir.add(scoreTuning, 'comboWindow', 0.5, 6, 0.1);
  dir.add(specialTuning, 'cooldown', 3, 30, 0.5).name('Special cooldown (s)');

  // Arena toys, hazards and objectives (src/game/interactives.ts, hazards.ts, objectives.ts).
  const ar = gui.addFolder('Arena').close();
  for (const k of ['jumpTime', 'jumpHeight', 'landRadius', 'landDmg', 'landKnock', 'turretTime', 'turretCooldown', 'turretRate', 'turretDmg', 'crateHp', 'pillarHp'] as const) ar.add(arenaTuning, k);
  for (const k of ['knockSpeed', 'iceSlide', 'splatSpeed', 'sandHero', 'sinkTime', 'thornTick', 'envScore'] as const) ar.add(hazardTuning, k);
  for (const k of ['beaconTime', 'beaconDrain', 'envKills', 'goldBase'] as const) ar.add(objectiveTuning, k);

  const boss = gui.addFolder('Boss').close();
  boss.add(bossTuning, 'hp', 0.2, 5, 0.1);
  boss.add(bossTuning, 'speed', 0.5, 2.5, 0.05);
  boss.add(bossTuning, 'pace', 0.2, 2, 0.05);
  boss.add(bossTuning, 'firstAttack', 0, 6, 0.1);
  boss.add(bossTuning, 'enrageAt', 0, 1, 0.05);
  boss.add(bossTuning, 'enrageSpeed', 1, 2, 0.05);
  boss.add(bossTuning, 'enragePace', 0.2, 1, 0.05);
  boss.add(eliteTuning, 'speed', 0.5, 2, 0.05).name('Elite speed');
  boss.add(eliteTuning, 'pace', 0.3, 1.5, 0.05).name('Elite pace');

  const ai = gui.addFolder('Enemy AI').close();
  ai.add(aiTuning, 'flankMax', 0, 1.5, 0.05);
  ai.add(aiTuning, 'wideShare', 0, 1, 0.05);
  ai.add(aiTuning, 'coverPeek', 0, 3, 0.1);
  ai.add(squadTuning, 'engage', 0, 20, 0.5).name('Squad engage');
  ai.add(squadTuning, 'rallyEvery', 1, 20, 0.5).name('Rally every');
  ai.add(squadTuning, 'rallySpeed', 1, 2, 0.05).name('Rally speed');
  ai.add(goldenTuning, 'panicSpeed', 1, 2, 0.05).name('Goldbug panic');
  ai.add(directorTuning, 'goldenChance', 0, 1, 0.05).name('Goldbug chance');

  const fx = gui.addFolder('Juice & audio').close();
  fx.add(juiceTuning, 'hitStopScale', 0, 3, 0.1).name('Hit-stop x');
  fx.add(juiceTuning, 'shakeScale', 0, 3, 0.1).name('Shake x');
  fx.add(juiceTuning, 'shakeMax', 0, 2, 0.05);
  fx.add(juiceTuning, 'shakeDecay', 0.2, 5, 0.1);
  // Skill layer: perfect dash, parry, style meter and ultimates.
  const skill = gui.addFolder('Skill').close();
  skill.add(skillTuning, 'perfectLead', 0, 0.6, 0.02).name('Perfect lead (s)');
  skill.add(skillTuning, 'perfectSlowMo', 0, 1, 0.05).name('Perfect slow-mo (s)');
  skill.add(skillTuning, 'buffDamage', 0, 1, 0.05).name('Buff damage +');
  skill.add(skillTuning, 'parryWindow', 0.05, 0.5, 0.01).name('Parry window (s)');
  skill.add(skillTuning, 'parryWindowRemote', 0.05, 0.6, 0.01).name('Parry window online');
  skill.add(skillTuning, 'parryCooldown', 0, 2, 0.05).name('Parry cooldown');
  skill.add(styleTuning, 'killPerSec', 0, 30, 1).name('Style kill pts/s');
  skill.add(styleTuning, 'perfectDash', 0, 300, 5).name('Style perfect');
  skill.add(styleTuning, 'parry', 0, 300, 5).name('Style parry');
  skill.add(ultTuning, 'killGain', 0, 0.01, 0.0001).name('Ult per kill');
  skill.add(ultTuning, 'hitGain', 0, 0.01, 0.0001).name('Ult per hit');
  skill.add(ultTuning, 'bossMul', 0, 1, 0.05).name('Ult vs bosses');
  skill.add({ fill: () => (game.hero.skill.ult = 1) }, 'fill').name('Fill ultimate');
  fx.add(audioSettings, 'volume', 0, 1, 0.05);
  fx.add(audioSettings, 'muted');

  // World effects (cosmetic): weather, smoke/dust, debris, decals, surfaces.
  const world = gui.addFolder('World FX').close();
  world.add(game.ambience, 'rain', 0, 1, 0.01).name('Rain now').listen().disable();
  world.add({ rain: () => game.ambience.setRain(!game.ambience.raining) }, 'rain').name('Toggle rain');
  world.add(weatherForce, 'mode', { seeded: null, rain: 'rain', clear: 'clear' }).name('Next stages');
  world.add(rainTuning, 'dark', 0, 1, 0.05).name('Rain darkness');
  world.add(rainTuning, 'flash', 0, 1, 0.05).name('Lightning');
  world.add(worldFxTuning, 'amount', 0, 2, 0.1).name('FX amount');
  world.add(worldFxTuning, 'smokeRise', 0, 4, 0.1);
  world.add(worldFxTuning, 'sparkGravity', 0, 60, 1);
  world.add(debrisTuning, 'gravity', 5, 60, 1).name('Debris gravity');
  world.add(debrisTuning, 'bounce', 0, 0.9, 0.05).name('Debris bounce');
  world.add(debrisTuning, 'life', 0.5, 10, 0.1).name('Debris life');
  world.add(decalTuning, 'footLife', 1, 20, 0.5).name('Footprint life');
  world.add(decalTuning, 'footAlpha', 0, 1, 0.05).name('Footprint alpha');
  world.add(decalTuning, 'scorchLife', 1, 20, 0.5).name('Scorch life');
  world.add(worldDustTuning, 'stride', 0.3, 2, 0.05).name('Footprint stride');
  world.add(surfaceTuning, 'rippleEvery', 0.1, 3, 0.05);
  world.add(surfaceTuning, 'bubbleEvery', 0.05, 2, 0.05);
  world.add(surfaceTuning, 'glintsPerM2', 0, 1, 0.01);
  addHudFolder(gui);

  return gui;
}
