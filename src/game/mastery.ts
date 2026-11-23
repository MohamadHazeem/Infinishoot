import { loadJson, saveJson } from '../core/storage';
import { randomSeed } from '../core/rng';
import { addMarks, bankMarks, masterySkin, normalizeCabinet, tracks, type Cabinet, type Tallies } from '../data/mastery';
import { settings } from './settings';
import { saveLock, unlockedWeapons } from './save';
import type { Game } from './game';
import { cheats } from './game';
import type { Hero } from './hero';
import type { Enemy } from './enemies';
import { SpeedAttempt } from './speedrun';
import { enterLife, isolatedProfile, keepLife, loseLife, recordHardcore, type HardcoreProfile } from './hardcore';
import { MasteryUi } from '../ui/masteryUi';
import { assistedRun, hasCasualOptions } from './systems/assists';
import { modSession } from '../mods/manager';
import { onlineServer } from '../net/onlineServer';
import type { ReplayFile } from '../dev/replay';
import { timeState } from './systems/time';

const key = 'mastery.v1';
export const normalCabinet = () => normalizeCabinet(loadJson(key,null));
export const keepCabinet = (c: Cabinet) => saveJson(key,c);
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
  private tallies = new Map<Hero,Tallies>();
  private untouched = new Set<Hero>();
  private boss: Enemy | null = null;
  private weaponKeys = new Map(tracks().filter(t=>t.id.startsWith('w.')).map(t=>[t.id.slice(2),t.id]));
  private heroKeys = new Map(tracks().filter(t=>t.id.startsWith('h.')).map(t=>[t.id.slice(2),t.id]));
  constructor(private g: Game, root: HTMLElement) {
    this.ui = new MasteryUi(g,this,root);
    const start = g.startRun.bind(g);
    g.startRun = fixed => {
      this.tallies.clear();
      this.untouched.clear();
      this.boss = null;
      start(fixed);
      this.eligible = g.authority && (!saveLock.on || this.mode === 'hardcore') && !g.pvp && !g.versus && !g.onboarding.training;
      for (const h of g.heroes) this.tallies.set(h,{});
      this.dress(this.mode ? this.life?.cabinet : normalCabinet());
    };
    const spawn = g.spawnBoss.bind(g);
    g.spawnBoss = def => {
      spawn(def);
      this.boss = g.boss;
      this.untouched.clear();
      for (const h of g.heroes) if (!h.left && !h.player.dead) this.untouched.add(h);
      this.speed?.split(g,false);
    };
    const hurt = g.mvpHurt.bind(g);
    g.mvpHurt = (h,damage) => {
      if (damage > 0) this.untouched.delete(h);
      hurt(h,damage);
    };
    const evolve = g.evolveFx.bind(g);
    g.evolveFx = (h,name,color) => {
      if (this.eligible && g.stage === 2) {
        const tally = this.tally(h);
        addMarks(tally,this.heroKeys.get(h.heroDef.id)!,0,0,false,true);
        const w = h.weapons.find(w=>w.evolved && w.name === name);
        if (w) addMarks(tally,'w.'+w.def.id,0,0,false,true);
      }
      evolve(h,name,color);
    };
    const clear = g.stageClear.bind(g);
    g.stageClear = () => {
      const before = g.bossesRun;
      clear();
      if (g.bossesRun <= before || g.mode !== 'cleared') return;
      if (this.eligible) for (const h of g.heroes) {
        if (h.left || h.player.dead) continue;
        const tally = this.tally(h);
        addMarks(tally,'h.'+h.heroDef.id,0,1);
        for (const w of h.weapons) addMarks(tally,'w.'+w.def.id,0,1);
      }
      if (this.speed) {
        this.speed.split(g,true);
        if (g.stage === 4) this.finish();
      }
    };
    const sum = g.summary.bind(g);
    g.summary = h => {
      const s = sum(h);
      if (this.eligible) s.mastery = this.tallies.get(h);
      return s;
    };
    const bank = g.bankAndShow.bind(g);
    g.bankAndShow = (s,quit) => {
      if (!saveLock.on && !g.meta.banked && s.mastery) {
        const c = normalCabinet();
        bankMarks(c,s.mastery);
        keepCabinet(c);
      }
      bank(s,quit);
    };
    const end = g.endRun.bind(g);
    g.endRun = quit => this.mode ? this.finish() : end(quit);
    const down = g.onHeroDown.bind(g);
    g.onHeroDown = h => {
      if (this.mode !== 'hardcore' || h !== g.hero) return down(h);
      if (!this.wiped) { this.wiped = true; loseLife(this.life!.life); }
      g.mode = 'dead'; g.modeT = 0; g.gameOverShown = false;
      g.vfx.sound('playerDie',h.player.x,h.player.z);
    };
    const title = g.goTitle.bind(g);
    g.goTitle = () => {
      this.leave();
      title();
    };
    const draw = g.renderModes.bind(g);
    g.renderModes = dt => { draw(dt); this.speed?.render(g,dt); };
  }
  private tally(h: Hero) {
    let tally = this.tallies.get(h);
    if (!tally) { tally = {}; this.tallies.set(h,tally); }
    return tally;
  }
  kill(e: Enemy, source: string, by: Hero | null) {
    if (!this.eligible || (saveLock.on && this.mode !== 'hardcore') || e.def.hidden) return;
    if (by) {
      const tally = this.tally(by);
      const hero = this.heroKeys.get(by.heroDef.id), weapon = this.weaponKeys.get(source);
      if (hero) addMarks(tally,hero,1);
      if (weapon) addMarks(tally,weapon,1);
    }
    if (e === this.boss) {
      for (const h of this.untouched) if (!h.left && !h.player.dead) {
        const tally = this.tally(h);
        addMarks(tally,'h.'+h.heroDef.id,0,0,true);
        for (const w of h.weapons) addMarks(tally,'w.'+w.def.id,0,0,true);
      }
      this.boss = null;
      this.untouched.clear();
    }
  }
  start(mode: EventMode, pilot='rookie') {
    const g = this.g;
    if (g.online || g.pvp || g.race || g.host || g.client || g.onboarding.training) return;
    g.leaveToTitle();
    this.mode = mode;
    this.results = this.wiped = false;
    this.practice = hasCasualOptions() || cheats.god || cheats.unlockAll || modSession.count > 0 || new URLSearchParams(location.search).has('test');
    this.life = mode === 'hardcore' ? enterLife() : null;
    this.runId = crypto.randomUUID();
    this.restore = isolatedProfile();
    this.speed = mode === 'speedrun' ? new SpeedAttempt(g) : null;
    const original = settings.loadout;
    try {
      // The daily rules omit seasonal, heat, ascension and echo modifiers. Supply our own seed.
      g.runMode = 'daily';
      g.hero.unlocked = unlockedWeapons();
      g.hero.setHeroDef(mode==='hardcore'?pilot:'rookie'); g.hero.setPet('none');
      settings.loadout = {primary:'buster',secondary:'charge',special:'bomb'};
      g.hero.loadoutPick = {...settings.loadout};
      g.startRun({seed:this.speed?.seed ?? randomSeed(),difficulty:'normal'});
      if (mode === 'hardcore') { g.hero.phoenixUsed = true; timeState(g).rewindsUsed = 1; }
      this.ui.begin(mode);
    } catch (error) { this.leave(); throw error; }
    finally { settings.loadout = original; }
  }
  step(dt: number) {
    if (this.results) return;
    const g = this.g;
    this.practice ||= assistedRun(g) || cheats.god || cheats.unlockAll;
    this.speed?.step(g,dt);
    this.ui.tick(g,this.speed);
  }
  private dress(c?: Cabinet) {
    if (!c) return;
    const g = this.g;
    if (c.skin) {
      const skin = masterySkin(c.skin);
      if (skin) g.player.setSkin(g.heroes.length > 1 ? g.hero.color : skin.armor,skin);
    }
    if (c.title) this.ui.showTitle(c.title);
  }
  private finish() {
    if (this.results) return;
    this.results = true;
    const g = this.g, attempt = this.speed;
    const won = !!attempt && attempt.splits.length === 8;
    const ms = Math.round((attempt?.clock ?? g.runTime)*1000);
    const row = {id:this.runId,score:Math.floor(g.score),stage:g.stage,ms,kills:g.kills};
    const valid = !this.practice && !assistedRun(g) && !cheats.god && !cheats.unlockAll;
    if (this.life) {
      if (g.player.dead && !this.wiped) { this.wiped = true; loseLife(this.life.life); }
      if (!this.wiped) { bankMarks(this.life.cabinet,this.tally(g.hero)); keepLife(this.life); }
      if (valid && row.score > 0 && ms > 0) {
        recordHardcore(row);
        if (onlineServer) this.ui.submission(fetch(onlineServer+'/hardcore',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)}).then(r=>r.ok));
      }
    }
    if (won && valid) {
      attempt!.saveBest(g);
      // The recorder appends the last update's hash after Game.update returns.
      if (onlineServer) this.ui.submission(Promise.resolve().then(()=>{
        const file = (window as Window & {replay?:{export():ReplayFile}}).replay?.export();
        return file ? attempt!.submit(file) : false;
      }));
    }
    g.mode = 'dead'; g.gameOverShown = true; g.paused = true;
    this.ui.finish(this.mode!,this.wiped,won,valid,row,attempt);
  }
  private leave() {
    this.eligible = false;
    if (!this.mode) return;
    this.speed && this.g.modes.view?.renderGhost(null,0);
    this.restore?.();
    this.restore = undefined; this.life = this.speed = this.mode = null;
    this.g.applyLocalSkin();
    this.ui.hide();
  }
}
