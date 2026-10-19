import { createMvp } from './mvp';
import { startMeta, visitMeta, bankMeta } from './meta';
import { weeklyChallenge } from '../../data/weekly';
/**
 * Run flow: starting runs and stages, stage clears, the shop and portal, game over and achievements.
 * Split out of src/game/game.ts: these are Game methods (`this` is the Game),
 * installed on the class as fields, e.g. `clearWorld = RunFlow.clearWorld;`.
 */
import type { Game } from '../game';
import { heroUnlockedBy } from './heroMechs';
import { LOOP_STAGES, TITLE_SEED, xpForLevel, playerName, cheats } from '../game';
import { Rng, randomSeed } from '../../core/rng';
import { StaticBoxGrid } from '../../core/spatialHash';
import { ACHIEVEMENTS } from '../../data/meta';
import { MOD_BY_ID } from '../../data/mods';
import { SPECIALS } from '../../data/specials';
import { WEAPONS } from '../../data/weapons';
import { validLoadout } from '../../data/loadout';
import { resetSpecials } from '../specials';
import { sfx } from '../../audio/sfx';
import { disposeObject } from '../../render/dispose';
import { type RunSummary } from '../../ui/screens';
import { createFieldArena } from '../../world/fieldArena';
import { biomeForStage } from '../../data/biomes';
import { applyBiomeLook } from '../../render/biomeLook';
import { Hero, MAX_GEARS, economyTuning } from '../hero';
import { loadHighScores, submitScore } from '../highscores';
import { addRunRecord, grantAchievement, persist, save, unlockedLoadout, unlockedWeapons } from '../save';
import { settings } from '../settings';
import { streaks } from '../streaks';
import { CURSE_BY_ID } from '../../data/curses';
import { RELIC_BY_ID } from '../../data/relics';
import { WEAPON_COMBOS } from '../../data/weaponCombos';
import { DIFF_BY_ID, MODE_BY_ID, MODES, dailySeed, today, type DifficultyDef, type DifficultyId, type ModeId } from '../../data/modes';
import { submitDaily } from '../highscores';
import { boardId, leaderboardEnabled, submitGlobal } from '../../net/leaderboard';
import { clearBossLane } from './bossLane';

export function clearWorld(this: Game): void {
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
  this.bossField.clear();
  clearBossLane.call(this); // no Titan, no boss duel (systems/bossLane.ts)
  this.bossIntro.stop(this.cam.camera);
  this.bossBoom = null;
  this.slowMoT = 0;
  this.strikes.length = 0;
  this.enemies.zones.length = 0;
  for (const h of this.heroes) h.bombT = -1;
}

export function loadArena(this: Game, seed: number, stage = 1): void {
  this.scene.remove(this.arena.group);
  disposeObject(this.arena.group);
  const biome = biomeForStage(stage);
  this.arenaStage = stage;
  this.arena = createFieldArena(seed, biome, { conveyors: stage >= 2 ? 3 : 0 });
  applyBiomeLook(biome);
  this.scene.add(this.arena.group);
  this.walls = new StaticBoxGrid(this.arena.colliders);
  this.enemyCtx.colliders = this.arena.colliders;
  this.barrels.load(this.arena);
  this.loadToys();
  this.chests.clear();
  this.ambience.load(biome, seed, this.arena.halfSize, (x, z) => this.walls.hitCircle(x, z, 0.5));
  this.scars.clear();
  streaks.clear();
}

export function spawnSpot(this: Game, i: number): { x: number; z: number } {
  const n = Math.max(1, this.heroes.length);
  return { x: (i - (n - 1) / 2) * 2, z: 0 };
}

export function goTitle(this: Game): void {
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
  this.refreshGlobal();
  this.screens.show('title');
}

