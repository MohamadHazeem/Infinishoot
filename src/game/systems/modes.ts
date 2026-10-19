/**
 * Modes lane: rhythm stages, the hidden Pacifist road, bonus mini-games between stages and
 * Weekly Challenge ghost racing. These are Game methods (`this` is the Game), installed on the
 * class as fields. Pure rules live in src/game/modes/*.ts; drawing in src/render/modesView.ts,
 * the HUD in src/ui/modesHud.ts and the ghost screen in src/ui/ghostScreen.ts.
 *
 * Hooks (small, in shared files):
 *   loadStage -> modesStageStart        decides this stage's rhythm / pacifist rules
 *   update    -> modesTick(dt)           the beat clock, in real step time (also through hit-stops)
 *   simulate  -> modesPreWeapons(dt)     enemy beat pulse and holds, holstered weapons
 *             -> updateModes(dt)         pacifist timer and rewards, mini-game, ghost recording
 *   killEnemy -> modesOnKill             on-beat kill bonus, pacifist kill check
 *   damage / nearestEnemy / tryBomb / tryUlt check `modes.holster`
 *   openLevelUp -> modesOffers(h)        the pacifist's legendary card
 *   routeAdvance -> modesArcade()        the Bonus Arcade road plays its mini-game before the portal
 *   bankAndShow -> modesRunEnd()         keeps the weekly ghost
 *   snapshots: `md` (modesNet / applyModesNet); clients step the beat with modesLocal(dt)
 *   render -> renderModes(dt)
 *
 * Co-op: the host decides everything. Clients get {rhythm clock, on-beat kills, pacifist timer and
 * kills, mini-game state} in the snapshot and run the same beat function, so beats agree.
 * Ghosts are solo only (the Weekly Challenge is a solo mode).
 */
import type { Game } from '../game';
import { directorTuning } from '../director';
import type { Enemy } from '../enemies';
import type { Hero } from '../hero';
import { MAX_GEARS, MAX_PASSIVES, MAX_WEAPONS } from '../hero';
import { WEAPONS } from '../../data/weapons';
import { PASSIVES } from '../../data/passives';
import type { Offer } from '../../ui/screens';
import { offerKey } from '../banish';
import { rollRelic } from '../../data/relics';
import { ROUTE_NODES, type NodeKind } from '../../data/routeNodes';
import { music } from '../../audio/music';
import { bossTrack } from '../../audio/music/composition';
import { biomeForStage } from '../../data/biomes';
import { beatAt, beatPhase, clockNet, crossed, newClock, onBeat, rhythmRoll, rhythmTuning, setTempo, stageBpm, stepPulse, type BeatClock } from '../modes/rhythm';
import { pacifistLeft, pacifistReward, pacifistTuning } from '../modes/pacifist';
import { MINI_GAMES, miniFromNet, miniKindFor, miniNet, miniOver, miniStep, newMiniGame, type MiniEvent, type MiniGame, type MiniHero, type MiniKind } from '../modes/minigames';
import { GhostEv, GhostRecorder, type Ghost } from '../modes/ghost';
import { ghostStore } from '../modes/ghostStore';
import { ModesView } from '../../render/modesView';
import { ModesHud } from '../../ui/modesHud';
import { GhostScreen } from '../../ui/ghostRaceScreen';

/** Test links / debug panel: force or forbid a rhythm stage (null = the route node and the seeded roll decide). */
export const modesForce: { rhythm: boolean | null; ghostAnyMode: boolean } = { rhythm: null, ghostAnyMode: false };

/** Route nodes whose stages can still roll as a rhythm stage. */
const PLAIN: ReadonlySet<NodeKind> = new Set<NodeKind>(['start', 'elite', 'shop', 'treasure', 'event', 'rest', 'hard', 'arcade']);

