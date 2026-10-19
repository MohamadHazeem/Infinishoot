/**
 * Sound lane, wave 2 (notes/lanes/sound2.md). Two halves:
 *
 * Host / solo, once per simulation step (`soundLaneStep`, from Game.simulate):
 *  - Instrument pickups: some stages hide one collectible instrument; touching
 *    it adds that instrument to the run's soundtrack for good (a team bitmask).
 *  - Sound-reactive enemies (`EnemyDef.ears`): every gameplay sound leaves a
 *    noise blob (src/audio/loudness.ts); eared enemies rush toward loud noise
 *    and lose track when it's quiet (EnemyCtx.hear, same contract as lure).
 *  Both reach clients in the snapshot's `s2` field (generic codec path).
 *
 * Every machine, every frame (`soundLaneFrame`, from systems/sound.ts): all
 * local presentation, derived from synced state:
 *  - the boss music duel (a boss's last phase or the ring-of-fire duel), with
 *    accents from your hits and kills during your phrase;
 *  - comeback tension music for this machine's hero;
 *  - the arena crowd's bed and reactions;
 *  - the radio DJ between stages, from this stage's highlights;
 *  - surround stingers when a boss or the Titan arrives;
 *  - beds for wave-1 features: last-stand heartbeat and clock, flood rush and
 *    laps, eclipse drone, volcano rumble, and the instrument's locator chime;
 *  - the pickup and the ♪ / zZ tells (src/game/soundLaneView.ts), the ON AIR,
 *    BAND and duel-turn HUD bits (src/ui/sound2Hud.ts).
 */
import type { Game } from '../game';
import type { Enemy } from '../enemies';
import type { Hero } from '../hero';
import { Rng } from '../../core/rng';
import { sfx } from '../../audio/sfx';
import { music } from '../../audio/music';
import { crowd } from '../../audio/crowd';
import { emptyHighlights, radio, radioEvents, radioScript, radioSettings, radioTuning, type RunHighlights } from '../../audio/radio';
import { playSurround } from '../../audio/surround';
import { INSTRUMENTS, INSTRUMENT_IDS, type InstrumentId } from '../../audio/instruments';
import { HEARD, NoiseField, cueLoudness, hearDecision, hearingTuning, type Heard } from '../../audio/loudness';
import { duelTuning } from '../../audio/musicDuel';
import { speaking } from '../../audio/voices';
import { a11yAudio } from '../../audio/captions';
import { worldEventOf } from './worldEvents';
import { eclipseNight, floodDepth, floodLevel, worldEventTuning } from '../worldEvents';
import { heroTimeOf, timeState } from './time';
import { timeTuning } from '../timeRules';
import { SoundLaneView, type TellSource } from '../soundLaneView';
import { SoundLaneHud } from '../../ui/sound2Hud';

export const instrumentDropTuning = {
  enabled: true,
  /** Chance a stage hides an instrument (while the band isn't complete). */
  chance: 0.45,
  /** When it shows up: a fraction of the stage timer. */
  from: 0.2,
  to: 0.65,
  /** How far from a hero it appears (m), and the grab radius. */
  near: [9, 18] as [number, number],
  grab: 1.4,
  /** Locator chime period (s) and how far it carries (m). */
  locatorEvery: 2.2,
  hear: 45,
};

export const crowdTriggerTuning = {
  /** A single hit of at least this share of max life gets booed. */
  booHit: 0.15,
  /** Team kills within one second that get a cheer. */
  killBurst: 25,
};

/** Test links and the debug panel. */
export const soundLaneForce = {
  /** Spawn this instrument near the hero on the next host step. */
  instrument: '' as '' | InstrumentId,
  /** Hold the boss duel / comeback tension on (music only). */
  duel: false,
  tension: false,
};

const FULL_BAND = (1 << INSTRUMENT_IDS.length) - 1;
const lureOut = { x: 0, z: 0, radius: 0, speed: 1 };
const spot = { x: 0, z: 0 };

interface Drop {
  kind: number;
  x: number;
  z: number;
}

