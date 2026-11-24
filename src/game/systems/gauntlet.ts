import { abyss, beginAbyss, abyssBoard, mutationText, warnedScrap } from '../abyss';
import { ABYSS_MUTATIONS } from '../../data/abyssMutations';
import { PickupType } from '../pickups';
import { ascensionBadge } from '../../ui/ascensionBadges';
import { localize, localizeHtml, t } from '../../i18n';
/** Solo endgame rules. Host-only loop mutators use normal enemy snapshots and the effects bus. */
import type { Game } from '../game';
import type { Enemy, SpawnOpts } from '../enemies';
import type { SpawnRequest } from '../director';
import { ENEMIES, miniBossForStage, type EnemyDef } from '../../data/enemies';
import { DIFF_BY_ID } from '../../data/modes';
import { REMIX_OF } from '../../data/bossRemix';
import { ELITE_MODS, type EliteModDef } from '../../data/eliteMods';
import { ASCENSIONS, ASCENSION_TITLES, LOOP_MUTATORS, ascensionLevel, ascensionRules, gauntletProfile, gauntletScore, loopMutators, persistGauntlet, recordAscensionVictory, rushSlot } from '../../data/ascension';
import { loadJson, saveJson } from '../../core/storage';
import { save, saveLock } from '../save';
import { settings } from '../settings';
import { announcer } from '../../audio/announcer';
import * as Spice from './spice';
import * as Statuses from './statuses';
import * as BossFight from './bossFight';
import { clearBossLane } from './bossLane';
import type { ScoreEntry } from '../highscores';
import type { RunSummary, Screens } from '../../ui/screens';
import { fetchTop, leaderboardEnabled } from '../../net/leaderboard';
import { trialActive } from './trials';
import { editorNet } from './editor';