export interface ModesRun {
  stage: number;
  /** Weapons holstered this step (pacifist stage, mini-game): no hero damage, no special or ultimate. */
  holster: boolean;
  // Rhythm
  rhythm: boolean;
  clock: BeatClock;
  /** Rhythm time (seconds of fight on this stage). */
  rt: number;
  beat: number;
  prevBeat: number;
  /** Beat position at the last simulation step (beats can pass during a hit-stop). */
  simBeat: number;
  /** On-beat kills per hero index this stage. */
  onBeat: number[];
  /** Beat index of the last ON BEAT! popup (one per beat). */
  popBeat: number;
  // Pacifist
  pacifist: boolean;
  pacKills: number[];
  pacPaid: boolean;
  /** Pending legendary level-up cards per hero index. */
  legendary: number[];
  // Mini-game
  mg: MiniGame | null;
  /** Fire input this step per hero (read before the clicks are idled). */
  fireIn: boolean[];
  // Flow
  lastMode: string;
  lastLevel: number;
  // Ghosts (solo weekly runs)
  rec: GhostRecorder | null;
  rival: Ghost | null;
  rivalOwn: boolean;
  dead: boolean;
  // Client mirror
  /** Host rhythm time in the last snapshot. */
  netRt: number;
  netSeen: boolean;
  /** Pacifist seconds left in the last snapshot. */
  pacLeft: number;
  // Presentation (lazy)
  view: ModesView | null;
  hud: ModesHud | null;
  screen: GhostScreen | null;
}

export function newModesRun(): ModesRun {
  return {
    stage: 0, holster: false, rhythm: false, clock: newClock(120), rt: 0, beat: 0, prevBeat: 0, simBeat: 0, onBeat: [], popBeat: -1,
    pacifist: false, pacKills: [], pacPaid: false, legendary: [], mg: null, fireIn: [], lastMode: '', lastLevel: 1,
    rec: null, rival: null, rivalOwn: false, dead: false, netRt: 0, netSeen: false, pacLeft: 0, view: null, hud: null, screen: null,
  };
}

/** Is this a weekly run that records and races ghosts (solo only)? */
export function ghostRun(g: Game): boolean {
  return g.role === 'solo' && !g.pvp && ((g.runMode === 'weekly' && !!g.meta.week) || modesForce.ghostAnyMode);
}

/** The week a ghost run belongs to ('' outside weekly runs; test runs use 'test'). */
function ghostWeek(g: Game): string {
  return g.meta.week || (modesForce.ghostAnyMode ? 'test' : '');
}

/** Score as the HUD shows it (heat multiplier applied once). */
function shownScore(g: Game): number {
  return Math.floor(g.score * g.meta.multiplier);
}

// ------------------------------------------------------------------ stage start

/** A stage just loaded (solo/host): rhythm and pacifist rules for it. */
export function modesStageStart(this: Game): void {
  const M = this.modes;
  const n = this.heroes.length;
  M.stage = this.stage;
  M.rt = M.beat = M.prevBeat = M.simBeat = 0;
  M.popBeat = -1;
  M.onBeat = new Array(n).fill(0);
  M.pacKills = new Array(n).fill(0);
  M.pacPaid = false;
  if (M.legendary.length !== n) M.legendary = new Array(n).fill(0);
  M.lastMode = this.mode;
  const kind = this.routeKind();
  const allowed = !this.pvp && this.runMode !== 'bossrush';
  M.pacifist = allowed && kind === 'pacifist';
  M.rhythm = allowed && !M.pacifist && (modesForce.rhythm ?? (kind === 'rhythm' || (PLAIN.has(kind) && rhythmRoll(this.seed, this.stage))));
  M.clock = newClock(stageBpm(this.stage, this.arenaStage, false));
  if (M.pacifist) {
    this.director.lengthMul = pacifistTuning.seconds / directorTuning.stageSeconds;
    this.bossField.miniStage = this.stage; // no mini-boss on a pacifist stage
    this.vfx.toast(`PACIFIST ROAD: SURVIVE ${Math.round(pacifistTuning.seconds)} S WITHOUT A KILL`, 4);
  } else this.director.lengthMul = 1;
  if (M.rhythm) this.vfx.toast(`RHYTHM STAGE: THEY MOVE TO THE BEAT · ON-BEAT KILLS x${rhythmTuning.killScore}`, 4);
  // Ghosts: a weekly run starts its recording on stage 1 and loads the rival.
  if (this.stage === 1) {
    M.legendary = new Array(n).fill(0);
    M.rec = null;
    M.rival = null;
  }
  if (ghostRun(this)) {
    if (!M.rec) {
      M.rec = new GhostRecorder(ghostWeek(this), this.hero.name, this.hero.heroDef.id);
      M.dead = false;
      M.lastLevel = this.level;
      const rival = ghostStore.rivalFor(ghostWeek(this));
      M.rival = rival ?? ghostStore.mine(ghostWeek(this));
      M.rivalOwn = !rival && !!M.rival;
      if (M.rival) this.vfx.toast(M.rivalOwn ? 'GHOST RACE: YOUR BEST RUN THIS WEEK' : `GHOST RACE: ${M.rival.name.toUpperCase()}`, 3);
    }
    M.rec.event(this.runTime, GhostEv.StageStart, this.stage);
  } else M.rec = null;
}

