import { isCodexKey } from '../data/arsenal';
import { closestUnlocks } from '../data/unlockProgress';
import { RELIC_BY_ID } from '../data/relics';
import { MOD_BY_ID } from '../data/mods';
import { saveBuildCard, type BuildCardData } from '../ui/buildCard';
import { OnboardingUi } from '../ui/onboarding';
import type { ScreenName } from '../ui/screens';
import type { Enemy } from './enemies';
import { cheats, type Game } from './game';
import { RunRecorder } from './runRecap';
import { persist, save } from './save';
import { saveSettings, settings } from './settings';
import { TIPS, tipInsertAt, tipTime, tipWanted, type TipId } from './tips';
import { firstTenTuning } from './firstten';
import { Training, trainingTuning } from './training';

/** Tips that belong to a menu: shown only while it's open, and ahead of the rest. */
const MENU_TIPS: Partial<Record<TipId, ScreenName>> = { levelup: 'levelup', evofork: 'levelup', shop: 'shop', modorder: 'shop' };

/**
 * Onboarding: the TRAINING field, first-time tips, the Codex's discovery
 * tracking, unlock progress and the run recap / build card on game over.
 * One object per Game (`game.onboarding`), stepped from Game.update on every
 * machine. It only reads game state (plus training's own spawns on solo), so
 * co-op needs no messages: each machine tips and records for its own hero.
 */
export class Onboarding {
  readonly ui: OnboardingUi;
  training: Training | null = null;
  readonly recorder = new RunRecorder();
  private queue: TipId[] = [];
  private tip: { id: TipId; left: number } | null = null;
  private n = 0;
  private lastMode = '';
  private dirty = false;
  private persistT = 0;
  /** Napalm blasts noted by the status system (counts as a combo for tips and the Codex). */
  napalms = 0;
  private godBefore = false;
  /** The build when game over showed, for the BUILD CARD. */
  card: BuildCardData | null = null;
  private stepWait = 0;
  /** Training is starting (its skipped starting shop is not a real first shop). */
  opening = false;
  /** Seconds before the next in-fight tip may show (firstten lane: tips never pile up). */
  private gapT = 0;

  constructor(
    readonly game: Game,
    private readonly root: HTMLElement,
  ) {
    const g = game;
    this.ui = new OnboardingUi(root, g.screens, {
      training: () => this.startTraining(),
      declineTraining: () => this.markOffered(),
      skipStep: () => this.advance(),
      trainingDone: (run) => this.endTraining(run),
      buildCard: () => (this.card ? saveBuildCard(this.card) : Promise.resolve(false)),
      toggleTips: () => {
        settings.tips = !settings.tips;
        saveSettings();
        this.ui.syncSettings(settings.tips);
        if (!settings.tips) this.clearTips();
      },
      resetTips: () => {
        save.tips = [];
        persist();
      },
      tipClosed: () => this.closeTip(),
    });
    g.screens.onShow = (name) => this.onScreen(name);
  }

  // ---------------------------------------------------------------- per step

  /** Every Game.update (all roles, menus open or not). */
  step(dt: number): void {
    const g = this.game;
    this.n++;
    if (this.training) this.trainingStep(dt);
    this.tickTip(dt);
    // A new run: the recap starts over.
    if (g.mode !== this.lastMode) {
      if ((this.lastMode === 'title' || this.lastMode === 'dead' || this.lastMode === '') && g.mode !== 'title' && g.mode !== 'dead') this.recorder.reset();
      this.lastMode = g.mode;
    }
    if (g.mode === 'title' || this.n % 10 !== 0) return;
    this.record();
    if (!this.training) this.detectTips();
    if (this.n % 30 === 0) this.discover();
    this.persistT -= dt * 10;
    if (this.dirty && this.persistT <= 0) {
      this.dirty = false;
      this.persistT = 5;
      persist();
    }
  }

  /** Enemies this machine knows about (clients mirror the host's). */
  private enemies(): Iterable<Enemy> {
    const g = this.game;
    return g.role === 'client' ? g.netEnemies.values() : g.enemies.list;
  }

  private record(): void {
    const g = this.game;
    const h = g.hero;
    let dmg = 0;
    for (const v of Object.values(h.damageBy)) dmg += v;
    this.recorder.sample({ stage: g.stage, level: g.level, kills: g.kills, time: g.runTime, damage: dmg, gold: h.gold, preShop: g.preShop, boss: !!(g.boss?.active || g.netBoss) });
  }