export const gauntletTuning = { wave: 30, mini: 180, boss: 360, aliveStart: 20, alivePerWave: 12, aliveCap: 350, spawnRate: 16, shopSeconds: 20, attackEvery: 8 };
interface ChallengeState {
  shieldIssued: boolean;
  previewBadge?: number;
  previewTier?: boolean;
  patrol: boolean; escortPending: boolean; firstElite: boolean; quarter: boolean; half: boolean; offset: boolean;
  ascension: number; ng: boolean; rules: ReturnType<typeof ascensionRules>; mutators: number[];
  time: number; wave: number; budget: number; pool: EnemyDef[]; queue: SpawnRequest[];
  nextMini: number; nextBoss: number; bossCount: number; pendingBosses: number;
  splits: { name: string; time: number; total: number }[]; splitAt: number; shopLeft: number;
  attack: number; attackWarn: number; attackBoss: number; announced: boolean; announcementT: number;
  hud: HTMLElement | null; hudKey: string; hudAt: number; bankRank: number;
}
const states = new WeakMap<Game, ChallengeState>();
export function challengeState(g: Game): ChallengeState {
  let s = states.get(g);
  if (!s) {
    s = { shieldIssued: false, patrol: false, escortPending: false, firstElite: true, quarter: false, half: false, offset: false, ascension: 0, ng: false, rules: ascensionRules(0), mutators: [0, 0, 0, 0], time: 0, wave: -1, budget: 0, pool: [], queue: [],
      nextMini: 180, nextBoss: 360, bossCount: 0, pendingBosses: 0, splits: [], splitAt: 0, shopLeft: 0,
      attack: 8, attackWarn: 0, attackBoss: 0, announced: false, announcementT: 0, hud: null, hudKey: '', hudAt: -1, bankRank: -1 };
    states.set(g, s);
  }
  return s;
}
/** Registered base bosses, including Titan and future bosses; variants and body parts are excluded. */
let rosterCache: EnemyDef[] | null = null;
export function rushRoster(): EnemyDef[] {
  return rosterCache ??= Object.values(ENEMIES).filter(d => d.boss && !d.secret && !d.remixOf && d.behavior !== 'titanpart');
}
function soloClimb(g: Game): boolean {
  return (g.runMode === 'standard' || g.runMode === 'endless') && g.role === 'solo' && !g.coop &&
    !g.pvp && !g.versus && !g.race && !g.onboarding.training && !trialActive(g) && !editorNet(g);
}
export function startGauntlet(g: Game): void {
  document.getElementById('g-shop-clock')?.remove();
  const old = states.get(g);
  states.delete(g);
  const s = challengeState(g);
  s.hud = old?.hud ?? null;
  s.nextMini = gauntletTuning.mini; s.nextBoss = gauntletTuning.boss;
  const solo = soloClimb(g);
  if (save.achievements.includes('victory')) gauntletProfile.victory = true; // old profiles retain their earned NG+ access
  s.ascension = solo ? Math.min(gauntletProfile.unlocked, gauntletProfile.selected) : 0;
  s.ng = solo && gauntletProfile.victory && gauntletProfile.ng;
  s.rules = ascensionRules(s.ascension);
  if (s.ascension) g.difficulty = DIFF_BY_ID.hard;
  g.preShop = false;
}
export function gauntletStage(g: Game): void {
  const s = challengeState(g);
  s.mutators = !g.pvp && ['standard', 'endless'].includes(g.runMode) ? loopMutators(g.stage) : [0, 0, 0, 0];
  s.patrol = false; s.escortPending = false; s.firstElite = true; s.quarter = false; s.half = false; s.offset = false;
  s.shieldIssued = false;
  if (s.rules.tier >= 4 && g.stage % 2 === 0) s.mutators[3] ||= 1;
  if (s.rules.tier >= 1 && g.stage > 1) for (const h of g.heroes) {
    h.rerollsLeft = 0;
    if (s.rules.tier >= 11) h.gold = Math.min(10, h.gold);
  }
  if (g.runMode === 'abyss') abyss(g)?.enter(g);
  g.director.countMul *= s.rules.count;
  s.attack = gauntletTuning.attackEvery;
  s.attackWarn = 0;
  s.attackBoss = 0;
  s.splitAt = s.time;
  if (g.runMode === 'bossrush') g.director.hold = true;
  if (g.runMode === 'gauntlet') {
    g.director.bossSpawned = false;
    g.bossField.miniStage = g.stage;
    g.modes.rhythm = false;
    g.modes.pacifist = false;
    g.modes.holster = false;
    g.chests.clear();
  }
}
export function gauntletLabel(g: Game): string {
  if (g.role !== 'solo') return '';
  const s = challengeState(g);
  return [s.ascension ? `ASCENSION ${s.ascension}` : '', s.ng ? 'NEW GAME+' : ''].filter(Boolean).join(' · ');
}
export function gauntletSub(g: Game): string {
  const s = challengeState(g);
  const descent = g.runMode === 'abyss' && abyss(g);
  if (descent) return t('abyss.intro', { floor: descent.floor, name: localize(ABYSS_MUTATIONS[descent.current].name), rule: mutationText(descent.current) });
  if (g.runMode === 'gauntlet') return 'NO SHOPS · NO PORTALS · TIME × KILLS<br>WAVES 0:30 · MINI-BOSSES 3:00 · BOSSES 6:00';
  if (g.runMode === 'bossrush') {
    const r = rushSlot(g.stage, rushRoster().length);
    return `LAP ${r.lap}/2 · BOSS ${r.index + 1}/${rushRoster().length}<br>${r.lap > 1 ? 'REMIXED ATTACKS' : 'THE CLOCK IS RUNNING'}`;
  }
  return [gauntletLabel(g), ...LOOP_MUTATORS.filter((_, i) => s.mutators[i]).map(m => m)].filter(Boolean).join(' · ');
}
export function gauntletSpawn(g: Game, out: SpawnOpts): void {
  const s = challengeState(g);
  out.hpMul = (out.hpMul ?? 1) * s.rules.hp * (s.ng ? 1.35 : 1);
  out.dmgMul = (out.dmgMul ?? 1) * s.rules.damage * (s.ng ? 1.15 : 1);
  out.speedMul = (out.speedMul ?? 1) * s.rules.speed * (1 + s.mutators[0] * 0.15);
}
const doubledMods: Record<string, EliteModDef> = {};
for (const m of Object.values(ELITE_MODS)) doubledMods[m.id] = { ...m, name: `Double ${m.name}`,
  shield: m.shield ? m.shield * 2 : undefined, teleport: m.teleport ? m.teleport / 2 : undefined,
  vampire: m.vampire ? { onHit: m.vampire.onHit * 2, regen: m.vampire.regen * 2 } : undefined,
  split: m.split ? { ...m.split, count: m.split.count * 2 } : undefined,
  explode: m.explode ? { ...m.explode, dmg: m.explode.dmg * 2 } : undefined };