// ------------------------------------------------------------------ per step (host/solo)

/**
 * The beat clock (solo/host), every world step in real time: it keeps going through hit-stops,
 * finishers and slow motion like the music does, and only stops while a menu freezes the world.
 */
export function modesTick(this: Game, dt: number): void {
  const M = this.modes;
  if (!M.rhythm || !this.isCombatMode) return;
  M.rt += dt;
  setTempo(M.clock, stageBpm(this.stage, this.arenaStage, !!this.boss), M.rt);
  M.prevBeat = M.beat;
  M.beat = beatAt(M.clock, M.rt);
}

/** Before the weapons fire: the enemy beat pulse and holds, holstered clicks. */
export function modesPreWeapons(this: Game, dt: number): void {
  const M = this.modes;
  if (M.stage !== this.stage && this.mode !== 'title') this.modesStageStart();
  const fighting = this.mode === 'fight';
  M.holster = (M.pacifist && fighting) || !!M.mg;
  for (const h of this.heroes) {
    M.fireIn[h.index] = h.ctx.firing;
    if (M.holster) h.ctx.firing = h.ctx.charging = false;
  }
  const ctx = this.enemyCtx;
  if (M.rhythm && this.isCombatMode) {
    const p = beatPhase(M.beat);
    ctx.beatStep = stepPulse(p);
    // Wind-ups that finish between beats wait for the next one: attacks land on the beat.
    ctx.beatHold = !crossed(M.simBeat, M.beat);
    M.simBeat = M.beat;
    if (!ctx.beatHold) for (const e of this.enemies.list) if (e.alive && !e.def.boss) e.squash(rhythmTuning.bob);
  } else {
    ctx.beatStep = undefined;
    ctx.beatHold = undefined;
  }
  // Pacifist: no boss; the stage ends when the (shorter) timer runs out.
  if (M.pacifist && fighting && !this.director.bossSpawned && this.director.time + dt >= this.director.duration) {
    this.director.bossSpawned = true;
    this.vfx.banner('YOU SURVIVED!', 'THE PACIFIST ROAD IS BEHIND YOU', 2.4);
  }
}

/** After the world moved: pacifist rewards, the mini-game, ghost recording. */
export function updateModes(this: Game, dt: number): void {
  const M = this.modes;
  if (this.mode === 'cleared' && M.lastMode !== 'cleared') onCleared(this);
  if (this.mode === 'dead' && !M.dead) {
    M.dead = true;
    M.rec?.event(this.runTime, GhostEv.Death, this.stage);
  }
  M.lastMode = this.mode;
  if (M.mg) stepMini(this, M.mg, dt);
  if (M.rec && this.mode !== 'title') {
    const p = this.hero.player;
    M.rec.step(this.runTime, p.x, p.z, Math.atan2(p.aim.x, p.aim.z), shownScore(this), this.stage);
    if (this.level !== M.lastLevel) {
      M.lastLevel = this.level;
      M.rec.event(this.runTime, GhostEv.Level, this.level);
    }
  }
}

function onCleared(g: Game): void {
  const M = g.modes;
  M.rec?.event(g.runTime, GhostEv.StageClear, g.stage);
  if (!M.pacifist) M.rec?.event(g.runTime, GhostEv.Boss, g.stage);
  if (M.pacifist && !M.pacPaid) {
    M.pacPaid = true;
    for (const h of g.heroes) {
      if (h.left) continue;
      const r = pacifistReward(M.pacKills[h.index] ?? 0, g.stage);
      if (!r) {
        note(g, h, 'PACIFIST ROAD CLEARED, BUT YOU KILLED: NO REWARD');
        continue;
      }
      h.gold += r.gold;
      g.score += r.score;
      const relic = rollRelic(h.relics, h.stats.luck, () => g.rng.next());
      if (relic) {
        h.relics.push(relic.id);
        h.recomputeStats();
        h.loadoutDirty = true;
      }
      h.rerollsLeft = Math.min(MAX_GEARS, h.rerollsLeft + 1);
      M.legendary[h.index] = (M.legendary[h.index] ?? 0) + 1;
      h.pendingLevels++;
      note(g, h, `PACIFIST! +${r.gold} GOLD${relic ? `, ${relic.name.toUpperCase()}` : ''}, A LEGENDARY CARD`);
      g.legendaryBurst(h);
    }
    g.vfx.sound('legendaryPick', NaN, NaN);
  }
}