interface LaneState {
  // Host.
  seed: number;
  runTime: number;
  stage: number;
  spawnAt: number;
  rng: Rng;
  noise: NoiseField;
  heard: Map<number, Heard>;
  shown: Map<number, Heard>;
  anchors: Map<number, { x: number; z: number }>;
  onSound: (name: string, x: number, z: number) => void;
  hear: (e: Enemy) => typeof lureOut | null;
  steps: number;
  // Shared (host writes, clients mirror).
  band: number;
  drop: Drop | null;
  netTells: Map<number, Heard>;
  // Local presentation.
  mode: string;
  bossUid: number;
  bossPhase: number;
  bossHp: number;
  bossName: string;
  bossTitan: boolean;
  bossSeenAt: number;
  cBoss: Enemy | null;
  bossScan: number;
  kills: number;
  killWin: number;
  killWinT: number;
  comboTier: number;
  hp: number;
  dead: boolean;
  bandSeen: number;
  hl: RunHighlights;
  hlStage: number;
  hlKills0: number;
  hlLevel0: number;
  ev0: { closeCalls: number; standWins: number; rewinds: number };
  heroDead: boolean[];
  breakPending: boolean;
  breakAt: number;
  beatT: number;
  tickT: number;
  tock: boolean;
  bedT: number;
  lapT: number;
  flood: number;
  locT: number;
  view: SoundLaneView | null;
  hud: SoundLaneHud | null;
  tells: TellSource[];
}

const lanes = new WeakMap<Game, LaneState>();

/** The lane's per-Game state (tests, debug, links). */
export function soundLane(g: Game): LaneState {
  let L = lanes.get(g);
  if (!L) {
    const st: LaneState = {
      seed: NaN, runTime: 0, stage: -1, spawnAt: -1, rng: new Rng(1), noise: new NoiseField(16),
      heard: new Map(), shown: new Map(), anchors: new Map(),
      onSound: (name, x, z) => {
        if (g.role === 'client') return;
        const loud = cueLoudness(name);
        if (loud > 0) st.noise.add(x, z, loud);
      },
      hear: (e) => hear(g, st, e),
      steps: 0,
      band: 0, drop: null, netTells: new Map(),
      mode: 'title', bossUid: -1, bossPhase: 1, bossHp: 1, bossName: '', bossTitan: false, bossSeenAt: 0, cBoss: null, bossScan: 0,
      kills: 0, killWin: 0, killWinT: 1, comboTier: 0, hp: -1, dead: false, bandSeen: 0,
      hl: emptyHighlights(1), hlStage: -1, hlKills0: 0, hlLevel0: 1, ev0: { ...radioEvents }, heroDead: [],
      breakPending: false, breakAt: 0,
      beatT: 0, tickT: 0, tock: false, bedT: 0, lapT: 0, flood: 0, locT: 0,
      view: null, hud: null, tells: [],
    };
    lanes.set(g, (L = st));
  }
  return L;
}

// ================================================================== host step

/** Host / solo: once per simulation step (Game.simulate, after the world events). */
export function soundLaneStep(g: Game, dt: number): void {
  if (g.role === 'client') return;
  const L = soundLane(g);
  if (g.vfx.onSound !== L.onSound) g.vfx.onSound = L.onSound;
  if (g.enemyCtx.hear !== L.hear) g.enemyCtx.hear = L.hear;
  L.noise.decay(dt);
  // What the enemies decided this step is what gets shown (and sent).
  const t = L.shown;
  L.shown = L.heard;
  L.heard = t;
  L.heard.clear();
  if (++L.steps % 120 === 0) for (const uid of L.anchors.keys()) if (!L.shown.has(uid)) L.anchors.delete(uid);
  if (g.mode === 'title') return;
  if (!Number.isNaN(L.seed) && (L.seed !== g.seed || g.runTime + 1e-6 < L.runTime)) {
    L.band = 0;
    L.drop = null;
    L.stage = -1;
  }
  L.seed = g.seed;
  L.runTime = g.runTime;
  if (!g.pvp && !g.onboarding.training) instrumentsHost(g, L, dt);
}

