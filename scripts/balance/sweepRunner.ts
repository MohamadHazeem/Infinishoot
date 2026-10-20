/**
 * Balance sweep runner: one headless run of the real game (jsdom, like
 * tests/smoke.test.ts) driven by the dev autoplay bot, with balance tracking.
 * Bundled and spawned by scripts/balance-sweep.mjs (`npm run sweep`); not a
 * test. Reads one config as JSON from the SWEEP_CFG env var and prints one
 * JSON line prefixed with `@@SWEEP ` on stdout.
 *
 * Config: { id, kit: [left, right, special], hero, diff, god, seed, secs, stages }
 * The run stops at death, after `stages` stage clears (4 = one loop, ending
 * with Omega), or after `secs` simulated seconds.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
// balance2: pin the season (the Halloween calendar would otherwise turn stage 2 into the Haunted stage with Pumpking
// whenever the sweep runs between Oct 15 and Nov 7). `season: 'halloween'` measures Pumpking on purpose.
const cfg0 = JSON.parse(process.env.SWEEP_CFG ?? '{}') as { season?: string };
const dom = new JSDOM(html, { url: `http://localhost/?season=${cfg0.season ?? 'off'}`, pretendToBeVisual: true });
const noop: any = new Proxy(function () {}, {
  get: (_t, k) => (k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : noop),
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, { get: (_t, k) => (k === 'createImageData' || k === 'getImageData' ? (w2: number, h2: number) => ({ data: new Uint8ClampedArray(4 * (w2 || 64) * (h2 || 64)) }) : k === 'canvas' ? this : noop[k as never]) });
};
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
for (const k of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'HTMLCanvasElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerWidth', 'innerHeight', 'addEventListener', 'dispatchEvent', 'Node', 'MouseEvent', 'PointerEvent']) {
  try { (globalThis as any)[k] = (dom.window as any)[k]; } catch { Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true }); }
}
(globalThis as any).Path2D = (dom.window as any).Path2D = class { constructor(_d?: string) {} };
(globalThis as any).__APP_VERSION__ = 'sweep';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
// Keep the run's console noise out of the result stream.
const out = console.log.bind(console);
console.log = console.info = console.warn = console.debug = () => {};

interface Cfg {
  id: string;
  kit: [string, string, string];
  hero: string;
  diff: string;
  god: boolean;
  seed: number;
  secs: number;
  stages: number;
  /** Boss bench: jump to this stage's boss with the loadout at fixed ranks (no auto weapons, Mods, ultimate,
   * mech, crates or cash-ins), so only the kit kills the boss. */
  bench?: { stage: number; ranks: number; evo?: number; ult?: boolean };
  /** balance2: heroes in the run (1 = solo; 2-4 via the AI squad, 5-8 add more squad bots), all on the dev/squad brains. */
  team?: number;
  /** Squad bots' heroes (comma list, default all Rookies). */
  mates?: string;
  /** Ascension level (solo Standard; forces Hard). */
  asc?: number;
  /** 'off' (default) or 'halloween'. */
  season?: string;
  /** A Trial id: play that trial (practice) instead of a run. */
  trial?: string;
  noRoute?: boolean;
}
const cfg = JSON.parse(process.env.SWEEP_CFG ?? '{}') as Cfg;
cfg.kit ??= ['buster', 'charge', 'bomb'];
cfg.hero ??= 'rookie';
cfg.diff ??= 'normal';
cfg.seed ??= 1;
cfg.secs ??= 1500;
cfg.stages ??= 4;

// Deterministic Math.random (the run seed comes from it, and the bot and some spawns use it).
let s = cfg.seed * 2654435761;
Math.random = () => {
  s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) | 0;
  return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
};

// A simulated clock: a few systems (music-beat timing, rewind, voice gates) read performance.now(), which
// would make runs depend on how fast the machine is. 1/60 s per simulation step instead.
let clockMs = 1000;
Object.defineProperty(performance, 'now', { value: () => clockMs, configurable: true });

