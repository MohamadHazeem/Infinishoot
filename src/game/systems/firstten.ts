import { FIRST_SHOP, FIRST_TEN_REWARD, GOALS, allGoalsDone, checklistVisible, firstTenTuning, isGuided, nextTryFor, tickGoals, type GoalId } from '../firstten';
import { MOD_BY_ID } from '../../data/mods';
import { FirstTenUi } from '../../ui/firstten';
import { promptText } from '../../ui/prompts';
import type { ScreenName } from '../../ui/screens';
import { grantAchievement, persist, save, saveLock } from '../save';
import { sfx } from '../../audio/sfx';
import { settings } from '../settings';
import type { Game } from '../game';

/**
 * The first ten minutes of a new player (firstten lane, notes/lanes/firstten.md).
 * One object per Game (`game.firstten`), stepped from Game.update on every machine.
 *
 * - Every run, stage 1: the first chest lands in view ~12 s in (the regular
 *   30 s chest clock restarts after it, so stage 1 keeps the same number of chests).
 * - Guided runs (a solo Standard run while lifetime.runs < 3): the special tip
 *   waits for the first swarm ring ("SURROUNDED!"), a heads-up before the first
 *   elite and before the boss, a curated first starting shop with a GOOD FIRST PICK.
 * - One-time helper strips on the first level-up and the first shops.
 * - FIRST STEPS checklist on the title (Graduate achievement: Star Cadet armour).
 * - Game over: an encouraging line and one NEXT TRY suggestion from what killed you.
 * Gameplay bits (the chest) run on solo/host only; the rest is local UI, so co-op needs no messages.
 */
export class FirstTen {
  readonly ui: FirstTenUi;
  /** This run is a new player's guided run. */
  guided = false;
  /** Lifetime runs when this run started. */
  private runs0 = 0;
  private lastMode = '';
  private lastRunTime = 0;
  private stageSeen = 0;
  private chestDone = false;
  private ringDone = false;
  private eliteWarned = false;
  private bossWarned = false;
  private curating = false;
  /** Seed of the run whose starting shop was curated (rerolls keep the normal pool). */
  private curatedSeed = -1;
  private n = 0;

  constructor(
    readonly game: Game,
    private readonly root: HTMLElement,
  ) {
    const g = game;
    this.ui = new FirstTenUi(root, g.screens, {
      quickStart: () => this.quickStart(),
      hideChecklist: () => {
        save.firstten.hidden = true;
        persist();
        this.ui.renderChecklist(null, false);
        g.screens.show('title');
      },
      claimReward: () => {
        save.firstten.claimed = true;
        persist();
        this.ui.renderChecklist(null, false);
        g.screens.show('title');
      },
    });
    // Onboarding owns screens.onShow; chain after it.
    const prev = g.screens.onShow;
    g.screens.onShow = (name) => {
      prev?.(name);
      this.onScreen(name);
    };
  }

  /** The SPECIAL tip waits for the first swarm ring on a guided stage 1 (onboarding asks). */
  specialTipReady(): boolean {
    const g = this.game;
    if (!this.guided || g.stage !== 1) return true;
    return this.ringDone || g.director.time > firstTenTuning.ringPromptBy;
  }

  // ---------------------------------------------------------------- per step

  step(dt: number): void {
    void dt;
    const g = this.game;
    // A new run: out of the menus, or the run clock went back (a restart without a title step in between).
    const fromMenu = this.lastMode === 'title' || this.lastMode === 'dead' || this.lastMode === '';
    if (g.mode !== 'title' && g.mode !== 'dead' && (fromMenu || g.runTime < this.lastRunTime)) this.runStart();
    this.lastMode = g.mode;
    this.lastRunTime = g.runTime;
    if (g.mode === 'title' || saveLock.on || g.onboarding.training) return;
    if (g.stage !== this.stageSeen) {
      this.stageSeen = g.stage;
      this.chestDone = this.ringDone = this.eliteWarned = this.bossWarned = false;
    }
    if (g.mode === 'fight' && g.stage === 1) this.stageOne();
    if (++this.n % 30 === 0 && g.isCombatMode) this.goals();
  }

  private runStart(): void {
    const g = this.game;
    this.runs0 = save.lifetime.runs;
    this.guided = !saveLock.on && isGuided(this.runs0, g.role === 'solo' && !g.localCoop && !g.pvp, g.runMode);
    this.stageSeen = 0;
  }