function hear(g: Game, L: LaneState, e: Enemy): typeof lureOut | null {
  const ears = e.def.ears;
  if (!ears || !hearingTuning.enabled || g.role === 'client' || e.def.boss) return null;
  let hd = Infinity;
  for (const t of g.targets) {
    if (!t.alive) continue;
    const d = (t.x - e.x) ** 2 + (t.z - e.z) ** 2;
    if (d < hd) hd = d;
  }
  hd = Math.sqrt(hd);
  const heard = L.noise.loudest(e.x, e.z, hearingTuning.range * ears, spot);
  const dec = hearDecision(heard, hd, heard > 0 ? Math.hypot(spot.x - e.x, spot.z - e.z) : 0);
  if (dec === HEARD.None) {
    L.anchors.delete(e.uid);
    return null;
  }
  L.heard.set(e.uid, dec);
  if (dec === HEARD.Attracted) {
    L.anchors.delete(e.uid);
    lureOut.x = spot.x;
    lureOut.z = spot.z;
    lureOut.speed = hearingTuning.rushSpeed;
    return lureOut;
  }
  // Calm: amble around where it lost you.
  let a = L.anchors.get(e.uid);
  if (!a) L.anchors.set(e.uid, (a = { x: e.x, z: e.z }));
  const ang = e.uid * 2.39 + g.runTime * 0.4;
  lureOut.x = a.x + Math.cos(ang) * 2.5;
  lureOut.z = a.z + Math.sin(ang) * 2.5;
  lureOut.speed = hearingTuning.calmSpeed;
  return lureOut;
}

function instrumentsHost(g: Game, L: LaneState, dt: number): void {
  const T = instrumentDropTuning;
  if (g.stage !== L.stage) {
    L.stage = g.stage;
    L.drop = null;
    L.spawnAt = -1;
    L.rng = new Rng((g.seed ^ Math.imul(g.stage + 17, 0x2c1b3c6d)) >>> 0);
    if (T.enabled && L.band !== FULL_BAND && L.rng.next() < T.chance) L.spawnAt = L.rng.range(T.from, T.to) * g.director.duration;
  }
  if (soundLaneForce.instrument) {
    const k = INSTRUMENT_IDS.indexOf(soundLaneForce.instrument);
    soundLaneForce.instrument = '';
    if (k >= 0) spawnDrop(g, L, k);
  }
  if (g.mode === 'fight' && L.spawnAt >= 0 && !L.drop && !g.director.bossSpawned && g.director.time >= L.spawnAt) {
    L.spawnAt = -1;
    const missing = INSTRUMENT_IDS.map((_, i) => i).filter((i) => !(L.band & (1 << i)));
    if (missing.length) spawnDrop(g, L, missing[Math.floor(L.rng.next() * missing.length) % missing.length]);
  }
  const d = L.drop;
  if (!d || !g.isCombatMode) return;
  void dt;
  for (const h of g.aliveHeroes) {
    if (Math.hypot(h.player.x - d.x, h.player.z - d.z) > T.grab + h.player.radius) continue;
    collect(g, L, h, d);
    break;
  }
}

/** Put instrument `kind` (an INSTRUMENT_IDS index) on the field near a hero (host). */
export function spawnDrop(g: Game, L: LaneState, kind: number): void {
  const heroes = g.aliveHeroes;
  const h = heroes.length ? heroes[Math.floor(L.rng.next() * heroes.length) % heroes.length] : g.hero;
  const T = instrumentDropTuning;
  const lim = g.arena.halfSize - 3;
  let x = h.player.x + 4;
  let z = h.player.z;
  for (let tries = 0; tries < 24; tries++) {
    const a = L.rng.next() * Math.PI * 2;
    const r = L.rng.range(T.near[0], T.near[1]);
    const tx = h.player.x + Math.cos(a) * r;
    const tz = h.player.z + Math.sin(a) * r;
    if (Math.abs(tx) > lim || Math.abs(tz) > lim || g.walls.hitCircle(tx, tz, 1.2)) continue;
    x = tx;
    z = tz;
    break;
  }
  L.drop = { kind, x, z };
  const def = INSTRUMENTS[INSTRUMENT_IDS[kind]];
  g.vfx.toast(`SOMETHING MUSICAL IS NEARBY: FOLLOW THE ${def.name.toUpperCase()}!`, 3);
  g.vfx.sound('s2:instrumentAppear', NaN, NaN);
  g.vfx.ring(x, z, 1, 6, def.color, 0.6);
}