  // ---------------------------------------------------------------- screens

  private onScreen(name: ScreenName): void {
    if (name === 'title') {
      // Offered once, on a fresh save.
      const offer = !save.training.offered && !save.training.done && save.lifetime.runs === 0;
      this.ui.setOffer(offer);
      if (offer) this.markOffered();
    }
    if (name === 'settings') this.ui.syncSettings(settings.tips !== false);
    if (name === 'arsenal') this.ui.renderCodex(save.discovered);
    if (name === 'gameover') this.gameOver();
    if ((name === 'levelup' || name === 'shop') && !this.opening) {
      this.discoverOffers();
      // Menu tips wait for their menu's content, which is filled before show().
      this.detectTips();
    }
    if (name === 'title' || name === 'gameover') this.clearTips();
    // Back on the title (pause > quit, or leaving to the menu): training is over.
    if (name === 'title') this.stopTraining();
  }

  private gameOver(): void {
    const g = this.game;
    const h = g.hero;
    this.record();
    this.discover();
    const run = { stage: g.stage, dashes: h.dashes, weapons: h.weapons.length, bosses: g.bossesRun, mode: g.runMode, difficulty: g.difficulty.id };
    this.ui.renderGameOver(closestUnlocks(save.lifetime, run, save.achievements, 3), this.recorder.stages);
    const mods = g.role === 'client' ? g.netMods.filter((m) => MOD_BY_ID[m.id]).map((m) => ({ def: MOD_BY_ID[m.id], level: m.lv ?? 1 })) : h.synergy.slots.map((s) => ({ def: s.def, level: s.level }));
    this.card = {
      hero: h.heroDef.name,
      label: g.runLabel || 'STANDARD',
      stage: g.stage,
      score: g.score,
      level: g.level,
      kills: g.kills,
      time: g.runTime,
      items: h.loadout(),
      mods: mods.map((m) => ({ id: m.def.id, name: m.def.name, color: m.def.color, glyph: m.def.icon, level: m.level })),
      relics: h.relics.filter((id) => RELIC_BY_ID[id]).map((id) => ({ id, name: RELIC_BY_ID[id].name, color: RELIC_BY_ID[id].color, glyph: RELIC_BY_ID[id].icon })),
      date: new Date().toISOString().slice(0, 10),
      version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
    };
  }

  // ---------------------------------------------------------------- tips

  /** Queue a tip if it's new to this save (menu tips jump the queue). */
  want(id: TipId): void {
    if (!tipWanted(id, settings.tips !== false, save.tips, this.queue) || this.tip?.id === id) return;
    if (MENU_TIPS[id]) {
      this.queue.unshift(id);
      // A menu tip can't wait: put the current one back and show this now.
      if (this.tip && !MENU_TIPS[this.tip.id]) {
        this.queue.splice(1, 0, this.tip.id);
        save.tips = save.tips.filter((t) => t !== this.tip!.id);
        this.tip = null;
      }
    } else {
      // In-fight tips: telegraphs (boss, elite, special) go ahead of trivia; menu tips stay in front.
      const menus = this.queue.findIndex((q) => !MENU_TIPS[q]);
      const from = menus < 0 ? this.queue.length : menus;
      this.queue.splice(from + tipInsertAt(id, this.queue.slice(from)), 0, id);
    }
  }

  private tickTip(dt: number): void {
    const g = this.game;
    if (this.tip) {
      // Menu tips close with their menu; the others count down.
      const menu = MENU_TIPS[this.tip.id];
      if (menu && g.screens.current !== menu) this.tip.left = 0;
      this.tip.left -= dt;
      if (this.tip.left <= 0) {
        if (!menu) this.gapT = firstTenTuning.tipGap;
        this.closeTip();
      }
      return;
    }
    if (settings.tips === false) this.queue.length = 0;
    if (this.gapT > 0) this.gapT -= dt;
    // In-fight tips wait for the gap after the last one and for the stage banner to clear.
    const quiet = this.gapT > 0 || (g.isCombatMode && g.director.time < firstTenTuning.stageQuiet);
    while (this.queue.length) {
      if (quiet && !MENU_TIPS[this.queue[0]]) return;
      const id = this.queue.shift()!;
      const menu = MENU_TIPS[id];
      if (menu && g.screens.current !== menu) continue; // missed its menu: it comes back next time
      if (save.tips.includes(id)) continue;
      const def = TIPS[id];
      const t = tipTime(def);
      this.tip = { id, left: t };
      save.tips.push(id);
      this.dirty = true;
      this.ui.showTip(def.title, def.text(), t);
      return;
    }
  }

