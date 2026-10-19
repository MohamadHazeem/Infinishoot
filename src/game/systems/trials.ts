/** Trials owns its lifecycle; wrappers delegate unchanged outside a trial. Authority simulates, clients mirror `trial`. */
import { t } from '../../i18n';
import type { Game } from '../game';
import { cheats } from '../game';
import type { SpawnRequest } from '../director';
import { TRIALS, TRIAL_BY_ID, medalFor, recordTrial, normalizeTrialRecords, trialUnlocked, type TrialDef, type TrialResult, type TrialRecords } from '../../data/trials';
import { biomeForce } from '../../data/biomes';
import { ENEMIES } from '../../data/enemies';
import { DIFF_BY_ID } from '../../data/modes';
import { ascensionRules } from '../../data/ascension';
import { createWeapon } from '../weapons';
import { PickupType } from '../pickups';
import { Team } from '../bullets';
import { loadJson, saveJson } from '../../core/storage';
import { save, persist, saveLock, grantAchievement } from '../save';
import { challengeState } from './gauntlet';
import { meta2State, achievementToast, checkMeta2Achievements } from './meta2';
import { selectSeason } from './halloween';
import { ENV_SOURCES } from './arena';
import { secretsState } from './secrets';
import { gpWorld, startMech } from './gameplay';
import { forceCoopObjective, coopPlayState } from './coopplay';
import { startWorldEvent, worldRun, worldEventOf } from './worldEvents';
import { TrialsScreen } from '../../ui/trialsScreen';

export const trialsTuning = { spawnEvery: 0.8, bossHpMul: 4, hudEvery: 0.2, volleyEvery: 2, xpPerMedal: 100 };
export const PUZZLE_ORDER = [0, 2, 4, 1, 3, 5] as const;
export interface TrialRun {
  def: TrialDef; serial: string; time: number; damage: number; progress: number; parries: number; dashes: number; gems: number;
  bosses: number; bossUid: number; spawnT: number; volleyT: number; pulseT: number; hudT: number; puzzleTouch: number;
  pads: { x: number; z: number }[]; result: TrialResult | null; paid: boolean; xp: number; practice: boolean;
}
interface TrialsState { run: TrialRun | null; records: TrialRecords; screen: TrialsScreen; oldBiome: string | null; prepared: boolean; }
const states = new WeakMap<Game, TrialsState>();
const EMPTY_REQUESTS: SpawnRequest[] = [];
let serial = 0;
export function trialsState(g: Game): TrialsState { return states.get(g)!; }
export function trialActive(g: Game): boolean { return !!states.get(g)?.run; }
function fresh(d: TrialDef, id = `${Date.now()}-${++serial}`): TrialRun {
  return { def: d, serial: id, time: 0, damage: 0, progress: 0, parries: 0, dashes: 0, gems: 0, bosses: 0, bossUid: -1,
    spawnT: 0, volleyT: 1.5, pulseT: 0, hudT: 0, puzzleTouch: -1, pads: [], result: null, paid: false, xp: 0, practice: false };
}
export function trialPlayerCount(g: Game): number {
  if (g.role === 'host' && g.mode === 'title') return g.lobby.length;
  let n = 0; for (const h of g.heroes) if (!h.left) n++; return n;
}
function living(g: Game): number { let n = 0; for (const h of g.heroes) if (!h.left && !h.player.dead) n++; return n; }
export function canStartTrial(g: Game, d: TrialDef, practice = false): boolean {
  return g.role !== 'client' && !g.pvp && !g.versus && trialPlayerCount(g) === (d.players ?? 1) && (practice || trialUnlocked(d, trialsState(g).records));
}
export function startTrial(g: Game, id: string, practice = false): boolean {
  const s = states.get(g), d = TRIAL_BY_ID[id];
  if (!s || !d || !canStartTrial(g, d, practice)) return false;
  if (!s.run) s.oldBiome = biomeForce.key;
  s.run = fresh(d); s.run.practice = practice || saveLock.on || cheats.god;
  biomeForce.key = d.biome;
  g.runMode = 'standard'; g.lobbyKind = 'coop';
  if (g.role === 'host' && g.mode === 'title') g.hostStart(); else g.startRun();
  return true;
}
export function clearTrial(g: Game): void {
  const s = states.get(g);
  if (!s?.run) return;
  biomeForce.key = s.oldBiome;
  s.run = null; s.prepared = false;
  s.screen.hideHud();
  coopPlayState(g).force = null;
}