const { Input } = await import('../../src/core/input');
const { Game, cheats } = await import('../../src/game/game');
const { installBot } = await import('../../src/dev/bot');
const { Autopilot } = await import('../../src/game/autopilot');
// Melee right clicks: the bot circles bosses 8 m out, where the Aegis Shield (a contact weapon) never
// touches them. While the shield is up (or ready), close in to ~2.5 m like a shield player would.
const decide0 = Autopilot.prototype.decide;
Autopilot.prototype.decide = function (g) {
  const o = decide0.call(this, g);
  const hh = g.hero;
  const sh = hh.weapons.find((w) => w.def.id === 'shield') as any;
  const boss = sh && g.mode === 'fight' ? g.enemies.list.find((e) => e.alive && e.def.boss) : null;
  if (boss && (sh.up || sh.ready >= 1)) {
    const p = hh.player;
    const dx = p.x - boss.x;
    const dz = p.z - boss.z;
    const d = Math.hypot(dx, dz) || 1;
    const want = (2.5 + boss.radius - d) * 0.6;
    o.mx = -dz / d * 0.6 + (dx / d) * want;
    o.mz = dx / d * 0.6 + (dz / d) * want;
  }
  // balance2: the Beam Whip reaches 4.8-6.7 m, so at the bot's 8 m boss orbit it never touched a boss. Close in
  // to ~75% of its reach like a whip player would (same idea as the shield above).
  const wh = hh.weapons.find((w) => w.def.id === 'whip') as any;
  const wb = wh && g.mode === 'fight' ? g.enemies.list.find((e) => e.alive && e.def.boss) : null;
  if (wb && !(sh && boss && (sh.up || sh.ready >= 1))) {
    const p = hh.player;
    const dx = p.x - wb.x;
    const dz = p.z - wb.z;
    const d = Math.hypot(dx, dz) || 1;
    const want = ((wh.p?.range ?? 4.8) * 0.75 + wb.radius - d) * 0.6;
    o.mx = -dz / d * 0.6 + (dx / d) * want;
    o.mz = dx / d * 0.6 + (dz / d) * want;
  }
  // Mortal runs: step out of telegraphed ground-strike zones (boss strikes, Mortar Toads, meteors) like a player
  // reading the red circles; the bot alone walked through them and they were the top killer at stages 3-4.
  if (!cheats.god) {
    let ex = 0;
    let ez = 0;
    for (const st of g.strikes) {
      if (st.t <= 0) continue;
      const dx = hh.player.x - st.x;
      const dz = hh.player.z - st.z;
      const d = Math.hypot(dx, dz);
      if (d < st.r + 0.8) {
        ex += (dx / (d || 1)) * 2;
        ez += (dz / (d || 1)) * 2;
      }
    }
    if (ex || ez) {
      o.mx = ex;
      o.mz = ez;
    }
  }
  // Charge Shot: let go once the charge is full (the bot holds right click 1.4 s on a fixed beat, so faster
  // charging did nothing for it, and holding a full charge only blocks the left click).
  const ch = hh.weapons.find((w) => w.def.id === 'charge') as any;
  if (ch && o.charge && ch.charge >= (hh.synergy.flags.overcharge ? 2 : 1)) o.charge = false;
  return o;
};
const { settings } = await import('../../src/game/settings');
const { save } = await import('../../src/game/save');
const { ACHIEVEMENTS } = await import('../../src/data/meta');