export function gauntletElite(g: Game, e: Enemy): void {
  if (!challengeState(g).rules.doubleElites || !e.mod) return;
  const old = e.mod;
  e.mod = doubledMods[old.id];
  if (old.shield) e.shield *= 2;
  if (old.speedMul) e.speedMul *= (1 + (old.speedMul - 1) * 2) / old.speedMul;
}
/** Called after the existing stage-boss selector, so a Rush slot cannot be replaced by the loop's Titan. */
export function gauntletBoss(g: Game, base: EnemyDef): EnemyDef | null {
  const s = challengeState(g);
  if (g.runMode === 'bossrush') {
    const roster = rushRoster(), slot = rushSlot(g.stage, roster.length);
    const def = roster[slot.index];
    return slot.lap > 1 && REMIX_OF[def.id] ? ENEMIES[REMIX_OF[def.id]] : def;
  }
  if ((s.ng || s.rules.tier >= 20) && REMIX_OF[base.id]) return ENEMIES[REMIX_OF[base.id]];
  return null;
}
/** One continuous arena, with a reusable request buffer and a pool refreshed only at wave boundaries. */
export function gauntletRequests(g: Game, dt: number): SpawnRequest[] {
  const s = challengeState(g), t = gauntletTuning, d = g.director;
  s.queue.length = 0;
  const wave = Math.floor(s.time / t.wave);
  if (wave !== s.wave) {
    s.wave = wave;
    d.stage = 1 + Math.floor(wave / 4);
    d.time = Math.min(239, wave * 20);
    s.pool = d.pool();
    if (wave > 0) {
      s.queue.push({ kind: 'enemy', def: g.rng.pick(s.pool), elite: true });
      g.vfx.toast(`GAUNTLET WAVE ${wave + 1} · STRONGER FOES`, 2);
    }
  }
  if (s.time >= s.nextMini && !g.bossField.mini && !g.bossField.miniWarn) {
    s.nextMini += t.mini;
    const def = miniBossForStage(Math.max(2, 1 + Math.floor(s.time / t.mini)));
    const p = g.ringPoint(13, 16, def.radius);
    if (p) {
      g.bossField.miniWarn = { def, x: p.x, z: p.z, t: 1.5 };
      g.vfx.zone(p.x, p.z, def.radius * 1.8, 1.5);
      g.vfx.toast(`MINI-BOSS: ${def.name.toUpperCase()}`);
    }
  }
  if (s.time >= s.nextBoss) { s.nextBoss += t.boss; s.pendingBosses++; }
  if (s.pendingBosses > 0 && !g.boss) {
    s.pendingBosses--;
    const roster = rushRoster();
    s.queue.push({ kind: 'boss', def: roster[s.bossCount++ % roster.length] });
  }
  const target = Math.min(t.aliveCap, Math.round((t.aliveStart + wave * t.alivePerWave) * g.difficulty.enemyCount));
  if (!d.hold && g.enemies.activeCount < target) {
    s.budget = Math.min(4, s.budget + dt * t.spawnRate);
    while (s.budget >= 1) {
      s.budget--;
      const def = g.rng.pick(s.pool);
      if (def.maxAlive !== undefined && g.enemies.countOf(def.id) >= def.maxAlive) continue;
      s.queue.push({ kind: 'enemy', def });
    }
  }
  return s.queue;
}
export function gauntletTick(g: Game, dt: number): void {
  if (g.role === 'client' || !g.heroes.some(h => !h.player.dead && !h.left) || g.mode !== 'fight') return;
  const s = challengeState(g);
  s.time += dt;
  if (g.runMode === 'gauntlet') g.score = gauntletScore(s.time, g.kills) / g.meta.multiplier;
  if (g.runMode === 'abyss') {
    if (g.mode === 'fight' && !g.hero.player.dead) abyss(g)?.tick(g, dt);
    return;
  }
  const tier = s.rules.tier;
  if (s.escortPending) { s.escortPending = false; g.spawnEnemy(ENEMIES.shielder); }
  if (tier >= 2 && !s.patrol && g.director.time >= 30) {
    s.patrol = true;
    g.spawnEnemy(ENEMIES.zippy); g.spawnEnemy(ENEMIES.zippy);
  }
  const b = g.boss;
  const rings = s.rules.attacks + (s.ng ? 1 : 0) + s.mutators[2] + (g.runMode === 'bossrush' && rushSlot(g.stage, rushRoster().length).lap > 1 ? 1 : 0);
  if (!rings || !b?.alive || b.roarT > 0 || g.bossIntro.active) return;
  if (s.attackBoss !== b.uid) {
    s.attackBoss = b.uid; s.attack = gauntletTuning.attackEvery; s.attackWarn = 0;
    s.quarter = s.half = s.offset = false;
  }
  if (tier >= 10 && !s.quarter && b.hp <= b.maxHp / 4) {
    s.quarter = true;
    g.vfx.toast(t('asc.quarter'));
    if (!g.bossDuel) { g.spawnEnemy(ENEMIES.zippy); g.spawnEnemy(ENEMIES.zippy); }
    s.attack = Math.min(s.attack, 5);
  }
  if (tier >= 19 && !s.half && b.hp <= b.maxHp / 2) {
    s.half = true; g.spawnEnemy(ENEMIES.medic);
  }
  if (s.attackWarn > 0) {
    s.attackWarn -= dt;
    if (s.attackWarn <= 0) {
      const count = Math.min(32, 8 * rings);
      for (let i = 0; i < count; i++) {
        const a = i * Math.PI * 2 / count + ((s.mutators[2] || s.offset) ? Math.PI / count : 0);
        g.enemyCtx.fireBullet(b, Math.cos(a), Math.sin(a), 7, 12);
      }
      g.vfx.sound('bossSlam', b.x, b.z);
      if (tier >= 14) s.offset = !s.offset;
      s.attack = s.quarter ? 5 : gauntletTuning.attackEvery;
    }
  } else if ((s.attack -= dt) <= 0) {
    s.attackWarn = 1;
    g.vfx.zone(b.x, b.z, 4, 1);
    g.vfx.sound('bossWindup', b.x, b.z);
  }
}
/** Shop time advances even while combat is frozen, but never while paused. */
export function gauntletMenuTick(g: Game, dt: number): void {
  const s = states.get(g);
  if (!s) return;
  if ((g.runMode === 'bossrush' || s.rules.tier >= 18) && g.mode === 'shop' && !g.preShop && s.shopLeft > 0 && !g.route.open && g.screens.current !== 'relic') {
    if (!g.paused) s.shopLeft -= dt;
    const clock = document.getElementById('g-shop-clock');
    const label = s.rules.tier >= 18 ? t('asc.shopClock', { seconds: Math.max(0, Math.ceil(s.shopLeft)) }) : localize(`NEXT BOSS IN ${Math.max(0, Math.ceil(s.shopLeft))}s`);
    if (clock && clock.textContent !== label) clock.textContent = localize(label);
    if (s.shopLeft <= 0) g.closeShop();
  }
  if (!s.announced && g.mode === 'fight' && (g.runMode === 'gauntlet' || s.ascension)) {
    s.announcementT += dt;
    if (s.announcementT > 2) s.announced = announcer.say(g.runMode === 'gauntlet' ? 'vo_gauntlet' : 'vo_ascension');
  }
}
export function gauntletKill(g: Game, e: Enemy): void {
  const s = challengeState(g);
  if (g.runMode === 'abyss') { abyss(g)?.kill(g, e); return; }
  if (s.rules.tier >= 6 && e.elite) {
    if (s.firstElite) {
      s.firstElite = false;
      g.pickups.spawn(PickupType.Heart, e.x, e.z);
      if (s.rules.tier >= 9) s.escortPending = true; // defer the escort until the pooled death is fully resolved
    }
    if (s.rules.tier >= 16) warnedScrap(g, e, 2.4);
  }
  if ((e.def.id === 'omega' || e.def.remixOf === 'omega') && !s.previewTier && !saveLock.on && soloClimb(g)) {
    const firstLoop = !gauntletProfile.victory;
    const newBadge = s.ascension > gauntletProfile.cleared;
    recordAscensionVictory(s.ascension, g.difficulty.id === 'hard' || g.difficulty.id === 'nightmare');
    g.vfx.toast(s.ascension ? `ASCENSION ${s.ascension} CLEARED!` : 'NEW GAME+ UNLOCKED!', 4);
    if (firstLoop) g.vfx.toast(t('abyss.unlocked'), 4);
    if (newBadge) g.vfx.toast(t('asc.earned', { badge: localize(ASCENSIONS[s.ascension - 1].badge) }), 4);
    if (s.ascension && s.ascension % 5 === 0) g.vfx.toast(`TITLE EARNED: ${ASCENSION_TITLES[s.ascension / 5 - 1]}`, 4);
  }
  if (g.runMode === 'gauntlet' && e.elite) { g.elitesRun++; g.runEvents.onElite(); }
  if (g.runMode === 'gauntlet' && e === g.boss) { g.bossesRun++; clearBossLane.call(g); }
  if (s.mutators[1] && !e.def.hidden && !e.def.boss && g.strikes.length < 64) {
    g.strikes.push({ x: e.x, z: e.z, r: 2.4, t: 1, dmg: 12 * s.mutators[1], cause: 'Explosive deaths' });
    g.vfx.zone(e.x, e.z, 2.4, 1);
  }
}
export function stageClear(this: Game): void {
  if (this.runMode === 'abyss' || this.runMode === 'gauntlet') return;
  const s = challengeState(this);
  if (this.runMode === 'bossrush') {
    this.bossesRun++;
    const def = rushRoster()[rushSlot(this.stage, rushRoster().length).index];
    s.splits.push({ name: def.name, time: s.time - s.splitAt, total: s.time });
    this.bullets.clear();
    this.pickups.vacuum = true;
    for (const e of this.enemies.list) if (e.active) this.enemies.kill(e);
    clearBossLane.call(this);
    this.mode = 'cleared';
    this.modeT = 0;
    this.hero.gold += 20;
    this.vfx.banner('SPLIT!', `${def.name.toUpperCase()} · ${formatTime(s.time - s.splitAt)}<br>TOTAL ${formatTime(s.time)}`, 2);
    if (this.stage >= rushRoster().length * 2) {
      this.victories++;
      this.mode = 'dead';
      this.gameOverShown = true;
      this.endRun();
    }
    return;
  }
  // Stage-clear healing is suppressed without suppressing other clear rewards or synergy hooks.
  const hp = s.rules.noHeal ? this.heroes.map(h => h.player.hp) : null;
  Spice.stageClear.call(this);
  if (hp) this.heroes.forEach((h, i) => { h.player.hp = Math.min(h.player.hp, hp[i]); });
}
export function openShop(this: Game): void {
  if (this.runMode === 'gauntlet') { this.preShop = false; this.mode = 'fight'; return; }
  if (this.runMode === 'bossrush' && !this.preShop) {
    if (!rushSlot(this.stage, rushRoster().length).shop) { this.loadStage(this.stage + 1); return; }
    challengeState(this).shopLeft = gauntletTuning.shopSeconds;
  }
  if (this.runMode === 'bossrush' && !this.preShop) {
    // Timed Rush breaks use the normal shop; secret relic choices would obscure its countdown.
    this.mode = 'shop'; this.secretShop = false;
    for (const h of this.heroes) {
      if (h.left) continue;
      h.openShop(false, false); this.presentShop(h); this.shopFx(h, 'open');
    }
    injectCss();
    document.getElementById('g-shop-clock')?.remove();
    const clock = document.createElement('div'); clock.id = 'g-shop-clock';
    clock.textContent = localize(`NEXT BOSS IN ${Math.ceil(challengeState(this).shopLeft)}s`);
    document.querySelector('#scr-shop h1')?.after(clock);
  } else {
    Spice.openShop.call(this);
    if (challengeState(this).rules.tier >= 18 && !this.preShop) {
      challengeState(this).shopLeft = 20;
      const clock = document.createElement('div'); clock.id = 'g-shop-clock';
      document.querySelector('#scr-shop h1')?.after(clock);
    }
  }
}
export function closeShop(this: Game): void {
  document.getElementById('g-shop-clock')?.remove();
  if (this.runMode === 'bossrush' && !this.preShop) {
    this.screens.show('none');
    this.loadStage(this.stage + 1);
    return;
  }
  Spice.closeShop.call(this);
  if (this.runMode === 'endless') { gauntletStage(this); this.vfx.banner(`WAVE ${this.stage}`, gauntletSub(this) || 'IT NEVER ENDS', 3); }
}
export function updateChestSpawns(this: Game, dt: number): void {
  if (this.runMode === 'gauntlet' || this.runMode === 'bossrush') return;
  if (this.boss && challengeState(this).rules.tier >= 17) return;
  Statuses.updateChestSpawns.call(this, dt * challengeState(this).rules.chest);
}
export function updateMiniBoss(this: Game, dt: number): void {
  if (this.runMode === 'gauntlet') this.bossField.miniStage = this.stage;
  BossFight.updateMiniBoss.call(this, dt);
}
export function loadGauntletScores(): ScoreEntry[] {
  const raw = loadJson<unknown>('gauntlet.scores.v1', []);
  return Array.isArray(raw) ? raw.filter(e => e && Number.isFinite(e.score) && e.score >= 0 && Number.isFinite(e.kills) && Number.isFinite(e.stage)).slice(0, 10) : [];
}
export function bankGauntlet(g: Game, sum: RunSummary): void {
  const s = challengeState(g);
  if (g.runMode === 'bossrush') {
    if (!saveLock.on) saveJson('gauntlet.splits.v1', s.splits);
    sum.time = s.time;
  }
  if (g.runMode !== 'gauntlet') return;
  sum.time = s.time;
  sum.score = gauntletScore(s.time, g.kills);
  const list = loadGauntletScores();
  const entry: ScoreEntry = { score: sum.score, kills: sum.kills, stage: s.wave + 1, date: new Date().toISOString().slice(0, 10), label: `${g.difficulty.name.toUpperCase()} · ${formatTime(s.time)}` };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const rank = list.indexOf(entry);
  s.bankRank = rank < 10 ? rank : -1;
  if (!saveLock.on) saveJson('gauntlet.scores.v1', list.slice(0, 10));
}
export function formatTime(t: number): string {
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
}