export function installTrials(g: Game): void {
  const s: TrialsState = { run: null, records: normalizeTrialRecords(loadJson('trials.v1', {})), screen: null!, oldBiome: null, prepared: false };
  states.set(g, s); s.screen = new TrialsScreen(g);
  const start = g.startRun.bind(g);
  g.startRun = fixed => {
    const r = s.run;
    if (!r) return start(fixed);
    // Retry always gets a fresh attempt; records/rewards remain local and monotonic.
    if (r.result) { const practice = r.practice; s.run = fresh(r.def); s.run.practice = practice; }
    const d = s.run!.def;
    biomeForce.key = d.biome;
    for (const h of g.heroes) { h.setHeroDef(d.hero); h.setPet('none'); }
    start({ seed: d.seed, difficulty: 'normal' });
    setupTrial(g);
  };
  const load = g.loadStage.bind(g);
  g.loadStage = stage => {
    if (s.run) {
      g.meta.heat = []; g.meta.rules = []; g.meta.week = '';
      const c = challengeState(g); c.ascension = 0; c.ng = false; c.rules = ascensionRules(0); c.mutators.fill(0);
      g.difficulty = DIFF_BY_ID.normal;
      selectSeason.call(g, null);
    }
    load(stage);
  };
  const title = g.goTitle.bind(g); g.goTitle = () => { clearTrial(g); title(); };
  const solo = g.startSolo.bind(g); g.startSolo = () => { clearTrial(g); solo(); };
  const end = g.endRun.bind(g); g.endRun = quit => { if (s.run) { finishTrial(g, false); if (quit) g.leaveToTitle(); } else end(quit); };
  const clear = g.stageClear.bind(g); g.stageClear = () => { if (!s.run) clear(); };
  const shop = g.openShop.bind(g); g.openShop = () => { if (s.run) { g.preShop = false; g.mode = 'fight'; } else shop(); };
  const chest = g.updateChestSpawns.bind(g); g.updateChestSpawns = dt => { if (!s.run) chest(dt); };
  const levels = g.openLevelUp.bind(g); g.openLevelUp = () => { if (!s.run) levels(); else for (const h of g.heroes) h.pendingLevels = h.chestsPending = 0; };
  const xp = g.gainXp.bind(g); g.gainXp = n => { if (!s.run) xp(n); };
  const ach = g.checkAchievements.bind(g); g.checkAchievements = () => { if (!s.run) ach(); };
  const collect = g.collect.bind(g);
  g.collect = (h, type, value) => {
    if (!s.run) return collect(h, type, value);
    if (type === PickupType.Gem) { s.run.gems++; g.vfx.sound('gem', h.player.x, h.player.z); }
    // Fixed kit: utility drops cannot add damage sources, healing, chests or upgrades.
  };
  const hurt = g.hurtHero.bind(g);
  g.hurtHero = (h, raw, x, z, src, cause) => { const hp = h.player.hp; hurt(h, raw, x, z, src, cause); if (s.run) s.run.damage += Math.max(0, hp - h.player.hp); };
  const damage = g.damage.bind(g);
  g.damage = (e, n, opts, by) => {
    const d = s.run?.def;
    if (d && (d.goal === 'environment' ? !ENV_SOURCES.includes(opts.source) : d.kit.length === 0)) return 0;
    return damage(e, n, opts, by);
  };
  const dash = g.perfectDash.bind(g);
  g.perfectDash = h => {
    const already = h.skill.dashPerfect;
    dash(h);
    if (!s.run || already || !h.skill.dashPerfect) return;
    for (const e of g.enemies.list) if (e.alive && e.def.id === 'charger' && (e.state === 'attack' || e.state === 'windup') && Math.hypot(e.x - h.player.x, e.z - h.player.z) < e.radius + 2.5) { s.run.dashes++; break; }
  };
  const bomb = g.tryBomb.bind(g); g.tryBomb = h => { if (!s.run) bomb(h); };
  const ult = g.tryUlt.bind(g); g.tryUlt = h => { if (!s.run) ult(h); };
  const rewind = g.requestRewind.bind(g); g.requestRewind = h => { if (!s.run) rewind(h); };
  const stand = g.lastStand.bind(g); g.lastStand = h => s.run ? false : stand(h);
  const pool = g.coopPoolSave.bind(g); g.coopPoolSave = h => s.run ? false : pool(h);
  const cash = g.gpCashIn.bind(g); g.gpCashIn = (h, k) => s.run ? '' : cash(h, k);
  const director = g.updateDirector2.bind(g); g.updateDirector2 = dt => { if (!s.run) director(dt); };
  const gameplay = g.updateGameplay.bind(g);
  g.updateGameplay = dt => {
    if (s.run) {
      const w = gpWorld(g); w.crateT = w.mechCd = 1e6; w.drops.length = 0; w.runTime = g.runTime; w.stage = g.stage;
    }
    gameplay(dt);
  };
  const requests = g.director.update.bind(g.director);
  g.director.update = (dt, count, countOf, rng) => s.run ? EMPTY_REQUESTS : requests(dt, count, countOf, rng);
  const sim = g.simulate.bind(g);
  g.simulate = (dt, control) => {
    if (!s.run) return sim(dt, control);
    if (s.run.result) return;
    preTrial(g, dt);
    sim(dt, control);
    tickTrial(g, dt);
  };
  const update = g.update.bind(g);
  g.update = dt => {
    const r = s.run;
    if (r && g.authority && !r.result && (g.mode === 'dead' || !living(g))) finishTrial(g, false);
    if (s.run?.result) { g.stepN++; g.screens.update(g.input, dt); g.input.endStep(); g.hostTick(false); return; }
    update(dt);
  };
}