/** Back to a single local hero on the title screen, closing any connection. */
export function leaveToTitle(this: Game): void {
  if (this.role === 'client' && this.mode !== 'title') this.client?.send({ t: 'bye' }); // leaving on purpose: no autopilot wait (systems/coop2.ts)
  this.pvp = null;
  this.mpReset(); // no Versus match, local co-op pads or public listing (systems/mp.ts)
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

export function startSolo(this: Game): void {
  this.leaveToTitle();
  this.hero.name = playerName();
  this.applyLocalSkin();
  this.runMode = (MODE_BY_ID[settings.mode as ModeId] ?? MODES[0]).id;
  this.startRun();
}

/** Difficulty from settings, if unlocked (daily runs are always Normal). */
export function pickDifficulty(this: Game): DifficultyDef {
  const d = DIFF_BY_ID[settings.difficulty as DifficultyId] ?? DIFF_BY_ID.normal;
  if (this.runMode === 'daily' || this.runMode === 'weekly' || (d.unlock && !save.achievements.includes(d.unlock))) return DIFF_BY_ID.normal;
  return d;
}

/** Start a run (solo or online host). */
export function startRun(this: Game, fixed?: { seed: number; difficulty: string }): void {
  this.paused = false;
  if (this.role !== 'solo' && this.lobbyKind !== 'weekly') this.runMode = 'standard'; // online weekly co-op keeps 'weekly'
  this.difficulty = fixed ? DIFF_BY_ID[fixed.difficulty as DifficultyId] ?? DIFF_BY_ID.normal : this.pickDifficulty();
  this.runDate = today();
  this.seed = fixed ? fixed.seed : this.runMode === 'daily' ? dailySeed(this.runDate) : randomSeed();
  this.rng = new Rng(this.seed);
  this.stage = 1;
  this.score = this.kills = this.combo = this.maxCombo = 0;
  this.runTime = this.comboT = 0;
  this.mvp = createMvp();
  this.level = 1;
  this.xp = 0;
  this.xpNext = xpForLevel(1);
  this.elitesRun = this.bossesRun = this.overloads = this.victories = 0;
  this.newAchievements = [];
  this.curses = [];
  this.runEvents.reset();
  this.routeReset();
  this.director.players = this.heroes.length;
  // Everyone keeps the loadout they picked; this machine's comes from its settings.
  if (this.role !== 'client') this.hero.loadoutPick = validLoadout(settings.loadout, cheats.unlockAll ? undefined : unlockedLoadout());
  startMeta(this);
  this.rng = new Rng(this.seed);
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
      this.host!.send(h.peerId, { t: 'start', meta: { heat: this.meta.heat, week: this.meta.week, clears: 0 }, seed: this.seed, difficulty: this.difficulty.id, you: h.index, players: this.heroes.map((x) => ({ name: x.name, skin: x.skin.id, pet: x.pet, hero: x.heroDef.id, look: x.player.look })) });
    }
  }
  this.loadStage(1);
  this.mvpStep(true);
  // Starting shop: free gold to spend before stage 1, not carried into the run.
  if (this.role !== 'client') {
    this.preShop = true;
    for (const h of this.heroes) h.gold = economyTuning.startGold;
    this.openShop();
  }
}

/** Alias used by the debug panel. */
export function restart(this: Game): void {
  if (this.role === 'client') return;
  this.startRun();
}

export function retry(this: Game): void {
  if (this.role === 'client') {
    this.hud.toast('WAITING FOR THE HOST TO RESTART');
    return;
  }
  this.startRun();
}

/** Stage banner subtitle: biome, loop and what the stage ends with. */
export function stageSub(this: Game, stage: number): string {
  const loop = Math.ceil(stage / LOOP_STAGES);
  const final = stage % LOOP_STAGES === 0 ? '<br>FINAL BOSS STAGE' : '';
  return `${biomeForStage(stage).name.toUpperCase()}${loop > 1 ? ` · LOOP ${loop}` : ''}<br>SURVIVE ${Math.round(this.director.duration / 60)} MINUTES${final}`;
}

