import * as THREE from 'three';
import type { Input } from '../core/input';
import { Rng, randomSeed } from '../core/rng';
import { SpatialHash, StaticBoxGrid } from '../core/spatialHash';
import { loadJson, saveJson } from '../core/storage';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { ACHIEVEMENTS } from '../data/meta';
import { MOD_BY_ID } from '../data/mods';
import type { Tag } from '../data/tags';
import { WEAPONS } from '../data/weapons';
import { sfx } from '../audio/sfx';
import { NetClient, NetHost } from '../net/peer';
import { packBullets, packEnemies, packPickups, unpackBullets, unpackEnemies, unpackPickups } from '../net/codec';
import { disposeObject } from '../render/dispose';
import { DamageNumbers } from '../ui/damageNumbers';
import { Hud, type LoadoutItem } from '../ui/hud';
import { Screens, type Offer, type RunSummary, type ShopView } from '../ui/screens';
import { createFieldArena, type Arena } from '../world/fieldArena';
import { biomeForStage } from '../data/biomes';
import { applyBiomeLook } from '../render/biomeLook';
import { Barrels, barrelTuning, type Barrel } from './barrels';
import { Chests } from './chests';
import { BULLET_Y, Bullets, Team } from './bullets';
import { CameraRig, cameraTuning } from './cameraRig';
import { Director } from './director';
import { Enemies, type Enemy, type EnemyCtx, type SpawnOpts } from './enemies';
import { Fx } from './fx';
import { HERO_COLORS, Hero, economyTuning, type HeroWorld } from './hero';
import { loadHighScores, submitScore } from './highscores';
import { Juice } from './juice';
import { Particles } from './particles';
import { PickupType, Pickups, type Collector } from './pickups';
import { playerTuning } from './player';
import { Portal } from './portal';
import { grantAchievement, persist, save, unlockedWeapons } from './save';
import { settings, saveSettings } from './settings';
import { Vfx, type VfxEvent } from './vfx';
import { createWeapon, type Buster, type DamageOpts, type WeaponCtx } from './weapons';

export { economyTuning } from './hero';

export const scoreTuning = {
  comboWindow: 2.0, // seconds a combo survives without a kill
  tiers: [0, 25, 75, 150, 300, 500, 800, 1200], // combo needed for x1..x8
  noHitBonus: 2000, // x stage, for clearing a stage without damage
};

export const bombTuning = {
  chargePerXp: 0.004, // bomb meter gained per XP point of enemies killed
  damage: 80,
  radius: 10,
  duration: 0.35,
  knockback: 18,
};

export const dropTuning = {
  xpMul: 0.55, // XP gem value per enemy XP point (lower = slower levelling)
  goldChance: 0.006,
  heartChance: 0.004,
  magnetChance: 0.0015,
};

/** Status effects and their combos. */
export const statusTuning = {
  burnTime: 3,
  shockTime: 2,
  shockMult: 0.2, // shocked enemies take +20% damage
  shatterDamage: 18,
  overloadDamage: 30,
  napalmDps: 8,
};

export const cheats = { god: false };

export type Mode = 'title' | 'fight' | 'levelup' | 'shop' | 'cleared' | 'portal' | 'transition' | 'dead';
export type Role = 'solo' | 'host' | 'client';

const AIM_HEIGHT = BULLET_Y;
const TITLE_SEED = 1234;
const RECYCLE_DIST = 36;
const CHARGE_TAGS: Tag[] = ['projectile'];
const SNAP_EVERY = 3; // host snapshot every N sim steps (20 Hz)
const INPUT_EVERY = 2; // client input every N sim steps (30 Hz)
const INTEREST = 34; // only send entities this close to each client's hero
const REVIVE_TIME = 3;
const REVIVE_RANGE = 2.4;

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  const l = level - 1;
  return Math.round(6 + 8 * l + 1.4 * l * l);
}

interface LobbyEntry {
  peerId: string; // '' = host
  name: string;
  unlocked: string[];
}

/** Shop view sent over the network (Mods referenced by id). */
interface NetShop {
  gold: number;
  interest: number;
  interestCap: number;
  interestPer: number;
  offers: ({ id: string; price: number; hint: string } | null)[];
  owned: { id: string; sell: number; readout: string }[];
  slots: number;
  rerollCost: number;
  healCost: number;
  healed: boolean;
  loadout: LoadoutItem[];
  stage: number;
}

