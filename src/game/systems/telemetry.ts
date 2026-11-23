import { rememberShot, telemetryDeath } from '../damageLog';
import type { Enemy } from '../enemies';
import { Team } from '../bullets';
import type { Game } from '../game';
import { saveLock } from '../save';
import { settings } from '../settings';
import { ENEMIES } from '../../data/enemies';
import { getLanguage, t } from '../../i18n';
import { loadJson } from '../../core/storage';
import { consent, enqueue, flush, VERSION, type Run, type Outcome, type Stage } from '../../net/telemetryClient';
import { installConsent } from '../../ui/consent';
import { installReport, reportRendered } from '../../ui/report';
import { raidRuntime } from './raid';
import { challengeState } from './gauntlet';
import { isOverlord } from './versus';

const sourceIds = new Map(Object.values(ENEMIES).map(d => [d.name, d.id]));
for (const d of Object.values(ENEMIES)) {
  sourceIds.set(d.name + "'s shockwave", d.id + '_shockwave');
  sourceIds.set('Volatile ' + d.name, 'volatile_' + d.id);
}
for (const name of ['Crusher', 'Heat Wave', 'Lightning Storm', 'Kraken tentacle', 'The Colossus', 'Lava', 'Lava Bomb',
  'The Architect', 'Burning ground', "Glitch DJ's laser grid", "Boxer Jack's punch", 'Lightning', "The Titan's arm",
  "The Titan's eye beam", 'The ring of fire', 'Ground strike', 'Enemy fire', 'The ring', 'Thorns', 'Mirror plasma', 'Meteor', 'Cinder Receipt', 'Meteor Garden', 'The Void', 'The Chasm', 'Explosive deaths', 'The Overlord']) {
  sourceIds.set(name, name.toLowerCase().replace(/[^a-z]+/g, '_'));
}
const seconds = (v: number) => Math.round(v * 10) / 10;
const id = (s: string) => /^[a-z0-9_|:-]{1,64}$/i.test(s) ? s : 'custom';
const finishes = new WeakMap<Game, (outcome: Outcome) => void>();
export function finishTelemetry(g: Game, outcome: Outcome): void { finishes.get(g)?.(outcome); }

