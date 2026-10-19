import { metaSkin } from '../data/codex';
import { MetaRun } from './systems/meta';
import * as THREE from 'three';
import type { Input } from '../core/input';
import { Rng, randomSeed } from '../core/rng';
import { SpatialHash, StaticBoxGrid } from '../core/spatialHash';
import { loadJson } from '../core/storage';
import { lap, lapStart } from '../core/prof';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import type { Tag } from '../data/tags';
import { SPECIALS } from '../data/specials';
import { WEAPONS } from '../data/weapons';
import { type Loadout } from '../data/loadout';
import { passiveTuning } from './stats';
import { isSpecialRunning, updateSpecials, type SpecialApi } from './specials';
import { NetClient, NetHost } from '../net/peer';
import { DamageNumbers } from '../ui/damageNumbers';
import { Hud, type LoadoutItem } from '../ui/hud';
import { Screens, type ShopView } from '../ui/screens';
import type { CardNum } from './cardNumbers';
import { createFieldArena, type Arena } from '../world/fieldArena';
import { Barrels } from './barrels';
import { Chests } from './chests';
import { BULLET_Y, Bullets, Team } from './bullets';
import { CameraRig } from './cameraRig';
import { Director } from './director';
import { Enemies, type Enemy, type EnemyCtx, type SpawnOpts } from './enemies';
import { Fx } from './fx';
import { HERO_COLORS, Hero, MAX_GEARS, type HeroWorld } from './hero';
import { Juice } from './juice';
import { Particles } from './particles';
import { PickupType, Pickups, type Collector } from './pickups';
import { Portal } from './portal';
import { markSeen, save, unlockedWeapons } from './save';
import { access, settings, saveSettings } from './settings';
import { Vfx } from './vfx';
import { type WeaponCtx } from './weapons';
import { Ambience } from './ambience';
import { Scars } from './scars';
import { streaks } from './streaks';
import { skinOf } from '../data/skins';
import { RunEvents } from './runEvents';
import { DIFF_BY_ID, MODE_BY_ID, type DifficultyDef, type ModeId } from '../data/modes';
import { heroOf } from '../data/heroes';
import { binds } from '../core/keybinds';
import { type HeroBuild } from './pvp';
import * as RunFlowSys from './systems/runFlow';
import * as DebugSys from './systems/debug';
import * as SpiceSys from './systems/spice';
import * as LevelUpsSys from './systems/levelUps';
import * as FusionSys from './systems/fusion';
import * as CoopSys from './systems/coop';
import * as SpawningSys from './systems/spawning';
import * as CombatSys from './systems/combat';
import * as StatusesSys from './systems/statuses';
import * as OnlineSys from './systems/online';
import * as PvpFlowSys from './systems/pvpFlow';
import * as NetHostSys from './systems/netHost';
import * as NetClientSys from './systems/netClient';
import * as RenderSys from './systems/render';
import * as EnemyAiSys from './systems/enemyAi';
import * as AnimSys from './systems/anim';
import * as LookSys from './systems/look';
import * as BossFightSys from './systems/bossFight';
import { BossField } from './bossField';
import { BossIntro } from './bossIntro';
import type { BossApi } from './bosses';
import type { BossDuel } from './bossDuel';
import * as ArenaSys from './systems/arena';
import { Interactives } from './interactives';
import { ObjectiveHud } from '../ui/objectiveHud';
import * as WorldFxSys from './systems/worldFx';
import * as SkySys from './systems/sky';
import * as SkillSys from './systems/skill';
import { Onboarding } from './onboarding';
import { weaponCue, windupCue } from './systems/sound';
import { soundLaneStep } from './systems/sound2';
import { rightClickHeld } from './chargeMode';
import * as BiomeFoesSys from './systems/biomeFoes';
import * as HeroMechsSys from './systems/heroMechs';
import * as AttractSys from './systems/attract';
import * as RouteSys from './systems/route';
import * as WindSys from './wind';
import * as CompanionSys from './systems/companion';
import * as CharSys from './systems/characters';
import * as GameplaySys from './systems/gameplay';
import * as WorldEventsSys from './systems/worldEvents';
import * as TimeSys from './systems/time';
import * as Coop2Sys from './systems/coop2';
import * as ModesSys from './systems/modes';
import * as CineSys from './systems/cinematics';
import * as VersusSys from './systems/versus';
import * as LocalCoopSys from './systems/localCoop';
import * as MpSys from './systems/mp';
import type { LobbyKind } from '../ui/screens';
import { portraits } from '../ui/portraits';

export { economyTuning } from './hero';

/** Stages per loop: every LOOP_STAGES-th stage ends with the final boss, then the biomes repeat, harder. */
export const LOOP_STAGES = 4;

export const scoreTuning = {
  victoryBonus: 50000, // x loop number, for beating the final boss
  levelUpHeal: 10, // life restored to every living hero on each level-up
  comboWindow: 2.0, // seconds a combo survives without a kill
  tiers: [0, 25, 75, 150, 300, 500, 800, 1200], // combo needed for x1..x8
  noHitBonus: 2000, // x stage, for clearing a stage without damage
};

export const bombTuning = {
  duration: 0.35,
  knockback: 18,
  bombletRadius: 2.6, // Cluster Bomb
  bombletDmg: 0.6, // x the bomb's damage, each
  pullDmg: 0.4, // Implosion: first wave (pulls in)
  pullKnock: 14,
  implodeDelay: 0.3,
  implodeDmg: 1.6, // Implosion: second wave
};

/** This machine's chosen hero, if unlocked. */
export function localHero(): string {
  const d = heroOf(settings.hero);
  return !d.unlock || save.achievements.includes(d.unlock) || cheats.unlockAll ? d.id : 'rookie';
}

/** Conveyor belt speed (m/s). */
export const CONVEYOR_SPEED = 4;

/** Chest pickup values from here up belong to one hero (OWNED_CHEST + hero index). */
export const OWNED_CHEST = 100;

export const dropTuning = {
  xpMul: 0.45, // XP gem value per enemy XP point (lower = slower levelling)
  goldChance: 0.003, // (was 0.009, then 0.005: too much gold, user) thinned with the horde like the utility drops, so income stays steady
  heartChance: 0.004,
  magnetChance: 0.0015,
  gearChance: 0.0012, // per kill, x(1 + 0.25 per Luck of the killer)
  nukeChance: 0.0006, // per kill: a full-screen wipe
  // Heart, magnet, gear and nuke chances are scaled by min(1, dropRef / enemies the
  // director wants alive), so drops per minute stay flat as hordes grow.
  dropRef: 70,
};

/** Treasure chests appear over the stage instead of all at the start. */
export const chestTuning = {
  every: 30, // seconds between new chests
  maxClosed: 4, // unopened chests on the map at once
};

/** The Nuke pickup: an expanding wave across the whole screen. */
export const nukeTuning = {
  radius: 48,
  duration: 0.8,
  bossHpFrac: 0.15, // bosses lose this share of max life instead of dying
};

/** Status effects and their combos. */
export const statusTuning = {
  burnTime: 3,
  shockTime: 2,
  shockMult: 0.2, // shocked enemies take +20% damage
  // Combo damage grows with team level (enemy HP grows ~6-9x by stage 4; flat numbers fell off).
  shatterDamage: 12,
  shatterPerLevel: 2,
  overloadDamage: 20,
  overloadPerLevel: 3,
  napalmDps: 5,
  napalmPerLevel: 1,
  // Right-click hits Expose: everyone's hits on that enemy deal more for a while (user: the right click got ignored).
  exposeTime: 4,
  exposeMult: 0.3,
};

/** Dev cheats: `god` ignores damage; `unlockAll` lets test links use locked loadout items. */
export const cheats = { god: false, unlockAll: false };

export type Mode = 'title' | 'fight' | 'levelup' | 'shop' | 'cleared' | 'portal' | 'transition' | 'dead';
export type Role = 'solo' | 'host' | 'client';