function note(g: Game, h: Hero, msg: string): void {
  if (h === g.hero) g.hud.toast(msg, 4);
  else g.tell(h, { t: 'toast', msg });
}

/** A kill (host/solo): the on-beat bonus and the pacifist check. */
export function modesOnKill(this: Game, e: Enemy, _source: string, by: Hero | null): void {
  const M = this.modes;
  if (M.pacifist && by && this.mode === 'fight') {
    const n = (M.pacKills[by.index] = (M.pacKills[by.index] ?? 0) + 1);
    if (n === 1) note(this, by, 'YOU KILLED: PACIFIST REWARD FORFEIT');
  }
  if (!M.rhythm || !by || !onBeat(M.beat, M.clock.bpm)) return;
  const base = e.def.score * this.multiplier * (e.elite ? 5 : 1) * (1 + this.curseSum('score')) * this.difficulty.score;
  this.score += base * (rhythmTuning.killScore - 1);
  this.combo += rhythmTuning.comboBonus;
  this.maxCombo = Math.max(this.maxCombo, this.combo);
  M.onBeat[by.index] = (M.onBeat[by.index] ?? 0) + 1;
  const b = Math.floor(M.beat + 0.5);
  if (b !== M.popBeat) {
    M.popBeat = b;
    this.vfx.num(e.x, 2.6, e.z, 'ON BEAT!', 'score', by.index);
  }
}

/** Legendary items this hero could take now (new legendary auto weapons, legendary items not maxed). */
function legendaryCands(g: Game, h: Hero): Offer[] {
  const out: Offer[] = [];
  const auto = h.weapons.filter((w) => !w.def.slot).length;
  for (const id of h.unlocked) {
    const d = WEAPONS[id];
    if (!d || d.slot || d.fusion || d.rarity !== 'legendary' || auto >= MAX_WEAPONS || h.weapons.some((w) => w.def.id === id)) continue;
    out.push({ kind: 'weapon', id, name: d.name, icon: d.icon, color: d.color, tag: 'NEW!', text: d.desc, tags: d.tags, rarity: d.rarity, slot: 'auto' });
  }
  const owned = Object.keys(h.passives).length;
  for (const [id, d] of Object.entries(PASSIVES)) {
    if (d.rarity !== 'legendary' || (d.coop && !g.coop)) continue;
    const lv = h.passives[id] ?? 0;
    if (lv >= d.maxLevel || (lv === 0 && owned >= MAX_PASSIVES)) continue;
    out.push({ kind: 'passive', id, name: d.name, icon: d.icon, color: d.color, tag: lv ? `LV ${lv + 1}` : 'NEW!', text: d.desc, rarity: d.rarity, level: lv, maxLevel: d.maxLevel, slot: 'item' });
  }
  return out;
}

const RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, legendary: 3 };

/**
 * Level-up cards: a pending pacifist reward makes this draw legendary: every legendary this hero
 * can take (evolution forks, legendary weapons and items, from the normal pool too), and when the
 * pool has fewer than three, the rarest other cards it can find.
 */
export function modesOffers(this: Game, h: Hero): void {
  const M = this.modes;
  if (!(M.legendary[h.index] > 0)) return;
  M.legendary[h.index]--;
  const seen = new Set<string>();
  const pool: Offer[] = [];
  const add = (o: Offer) => {
    const key = offerKey(o);
    if (seen.has(key)) return;
    seen.add(key);
    pool.push(o);
  };
  for (const o of h.offers) add(o);
  for (const o of legendaryCands(this, h)) add(o);
  for (let k = 0; k < 30; k++) for (const o of h.buildOffers()) add(o);
  // Rarest first; ties in a seeded order.
  const order = pool.map((o) => ({ o, r: RANK[o.rarity ?? 'common'] ?? 0, k: this.rng.next() }));
  order.sort((a, b) => b.r - a.r || a.k - b.k);
  h.offers = order.slice(0, 3).map((x) => x.o);
}

/** Weapons are holstered on this machine's authority (damage, specials and ultimates check it). */
export function modesHolster(this: Game, _h?: Hero): boolean {
  return this.modes.holster;
}