function collect(g: Game, L: LaneState, h: Hero, d: Drop): void {
  const def = INSTRUMENTS[INSTRUMENT_IDS[d.kind]];
  L.band |= 1 << d.kind;
  L.drop = null;
  g.vfx.banner(`${def.name.toUpperCase()} JOINS THE BAND!`, def.blurb, 2.2);
  g.vfx.sound('s2:instrument', d.x, d.z);
  g.vfx.ring(d.x, d.z, 1, 7, def.color, 0.5);
  g.vfx.burst(d.x, 1.2, d.z, { count: 26, color: def.color, color2: '#f4f4f4', speed: [3, 8], size: [0.15, 0.3], life: [0.5, 0.9], up: 7, gravity: 10 });
  void h;
}

// ================================================================== net

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Snapshot `s2` for one client: the band, the pickup, tells near their hero. */
export function soundLaneNet(g: Game, forHero: Hero): Record<string, unknown> | null {
  const L = soundLane(g);
  const tells: number[] = [];
  if (L.shown.size) {
    const p = forHero.player;
    for (const e of g.enemies.list) {
      if (!e.alive || !e.def.ears) continue;
      const s = L.shown.get(e.uid);
      if (!s || Math.abs(e.x - p.x) + Math.abs(e.z - p.z) > 40) continue;
      tells.push(e.uid, s);
      if (tells.length >= 96) break;
    }
  }
  if (!L.band && !L.drop && !tells.length) return null;
  return { b: L.band, d: L.drop ? [L.drop.kind, r1(L.drop.x), r1(L.drop.z)] : null, h: tells };
}

/** Client: mirror the band, the pickup and the tells. */
export function applySoundLaneNet(g: Game, raw: unknown): void {
  const L = soundLane(g);
  const m = (raw ?? null) as { b?: number; d?: number[] | null; h?: number[] } | null;
  L.band = m?.b ?? 0;
  L.drop = m?.d && m.d.length >= 3 ? { kind: m.d[0], x: m.d[1], z: m.d[2] } : null;
  L.netTells.clear();
  const h = m?.h;
  if (h) for (let i = 0; i + 1 < h.length; i += 2) L.netTells.set(h[i], h[i + 1] as Heard);
}

// ================================================================== local, every frame

/** The stage boss this machine sees (host: game.boss; client: the mirrored boss). */
function localBoss(g: Game, L: LaneState, dt: number): Enemy | null {
  if (g.role !== 'client') return g.boss && g.boss.active && g.boss.def.boss ? g.boss : null;
  const b = L.cBoss;
  if (b && b.active && b.def.boss && (L.bossScan -= dt) > 0) return b;
  L.bossScan = 0.25;
  L.cBoss = null;
  for (const e of g.enemies.list) if (e.active && e.def.boss && !e.def.hidden) {
    L.cBoss = e;
    break;
  }
  return L.cBoss;
}

/** A boss is in its last phase (the Titan's exposed core is its fourth). */
export function inLastPhase(e: Enemy): boolean {
  if (e.def.behavior === 'titan') return e.phase >= 4;
  return e.phase >= (e.def.phases?.length ?? 0) + 1;
}

/** Seconds left of this machine's hero's last stand as 0..1, or -1. */
function standLeft(g: Game): number {
  if (g.role === 'client') return timeState(g).net.stand?.left01 ?? -1;
  const ht = heroTimeOf(g, g.hero);
  return ht.standT > 0 ? ht.standT / timeTuning.standTime : -1;
}