export const AIM_HEIGHT = BULLET_Y;
export const TITLE_SEED = 1234;
export const RECYCLE_DIST = 36;
export const CHARGE_TAGS: Tag[] = ['projectile'];
/** Player bullet `kind` -> damage source and tags (see BulletSpawn.kind). */
export const BULLET_KINDS: { source: string; tags?: Tag[] }[] = [
  { source: 'buster' },
  { source: 'charge', tags: CHARGE_TAGS },
  { source: 'scatter' },
  { source: 'scatter', tags: ['projectile', 'fire'] },
  { source: 'shield', tags: ['projectile'] },
  { source: 'scatter', tags: ['projectile', 'explosive'] }, // 5 Flak Cannon
  { source: 'buster', tags: ['projectile', 'fire'] }, // 6 Flare Buster
  { source: 'buster', tags: ['projectile', 'shock'] }, // 7 Volt Buster
  { source: 'charge', tags: ['projectile', 'fire'] }, // 8 Star Cannon
  { source: 'charge', tags: ['projectile', 'shock'] }, // 9 Lance Shot
  { source: 'pellets' }, // 10 Pellet Turret (auto weapon)
  { source: 'pellets', tags: ['projectile', 'fire'] }, // 11 Scorch Turret
  { source: 'turret', tags: ['projectile'] }, // 12 arena turrets (src/game/systems/arena.ts)
  { source: 'parry', tags: ['projectile'] }, // 13 bullets reflected by a parry
  { source: 'ult', tags: [] }, // 14 Mega Barrage shots
  { source: 'dragon_cannon', tags: ['projectile', 'fire', 'trail'] }, // 15 Dragon Cannon (fusion, src/data/fusions.ts)
];
/** Bullet kinds that burst on their first hit: full-charge shots, Flak Cannon pellets and Star Cannon stars. */
export const IMPACT_BLAST = [1, 5, 8];
export const SNAP_EVERY = 3; // host snapshot every N sim steps (20 Hz)
export const INPUT_EVERY = 2; // client input every N sim steps (30 Hz)
export const INTEREST = 50; // only send entities this close to each client's hero (wide enough for a zoomed-out camera)
export const REVIVE_TIME = 3;
export const REVIVE_RANGE = 2.4;

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  const l = level - 1;
  return Math.round(6 + 8 * l + 1.4 * l * l);
}

/** PvP match state on this machine (see src/game/pvp.ts). Builds and progress are keyed by peer id ('' = host). */
export interface PvpState {
  /** stage: playing your own stage; wait: done, waiting for the others; duel: the fight; over: someone won. */
  phase: 'stage' | 'wait' | 'duel' | 'over';
  /** The online role to come back to for the duel. */
  net: 'host' | 'client';
  seed: number;
  ready: Map<string, HeroBuild>;
  progress: Map<string, string>;
  /** Stand-in enemy per hero index, pending hero damage per hero index and who hit them last. */
  proxies: Enemy[];
  acc: number[];
  lastHit: number[];
  zoneR: number;
  zoneT: number;
  zoneTick: number;
}

export const PVP_WAIT_NOTE = 'Everyone plays their own stage first. The duel starts when all are done:';

/** "2:31" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface LobbyEntry {
  peerId: string; // '' = host
  name: string;
  unlocked: string[];
  skin: string;
  pet: string;
  hero: string;
  loadout: Loadout;
  /** CUSTOMISE code (src/data/customise.ts), checked with cleanLook. */
  look?: string;
  /** Stable player id from the client's `hello` (coop2: reclaiming a hero after a drop). */
  pid?: string;
}

/** "Scattergun / Grenade Lobber / Bomb" for the lobby list. */
export function kitText(l: Loadout): string {
  return `${WEAPONS[l.primary]?.name} / ${WEAPONS[l.secondary]?.name} / ${SPECIALS[l.special]?.name}`;
}

/** Shop view sent over the network (Mods referenced by id). */
export interface NetShop {
  pre?: boolean;
  gold: number;
  interest: number;
  interestCap: number;
  interestPer: number;
  offers: ({ id: string; price: number; hint: string; locked?: boolean; nums?: CardNum[] } | null)[];
  owned: { id: string; sell: number; readout: string; level: number; maxLevel: number; upCost: number }[];
  slots: number;
  preview?: ShopView['preview'];
  rerollCost: number;
  healCost: number;
  healed: boolean;
  loadout: LoadoutItem[];
  stage: number;
  curse: ShopView['curse'];
  secret: boolean;
  relicOffers: ShopView['relicOffers'];
  relics: string[];
}

export function playerName(): string {
  return loadJson<{ name: string }>('profile', { name: '' }).name || 'Player';
}

/**
 * Owns the whole session: menus, the current run and every gameplay system.
 * Supports 1-4 heroes. Solo and online hosts simulate everything; online
 * clients move their own hero locally and mirror the host's snapshots.
 *   title -> fight (timer, level-ups) -> boss -> cleared -> shop -> portal -> transition -> fight ...
 *   everyone down -> dead -> (retry | title)
 */
