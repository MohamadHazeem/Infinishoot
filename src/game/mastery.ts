import { loadJson, saveJson } from '../core/storage';
import { randomSeed } from '../core/rng';
import {
  addMarks,
  bankMarks,
  masterySkin,
  normalizeCabinet,
  tracks,
  type Cabinet,
  type Tallies,
} from '../data/mastery';
import { settings } from './settings';
import { saveLock, unlockedWeapons } from './save';
import type { Game } from './game';
import { cheats } from './game';
import type { Hero } from './hero';
import type { Enemy } from './enemies';
import { SpeedAttempt } from './speedrun';
import {
  enterLife,
  isolatedProfile,
  bankLife,
  loseLife,
  recordHardcore,
  type HardcoreProfile,
} from './hardcore';
import { MasteryUi } from '../ui/masteryUi';
import { assistedRun, hasCasualOptions } from './systems/assists';
import { modSession } from '../mods/manager';
import { onlineServer } from '../net/onlineServer';
import type { ReplayFile } from '../dev/replay';
import { timeState } from './systems/time';

const key = 'mastery.v1';
export const normalCabinet = () => normalizeCabinet(loadJson(key, null));
export const keepCabinet = (c: Cabinet) => saveJson(key, normalizeCabinet(c));
export type EventMode = 'hardcore' | 'speedrun';
export class Mastery {
  readonly ui: MasteryUi;
  mode: EventMode | null = null;
  speed: SpeedAttempt | null = null;
  life: HardcoreProfile | null = null;
  private restore?: () => void;
  private eligible = false;
  private results = false;
  private wiped = false;
  private practice = false;
  private runId = '';
  private tallies: Tallies[] = [];
  private untouched = 0; // Seats that took no damage since the current boss arrived.
  private weaponKeys = new Map(
    tracks()
      .filter((t) => t.id.startsWith('w.'))
      .map((t) => [t.id.slice(2), t.id]),
  );
  private heroKeys = new Map(
    tracks()
      .filter((t) => t.id.startsWith('h.'))
      .map((t) => [t.id.slice(2), t.id]),
  );
  constructor(
    private g: Game,
    root: HTMLElement,
  ) {
    this.ui = new MasteryUi(g, this, root);
    const start = g.startRun.bind(g);
    g.startRun = (fixed) => {
      this.tallies = [];
      this.untouched = 0;
      start(fixed);
      if (this.speed) g.route.on = false; // All four stages include a boss, even on weeks with a Pacifist road.
      this.eligible =
        g.authority &&
        (!saveLock.on || this.mode === 'hardcore') &&
        !g.pvp &&
        !g.versus &&
        !g.onboarding.training;
      this.dress(this.mode ? this.life?.cabinet : normalCabinet());
    };
    const clientStart = g.clientStart.bind(g);
    g.clientStart = (...args) => {
      clientStart(...args);
      this.eligible = false;
      this.tallies = [];
      this.untouched = 0;
      this.dress(normalCabinet());
    };
    const spawn = g.spawnBoss.bind(g);
    g.spawnBoss = (def) => {
      spawn(def);
      this.untouched = 0;
      for (const h of g.heroes) if (!h.left && !h.player.dead) this.untouched |= 1 << h.index;
      this.speed?.split(g, false);
    };
    const hurt = g.mvpHurt.bind(g);
    g.mvpHurt = (h, damage) => {
      if (damage > 0) this.untouched &= ~(1 << h.index);
      hurt(h, damage);
    };
    const evolve = g.evolveFx.bind(g);
    g.evolveFx = (h, name, color) => {
      if (this.eligible && g.stage === 2) {
        const tally = this.tally(h);
        addMarks(tally, this.heroKeys.get(h.heroDef.id)!, 0, 0, false, true);
        const w = h.weapons.find((w) => w.evolved && w.name === name);
        if (w) addMarks(tally, 'w.' + w.def.id, 0, 0, false, true);
      }
      evolve(h, name, color);
    };
    const clear = g.stageClear.bind(g);
    g.stageClear = () => {
      const before = g.bossesRun;
      clear();
      if (g.bossesRun <= before || g.mode !== 'cleared') return;
      if (this.eligible)
        for (const h of g.heroes) {
          if (h.left || h.player.dead) continue;
          const tally = this.tally(h);
          addMarks(tally, 'h.' + h.heroDef.id, 0, 1);
          for (const w of h.weapons) addMarks(tally, 'w.' + w.def.id, 0, 1);
        }
      if (this.speed) {
        this.speed.split(g, true);
        if (g.stage === 4) this.finish();
      }
    };
    const sum = g.summary.bind(g);
    g.summary = (h) => {
      const s = sum(h);
      if (this.eligible) s.mastery = this.tallies[h.index];
      return s;
    };
    const bank = g.bankAndShow.bind(g);
    g.bankAndShow = (s, quit) => {
      if (!saveLock.on && !g.meta.banked && s.mastery) {
        const c = normalCabinet();
        bankMarks(c, s.mastery);
        keepCabinet(c);
      }
      bank(s, quit);
    };
    const end = g.endRun.bind(g);
    g.endRun = (quit) => (this.mode ? this.finish() : end(quit));
    const down = g.onHeroDown.bind(g);
    g.onHeroDown = (h) => {
      if (this.mode !== 'hardcore' || h !== g.hero) return down(h);
      if (!this.wiped) {
        this.wiped = true;
        loseLife(this.life!.life);
      }
      g.mode = 'dead';
      g.modeT = 0;
      g.gameOverShown = false;
      g.vfx.sound('playerDie', h.player.x, h.player.z);
    };
    const title = g.goTitle.bind(g);
    g.goTitle = () => {
      this.leave();
      title();
    };
    const draw = g.renderModes.bind(g);
    g.renderModes = (dt) => {
      draw(dt);
      this.speed?.render(g, dt);
    };
  }
  /** Keep the result open to every input device. Start must not resume a completed race. */
  resultInput(dt: number) {
    if (!this.mode || !this.results) return false;
    this.g.screens.update(this.g.input, dt);
    this.g.input.endStep();
    return true;
  }
  // A promoted guest can continue earning for every seat from the latest host checkpoint.
  checkpoint() {
    return this.eligible ? { marks: this.tallies, untouched: this.untouched } : undefined;
  }
  mirror(raw: unknown) {
    const packet = raw as { marks?: unknown[]; untouched?: number } | null;
    if (this.g.role !== 'client' || !Array.isArray(packet?.marks)) return;
    this.tallies = packet.marks
      .slice(0, this.g.heroes.length)
      .map((tracks) => normalizeCabinet({ tracks }).tracks);
    this.untouched = Number(packet.untouched) & 255;
    this.eligible = true;
  }
  private tally(h: Hero) {
    return (this.tallies[h.index] ??= {});
  }
  kill(e: Enemy, source: string, by: Hero | null, wasBoss: boolean) {
    if (
      !this.eligible ||
      !this.g.authority ||
      (saveLock.on && this.mode !== 'hardcore') ||
      e.def.hidden
    )
      return;
    if (by) {
      const tally = this.tally(by);
      const hero = this.heroKeys.get(by.heroDef.id),
        weapon = this.weaponKeys.get(source);
      if (hero) addMarks(tally, hero, 1);
      if (weapon) addMarks(tally, weapon, 1);
    }
    if (wasBoss) {
      for (const h of this.g.heroes)
        if (this.untouched & (1 << h.index) && !h.left && !h.player.dead) {
          const tally = this.tally(h);
          addMarks(tally, 'h.' + h.heroDef.id, 0, 0, true);
          for (const w of h.weapons) addMarks(tally, 'w.' + w.def.id, 0, 0, true);
        }
      this.untouched = 0;
    }
  }
  start(mode: EventMode, pilot = 'rookie') {
    const g = this.g;
    if (g.online || g.pvp || g.race || g.host || g.client || g.onboarding.training) return;
    g.leaveToTitle();
    this.mode = mode;
    this.results = this.wiped = false;
    this.practice =
      hasCasualOptions() ||
      cheats.god ||
      cheats.unlockAll ||
      modSession.count > 0 ||
      new URLSearchParams(location.search).has('test');
    this.life = mode === 'hardcore' ? enterLife() : null;
    this.runId = crypto.randomUUID();
    this.restore = isolatedProfile();
    this.speed = mode === 'speedrun' ? new SpeedAttempt(g) : null;
    const original = settings.loadout;
    try {
      // The daily rules omit seasonal, heat, ascension and echo modifiers. Supply our own seed.
      g.runMode = 'daily';
      g.hero.unlocked = unlockedWeapons();
      g.hero.setHeroDef(mode === 'hardcore' ? pilot : 'rookie');
      g.hero.setPet('none');
      settings.loadout = { primary: 'buster', secondary: 'charge', special: 'bomb' };
      g.hero.loadoutPick = { ...settings.loadout };
      g.startRun({ seed: this.speed?.seed ?? randomSeed(), difficulty: 'normal' });
      if (mode === 'hardcore') {
        g.hero.phoenixUsed = true;
        timeState(g).rewindsUsed = 1;
      }
      this.ui.begin(mode);
    } catch (error) {
      this.leave();
      throw error;
    } finally {
      settings.loadout = original;
    }
  }
  step(dt: number) {
    if (this.results) return;
    const g = this.g;
    this.practice ||= assistedRun(g) || cheats.god || cheats.unlockAll;
    this.speed?.step(g, dt);
    this.ui.tick(g, this.speed);
  }
  private dress(c?: Cabinet) {
    if (!c) return;
    const g = this.g;
    if (c.skin) {
      const skin = masterySkin(c.skin);
      if (skin) g.player.setSkin(g.heroes.length > 1 ? g.hero.color : skin.armor, skin);
    }
    if (c.title) this.ui.showTitle(c.title);
  }
  private finish() {
    if (this.results) return;
    this.results = true;
    const g = this.g,
      attempt = this.speed;
    const won = !!attempt && attempt.splits.length === 8;
    const ms = Math.round((attempt?.clock ?? g.runTime) * 1000);
    const row = { id: this.runId, score: Math.floor(g.score), stage: g.stage, ms, kills: g.kills };
    const valid = !this.practice && !assistedRun(g) && !cheats.god && !cheats.unlockAll;
    if (this.life) {
      if (g.player.dead && !this.wiped) {
        this.wiped = true;
        loseLife(this.life.life);
      }
      if (!this.wiped) this.wiped = !bankLife(this.life.life, this.tally(g.hero));
      if (valid && row.score > 0 && ms > 0) {
        recordHardcore(row);
        if (onlineServer)
          this.ui.submission(
            fetch(onlineServer + '/hardcore', {
              method: 'POST',
              credentials: 'omit',
              signal: AbortSignal.timeout(10000),
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(row),
            }).then((r) => r.ok),
          );
      }
    }
    if (won && valid) {
      attempt!.saveBest(g);
      // The recorder appends the last update's hash after Game.update returns.
      if (onlineServer)
        this.ui.submission(
          Promise.resolve().then(() => {
            const file = (
              window as Window & { replay?: { export(): ReplayFile } }
            ).replay?.export();
            return file ? attempt!.submit(file) : false;
          }),
        );
    }
    g.mode = 'dead';
    g.gameOverShown = true;
    g.paused = true;
    this.ui.finish(this.mode!, this.wiped, won, valid, row, attempt);
  }
  private leave() {
    this.eligible = false;
    if (!this.mode) return;
    this.speed && this.g.modes.view?.renderGhost(null, 0);
    this.restore?.();
    this.restore = undefined;
    this.life = this.speed = this.mode = null;
    this.results = false;
    this.g.applyLocalSkin();
    this.ui.hide();
  }
}