  closeTip(): void {
    this.tip = null;
    this.ui.hideTip();
  }

  private clearTips(): void {
    this.queue = [];
    this.closeTip();
  }

  /** Look for first-time moments (every 10 steps, and when a menu opens). */
  private detectTips(): void {
    const g = this.game;
    if (settings.tips === false || g.mode === 'title' || this.training) return;
    const h = g.hero;
    const scr = g.screens.current;
    const root = this.root;
    if (scr === 'levelup') {
      this.want('levelup');
      if (root.querySelector('#scr-levelup .card.evo')) this.want('evofork');
    }
    if (scr === 'shop') {
      this.want('shop');
      if (root.querySelectorAll('#scr-shop .owned-mod:not(.empty)').length >= 2) this.want('modorder');
    }
    if (!g.isCombatMode) return;
    let elite = false;
    let exposed = false;
    let status = false;
    for (const e of this.enemies()) {
      if (!e.active || e.pvpOwner >= 0) continue;
      if (e.elite) elite = true;
      if (e.exposeT > 0) exposed = true;
      if (e.burnT > 0 || e.shockT > 0 || e.frozen > 0) status = true;
    }
    if (elite) this.want('elite');
    if (exposed) this.want('exposed');
    if (status) this.want('status');
    if (g.overloads > 0 || (h.damageBy.shatter ?? 0) > 0 || this.napalms > 0) this.want('combo');
    if (g.boss?.active || g.netBoss) this.want('boss');
    if (g.chests.closedCount > 0) this.want('chest');
    if (h.bombCharge >= 1 && g.runTime > 8 && g.firstten.specialTipReady()) this.want('special');
    if (h.skill.ult >= 1) this.want('ult');
    if (h.skill.style.rank >= 2) this.want('style');
    if (h.rerollsLeft > 0 && g.mode === 'fight' && g.runTime > 4) this.want('gear');
    if (g.mode === 'portal') this.want('portal');
    if (g.coop && !g.pvp) {
      if (h.player.dead) this.want('down');
      else if (g.heroes.some((o) => o !== h && !o.left && o.player.dead)) this.want('matedown');
    }
  }

  // ---------------------------------------------------------------- codex discovery

  /** Note codex keys as discovered (saved a little later). */
  note(...keys: string[]): void {
    for (const k of keys) {
      if (save.discovered.includes(k) || !isCodexKey(k)) continue;
      save.discovered.push(k);
      this.dirty = true;
    }
  }

  /** What this hero owns right now, and the statuses it has seen. */
  private discover(): void {
    const g = this.game;
    if (g.mode === 'title') return;
    const h = g.hero;
    const keys: string[] = [];
    for (const w of h.weapons) {
      keys.push(`w:${w.def.id}`);
      if (w.build && w.build.evo >= 0) keys.push(`e:${w.def.id}:${w.build.evo}`);
      if (w.partnerEvolved) keys.push(`e:${w.def.id}:auto`);
    }
    keys.push(`sp:${h.special.id}`);
    if (h.specialBuild && h.specialBuild.evo >= 0) keys.push(`e:${h.special.id}:${h.specialBuild.evo}`);
    for (const id of Object.keys(h.passives)) keys.push(`p:${id}`);
    if (g.role === 'client') for (const m of g.netMods) keys.push(`m:${m.id}`);
    else for (const s of h.synergy.slots) keys.push(`m:${s.def.id}`);
    for (const id of h.relics) keys.push(`r:${id}`);
    for (const id of h.combos) keys.push(`c:${id}`);
    for (const e of this.enemies()) {
      if (!e.active) continue;
      if (e.burnT > 0) keys.push('s:burn');
      if (e.shockT > 0) keys.push('s:shock');
      if (e.frozen > 0) keys.push('s:freeze');
      if (e.exposeT > 0) keys.push('s:expose');
    }
    if (g.overloads > 0) keys.push('s:overload');
    if ((h.damageBy.shatter ?? 0) > 0) keys.push('s:shatter');
    if (this.napalms > 0) keys.push('s:napalm');
    this.note(...keys);
  }