export class Game implements HeroWorld {
  // Methods that live in src/game/systems/ (see the header of each file).
  updateWind = WindSys.updateWind;
  // Mid-stage world events and Night Raid stealth stages (src/game/systems/worldEvents.ts).
  updateWorldEvent = WorldEventsSys.updateWorldEvent;
  worldEventNet = WorldEventsSys.worldEventNet;
  worldEventLive = WorldEventsSys.worldEventLive;
  applyWorldEventNet = WorldEventsSys.applyWorldEventNet;
  worldEventLocal = WorldEventsSys.worldEventLocal;
  renderWorldEvent = WorldEventsSys.renderWorldEvent;
  clearWorld = RunFlowSys.clearWorld;
  loadArena = RunFlowSys.loadArena;
  spawnSpot = RunFlowSys.spawnSpot;
  goTitle = RunFlowSys.goTitle;
  leaveToTitle = RunFlowSys.leaveToTitle;
  startSolo = RunFlowSys.startSolo;
  pickDifficulty = RunFlowSys.pickDifficulty;
  startRun = RunFlowSys.startRun;
  restart = RunFlowSys.restart;
  retry = RunFlowSys.retry;
  stageSub = RunFlowSys.stageSub;
  loadStage = RunFlowSys.loadStage;
  pause = RunFlowSys.pause;
  resume = RunFlowSys.resume;
  quitRun = RunFlowSys.quitRun;
  summary = RunFlowSys.summary;
  bankAndShow = RunFlowSys.bankAndShow;
  endRun = RunFlowSys.endRun;
  checkAchievements = RunFlowSys.checkAchievements;
  debugLevelUp = DebugSys.debugLevelUp;
  guardMul = EnemyAiSys.guardMul;
  spawnSquad = EnemyAiSys.spawnSquad;
  spawnGolden = EnemyAiSys.spawnGolden;
  onEnemyKilled = EnemyAiSys.onEnemyKilled;
  debugGiveWeapon = DebugSys.debugGiveWeapon;
  debugSpawnElite = DebugSys.debugSpawnElite;
  debugSkipToBoss = DebugSys.debugSkipToBoss;
  debugGiveMod = DebugSys.debugGiveMod;
  debugAddGold = DebugSys.debugAddGold;
  curseSum = SpiceSys.curseSum;
  pauseInfo = SpiceSys.pauseInfo;
  takeCurse = SpiceSys.takeCurse;
  grantRelics = SpiceSys.grantRelics;
  makeEventHost = SpiceSys.makeEventHost;
  spiceLines = SpiceSys.spiceLines;
  goldFx = SpiceSys.goldFx;
  stageClear = SpiceSys.stageClear;
  openShop = SpiceSys.openShop;
  shopFx = SpiceSys.shopFx;
  closeShop = SpiceSys.closeShop;
  endlessNextWave = SpiceSys.endlessNextWave;
  bossRushStage = SpiceSys.bossRushStage;
  openPortal = SpiceSys.openPortal;
  portalSpot = SpiceSys.portalSpot;
  gainXp = LevelUpsSys.gainXp;
  openLevelUp = LevelUpsSys.openLevelUp;
  presentLevelUp = LevelUpsSys.presentLevelUp;
  presentWait = LevelUpsSys.presentWait;
  presentShop = LevelUpsSys.presentShop;
  tell = LevelUpsSys.tell;
  ui = LevelUpsSys.ui;
  heroAction = LevelUpsSys.heroAction;
  evolveFx = LevelUpsSys.evolveFx;
  fusionFx = FusionSys.fusionFx;
  legendaryFx = LevelUpsSys.legendaryFx;
  legendaryBurst = LevelUpsSys.legendaryBurst;
  afterPick = LevelUpsSys.afterPick;
  reviveHero = CoopSys.reviveHero;
  updateRevives = CoopSys.updateRevives;
  ringPoint = SpawningSys.ringPoint;
  spawnEnemy = SpawningSys.spawnEnemy;
  rollEliteMod = SpawningSys.rollEliteMod;
  spawnRing = SpawningSys.spawnRing;
  spawnBoss = SpawningSys.spawnBoss;
  recycleFarEnemies = SpawningSys.recycleFarEnemies;
  nearestEnemy = CombatSys.nearestEnemy;
  enemiesInRadius = CombatSys.enemiesInRadius;
  damage = CombatSys.damage;
  updatePets = CompanionSys.updatePets;
  updateEliteMods = CombatSys.updateEliteMods;
  groundAt = CombatSys.groundAt;
  updateHazards = CombatSys.updateHazards;
  deathFx = CombatSys.deathFx;
  updateBossBoom = CombatSys.updateBossBoom;
  breakShield = CombatSys.breakShield;
  ignite = StatusesSys.ignite;
  expose = StatusesSys.expose;
  shock = StatusesSys.shock;
  overload = StatusesSys.overload;
  shatter = StatusesSys.shatter;
  zap = StatusesSys.zap;
  updateStatuses = StatusesSys.updateStatuses;
  sourceName = StatusesSys.sourceName;
  killEnemy = StatusesSys.killEnemy;
  blast = StatusesSys.blast;
  explodeBarrel = StatusesSys.explodeBarrel;
  removeBarrelCollider = StatusesSys.removeBarrelCollider;
  detonate = StatusesSys.detonate;
  updateStrikes = StatusesSys.updateStrikes;
  bossSlam = StatusesSys.bossSlam;
  contactDamage = StatusesSys.contactDamage;
  hurtHero = StatusesSys.hurtHero;
  onHeroDown = StatusesSys.onHeroDown;
  collect = StatusesSys.collect;
  updateBullets = StatusesSys.updateBullets;
  updateChests = StatusesSys.updateChests;
  updateChestSpawns = StatusesSys.updateChestSpawns;
  openChest = StatusesSys.openChest;
  bulletBlast = StatusesSys.bulletBlast;
  makeSpecialApi = StatusesSys.makeSpecialApi;
  tryBomb = StatusesSys.tryBomb;
  startBombWave = StatusesSys.startBombWave;
  updateBomblets = StatusesSys.updateBomblets;
  nuke = StatusesSys.nuke;
  updateBomb = StatusesSys.updateBomb;
  hostGame = OnlineSys.hostGame;
  refreshLobby = OnlineSys.refreshLobby;
  lobbyDifficulty = OnlineSys.lobbyDifficulty;
  hostStart = OnlineSys.hostStart;
  joinGame = OnlineSys.joinGame;
  onLoadoutChanged = OnlineSys.onLoadoutChanged;
  pvpBegin = PvpFlowSys.pvpBegin;
  pvpStageDone = PvpFlowSys.pvpStageDone;
  pvpTick = PvpFlowSys.pvpTick;
  pvpCheckReady = PvpFlowSys.pvpCheckReady;
  pvpStartDuel = PvpFlowSys.pvpStartDuel;
  pvpHit = PvpFlowSys.pvpHit;
  updateDuel = PvpFlowSys.updateDuel;
  pvpCheckWinner = PvpFlowSys.pvpCheckWinner;
  pvpOver = PvpFlowSys.pvpOver;
  saveName = PvpFlowSys.saveName;
  heroByPeer = NetHostSys.heroByPeer;
  onHostMessage = NetHostSys.onHostMessage;
  onClientLeft = NetHostSys.onClientLeft;
  hostTick = NetHostSys.hostTick;
  buildSnapshot = NetHostSys.buildSnapshot;
  onClientMessage = NetClientSys.onClientMessage;
  shopFromNet = NetClientSys.shopFromNet;
  clientStart = NetClientSys.clientStart;
  clientStage = NetClientSys.clientStage;
  clientUpdate = NetClientSys.clientUpdate;
  applySnapshot = NetClientSys.applySnapshot;
  syncWeapons = NetClientSys.syncWeapons;
  eliteTrails = RenderSys.eliteTrails;
  spectateTarget = RenderSys.spectateTarget;
  coopInput = RenderSys.coopInput;
  ping = RenderSys.ping;
  refreshGlobal = RenderSys.refreshGlobal;
  updateSky = RenderSys.updateSky;
  updateMusic = RenderSys.updateMusic;
  localAudio = RenderSys.localAudio;
  render = RenderSys.render;
  renderMuzzleFlashes = RenderSys.renderMuzzleFlashes;
  renderChestPointer = RenderSys.renderChestPointer;
  renderMinimap = RenderSys.renderMinimap;
  renderEliteBars = RenderSys.renderEliteBars;
  renderTeam = RenderSys.renderTeam;
  cameraDirector = AnimSys.cameraDirector;
  onCorpse = AnimSys.onCorpse;
  // Boss finishers and character portraits (src/game/systems/characters.ts).
  finisherCatch = CharSys.finisherCatch;
  finisherHold = CharSys.finisherHold;
  onFinisher = CharSys.onFinisher;
  renderCharacters = CharSys.renderCharacters;
  resolveSpeaker = CharSys.resolveSpeaker;
  pingPortrait = CharSys.pingPortrait;
  updateLook = LookSys.updateLook;
  makeBossApi = BossFightSys.makeBossApi;
  bossHpGate = BossFightSys.bossHpGate;
  startBossIntro = BossFightSys.startBossIntro;
  skipBossIntro = BossFightSys.skipBossIntro;
  updateBossFight = BossFightSys.updateBossFight;
  updateMiniBoss = BossFightSys.updateMiniBoss;
  bossNet = BossFightSys.bossNet;
  applyBossNet = BossFightSys.applyBossNet;
  renderBossFight = BossFightSys.renderBossFight;
  bossHud = BossFightSys.bossHud;
  routeReset = RouteSys.routeReset;
  routeKind = RouteSys.routeKind;
  routeMod = RouteSys.routeMod;
  routeSecretShop = RouteSys.routeSecretShop;
  routeStageStart = RouteSys.routeStageStart;
  routeChest = RouteSys.routeChest;
  routeGears = RouteSys.routeGears;
  updateRoute = RouteSys.updateRoute;
  routeClearRewards = RouteSys.routeClearRewards;
  openRoute = RouteSys.openRoute;
  routeBeginVote = RouteSys.routeBeginVote;
  routePick = RouteSys.routePick;
  routeVote = RouteSys.routeVote;
  routeOptionCount = RouteSys.routeOptionCount;
  routeDecide = RouteSys.routeDecide;
  routeAdvance = RouteSys.routeAdvance;
  closeRoute = RouteSys.closeRoute;
  routeRest = RouteSys.routeRest;
  routeEventEffect = RouteSys.routeEventEffect;
  routeShow = RouteSys.routeShow;
  routeViewFrom = RouteSys.routeViewFrom;
  routeFromNet = RouteSys.routeFromNet;
  routeTestEvent = RouteSys.routeTestEvent;
  /** Route map between stages (systems/route.ts); clients keep their own pending vote and the last phase seen. */
  route: RouteSys.RouteRun = RouteSys.newRouteRun();
  routeLocalVote = -1;
  routeNetPhase = '';
  debugBoss = BossFightSys.debugBoss;
  // Arena toys, hazards and objectives (src/game/systems/arena.ts).
  loadToys = ArenaSys.loadToys;
  updateArena = ArenaSys.updateArena;
  arenaMoveHero = ArenaSys.arenaMoveHero;
  startJump = ArenaSys.startJump;
  arenaJumpMsg = ArenaSys.arenaJumpMsg;
  landShock = ArenaSys.landShock;
  updateTurrets = ArenaSys.updateTurrets;
  updateEnvHazards = ArenaSys.updateEnvHazards;
  envHit = ArenaSys.envHit;
  onEnvKill = ArenaSys.onEnvKill;
  hitToys = ArenaSys.hitToys;
  hitToysWhere = ArenaSys.hitToysWhere;
  blastToys = ArenaSys.blastToys;
  damageProp = ArenaSys.damageProp;
  damageTotem = ArenaSys.damageTotem;
  updatePillars = ArenaSys.updatePillars;
  updateObjective = ArenaSys.updateObjective;
  completeObjective = ArenaSys.completeObjective;
  arenaLocal = ArenaSys.arenaLocal;
  arenaNet = ArenaSys.arenaNet;
  arenaSetNet = ArenaSys.arenaSetNet;
  renderArena = ArenaSys.renderArena;
  objectiveTarget = ArenaSys.objectiveTarget;
  worldFx = WorldFxSys.worldFx;
  updateSkyFx = SkySys.updateSkyFx;
  skillInput = SkillSys.skillInput;
  skillClientInput = SkillSys.skillClientInput;
  skillMessage = SkillSys.skillMessage;
  skillDash = SkillSys.skillDash;
  perfectDash = SkillSys.perfectDash;
  tryParry = SkillSys.tryParry;
  tryUlt = SkillSys.tryUlt;
  updateSkill = SkillSys.updateSkill;
  weaponFeel = SkillSys.weaponFeel;
  muzzleScale = SkillSys.muzzleScale;
  skillHit = SkillSys.skillHit;
  skillKill = SkillSys.skillKill;
  skillHurt = SkillSys.skillHurt;
  styleScoreMul = SkillSys.styleScoreMul;
  styleXpMul = SkillSys.styleXpMul;
  skillNet = SkillSys.skillNet;
  applySkillNet = SkillSys.applySkillNet;
  renderSkill = SkillSys.renderSkill;
  snowballCrash = BiomeFoesSys.snowballCrash;
  kiteGust = BiomeFoesSys.kiteGust;
  updateBiomeFoes = BiomeFoesSys.updateBiomeFoes;
  biomeFoesClient = BiomeFoesSys.biomeFoesClient;
  updateHeroMechs = HeroMechsSys.updateHeroMechs;
  onParryLanded = HeroMechsSys.onParryLanded;
  heroMechNet = HeroMechsSys.heroMechNet;
  applyHeroMechNet = HeroMechsSys.applyHeroMechNet;
  renderHeroMechs = HeroMechsSys.renderHeroMechs;
  heroMechAchievements = HeroMechsSys.heroMechAchievements;
  bestStyle = SkillSys.bestStyle;
  // Title attract mode (src/game/systems/attract.ts).
  attractTick = AttractSys.attractTick;
  // Companion: growing pets, TEAM meter and team moves, high-five revives (src/game/systems/companion.ts).
  companionState = CompanionSys.companionState;
  companionTargets = CompanionSys.companionTargets;
  companionStageClear = CompanionSys.companionStageClear;
  petGrowth = CompanionSys.petGrowth;
  petShield = CompanionSys.petShield;
  petRevive = CompanionSys.petRevive;
  highFive = CompanionSys.highFive;
  updateCompanion = CompanionSys.updateCompanion;
  companionClientInput = CompanionSys.companionClientInput;
  tryTeamMove = CompanionSys.tryTeamMove;
  companionNet = CompanionSys.companionNet;
  applyCompanionNet = CompanionSys.applyCompanionNet;
  renderCompanion = CompanionSys.renderCompanion;
  // Gameplay lane: mech suits, supply crates, rule relics, mutations, overload, cash-ins, finale, comeback (systems/gameplay.ts).
  gameplayPreWeapons = GameplaySys.gameplayPreWeapons;
  updateGameplay = GameplaySys.updateGameplay;
  gpOnDash = GameplaySys.gpOnDash;
  gpOnKill = GameplaySys.gpOnKill;
  gpFinale = GameplaySys.gpFinale;
  gpCashIn = GameplaySys.gpCashIn;
  gpHeroNet = GameplaySys.gpHeroNet;
  applyGpHeroNet = GameplaySys.applyGpHeroNet;
  gameplayNet = GameplaySys.gameplayNet;
  applyGameplayNet = GameplaySys.applyGameplayNet;
  gameplayClientInput = GameplaySys.gameplayClientInput;
  renderGameplay = GameplaySys.renderGameplay;
  // Time: rewind, last stand, bullet-time dodges, death replay, clutch revives (src/game/systems/time.ts).
  timeStep = TimeSys.timeStep;
  requestRewind = TimeSys.requestRewind;
  lastStand = TimeSys.lastStand;
  timeKill = TimeSys.timeKill;
  clutchRevive = TimeSys.clutchRevive;
  timeMessage = TimeSys.timeMessage;
  timeNet = TimeSys.timeNet;
  applyTimeNet = TimeSys.applyTimeNet;
  renderTime = TimeSys.renderTime;
  // Co-op wave 2: drop-in/drop-out, revive pool, roles, team ultimate, emotes, help ghosts (src/game/systems/coop2.ts).
  coop2Step = Coop2Sys.coop2Step;
  coopHello = Coop2Sys.coopHello;
  coopLeft = Coop2Sys.coopLeft;
  coopMessage = Coop2Sys.coopMessage;
  coopRoleStats = Coop2Sys.coopRoleStats;
  coopPoolSave = Coop2Sys.coopPoolSave;
  coopEmote = Coop2Sys.coopEmote;
  coopNet = Coop2Sys.coopNet;
  applyCoopNet = Coop2Sys.applyCoopNet;
  coopClientMsg = Coop2Sys.coopClientMsg;
  coopLobby = Coop2Sys.coopLobby;
  renderCoop2 = Coop2Sys.renderCoop2;
  // Modes lane: rhythm stages, the Pacifist road, bonus mini-games, weekly ghost races (src/game/systems/modes.ts).
  modes: ModesSys.ModesRun = ModesSys.newModesRun();
  modesStageStart = ModesSys.modesStageStart;
  modesTick = ModesSys.modesTick;
  modesPreWeapons = ModesSys.modesPreWeapons;
  updateModes = ModesSys.updateModes;
  modesOnKill = ModesSys.modesOnKill;
  modesOffers = ModesSys.modesOffers;
  modesHolster = ModesSys.modesHolster;
  modesArcade = ModesSys.modesArcade;
  startMiniGame = ModesSys.startMiniGame;
  modesNet = ModesSys.modesNet;
  applyModesNet = ModesSys.applyModesNet;
  modesLocal = ModesSys.modesLocal;
  modesRunEnd = ModesSys.modesRunEnd;
  renderModes = ModesSys.renderModes;
  // Cinematics: sky-fall transition, ending, legendary reveal, jackpot chest, flawless reward (src/game/systems/cinematics.ts).
  cineStep = CineSys.cineStep;
  skyfallTransition = CineSys.skyfallTransition;
  jackpotRoll = CineSys.jackpotRoll;
  onCine = CineSys.onCine;
  cineNet = CineSys.cineNet;
  applyCineNet = CineSys.applyCineNet;
  renderCinematics = CineSys.renderCinematics;
  // MP lane: Versus Swarm, local co-op, lobby browser, weekly team board (systems/versus.ts, localCoop.ts, mp.ts).
  versusBegin = VersusSys.versusBegin;
  versusSolo = VersusSys.versusSolo;
  versusWorld = VersusSys.versusWorld;
  versusReqs = VersusSys.versusReqs;
  versusStep = VersusSys.versusStep;
  versusCommand = VersusSys.versusCommand;
  versusHostMessage = VersusSys.versusHostMessage;
  versusNet = VersusSys.versusNet;
  applyVersusNet = VersusSys.applyVersusNet;
  localCoopStart = LocalCoopSys.localCoopStart;
  localHeroUpdate = LocalCoopSys.localHeroUpdate;
  mpTick = MpSys.mpTick;
  mpFrame = MpSys.mpFrame;
  mpReset = MpSys.mpReset;
  mpLobbyExtra = MpSys.mpLobbyExtra;
  mpClientMessage = MpSys.mpClientMessage;
  mpRunBanked = MpSys.mpRunBanked;
  /** Versus Swarm match (null outside one) and shared-screen local co-op run (null outside one). */
  versus: VersusSys.VersusRun | null = null;
  localCoop: LocalCoopSys.LocalCoopRun | null = null;