function playerName(): string {
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

  heroes: Hero[] = [];
  /** Index of the hero this machine controls. */
  local = 0;
  role: Role = 'solo';
  private host: NetHost | null = null;
  private client: NetClient | null = null;
  private lobby: LobbyEntry[] = [];

  mode: Mode = 'title';
  paused = false;

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
  private elitesRun = 0;
  private bossesRun = 0;
  private newAchievements: string[] = [];
  private boss: Enemy | null = null;
  private comboT = 0;
  private damagedThisStage = false;
  private resumeMode: Mode = 'fight';
  private modeT = 0;
  private gameOverShown = false;
  private stageLoaded = false;
  private animTime = 0;
  private recycleT = 0;
  private stepN = 0;

  // --- Client mirror state ---
  private netEnemies = new Map<number, Enemy>();
  private snapTime = 0;
  private snapInterval = 50;
  private netTimeLeft = 0;
  private netBoss: { name: string; hp01: number } | null = null;
  private netMods: { id: string; ro: string }[] = [];
  private netCombo01 = 0;
  private fadeT = 0;

  private walls: StaticBoxGrid;
  private hash = new SpatialHash<Enemy>(2);
  private dmg: DamageNumbers;
  private hud: Hud;
  readonly screens: Screens;
  private flashes: THREE.Mesh[] = [];
  private enemyCtx: EnemyCtx;
  private targets: { x: number; z: number; radius: number; alive: boolean }[] = [];
  private collectors: Collector[] = [];

  // Scratch objects (no per-frame allocation)
  private raycaster = new THREE.Raycaster();
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_HEIGHT);
  private ndc = new THREE.Vector2();
  readonly aimHit = new THREE.Vector3();
  private playerPos = new THREE.Vector3();
  private lead = new THREE.Vector3();
  private shake = { x: 0, z: 0 };
  private mz = { x: 0, z: 0 };
  private tmp = new THREE.Vector3();
  private scratch: Enemy[] = [];
  private shownCharge = 0;
  /** Telegraphed ground strikes (Hive Queen) counting down. */
  private strikes: { x: number; z: number; r: number; t: number; dmg: number }[] = [];

  constructor(
    private input: Input,
    aspect: number,
    hudRoot: HTMLElement,
    private reticle: HTMLElement,
  ) {
    this.arena = createFieldArena(TITLE_SEED);
    this.scene.add(this.arena.group);
    this.walls = new StaticBoxGrid(this.arena.colliders);
    this.enemies = new Enemies(this.scene);
    this.bullets = new Bullets(this.scene);
    this.particles = new Particles(this.scene);
    this.fx = new Fx(this.scene);
    this.portal = new Portal(this.scene);
    this.barrels = new Barrels(this.scene);
    this.barrels.load(this.arena);
    this.chests = new Chests(this.scene);
    this.chests.load(this.arena.chests);
    this.pickups = new Pickups(this.scene);
    this.cam = new CameraRig(aspect);
    this.dmg = new DamageNumbers(hudRoot);
    this.hud = new Hud(hudRoot);
    this.vfx = new Vfx({
      fx: this.fx,
      particles: this.particles,
      dmg: this.dmg,
      juice: this.juice,
      hud: this.hud,
      zones: this.enemies.zones,
      listener: () => this.heroes[this.local]?.player ?? { x: 0, z: 0 },
    });
    this.screens = new Screens(hudRoot, {
      start: () => this.startSolo(),
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
      shopReroll: () => this.ui('sreroll'),
      shopHeal: () => this.ui('heal'),
      shopDone: () => this.ui('done'),
      online: () => this.screens.showOnline(playerName()),
      mpHost: (name) => void this.hostGame(name),
      mpJoin: (name, code) => void this.joinGame(name, code),
      mpStart: () => this.hostStart(),
      mpLeave: () => this.leaveToTitle(),
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && this.isCombatMode && !this.paused && this.screens.current === 'none') {
        settings.autoFire = !settings.autoFire;
        saveSettings();
        this.hud.toast(settings.autoFire ? 'AUTO-FIRE ON' : 'AUTO-FIRE OFF');
      }
    });
    this.hud.onPause = () => this.pause();
    this.enemyCtx = this.makeEnemyCtx();
    this.heroes = [this.makeHero(0, playerName(), unlockedWeapons())];
    this.goTitle();
  }

  // ------------------------------------------------------------------ accessors

  /** This machine's hero. */
  get hero(): Hero {
    return this.heroes[this.local];
  }
  get player() {
    return this.hero.player;
  }
  get online(): boolean {
    return this.role !== 'solo';
  }
  private get authority(): boolean {
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

  private get isCombatMode(): boolean {
    return this.mode === 'fight' || this.mode === 'cleared' || this.mode === 'portal';
  }

  get multiplier(): number {
    const t = scoreTuning.tiers;
    let m = 1;
    for (let i = 1; i < t.length; i++) if (this.combo >= t[i]) m = i + 1;
    return m;
  }

  private get pitch(): number {
    return 1 + Math.min(this.combo, 200) * 0.003;
  }

  private get aliveHeroes(): Hero[] {
    return this.heroes.filter((h) => !h.player.dead && !h.left);
  }

  // ------------------------------------------------------------------ heroes and contexts

  private makeHero(index: number, name: string, unlocked: string[], peerId = ''): Hero {
    const h = new Hero(this, index, name, HERO_COLORS[index % HERO_COLORS.length], unlocked, peerId);
    return h;
  }

  private setHeroes(list: Hero[]): void {
    for (const h of this.heroes) if (!list.includes(h)) h.dispose();
    this.heroes = list;
  }

  makeCtx(hero: Hero): WeaponCtx {
    const game = this;
    return {
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
      nearest: (x, z, r, skip) => this.nearestEnemy(x, z, r, skip),
      inRadius: (x, z, r, out) => this.enemiesInRadius(x, z, r, out),
      blast: (x, z, r, base, color, source) => this.blast(x, z, r, base, color, source, WEAPONS[source]?.tags ?? ['explosive'], false, hero),
      sound: (name) => this.vfx.sound('w:' + name, hero.player.x, hero.player.z),
    };
  }

  private makeEnemyCtx(): EnemyCtx {
    return {
      targets: this.targets,
      target: { x: 0, z: 0, radius: 0 },
      targetAlive: true,
      hash: this.hash,
      colliders: this.arena.colliders,
      onWindup: (e) => {
        if (e.def.boss) this.vfx.sound('bossWindup', e.x, e.z);
        else if (e.def.behavior !== 'spawner') this.vfx.sound('telegraph', e.x, e.z);
      },
      fireBullet: (e, dx, dz, speed, damage) => {
        this.bullets.spawn({
          x: e.x + dx * (e.radius + 0.2),
          z: e.z + dz * (e.radius + 0.2),
          dirX: dx,
          dirZ: dz,
          speed,
          life: 4,
          radius: 0.26,
          damage: damage * e.dmgMul,
          knockback: 6,
          team: Team.Enemy,
          color: '#ff3df0',
          width: 0.5,
          length: 0.5,
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
      strike: (x, z, r, delay, damage) => {
        this.strikes.push({ x, z, r, t: delay, dmg: damage * this.director.dmgMul });
        this.vfx.zone(x, z, r, delay);
      },
    };
  }

  private spawnOpts(extra: SpawnOpts = {}): SpawnOpts {
    let hpExtra = 0;
    for (const h of this.heroes) hpExtra += h.synergy.flags.enemyHp;
    const hpMul = (extra.hpMul ?? this.director.hpMul) * (1 + hpExtra);
    return { dmgMul: this.director.dmgMul, speedMul: this.director.speedMul, ...extra, hpMul };
  }

  // ------------------------------------------------------------------ flow

  private clearWorld(): void {
    this.enemies.clear();
    this.netEnemies.clear();
    this.bullets.clear();
    this.particles.clear();
    this.fx.clear();
    this.dmg.clear();
    this.pickups.clear();
    this.portal.close();
    this.juice.reset();
    this.boss = null;
    this.strikes.length = 0;
    this.enemies.zones.length = 0;
    for (const h of this.heroes) h.bombT = -1;
  }

  private loadArena(seed: number, stage = 1): void {
    this.scene.remove(this.arena.group);
    disposeObject(this.arena.group);
    const biome = biomeForStage(stage);
    this.arena = createFieldArena(seed, biome);
    applyBiomeLook(biome);
    this.scene.add(this.arena.group);
    this.walls = new StaticBoxGrid(this.arena.colliders);
    this.enemyCtx.colliders = this.arena.colliders;
    this.barrels.load(this.arena);
    this.chests.load(this.arena.chests);
  }

  private spawnSpot(i: number): { x: number; z: number } {
    const n = Math.max(1, this.heroes.length);
    return { x: (i - (n - 1) / 2) * 2, z: 0 };
  }

  goTitle(): void {
    this.paused = false;
    this.mode = 'title';
    this.loadArena(TITLE_SEED, 1);
    this.clearWorld();
    const h = this.hero;
    h.disposeWeapons();
    h.unlocked = unlockedWeapons();
    h.recomputeStats();
    h.player.reset(h.stats);
    this.hud.setVisible(false);
    this.hud.setFade(0);
    this.screens.setHighScores(loadHighScores());
    this.screens.show('title');
  }

  /** Back to a single local hero on the title screen, closing any connection. */
  leaveToTitle(): void {
    this.host?.close();
    this.client?.close();
    this.host = null;
    this.client = null;
    this.role = 'solo';
    this.lobby = [];
    if (this.heroes.length !== 1 || this.local !== 0) {
      const keep = this.makeHero(0, playerName(), unlockedWeapons());
      this.setHeroes([keep]);
      this.local = 0;
    }
    this.goTitle();
  }

  startSolo(): void {
    this.leaveToTitle();
    this.hero.name = playerName();
    this.startRun();
  }

  /** Start a run (solo or online host). */
  startRun(): void {
    this.paused = false;
    this.seed = randomSeed();
    this.rng = new Rng(this.seed);
    this.stage = 1;
    this.score = this.kills = this.combo = this.maxCombo = 0;
    this.runTime = this.comboT = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNext = xpForLevel(1);
    this.elitesRun = this.bossesRun = this.overloads = 0;
    this.newAchievements = [];
    this.director.players = this.heroes.length;
    for (const h of this.heroes) {
      h.left = false;
      h.startRun();
      h.player.showWhenDead = this.heroes.length > 1;
    }
    this.clearWorld();
    this.hud.resetScore();
    this.hud.setVisible(true);
    this.hud.setFade(0);
    this.screens.show('none');
    if (this.role === 'host') {
      for (const h of this.heroes) {
        if (!h.peerId) continue;
        this.host!.send(h.peerId, { t: 'start', seed: this.seed, you: h.index, players: this.heroes.map((x) => ({ name: x.name })) });
      }
    }
    this.loadStage(1);
  }

  /** Alias used by the debug panel. */
  restart(): void {
    if (this.role === 'client') return;
    this.startRun();
  }

  private retry(): void {
    if (this.role === 'client') {
      this.hud.toast('WAITING FOR THE HOST TO RESTART');
      return;
    }
    this.startRun();
  }

  private loadStage(stage: number): void {
    this.stage = stage;
    this.loadArena((this.seed ^ Math.imul(stage, 0x9e3779b1)) >>> 0, stage);
    this.clearWorld();
    this.heroes.forEach((h, i) => {
      const s = this.spawnSpot(i);
      h.player.teleport(s.x, s.z);
      if (h.player.dead && !h.left) this.reviveHero(h, 0.5, false);
    });
    this.director.start(stage);
    this.damagedThisStage = false;
    this.mode = 'fight';
    this.modeT = 0;
    if (this.role === 'host') this.host!.broadcast({ t: 'stage', stage, seed: this.seed });
    this.vfx.banner(`STAGE ${stage}`, `${biomeForStage(stage).name.toUpperCase()}<br>SURVIVE ${Math.round(this.director.duration / 60)} MINUTES`, 2.2);
    this.vfx.sound('wave', NaN, NaN);
    this.checkAchievements();
  }

  pause(): void {
    if (!this.isCombatMode || this.paused) return;
    this.paused = true;
    this.screens.setPauseBuild(this.hero.loadout(), this.hero.synergy.slots.map((sl) => sl.def));
    this.screens.show('pause');
  }

  resume(): void {
    this.paused = false;
    this.screens.show('none');
  }

  private quitRun(): void {
    if (this.role === 'solo') this.endRun(true);
    else this.leaveToTitle();
  }

  // ------------------------------------------------------------------ debug helpers (debug panel)

  debugLevelUp(): void {
    if (this.isCombatMode && this.authority) this.gainXp(this.xpNext - this.xp);
  }

  debugGiveWeapon(id: string): void {
    if (!this.isCombatMode || !this.authority) return;
    const h = this.hero;
    const w = h.weapons.find((x) => x.def.id === id);
    if (w?.maxed) w.evolve();
    else if (w) w.levelUp();
    else h.weapons.push(createWeapon(id, this.scene));
    h.loadoutDirty = true;
  }

  debugSkipToBoss(): void {
    if (this.mode === 'fight' && this.authority) this.director.time = Math.max(this.director.time, this.director.duration - 3);
  }

  debugGiveMod(id: string): void {
    const m = MOD_BY_ID[id];
    const h = this.hero;
    if (!m || h.synergy.owns(id) || h.synergy.full) return;
    h.synergy.add(m);
    h.recomputeStats();
  }

  debugAddGold(n: number): void {
    this.hero.gold += n;
  }

  // ------------------------------------------------------------------ stage end, shop, portal

  goldFx(h: Hero, n: number): void {
    this.vfx.num(h.player.x, 2.6, h.player.z, `+${n}●`, 'score');
    this.vfx.sound('coin', h.player.x, h.player.z);
  }

  private stageClear(): void {
    this.mode = 'cleared';
    this.modeT = 0;
    this.bossesRun++;
    for (const e of this.enemies.list) {
      if (!e.active) continue;
      this.pickups.spawn(PickupType.Gem, e.x, e.z, e.def.xp * dropTuning.xpMul);
      this.vfx.burst(e.x, 0.6, e.z, { count: 2, color: e.def.bodyColor, speed: [2, 5], size: [0.15, 0.3], life: [0.3, 0.5], up: 4, gravity: 12 });
      this.enemies.kill(e);
    }
    this.bullets.clear();
    this.pickups.vacuum = true;
    const noHit = this.damagedThisStage ? 0 : scoreTuning.noHitBonus * this.stage;
    this.score += noHit;
    for (const h of this.heroes) {
      if (h.left) continue;
      // Gold: flat reward plus interest on what you're holding (capped).
      h.gold += economyTuning.clearGold + h.interest;
      h.synergy.stageClear();
      if (h.player.dead) this.reviveHero(h, 0.3, false);
      h.player.heal(h.player.maxHp * 0.3);
    }
    let sub = `+${economyTuning.clearGold} GOLD + INTEREST`;
    if (noHit) sub += `<br>NO-HIT BONUS +${noHit.toLocaleString('en-US')}`;
    this.vfx.banner('STAGE CLEAR!', sub, 2.4);
    this.vfx.sound('stageClear', NaN, NaN);
    this.vfx.flash(0.5);
    this.checkAchievements();
  }

  private openShop(): void {
    this.mode = 'shop';
    for (const h of this.heroes) {
      if (h.left) continue;
      h.openShop();
      this.presentShop(h);
    }
    this.vfx.sound('chest', NaN, NaN);
  }

  private closeShop(): void {
    if (['shop', 'wait'].includes(this.screens.current)) this.screens.show('none');
    for (const h of this.heroes) this.tell(h, { t: 'go' });
    this.openPortal();
  }

  private openPortal(): void {
    const p = (this.aliveHeroes[0] ?? this.hero).player;
    const lim = this.arena.halfSize - 4;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = p.x + Math.cos(a) * 6;
      const z = p.z + Math.sin(a) * 6;
      if (Math.abs(x) < lim && Math.abs(z) < lim && !this.walls.hitCircle(x, z, 1.8)) {
        this.portal.open(x, z);
        break;
      }
    }
    if (!this.portal.active) this.portal.open(p.x + 3, p.z);
    this.vfx.ring(this.portal.x, this.portal.z, 1, 6, '#ff3df0', 0.5);
    this.vfx.banner('ENTER THE PORTAL', `STAGE ${this.stage + 1} AWAITS`, 1.6);
    this.mode = 'portal';
    this.modeT = 0;
  }

  // ------------------------------------------------------------------ end of run

  private summary(h: Hero): RunSummary {
    return {
      score: this.score,
      stage: this.stage,
      kills: this.kills,
      time: this.runTime,
      level: this.level,
      maxCombo: this.maxCombo,
      loadout: h.loadout(),
      mods: h.synergy.slots.map((sl) => sl.def.name),
      damage: Object.entries(h.damageBy)
        .sort((a, b) => b[1] - a[1])
        .map(([id, dmg]) => ({ name: h.weapons.find((w) => w.def.id === id)?.name ?? this.sourceName(id), color: WEAPONS[id]?.color ?? MOD_BY_ID[id]?.color ?? '#ff3df0', dmg })),
      achievements: h === this.hero ? this.newAchievements.map((id) => ACHIEVEMENTS.find((a) => a.id === id)!.name) : [],
    };
  }

  /** Bank lifetime stats into this machine's save, then show game over. */
  private bankAndShow(sum: RunSummary, quit = false): void {
    const L = save.lifetime;
    L.runs++;
    L.kills += sum.kills;
    L.elites += this.elitesRun;
    L.bosses += Math.max(0, sum.stage - 1);
    L.bestStage = Math.max(L.bestStage, sum.stage);
    L.bestLevel = Math.max(L.bestLevel, sum.level);
    L.playTime += sum.time;
    persist();
    this.paused = false;
    if (quit) {
      this.goTitle();
      return;
    }
    const rank = submitScore({ score: sum.score, stage: sum.stage, kills: sum.kills, date: new Date().toISOString().slice(0, 10) });
    this.screens.showGameOver(sum, rank, loadHighScores(), this.role === 'client');
  }

  private endRun(quit = false): void {
    for (const h of this.heroes) {
      if (!h.peerId || h.left) continue;
      this.host?.send(h.peerId, { t: 'over', sum: this.summary(h) });
    }
    this.bankAndShow(this.summary(this.hero), quit);
  }

  // ------------------------------------------------------------------ level-ups (per hero, team XP)

  private gainXp(v: number): void {
    this.xp += v;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = xpForLevel(this.level);
      for (const h of this.heroes) {
        if (h.left) continue;
        h.pendingLevels++;
        h.synergy.levelUp();
      }
    }
  }

  private openLevelUp(): void {
    if (this.mode !== 'levelup') this.resumeMode = this.mode;
    this.mode = 'levelup';
    this.vfx.sound('levelUp', NaN, NaN);
    for (const h of this.heroes) {
      if (h.left) continue;
      if (h.needsPick) {
        h.offers = h.buildOffers();
        this.presentLevelUp(h);
      } else this.presentWait(h);
    }
  }

  private presentLevelUp(h: Hero): void {
    const view = { offers: h.offers, title: h.levelUpTitle(this.level), rerolls: h.rerollsLeft, loadout: h.loadout(), skip: h.skipGold };
    if (h === this.hero) this.screens.showLevelUp(view.offers, view.title, view.rerolls, view.loadout, view.skip);
    else this.tell(h, { t: 'lv', ...view });
  }

  private presentWait(h: Hero): void {
    const who = this.heroes.filter((x) => !x.left && (this.mode === 'shop' ? !x.shopDone : x.needsPick)).map((x) => x.name);
    if (h === this.hero) this.screens.showWait(who);
    else this.tell(h, { t: 'wait', who });
  }

  private presentShop(h: Hero, focus?: number): void {
    if (h === this.hero) {
      this.screens.showShop(h.shopView(this.stage), focus);
      return;
    }
    const v = h.shopView(this.stage);
    const net: NetShop = {
      ...v,
      offers: v.offers.map((o) => (o ? { id: o.def.id, price: o.price, hint: o.hint } : null)),
      owned: v.owned.map((o) => ({ id: o.def.id, sell: o.sell, readout: o.readout })),
    };
    this.tell(h, { t: 'shop', view: net, focus });
  }

  /** Send a message to a hero's player (no-op for the local hero). */
  private tell(h: Hero, msg: unknown): void {
    if (h.peerId && this.host) this.host.send(h.peerId, msg);
  }

  /** Menu actions from this machine: applied directly, or sent to the host. */
  private ui(a: string, i = 0, d: -1 | 1 = 1): void {
    if (this.role === 'client') {
      this.client?.send({ t: 'ui', a, i, d });
      return;
    }
    this.heroAction(this.hero, a, i, d);
  }

  /** Level-up and shop actions for any hero (host authority). */
  private heroAction(h: Hero, a: string, i: number, d: -1 | 1): void {
    if (this.mode === 'levelup' && h.needsPick) {
      if (a === 'pick') {
        const o = h.offers[i];
        if (!o) return;
        const color = h.applyOffer(o);
        h.consumePick();
        this.vfx.sound('powerUp', h.player.x, h.player.z);
        if (o.kind === 'evolve') this.evolveFx(h, o.name, color);
        this.afterPick(h, color);
      } else if (a === 'skip') {
        const g = h.skipGold;
        h.gold += g;
        h.consumePick();
        this.vfx.num(h.player.x, 2.6, h.player.z, `+${g}●`, 'score');
        this.vfx.sound('coin', h.player.x, h.player.z);
        this.afterPick(h, '#ffb627');
      } else if (a === 'reroll' && h.rerollsLeft > 0) {
        h.rerollsLeft--;
        h.offers = h.buildOffers();
        this.presentLevelUp(h);
      }
      return;
    }
    if (this.mode === 'shop' && !h.shopDone) {
      let err = '';
      if (a === 'buy') err = h.buy(i);
      else if (a === 'sell') err = h.sell(i);
      else if (a === 'move') h.moveMod(i, d);
      else if (a === 'sreroll') err = h.reroll();
      else if (a === 'heal') err = h.heal();
      else if (a === 'done') {
        h.shopDone = true;
        if (this.heroes.every((x) => x.left || x.shopDone)) this.closeShop();
        else for (const x of this.heroes) if (x.shopDone && !x.left) this.presentWait(x);
        return;
      }
      if (err) {
        if (h === this.hero) this.hud.toast(err);
        else this.tell(h, { t: 'toast', msg: err });
        return;
      }
      this.presentShop(h, a === 'buy' ? i : undefined);
    }
  }

  /** The big moment when a weapon evolves (level-up card or chest). */
  private evolveFx(h: Hero, name: string, color: string): void {
    const p = h.player;
    this.vfx.ring(p.x, p.z, 1, 9, color, 0.5);
    this.vfx.ring(p.x, p.z, 0.6, 6, '#ffffff', 0.35);
    this.vfx.burst(p.x, 1, p.z, { count: 40, color, color2: '#ffcd75', speed: [4, 10], size: [0.14, 0.34], life: [0.5, 1], up: 8, gravity: 10 });
    this.vfx.shake(p.x, p.z, 0.35);
    this.vfx.flash(0.35);
    this.vfx.banner('EVOLUTION!', (this.role === 'solo' ? '' : `${h.name.toUpperCase()}: `) + name.toUpperCase(), 1.8);
  }

  private afterPick(h: Hero, color: string): void {
    const p = h.player;
    this.vfx.burst(p.x, 1, p.z, { count: 20, color, color2: '#ffffff', speed: [3, 8], size: [0.12, 0.3], life: [0.4, 0.8], up: 6, gravity: 10 });
    this.checkAchievements();
    if (h.needsPick) {
      h.offers = h.buildOffers();
      this.presentLevelUp(h);
      return;
    }
    if (this.heroes.some((x) => !x.left && x.needsPick)) {
      for (const x of this.heroes) if (!x.left && !x.needsPick) this.presentWait(x);
      return;
    }
    // Everyone has picked: back to the action with a short grace for each hero.
    this.screens.show('none');
    for (const x of this.heroes) this.tell(x, { t: 'go' });
    this.mode = this.resumeMode;
    for (const x of this.aliveHeroes) {
      const q = x.player;
      q.invuln = Math.max(q.invuln, 0.6);
      this.vfx.ring(q.x, q.z, 1, 8, color, 0.35);
      for (const e of this.enemiesInRadius(q.x, q.z, 4, this.scratch)) {
        const dd = Math.hypot(e.x - q.x, e.z - q.z) || 1;
        e.kx += ((e.x - q.x) / dd) * 14 * (1 - e.def.knockbackResist);
        e.kz += ((e.z - q.z) / dd) * 14 * (1 - e.def.knockbackResist);
      }
    }
  }

  // ------------------------------------------------------------------ achievements (this machine's save)

  private checkAchievements(): void {
    const L = save.lifetime;
    const kills = L.kills + this.kills;
    const h = this.hero;
    const want: [string, boolean][] = [
      ['first_steps', kills >= 300],
      ['boss_slayer', this.bossesRun > 0 || this.stage > 1],
      ['elite_hunter', L.elites + this.elitesRun >= 5],
      ['exterminator', kills >= 3000],
      ['speedster', h.dashes >= 60],
      ['arsenal', h.weapons.length >= 6],
      ['maxed', h.weapons.some((w) => w.maxed)],
      ['evolved', h.weapons.some((w) => w.evolved)],
      ['stage_3', this.stage >= 3],
    ];
    for (const [id, ok] of want) {
      if (!ok) continue;
      const def = grantAchievement(id);
      if (!def) continue;
      this.newAchievements.push(id);
      const unlock = def.unlockWeapon ? ` - ${WEAPONS[def.unlockWeapon].name} unlocked!` : '';
      this.hud.toast(`★ ${def.name}${unlock}`, 4);
      sfx.powerUp();
    }
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    this.stepN++;
    if (this.role === 'client') {
      this.clientUpdate(dt);
      return;
    }
    const input = this.input;
    if (
      !this.paused &&
      this.isCombatMode &&
      this.screens.current === 'none' &&
      (input.keyPressed('Escape') || input.keyPressed('KeyP') || input.padButtonPressed(9))
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
    if (this.mode === 'levelup' && !switched) {
      for (let k = 0; k < 3; k++) if (input.keyPressed(`Digit${k + 1}`)) this.ui('pick', k);
      if (input.keyPressed('KeyR') || input.padButtonPressed(3)) this.ui('reroll');
    }
    if (frozen || switched) {
      input.endStep();
      this.hostTick(true);
      return;
    }
    if (this.juice.hitStop > 0) {
      this.juice.hitStop -= dt;
      this.hostTick(false);
      return;
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
  private simulate(dt: number, localControl: boolean): void {
    const anyAlive = this.aliveHeroes.length > 0;
    if (anyAlive) this.runTime += dt;

    for (const h of this.heroes) this.updateHero(h, dt, localControl);

    // Spatial hash first: weapons and enemies query it.
    this.hash.clear();
    for (const e of this.enemies.list) if (e.alive) this.hash.insert(e, e.x, e.z, e.radius);

    for (const h of this.heroes) {
      if (h.player.dead || h.left) continue;
      for (const w of h.weapons) w.update(dt, h.ctx);
      const buster = h.weapons[0] as Buster;
      if (h === this.hero && buster.muzzleT > 0.045) this.juice.kick(-h.player.aim.x, -h.player.aim.z, 2);
    }
    for (const h of this.heroes) this.updateBomb(h, dt);

    // Enemies chase the nearest living hero.
    this.targets.length = 0;
    for (const h of this.heroes) this.targets.push({ x: h.player.x, z: h.player.z, radius: h.player.radius, alive: !h.player.dead && !h.left });
    this.enemies.update(dt, this.enemyCtx);
    for (const h of this.heroes) if (!h.player.dead && !h.left) this.contactDamage(h);
    this.updateStatuses(dt);
    this.updateStrikes(dt);
    this.recycleFarEnemies(dt);

    this.updateBullets(dt);
    this.barrels.update(dt, (i, b) => this.explodeBarrel(i, b));
    this.collectors.length = 0;
    for (const h of this.heroes) this.collectors.push({ x: h.player.x, z: h.player.z, magnet: h.stats.magnet, alive: !h.player.dead && !h.left });
    this.pickups.update(dt, this.collectors, (t, v, who) => this.collect(this.heroes[who], t, v));
    this.updateChests();
    this.particles.update(dt);
    this.fx.update(dt);
    if (this.heroes.length > 1) this.updateRevives(dt);

    if (this.mode === 'fight' && this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    // Stage flow
    if (this.mode === 'fight' && anyAlive) {
      const reqs = this.director.update(dt, this.enemies.activeCount, (id) => this.enemies.countOf(id), this.rng);
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
  }

  /** Movement, aim and per-hero timers. Local hero reads Input; remote heroes follow their client. */
  private updateHero(h: Hero, dt: number, localControl: boolean): void {
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
        (input.keyPressed('Space') || input.keyPressed('ShiftLeft') || input.padButtonPressed(4) || input.padButtonPressed(6) || input.padButtonPressed(0));
      if (p.update(dt, control ? input : null, this.arena.colliders, wantDash)) this.onDash(h);
      const padFiring = input.padAim.x !== 0 || input.padAim.y !== 0 || input.padButton(7);
      h.ctx.firing = control && (input.mouseDown(0) || padFiring || (settings.autoFire && input.device === 'kbm'));
      h.ctx.charging = control && (input.mouseDown(2) || input.padButton(2));
      const wantBomb =
        control && (input.keyPressed('KeyQ') || input.keyPressed('KeyE') || input.mousePressed(1) || input.padButtonPressed(3) || input.padButtonPressed(5));
      if (wantBomb) this.tryBomb(h);
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
        p.setAimDir(r.ax, r.az);
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
    this.updateFootsteps(h, dt);
  }

  private updateTransition(): void {
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

  private mouseAimPoint(): THREE.Vector3 | null {
    this.ndc.set(this.input.mouse.ndcX, this.input.mouse.ndcY);
    this.raycaster.setFromCamera(this.ndc, this.cam.camera);
    return this.raycaster.ray.intersectPlane(this.aimPlane, this.aimHit);
  }

  private onDash(h: Hero): void {
    const p = h.player;
    h.dashes++;
    h.synergy.dash();
    this.vfx.sound('dash', p.x, p.z);
    if (h === this.hero) this.juice.shake(0.05);
    this.vfx.ring(p.x, p.z, 1, 3, '#4fc3ff', 0.25);
    this.vfx.burst(p.x, 0.15, p.z, { count: 10, color: '#ffffff', color2: '#e8f4ff', speed: [2, 5], size: [0.12, 0.25], life: [0.2, 0.4], up: 1.5, gravity: 6 });
    if (h === this.hero && h.dashes === 60) this.checkAchievements();
  }

  private footTimers = new Map<Hero, number>();
  private updateFootsteps(h: Hero, dt: number): void {
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

  private reviveHero(h: Hero, hpFrac: number, effects = true): void {
    const p = h.player;
    p.dead = false;
    p.hp = Math.max(1, p.maxHp * hpFrac);
    p.invuln = 2;
    p.rig.root.visible = true;
    h.reviveT = 0;
    if (effects) {
      this.vfx.ring(p.x, p.z, 1, 6, '#7dffb0', 0.4);
      this.vfx.burst(p.x, 1, p.z, { count: 24, color: '#7dffb0', color2: '#ffffff', speed: [3, 8], size: [0.12, 0.3], life: [0.4, 0.8], up: 6, gravity: 10 });
      this.vfx.num(p.x, 2.6, p.z, 'REVIVED!', 'heal');
      this.vfx.sound('powerUp', p.x, p.z);
    }
  }

  /** Stand next to a downed teammate to revive them. */
  private updateRevives(dt: number): void {
    for (const h of this.heroes) {
      if (!h.player.dead || h.left) continue;
      const near = this.aliveHeroes.some((o) => Math.hypot(o.player.x - h.player.x, o.player.z - h.player.z) < REVIVE_RANGE);
      h.reviveT = near ? h.reviveT + dt : Math.max(0, h.reviveT - dt * 0.5);
      if (h.reviveT >= REVIVE_TIME) this.reviveHero(h, 0.4);
    }
  }

  // ------------------------------------------------------------------ spawning

  /** A point on a ring just off-screen around a living hero, inside the arena and not in a wall. */
  private ringPoint(rMin: number, rMax: number, r = 0.6): { x: number; z: number } | null {
    const alive = this.aliveHeroes;
    if (!alive.length) return null;
    const p = alive[Math.floor(this.rng.next() * alive.length)].player;
    const lim = this.arena.halfSize - 3;
    // Bias spawns toward where the hero is heading so running away isn't free.
    const heading = Math.atan2(p.vel.z, p.vel.x);
    const moving = p.speed > 1;
    for (let i = 0; i < 10; i++) {
      const a = moving && this.rng.chance(0.5) ? heading + this.rng.range(-1, 1) : this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(rMin, rMax);
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      if (this.walls.hitCircle(x, z, r)) continue;
      return { x, z };
    }
    return null;
  }

  private spawnEnemy(def: EnemyDef, elite = false, near: { x: number; z: number } | null = null) {
    let pos: { x: number; z: number } | null = null;
    if (near) {
      const x = near.x + this.rng.range(-1.6, 1.6);
      const z = near.z + this.rng.range(-1.6, 1.6);
      if (!this.walls.hitCircle(x, z, def.radius)) pos = { x, z };
    }
    pos ??= this.ringPoint(18, 24, def.radius * (elite ? 1.6 : 1) + 0.2);
    if (!pos) return null;
    this.enemies.spawn(def, pos.x, pos.z, this.spawnOpts({ elite }));
    if (elite) {
      this.vfx.toast(`ELITE ${def.name.toUpperCase()} INCOMING!`);
      this.vfx.sound('elite', NaN, NaN);
    }
    return pos;
  }

  private spawnRing(def: EnemyDef, count: number): void {
    const alive = this.aliveHeroes;
    if (!alive.length) return;
    const p = alive[Math.floor(this.rng.next() * alive.length)].player;
    const lim = this.arena.halfSize - 2;
    const R = 15;
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = p.x + Math.cos(a) * R;
      const z = p.z + Math.sin(a) * R;
      if (Math.abs(x) > lim || Math.abs(z) > lim || this.walls.hitCircle(x, z, def.radius)) continue;
      this.enemies.spawn(def, x, z, this.spawnOpts());
      placed++;
    }
    if (placed > 0) {
      this.vfx.toast('SURROUNDED!');
      this.vfx.sound('wave', p.x, p.z);
    }
  }

  private spawnBoss(def: EnemyDef): void {
    const p = (this.aliveHeroes[0] ?? this.hero).player;
    const pos = this.ringPoint(13, 16, def.radius + 0.5) ?? { x: p.x + 12, z: p.z };
    this.boss = this.enemies.spawn(def, pos.x, pos.z, this.spawnOpts({ hpMul: this.director.bossHpMul }));
    this.vfx.banner('WARNING!', `${def.name.toUpperCase()} APPROACHES`, 2.2);
    this.vfx.sound('boss', NaN, NaN);
    this.vfx.shake(NaN, NaN, 0.6);
  }

  /** Keep the action near the heroes: enemies far from everyone re-enter ahead. */
  private recycleFarEnemies(dt: number): void {
    this.recycleT -= dt;
    if (this.recycleT > 0 || this.mode !== 'fight') return;
    this.recycleT = 0.5;
    const alive = this.aliveHeroes;
    if (!alive.length) return;
    for (const e of this.enemies.list) {
      if (!e.alive || e.elite || e.def.boss || e.def.behavior === 'spawner') continue;
      if (alive.some((h) => Math.hypot(e.x - h.player.x, e.z - h.player.z) < RECYCLE_DIST)) continue;
      const pos = this.ringPoint(18, 24, e.radius + 0.2);
      if (!pos) continue;
      e.x = e.px = pos.x;
      e.z = e.pz = pos.z;
      e.kx = e.kz = 0;
    }
  }

  // ------------------------------------------------------------------ combat

  private nearestEnemy(x: number, z: number, r: number, skip?: (e: Enemy) => boolean): Enemy | null {
    let best: Enemy | null = null;
    let bd = r * r;
    this.hash.query(x, z, r, (e) => {
      if (!e.alive || e.hp <= 0 || (skip && skip(e))) return;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    });
    return best;
  }

  private enemiesInRadius(x: number, z: number, r: number, out: Enemy[]): Enemy[] {
    out.length = 0;
    this.hash.query(x, z, r + 1, (e) => {
      if (!e.alive || e.hp <= 0) return;
      const rr = r + e.radius;
      if ((e.x - x) ** 2 + (e.z - z) ** 2 < rr * rr && !out.includes(e)) out.push(e);
    });
    return out;
  }

  /** All damage to enemies, credited to the hero who dealt it. */
  private damage(e: Enemy, base: number, o: DamageOpts, by: Hero): number {
    if (!e.active || e.hp <= 0) return 0;
    const tags: readonly Tag[] = o.tags ?? WEAPONS[o.source]?.tags ?? [];
    const crit = !!o.canCrit && this.rng.chance(by.stats.critChance);
    const ev = { e, source: o.source, tags, dist: Math.hypot(e.x - by.player.x, e.z - by.player.z), crit };
    // Stats first, then Mods left to right, then statuses and crit.
    let amount = by.synergy.damage(ev, base * by.stats.damageMul);
    if (e.frozen > 0 && e.shatter > 0) amount *= 1 + e.shatter;
    if (e.shockT > 0) amount *= 1 + statusTuning.shockMult + by.synergy.flags.shockMult;
    if (crit) amount *= by.stats.critMult;
    amount = Math.max(1, Math.round(amount));
    e.hp -= amount;
    by.damageBy[o.source] = (by.damageBy[o.source] ?? 0) + amount;
    e.flash = 0.07;
    const k = (o.knockback ?? 0) * by.stats.knockbackMul * (1 - e.def.knockbackResist) * (crit ? 1.5 : 1);
    if (k > 0) {
      e.kx += (o.dirX ?? 0) * k;
      e.kz += (o.dirZ ?? 0) * k;
    }
    e.squash(crit ? -6 : -3);
    const hx = o.hx ?? e.x;
    const hz = o.hz ?? e.z;
    if (crit) {
      this.vfx.num(e.x, 1.9 * e.scale, e.z, `${amount}!`, 'crit');
      this.vfx.sound('crit', e.x, e.z);
      this.vfx.star(hx, BULLET_Y, hz, 1.5, '#fff35c', 0.12);
    } else if (o.loud) {
      this.vfx.num(e.x, 1.7 * e.scale, e.z, amount);
      this.vfx.sound('hit', e.x, e.z, this.pitch);
      this.vfx.star(hx, BULLET_Y, hz, 0.85, '#ffffff', 0.08);
    }
    if (o.loud || crit) {
      this.vfx.burst(hx, BULLET_Y, hz, { count: 3, color: '#ffffff', color2: e.def.bodyColor, speed: [3, 7], size: [0.1, 0.18], life: [0.12, 0.25], dir: { x: -(o.dirX ?? 0), z: -(o.dirZ ?? 0), spread: 2.4 } });
    }
    // Statuses from the weapon's own tags, then Mod triggers.
    if (!o.noStatus && e.hp > 0) {
      if (tags.includes('fire')) this.ignite(e, Math.max(3, amount * 0.15), by);
      if (tags.includes('shock')) this.shock(e, by);
    }
    if (!o.noStatus) {
      by.synergy.hit(ev);
      if (crit) by.synergy.crit(ev);
    }
    if (e.hp <= 0 && e.active) this.killEnemy(e, o.source, by);
    return amount;
  }

  // ------------------------------------------------------------------ statuses and combos

  ignite(e: Enemy, dps: number, by: Hero): void {
    if (!e.active || e.hp <= 0) return;
    e.burnT = statusTuning.burnTime;
    e.burnDps = Math.max(e.burnDps, dps);
    e.burnOwner = by.index;
    if (e.shockT > 0) this.overload(e, by);
  }

  shock(e: Enemy, by: Hero): void {
    if (!e.active || e.hp <= 0) return;
    e.shockT = statusTuning.shockTime + by.synergy.flags.shockTime;
    if (e.burnT > 0) this.overload(e, by);
  }

  /** Burn + Shock on the same enemy: consume both for a blast. */
  private overload(e: Enemy, by: Hero): void {
    e.burnT = e.shockT = 0;
    e.burnDps = 0;
    this.overloads++;
    const m = 1 + by.synergy.flags.overloadMult;
    if (this.overloads % 3 === 1) this.vfx.num(e.x, 2.2, e.z, 'OVERLOAD!', 'crit');
    this.blast(e.x, e.z, 1.8 * Math.sqrt(m), statusTuning.overloadDamage * m, '#ffe14d', 'overload', ['explosive'], true, by);
  }

  /** Frozen enemy killed: ice shards burst out. */
  private shatter(e: Enemy, by: Hero): void {
    const m = 1 + by.synergy.flags.shatterMult;
    this.vfx.burst(e.x, 0.8, e.z, { count: 10, color: '#ffffff', color2: '#9fe8ff', speed: [5, 10], size: [0.1, 0.25], life: [0.2, 0.4], up: 3, gravity: 10 });
    this.vfx.ring(e.x, e.z, 1, 4, '#9fe8ff', 0.2);
    for (const o of this.enemiesInRadius(e.x, e.z, 2, this.scratch).slice()) {
      if (o === e) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z) || 1;
      this.damage(o, statusTuning.shatterDamage * m, { source: 'shatter', tags: ['frost'], dirX: (o.x - e.x) / d, dirZ: (o.z - e.z) / d, knockback: 4, noStatus: true }, by);
    }
  }

  /** Lightning arc from an enemy through nearby ones (Mods: Crit Cascade). */
  zap(from: Enemy, hops: number, dmg: number, by: Hero): void {
    const hit = new Set<number>([from.uid]);
    let cur: Enemy = from;
    for (let i = 0; i < hops; i++) {
      const next = this.nearestEnemy(cur.x, cur.z, 5, (o) => hit.has(o.uid));
      if (!next) break;
      hit.add(next.uid);
      for (let k = 1; k < 5; k++) {
        const t = k / 5;
        this.vfx.burst(cur.x + (next.x - cur.x) * t, 1, cur.z + (next.z - cur.z) * t, { count: 1, color: '#fff35c', color2: '#ffffff', speed: [0, 0.5], size: [0.12, 0.2], life: [0.08, 0.14] });
      }
      this.vfx.star(next.x, 1, next.z, 1, '#fff35c', 0.1);
      this.damage(next, dmg, { source: 'zap', tags: ['chain', 'shock'] }, by);
      cur = next;
    }
  }

  /** Burn damage ticks and status timers. */
  private updateStatuses(dt: number): void {
    for (const e of this.enemies.list) {
      if (!e.active) continue;
      if (e.shockT > 0) e.shockT -= dt;
      if (e.burnT <= 0) continue;
      e.burnT -= dt;
      e.burnAcc += dt;
      if (e.burnAcc < 0.5) continue;
      e.burnAcc = 0;
      if (this.rng.chance(0.5)) this.vfx.burst(e.x, 0.6 + e.radius, e.z, { count: 1, color: '#ff7a2f', color2: '#ffd23f', speed: [0.2, 1], size: [0.15, 0.3], life: [0.3, 0.5], up: 2, drag: 2 });
      const by = this.heroes[e.burnOwner] ?? this.hero;
      this.damage(e, e.burnDps * 0.5, { source: 'burn', tags: ['fire'], noStatus: true }, by);
      if (e.burnT <= 0) e.burnDps = 0;
    }
  }

  private sourceName(id: string): string {
    const named: Record<string, string> = { bomb: 'Bomb', burn: 'Burning', shatter: 'Shatter', overload: 'Overload', zap: 'Crit Zaps', exploder: 'Enemy blasts', charge: 'Charge Shot', barrel: 'Barrels' };
    return WEAPONS[id]?.name ?? MOD_BY_ID[id]?.name ?? named[id] ?? 'Other';
  }

  private killEnemy(e: Enemy, source: string, by: Hero | null): void {
    const def = e.def;
    const wasFrozen = e.frozen > 0;
    this.kills++;
    this.combo++;
    this.comboT = scoreTuning.comboWindow;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += def.score * this.multiplier * (e.elite ? 5 : 1);
    const xp = def.xp * (e.elite ? 10 : 1);
    if (by) by.bombCharge = Math.min(1, by.bombCharge + bombTuning.chargePerXp * xp);

    // Drops
    this.pickups.spawn(PickupType.Gem, e.x, e.z, xp * dropTuning.xpMul);
    const isBoss = !!def.boss;
    const big = e.elite || isBoss;
    if (big) {
      // Every hero gets a chest from bosses; elites drop one.
      const chests = isBoss ? Math.max(1, this.heroes.filter((h) => !h.left).length) : 1;
      for (let i = 0; i < chests; i++) this.pickups.spawn(PickupType.Chest, e.x + i * 0.8, e.z);
      for (let i = 0; i < (isBoss ? 6 : 2); i++) this.pickups.spawn(PickupType.Bolt, e.x, e.z, 1);
      if (e.elite) this.elitesRun++;
    } else {
      if (this.rng.chance(dropTuning.goldChance)) this.pickups.spawn(PickupType.Bolt, e.x, e.z, 1);
      if (this.rng.chance(dropTuning.heartChance)) this.pickups.spawn(PickupType.Heart, e.x, e.z);
      if (this.rng.chance(dropTuning.magnetChance)) this.pickups.spawn(PickupType.Magnet, e.x, e.z);
    }

    // Feedback scales with importance; swarm kills stay light so hundreds don't stutter.
    const r = e.radius;
    const y = r + 0.1 + e.hopY;
    this.vfx.sound('enemyDie', e.x, e.z, this.pitch);
    this.vfx.burst(e.x, y, e.z, { count: big ? 40 : def.xp >= 3 ? 12 : 6, color: def.bodyColor, color2: def.accentColor, speed: [3, 9], size: [0.15, 0.3 + r * 0.15], life: [0.3, 0.6], up: 5, gravity: 18, drag: 2 });
    if (def.xp >= 3 || big || this.rng.chance(0.25)) this.vfx.ring(e.x, e.z, r * 2, 3, def.bodyColor, 0.25);
    if (big) {
      this.juice.freeze(isBoss ? 0.3 : 0.08);
      this.vfx.shake(e.x, e.z, isBoss ? 1 : 0.4);
      this.vfx.star(e.x, y + 0.3, e.z, r * 3, '#ffffff', 0.18);
      this.vfx.flash(isBoss ? 0.8 : 0.2);
      this.vfx.sound('explode', e.x, e.z);
    } else if (def.xp >= 4) this.vfx.shake(e.x, e.z, 0.08);
    if (this.combo % 50 === 0) this.vfx.num(e.x, 3, e.z, `${this.combo} COMBO!`, 'score');

    if (def.split) {
      for (let i = 0; i < def.split.count; i++) {
        const a = (i / def.split.count) * Math.PI * 2;
        this.enemyCtx.spawnChild(def.split.into, e.x + Math.cos(a) * 0.8, e.z + Math.sin(a) * 0.8, e);
      }
    }
    this.enemies.kill(e);
    // Combos and Mod triggers after the kill is resolved (they may kill more).
    if (by) {
      if (wasFrozen) this.shatter(e, by);
      by.synergy.kill(e, source);
    }
    if (this.kills === 300 || this.kills % 1000 === 0) this.checkAchievements();
  }

  blast(x: number, z: number, r: number, base: number, color: string, source: string, tags: Tag[] = ['explosive'], noStatus = false, by: Hero = this.hero): void {
    const explosive = tags.includes('explosive');
    if (explosive) r *= 1 + by.synergy.flags.explosiveArea * by.synergy.tagCount('explosive');
    this.vfx.sound('explode', x, z);
    this.vfx.ring(x, z, 1, r * 2, color, 0.25);
    this.vfx.star(x, 1, z, r, color, 0.12);
    this.vfx.burst(x, 0.6, z, { count: 8, color, color2: '#fff35c', speed: [3, 8], size: [0.15, 0.3], life: [0.2, 0.45], up: 4, gravity: 12 });
    if (this.authority) this.barrels.igniteNear(x, z, r, by.index);
    const targets = this.enemiesInRadius(x, z, r, this.scratch).slice();
    // Napalm: an explosion that catches a burning enemy sets the whole blast alight.
    const napalm = explosive && !noStatus && targets.some((e) => e.burnT > 0);
    if (napalm) this.vfx.ring(x, z, 1, r * 2.2, '#ff5e3a', 0.35);
    for (const e of targets) {
      const d = Math.hypot(e.x - x, e.z - z) || 1;
      this.damage(e, base, { source, tags, dirX: (e.x - x) / d, dirZ: (e.z - z) / d, knockback: 8, canCrit: true, noStatus }, by);
      if (napalm && e.active) this.ignite(e, statusTuning.napalmDps, by);
    }
  }

  /** A barrel blows up: big fiery blast credited to whoever lit it; neighbours follow. */
  private explodeBarrel(i: number, b: Barrel): void {
    this.removeBarrelCollider(b);
    this.host?.broadcast({ t: 'barrel', i });
    const by = this.heroes[b.by] ?? this.hero;
    const R = barrelTuning.radius;
    this.vfx.shake(b.x, b.z, 0.45);
    this.vfx.ring(b.x, b.z, 1, R * 2.3, '#ffb627', 0.35);
    this.vfx.burst(b.x, 0.8, b.z, { count: 26, color: '#ff4d5e', color2: '#ffd23f', speed: [5, 12], size: [0.2, 0.45], life: [0.35, 0.7], up: 7, gravity: 14 });
    this.vfx.burst(b.x, 1.2, b.z, { count: 10, color: '#3a3d5c', color2: '#8a90c8', speed: [1, 3], size: [0.4, 0.7], life: [0.6, 1.0], up: 3, drag: 2 });
    this.vfx.num(b.x, 2.4, b.z, 'KABOOM!', 'crit');
    if (by === this.hero) this.juice.freeze(0.04);
    this.blast(b.x, b.z, R, barrelTuning.damage * (1 + 0.6 * (this.stage - 1)), '#ff7a2f', 'barrel', ['explosive', 'fire'], false, by);
    // Everything caught in it is set on fire.
    for (const e of this.enemiesInRadius(b.x, b.z, R, this.scratch).slice()) this.ignite(e, 10, by);
  }

  private removeBarrelCollider(b: Barrel): void {
    const k = this.arena.colliders.indexOf(b.box);
    if (k >= 0) this.arena.colliders.splice(k, 1);
    this.walls = new StaticBoxGrid(this.arena.colliders);
  }

  /** Exploder enemy goes off: hurts heroes and other enemies nearby. */
  private detonate(e: Enemy): void {
    const F = e.def.fuse!;
    const R = F.radius * e.scale;
    this.vfx.ring(e.x, e.z, 1, R * 2, '#ff3d5a', 0.3);
    this.vfx.star(e.x, 1, e.z, R * 1.2, '#ffb627', 0.15);
    this.vfx.burst(e.x, 0.6, e.z, { count: 14, color: '#ff9f3d', color2: '#3a3d5c', speed: [4, 9], size: [0.15, 0.35], life: [0.3, 0.6], up: 5, gravity: 14 });
    this.vfx.sound('explode', e.x, e.z);
    this.vfx.shake(e.x, e.z, 0.3);
    this.barrels.igniteNear(e.x, e.z, R, 0);
    for (const h of this.aliveHeroes) {
      if (Math.hypot(h.player.x - e.x, h.player.z - e.z) < R + h.player.radius) this.hurtHero(h, F.damage * e.dmgMul, e.x, e.z);
    }
    for (const o of this.enemiesInRadius(e.x, e.z, R, this.scratch).slice()) {
      if (o === e) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z) || 1;
      this.damage(o, 40, { source: 'exploder', dirX: (o.x - e.x) / d, dirZ: (o.z - e.z) / d, knockback: 10 }, this.hero);
    }
    if (e.active) this.killEnemy(e, 'exploder', null);
  }

  private updateStrikes(dt: number): void {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t -= dt;
      if (s.t > 0) continue;
      this.strikes.splice(i, 1);
      this.vfx.ring(s.x, s.z, 1, (s.r * 2.2) / 0.46 / 2, '#ff7a2f', 0.3);
      this.vfx.star(s.x, 0.8, s.z, s.r * 1.2, '#ffb627', 0.12);
      this.vfx.burst(s.x, 0.4, s.z, { count: 10, color: '#ff3df0', color2: '#ffd23f', speed: [3, 8], size: [0.15, 0.3], life: [0.25, 0.5], up: 6, gravity: 14 });
      this.vfx.sound('explode', s.x, s.z);
      this.vfx.shake(s.x, s.z, 0.2);
      for (const h of this.aliveHeroes) {
        if (Math.hypot(h.player.x - s.x, h.player.z - s.z) < s.r + h.player.radius * 0.6) this.hurtHero(h, s.dmg, s.x, s.z);
      }
    }
  }

  private bossSlam(e: Enemy): void {
    const R = 3.8;
    this.vfx.sound('bomb', e.x, e.z);
    this.vfx.shake(e.x, e.z, 0.8);
    this.juice.freeze(0.06);
    this.vfx.ring(e.x, e.z, 1, R * 2.4, '#ff3d5a', 0.4);
    this.vfx.ring(e.x, e.z, 1, R * 1.6, '#ffffff', 0.3);
    this.vfx.burst(e.x, 0.3, e.z, { count: 30, color: '#f2e2b8', color2: '#ffffff', speed: [5, 12], size: [0.2, 0.4], life: [0.4, 0.8], up: 4, gravity: 10 });
    for (const h of this.aliveHeroes) {
      if (Math.hypot(h.player.x - e.x, h.player.z - e.z) < R + h.player.radius) this.hurtHero(h, 30 * e.dmgMul, e.x, e.z);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.enemyCtx.fireBullet(e, Math.cos(a), Math.sin(a), 8, 12);
    }
  }

  private contactDamage(h: Hero): void {
    const p = h.player;
    if (p.invuln > 0) return;
    let worst: Enemy | null = null;
    let dmg = 0;
    this.hash.query(p.x, p.z, 2.5, (e) => {
      if (!e.alive || e.frozen > 0 || e.hopY > 0.5) return;
      const rr = e.radius + p.radius;
      if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 > rr * rr) return;
      const d = e.contactDamage * (e.state === 'attack' ? 1.5 : 1);
      if (d > dmg) {
        dmg = d;
        worst = e;
      }
    });
    const w = worst as Enemy | null;
    if (w) this.hurtHero(h, dmg, w.x, w.z);
  }

  private hurtHero(h: Hero, raw: number, fromX: number, fromZ: number): void {
    const p = h.player;
    if (cheats.god || p.dead || p.invuln > 0) return;
    const dmg = Math.max(1, Math.round(raw - h.stats.armor));
    const dx = p.x - fromX;
    const dz = p.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    if (!p.hurt(dmg, dx / d, dz / d)) return;
    this.damagedThisStage = true;
    h.synergy.hurt();
    if (this.combo >= 25) this.vfx.num(p.x, 3, p.z, 'COMBO BREAK', 'player');
    this.combo = 0;
    this.vfx.sound('playerHurt', p.x, p.z);
    if (h === this.hero) {
      this.hud.hurt();
      this.juice.freeze(0.06);
      this.juice.shake(0.35);
      this.juice.kick(dx / d, dz / d, 6);
    } else this.tell(h, { t: 'hurt', dx: dx / d, dz: dz / d });
    this.vfx.num(p.x, 2.2, p.z, dmg, 'player');
    this.vfx.star(p.x, 1.1, p.z, 2, '#ff3d5a', 0.15);
    this.vfx.burst(p.x, 1, p.z, { count: 10, color: '#ff3d5a', color2: '#ffffff', speed: [3, 8], size: [0.12, 0.25], life: [0.2, 0.4], up: 3, gravity: 12 });
    if (p.dead) this.onHeroDown(h);
  }

  private onHeroDown(h: Hero): void {
    const p = h.player;
    if (h.revivesLeft > 0) {
      h.revivesLeft--;
      this.reviveHero(h, 0.5, false);
      h.bombCharge = 1;
      this.tryBomb(h);
      this.vfx.banner('SECOND WIND!', `${h.name} is back on their feet`, 1.6);
      return;
    }
    this.vfx.sound('playerDie', p.x, p.z);
    this.vfx.shake(p.x, p.z, 1);
    this.vfx.ring(p.x, p.z, 1, 10, h.color, 0.6);
    this.vfx.burst(p.x, 1, p.z, { count: 40, color: h.color, color2: '#ffd23f', speed: [4, 12], size: [0.2, 0.45], life: [0.6, 1.2], up: 7, gravity: 16, drag: 1.5 });
    if (h === this.hero) {
      this.juice.freeze(0.25);
      this.hud.flash(0.5);
    }
    if (this.aliveHeroes.length === 0) {
      this.mode = 'dead';
      this.modeT = 0;
      this.gameOverShown = false;
    } else this.vfx.toast(`${h.name.toUpperCase()} IS DOWN! STAND NEXT TO THEM TO REVIVE`, 3);
  }

  private collect(h: Hero, type: PickupType, value: number): void {
    const p = h.player;
    switch (type) {
      case PickupType.Gem:
        this.gainXp(value * h.stats.xpMul);
        h.synergy.gem(value);
        this.vfx.sound('gem', p.x, p.z);
        break;
      case PickupType.Bolt: {
        const g = Math.max(1, Math.round(value * (1 + h.synergy.flags.goldMul)));
        h.gold += g;
        this.vfx.sound('coin', p.x, p.z);
        this.vfx.num(p.x, 2.4, p.z, `+${g}●`, 'score');
        break;
      }
      case PickupType.Heart: {
        const healed = p.heal(30);
        this.vfx.sound('heal', p.x, p.z);
        if (healed > 0) this.vfx.num(p.x, 2.4, p.z, `+${Math.round(healed)}`, 'heal');
        break;
      }
      case PickupType.Magnet:
        this.pickups.vacuum = true;
        this.vfx.sound('heal', p.x, p.z);
        this.vfx.toast('MAGNET!');
        break;
      case PickupType.Chest:
        h.chestsPending++;
        h.gold += 2;
        this.vfx.sound('chest', p.x, p.z);
        if (h === this.hero) this.hud.flash(0.3);
        break;
    }
  }

  private updateBullets(dt: number): void {
    const b = this.bullets;
    b.integrate(dt);
    for (let i = 0; i < b.count; i++) {
      const x = b.x[i];
      const z = b.z[i];
      if (b.life[i] <= 0) {
        this.bulletBlast(i);
        b.kill(i--);
        continue;
      }
      if (b.team[i] === Team.Player) {
        const bi = this.barrels.hitTest(x, z, b.radius[i]);
        if (bi >= 0) {
          this.barrels.hit(bi, b.damage[i], b.owner[i]);
          this.vfx.star(x, BULLET_Y, z, 0.9, '#ffd23f', 0.08);
          this.vfx.sound('hit', x, z, 0.8);
          b.kill(i--);
          continue;
        }
      }
      if (this.walls.hitCircle(x, z, b.radius[i])) {
        this.vfx.burst(b.px[i], BULLET_Y, b.pz[i], { count: 3, color: '#ffffff', color2: b.team[i] === Team.Enemy ? '#ff3df0' : '#fff36b', speed: [2, 6], size: [0.08, 0.15], life: [0.1, 0.25], up: 2, gravity: 10 });
        this.bulletBlast(i);
        b.kill(i--);
        continue;
      }
      if (b.team[i] === Team.Enemy) {
        for (const h of this.heroes) {
          const p = h.player;
          if (p.dead || h.left || p.invuln > 0) continue;
          const rr = b.radius[i] + p.radius * 0.8;
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < rr * rr) {
            this.hurtHero(h, b.damage[i], b.px[i], b.pz[i]);
            b.kill(i--);
            break;
          }
        }
        continue;
      }
      let hit = null as Enemy | null;
      const r = b.radius[i];
      const last = b.lastHit[i];
      this.hash.query(x, z, r, (e) => {
        if (hit || !e.alive || e.hp <= 0 || e.uid === last) return;
        const rr = e.radius + r;
        if ((e.x - x) ** 2 + (e.z - z) ** 2 < rr * rr) hit = e;
      });
      if (hit) {
        const sp = Math.hypot(b.vx[i], b.vz[i]) || 1;
        const by = this.heroes[b.owner[i]] ?? this.hero;
        const source = b.kind[i] === 1 ? 'charge' : 'buster';
        this.damage(hit, b.damage[i], { source, tags: b.kind[i] === 1 ? CHARGE_TAGS : undefined, dirX: b.vx[i] / sp, dirZ: b.vz[i] / sp, knockback: b.knockback[i], hx: x, hz: z, canCrit: true, loud: true }, by);
        if (b.pierce[i] > 0) {
          b.pierce[i]--;
          b.lastHit[i] = hit.uid;
        } else {
          this.bulletBlast(i);
          b.kill(i--);
        }
      }
    }
  }

  /** Walk into a treasure chest to open it; closed chests sparkle near players. */
  private updateChests(): void {
    if (!this.isCombatMode) return;
    for (const h of this.aliveHeroes) {
      const i = this.chests.touching(h.player.x, h.player.z);
      if (i >= 0) this.openChest(i, h);
    }
    if (this.stepN % 40 !== 0) return;
    for (const c of this.chests.list) {
      if (c.openT >= 0 || !this.aliveHeroes.some((h) => Math.hypot(h.player.x - c.x, h.player.z - c.z) < 30)) continue;
      this.vfx.burst(c.x, 0.9, c.z, { count: 2, color: '#ffcd75', color2: '#f4f4f4', speed: [0.4, 1.4], size: [0.1, 0.18], life: [0.5, 0.9], up: 2.5, drag: 1 });
    }
  }

  private openChest(i: number, h: Hero): void {
    const c = this.chests.open(i);
    if (!c) return;
    this.host?.broadcast({ t: 'wchest', i });
    const item = h.chestItem();
    this.vfx.sound('chest', c.x, c.z);
    this.vfx.ring(c.x, c.z, 1, 5, '#ffcd75', 0.35);
    this.vfx.burst(c.x, 0.8, c.z, { count: 22, color: '#ffcd75', color2: item.color, speed: [3, 7], size: [0.12, 0.28], life: [0.4, 0.8], up: 7, gravity: 12 });
    this.vfx.num(c.x, 2.6, c.z, `${item.name} ${item.text}`, 'crit');
    if (item.evolved) this.evolveFx(h, item.name, item.color);
    const msg = `CHEST: ${item.name.toUpperCase()} ${item.text}`;
    if (h === this.hero) {
      this.hud.toast(msg, 3);
      this.hud.flash(0.25);
    } else this.tell(h, { t: 'toast', msg });
    this.checkAchievements();
  }

  /** Full-charge shots explode where they end. */
  private bulletBlast(i: number): void {
    const b = this.bullets;
    if (b.team[i] !== Team.Player || b.blast[i] <= 0) return;
    const by = this.heroes[b.owner[i]] ?? this.hero;
    this.vfx.shake(b.x[i], b.z[i], 0.25);
    this.blast(b.x[i], b.z[i], b.blast[i], b.damage[i] * 0.6, this.bullets.colorOf(i), 'charge', ['projectile', 'explosive'], false, by);
  }

  private tryBomb(h: Hero): void {
    if (h.bombCharge < 1 || h.bombT >= 0 || h.player.dead) return;
    const p = h.player;
    h.bombCharge = 0;
    h.bombT = 0;
    h.bombId = (h.bombId + 1) % 1000;
    h.bombX = p.x;
    h.bombZ = p.z;
    p.invuln = Math.max(p.invuln, 0.6);
    this.vfx.sound('bomb', p.x, p.z);
    if (h === this.hero) this.hud.flash(0.9);
    this.vfx.shake(p.x, p.z, 0.9);
    this.juice.freeze(0.06);
    const R = bombTuning.radius;
    this.vfx.ring(p.x, p.z, 1, R * 2, '#ff3df0', bombTuning.duration + 0.15);
    this.vfx.ring(p.x, p.z, 1, R * 1.6, '#ffffff', bombTuning.duration);
    this.vfx.star(p.x, 1.2, p.z, 5, '#ffffff', 0.2);
    for (let i = 0; i < this.bullets.count; i++) {
      if (this.bullets.team[i] === Team.Enemy && Math.hypot(this.bullets.x[i] - p.x, this.bullets.z[i] - p.z) < R * 1.5) this.bullets.kill(i--);
    }
  }

  private updateBomb(h: Hero, dt: number): void {
    if (h.bombT < 0) return;
    h.bombT += dt;
    const k = Math.min(1, h.bombT / bombTuning.duration);
    const r = bombTuning.radius * (1 - (1 - k) * (1 - k));
    const stamp = h.index * 1000 + h.bombId + 1;
    for (const e of this.enemies.list) {
      if (!e.alive || e.hp <= 0 || e.bombStamp === stamp) continue;
      const dx = e.x - h.bombX;
      const dz = e.z - h.bombZ;
      const d = Math.hypot(dx, dz);
      if (d > r + e.radius) continue;
      e.bombStamp = stamp;
      const n = d || 1;
      this.damage(e, bombTuning.damage, { source: 'bomb', dirX: dx / n, dirZ: dz / n, knockback: bombTuning.knockback }, h);
    }
    if (k >= 1) h.bombT = -1;
  }

  // ------------------------------------------------------------------ online: lobby

  private async hostGame(name: string): Promise<void> {
    this.saveName(name);
    this.leaveToTitle();
    this.role = 'host';
    const host = new NetHost(3);
    this.host = host;
    this.lobby = [{ peerId: '', name, unlocked: unlockedWeapons() }];
    this.screens.setLobby({ code: '', players: [], isHost: true, status: 'Creating game...' });
    host.onMessage = (from, msg) => this.onHostMessage(from, msg as Record<string, unknown>);
    host.onLeave = (id) => this.onClientLeft(id);
    host.onError = (msg) => this.screens.setLobby({ code: '', players: [], isHost: true, status: msg });
    try {
      await host.ready;
    } catch {
      return;
    }
    if (this.host !== host) return;
    this.refreshLobby();
  }

  private refreshLobby(): void {
    if (!this.host) return;
    const players = this.lobby.map((p, i) => ({ name: p.name, color: HERO_COLORS[i] }));
    this.screens.setLobby({ code: this.host.code, players, isHost: true, status: players.length > 1 ? 'Ready when you are!' : 'Share the code with your friends' });
    this.host.broadcast({ t: 'lobby', players, code: this.host.code });
  }

  private hostStart(): void {
    if (this.role !== 'host' || !this.host) return;
    const heroes = this.lobby.map((p, i) =>
      i === 0 ? this.hero : this.makeHero(i, p.name, p.unlocked.filter((id) => WEAPONS[id]), p.peerId),
    );
    this.hero.name = this.lobby[0].name;
    this.setHeroes(heroes);
    this.local = 0;
    this.startRun();
  }

  private async joinGame(name: string, code: string): Promise<void> {
    this.saveName(name);
    this.leaveToTitle();
    this.role = 'client';
    const client = new NetClient(code);
    this.client = client;
    this.screens.setLobby({ code: code.toUpperCase(), players: [], isHost: false, status: 'Connecting...' });
    client.onMessage = (m) => this.onClientMessage(m as Record<string, unknown>);
    client.onClose = () => {
      if (this.client !== client) return;
      this.leaveToTitle();
      this.hud.toast('DISCONNECTED FROM HOST', 3);
    };
    try {
      await client.ready;
    } catch (err) {
      if (this.client !== client) return;
      this.client = null;
      this.role = 'solo';
      this.screens.setLobby({ code: '', players: [], isHost: false, status: (err as Error).message });
      return;
    }
    client.send({ t: 'hello', name, unlocked: unlockedWeapons() });
    this.screens.setLobby({ code: code.toUpperCase(), players: [], isHost: false, status: 'Connected! Waiting for the host to start...' });
  }

  private saveName(name: string): void {
    saveJson('profile', { name: name.trim().slice(0, 12) || 'Player' });
  }

  // ------------------------------------------------------------------ online: host side

  private heroByPeer(id: string): Hero | undefined {
    return this.heroes.find((h) => h.peerId === id);
  }

  private onHostMessage(from: string, m: Record<string, unknown>): void {
    if (m.t === 'hello') {
      if (this.mode !== 'title' || this.lobby.some((p) => p.peerId === from)) {
        this.host?.send(from, { t: 'full', reason: 'Game already started.' });
        return;
      }
      this.lobby.push({
        peerId: from,
        name: String(m.name ?? 'Player').slice(0, 12),
        unlocked: Array.isArray(m.unlocked) ? (m.unlocked as string[]) : unlockedWeapons(),
      });
      this.refreshLobby();
      return;
    }
    const h = this.heroByPeer(from);
    if (!h) return;
    h.lastSeen = performance.now();
    if (m.t === 'i') {
      h.remote = {
        x: Number(m.x),
        z: Number(m.z),
        vx: Number(m.vx),
        vz: Number(m.vz),
        ax: Number(m.ax),
        az: Number(m.az),
        firing: !!m.f,
        charging: !!m.c,
        dashing: !!m.d,
      };
    } else if (m.t === 'dash') {
      if (!h.player.dead && this.isCombatMode) {
        h.player.invuln = Math.max(h.player.invuln, playerTuning.dashTime + playerTuning.dashIframesExtra);
        this.onDash(h);
      }
    } else if (m.t === 'bomb') {
      if (this.isCombatMode) this.tryBomb(h);
    } else if (m.t === 'ui') {
      const d = m.d === -1 ? -1 : 1;
      this.heroAction(h, String(m.a), Number(m.i) || 0, d);
    }
  }

  private onClientLeft(id: string): void {
    if (this.mode === 'title') {
      this.lobby = this.lobby.filter((p) => p.peerId !== id);
      this.refreshLobby();
      return;
    }
    const h = this.heroByPeer(id);
    if (!h) return;
    h.left = true;
    h.player.dead = true;
    h.player.showWhenDead = false;
    h.pendingLevels = h.chestsPending = 0;
    h.shopDone = true;
    h.disposeWeapons();
    this.vfx.toast(`${h.name.toUpperCase()} LEFT THE GAME`, 3);
    // Don't leave the others stuck on a menu waiting for them.
    if (this.mode === 'levelup' && !this.heroes.some((x) => !x.left && x.needsPick)) this.afterPick(this.hero, '#ffffff');
    if (this.mode === 'shop' && this.heroes.every((x) => x.left || x.shopDone)) this.closeShop();
    if (this.aliveHeroes.length === 0 && this.isCombatMode) this.onHeroDown(h);
  }

  /** Send world snapshots to clients (20 Hz, slower while menus freeze the world). */
  private hostTick(frozen: boolean): void {
    if (this.role !== 'host' || !this.host) return;
    this.vfx.recording = true;
    if (this.stepN % (frozen ? 15 : SNAP_EVERY) !== 0) return;
    const events = this.vfx.drain();
    for (const h of this.heroes) {
      if (!h.peerId || h.left) continue;
      this.host.send(h.peerId, this.buildSnapshot(h, events));
    }
  }

  private buildSnapshot(forHero: Hero, events: VfxEvent[]): Record<string, unknown> {
    const cx = forHero.player.x;
    const cz = forHero.player.z;
    const near = (x: number, z: number) => Math.abs(x - cx) < INTEREST && Math.abs(z - cz) < INTEREST;
    const en = this.enemies.list.filter((e) => e.active && (near(e.x, e.z) || e.def.boss));
    const bi: number[] = [];
    for (let i = 0; i < this.bullets.count; i++) if (near(this.bullets.x[i], this.bullets.z[i])) bi.push(i);
    const pi: number[] = [];
    for (let i = 0; i < this.pickups.count && pi.length < 600; i++) if (near(this.pickups.x[i], this.pickups.z[i])) pi.push(i);
    const ev = events.filter((e) => {
      const [x, z] = Vfx.position(e);
      return Number.isNaN(x) || near(x, z);
    });
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const boss = this.boss && this.boss.active ? { name: this.boss.def.name, hp01: r2(Math.max(0, this.boss.hp / this.boss.maxHp)) } : null;
    return {
      t: 's',
      mode: this.mode,
      stage: this.stage,
      tl: !this.director.bossSpawned ? r2(this.director.remaining) : this.boss ? -1 : -2,
      boss,
      team: { level: this.level, xp01: r2(this.xp / this.xpNext), score: this.score, combo: this.combo, combo01: r2(this.combo > 0 ? Math.max(0, this.comboT / scoreTuning.comboWindow) : 0), kills: this.kills, time: r2(this.runTime) },
      heroes: this.heroes.map((h) => {
        const p = h.player;
        return {
          i: h.index,
          x: r2(p.x),
          z: r2(p.z),
          vx: r2(p.vel.x),
          vz: r2(p.vel.z),
          ax: r2(p.aim.x),
          az: r2(p.aim.z),
          hp: Math.ceil(p.hp),
          mhp: Math.round(p.maxHp),
          dead: p.dead,
          left: h.left,
          dash: p.dashing,
          inv: r2(p.invuln),
          rec: r2(p.recoil),
          hf: r2(p.hurtFlash),
          rv: r2(h.reviveT / REVIVE_TIME),
          area: r2(h.stats.areaMul),
          w: h.weapons.map((w) => [w.def.id, w.level, ...w.net()]),
        };
      }),
      you: {
        gold: forHero.gold,
        bomb: r2(forHero.bombCharge),
        mods: forHero.synergy.slots.map((s, i) => ({ id: s.def.id, ro: forHero.synergy.readout(i) })),
        passives: forHero.passives,
        stats: { moveSpeedMul: forHero.stats.moveSpeedMul, dashCooldownMul: forHero.stats.dashCooldownMul, maxHp: forHero.stats.maxHp, magnet: forHero.stats.magnet, areaMul: forHero.stats.areaMul },
      },
      portal: this.portal.active ? [r2(this.portal.x), r2(this.portal.z)] : null,
      en: packEnemies(en),
      bu: packBullets(this.bullets, bi),
      pk: packPickups(this.pickups, pi),
      ev,
    };
  }

  // ------------------------------------------------------------------ online: client side

  private onClientMessage(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'lobby': {
        const players = (m.players as { name: string; color: string }[]) ?? [];
        this.screens.setLobby({ code: String(m.code ?? ''), players, isHost: false, status: 'Connected! Waiting for the host to start...' });
        break;
      }
      case 'full':
        this.leaveToTitle();
        this.hud.toast(String(m.reason ?? 'THAT GAME IS FULL'), 3);
        break;
      case 'start':
        this.clientStart(Number(m.seed), Number(m.you), (m.players as { name: string }[]) ?? []);
        break;
      case 'wchest':
        this.chests.open(Number(m.i));
        break;
      case 'barrel': {
        const b = this.barrels.remove(Number(m.i));
        if (b) this.removeBarrelCollider(b);
        break;
      }
      case 'stage':
        this.clientStage(Number(m.stage), Number(m.seed));
        break;
      case 's':
        this.applySnapshot(m);
        break;
      case 'lv':
        this.screens.showLevelUp(m.offers as Offer[], String(m.title), Number(m.rerolls), m.loadout as LoadoutItem[], Number(m.skip));
        break;
      case 'shop':
        this.screens.showShop(this.shopFromNet(m.view as NetShop), m.focus === undefined ? undefined : Number(m.focus));
        break;
      case 'wait':
        this.screens.showWait((m.who as string[]) ?? []);
        break;
      case 'go':
        if (['levelup', 'shop', 'wait'].includes(this.screens.current)) this.screens.show('none');
        break;
      case 'toast':
        this.hud.toast(String(m.msg));
        break;
      case 'hurt':
        this.player.knock(Number(m.dx), Number(m.dz));
        this.hud.hurt();
        this.juice.shake(0.35);
        this.juice.kick(Number(m.dx), Number(m.dz), 6);
        sfx.playerHurt();
        break;
      case 'over':
        this.mode = 'dead';
        this.bankAndShow(m.sum as RunSummary);
        break;
      case 'end':
        this.leaveToTitle();
        this.hud.toast('THE HOST ENDED THE GAME', 3);
        break;
    }
  }

  private shopFromNet(v: NetShop): ShopView {
    return {
      ...v,
      offers: v.offers.map((o) => (o && MOD_BY_ID[o.id] ? { def: MOD_BY_ID[o.id], price: o.price, hint: o.hint } : null)),
      owned: v.owned.filter((o) => MOD_BY_ID[o.id]).map((o) => ({ def: MOD_BY_ID[o.id], sell: o.sell, readout: o.readout })),
    };
  }

  private clientStart(seed: number, you: number, players: { name: string }[]): void {
    this.seed = seed;
    const heroes = players.map((p, i) => this.makeHero(i, p.name, i === you ? unlockedWeapons() : []));
    this.setHeroes(heroes);
    this.local = you;
    for (const h of heroes) {
      h.player.showWhenDead = heroes.length > 1;
      h.recomputeStats();
      h.player.reset(h.stats);
    }
    this.score = this.kills = this.combo = 0;
    this.level = 1;
    this.hud.resetScore();
    this.hud.setVisible(true);
    this.hud.setFade(0);
    this.screens.show('none');
    this.mode = 'fight';
  }

  private clientStage(stage: number, seed: number): void {
    this.stage = stage;
    this.seed = seed;
    this.loadArena((seed ^ Math.imul(stage, 0x9e3779b1)) >>> 0, stage);
    this.clearWorld();
    this.heroes.forEach((h, i) => {
      const s = this.spawnSpot(i);
      h.player.teleport(s.x, s.z);
    });
    this.fadeT = 0.45;
  }

  private clientUpdate(dt: number): void {
    const input = this.input;
    if (this.isCombatMode && this.screens.current === 'none' && (input.keyPressed('Escape') || input.keyPressed('KeyP') || input.padButtonPressed(9))) {
      this.pause();
      input.endStep();
      return;
    }
    const before = this.screens.current;
    this.screens.update(input, dt);
    if (this.paused && this.screens.current === 'none') this.paused = false;
    if (this.screens.current === 'levelup' && before === 'levelup') {
      for (let k = 0; k < 3; k++) if (input.keyPressed(`Digit${k + 1}`)) this.ui('pick', k);
      if (input.keyPressed('KeyR') || input.padButtonPressed(3)) this.ui('reroll');
    }
    this.runTime += dt;
    const h = this.hero;
    const p = h.player;
    const control = this.isCombatMode && !p.dead && this.screens.current === 'none';
    if (control) {
      if (input.device === 'pad') {
        if (input.padAim.x !== 0 || input.padAim.y !== 0) p.setAimDir(input.padAim.x, input.padAim.y);
        else if (input.move.x !== 0 || input.move.y !== 0) p.setAimDir(input.move.x, input.move.y);
      } else if (this.mouseAimPoint()) p.setAimPoint(this.aimHit.x, this.aimHit.z);
    }
    const wantDash =
      control &&
      (input.keyPressed('Space') || input.keyPressed('ShiftLeft') || input.padButtonPressed(4) || input.padButtonPressed(6) || input.padButtonPressed(0));
    const moving = this.isCombatMode && this.mode !== 'levelup';
    if (moving && p.update(dt, control ? input : null, this.arena.colliders, wantDash)) {
      this.client?.send({ t: 'dash' });
      this.juice.shake(0.05);
    }
    const wantBomb = control && (input.keyPressed('KeyQ') || input.keyPressed('KeyE') || input.mousePressed(1) || input.padButtonPressed(3) || input.padButtonPressed(5));
    if (wantBomb) this.client?.send({ t: 'bomb' });
    const padFiring = input.padAim.x !== 0 || input.padAim.y !== 0 || input.padButton(7);
    const firing = control && (input.mouseDown(0) || padFiring || (settings.autoFire && input.device === 'kbm'));
    const charging = control && (input.mouseDown(2) || input.padButton(2));
    if (this.stepN % INPUT_EVERY === 0 && this.client) {
      const r2 = (v: number) => Math.round(v * 100) / 100;
      this.client.send({ t: 'i', x: r2(p.x), z: r2(p.z), vx: r2(p.vel.x), vz: r2(p.vel.z), ax: r2(p.aim.x), az: r2(p.aim.z), f: firing, c: charging, d: p.dashing });
    }
    if (this.mode !== 'levelup' && this.mode !== 'shop') {
      this.bullets.integrate(dt);
      for (let i = 0; i < this.bullets.count; i++) if (this.bullets.life[i] <= 0) this.bullets.kill(i--);
    }
    this.particles.update(dt);
    this.fx.update(dt);
    if (this.fadeT > 0) this.fadeT -= dt;
    input.endStep();
  }

  private applySnapshot(s: Record<string, unknown>): void {
    const now = performance.now();
    if (this.snapTime) this.snapInterval += (Math.min(200, now - this.snapTime) - this.snapInterval) * 0.2;
    this.snapTime = now;
    const prevMode = this.mode;
    this.mode = s.mode as Mode;
    if (this.mode === 'transition' && prevMode !== 'transition') this.fadeT = 0;
    this.stage = Number(s.stage);
    this.netTimeLeft = Number(s.tl);
    this.netBoss = (s.boss as { name: string; hp01: number }) ?? null;
    const team = s.team as Record<string, number>;
    this.level = team.level;
    this.xp = team.xp01 * 100;
    this.xpNext = 100;
    this.score = team.score;
    this.combo = team.combo;
    this.netCombo01 = team.combo01;
    this.kills = team.kills;
    this.runTime = team.time;

    // Heroes
    for (const hs of s.heroes as Record<string, unknown>[]) {
      const h = this.heroes[Number(hs.i)];
      if (!h) continue;
      const p = h.player;
      const wasDead = p.dead;
      p.dead = !!hs.dead;
      h.left = !!hs.left;
      p.hp = Number(hs.hp);
      h.stats.maxHp = Number(hs.mhp);
      h.reviveT = Number(hs.rv) * REVIVE_TIME;
      h.stats.areaMul = Number(hs.area);
      if (h === this.hero) {
        p.invuln = Math.max(p.invuln, Number(hs.inv));
        if (!p.dead && wasDead) p.rig.root.visible = true;
        p.recoil = Math.max(p.recoil, Number(hs.rec));
      } else {
        p.netSet(Number(hs.x), Number(hs.z), Number(hs.vx), Number(hs.vz), Number(hs.ax), Number(hs.az), !!hs.dash);
        p.invuln = Number(hs.inv);
        p.recoil = Number(hs.rec);
        p.hurtFlash = Number(hs.hf);
        if (!p.dead) p.rig.root.visible = true;
      }
      this.syncWeapons(h, hs.w as (string | number)[][]);
    }

    // Private info for this machine's hero
    const you = s.you as Record<string, unknown>;
    const h = this.hero;
    h.gold = Number(you.gold);
    h.bombCharge = Number(you.bomb);
    this.netMods = (you.mods as { id: string; ro: string }[]) ?? [];
    const passives = (you.passives as Record<string, number>) ?? {};
    if (JSON.stringify(passives) !== JSON.stringify(h.passives)) {
      h.passives = passives;
      h.loadoutDirty = true;
    }
    Object.assign(h.stats, you.stats as object);

    // Enemies: create, update or remove mirrors by uid.
    const seen = new Set<number>();
    unpackEnemies(s.en as ArrayBuffer, (r) => {
      seen.add(r.uid);
      let e = this.netEnemies.get(r.uid);
      if (!e || !e.active) {
        e = this.enemies.spawn(r.def, r.x, r.z, { instant: true, elite: r.elite });
        this.netEnemies.set(r.uid, e);
        e.px = r.x;
        e.pz = r.z;
      } else {
        e.px = e.x;
        e.pz = e.z;
      }
      e.x = r.x;
      e.z = r.z;
      e.state = r.state;
      e.t = r.t;
      e.facing = r.facing;
      e.sq = r.sq;
      e.hopY = r.hopY;
      e.frozen = r.frozen ? 1 : 0;
      e.burnT = r.burn ? 1 : 0;
      e.shockT = r.shock ? 1 : 0;
      e.flash = r.flash ? 0.07 : 0;
      e.action = r.action;
      e.lungeX = Math.sin(r.lunge);
      e.lungeZ = Math.cos(r.lunge);
      e.targetX = r.targetX;
      e.targetZ = r.targetZ;
    });
    for (const [uid, e] of this.netEnemies) {
      if (seen.has(uid)) continue;
      this.enemies.kill(e);
      this.netEnemies.delete(uid);
    }

    unpackBullets(s.bu as ArrayBuffer, this.bullets);
    unpackPickups(s.pk as ArrayBuffer, this.pickups);
    for (const e of (s.ev as VfxEvent[]) ?? []) this.vfx.apply(e);

    const portal = s.portal as [number, number] | null;
    if (portal && !this.portal.active) this.portal.open(portal[0], portal[1]);
    else if (!portal && this.portal.active) this.portal.close();
  }

  /** Client: mirror a hero's weapon list (ids/levels) and visual state. */
  private syncWeapons(h: Hero, list: (string | number)[][]): void {
    let changed = h.weapons.length !== list.length;
    for (let i = 0; i < list.length; i++) {
      const [id, level, ...state] = list[i] as [string, number, ...number[]];
      let w = h.weapons[i];
      if (!w || w.def.id !== id) {
        w?.dispose();
        w = createWeapon(id, this.scene);
        h.weapons[i] = w;
        changed = true;
      }
      if (w.level !== level) {
        w.level = level;
        changed = true;
      }
      w.setNet(state);
    }
    while (h.weapons.length > list.length) h.weapons.pop()!.dispose();
    if (changed) h.loadoutDirty = true;
  }

  // ------------------------------------------------------------------ render

  render(alpha: number, frameDt: number): void {
    const client = this.role === 'client';
    const local = this.hero;
    const p = local.player;
    const input = this.input;
    const frozen = (this.paused && this.role === 'solo') || this.mode === 'levelup' || this.mode === 'shop';
    const a = this.juice.hitStop > 0 || frozen ? 1 : alpha;
    // Clients draw remote things between the last two snapshots.
    const netA = client ? Math.min(1, (performance.now() - this.snapTime) / Math.max(16, this.snapInterval)) : a;
    const rdt = frozen ? 0 : frameDt;
    if (!frozen) {
      this.juice.tick(frameDt);
      this.animTime += frameDt;
    }

    for (const h of this.heroes) {
      if (h.left) {
        h.player.rig.root.visible = false;
        continue;
      }
      h.player.render(h === local || !client ? a : netA, rdt);
    }
    p.renderPos(a, this.playerPos);
    // Danger zones are cosmetic timers: tick them with the frame (they hold still in menus).
    const zones = this.enemies.zones;
    if (!this.paused && this.mode !== 'levelup' && this.mode !== 'shop') {
      for (let i = zones.length - 1; i >= 0; i--) if ((zones[i].t -= frameDt) <= 0) zones.splice(i, 1);
    }
    this.enemies.render(client ? netA : a, this.animTime);
    this.bullets.render(a);
    this.barrels.render(this.animTime);
    this.chests.render(this.paused ? 0 : frameDt, this.animTime);
    this.particles.render();
    this.pickups.render(this.animTime);
    for (const h of this.heroes) for (const w of h.weapons) w.render(a, h.ctx);
    this.fx.render(this.cam.camera);
    this.portal.render(rdt);
    this.renderMuzzleFlashes();

    const inMenu = this.mode === 'title' || this.screens.current !== 'none';
    if (this.mode === 'title') this.lead.set(0, 0, 0);
    else if (input.device === 'pad') {
      const active = input.padAim.x !== 0 || input.padAim.y !== 0;
      this.lead.set(p.aim.x, 0, p.aim.z).multiplyScalar(active ? cameraTuning.padLookAhead : 0);
    } else if (!frozen && this.mouseAimPoint()) {
      this.lead.set(this.aimHit.x - this.playerPos.x, 0, this.aimHit.z - this.playerPos.z).multiplyScalar(cameraTuning.lookAhead);
      if (this.lead.length() > cameraTuning.lookAheadMax) this.lead.setLength(cameraTuning.lookAheadMax);
    }
    this.juice.shakeOffset(this.shake);
    this.cam.update(this.playerPos, this.lead, frameDt, this.shake);

    if (inMenu || p.dead) this.reticle.style.display = 'none';
    else if (input.device === 'pad') {
      this.tmp.set(this.playerPos.x + p.aim.x * 5, AIM_HEIGHT, this.playerPos.z + p.aim.z * 5).project(this.cam.camera);
      this.reticle.style.transform = `translate(${((this.tmp.x + 1) / 2) * innerWidth}px, ${((1 - this.tmp.y) / 2) * innerHeight}px)`;
      this.reticle.style.display = '';
    } else {
      this.reticle.style.transform = `translate(${input.mouse.x}px, ${input.mouse.y}px)`;
      this.reticle.style.display = input.mouse.inside ? '' : 'none';
    }
    // Charge meter: a ring that fills around the crosshair.
    const charge = (local.weapons[0] as Buster | undefined)?.charge ?? 0;
    if (charge !== this.shownCharge) {
      this.shownCharge = charge;
      this.reticle.style.setProperty('--charge', String(Math.min(1, charge)));
      this.reticle.dataset.charge = charge >= 2 ? 'over' : charge >= 1 ? 'full' : charge > 0 ? 'on' : '';
    }

    // Client-side stage fade (the host fades itself in updateTransition).
    if (client) {
      if (this.mode === 'transition') this.hud.setFade(Math.min(1, (this.fadeT += frameDt) / 0.35));
      else this.hud.setFade(Math.max(0, this.fadeT / 0.45));
    }

    if (local.loadoutDirty) {
      local.loadoutDirty = false;
      this.hud.setLoadout(local.loadout());
    }
    const mods = client
      ? this.netMods.filter((m) => MOD_BY_ID[m.id]).map((m) => ({ def: MOD_BY_ID[m.id], ro: m.ro }))
      : local.synergy.slots.map((sl, i) => ({ def: sl.def, ro: local.synergy.readout(i) }));
    this.hud.setMods(mods.map((m) => ({ id: m.def.id, icon: m.def.icon, color: m.def.color, name: m.def.name, readout: m.ro, cursed: !!m.def.cursed })));
    this.renderTeam();
    this.renderChestPointer();
    this.dmg.render(rdt, this.cam.camera);
    const boss = client ? this.netBoss : this.boss && this.boss.active ? { name: this.boss.def.name, hp01: Math.max(0, this.boss.hp / this.boss.maxHp) } : null;
    this.hud.update(
      {
        hp: p.hp,
        maxHp: p.maxHp,
        dash01: p.dashReady01,
        bomb01: local.bombCharge,
        score: this.score,
        combo: this.combo,
        multiplier: this.multiplier,
        combo01: client ? this.netCombo01 : this.combo > 0 ? Math.max(0, this.comboT / scoreTuning.comboWindow) : 0,
        stage: this.stage,
        level: this.level,
        xp01: this.xp / this.xpNext,
        timeLeft: client ? this.netTimeLeft : !this.director.bossSpawned ? this.director.remaining : this.boss ? -1 : -2,
        kills: this.kills,
        gold: local.gold,
        boss,
        lowHp: !p.dead && p.hp / p.maxHp <= 0.3 && this.mode !== 'title',
      },
      frameDt,
    );
  }

  private renderMuzzleFlashes(): void {
    while (this.flashes.length < this.heroes.length) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: '#fffbe0' }));
      m.visible = false;
      this.scene.add(m);
      this.flashes.push(m);
    }
    this.flashes.forEach((m, i) => {
      const h = this.heroes[i];
      const buster = h?.weapons[0] as Buster | undefined;
      m.visible = !!h && !h.left && !!buster && buster.def.id === 'buster' && buster.muzzleT > 0 && !h.player.dead;
      if (!m.visible) return;
      h.player.muzzle(this.mz);
      m.position.set(this.mz.x, BULLET_Y, this.mz.z);
      m.scale.setScalar(0.8 + Math.random() * 0.6);
    });
  }

  /** Point at the nearest closed chest when it is off screen. */
  private renderChestPointer(): void {
    const p = this.hero.player;
    let best: { x: number; z: number } | null = null;
    let bd = 60;
    if (this.isCombatMode && !p.dead) {
      for (const c of this.chests.list) {
        if (c.openT >= 0) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
    }
    if (!best) {
      this.hud.setChestPointer(null);
      return;
    }
    this.tmp.set(best.x, 0.5, best.z).project(this.cam.camera);
    const sx = ((this.tmp.x + 1) / 2) * innerWidth;
    const sy = ((1 - this.tmp.y) / 2) * innerHeight;
    const m = 70;
    const seen = 10; // any part of the chest on screen: no pointer needed
    if (sx > seen && sx < innerWidth - seen && sy > seen && sy < innerHeight - seen) {
      this.hud.setChestPointer(null);
      return;
    }
    // Clamp onto a rectangle inset from the screen edge, along the line from the centre.
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const dx = sx - cx;
    const dy = sy - cy;
    const k = Math.min((cx - m) / Math.abs(dx || 1e-6), (cy - m) / Math.abs(dy || 1e-6));
    this.hud.setChestPointer({ x: cx + dx * k, y: cy + dy * k, angle: (Math.atan2(dy, dx) * 180) / Math.PI, dist: bd });
  }

  /** Teammate bars and name tags (co-op only). */
  private renderTeam(): void {
    if (this.heroes.length < 2 || this.mode === 'title') {
      this.hud.setTeam([], []);
      return;
    }
    const team = this.heroes
      .filter((h) => h !== this.hero)
      .map((h) => ({ name: h.name, color: h.color, hp01: h.left ? 0 : Math.max(0, h.player.hp / h.player.maxHp), down: h.player.dead, left: h.left }));
    const tags = this.heroes
      .filter((h) => h !== this.hero && !h.left)
      .map((h) => {
        const r = h.player.rig.root.position;
        this.tmp.set(r.x, 2.6, r.z).project(this.cam.camera);
        return {
          x: ((this.tmp.x + 1) / 2) * innerWidth,
          y: ((1 - this.tmp.y) / 2) * innerHeight,
          name: h.name,
          color: h.color,
          down: h.player.dead,
          revive01: h.reviveT / REVIVE_TIME,
          onScreen: this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.1 && Math.abs(this.tmp.y) < 1.1,
        };
      });
    this.hud.setTeam(team, tags);
  }
}
