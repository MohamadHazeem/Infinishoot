import { pvpTuning } from '../game/pvp';
import { addBiome3Folder } from './debugBiome3';
import { secretsTuning } from '../data/secrets';
import { shadowTuning } from '../render/shadows';
import { gfx3Tuning } from '../game/fx';
import { raidTuning } from '../game/raid/encounter';
import { gauntletTuning } from '../game/systems/gauntlet';
import { addDirector2Debug } from '../game/systems/director2';
import { mvpTuning } from '../game/systems/mvp';
import { bandTuning } from '../audio/stems';
import { noiseTuning } from '../render/noiseGovernor';
import { halloweenTuning } from '../data/seasons';
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
import { weapons3Tuning } from '../game/weapons/weapons3Shared';
import { MODS } from '../data/mods';
import { ELITE_MOD_IDS } from '../data/eliteMods';
import { ENEMIES, familyTuning } from '../data/enemies';
import { audioSettings } from '../audio/sfx';
import { addLookFolder } from './debugLook';
import { addReadabilityFolder } from './debugReadability';
import { addAudioFolder } from './debugAudio';
import { addContentFolder } from './debugContent';
import { addSoundFolder } from './debugSound';
import { addSkyFolder } from './debugSky';
import { addGraphicsFolder } from './debugGraphics';
import { addBossLaneFolder } from './debugBosses';
import { addBosses3Folder } from './debugBosses3';
import { rainTuning, weatherForce } from '../game/ambience';
import { worldFxTuning } from '../game/particles';
import { debrisTuning } from '../game/debris';
import { decalTuning } from '../game/decals';
import { surfaceTuning } from '../render/surfaces';
import { worldDustTuning } from '../game/systems/worldFx';
import { worldDebugFolder } from '../world/worldDebug';
import { addWorldEventsFolder } from './debugWorldEvents';
import { addModesFolder } from './debugModes';
import { finisherTuning } from '../game/finisher';
import { portraitTuning } from './portraits';
import { skillTuning, styleTuning } from '../game/style';
import { ultTuning } from '../game/ultimates';
import { petTuning } from '../data/pets';
import { teamTuning } from '../game/teamMoves';
import { banishTuning } from '../game/banish';
import { cardNumTuning } from '../game/cardNumbers';
import { previewTuning } from '../game/shopPreview';
import { mods2Tuning } from '../data/mods';
import { trainingTuning } from '../game/training';
import { addHudFolder } from './debugHud';
import { addFixesFolder } from './fixesPanel';
import { addGameplayFolder } from './debugGameplay';
import { addTimeFolder } from './debugTime';
import { addCoop2Folder } from './debugCoop2';
import { addCoopplayFolder } from './debugCoopplay';
import { addEightpFolder } from './debugEightp';
import { addCinematicsFolder } from './debugCinematics';
import { addMpFolder } from './debugMp';
import { addSound2Folder } from './debugSound2';