  /** Cards and shop offers count as seen. */
  private discoverOffers(): void {
    const h = this.game.hero;
    const keys: string[] = [];
    for (const o of h.offers) {
      if (o.kind === 'weapon' && o.tag === 'NEW!') keys.push(`w:${o.id}`);
      else if (o.kind === 'passive') keys.push(`p:${o.id}`);
      else if (o.kind === 'evolve') keys.push(`e:${o.id}:auto`);
      else if (o.kind === 'evo' && o.pick) {
        const [item, , k] = o.pick.split('|');
        keys.push(`e:${item === 'sp' ? h.special.id : item}:${k}`);
      }
    }
    for (const m of h.shopOffers) if (m) keys.push(`m:${m.id}`);
    for (const id of h.relicOffers) keys.push(`r:${id}`);
    this.note(...keys);
  }

  // ---------------------------------------------------------------- training

  private markOffered(): void {
    if (save.training.offered) return;
    save.training.offered = true;
    persist();
  }

  /** Start the training field (title menu, the first-time offer, or a test link with `first`). */
  startTraining(first = 0): void {
    const g = this.game;
    this.markOffered();
    this.clearTips();
    g.leaveToTitle();
    g.runMode = 'standard';
    // The run's starting shop opens and closes at once: it must not count as a first shop (tips, firstten helpers).
    this.opening = true;
    g.startRun({ seed: trainingTuning.seed, difficulty: 'easy' });
    if (g.mode === 'shop') g.closeShop();
    this.opening = false;
    this.godBefore = cheats.god;
    cheats.god = true;
    this.training = new Training(g, first);
    this.holdDirector();
    this.training.begin();
    this.stepWait = 0;
    g.vfx.banner('TRAINING', 'LEARN THE MOVES · NOTHING CAN HURT YOU HERE', 2);
    this.showStep();
  }

  /** No spawns, no stage clock, no chests over time: the field stays quiet. */
  private holdDirector(): void {
    const g = this.game;
    g.director.time = 0;
    g.director.countMul = 0;
    g.chestT = 0;
  }

  private trainingStep(dt: number): void {
    const g = this.game;
    const t = this.training!;
    // Left the run (pause > quit, or a new run started elsewhere).
    if (g.mode === 'title' || g.mode === 'dead' || g.role !== 'solo') {
      this.stopTraining();
      return;
    }
    this.holdDirector();
    const h = g.hero;
    if (h.player.hp < h.player.maxHp) h.player.heal(h.player.maxHp);
    if (t.done || g.paused) return;
    if (this.stepWait > 0) {
      // A short beat between steps so the "done" flash reads.
      this.stepWait -= dt;
      if (this.stepWait <= 0) this.advance();
      return;
    }
    if (g.mode !== 'fight' && g.mode !== 'levelup') return;
    if (g.mode === 'fight' || t.current.id === 'levelup') {
      if (t.tick(dt)) {
        this.ui.stepDone();
        g.vfx.sound('powerUp', NaN, NaN);
        g.vfx.num(h.player.x, 2.8, h.player.z, 'NICE!', 'score');
        this.stepWait = 0.9;
      }
    }
    if (this.n % 15 === 0) this.showStep();
  }

  /** Next step, or the "you're ready" screen after the last. */
  advance(): void {
    const t = this.training;
    if (!t || t.done) return;
    this.stepWait = 0;
    if (t.next()) {
      this.showStep();
      return;
    }
    save.training.done = true;
    persist();
    this.ui.setTraining(null);
    this.game.paused = true;
    this.game.screens.show('training');
  }

  private showStep(): void {
    const t = this.training;
    if (!t || t.done) return;
    this.ui.setTraining({ step: t.step, total: t.total, title: t.current.title, text: t.current.text(), canSkip: t.stepT > trainingTuning.skipAfter });
  }

  /** Training over: a real run, or back to the title. */
  endTraining(run: boolean): void {
    this.stopTraining();
    const g = this.game;
    g.paused = false;
    if (run) g.startSolo();
    else g.leaveToTitle();
  }

  private stopTraining(): void {
    if (!this.training) return;
    this.training = null;
    cheats.god = this.godBefore;
    this.ui.setTraining(null);
  }
}