for (const a of ACHIEVEMENTS) if (!save.achievements.includes(a.id)) save.achievements.push(a.id);
cheats.unlockAll = true;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new Input(canvas);
const game = new Game(input, 16 / 9, document.getElementById('hud')!, document.getElementById('reticle')!);
installBot(game, input);
const botStep = (globalThis as any).window.botStep as () => void;
settings.mode = 'standard';
settings.difficulty = cfg.diff;
settings.hero = cfg.hero;
settings.pet = 'none';
settings.loadout = { primary: cfg.kit[0], secondary: cfg.kit[1], special: cfg.kit[2] };
// balance2: team runs (AI squad: real heroes on the squad brain, normal co-op scaling) and Ascension.
const team = Math.max(1, Math.min(8, cfg.team ?? 1));
(settings as any).squadBots = Math.min(3, team - 1);
(settings as any).squadHeroes = cfg.mates ?? 'rookie,rookie,rookie,rookie,rookie,rookie,rookie';
(settings as any).cinematics = 'off';
if (cfg.asc) {
  const { gauntletProfile } = await import('../../src/data/ascension');
  gauntletProfile.unlocked = gauntletProfile.selected = cfg.asc;
}
if (team > 4) {
  const SQ = await import('../../src/game/systems/aisquad');
  const { SquadBrain } = await import('../../src/game/aisquadBrain');
  const { DEFAULT_LOADOUT } = await import('../../src/data/loadout');
  const { unlockedWeapons } = await import('../../src/game/save');
  const start0 = game.startSquad;
  game.startSquad = function () {
    start0.call(this);
    const st = SQ.squadDebug(this);
    if (!this.squadRun) return;
    const ids = (cfg.mates ?? '').split(',');
    const list = [...this.heroes];
    for (let i = list.length; i < team; i++) {
      const mh = this.makeHero(i, `Bot ${i}`, unlockedWeapons(), '', undefined, 'none', ids[i - 1] || 'rookie');
      mh.loadoutPick = { ...DEFAULT_LOADOUT };
      st.brains.set(mh, new SquadBrain());
      st.bots.push(mh);
      list.push(mh);
    }
    this.setHeroes(list);
  };
}
(settings as any).bossIntros = true;
game.applyLocalSkin();
const GP = await import('../../src/game/gameplay');
if (cfg.bench) {
  GP.mechTuning.dropChance = GP.mechTuning.eliteChance = 0;
  GP.crateTuning.first = GP.crateTuning.every[0] = GP.crateTuning.every[1] = 1e9;
  for (const t of GP.cashTuning.tiers) t.cost = 1e9;
}
// balance2: `trial` plays one Trial (src/data/trials.ts) as practice; `noRoute` turns the route map off (every
// stage a plain stage with its boss, no pacifist/stealth/mini-game nodes) for the boss-focused sets.
const TR = await import('../../src/game/systems/trials');
const AR = await import('../../src/game/systems/architect');
if (cfg.trial) TR.startTrial(game, cfg.trial, true);
else game.startSolo();
if (cfg.noRoute) game.route.on = false;
const h = game.hero;
if (cfg.bench) {
  const b = cfg.bench;
  if (game.mode === 'shop') game.closeShop();
  if (b.stage > 1) game.loadStage(b.stage);
  game.update(1 / 60);
  game.xpNext = 1e12; // no level-ups
  // balance2: the hero bench runs at the team level a full run has at that boss (median level at stage end in the
  // full god runs: 18 / 25 / 34 / 44): the Tinker's bot cap and zap damage grow with it; nothing else in a bench
  // fight reads the level.
  if (b.ult) game.level = ({ 1: 18, 2: 25, 3: 34, 4: 44 } as Record<number, number>)[b.stage] ?? 1;
  game.collect = ((c) => (hero: any, type: any, value: any) => { if (type !== 4 && type !== 6) c.call(game, hero, type, value); })(game.collect);
  // Ranks round-robin over the tracks (Heavy, Rapid, Multi, Heavy, ...), then the evolution.
  for (const w of h.weapons) {
    if (!w.build) continue;
    for (let r = 0; r < b.ranks; r++) w.addRank(r % w.build.ranks.length);
    if (b.evo !== undefined && b.ranks >= 8) w.evolve(b.evo);
  }
  const sb = h.specialBuild;
  if (sb) {
    for (let r = 0; r < b.ranks; r++) sb.ranks[r % sb.ranks.length] = Math.min(h.specialDef.tracks![r % sb.ranks.length].ranks.length, sb.ranks[r % sb.ranks.length] + 1);
    if (b.evo !== undefined && b.ranks >= 8) sb.evo = b.evo;
    (h as any).spParams = null;
  }
  h.loadoutDirty = true;
  game.debugBoss({ now: true });
}