export function loadStage(this: Game, stage: number): void {
  this.stage = stage;
  this.loadArena((this.seed ^ Math.imul(stage, 0x9e3779b1)) >>> 0, stage);
  this.clearWorld();
  this.heroes.forEach((h, i) => {
    const s = this.spawnSpot(i);
    h.player.teleport(s.x, s.z);
    if (h.player.dead && !h.left) this.reviveHero(h, 0.5, false);
  });
  this.director.start(stage);
  this.director.countMul = (1 + this.curseSum('enemyCount')) * this.difficulty.enemyCount * (this.meta.has('crowds') ? 1.25 : 1);
  this.runEvents.startStage(this.director.duration);
  if (this.runMode === 'bossrush') this.bossRushStage();
  for (const h of this.heroes) {
    h.phoenixUsed = false;
    if (h.hasRelic('r_clover')) h.rerollsLeft = Math.min(MAX_GEARS, h.rerollsLeft + 1);
  }
  resetSpecials();
  this.chestT = 0;
  this.damagedThisStage = false;
  this.mode = 'fight';
  visitMeta(this);
  this.modeT = 0;
  if (this.role === 'host') this.host!.broadcast({ t: 'stage', stage, seed: this.seed });
  this.vfx.banner(`STAGE ${stage}`, this.stageSub(stage), 2.2);
  this.vfx.sound('wave', NaN, NaN);
  this.routeStageStart();
  this.modesStageStart(); // rhythm stage / Pacifist road rules, weekly ghost (systems/modes.ts)
  this.checkAchievements();
}

export function pause(this: Game): void {
  if (!this.isCombatMode || this.paused) return;
  this.paused = true;
  const mods =
    this.role === 'client'
      ? this.netMods.filter((m) => MOD_BY_ID[m.id]).map((m) => ({ def: MOD_BY_ID[m.id], level: m.lv ?? 1 }))
      : this.hero.synergy.slots.map((sl) => ({ def: sl.def, level: sl.level }));
  this.screens.setPauseBuild(this.hero.loadout(), mods, [
    ...WEAPON_COMBOS.filter((c) => this.hero.combos.has(c.id)).map((c) => ({ id: c.weapons[0], name: c.name, desc: c.desc, icon: '+', color: c.color })),
    ...this.curses.filter((id) => CURSE_BY_ID[id]).map((id) => ({ ...CURSE_BY_ID[id], curse: true })),
  ], this.pauseInfo(), this.hero.relics.filter((id) => RELIC_BY_ID[id]).map((id) => RELIC_BY_ID[id]));
  this.screens.show('pause');
}

export function resume(this: Game): void {
  this.paused = false;
  this.screens.show('none');
}

export function quitRun(this: Game): void {
  if (this.pvp || this.onboarding.training) this.leaveToTitle(); // training banks nothing
  else if (this.role === 'solo') this.endRun(true);
  else this.leaveToTitle();
}

export function summary(this: Game, h: Hero): RunSummary {
  return {
    mvp: this.mvp.report ?? undefined,
    score: Math.floor(this.score * this.meta.multiplier),
    heat: this.meta.points,
    clears: this.victories,
    bosses: this.bossesRun,
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
    style: this.bestStyle(h),
  };
}