// ------------------------------------------------------------------ mini-games

/** The Bonus Arcade road was picked: play its mini-game now, before the portal. */
export function modesArcade(this: Game): boolean {
  if (this.role === 'client') return false;
  this.startMiniGame(miniKindFor(this.seed, this.stage + 1));
  return true;
}

/** Start a mini-game right here (route node, test links, debug panel). Host/solo. */
export function startMiniGame(this: Game, kind: MiniKind): void {
  const r = this.route;
  if (r.open) {
    r.open = false;
    if (this.screens.current === 'route') this.screens.show('none');
    this.host?.broadcast({ t: 'route', open: false });
  }
  for (const e of this.enemies.list) if (e.active) this.enemies.kill(e);
  this.bullets.clear();
  const p = (this.aliveHeroes[0] ?? this.hero).player;
  const lim = this.arena.halfSize - 16;
  const cx = Math.max(-lim, Math.min(lim, p.x));
  const cz = Math.max(-lim, Math.min(lim, p.z));
  this.modes.mg = newMiniGame(kind, this.seed, this.stage + 1, cx, cz, this.heroes.length, (x, z, rr) => this.walls.hitCircle(x, z, rr));
  this.mode = 'portal';
  this.modeT = 0;
  this.portal.close();
  this.portal.x = this.portal.z = 1e5; // nothing to walk into until the game is over
  const def = MINI_GAMES[kind];
  this.vfx.banner(`BONUS: ${def.name}`, def.how, 2.4);
  this.vfx.sound('jingle', NaN, NaN);
}

const miniHeroes: MiniHero[] = [];
const miniEvents: MiniEvent[] = [];

function stepMini(g: Game, mg: MiniGame, dt: number): void {
  // Paused by a level-up or the solo pause menu: update() doesn't simulate then, so no clock runs.
  miniHeroes.length = 0;
  for (const h of g.heroes) {
    const p = h.player;
    miniHeroes.push({ x: p.x, z: p.z, radius: p.radius, aimX: p.aim.x, aimZ: p.aim.z, firing: !!g.modes.fireIn[h.index], alive: !p.dead && !h.left });
  }
  const before = mg.phase;
  miniStep(mg, dt, miniHeroes, (x, z, r) => g.walls.hitCircle(x, z, r), miniEvents);
  if (before === 0 && mg.phase === 1) {
    g.vfx.banner('GO!', '', 0.8);
    g.vfx.sound('wave', NaN, NaN);
  }
  for (const ev of miniEvents) {
    const h = ev.hero >= 0 ? g.heroes[ev.hero] : null;
    if (h && ev.gold) h.gold += ev.gold;
    switch (ev.type) {
      case 'shot':
        if (h) shotFx(g, h, ev.tx ?? ev.x, ev.tz ?? ev.z, false);
        break;
      case 'hit':
        if (h) shotFx(g, h, ev.x, ev.z, true);
        g.vfx.num(ev.x, 2.4, ev.z, `+${ev.gold}`, 'score', ev.hero);
        g.vfx.burst(ev.x, 1.3, ev.z, { count: ev.kind === 1 ? 18 : 10, color: ev.kind === 1 ? '#ffcd75' : '#f4f4f4', color2: '#b13e53', speed: [2, 6], size: [0.12, 0.26], life: [0.25, 0.5], up: 3, gravity: 10 });
        g.vfx.sound(ev.kind === 1 ? 'coin' : 'hit', ev.x, ev.z);
        break;
      case 'bomb':
        if (h && g.modes.mg?.kind === 'gallery') shotFx(g, h, ev.x, ev.z, true);
        g.vfx.num(ev.x, 2.4, ev.z, ev.gold ? `${ev.gold}` : 'BOOM!', 'crit', ev.hero);
        g.vfx.ring(ev.x, ev.z, 0.8, 4, '#b13e53', 0.35);
        g.vfx.burst(ev.x, 1, ev.z, { count: 16, color: '#ff5e3a', color2: '#333c57', speed: [3, 7], size: [0.15, 0.32], life: [0.3, 0.6], up: 4, gravity: 12 });
        g.vfx.sound('explode', ev.x, ev.z);
        if (h) g.vfx.shake(h.player.x, h.player.z, 0.25);
        break;
      case 'grab':
      case 'whack':
        g.vfx.num(ev.x, 2, ev.z, `+${ev.gold}`, 'score', ev.hero);
        g.vfx.burst(ev.x, 0.6, ev.z, { count: ev.type === 'whack' ? 12 : 6, color: ev.type === 'whack' ? '#94b0c2' : '#ffcd75', color2: '#ffffff', speed: [2, 5], size: [0.1, 0.22], life: [0.2, 0.4], up: 4, gravity: 12 });
        if (ev.type === 'whack') g.vfx.ring(ev.x, ev.z, 0.6, 2.5, '#38b764', 0.25);
        g.vfx.sound(ev.type === 'grab' ? 'coin' : 'impact', ev.x, ev.z);
        break;
      case 'spawn':
        break;
    }
  }
  if (mg.phase === 2 && before === 1) {
    // Results: everyone's haul.
    const best = Math.max(0, ...mg.gold);
    const lines = g.heroes.filter((h) => !h.left).map((h) => `${h.name.toUpperCase()} +${mg.gold[h.index] ?? 0}${g.heroes.length > 1 && mg.gold[h.index] === best && best > 0 ? ' ★' : ''}`);
    g.vfx.banner("TIME'S UP!", lines.join(' · ') + ' GOLD', 2.6);
    g.vfx.sound('stageClear', NaN, NaN);
  }
  if (miniOver(mg)) {
    g.modes.mg = null;
    g.modes.holster = false;
    g.openPortal();
    const def = ROUTE_NODES[g.routeKind(g.stage + 1)];
    g.vfx.toast(`NEXT: ${def.name.toUpperCase()}`, 2.5);
  }
}