  /** Stage-1 moments: the early chest (every run) and a guided run's heads-ups. */
  private stageOne(): void {
    const g = this.game;
    const t = g.director.time;
    const T = firstTenTuning;
    const plain = g.runMode !== 'bossrush' && !g.pvp && !g.versus;
    if (!this.chestDone && t >= T.firstChestAt && g.role !== 'client') {
      this.chestDone = true;
      if (plain) this.firstChest();
    }
    if (!this.guided) return;
    if (!this.ringDone && g.director.ringsSent > 0) {
      this.ringDone = true;
      g.hud.toast(`SURROUNDED! PRESS ${promptText('bomb')} FOR YOUR SPECIAL`, 3.2);
    }
    if (!this.eliteWarned && t >= g.director.nextEliteAt - T.eliteWarn) {
      this.eliteWarned = true;
      g.hud.toast('AN ELITE IS COMING! BEAT IT FOR A CHEST', 3);
    }
    if (!this.bossWarned && g.director.remaining <= T.bossWarn && !g.director.bossSpawned) {
      this.bossWarned = true;
      g.onboarding.want('bosssoon');
    }
  }

  /** The first chest lands in view, a few metres ahead of where you aim. */
  private firstChest(): void {
    const g = this.game;
    const p = g.hero.player;
    const d = firstTenTuning.firstChestDist;
    const base = Math.atan2(p.aim.x, p.aim.z);
    const lim = g.arena.halfSize - 5;
    for (let k = 0; k < 16; k++) {
      // Try straight ahead first, then fan out to the sides.
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.4;
      const r = d * (k < 8 ? 1 : 0.7);
      const x = p.x + Math.sin(a) * r;
      const z = p.z + Math.cos(a) * r;
      if (Math.abs(x) > lim || Math.abs(z) > lim || g.walls.hitCircle(x, z, 1.2)) continue;
      const facing = a + Math.PI;
      g.chests.add(x, z, facing);
      g.host?.broadcast({ t: 'chestspawn', x, z, f: facing });
      g.vfx.ring(x, z, 1, 6, '#ffcd75', 0.6);
      g.vfx.burst(x, 1, z, { count: 26, color: '#ffcd75', color2: '#ffffff', speed: [2, 7], size: [0.15, 0.32], life: [0.5, 1], up: 9, gravity: 10 });
      g.vfx.toast(this.guided ? 'A TREASURE CHEST! WALK INTO IT' : 'A TREASURE CHEST APPEARED!');
      g.vfx.sound('chest', NaN, NaN);
      g.chestT = 0; // the regular chest clock starts over
      return;
    }
  }

  // ---------------------------------------------------------------- FIRST STEPS

  private goals(): void {
    const g = this.game;
    if (saveLock.on || save.firstten.claimed) return;
    const ids: GoalId[] = [];
    if (save.training.done) ids.push('training');
    if (g.level >= 5) ids.push('level5');
    if (g.chests.list.some((c) => c.openT >= 0)) ids.push('chest');
    if (g.elitesRun > 0) ids.push('elite');
    if (g.bossesRun > 0 || g.stage > 1) ids.push('boss');
    if (save.achievements.includes('evolved') || g.hero.weapons.some((w) => w.def.slot && w.evolved) || !!g.hero.specialEvo) ids.push('evolve');
    if (g.coop && (g.role !== 'solo' || !!g.localCoop) && !g.pvp) ids.push('coop');
    this.tick(ids, true);
  }

  /** Tick goals; in a run, a toast for each new one; all done grants the reward. */
  private tick(ids: GoalId[], inRun: boolean): void {
    const fresh = tickGoals(save.firstten, ids);
    if (!fresh.length) return;
    persist();
    const n = save.firstten.done.length;
    if (inRun && checklistVisible(save.firstten)) {
      const label = GOALS.find((x) => x.id === fresh[fresh.length - 1])!.label;
      this.game.hud.toast(`FIRST STEPS ${n}/${GOALS.length} · ${label} ✓`, 2.6);
    }
    if (allGoalsDone(save.firstten) && grantAchievement(FIRST_TEN_REWARD.achievement)) {
      sfx.named('achievement');
      this.game.hud.toast(`★ GRADUATE - ${FIRST_TEN_REWARD.name} armour unlocked!`, 4);
    }
  }

  // ---------------------------------------------------------------- screens