/** Bank lifetime stats into this machine's save, then show game over. */
export function bankAndShow(this: Game, sum: RunSummary, quit = false): void {
  if (this.meta.banked) return;
  this.modesRunEnd(); // keep this week's ghost (systems/modes.ts)
  const bolts = bankMeta(this, sum);
  sum.bolts = bolts;
  this.mpRunBanked(sum); // weekly co-op team best and board (systems/mp.ts)
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
  const h = this.hero;
  addRunRecord({
    heat: this.meta.points,
    weekly: this.meta.week || undefined,
    bolts,
    date: new Date().toISOString().slice(0, 10),
    label: this.runLabel || 'STANDARD',
    hero: h.heroDef.name,
    stage: sum.stage,
    score: sum.score,
    kills: sum.kills,
    time: sum.time,
    level: sum.level,
    cause: h.player.dead ? h.lastHitBy || 'Unknown' : 'Quit',
    weapons: h.weapons.map((w) => ({ id: w.def.id, level: w.level, evo: w.evolved })),
  });
  persist();
  if (quit) { this.goTitle(); return; }
  this.hud.toast(`+${bolts} BOLTS · COSMETICS ONLY`, 4);
  if (leaderboardEnabled && this.role !== 'client') {
    const board = this.meta.week ? weeklyChallenge(this.meta.week).board : boardId(this.runMode, this.difficulty.id, this.runDate);
    void submitGlobal(board, { name: this.hero.name, score: Math.floor(sum.score), stage: sum.stage, kills: sum.kills, time: sum.time }).then((r) => {
      if (r) this.hud.toast(`GLOBAL RANK #${r}!`, 4);
      this.refreshGlobal(board, r ? r - 1 : -1);
    });
  }
  const rank = this.meta.week ? -1 : submitScore({ score: sum.score, stage: sum.stage, kills: sum.kills, date: new Date().toISOString().slice(0, 10), label: this.runLabel });
  if (this.runMode === 'daily' && submitDaily(this.runDate, sum.score)) this.hud.toast("NEW BEST FOR TODAY'S CHALLENGE!", 4);
  this.screens.showGameOver(sum, rank, loadHighScores(), this.role === 'client');
  if (sum.mvp) { this.mvp.report = sum.mvp; this.showMvp(sum.mvp); }
}

export function endRun(this: Game, quit = false): void {
  // PvP: dying in your own stage still takes your build to the duel.
  if (this.pvp?.phase === 'stage') {
    this.pvpStageDone();
    return;
  }
  if (!quit && !this.pvp && !this.onboarding.training) this.mvpFinish();
  for (const h of this.heroes) {
    if (!h.peerId || h.left) continue;
    this.host?.send(h.peerId, { t: 'over', sum: this.summary(h) });
  }
  this.bankAndShow(this.summary(this.hero), quit);
}

export function checkAchievements(this: Game): void {
  const L = save.lifetime;
  const kills = L.kills + this.kills;
  const h = this.hero;
  const want: [string, boolean][] = [
    ['first_steps', kills >= 300],
    ['light_tamer', kills >= 1500],
    ['field_engineer', L.elites + this.elitesRun >= 12],
    ['boss_slayer', this.bossesRun > 0 || this.stage > 1],
    ['stage_2', this.stage >= 2],
    ['elite_hunter', L.elites + this.elitesRun >= 5],
    ['evolved', h.weapons.some((w) => w.def.slot && w.evolved) || !!h.specialEvo],
    ['exterminator', kills >= 3000],
    ['speedster', h.dashes >= 60],
    ['arsenal', h.weapons.length >= 6],
    ['maxed', h.weapons.some((w) => w.maxed)],
    ['evolved', h.weapons.some((w) => w.evolved)],
    ['hard_stage3', this.stage >= 3 && (this.difficulty.id === 'hard' || this.difficulty.id === 'nightmare')],
    ['endless_5', this.runMode === 'endless' && this.stage >= 5],
    ['rush_3', this.runMode === 'bossrush' && this.bossesRun >= 3],
    ['stage_3', this.stage >= 3],
    ['boss_rush', L.bosses + this.bossesRun >= 5],
    ['elite_slayer', L.elites + this.elitesRun >= 25],
    ['victory', this.victories > 0 || this.stage > LOOP_STAGES],
    ...this.heroMechAchievements(),
  ];
  for (const [id, ok] of want) {
    if (!ok) continue;
    const def = grantAchievement(id);
    if (!def) continue;
    this.newAchievements.push(id);
    const item = def.unlockWeapon ? WEAPONS[def.unlockWeapon]?.name : def.unlockLoadout ? (WEAPONS[def.unlockLoadout] ?? SPECIALS[def.unlockLoadout])?.name : heroUnlockedBy(id) && `Hero ${heroUnlockedBy(id)}`;
    const unlock = item ? ` - ${item} unlocked${def.unlockLoadout ? ' for your loadout' : ''}!` : '';
    this.hud.toast(`★ ${def.name}${unlock}`, 4);
    sfx.powerUp();
  }
}