  readonly scene = new THREE.Scene();
  arena: Arena;
  readonly enemies: Enemies;
  readonly bullets: Bullets;
  readonly particles: Particles;
  readonly fx: Fx;
  readonly portal: Portal;
  readonly barrels: Barrels;
  readonly chests: Chests;
  readonly pickups: Pickups;
  readonly juice = new Juice();
  readonly cam: CameraRig;
  readonly director = new Director();
  readonly vfx: Vfx;
  /** Arena toys and the stage objective (src/game/interactives.ts). */
  readonly toys = new Interactives(this.scene);
  readonly objHud = new ObjectiveHud();

  heroes: Hero[] = [];
  /** Index of the hero this machine controls. */
  local = 0;
  role: Role = 'solo';
  host: NetHost | null = null;
  client: NetClient | null = null;
  lobby: LobbyEntry[] = [];

  mode: Mode = 'title';
  paused = false;
  /** Photo mode (src/ui/photoMode.ts, set by main.ts): while active it gets the input instead of the game. */
  photo: { active: boolean; update(dt: number): void } | null = null;

  // --- Team run state ---
  seed = 0;
  stage = 1;
  score = 0;
  kills = 0;
  combo = 0;
  maxCombo = 0;
  runTime = 0;
  level = 1;
  xp = 0;
  xpNext = xpForLevel(1);
  rng = new Rng(randomSeed());
  overloads = 0;
  elitesRun = 0;
  readonly scars: Scars;
  readonly ambience: Ambience;
  /** Boss death: simulation runs slowed while a chain of explosions plays. */
  slowMoT = 0;
  bossBoom: { x: number; z: number; r: number; n: number; t: number; color: string } | null = null;
  trailT = 0;
  /** Co-op: index of the teammate the camera follows while you're downed (-1 = auto). */
  spectate = -1;
  readonly runEvents: RunEvents;
  /** Mode and difficulty of the current run. */
  meta = new MetaRun();
  get shopPriceMul(): number { return this.meta.has('shop') ? 1.5 : 1; }
  runMode: ModeId = 'standard';
  difficulty: DifficultyDef = DIFF_BY_ID.normal;
  runDate = '';
  /** This shop visit is the rare secret merchant. */
  secretShop = false;
  /** Curses in effect for the whole team (src/data/curses.ts). */
  curses: string[] = [];
  netEvent: [string, number] | null = null;
  netChallenge: [string, number, number, boolean] | null = null;
  netBuffs: [number, number] = [0, 0];
  dayK = 0;
  /** Stage whose biome the loaded arena uses (Endless keeps one arena). */
  arenaStage = 1;
  fogK = 0;
  heartT = 0;
  bossesRun = 0;
  /** Seconds toward the next treasure chest. */
  chestT = 0;
  /** Final bosses beaten this run (one per loop). */
  victories = 0;
  newAchievements: string[] = [];
  boss: Enemy | null = null;
  comboT = 0;
  damagedThisStage = false;
  resumeMode: Mode = 'fight';
  modeT = 0;
  gameOverShown = false;
  stageLoaded = false;
  animTime = 0;
  recycleT = 0;
  stepN = 0;