// ---------------------------------------------------------------- tracking
type Num = Record<string, number>;
const add = (o: Num, k: string, v: number) => (o[k] = (o[k] ?? 0) + v);
const bossDmg: Num = {};
let bossDmgCur: Num = {};
const dmg0 = game.damage;
game.damage = function (e, base, o, by) {
  const n = dmg0.call(this, e, base, o, by);
  if (by === h && e.def.boss && n > 0) {
    add(bossDmg, o.source, n);
    add(bossDmgCur, o.source, n);
  }
  return n;
};
let cashIns = 0;
const cash0 = game.gpCashIn;
game.gpCashIn = function (hh, k) {
  const r = cash0.call(this, hh, k);
  if (r === '' && hh === h) cashIns++;
  return r;
};
let mutantKills = 0;
const kill0 = game.gpOnKill;
game.gpOnKill = function (e, src, by) {
  if (e.mutated && by === h) mutantKills++;
  return kill0.call(this, e, src, by);
};

const ranksOf = () => {
  let n = 0;
  let evos = 0;
  for (const b of [...h.weapons.map((w) => w.build), h.specialBuild]) {
    if (!b) continue;
    n += b.ranks.reduce((a: number, r: number) => a + r, 0);
    if (b.evo >= 0) evos++;
  }
  return { n, evos };
};
const loadoutRanks = () => {
  const o: Num = {};
  for (const w of h.weapons) if (w.build) o[w.def.id] = w.build.ranks.reduce((a: number, r: number) => a + r, 0) + (w.build.evo >= 0 ? 100 : 0);
  if (h.specialBuild) o[h.special.id] = h.specialBuild.ranks.reduce((a: number, r: number) => a + r, 0) + (h.specialBuild.evo >= 0 ? 100 : 0);
  return o;
};

interface BossRec { stage: number; name: string; t: number; vuln: number; hp: number; dps: number; dmg: Num; killed: boolean }
interface StageRec { stage: number; time: number; level: number; ranks: number; evos: number; loadout: Num; autos: string; kills: number; gold: number; dmg: Num; hp: number }
const bosses: BossRec[] = [];
const stages: StageRec[] = [];
let boss: BossRec | null = null;
let archRec: BossRec | null = null;
let bossRef: any = null;
let stage = 1;
let stageT0 = 0;
let killsAt = 0;
let goldEarned = 0;
let goldAtStage = 0;
let dmgAtStage: Num = {};
let firstEvo = '';
let fightTime = 0;
const lane = { mechs: 0, mechT: 0, supers: 0, overloads: 0, comebackT: 0 };
let fixedT = 0;
let portalT = 0;
let unstuck = 0;

const diffDmg = (a: Num, b: Num) => {
  const o: Num = {};
  for (const k of Object.keys(a)) if (a[k] - (b[k] ?? 0) > 0) o[k] = Math.round(a[k] - (b[k] ?? 0));
  return o;
};
const closeStage = () => {
  const r = ranksOf();
  stages.push({
    stage,
    time: Math.round(game.runTime - stageT0),
    level: game.level,
    ranks: r.n,
    evos: r.evos,
    loadout: loadoutRanks(),
    autos: h.weapons.filter((w) => !w.def.slot).map((w) => w.def.id + w.level).join(' '),
    kills: game.kills - killsAt,
    gold: goldEarned - goldAtStage,
    dmg: diffDmg(h.damageBy, dmgAtStage),
    hp: Math.round(h.player.hp),
  });
  stageT0 = game.runTime;
  killsAt = game.kills;
  goldAtStage = goldEarned;
  dmgAtStage = { ...h.damageBy };
};