function shotFx(g: Game, h: Hero, tx: number, tz: number, hit: boolean): void {
  const p = h.player;
  const m = { x: 0, z: 0 };
  p.muzzle(m);
  g.vfx.star(m.x, 1.05, m.z, 0.9, '#ffffff', 0.08);
  // A dotted tracer: a few sparks along the line.
  const dx = tx - m.x;
  const dz = tz - m.z;
  const d = Math.hypot(dx, dz) || 1;
  for (let k = 1; k <= 4; k++) {
    const f = k / 5;
    g.vfx.burst(m.x + dx * f, 1.05, m.z + dz * f, { count: 1, color: '#fff35c', color2: '#ffcd75', speed: [0, 0.3], size: [0.12, 0.16], life: [0.08, 0.14], dir: { x: dx / d, z: dz / d, spread: 0.1 } });
  }
  if (hit) g.vfx.star(tx, 1.3, tz, 1.4, '#fff35c', 0.12);
  g.vfx.sound('shoot', p.x, p.z);
}

// ------------------------------------------------------------------ net

/** Snapshot field `md` (null when nothing is on). */
export function modesNet(this: Game): Record<string, unknown> | null {
  const M = this.modes;
  if (!M.rhythm && !M.pacifist && !M.mg) return null;
  return {
    rh: M.rhythm ? clockNet(M.clock, M.rt) : 0,
    ob: M.rhythm ? M.onBeat.slice() : 0,
    pc: M.pacifist ? [Math.round(pacifistLeft(this.director.time, this.director.duration) * 10) / 10, M.pacKills.slice()] : 0,
    mg: M.mg ? miniNet(M.mg) : 0,
  };
}

/** Client: the host's `md`. */
export function applyModesNet(this: Game, raw: unknown): void {
  const M = this.modes;
  const m = (raw ?? null) as Record<string, unknown> | null;
  const rh = m?.rh as number[] | 0 | undefined;
  if (Array.isArray(rh) && rh.length >= 4) {
    M.rhythm = true;
    M.clock.bpm = Number(rh[0]) || 120;
    M.clock.t0 = Number(rh[1]) || 0;
    M.clock.b0 = Number(rh[2]) || 0;
    const t = Number(rh[3]) || 0;
    // Follow the host's clock: jump when far off, else ease in (steps keep it moving between snapshots).
    if (!M.netSeen || Math.abs(t - M.rt) > 0.25) M.rt = t;
    else M.rt += (t - M.rt) * 0.3;
    M.netSeen = true;
    M.netRt = t;
    M.beat = beatAt(M.clock, M.rt);
    const ob = m?.ob;
    if (Array.isArray(ob)) M.onBeat = ob.map(Number);
  } else {
    M.rhythm = false;
    M.netSeen = false;
  }
  const pc = m?.pc;
  M.pacifist = Array.isArray(pc);
  if (Array.isArray(pc)) {
    M.pacLeft = Number(pc[0]) || 0;
    M.pacKills = ((pc[1] as number[]) ?? []).map(Number);
  }
  M.mg = m?.mg ? miniFromNet(m.mg, M.mg) : null;
  M.holster = M.pacifist || !!M.mg;
}