  // --- Client mirror state ---
  netEnemies = new Map<number, Enemy>();
  snapTime = 0;
  snapInterval = 50;
  netTimeLeft = 0;
  netBoss: { name: string; hp01: number } | null = null;
  netMods: { id: string; ro: string; lv?: number }[] = [];
  netCombo01 = 0;
  fadeT = 0;

  walls: StaticBoxGrid;
  hash = new SpatialHash<Enemy>(2);
  dmg: DamageNumbers;
  hud: Hud;
  readonly screens: Screens;
  /** Training field, first-time tips, codex discovery, run recap (src/game/onboarding.ts). */
  readonly onboarding: Onboarding;
  flashes: THREE.Mesh[] = [];
  enemyCtx: EnemyCtx;
  targets: { x: number; z: number; radius: number; alive: boolean }[] = [];
  collectors: Collector[] = [];

  // Scratch objects (no per-frame allocation)
  raycaster = new THREE.Raycaster();
  aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_HEIGHT);
  ndc = new THREE.Vector2();
  readonly aimHit = new THREE.Vector3();
  playerPos = new THREE.Vector3();
  lead = new THREE.Vector3();
  shake = { x: 0, z: 0 };
  mz = { x: 0, z: 0 };
  tmp = new THREE.Vector3();
  scratch: Enemy[] = [];
  /** Boss arena state and drawing, entrance cinematic, boss move hooks (systems/bossFight.ts). */
  bossField!: BossField;
  bossIntro!: BossIntro;
  bossApi: BossApi = this.makeBossApi();
  /** Host: uid of the boss whose entrance plays, and seconds of it left (sent to clients). */
  introUid = 0;
  introLeft = 0;
  /** What the Q/E specials (other than the Bomb) may touch; see specials.ts. */
  specialApi: SpecialApi = this.makeSpecialApi();
  /** The free starting shop before stage 1 is open (its gold is not kept). */
  preShop = false;
  /** PvP match in progress (null outside PvP). */
  pvp: PvpState | null = null;
  /** The online lobby's game type, picked by the host. */
  lobbyKind: LobbyKind = 'coop';
  /** The name this machine hosted or joined with (the saved name is shared by every tab on a PC). */
  netName = '';
  /** Last EXPOSED popup (run time), so a crowd doesn't spam it. */
  exposeTextT = -1;
  shownCharge = 0;
  lastReady = 1;
  readyFlashT = 0;
  /** Telegraphed ground strikes (Hive Queen) counting down. */
  /** Telegraphed ground strikes; `foe` > 0 also blasts enemies (meteors). */
  strikes: { x: number; z: number; r: number; t: number; dmg: number; foe?: number; cause?: string }[] = [];
  /**
   * Boss duel (src/game/bossDuel.ts): non-null on every machine while a stage boss's
   * last phase plays as a one-on-one inside a closing ring of fire; `t` = seconds
   * since it began. The music can switch to a call-and-response duel while it's set.
   */
  bossDuel: BossDuel | null = null;

  constructor(
    readonly input: Input,
    aspect: number,
    hudRoot: HTMLElement,
    readonly reticle: HTMLElement,
  ) {
    this.arena = createFieldArena(TITLE_SEED);
    this.scene.add(this.arena.group);
    this.walls = new StaticBoxGrid(this.arena.colliders);
    this.enemies = new Enemies(this.scene);
    this.bullets = new Bullets(this.scene);
    this.particles = new Particles(this.scene);
    this.fx = new Fx(this.scene);
    this.scars = new Scars(this.scene);
    this.ambience = new Ambience(this.scene);
    streaks.attach(this.scene);
    this.portal = new Portal(this.scene);
    this.barrels = new Barrels(this.scene);
    this.barrels.load(this.arena);
    this.chests = new Chests(this.scene);
    this.chests.clear();
    this.pickups = new Pickups(this.scene);
    this.cam = new CameraRig(aspect);
    this.dmg = new DamageNumbers(hudRoot);
    this.dmg.localHero = () => this.hero?.index ?? 0;
    this.hud = new Hud(hudRoot);
    this.bossField = new BossField(this.scene);
    this.bossIntro = new BossIntro(hudRoot);
    this.bossIntro.onSkip = () => this.skipBossIntro();
    this.vfx = new Vfx({
      fx: this.fx,
      particles: this.particles,
      dmg: this.dmg,
      juice: this.juice,
      hud: this.hud,
      zones: this.enemies.zones,
      scars: this.scars,
      corpse: (id, x, y, z, s, f, dx, dz) => this.onCorpse(id, x, y, z, s, f, dx, dz),
      finisher: (id, hi, x, z) => this.onFinisher(id, hi, x, z),
      portrait: (who, ex, text, sec) => portraits.popIn(who, ex as Parameters<typeof portraits.popIn>[1], text, sec),
      cine: (kind, hero, x, z, data) => this.onCine(kind, hero, x, z, data),
      listener: () => this.heroes[this.local]?.player ?? { x: 0, z: 0 },
    });
    this.screens = new Screens(hudRoot, {
      start: () => this.startSolo(),
      loadoutChanged: () => this.onLoadoutChanged(),
      resume: () => this.resume(),
      quit: () => this.quitRun(),
      retry: () => this.retry(),
      title: () => this.leaveToTitle(),
      pick: (i) => this.ui('pick', i),
      reroll: () => this.ui('reroll'),
      skip: () => this.ui('skip'),
      buy: (i) => this.ui('buy', i),
      sell: (i) => this.ui('sell', i),
      moveMod: (i, d) => this.ui('move', i, d),
      upgradeMod: (i) => this.ui('mup', i),
      shopReroll: () => this.ui('sreroll'),
      shopHeal: () => this.ui('heal'),
      shopDone: () => this.ui('done'),
      online: () => this.screens.showOnline(playerName()),
      mpHost: (name) => void this.hostGame(name),
      mpJoin: (name, code) => void this.joinGame(name, code),
      mpStart: () => this.hostStart(),
      mpLeave: () => this.leaveToTitle(),
      mpDifficulty: (id) => {
        settings.difficulty = id;
        saveSettings();
        this.refreshLobby();
      },
      mpKind: (kind) => {
        this.lobbyKind = kind;
        this.refreshLobby();
      },
      skinChanged: () => this.applyLocalSkin(),
      takeCurse: () => this.ui('curse'),
      lockOffer: (i) => this.ui('slock', i),
      buyRelic: (i) => this.ui('relic', i),
    });
    window.addEventListener('keydown', (e) => {
      if (binds.autofire.includes(e.code) && this.isCombatMode && !this.paused && this.screens.current === 'none') {
        settings.autoFire = !settings.autoFire;
        saveSettings();
        this.hud.toast(settings.autoFire ? 'AUTO-FIRE ON' : 'AUTO-FIRE OFF');
      }
    });
    // Mouse wheel zooms the camera out (in-game only; menus keep their scrolling).
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.screens.current === 'none' && e.deltaY !== 0) this.cam.wheel(Math.sign(e.deltaY));
      },
      { passive: true },
    );
    this.hud.onPause = () => this.pause();
    this.onboarding = new Onboarding(this, hudRoot);
    this.screens.onRoutePick = (i) => this.routePick(i);
    this.enemyCtx = this.makeEnemyCtx();
    this.runEvents = new RunEvents(this.makeEventHost());
    MpSys.installMp(this, hudRoot);
    this.heroes = [this.makeHero(0, playerName(), unlockedWeapons())];
    this.goTitle();
  }

  // ------------------------------------------------------------------ accessors

  /** This machine's hero. */
  get coop(): boolean {
    return this.heroes.filter((h) => !h.left).length > 1;
  }

  get hero(): Hero {
    return this.heroes[this.local];
  }
  get player() {
    return this.hero.player;
  }
  get online(): boolean {
    return this.role !== 'solo';
  }
  get authority(): boolean {
    return this.role !== 'client';
  }
  autoFireToggle(): void {
    settings.autoFire = !settings.autoFire;
    saveSettings();
  }
  get autoFire(): boolean {
    return settings.autoFire;
  }
  set autoFire(v: boolean) {
    settings.autoFire = v;
    saveSettings();
  }

  get isCombatMode(): boolean {
    return this.mode === 'fight' || this.mode === 'cleared' || this.mode === 'portal';
  }

  get multiplier(): number {
    const t = scoreTuning.tiers;
    let m = 1;
    for (let i = 1; i < t.length; i++) if (this.combo >= t[i]) m = i + 1;
    return m;
  }

  get pitch(): number {
    return 1 + Math.min(this.combo, 200) * 0.003;
  }

  get aliveHeroes(): Hero[] {
    return this.heroes.filter((h) => !h.player.dead && !h.left);
  }

  // ------------------------------------------------------------------ heroes and contexts

  makeHero(index: number, name: string, unlocked: string[], peerId = '', skin = settings.skin, pet = settings.pet, heroId = localHero()): Hero {
    const h = new Hero(this, index, name, HERO_COLORS[index % HERO_COLORS.length], unlocked, peerId, (metaSkin(skin) ?? skinOf(skin)), pet, heroId);
    h.player.setSkin(h.skin.armor, h.skin);
    return h;
  }

  setHeroes(list: Hero[]): void {
    for (const h of this.heroes) if (!list.includes(h)) h.dispose();
    this.heroes = list;
    // Solo wears the skin's armour; co-op keeps per-player armour colours.
    for (const h of list) h.player.setSkin(list.length > 1 ? h.color : h.skin.armor, h.skin);
  }

  /** Wardrobe: re-dress this machine's hero. */
  applyLocalSkin(): void {
    const h = this.hero;
    h.skin = (save.meta.rewards.includes(settings.skin) ? metaSkin(settings.skin) : undefined) ?? skinOf(settings.skin);
    h.player.setSkin(this.heroes.length > 1 ? h.color : h.skin.armor, h.skin);
    h.setPet(settings.pet);
    h.setHeroDef(localHero());
    h.recomputeStats();
  }

  makeCtx(hero: Hero): WeaponCtx {
    const game = this;
    const ctx: WeaponCtx = {
      scene: this.scene,
      get player() {
        return hero.player;
      },
      get stats() {
        return hero.stats;
      },
      get rng() {
        return game.rng;
      },
      get time() {
        return game.runTime;
      },
      get flags() {
        return hero.synergy.flags;
      },
      enemies: this.enemies,
      hash: this.hash,
      bullets: this.bullets,
      particles: this.vfx,
      fx: this.vfx,
      owner: hero.index,
      firing: false,
      charging: false,
      damage: (e, base, o) => this.damage(e, base, o, hero),
      // PvP: a hero's weapons never aim at or hit its own stand-in.
      nearest: (x, z, r, skip) => this.nearestEnemy(x, z, r, (e) => e.pvpOwner === hero.index || !!skip?.(e)),
      inRadius: (x, z, r, out) => {
        this.enemiesInRadius(x, z, r, out);
        if (this.pvp) for (let i = out.length - 1; i >= 0; i--) if (out[i].pvpOwner === hero.index) out.splice(i, 1);
        return out;
      },
      shake: (x, z, amount) => this.vfx.shake(x, z, amount),
      hitBarrels: (dmg, inside) => {
        this.barrels.hitWhere(dmg, hero.index, inside);
        this.hitToysWhere(dmg, hero.index, inside);
      },
      blast: (x, z, r, base, color, source, tags) => this.blast(x, z, r, base, color, source, tags ?? hero.tagsOf(source) ?? ['explosive'], false, hero),
      zap: (from, hops, dmg) => this.zap(from, hops, dmg, hero),
      get combos() {
        return hero.combos;
      },
      soundSource: null,
      sound: (name) => this.vfx.sound(weaponCue(name, ctx.soundSource), hero.player.x, hero.player.z),
    };
    return ctx;
  }

  makeEnemyCtx(): EnemyCtx {
    const game = this;
    return {
      targets: this.targets,
      target: { x: 0, z: 0, radius: 0 },
      targetAlive: true,
      hash: this.hash,
      colliders: this.arena.colliders,
      get walls() {
        return game.walls;
      },
      onEnrage: (e) => {
        this.vfx.num(e.x, 4, e.z, 'ENRAGED!', 'crit');
        this.vfx.ring(e.x, e.z, e.radius, 8, '#ff3d5e', 0.5);
        this.vfx.shake(e.x, e.z, 0.8);
        this.vfx.sound('bossPhase', e.x, e.z);
      },
      onWindup: (e) => windupCue(this, e), // telegraph, threat cue and family call (systems/sound.ts)
      fireBullet: (e, dx, dz, speed, damage) => {
        this.bullets.spawn({
          x: e.x + dx * (e.radius + 0.2),
          z: e.z + dz * (e.radius + 0.2),
          dirX: dx,
          dirZ: dz,
          speed: speed * (this.meta.has('bullets') ? 1.35 : 1) * (this.meta.rule('barrage') ? 2 : 1),
          life: 4,
          radius: 0.26,
          damage: damage * e.dmgMul,
          knockback: 6,
          team: Team.Enemy,
          color: access.colorblind ? '#ffffff' : '#ff3df0',
          width: access.colorblind ? 0.62 : 0.5,
          length: access.colorblind ? 0.62 : 0.5,
        });
        this.vfx.sound('enemyShoot', e.x, e.z);
      },
      spawnChild: (id, x, z) => {
        if (this.enemies.activeCount >= 480) return;
        if (this.walls.hitCircle(x, z, 0.5)) return;
        this.enemies.spawn(ENEMIES[id], x, z, this.spawnOpts());
      },
      detonate: (e) => this.detonate(e),
      slam: (e) => this.bossSlam(e),
      boss: this.bossApi,
      strike: (x, z, r, delay, damage) => {
        this.strikes.push({ x, z, r, t: delay, dmg: damage * this.director.dmgMul });
        this.vfx.zone(x, z, r, delay);
      },
      ...EnemyAiSys.enemyCtxExtras.call(this),
      foe: BiomeFoesSys.biomeFoeApi.call(this),
    };
  }

  spawnOpts(extra: SpawnOpts = {}): SpawnOpts {
    let hpExtra = 0;
    for (const h of this.heroes) hpExtra += h.synergy.flags.enemyHp;
    const hpMul = (extra.hpMul ?? this.director.hpMul) * (1 + hpExtra);
    const out = { dmgMul: this.director.dmgMul, speedMul: this.director.speedMul, ...extra, hpMul };
    out.hpMul *= (1 + this.curseSum('enemyHp')) * this.difficulty.enemyHp;
    out.speedMul *= 1 + this.curseSum('enemySpeed');
    out.dmgMul *= (1 + this.curseSum('enemyDmg')) * this.difficulty.enemyDmg;
    out.hpMul *= this.meta.has('armor') ? 1.35 : 1;
    out.speedMul *= (this.meta.has('haste') ? 1.25 : 1) * (this.meta.rule('speed') ? 2 : 1);
    out.dmgMul *= this.meta.has('damage') ? 1.25 : 1;
    return out;
  }

  // ------------------------------------------------------------------ flow








  /** "ENDLESS · HARD" style label for scores (blank for standard on normal). */
  get runLabel(): string {
    const parts: string[] = [];
    if (this.runMode !== 'standard') parts.push(MODE_BY_ID[this.runMode].name.toUpperCase());
    if (this.difficulty.id !== 'normal') parts.push(this.difficulty.name.toUpperCase());
    if (this.meta.label) parts.push(this.meta.label);
    return parts.join(' · ');
  }









  // ------------------------------------------------------------------ debug helpers (debug panel)







  // ------------------------------------------------------------------ stage end, shop, portal

  // ------------------------------------------------------------------ curses, relics, events


  get activeCurses(): readonly string[] {
    return this.curses;
  }
  get fireRateBuff(): number {
    return this.runEvents.fireRateMul;
  }
  get damageBuff(): number {
    return this.runEvents.damageMul;
  }
  get dashCurse(): number {
    return (1 + this.curseSum('dashCd')) * (this.meta.has('dash') ? 1.5 : 1);
  }















  // ------------------------------------------------------------------ end of run




  // ------------------------------------------------------------------ level-ups (per hero, team XP)













  // ------------------------------------------------------------------ achievements (this machine's save)


  // ------------------------------------------------------------------ update

  update(dt: number): void {
    this.stepN++;
    if (this.photo?.active) {
      this.photo.update(dt);
      this.input.endStep();
      return;
    }
    this.onboarding.step(dt);
    if (this.pvp) this.pvpTick();
    this.coopInput();
    this.coop2Step(dt); // drop-in joins, autopilot for dropped players, revive pool, team ultimate, ghosts (systems/coop2.ts)
    this.mpTick(dt); // MP lane: Versus command view, local co-op menu turns, lobby heartbeat (systems/mp.ts)
    // Time holds (rewind playback, death replay) stop the world on this machine (systems/time.ts).
    if (this.timeStep(dt)) {
      this.input.endStep();
      this.hostTick(false);
      return;
    }
    // Cinematics (systems/cinematics.ts): solo holds the world for the ending, reveals and jackpots.
    if (this.cineStep(dt)) {
      this.input.endStep();
      this.hostTick(false);
      return;
    }
    if (this.role === 'client') {
      this.clientUpdate(dt);
      return;
    }
    const input = this.input;
    if (
      !this.paused &&
      this.isCombatMode &&
      this.screens.current === 'none' &&
      (input.keyPressed('Escape') || input.actionPressed('pause') || input.padButtonPressed(9))
    ) {
      this.pause();
      input.endStep();
      this.hostTick(true);
      return;
    }
    // Menus get the input first; if one switched screens, swallow this step's presses.
    const before = this.screens.current;
    this.screens.update(input, dt);
    const switched = this.screens.current !== before;
    if (this.paused && this.screens.current === 'none') this.paused = false;
    if (this.paused && input.padButtonPressed(9)) this.resume();
    // Solo pauses the world; online the game keeps running behind the menu.
    const frozen = (this.paused && this.role === 'solo') || this.mode === 'levelup' || this.mode === 'shop' || this.mode === 'title';
    this.updateRoute(dt);
    if (this.mode === 'levelup' && !switched) {
      for (let k = 0; k < 3; k++) if (input.keyPressed(`Digit${k + 1}`) && this.screens.canPick(k)) this.ui('pick', k);
      if (input.actionPressed('reroll') || input.padButtonPressed(3)) this.ui('reroll');
    }
    if (this.mode === 'title' && !switched) this.attractTick(dt);
    if (frozen || switched) {
      input.endStep();
      this.hostTick(true);
      return;
    }
    this.modesTick(dt); // the rhythm stage's beat clock runs in real time (systems/modes.ts)
    if (this.juice.hitStop > 0) {
      this.juice.hitStop -= dt;
      this.hostTick(false);
      return;
    }
    // Boss finisher: the world holds still until it ends, then the boss dies (systems/characters.ts).
    if (this.finisherHold(dt)) {
      input.endStep();
      this.hostTick(false);
      return;
    }
    this.updateBossBoom(dt);
    // Boss death slow motion: the world runs at a third of the speed for a moment.
    if (this.slowMoT > 0) {
      this.slowMoT -= dt;
      dt *= 0.35;
    }

    this.modeT += dt;
    if (this.mode === 'transition') {
      this.updateTransition();
      input.endStep();
      this.hostTick(false);
      return;
    }
    this.simulate(dt, !this.paused);
    input.endStep();
    this.hostTick(false);
  }

  /** One authoritative simulation step (solo and host). */
  simulate(dt: number, localControl: boolean): void {
    lapStart();
    const anyAlive = this.aliveHeroes.length > 0;
    if (anyAlive) this.runTime += dt;

    for (const h of this.heroes) this.updateHero(h, dt, localControl);
    this.updateSkill(dt);
    lap('sim.heroes+skill');

    // Spatial hash first: weapons and enemies query it.
    this.hash.clear();
    for (const e of this.enemies.list) if (e.alive) this.hash.insert(e, e.x, e.z, e.radius);
    lap('sim.hash');

    this.gameplayPreWeapons(dt); // mech suit, super weapon, overload; idles the clicks they replace (systems/gameplay.ts)
    this.modesPreWeapons(dt); // enemy beat pulse, holstered weapons (systems/modes.ts)
    for (const h of this.heroes) {
      if (h.player.dead || h.left) continue;
      for (const w of h.weapons) {
        if (this.meta.rule('right') && w.def.slot === 'primary') continue;
        h.ctx.soundSource = w; // evolved weapons layer their sound (systems/sound.ts weaponCue)
        w.update(dt, h.ctx);
      }
      h.ctx.soundSource = null;
      this.weaponFeel(h);
    }
    this.updateHeroMechs(dt);
    this.updateGameplay(dt);
    for (const h of this.heroes) this.updateBomb(h, dt);
    updateSpecials(this.heroes, dt, this.specialApi);
    // Q/E specials recharge over time; the meter waits while the special (or bomb wave) still runs.
    for (const h of this.heroes) {
      if (h.player.dead || h.left || h.bombT >= 0 || isSpecialRunning(h)) continue;
      h.bombCharge = Math.min(1, h.bombCharge + dt / h.specialCooldown);
    }
    lap('sim.weapons+specials');

    // Enemies chase the nearest living hero.
    this.targets.length = 0;
    for (const h of this.heroes) this.targets.push({ x: h.player.x, z: h.player.z, radius: h.player.radius, alive: !h.player.dead && !h.left });
    this.companionTargets();
    this.enemies.update(dt, this.enemyCtx);
    lap('sim.enemies');
    if (this.pvp?.phase === 'duel') this.updateDuel(dt);
    if (this.versus) this.versusStep(dt);
    this.updateHazards(dt);
    this.updateBiomeFoes(dt);
    this.updateArena(dt);
    this.updateWind(dt);
    this.updateWorldEvent(dt);
    this.updateModes(dt); // pacifist timer and rewards, mini-games, ghost recording (systems/modes.ts)
    soundLaneStep(this, dt); // instrument pickups, sound-reactive enemies (systems/sound2.ts)
    lap('sim.hazards+arena');
    for (const h of this.heroes) if (!h.player.dead && !h.left) this.contactDamage(h);
    this.updateStatuses(dt);
    this.updateStrikes(dt);
    lap('sim.statuses');
    this.updateBossFight(dt);
    this.recycleFarEnemies(dt);
    lap('sim.boss+recycle');

    this.updateBullets(dt);
    lap('sim.bullets');
    this.barrels.update(dt, (i, b) => this.explodeBarrel(i, b));
    this.collectors.length = 0;
    for (const h of this.heroes) this.collectors.push({ x: h.player.x, z: h.player.z, magnet: h.stats.magnet, alive: !h.player.dead && !h.left });
    this.pickups.update(
      dt,
      this.collectors,
      (t, v, who) => this.collect(this.heroes[who], t, v),
      (t, who, v) => (t !== PickupType.Gear || this.heroes[who].rerollsLeft < MAX_GEARS) && (t !== PickupType.Chest || v < OWNED_CHEST || v - OWNED_CHEST === who),
    );
    this.updateChests();
    if (this.mode === 'fight' && anyAlive && !this.pvp) this.updateChestSpawns(dt);
    lap('sim.pickups+chests');
    this.particles.update(dt);
    this.fx.update(dt);
    lap('sim.particles+fx');
    if (this.heroes.length > 1 && !this.pvp) this.updateRevives(dt);
    this.updateCompanion(dt);

    if (this.mode === 'fight' && this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        this.combo = 0;
        this.runEvents.onComboBreak();
      }
    }

    // Stage flow
    if (this.stepN % 30 === 0) for (const e of this.enemies.list) if (e.active) markSeen(e.def.id);
    if (this.mode === 'fight' && anyAlive) {
      this.runEvents.update(dt, this.director.time, this.director.bossSpawned);
      this.updateEliteMods(dt);
      this.updatePets(dt);
    }
    if (this.mode === 'fight' && anyAlive && this.pvp?.phase !== 'duel' && this.pvp?.phase !== 'over') {
      this.director.teamLevel = this.level; // the Reaper comes for high-level teams
      const reqs = this.versusReqs(this.director.update(dt, this.enemies.activeCount, (id) => this.enemies.countOf(id), this.rng)); // Versus: the Overlord spawns instead
      let anchor: { x: number; z: number; def: EnemyDef } | null = null;
      for (const r of reqs) {
        if (r.kind === 'boss') this.spawnBoss(r.def);
        else if (r.kind === 'ring') this.spawnRing(r.def, r.count);
        else {
          const near = anchor && anchor.def === r.def ? anchor : null;
          const pos = this.spawnEnemy(r.def, r.elite, near);
          if (pos) anchor = { x: pos.x, z: pos.z, def: r.def };
        }
      }
      if (this.boss && !this.boss.active) this.boss = null;
      if (this.director.bossSpawned && !this.boss) this.stageClear();
    } else if (this.mode === 'cleared') {
      if (this.modeT > 2.2) this.openShop();
    } else if (this.mode === 'portal') {
      // Gameplay timing uses modeT, not the portal's render-side age (hosts may not render every frame).
      const inside = this.modeT > 0.5 && this.aliveHeroes.some((h) => Math.hypot(h.player.x - this.portal.x, h.player.z - this.portal.z) < 1.3);
      if (inside) {
        this.mode = 'transition';
        this.modeT = 0;
        this.stageLoaded = false;
        this.vfx.sound('portal', NaN, NaN);
        this.vfx.flash(0.6);
      } else if (this.modeT % 0.25 < dt) {
        this.vfx.burst(this.portal.x, 0.3, this.portal.z, { count: 3, color: '#ff3df0', color2: '#4fc3ff', speed: [0.5, 2], size: [0.1, 0.22], life: [0.6, 1.0], up: 4, drag: 1 });
      }
    } else if (this.mode === 'dead' && this.modeT > 1.2 && !this.gameOverShown) {
      this.gameOverShown = true;
      this.endRun();
    }

    // Level-ups interrupt the action (after the step so this frame's effects land).
    if (this.heroes.some((h) => !h.left && h.needsPick) && this.isCombatMode && anyAlive) this.openLevelUp();
    lap('sim.director+rest');
  }

  /** Movement, aim and per-hero timers. Local hero reads Input; remote heroes follow their client. */
  updateHero(h: Hero, dt: number, localControl: boolean): void {
    if (this.localCoop && this.localHeroUpdate(h, dt, localControl)) return; // local co-op: pad heroes read their own pad
    const p = h.player;
    if (h.left) return;
    if (!p.dead && h.stats.regen > 0) p.heal(h.stats.regen * dt);
    const input = this.input;
    if (h === this.hero) {
      const control = localControl && !p.dead;
      if (control) {
        if (input.device === 'pad') {
          if (input.padAim.x !== 0 || input.padAim.y !== 0) p.setAimDir(input.padAim.x, input.padAim.y);
          else if (input.move.x !== 0 || input.move.y !== 0) p.setAimDir(input.move.x, input.move.y);
        } else if (this.mouseAimPoint()) p.setAimPoint(this.aimHit.x, this.aimHit.z);
      }
      const wantDash =
        control &&
        (input.actionPressed('dash') || input.padButtonPressed(4) || input.padButtonPressed(6) || input.padButtonPressed(0));
      this.groundAt(p.x, p.z, p.ground);
      if (p.update(dt, control ? input : null, this.arena.colliders, wantDash)) this.onDash(h);
      const padFiring = input.padAim.x !== 0 || input.padAim.y !== 0 || input.padButton(7);
      h.ctx.firing = control && (input.mouseDown(0) || padFiring || (settings.autoFire && input.device === 'kbm'));
      h.ctx.charging = rightClickHeld(input, control);
      const wantBomb =
        control && (input.actionPressed('bomb') || input.mousePressed(1) || input.padButtonPressed(3) || input.padButtonPressed(5));
      if (wantBomb) this.tryBomb(h);
      this.skillInput(h, control);
    } else if (h.remote) {
      // Smoothly follow the client's own (authoritative) movement.
      const r = h.remote;
      p.tickTimers(dt);
      p.prev.x = p.pos.x;
      p.prev.z = p.pos.z;
      if (!p.dead) {
        p.pos.x += (r.x - p.pos.x) * 0.5;
        p.pos.z += (r.z - p.pos.z) * 0.5;
        p.vel.x = r.vx;
        p.vel.z = r.vz;
        p.setAimDir(r.ax, r.az, r.ad < 0 ? Infinity : r.ad);
        if (r.dashing) {
          p.dashT = Math.max(p.dashT, 0.05);
          p.invuln = Math.max(p.invuln, 0.08);
        }
      }
      h.ctx.firing = r.firing && !p.dead;
      h.ctx.charging = r.charging && !p.dead;
    }
    h.synergy.moving = p.speed > 1.2;
    if (!p.dead) h.synergy.tick(dt);
    h.refreshLive();
    if (this.heroes.length > 1 && !p.dead) this.applyTeamAuras(h, dt);
    this.coopRoleStats(h); // co-op roles: a mixed party's team bonus (systems/coop2.ts)
    this.updateFootsteps(h, dt);
  }

  /** Co-op items worn by teammates near h: Rally Banner, Medic Link, Bond of Steel. */
  applyTeamAuras(h: Hero, dt: number): void {
    let near = 0;
    for (const o of this.heroes) {
      if (o === h || o.left || o.player.dead) continue;
      if (Math.hypot(o.player.x - h.player.x, o.player.z - h.player.z) > passiveTuning.teamRadius) continue;
      near++;
      h.stats.damageMul += o.stats.teamDmgAura;
      if (o.stats.teamHeal > 0) h.player.heal(o.stats.teamHeal * dt);
    }
    if (near > 0) h.stats.armor += h.stats.nearMateArmor;
  }

  updateTransition(): void {
    if (this.skyfallTransition()) return; // the sky-fall cinematic (systems/cinematics.ts)
    const t = this.modeT;
    if (t < 0.35) this.hud.setFade(t / 0.35);
    else if (!this.stageLoaded) {
      this.stageLoaded = true;
      this.hud.setFade(1);
      this.loadStage(this.stage + 1);
      this.mode = 'transition';
      this.modeT = 0.35;
    } else if (t < 0.8) this.hud.setFade(1 - (t - 0.35) / 0.45);
    else {
      this.hud.setFade(0);
      this.mode = 'fight';
    }
  }

  mouseAimPoint(): THREE.Vector3 | null {
    this.ndc.set(this.input.mouse.ndcX, this.input.mouse.ndcY);
    this.raycaster.setFromCamera(this.ndc, this.cam.camera);
    return this.raycaster.ray.intersectPlane(this.aimPlane, this.aimHit);
  }

  onDash(h: Hero): void {
    const p = h.player;
    h.dashes++;
    h.synergy.dash();
    this.skillDash(h);
    this.gpOnDash(h);
    if (h.hasRelic('r_dashbomb')) this.blast(p.x, p.z, 2.6, 30 + 8 * this.stage, '#ffb627', 'r_dashbomb', ['explosive'], false, h);
    this.vfx.sound('dash', p.x, p.z);
    if (h === this.hero) {
      this.juice.shake(0.05);
      this.input.rumble(0, 0.25, 70);
    }
    this.vfx.ring(p.x, p.z, 1, 3, '#4fc3ff', 0.25);
    this.vfx.burst(p.x, 0.15, p.z, { count: 10, color: '#ffffff', color2: '#e8f4ff', speed: [2, 5], size: [0.12, 0.25], life: [0.2, 0.4], up: 1.5, gravity: 6 });
    if (h === this.hero && h.dashes === 60) this.checkAchievements();
  }

  footTimers = new Map<Hero, number>();
  updateFootsteps(h: Hero, dt: number): void {
    const p = h.player;
    if (p.dead) return;
    if (p.dashing) {
      this.vfx.burst(p.x, 0.9, p.z, { count: 2, color: '#4fc3ff', color2: h.color, speed: [0.2, 1], size: [0.25, 0.4], life: [0.15, 0.3], drag: 6 });
      return;
    }
    if (p.speed < 2.5) return;
    const t = (this.footTimers.get(h) ?? 0) - dt;
    this.footTimers.set(h, t > 0 ? t : 0.21);
    if (t > 0) return;
    this.vfx.burst(p.x - p.vel.x * 0.04, 0.1, p.z - p.vel.z * 0.04, { count: 2, color: '#f2e2b8', color2: '#ffffff', speed: [0.3, 1.2], size: [0.12, 0.2], life: [0.25, 0.4], up: 1.2, gravity: 3 });
  }

  // ------------------------------------------------------------------ co-op revives



  // ------------------------------------------------------------------ spawning







  // ------------------------------------------------------------------ combat











  // ------------------------------------------------------------------ statuses and combos































  // ------------------------------------------------------------------ online: lobby







  // ------------------------------------------------------------------ PvP (src/game/pvp.ts)











  // ------------------------------------------------------------------ online: host side






  // ------------------------------------------------------------------ online: client side








  // ------------------------------------------------------------------ render














}