/** A local positioned cue (like the effects bus, but only here). */
function playAt(g: Game, name: string, x: number, z: number, pitch = 1, range = 40, floor = 0.3): void {
  const me = g.hero.player;
  const d = Math.hypot(x - me.x, z - me.z);
  if (d > range) return;
  const gain = Math.max(floor, d < 6 ? 1 : 1 - ((d - 6) / (range - 6)) * 0.7);
  sfx.at((x - me.x) / 14, gain, x, z);
  sfx.named(name, pitch);
  sfx.at(0, 1);
}

function betweenStages(g: Game): boolean {
  const m = g.mode;
  return m === 'cleared' || m === 'portal' || m === 'transition' || m === 'shop' || g.screens.current === 'route';
}

export function soundLaneFrame(g: Game, dt: number, frozen: boolean): void {
  const L = soundLane(g);
  const mode = g.mode;
  const inRun = mode !== 'title' && mode !== 'dead';
  const fighting = g.isCombatMode && !g.paused && !frozen;
  const now = performance.now() / 1000;
  const me = g.hero.player;
  if (mode !== L.mode) {
    if (mode === 'title' || mode === 'dead') {
      crowd.reset();
      if (mode === 'title') radio.reset();
      L.breakPending = false;
      L.hlStage = -1;
    }
    if (mode === 'cleared' && L.mode === 'fight' && !g.pvp && !me.dead) {
      crowd.react('applause', 1);
      finishHighlights(g, L);
      L.breakPending = radioSettings.enabled && Math.random() < radioTuning.chance;
      L.breakAt = now + radioTuning.delay;
    }
    if (mode === 'dead') crowd.react('aww', 1, true);
    L.mode = mode;
  }
  // ---------------------------------------------------------------- music
  music.setInstruments(inRun ? L.band : 0);
  const boss = inRun ? localBoss(g, L, dt) : null;
  const duel = fighting && mode === 'fight' && !!boss && (!!g.bossDuel || inLastPhase(boss) || soundLaneForce.duel);
  music.setDuel(duel || (soundLaneForce.duel && inRun));
  if (boss) {
    const hp01 = boss.maxHp > 0 ? boss.hp / boss.maxHp : 1;
    if (duel && music.duelTurn === 'hero') {
      const kills = Math.max(0, g.kills - L.kills);
      const dmg = boss.uid === L.bossUid ? Math.max(0, L.bossHp - hp01) * 100 : 0;
      music.duelAccent(kills * duelTuning.perKill + dmg * duelTuning.perHp);
    }
    if (boss.uid !== L.bossUid) {
      // A boss arrives: a stinger circles you once (the Titan rises around you), the crowd goes "ooh".
      L.bossUid = boss.uid;
      L.bossPhase = boss.phase;
      L.bossName = boss.def.name;
      L.bossTitan = boss.def.behavior === 'titan';
      L.bossSeenAt = g.runTime;
      if (fighting) {
        playSurround(L.bossTitan ? 'titan' : 'boss');
        crowd.react('ooh', 1);
      }
    } else if (boss.phase > L.bossPhase) {
      L.bossPhase = boss.phase;
      crowd.react('roar', 0.8);
    }
    L.bossHp = hp01;
    if (g.bossDuel) L.hl.duel = true;
  } else if (L.bossUid >= 0) {
    // The boss is gone: beaten if the stage cleared (or it ran out of life).
    if (inRun && L.hlStage === g.stage) {
      L.hl.boss = L.bossName;
      L.hl.titan = L.bossTitan;
      L.hl.bossTime = Math.max(0, g.runTime - L.bossSeenAt);
      crowd.react('roar', 1, true);
    }
    L.bossUid = -1;
  }
  music.setTension(inRun && ((fighting && g.hero.comeback && !me.dead) || soundLaneForce.tension));
  music.setTalkover(radio.active);
  // ---------------------------------------------------------------- highlights (for the DJ) and the crowd
  if (inRun && mode === 'fight' && g.stage !== L.hlStage) startHighlights(g, L);
  const hpNow = me.hp;
  const hit = L.hp >= 0 && !me.dead && hpNow < L.hp - 0.5;
  if (fighting && inRun) trackHighlights(g, L, boss, hit);
  crowdFrame(g, L, dt, fighting && mode === 'fight', !!boss, duel, hit ? (L.hp - hpNow) / Math.max(1, me.maxHp) : 0);
  L.hp = hpNow;
  L.dead = me.dead;
  L.kills = g.kills;
  // ---------------------------------------------------------------- radio
  const talkOk = inRun && betweenStages(g) && !g.paused;
  if (L.breakPending && talkOk && now >= L.breakAt) {
    radio.queue(radioScript(L.hl), 10);
    L.breakPending = false;
  }
  radio.update(talkOk);
  // ---------------------------------------------------------------- local beds
  if (fighting && inRun) beds(g, L, dt);
  // ---------------------------------------------------------------- drawing
  draw(g, L, dt, inRun, duel);
}