export function installTelemetry(g: Game, root: HTMLElement): void {
  let r: Run | null = null;
  let stage: Stage | undefined;
  let stageStart = 0;
  let frameCount = 0, totalMs = 0, lastFrame = 0;
  let lastOffers: typeof g.hero.offers | undefined;
  const fights = new Map<number, { id: string; at: number; stage: number }>();
  let shotUids: Uint32Array | undefined;
  let shooters: string[] = [];
  const clock = performance.now.bind(performance);
  document.addEventListener('visibilitychange', () => { lastFrame = 0; });
  const playback = !!loadJson('replay.watch', null);
  const snapshot = () => {
    if (!stage) return;
    stage.ranks['director:power'] = [Math.round(100 * g.director.adaptive.power.score)];
    stage.level = g.level; stage.seconds = seconds(Math.max(0, g.runTime - stageStart));
    for (const w of g.hero.weapons) stage.ranks[id(w.def.id)] = w.build ? [...w.build.ranks, w.build.evo, w.build.od] : [w.level];
    const sp = g.hero.specialBuild;
    stage.ranks[id(g.hero.special.id)] = sp ? [...sp.ranks, sp.evo, sp.od] : [g.hero.special.level];
  };
  const enterStage = () => {
    if (!r) return;
    stageStart = g.runTime;
    stage = { stage: g.stage, seconds: 0, level: g.level, ranks: {}, damage: {} };
    r.stages.push(stage);
  };
  const bossStart = (e: Enemy) => {
    if (r && (e.def.boss || e.def.miniboss) && !e.def.id.startsWith('hydra_')) {
      fights.set(e.uid, { id: id(e.def.id), at: g.runTime, stage: g.stage });
    }
  };
  const bossEnd = (uid: number, result: 'kill' | 'death' | 'quit') => {
    const fight = fights.get(uid);
    if (r && fight) r.bosses.push([fight.stage, fight.id, result, seconds(Math.max(0, g.runTime - fight.at))]);
    fights.delete(uid);
  };
  const closeFights = (result: 'kill' | 'death' | 'quit') => {
    for (const uid of fights.keys()) bossEnd(uid, result);
  };
  const finish = (outcome: Outcome) => {
    if (!r) return;
    if (consent() !== 'yes' || g.role === 'client' || g.pvp?.net === 'client' || g.race?.net === 'client' || saveLock.on || g.onboarding.training) { r = null; return; }
    snapshot();
    // These modes set their match state after startRun and bypass the normal banking screen.
    if (g.versus) {
      r.mode = 'versus';
      if (g.versus.winner) {
        const won = g.versus.winner === (isOverlord(g) ? 'overlord' : 'heroes');
        outcome = won ? 'victory' : r.fatal ? 'death' : 'defeat';
      }
    }
    if (g.race) {
      r.mode = 'race';
      const row = g.race.rows[g.race.you];
      if (row?.s === 'done') outcome = 'victory';
      else if (row?.s === 'ko') outcome = 'death';
      else if (g.race.phase === 'over' && row?.s !== 'left') outcome = 'defeat';
    }
    if (g.runMode === 'raid') {
      const raid = raidRuntime(g).state;
      if (raid) {
        if (raid.phase === 'lost') outcome = 'death';
        r.bosses.push([g.stage, 'hydra', raid.phase === 'won' ? 'kill' : outcome === 'death' ? 'death' : 'quit', seconds(raid.time)]);
      }
    }
    closeFights(outcome === 'victory' ? 'kill' : outcome === 'death' ? 'death' : 'quit');
    r.clears = g.victories; r.stage = g.stage; r.loop = Math.ceil(g.stage / 4); r.seconds = seconds(g.runTime); r.outcome = outcome;
    r.mods = g.hero.synergy.slots.map(s => [id(s.def.id), s.level]);
    r.relics = g.hero.relics.map(id); r.team = Math.max(r.team, g.heroes.length);
    if (r.team > 1 && r.party === 'solo') r.party = 'coop';
    const endTime = outcome === 'death' && r.fatal && r.hits.length ? r.hits[r.hits.length - 1][0] : r.seconds;
    r.hits = r.hits.filter(hit => hit[0] >= endTime - 10 && hit[0] <= endTime);
    if (outcome !== 'death') r.fatal = null;
    else if (g.hero.player.dead) Object.assign(r, telemetryDeath(g.hero));
    r.avgMs = frameCount ? seconds(totalMs / frameCount) : 0;
    r.worstMs = seconds(r.worstMs);
    const complete = r; r = null; stage = undefined;
    enqueue(complete);
  };
  const discard = () => {
    r = null; stage = undefined; lastOffers = undefined; fights.clear();
    shotUids = undefined; shooters = [];
  };
  finishes.set(g, finish);
  const leave = g.leaveToTitle.bind(g);
  g.leaveToTitle = () => { if (r && g.race) finish('quit'); leave(); };
  const duelOver = g.pvpOver.bind(g);
  g.pvpOver = (winner, team) => {
    if (r && g.pvp) {
      const won = team === undefined || team === -2 ? winner === g.hero.name : team === g.pvp.teams[g.local];
      finish(!winner ? 'draw' : won ? 'victory' : r.fatal ? 'death' : 'defeat');
    }
    duelOver(winner, team);
  };
  installReport(g, root);
  installConsent(g, root, discard);
  if (!playback) { void flush(); window.addEventListener('online', () => void flush()); }
  window.addEventListener('storage', e => { if (!e.key || e.key === 'infinishoot.playtest.v1.choice') { if (consent() !== 'yes') discard(); } });

  const start = g.startRun.bind(g);
  g.startRun = fixed => {
    finish('quit');
    start(fixed);
    if (consent() !== 'yes' || saveLock.on || playback || g.role === 'client' || g.pvp?.net === 'client' || !globalThis.crypto?.randomUUID) return;
    const h = g.hero;
    r = {
      version: VERSION, id: crypto.randomUUID(), day: new Date().toISOString().slice(0, 10),
      mode: g.pvp ? 'pvp' : g.versus ? 'versus' : g.runMode, difficulty: g.difficulty.id, ascension: challengeState(g).ascension,
      heat: g.meta.points, hero: id(h.heroDef.id), loadout: [h.weapons[0]?.def.id ?? h.loadoutPick.primary, h.weapons[1]?.def.id ?? h.loadoutPick.secondary, h.special.id].map(id),
      party: g.squadRun ? 'squad' : g.coop || g.role === 'host' ? 'coop' : 'solo', team: g.heroes.length,
      stage: 1, loop: 1, clears: 0, seconds: 0, outcome: 'quit', stages: [], offers: [], purchases: [], mods: [], relics: [],
      bosses: [], hits: [], fatal: null, rewinds: 0, stands: 0, revives: 0, avgMs: 0, worstMs: 0,
      quality: settings.graphics, platform: window.desktop ? (/mac/i.test(navigator.userAgent) ? 'electron-mac' : 'electron-win') : 'web',
      mobile: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent), language: getLanguage(), omitted: 0,
    };
    lastOffers = undefined; fights.clear();
    for (const e of g.enemies.list) if (e.active) bossStart(e);
    shotUids ??= new Uint32Array(8192); shotUids.fill(0); shooters = [];
    totalMs = frameCount = lastFrame = 0;
    enterStage();
  };
  const loadStage = g.loadStage.bind(g);
  g.loadStage = n => { if (r) { snapshot(); closeFights('quit'); } loadStage(n); enterStage(); };
  const render = g.render.bind(g);
  g.render = (alpha, dt) => {
    if (r && (g.versus?.winner || g.race?.phase === 'over')) finish('quit');
    if (r && !g.paused && g.isCombatMode && !document.hidden) {
      r.team = Math.max(r.team, g.heroes.length);
      const now = clock();
      if (lastFrame) { const ms = now - lastFrame; totalMs += ms; frameCount++; r.worstMs = Math.max(ms, r.worstMs); }
      lastFrame = now;
    } else lastFrame = 0;
    render(alpha, dt);
    reportRendered(g);
  };
  const spawn = g.enemies.spawn.bind(g.enemies);
  g.enemies.spawn = (def, x, z, opts) => {
    const e = spawn(def, x, z, opts);
    if (r && (def.boss || def.miniboss)) bossStart(e);
    return e;
  };
  const kill = g.mvpKill.bind(g);
  g.mvpKill = (e, by) => { if (r && fights.has(e.uid)) bossEnd(e.uid, 'kill'); kill(e, by); };
  const present = g.presentLevelUp.bind(g);
  g.presentLevelUp = h => {
    if (r && h === g.hero && h.offers !== lastOffers) {
      lastOffers = h.offers;
      r.offers.push([g.stage, h.offers.map(o => id(o.pick || o.id)), -1]);
    }
    present(h);
  };
  const action = g.heroAction.bind(g);
  g.heroAction = (h, a, i, d) => {
    if (!r || h !== g.hero) return action(h, a, i, d);
    if (g.mode === 'levelup' && h.needsPick && a === 'pick' && h.offers[i]) {
      const offer = r.offers.at(-1);
      if (offer && lastOffers === h.offers) offer[2] = i;
    }
    const shop = g.mode === 'shop' && !h.shopDone;
    const item = shop && (a === 'buy' ? h.shopOffers[i]?.id : a === 'mup' ? 'upgrade:' + h.synergy.slots[i]?.def.id
      : a === 'relic' ? h.relicOffers[i] : a);
    const gold = h.gold, rerolls = h.shopRerolls, relicCount = h.relics.length;
    action(h, a, i, d);
    if (r && item && (h.gold < gold || (a === 'sreroll' && rerolls < h.shopRerolls) || (a === 'relic' && h.relics.length > relicCount))) {
      r.purchases.push([g.stage, id(item), gold - h.gold]);
    }
  };
  // Projectile slots move during swap-removal. Key provenance by the bullet's monotonic UID.
  // Only accepted local hits look up a slot. Shooting and movement allocate nothing per frame.
  const markShot = (e: Enemy, slot: number) => {
    rememberShot(g, slot, e);
    if (!r || !shotUids || slot === g.bullets.count) return;
    const uid = g.bullets.uid[slot], i = uid % shotUids.length;
    shotUids[i] = uid; shooters[i] = e.def.id;
  };
  const fire = g.enemyCtx.fireBullet;
  g.enemyCtx.fireBullet = (e, dx, dz, speed, dmg) => {
    const slot = g.bullets.count; fire(e, dx, dz, speed, dmg); markShot(e, slot);
  };
  const shot = g.bossApi.shot;
  g.bossApi.shot = (e, dx, dz, speed, dmg, color, life, radius) => {
    const slot = g.bullets.count; shot(e, dx, dz, speed, dmg, color, life, radius); markShot(e, slot);
  };
  let fromX = 0, fromZ = 0, enemyId = '';
  const hit = g.hurtHero.bind(g);
  g.hurtHero = (h, raw, x, z, src, cause) => {
    if (r && h === g.hero) { fromX = x; fromZ = z; enemyId = src?.def.id ?? ''; }
    hit(h, raw, x, z, src, cause);
  };
  const bulletSource = () => {
    const b = g.bullets;
    for (let i = 0; shotUids && i < b.count; i++) {
      if (b.team[i] !== Team.Enemy || b.px[i] !== fromX || b.pz[i] !== fromZ) continue;
      const uid = b.uid[i], slot = uid % shotUids.length;
      if (shotUids[slot] === uid && shooters[slot]) return id(shooters[slot]);
    }
    return 'enemy_fire';
  };
  // The post-mitigation callback fires only for an accepted hit, before a rescue can restore life.
  let landed = 0;
  const adjusted = g.director2Hurt.bind(g);
  g.director2Hurt = (h, damage) => { if (r && h === g.hero) landed = damage; adjusted(h, damage); };
  const hurt = g.mvpHurt.bind(g);
  g.mvpHurt = (h, amount) => {
    if (r && stage && h === g.hero) {
      const source = enemyId ? id(enemyId) : h.lastHitBy === 'Enemy fire' ? bulletSource() : sourceIds.get(h.lastHitBy) ?? (g.runMode === 'raid' && h.lastHitBy === t('raid.title') ? 'hydra' : 'unknown');
      const after = seconds(h.player.hp), n = seconds(amount), at = seconds(g.runTime);
      stage.damage[source] = seconds((stage.damage[source] ?? 0) + n);
      while (r.hits.length && (r.hits[0][0] < at - 10 || r.hits[0][0] > at)) r.hits.shift();
      r.hits.push([at, source, seconds(landed), after]);
      if (after === 0) r.fatal = [source, seconds(landed), seconds(amount + h.player.hp)];
    }
    hurt(h, amount);
  };
  const revive = g.reviveHero.bind(g);
  g.reviveHero = (h, fraction, fx) => { if (r && h === g.hero && h.player.dead) { r.revives++; r.fatal = null; } revive(h, fraction, fx); };
  const stand = g.lastStand.bind(g);
  g.lastStand = h => { const ok = stand(h); if (ok && r && h === g.hero) { r.stands++; } return ok; };
  const modEvent = g.mods2Event.bind(g);
  g.mods2Event = (h, kind) => { if (r && kind === 'rewind' && h === g.hero) { r.rewinds++; r.fatal = null; } modEvent(h, kind); };
}