/** lil-gui tweak panel. Hidden by default; toggle with the backquote key. */
export function createDebugPanel(renderer: RetroRenderer, game: Game, onResize: () => void): GUI {
  const gui = new GUI({ title: 'InfiniShoot debug' });
  gui.hide();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') gui._hidden ? gui.show() : gui.hide();
  });

  const pvp = gui.addFolder('PvP').close();
  for (const key of Object.keys(pvpTuning) as (keyof typeof pvpTuning)[]) if (key !== 'sourceMul') pvp.add(pvpTuning, key);
  const sources = pvp.addFolder('Weapon damage').close();
  for (const key of Object.keys(pvpTuning.sourceMul)) sources.add(pvpTuning.sourceMul, key, 0, 3, 0.05);

  const mvp = gui.addFolder('MVP & band').close();
  mvp.add(mvpTuning, 'comboWindow', 0.5, 5, 0.1);
  mvp.add(mvpTuning, 'saveRange', 1, 6, 0.5);
  mvp.add(mvpTuning, 'highlights', 8, 64, 1);
  mvp.add(mvpTuning, 'clutchHp', 0.1, 0.5, 0.05);
  mvp.add(bandTuning, 'near', 0, 10, 1);
  mvp.add(bandTuning, 'range', 12, 40, 1);
  mvp.add(bandTuning, 'slots', 1, 8, 1);

  const noise = gui.addFolder('Readable chaos').close();
  for (const key of Object.keys(noiseTuning) as (keyof typeof noiseTuning)[]) noise.add(noiseTuning, key);

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
  addReadabilityFolder(gui);
  addAudioFolder(gui, game);
  addContentFolder(gui);
  addSoundFolder(gui); // Sound designer: samples, cues, live tuning, export
  addSkyFolder(gui);
  addGraphicsFolder(gui);
  const secrets = gui.addFolder('Secrets').close();
  secrets.add(secretsTuning, 'roomChance', 0, 1, 0.01);
  secrets.add(secretsTuning, 'beatWindow', 0.05, 0.3, 0.01);
  secrets.add(secretsTuning, 'iceSeconds', 3, 30, 1);
  secrets.add(secretsTuning, 'bossHp', 0.5, 3, 0.05);
  const gfx3 = gui.addFolder('Sun shadows & reward VFX').close();
  gfx3.add(shadowTuning, 'strength', 0, 1, 0.01);
  gfx3.add(shadowTuning, 'bias', 0, 0.005, 0.0001);
  gfx3.add(shadowTuning, 'normalBias', 0, 0.1, 0.005);
  gfx3.add(shadowTuning, 'hz', 10, 60, 1);
  for (const key of ['beamStrength', 'beamLife', 'evolutionLife', 'beamHeight', 'evolutionHeight'] as const) gfx3.add(gfx3Tuning, key, 0.05, key.endsWith('Height') ? 10 : 2, 0.05);
  addBossLaneFolder(gui); // Titan, rematches, boss duel
  addBiome3Folder(gui);
  addBosses3Folder(gui); // biome bosses (src/ui/debugBosses3.ts)

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
  // Boss finishers and portraits (finisher lane).
  const fin = cam.addFolder('Finisher & portraits').close();
  fin.add(finisherTuning, 'length', 1, 4, 0.05);
  fin.add(finisherTuning, 'calmLength', 0.8, 3, 0.05);
  fin.add(finisherTuning, 'strike', 0.15, 1, 0.01);
  fin.add(finisherTuning, 'title', 0.2, 1.5, 0.01);
  fin.add(finisherTuning, 'shake', 0, 8, 1);
  fin.add(portraitTuning, 'popSeconds', 1, 6, 0.1);
  fin.add(portraitTuning, 'typeRate', 10, 120, 1);
  fin.add(portraitTuning, 'hurtHold', 0.1, 2, 0.05);

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

  const w3 = gui.addFolder('Weapons 3').close();
  for (const key of Object.keys(weapons3Tuning) as (keyof typeof weapons3Tuning)[]) w3.add(weapons3Tuning, key, 0.1, key === 'swarmTurn' ? 14 : 5, 0.05);

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

  // Shop lane: banish charges, card number lines, order preview sample hits.
  const shop = gui.addFolder('Shop & cards').close();
  shop.add(banishTuning, 'start', 0, 10, 1).name('Banishes per run');
  shop.add(banishTuning, 'perShop', 0, 5, 1).name('Banishes per shop');
  shop.add(banishTuning, 'max', 0, 20, 1).name('Banish cap');
  shop.add({ b: () => (game.hero.banishLeft += 1) }, 'b').name('+1 banish');
  shop.add(cardNumTuning, 'maxLines', 1, 6, 1).name('Number lines per card');
  shop.add(previewTuning, 'dist', 0, 20, 0.5).name('Preview hit distance');
  shop.add(previewTuning, 'near', 0, 3.5, 0.1).name('Preview near distance');
  shop.add(previewTuning, 'far', 8, 30, 0.5).name('Preview far distance');

  const mods2 = gui.addFolder('Mods: ally & position').close();
  mods2.add(mods2Tuning, 'allyRadius', 2, 20, 1);
  mods2.add(mods2Tuning, 'reloadCap', 0, 0.5, 0.05);
  mods2.add(mods2Tuning, 'burnCritCap', 0, 0.5, 0.05);
  mods2.add(mods2Tuning, 'wallRadius', 0.5, 4, 0.5);

  const dir = gui.addFolder('Director').close();
  addDirector2Debug(dir, game);
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
  const families = ai.addFolder('Burrow / Mirror / Swarm').close();
  families.add(familyTuning, 'mirrorDamage', 0.1, 0.7, 0.05);
  families.add(familyTuning, 'mirrorMaxDamage', 2, 20, 1);
  families.add(familyTuning, 'queenAt', 0.6, 0.85, 0.01);
  families.add(familyTuning, 'queenCooldown', 4, 15, 0.5);
  families.add(familyTuning, 'eggHatch', 3, 12, 0.5);
  families.add(ENEMIES.burrower.burrow!, 'warn', 0.6, 2, 0.05).name('Digger warning');

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

  // Onboarding: training field (src/game/training.ts) and first-time tips.
  const halloween = gui.addFolder('Halloween').close();
  for (const key of ['dropEvery', 'pickupRadius', 'witchEvery', 'swarmEvery', 'seedCount', 'vineRadius', 'vineWarning', 'spinRadius', 'spinWarning'] as const) halloween.add(halloweenTuning, key, key === 'dropEvery' || key === 'seedCount' ? 1 : 0.1, 60, key === 'dropEvery' || key === 'seedCount' ? 1 : 0.1);

  const ob = gui.addFolder('Onboarding').close();
  ob.add({ go: () => game.onboarding.startTraining() }, 'go').name('Start training');
  ob.add({ skip: () => game.onboarding.advance() }, 'skip').name('Skip training step');
  ob.add(trainingTuning, 'moveDist', 2, 30, 1);
  ob.add(trainingTuning, 'shotEvery', 0.6, 4, 0.1).name('Shot every (s)');
  ob.add(trainingTuning, 'shotSpeed', 2, 20, 0.5);
  ob.add(trainingTuning, 'skipAfter', 0, 60, 1).name('SKIP shows after (s)');
  addFixesFolder(gui);
  addGameplayFolder(gui, game); // mech suits, crates, mutations, overload, cash-ins (gameplay lane)
  addTimeFolder(gui, game); // time lane: rewind, last stand, bullet time, replay (src/ui/debugTime.ts)
  addCoop2Folder(gui, game); // coop2 lane: drop-in, revive pool, roles, team ultimate, ghosts (src/ui/debugCoop2.ts)
  addCoopplayFolder(gui, game); // coopplay lane: co-op objectives, carry, tether, banter (src/ui/debugCoopplay.ts)
  addEightpFolder(gui); // eightp lane: 5-8 player scaling, framing, tags, LOD, teammate mix (src/ui/debugEightp.ts)
  addCinematicsFolder(gui, game); // cinematics lane: sky fall, ending, reveals, jackpot, flawless (src/ui/debugCinematics.ts)
  addMpFolder(gui, game); // MP lane: Versus Swarm, local co-op, lobby browser (src/ui/debugMp.ts)
  worldDebugFolder(gui, game); // biomes, crushers, wind, boss dressing, title demo (src/world/worldDebug.ts)
  addWorldEventsFolder(gui, game); // world events: start any now, force one, knobs (src/ui/debugWorldEvents.ts)
  const rf = gui.addFolder('Hydra raid').close();
  for (const key of ['weaponDamage','headHp','enrage','wipe','ghostDps','parryDamage','fireWarn','stumpSeconds'] as const) rf.add(raidTuning, key);
  const gf = gui.addFolder('Gauntlet / Boss Rush').close();
  gf.add(gauntletTuning, 'wave', 10, 90, 5);
  gf.add(gauntletTuning, 'mini', 30, 360, 30);
  gf.add(gauntletTuning, 'boss', 60, 720, 30);
  gf.add(gauntletTuning, 'aliveStart', 5, 60, 1);
  gf.add(gauntletTuning, 'alivePerWave', 1, 30, 1);
  gf.add(gauntletTuning, 'aliveCap', 50, 450, 10);
  gf.add(gauntletTuning, 'spawnRate', 4, 30, 1);
  gf.add(gauntletTuning, 'shopSeconds', 5, 60, 5);
  gf.add(gauntletTuning, 'attackEvery', 3, 20, 1);
  addModesFolder(gui, game); // rhythm stages, pacifist road, mini-games, ghosts (src/ui/debugModes.ts)
  addSound2Folder(gui, game); // sound lane 2: duel music, crowd, radio DJ, instruments, ears (src/ui/debugSound2.ts)

  // Companion lane: pets and co-op team moves.
  const comp = gui.addFolder('Pets & team moves').close();
  comp.add(petTuning, 'fetchMagnet', 0, 2, 0.05).name('Fetch range +');
  comp.add(petTuning, 'zapDmg', 0, 100, 1).name('Zap damage');
  comp.add(petTuning, 'zapPerLevel', 0, 20, 0.5).name('Zap per team lv');
  comp.add(petTuning, 'tauntMinEnemies', 1, 10, 1).name('Taunt min crowd');
  comp.add(petTuning, 'shieldMinFrac', 0, 1, 0.01).name('Shield min hit');
  comp.add(petTuning, 'reviveHp', 0.1, 1, 0.05).name('Revive life');
  comp.add(teamTuning, 'linkRange', 2, 15, 0.5).name('Team link range');
  comp.add(teamTuning, 'linkTime', 0, 5, 0.1).name('Team link time');
  comp.add(teamTuning, 'chargeTime', 2, 60, 1).name('Team charge (s)');
  comp.add(teamTuning, 'highFiveBonus', 0, 1, 0.05).name('High-five bonus');
  comp.add(teamTuning, 'dmg', 10, 400, 5).name('Team move damage');
  comp.add({ fill: () => (game.companionState().meter.charge = 1) }, 'fill').name('Fill TEAM meter');
  comp.add({ lv: () => game.heroes.forEach((h) => h.petState.levelUp() && h.recomputeStats()) }, 'lv').name('Pet level up');

  return gui;
}