function setupTrial(g: Game): void {
  const s = trialsState(g), r = s.run!, d = r.def;
  g.clearWorld(); g.runTime = 0; g.kills = g.combo = g.maxCombo = 0;
  g.mode = 'fight'; g.modeT = 0; g.gameOverShown = false; g.preShop = false; g.paused = false;
  g.level = d.hero === 'tinker' ? 12 : 1;
  for (const h of g.heroes) {
    h.loadoutPick = { primary: 'buster', secondary: 'charge', special: 'bomb' };
    h.startRun(); h.disposeWeapons();
    for (const id of d.kit) {
      const w = createWeapon(id, g.scene);
      if (w.build) { for (let n = 0; n < d.rank; n++) w.addRank(n % Math.max(1, w.def.tracks?.length ?? 1)); }
      else for (let n = 0; n < d.rank && !w.maxed; n++) w.levelUp();
      h.weapons.push(w);
    }
    h.revivesLeft = 0; h.loadoutDirty = true; h.recomputeStats(); h.player.reset(h.stats);
    const p = g.spawnSpot(h.index); h.player.teleport(p.x, p.z);
    if (d.mech) { startMech(g, h); h.play.mechT = d.seconds + 5; }
  }
  // Trials deliberately do not feed ordinary run/quest statistics or their leaderboards.
  meta2State(g).active = false;
  g.director.time = 0; g.director.hold = true; g.director.bossSpawned = false;
  g.bossField.miniStage = g.stage;
  g.toys.objective.state = 'done';
  g.runEvents.reset(); g.runEvents.suppressEvent();
  g.modes.rhythm = d.goal === 'beats'; g.modes.pacifist = false; g.modes.holster = false;
  g.chests.clear();
  const secret = secretsState(g); secret.arena = g.arena; secret.room = null; secret.pendingShadow = false;
  worldRun(g).planned = null;
  if (d.goal === 'stealth') startWorldEvent(g, 'stealth');
  if (d.goal === 'escort' || d.goal === 'zones') {
    if (!forceCoopObjective(g, d.goal)) { finishTrial(g, false); return; }
    const c = coopPlayState(g);
    if (c.lay) for (const h of g.heroes) h.player.teleport(c.lay.a.x + h.index * 2, c.lay.a.z + 2);
  }
  if (d.goal === 'puzzle' || d.goal === 'gems') {
    const n = d.goal === 'puzzle' ? 6 : 40;
    for (let i = 0; i < n; i++) {
      const angle = i * Math.PI * 2 / n, radius = d.goal === 'puzzle' ? 10 : 7 + i % 4 * 3;
      let point = { x: 0, z: 0 };
      for (let attempt = 0; attempt < 240; attempt++) {
        const a = angle + attempt * 0.1, rad = radius + Math.floor(attempt / 30) * 1.5;
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        if (g.walls.hitCircle(x, z, 1.6) || r.pads.some(p => Math.hypot(x - p.x, z - p.z) < (d.goal === 'puzzle' ? 3.5 : 0.8))) continue;
        point = { x, z }; break;
      }
      r.pads.push(point);
      if (d.goal === 'gems') g.pickups.spawn(PickupType.Gem, point.x, point.z, 1);
    }
  }
  if (d.bosses?.length) spawnTrialBoss(g);
  s.prepared = true;
  g.screens.show('none'); g.hud.setVisible(true);
  s.screen.updateHud(r);
  g.vfx.banner(t(`trials.${d.id}.name`), t('trials.limit', { n: d.seconds }), 1.8);
}
function spawnTrialBoss(g: Game): void {
  const r = trialsState(g).run!, d = r.def;
  const def = ENEMIES[d.bosses![r.bosses]];
  const pos = g.ringPoint(11, 14, def.radius + 0.5) ?? { x: 12, z: 0 };
  g.boss = g.enemies.spawn(def, pos.x, pos.z, g.spawnOpts({ hpMul: trialsTuning.bossHpMul, instant: true }));
  if (d.phase !== undefined) { g.boss.phase = d.phase; g.boss.hp = g.boss.maxHp * 0.6; }
  r.bossUid = g.boss.uid;
  g.director.bossSpawned = true;
  g.vfx.sound('wave', NaN, NaN);
}
function preTrial(g: Game, dt: number): void {
  const r = trialsState(g).run!, d = r.def;
  r.practice ||= cheats.god || saveLock.on;
  for (const h of g.heroes) {
    h.bombCharge = 0; h.skill.ult = 0;
    h.pendingLevels = h.chestsPending = 0;
    if (d.gravity && !h.player.dead) {
      const a = r.time * 0.45;
      h.player.shove(Math.cos(a), Math.sin(a), dt * 24);
    }
  }
  g.bossField.miniStage = g.stage;
  const w = worldRun(g); if (d.goal !== 'stealth') w.planned = null;
  if ((r.spawnT -= dt) <= 0 && d.foes.length) {
    r.spawnT = trialsTuning.spawnEvery;
    for (let i = 0; i < (d.mech ? 4 : 2) && g.enemies.activeCount < d.alive; i++) {
      const id = d.foes[Math.floor(r.time / 8 + i) % d.foes.length];
      g.spawnEnemy(ENEMIES[id]);
    }
  }
  if (d.goal === 'parry' && (r.volleyT -= dt) <= 0) {
    r.volleyT = trialsTuning.volleyEvery;
    for (const h of g.heroes) {
      const a = Math.floor(r.time / 8) * Math.PI / 2, dx = Math.cos(a), dz = Math.sin(a);
      g.bullets.spawn({ x: h.player.x + dx * 7, z: h.player.z + dz * 7, dirX: -dx, dirZ: -dz, speed: 6, life: 4, radius: 0.26, damage: 8, knockback: 1, team: Team.Enemy, color: '#ff3df0', width: 0.5, length: 0.5 });
    }
  }
  if ((d.goal === 'puzzle' || d.gravity) && (r.pulseT -= dt) <= 0) {
    r.pulseT = 1;
    if (d.goal === 'puzzle') for (let i = 0; i < r.pads.length; i++) {
      const p = r.pads[i]; g.vfx.ring(p.x, p.z, 1, 1.5, i === PUZZLE_ORDER[r.progress] ? '#a7f070' : '#73eff7', 1);
      g.vfx.num(p.x, 1.4, p.z, String(i + 1), 'score');
    }
    else { const p = g.hero.player; g.vfx.ring(p.x, p.z, 2, 8, '#73eff7', 1); }
  }
}
export function trialParryShot(g: Game): void { const r = states.get(g)?.run; if (r && !r.result) r.parries++; }
export function tickTrial(g: Game, dt: number): void {
  const s = states.get(g), r = s?.run;
  if (!r || r.result || !g.authority) return;
  r.time = Math.min(r.def.seconds, r.time + dt);
  const d = r.def;
  if (d.bosses && r.bossUid >= 0 && (!g.boss || !g.boss.active)) {
    r.bosses++; r.bossUid = -1; g.boss = null;
    if (d.goal === 'boss' && r.bosses < d.bosses.length) { g.bullets.clear(); spawnTrialBoss(g); }
  }
  switch (d.goal) {
    case 'survive': r.progress = r.time; break;
    case 'boss': r.progress = r.bosses; break;
    case 'parry': r.progress = r.parries; break;
    case 'dash': r.progress = r.dashes; break;
    case 'environment': r.progress = g.toys.envKills; break;
    case 'gems': r.progress = r.gems; break;
    case 'kills': r.progress = g.kills; break;
    case 'beats': r.progress = 0; for (const n of g.modes.onBeat) r.progress += n; break;
    case 'escort': case 'zones': r.progress = g.toys.objective.state === 'done' ? 1 : 0; break;
    case 'stealth': { const mask = worldEventOf(g)?.stealth?.got ?? 0; r.progress = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1); break; }
    case 'puzzle': {
      let touch = -1;
      for (let i = 0; i < r.pads.length; i++) if (Math.hypot(g.hero.player.x - r.pads[i].x, g.hero.player.z - r.pads[i].z) < 1.5) { touch = i; break; }
      if (touch >= 0 && touch !== r.puzzleTouch) {
        r.progress = touch === PUZZLE_ORDER[r.progress] ? r.progress + 1 : touch === PUZZLE_ORDER[0] ? 1 : 0;
        g.vfx.sound('menuSelect', NaN, NaN);
      }
      r.puzzleTouch = touch; break;
    }
  }
  const failed = !living(g) || (d.noHit && r.damage > 0) || ((d.goal === 'escort' || d.goal === 'zones') && g.toys.objective.state === 'failed') || trialPlayerCount(g) !== (d.players ?? 1);
  if (failed) finishTrial(g, false);
  else if (r.progress + 0.00001 >= d.target) finishTrial(g, true);
  else if (r.time >= d.seconds) finishTrial(g, false);
  if ((r.hudT -= dt) <= 0) { r.hudT = trialsTuning.hudEvery; s!.screen.updateHud(r); }
}
export function finishTrial(g: Game, success: boolean): void {
  const s = states.get(g), r = s?.run;
  if (!r || r.result || !g.authority) return;
  const result: TrialResult = { time: r.time, damage: r.damage, kills: g.kills, combo: g.maxCombo, progress: r.progress, success, medal: 0 };
  result.medal = medalFor(r.def, result); r.result = result;
  g.mode = 'dead'; g.modeT = 0; g.gameOverShown = true; g.paused = false;
  bankTrial(g); s!.screen.showResult(r);
  g.hostTick(false);
}
function bankTrial(g: Game): void {
  const s = trialsState(g), r = s.run!;
  if (r.paid || !r.result) return;
  r.paid = true;
  if (!r.practice && !saveLock.on) {
    r.xp = recordTrial(s.records, r.def, r.result);
    saveJson('trials.v1', s.records);
    save.profile.xp += r.xp;
    const golds = TRIALS.filter(d => s.records[d.id]?.medal === 3).length;
    for (const id of [r.result.medal ? 'trial_first' : '', golds >= 10 ? 'trial_gold10' : '']) {
      if (!id) continue; const a = grantAchievement(id); if (a) achievementToast(g, a);
    }
    checkMeta2Achievements(g); persist();
  }
  if (r.result.medal && g.authority) g.vfx.sound('achievement', NaN, NaN);
}
export function trialsNet(g: Game): Record<string, unknown> | null {
  const r = states.get(g)?.run;
  return r ? { id: r.def.id, serial: r.serial, time: Math.round(r.time * 10) / 10, progress: r.progress, damage: r.damage, result: r.result, practice: r.practice } : null;
}
/** Start packet sets the biome before clientStart builds the field. Snapshots also support joining mid-trial. */
export function acceptTrialStart(g: Game, raw: unknown): void {
  const s = states.get(g); if (!s) return;
  if (!raw || typeof raw !== 'object' || !TRIAL_BY_ID[String((raw as Record<string, unknown>).id)]) { clearTrial(g); return; }
  const n = raw as Record<string, unknown>, d = TRIAL_BY_ID[String(n.id)];
  if (!s.run) s.oldBiome = biomeForce.key;
  if (s.run?.serial !== n.serial) s.run = fresh(d, String(n.serial));
  biomeForce.key = d.biome;
  s.run!.practice = !!n.practice;
}
export function applyTrialsNet(g: Game, raw: unknown): void {
  const s = states.get(g); if (!s) return;
  if (!raw) { clearTrial(g); return; }
  acceptTrialStart(g, raw);
  const r = s.run; if (!r) return;
  const n = raw as Record<string, unknown>;
  r.time = Math.max(0, Math.min(r.def.seconds, Number(n.time) || 0)); r.progress = Math.max(0, Number(n.progress) || 0); r.damage = Math.max(0, Number(n.damage) || 0);
  meta2State(g).active = false;
  if (n.result && !r.result) { r.result = n.result as TrialResult; bankTrial(g); s.screen.showResult(r); }
  s.screen.updateHud(r);
}
export function trialsTest(g: Game, q: URLSearchParams): void {
  if (!q.has('trial') && !q.has('trialscreen')) return;
  const s = trialsState(g), id = q.get('trial') || 'buster';
  if (q.get('trialscreen') === 'select') { g.leaveToTitle(); s.screen.open(); return; }
  if (q.get('trialscreen') === 'intro') { g.leaveToTitle(); s.screen.intro(TRIAL_BY_ID[id] ?? TRIALS[0]); return; }
  if (!startTrial(g, id, true)) return;
  if (q.get('trialscreen') === 'result') {
    const r = s.run!; r.time = 90; r.progress = r.def.target; r.damage = 0;
    finishTrial(g, true);
  }
}