function startHighlights(g: Game, L: LaneState): void {
  L.hlStage = g.stage;
  L.hl = emptyHighlights(g.stage);
  L.hl.coop = g.heroes.length > 1;
  L.hlKills0 = g.kills;
  L.hlLevel0 = g.level;
  L.ev0 = { ...radioEvents };
  L.bandSeen = L.band;
  L.heroDead = g.heroes.map((h) => h.player.dead);
}

function trackHighlights(g: Game, L: LaneState, boss: Enemy | null, hit: boolean): void {
  const hl = L.hl;
  if (g.combo > hl.maxCombo) hl.maxCombo = g.combo;
  if (hit) {
    hl.hits++;
    if (boss) hl.bossHits++;
  }
  const play = g.hero.play;
  if (play.mechT > 0) hl.mech = true;
  if (play.superT > 0) hl.crate = true;
  if (g.hero.comeback) hl.comeback = true;
  const ev = worldEventOf(g);
  if (ev) hl.event = ev.kind;
  const added = L.band & ~L.bandSeen;
  if (added) {
    const i = INSTRUMENT_IDS.findIndex((_, k) => added & (1 << k));
    if (i >= 0) hl.instrument = INSTRUMENTS[INSTRUMENT_IDS[i]].name;
    L.bandSeen = L.band;
    crowd.react('cheer', 0.9, true);
  }
  g.heroes.forEach((h, i) => {
    const was = L.heroDead[i];
    if (was && !h.player.dead && h !== g.hero) hl.revives++;
    L.heroDead[i] = h.player.dead;
  });
}

function finishHighlights(g: Game, L: LaneState): void {
  const hl = L.hl;
  hl.kills = Math.max(0, g.kills - L.hlKills0);
  hl.level = g.level;
  hl.levelsGained = Math.max(0, g.level - L.hlLevel0);
  hl.closeCalls = radioEvents.closeCalls - L.ev0.closeCalls;
  hl.lastStandWon = radioEvents.standWins > L.ev0.standWins;
  hl.rewound = radioEvents.rewinds > L.ev0.rewinds;
}

function crowdFrame(g: Game, L: LaneState, dt: number, active: boolean, boss: boolean, duel: boolean, hitFrac: number): void {
  const style = g.hero.skill?.style.rank ?? 0;
  const excite = active ? Math.min(1, 0.12 + Math.min(0.45, g.combo / 250) + (boss ? 0.25 : 0) + (duel ? 0.2 : 0) + style * 0.04) : 0;
  crowd.update(excite, active, speaking() || radio.active);
  if (!active) {
    L.comboTier = 0;
    return;
  }
  // Combo milestones: 50, 100, then every 100.
  const c = g.combo;
  const tier = c >= 100 ? Math.floor(c / 100) + 1 : c >= 50 ? 1 : 0;
  if (tier > L.comboTier) crowd.react(tier >= 3 ? 'roar' : 'cheer', Math.min(1, 0.5 + tier * 0.15));
  L.comboTier = tier;
  // A burst of kills.
  L.killWin += Math.max(0, g.kills - L.kills);
  if ((L.killWinT -= dt) <= 0) {
    if (L.killWin >= crowdTriggerTuning.killBurst) crowd.react('cheer', 0.7);
    L.killWin = 0;
    L.killWinT = 1;
  }
  const me = g.hero.player;
  if (hitFrac >= crowdTriggerTuning.booHit) crowd.react('boo', Math.min(1, hitFrac * 3));
  if (me.dead && !L.dead) crowd.react('aww', 1);
}