  private onScreen(name: ScreenName): void {
    if (name !== 'levelup') this.ui.setLevelHelp(false);
    if (name !== 'shop') this.ui.setShopHelp(null);
    if (name === 'title') {
      // Lifetime goals from the save (training, a finished run, evolutions).
      const ids: GoalId[] = [];
      if (save.training.done) ids.push('training');
      if (save.lifetime.runs > 0) ids.push('run');
      if (save.lifetime.bosses > 0 || save.lifetime.bestStage > 1) ids.push('boss');
      if (save.lifetime.elites > 0) ids.push('elite');
      if (save.lifetime.bestLevel >= 5) ids.push('level5');
      if (save.achievements.includes('evolved')) ids.push('evolve');
      if (!saveLock.on) this.tick(ids, false);
      const s = save.firstten;
      const complete = allGoalsDone(s) && !s.claimed;
      this.ui.renderChecklist(checklistVisible(s) || complete ? s : null, complete);
    }
    if (name === 'modes') this.ui.setQuickStart(save.lifetime.runs < firstTenTuning.guidedRuns);
    if (name === 'levelup') this.levelUpHelp();
    if (name === 'shop') this.shopHelp();
    if (name === 'gameover') this.gameOver();
  }

  private levelUpHelp(): void {
    const g = this.game;
    if (g.onboarding.training || !g.hero.needsPick || save.firstten.seen.includes('levelup')) return;
    this.seen('levelup');
    this.ui.setLevelHelp(true);
  }

  private shopHelp(): void {
    const g = this.game;
    if (this.curating || g.onboarding.training || g.onboarding.opening) return;
    const kind = g.preShop ? 'pre' : 'shop';
    let pick = -1;
    // A new player's first starting shop: simple Mods that work with any kit.
    // The shop opens before the first step of the run, so the guided check is made here too.
    const guided = isGuided(save.lifetime.runs, g.role === 'solo' && !g.localCoop && !g.pvp, g.runMode);
    if (kind === 'pre' && guided && this.curatedSeed !== g.seed && g.role === 'solo') {
      this.curatedSeed = g.seed;
      const h = g.hero;
      const mods = FIRST_SHOP.map((id) => MOD_BY_ID[id]).filter((m) => m && !h.synergy.owns(m.id)).slice(0, h.shopOffers.length || 4);
      if (mods.length >= 2) {
        h.shopOffers = mods;
        h.shopLocked = mods.map(() => false);
        this.curating = true;
        g.presentShop(h);
        this.curating = false;
        pick = 0;
      }
    }
    if (save.firstten.seen.includes(kind)) {
      if (pick >= 0) this.ui.setShopHelp(null);
      return;
    }
    this.seen(kind);
    this.ui.setShopHelp(kind, pick);
  }

  /** A helper strip was shown: it replaces the matching first-time tip, so the two never pile up. */
  private seen(kind: string): void {
    save.firstten.seen.push(kind);
    const tip = kind === 'levelup' ? 'levelup' : 'shop';
    if (!save.tips.includes(tip)) save.tips.push(tip);
    persist();
  }

  private gameOver(): void {
    const g = this.game;
    const h = g.hero;
    if (g.onboarding.training || saveLock.on) return this.ui.setNextTry(null, '');
    if (!save.firstten.done.includes('run')) this.tick(['run'], false);
    // Quitting isn't a death: no advice.
    if (!h.player.dead || g.pvp) return this.ui.setNextTry(null, '');
    const t = nextTryFor({
      cause: h.lastHitBy,
      stage: g.stage,
      stageTime: g.director.time,
      level: g.level,
      dashes: h.dashes,
      boss: !!(g.boss?.active || g.netBoss),
      runs: this.runs0,
      keys: { dash: promptText('dash'), parry: promptText('parry'), special: promptText('bomb') },
    });
    const s = save.firstten;
    const steps = checklistVisible(s) ? `FIRST STEPS ${s.done.length}/${GOALS.length} · RETRY KEEPS YOUR LOADOUT` : 'RETRY KEEPS YOUR LOADOUT';
    this.ui.setNextTry(t, steps);
  }

  /** PLAY SOLO > QUICK START: the default hero, mode and difficulty, then the loadout. */
  private quickStart(): void {
    settings.hero = 'rookie';
    settings.mode = 'standard';
    settings.difficulty = 'normal';
    this.game.applyLocalSkin();
    this.root.querySelector<HTMLElement>('#scr-modes [data-act=play]')?.click();
  }
}