const CSS = `
#g-shop-clock {color:var(--yellow);font:20px var(--font);}
#g-challenge { padding:calc(2 * var(--p)) calc(3 * var(--p)); background:var(--night); color:var(--cyan); font:18px var(--font); white-space:pre-line; --hi:var(--blue); --lo:var(--ink); --ring:var(--ink); box-shadow:inset var(--p) var(--p) 0 var(--hi),inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 var(--lo),0 0 0 var(--p) var(--ring); }
body[data-gauntlet='true'] #timer { visibility:hidden; }
#g-dark {position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 0 min(14vw,130px) #1a1c2c;z-index:0;opacity:.92;}
#g-dark.g-edge { opacity:.28; }
.asc-pin {width:calc(7 * var(--p));height:calc(7 * var(--p));margin-inline-end:calc(2 * var(--p));vertical-align:middle;}
#g-dark[hidden] {display:none;}
#scr-modes { gap:calc(2 * var(--p)); padding:calc(4 * var(--p)); }
#scr-modes h1 { font-size:calc(14 * var(--p)); margin:0; }
#scr-modes .menu.row > button { padding:calc(2 * var(--p)) calc(4 * var(--p)); }
#scr-modes .mode-grid { grid-template-columns:repeat(3,minmax(200px,1fr)); gap:calc(3 * var(--p)); width:min(1000px,94vw); }
#scr-modes button.mode { min-height:calc(31 * var(--p)); padding:calc(3 * var(--p)); gap:var(--p); }
#scr-modes button.mode b {font-size:24px;}
#scr-modes button.mode small {font-size:16px;line-height:1.1;}
@media(max-width:700px) { #scr-modes .mode-grid {grid-template-columns:repeat(2,minmax(0,1fr));} }
#scr-modes .g-options {display:flex;gap:calc(2 * var(--p));flex-wrap:wrap;justify-content:center;}
#scr-modes .g-note {max-width:900px;margin:0 auto;color:var(--cyan);font:16px var(--font);}
#scr-gauntlet .g-board {max-width:760px;width:90%;max-height:55vh;overflow:auto;margin:0 auto;text-align:left;font:21px var(--font);white-space:pre-line;}
#scr-gauntlet h1 {color:var(--yellow);}
`;
function injectCss(): void {
  if (document.getElementById('g-css')) return;
  const css = document.createElement('style'); css.id = 'g-css'; css.textContent = CSS; document.head.append(css);
}
/** The goals parent already follows UI SCALE. DOM text updates only five times a second. */
export function renderGauntlet(g: Game): void {
  const s = challengeState(g);
  const active = g.mode !== 'title' && g.mode !== 'dead';
  const gauntlet = active && g.runMode === 'gauntlet';
  if (document.body.dataset.gauntlet !== String(gauntlet)) document.body.dataset.gauntlet = String(gauntlet);
  const dark = document.getElementById('g-dark');
  if (dark) {
    dark.hidden = !active || !s.mutators[3];
    dark.classList.toggle('g-edge', g.ascensionTier >= 4 && g.stage < 29);
  }
  if (!s.hud) {
    const goals = document.getElementById('goals');
    if (!goals) return;
    injectCss();
    if (!document.getElementById('g-dark')) { const shade = document.createElement('div'); shade.id = 'g-dark'; shade.hidden = true; document.getElementById('ingame')!.prepend(shade); }
    s.hud = document.createElement('div'); s.hud.id = 'g-challenge'; goals.prepend(s.hud);
  }
  const descent = g.runMode === 'abyss' ? abyss(g) : undefined;
  const badge = s.previewBadge ?? gauntletProfile.badge;
  s.hud.hidden = !active || !(descent || badge || gauntlet || g.runMode === 'bossrush' || g.ascensionTier || (s.ng && g.role === 'solo') || s.mutators.some(Boolean) || gauntletProfile.title);
  const now = Math.floor(performance.now() / 200);
  if (now === s.hudAt || s.hud.hidden) return;
  s.hudAt = now;
  let text = gauntlet ? `SURVIVAL GAUNTLET · WAVE ${Math.floor(s.time / gauntletTuning.wave) + 1}\n${formatTime(s.time)} × ${g.kills} KILLS\n${gauntletScore(s.time, g.kills).toLocaleString('en-US')} POINTS\nNEXT WAVE ${Math.ceil(gauntletTuning.wave - s.time % gauntletTuning.wave)}s` : gauntletLabel(g);
  if (g.runMode === 'bossrush') {
    const slot = rushSlot(g.stage, rushRoster().length), split = s.splits.at(-1);
    text = `BOSS RUSH · LAP ${slot.lap}/2\nCOMBAT TIME ${formatTime(s.time)}\n${split ? `LAST ${formatTime(split.time)} · ${split.name}` : 'FIRST SPLIT AHEAD'}`;
    if (g.mode === 'shop' && !g.preShop) text += `\nSHOP CLOSES IN ${Math.ceil(s.shopLeft)}s`;
  }
  if (g.ascensionTier) {
    text = t('asc.hud', { tier: s.ascension, name: localize(ASCENSIONS[s.ascension - 1].name) });
    if (s.ng) text += ' · ' + localize('NEW GAME+');
  }
  for (let i = 0; i < 4; i++) if (s.mutators[i]) text += `\n${localize(LOOP_MUTATORS[i])} ×${s.mutators[i]}`;
  if (descent) text = t('abyss.hud', { floor: descent.floor, name: localize(ABYSS_MUTATIONS[descent.current].name) });
  if (gauntletProfile.title) text += `\n★ ${localize(ASCENSION_TITLES[gauntletProfile.title - 1])}`;
  const badgeName = badge ? localize(ASCENSIONS[badge - 1].badge) : '';
  const key = text + badgeName;
  if (key !== s.hudKey) {
    s.hudKey = key;
    s.hud.textContent = localize(text);
    if (badge) {
      if (text) s.hud.append(document.createElement('br'));
      s.hud.insertAdjacentHTML('beforeend', ascensionBadge(badge));
      s.hud.append(badgeName);
    }
  }
}
export function renderGauntletOptions(el: HTMLElement): void {
  injectCss();
  let box = el.querySelector<HTMLElement>('.g-options');
  if (!box) {
    box = document.createElement('div'); box.className = 'g-options menu row';
    const note = document.createElement('div'); note.className = 'g-note';
    el.querySelector('.mode-note')!.after(box, note);
  }
  const p = gauntletProfile, eligible = settings.mode === 'standard' || settings.mode === 'endless';
  const victory = p.victory || save.achievements.includes('victory');
  box.innerHTML = localizeHtml(`<button data-nav data-act="g-down" ${!eligible || !p.selected ? 'disabled' : ''}>−</button><button data-nav data-act="g-up" ${!eligible || p.selected >= p.unlocked ? 'disabled' : ''}>ASCENSION ${p.selected} / ${p.unlocked} +</button><button data-nav data-act="g-ng" ${!eligible || !victory ? 'disabled' : ''}>NEW GAME+ ${p.ng ? 'ON' : 'OFF'}</button><button data-nav data-act="g-records">CHALLENGE RECORDS</button>${p.cleared >= 5 ? '<button data-nav data-act="g-title">TITLE</button>' : ''}`);
  const note = el.querySelector<HTMLElement>('.g-note')!;
  const tier = ASCENSIONS[p.selected - 1];
  if (!eligible) note.textContent = localize('Ascension and New Game+ apply to Standard and Endless solo runs.');
  else if (!p.unlocked) note.textContent = localize('Beat Omega on Hard to unlock Ascension 1. Clear each level to unlock the next.');
  else note.textContent = tier ? t('asc.preview', { tier: p.selected, name: localize(tier.name), rule: localize(tier.desc), badge: localize(tier.badge) }) : t('asc.off');
  if (p.cleared) box.insertAdjacentHTML('beforeend', '<button data-nav data-act="g-badge">' + ascensionBadge(p.badge) + t('asc.badge', { badge: p.badge ? localize(ASCENSIONS[p.badge - 1].badge) : t('asc.none') }) + '</button>');
  if (p.title) note.textContent += localize(` ★ ${ASCENSION_TITLES[p.title - 1]}`);
}
export function gauntletOption(action: string, screens: Screens): boolean {
  if (!action.startsWith('g-')) return false;
  const p = gauntletProfile;
  if (action === 'g-up') p.selected = Math.min(p.unlocked, p.selected + 1);
  if (action === 'g-down') p.selected = Math.max(0, p.selected - 1);
  if (action === 'g-ng') { p.victory ||= save.achievements.includes('victory'); if (p.victory) p.ng = !p.ng; }
  if (action === 'g-badge') p.badge = (p.badge + 1) % (p.cleared + 1);
  if (action === 'g-title') p.title = (p.title + 1) % (Math.floor(p.cleared / 5) + 1);
  persistGauntlet();
  if (action === 'g-records') { initGauntletScreen(screens); screens.show('gauntlet'); }
  return true;
}
const screenSet = new WeakMap<Screens, () => void>();
function initGauntletScreen(screens: Screens): void {
  if (screenSet.has(screens)) { screenSet.get(screens)!(); return; }
  injectCss();
  const el = document.createElement('div'); el.id = 'scr-gauntlet'; el.className = 'screen dim'; el.hidden = true;
  el.innerHTML = localizeHtml('<h1>CHALLENGE RECORDS</h1><div class="g-board"></div><div class="menu row"><button data-nav class="g-local">LOCAL BESTS</button><button data-nav class="g-online">ONLINE GAUNTLET</button><button data-nav class="g-back">BACK</button></div>');
  const board = el.querySelector<HTMLElement>('.g-board')!;
  const local = () => {
    request++;
    const scores = loadGauntletScores();
    const raw = loadJson<unknown>('gauntlet.splits.v1', []);
    const splits = Array.isArray(raw) ? raw.filter(s => s && typeof s.name === 'string' && Number.isFinite(s.time) && Number.isFinite(s.total)).slice(0, 60) : [];
    board.textContent = localize(`SURVIVAL GAUNTLET · TOP 10\n${scores.length ? scores.map((s, i) => `${i + 1}. ${s.score.toLocaleString('en-US')} · ${s.kills} KILLS · ${s.label}`).join('\n') : 'YOUR FIRST RUN STARTS THE TABLE.'}\n\nLAST BOSS RUSH · COMBAT SPLITS\n${splits.length ? splits.map((s, i) => `${i + 1}. ${s.name} · ${formatTime(s.time)} · TOTAL ${formatTime(s.total)}`).join('\n') : 'NO SPLITS YET.'}`);
  };
  const abyssTab = document.createElement('button');
  abyssTab.dataset.nav = ''; abyssTab.textContent = t('abyss.board');
  el.querySelector('.g-back')!.before(abyssTab);
  let request = 0;
  abyssTab.onclick = async () => {
    const id = ++request;
    board.textContent = t('abyss.loading');
    const text = await abyssBoard();
    if (id === request) board.textContent = text;
  };
  local();
  screenSet.set(screens, local);
  el.querySelector('.g-local')!.addEventListener('click', local);
  const online = el.querySelector<HTMLButtonElement>('.g-online')!;
  online.disabled = !leaderboardEnabled;
  online.addEventListener('click', () => {
    const id = ++request;
    board.textContent = localize('LOADING ONLINE GAUNTLET…');
    void fetchTop(`gauntlet-${settings.difficulty}`).then(rows => {
      if (id !== request) return;
      board.textContent = localize(rows ? `ONLINE GAUNTLET · ${settings.difficulty.toUpperCase()}\n${rows.map((r, i) => `${i + 1}. ${r.name} · ${r.score.toLocaleString('en-US')} · ${formatTime(r.time)}`).join('\n') || 'NO RUNS YET.'}` : 'BOARD UNAVAILABLE. LOCAL BESTS ARE SAFE.');
    });
  });
  el.querySelector('.g-back')!.addEventListener('click', () => screens.show('modes'));
  document.getElementById('hud')!.append(el);
  screens.addScreen('gauntlet', el, { onBack: () => screens.show('modes') });
}
/** Deterministic screenshots without changing persistent progression. */
export function gauntletTest(g: Game, q: URLSearchParams): void {
  if (q.has('abyss') && g.role === 'solo') {
    g.runMode = 'abyss';
    g.difficulty = DIFF_BY_ID.normal;
    startGauntlet(g);
    beginAbyss(g, () => true);
    g.loadStage(Math.max(1, Math.min(999, Math.floor(Number(q.get('abyss')) || 1))));
  }
  const s = challengeState(g);
  if (q.has('badge')) s.previewBadge = ascensionLevel(Number(q.get('badge')));
  if (q.has('ascension') && soloClimb(g)) {
    s.previewTier = true;
    s.ascension = ascensionLevel(Number(q.get('ascension')));
    s.rules = ascensionRules(s.ascension);
    if (s.ascension) g.difficulty = DIFF_BY_ID.hard;
  }
  if (q.has('ngplus')) s.ng = true;
  if (q.has('gauntlettime')) { s.time = Math.max(0, Number(q.get('gauntlettime')) || 0); s.nextMini = Math.ceil((s.time + 1) / 180) * 180; s.nextBoss = Math.ceil((s.time + 1) / 360) * 360; }
  gauntletStage(g);
  if (q.has('gauntletscreen')) setTimeout(() => { initGauntletScreen(g.screens); g.paused = true; g.screens.show(q.get('gauntletscreen') === 'records' ? 'gauntlet' : 'modes'); }, 500);
}

/** Rush uses the same boss arrival clock but no director horde. */
export function rushRequests(g: Game, dt: number): SpawnRequest[] {
  const s = challengeState(g);
  s.queue.length = 0;
  g.director.time += dt;
  if (!g.director.bossSpawned && g.director.time >= g.director.duration) {
    g.director.bossSpawned = true;
    s.queue.push({ kind: 'boss', def: rushRoster()[rushSlot(g.stage, rushRoster().length).index] });
  }
  return s.queue;
}
/** Late loop rules are authority-owned; clients only mirror the four HUD/darkness strengths. */
export function gauntletNet(g: Game): number[] | null {
  const s = challengeState(g);
  return s.mutators.some(Boolean) ? s.mutators : null;
}
export function applyGauntletNet(g: Game, raw: unknown): void {
  const s = challengeState(g);
  for (let i = 0; i < 4; i++) s.mutators[i] = Array.isArray(raw) && Number.isFinite(raw[i]) ? Math.max(0, Math.floor(raw[i])) : 0;
}