const upd0 = game.update.bind(game);
game.update = (dt: number) => {
  const g0 = h.gold;
  const wasMech = h.play.mechT > 0;
  const wasSuper = !!h.play.superId;
  const wasOver = h.play.overloadT > 0;
  upd0(dt);
  if (h.gold > g0) goldEarned += h.gold - g0;
  if (!wasMech && h.play.mechT > 0) lane.mechs++;
  if (h.play.mechT > 0) lane.mechT += dt;
  if (!wasSuper && h.play.superId) lane.supers++;
  if (!wasOver && h.play.overloadT > 0) lane.overloads++;
  if (h.comeback) lane.comebackT += dt;
};

cheats.god = !!cfg.god;
const t0 = Date.now();
const n = Math.round(cfg.secs * 60);
let deathCause = '';
let deathStage = 0;
let i = 0;
for (; i < n; i++) {
  if (game.mode === 'dead' || game.mode === 'title') break;
  if (game.paused) game.resume();
  if (cfg.bench && !cfg.bench.ult) h.skill.ult = 0;
  // The bot walks straight at the portal and can hang on a wall in front of it (about 1 run in 50 sat there for
  // the rest of its time budget): after 15 s, step onto the portal.
  portalT = game.mode === 'portal' ? portalT + 1 / 60 : 0;
  if (portalT > 15) {
    h.player.teleport(game.portal.x, game.portal.z);
    portalT = 0;
    unstuck++;
  }
  // The bot only fires its special into crowds; a player also fires it at the boss.
  const bz = game.mode === 'fight' && h.bombCharge >= 1 ? game.enemies.list.find((e) => e.alive && e.def.boss && Math.hypot(e.x - h.player.x, e.z - h.player.z) < 12) : null;
  if (bz) (input as any).pressed.add('KeyQ');
  // Mortal runs: dash through boss shockwave rings like a player would (the bot's own dash only reacts to
  // enemies within 1.3 m, so it ate every ring and they were the top killer).
  if (!cfg.god && game.mode === 'fight' && h.player.dashReady01 >= 1 && !h.player.dashing) {
    for (const w of game.bossField.waves) {
      const gap = Math.hypot(h.player.x - w.x, h.player.z - w.z) - w.r;
      if (w.delay <= 0 && !(w.hit & 1) && gap > 0.1 && gap < 0.9) {
        (input as any).pressed.add('Space');
        break;
      }
    }
  }
  const modeWas = game.mode;
  botStep();
  if (process.env.SWEEP_DEBUG && game.mode !== modeWas) process.stderr.write(`[t${Math.round(game.runTime)} st${game.stage}] ${modeWas} -> ${game.mode} screen ${(game.screens as any).current} dead ${h.player.dead} hp ${Math.round(h.player.hp)} arch ${JSON.stringify((() => { const a = AR.architectState(game); return { a: a.active, d: a.done, t: Math.round(a.time), hp: a.hp, ph: a.phase }; })())} bosses ${game.enemies.list.filter((e) => e.active && e.def.boss).map((e) => e.def.name)}\n`);
  clockMs += 1000 / 60;
  fixedT += 1 / 60;
  if (game.mode === 'fight') fightTime += 1 / 60;
  if (i % 10 === 0) game.render(1, 1 / 6);
  // Bosses (not mini-bosses): time from entrance to death, and the time it could be hurt.
  const b = game.enemies.list.find((e) => e.active && e.def.boss && e.def.id !== 'architect');
  // balance2: the Architect (stage-12 finale) is its own record: encounter seconds until it's done.
  const arch = AR.architectState(game);
  if (arch.active && !archRec) {
    archRec = { stage: game.stage, name: 'The Architect', t: 0, vuln: 0, hp: 0, dps: 0, dmg: {}, killed: false };
    bosses.push(archRec);
  }
  if (archRec && !archRec.killed) {
    archRec.t = archRec.vuln = +arch.time.toFixed(1);
    if (arch.done) archRec.killed = true;
  }
  if (b && !boss) {
    bossRef = b;
    bossDmgCur = {};
    boss = { stage: game.stage, name: b.def.name, t: 0, vuln: 0, hp: Math.round(b.maxHp), dps: 0, dmg: {}, killed: false };
  }
  if (boss) {
    if (b === bossRef && b) {
      boss.t += 1 / 60;
      if (!(b.roarT > 0) && game.mode === 'fight') boss.vuln += 1 / 60;
    } else {
      boss.killed = game.mode !== 'dead' && !h.player.dead;
      boss.t = +boss.t.toFixed(1);
      boss.vuln = +boss.vuln.toFixed(1);
      boss.dps = Math.round(boss.hp / Math.max(0.1, boss.vuln));
      boss.dmg = Object.fromEntries(Object.entries(bossDmgCur).map(([k, v]) => [k, Math.round(v)]));
      bosses.push(boss);
      boss = null;
      bossRef = null;
      if (cfg.bench) break;
    }
  }
  const r = ranksOf();
  if (r.evos && !firstEvo) firstEvo = `st${game.stage} lv${game.level} ${Math.round(game.runTime)}s`;
  if (game.stage !== stage) {
    closeStage();
    stage = game.stage;
    if (stage > cfg.stages) break;
  }
  if (h.player.dead && !deathCause) {
    deathCause = h.lastHitBy || 'Unknown';
    deathStage = game.stage;
  }
}
const died = game.mode === 'dead';
if (stage <= cfg.stages) closeStage();
if (boss) {
  boss.t = +boss.t.toFixed(1);
  boss.vuln = +boss.vuln.toFixed(1);
  boss.dmg = Object.fromEntries(Object.entries(bossDmgCur).map(([k, v]) => [k, Math.round(v)]));
  bosses.push(boss);
}
const ft = Math.max(1, fightTime);
const dps: Num = {};
for (const [k, v] of Object.entries(h.damageBy)) if (v > 0) dps[k] = Math.round(v / ft);
out(
  '@@SWEEP ' +
    JSON.stringify({
      ...cfg,
      died,
      teamN: game.heroes.length,
      diffId: game.difficulty.id,
      diffHp: game.difficulty.enemyHp,
      bossPlayers: game.director.players,
      trialResult: cfg.trial ? TR.trialsState(game).run?.result ?? null : undefined,
      trialMetric: cfg.trial ? TR.trialsState(game).run?.def.metric : undefined,
      trialMedals: cfg.trial ? TR.trialsState(game).run?.def.medals : undefined,
      ascApplied: (await import('../../src/game/systems/gauntlet')).challengeState(game).ascension,
      endMode: game.mode,
      unstuck,
      endScreen: (game.screens as any).current,
      endPos: [Math.round(h.player.x), Math.round(h.player.z)],
      portal: game.portal ? [Math.round(game.portal.x), Math.round(game.portal.z)] : null,
      deathCause: died ? deathCause || h.lastHitBy || 'Unknown' : '',
      deathStage: died ? deathStage || game.stage : 0,
      stageReached: Math.min(game.stage, cfg.stages + 1),
      cleared: stages.filter((x) => x.stage < game.stage).length,
      runTime: Math.round(game.runTime),
      simT: Math.round(fixedT),
      fightTime: Math.round(fightTime),
      level: game.level,
      kills: game.kills,
      firstEvo,
      goldEarned,
      bosses,
      stages,
      dps,
      bossDmg: Object.fromEntries(Object.entries(bossDmg).map(([k, v]) => [k, Math.round(v)])),
      relics: [...h.relics],
      mods: h.synergy.slots.map((sl: any) => sl.def?.id ?? sl.id).filter(Boolean),
      lane: { ...lane, mechT: Math.round(lane.mechT), comebackT: Math.round(lane.comebackT), cashIns, mutantKills },
      wall: Date.now() - t0,
    }),
);
process.exit(0);