/** Client step: the beat keeps moving between snapshots. */
export function modesLocal(this: Game, dt: number): void {
  const M = this.modes;
  if (!M.rhythm || !this.isCombatMode) return;
  // Run ahead of the last snapshot by a few steps at most (the host may be holding a hit-stop).
  M.rt = Math.min(M.rt + dt, M.netRt + 0.12);
  M.prevBeat = M.beat;
  M.beat = beatAt(M.clock, M.rt);
}

// ------------------------------------------------------------------ end of run (ghosts)

/** The run is over (bankAndShow): keep the weekly ghost if it's this week's best. */
export function modesRunEnd(this: Game): void {
  const M = this.modes;
  if (!M.rec) return;
  const g = M.rec.finish(shownScore(this), this.stage, this.runTime);
  M.rec = null;
  if (g.length < 5) return;
  if (ghostStore.keepMine(g)) this.hud.toast('NEW WEEKLY GHOST SAVED: EXTRAS > GHOST RACE TO SHARE IT', 4);
}

// ------------------------------------------------------------------ render

/** Drawing and HUD for everything above (every machine, every frame). */
export function renderModes(this: Game, dt: number): void {
  const M = this.modes;
  M.view ??= new ModesView(this.scene);
  M.hud ??= new ModesHud(this.reticle);
  M.screen ??= new GhostScreen(this);
  const combat = this.isCombatMode && this.mode !== 'title';
  const phase = beatPhase(M.beat);
  const rhythmOn = M.rhythm && combat;
  // Pull the music onto the game's beat (only while the stage song or boss theme the clock follows plays).
  if (rhythmOn) {
    const want = this.boss || this.netBoss ? bossTrack(this.stage) : biomeForStage(this.arenaStage).music;
    if (music.playing === want) music.alignBeat?.(phase, rhythmTuning.align);
  }
  const lp = this.hero.player.rig.root.position;
  M.view.renderFloor(rhythmOn, phase, Math.floor(M.beat), lp.x, lp.z, dt);
  M.view.renderMini(M.mg, dt);
  // Ghost: the rival's pose at this run time, on this stage.
  let ghost: { x: number; z: number; facing: number } | null = null;
  if (M.rival && ghostRun(this) && combat) {
    const pose = M.view.ghostPose(M.rival, this.runTime);
    if (pose.visible && pose.stage === this.stage) ghost = pose;
  }
  M.view.renderGhost(ghost, dt);
  M.hud.update(this, ghost, onBeat(M.beat, M.clock.bpm), phase);
}

// ------------------------------------------------------------------ autopilot

/**
 * The dev bot and attract mode (src/game/autopilot.ts): play the mini-game, and don't bother
 * aiming on the Pacifist road. Bends `mv` (the move); returns the aim target, null for none, or
 * undefined when this lane has no opinion.
 */
export function pilotModes(g: Game, mv: { mx: number; mz: number }): { x: number; z: number } | null | undefined {
  const mg = g.modes.mg;
  const p = g.player;
  if (mg) {
    if (mg.phase !== 1) {
      mv.mx = mg.cx - p.x;
      mv.mz = mg.cz - p.z;
      if (Math.hypot(mv.mx, mv.mz) < 1.5) mv.mx = mv.mz = 0;
      return null;
    }
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (const it of mg.items) {
      if (it.by !== -1 || it.kind === 2) continue;
      if (mg.kind === 'whack' && it.life - it.age < 0.25) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z) - (it.kind === 1 ? 4 : 0);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (mg.kind === 'gallery') {
      const d = Math.hypot(mg.cx - p.x, mg.cz - p.z);
      mv.mx = d > 2 ? mg.cx - p.x : 0;
      mv.mz = d > 2 ? mg.cz - p.z : 0;
      return best;
    }
    mv.mx = (best ?? { x: mg.cx }).x - p.x;
    mv.mz = (best ?? { z: mg.cz }).z - p.z;
    return null;
  }
  if (g.modes.pacifist && g.mode === 'fight') return null;
  return undefined;
}