function beds(g: Game, L: LaneState, dt: number): void {
  const me = g.hero.player;
  // Last stand: a heartbeat that speeds up as time runs out, and a ticking clock.
  const left = standLeft(g);
  if (left >= 0) {
    const urgency = 1 + (1 - left);
    if ((L.beatT -= dt) <= 0) {
      L.beatT = 0.85 - 0.45 * (1 - left);
      sfx.named('s2:standBeat', urgency);
    }
    if ((L.tickT -= dt) <= 0) {
      L.tickT = 0.5;
      L.tock = !L.tock;
      sfx.named('s2:standTick', L.tock ? 0.9 : 1);
    }
  } else L.beatT = L.tickT = 0;
  // World events.
  const ev = worldEventOf(g);
  if (ev && !ev.done) {
    if (ev.kind === 'flood') {
      const lv = floodLevel(ev.t);
      if (lv > L.flood + 1e-4 && (L.bedT -= dt) <= 0) {
        L.bedT = 1.3;
        sfx.named('s2:floodRush');
      }
      if (lv > 0 && !me.dead && me.speed > 1 && floodDepth(ev.p, lv, me.x, me.z) > 0 && (L.lapT -= dt) <= 0) {
        L.lapT = 0.45;
        sfx.named('s2:floodLap', 0.8 + Math.random() * 0.4);
      }
      L.flood = lv;
    } else if (ev.kind === 'eclipse') {
      if (eclipseNight(ev.t) > 0.3 && (L.bedT -= dt) <= 0) {
        L.bedT = 3.6;
        sfx.named('s2:eclipseDrone');
      }
    } else if (ev.kind === 'volcano') {
      if (ev.t < worldEventTuning.volcanoWarn + worldEventTuning.volcanoLen && (L.bedT -= dt) <= 0) {
        L.bedT = 2.3;
        playAt(g, 's2:volcanoRumble', ev.p[0] ?? me.x, ev.p[1] ?? me.z, 1, 80, 0.45);
      }
    }
  } else {
    L.bedT = 0;
    L.flood = 0;
  }
  // The instrument's locator chime.
  const d = L.drop;
  if (d && (L.locT -= dt) <= 0) {
    L.locT = instrumentDropTuning.locatorEvery;
    playAt(g, 's2:locator', d.x, d.z, 1 + d.kind * 0.06, instrumentDropTuning.hear, 0.25);
  }
}

function draw(g: Game, L: LaneState, dt: number, inRun: boolean, duel: boolean): void {
  if (typeof document === 'undefined') return;
  if (!L.view) L.view = new SoundLaneView(g.scene);
  const tells = L.tells;
  let n = 0;
  if (inRun) {
    const me = g.hero.player;
    const add = (e: Enemy, s: number) => {
      if (Math.abs(e.x - me.x) + Math.abs(e.z - me.z) > 30) return;
      const t = tells[n] ?? (tells[n] = { x: 0, z: 0, radius: 0, state: 0 });
      t.x = e.x;
      t.z = e.z;
      t.radius = e.radius;
      t.state = s;
      n++;
    };
    if (g.role === 'client') {
      for (const [uid, s] of L.netTells) {
        const e = g.netEnemies.get(uid);
        if (e && e.active) add(e, s);
      }
    } else if (L.shown.size) for (const e of g.enemies.list) if (e.alive && e.def.ears) {
      const s = L.shown.get(e.uid);
      if (s) add(e, s);
    }
  }
  for (let i = n; i < tells.length; i++) tells[i].state = 0;
  L.view.render(g.paused ? 0 : dt, inRun ? L.drop : null, music.pulse, tells, g.cam.camera);
  if (!L.hud) {
    const root = document.getElementById('hud');
    if (!root) return;
    L.hud = new SoundLaneHud(root);
  }
  L.hud.update(radio.active, radio.onAir.text, !a11yAudio.captions, L.band, duel ? music.duelTurn : null, inRun);
}
