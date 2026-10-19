/**
 * World events (world-events lane): the field changes mid-stage. These are Game
 * methods (`this` is the Game), installed on the class as fields, e.g.
 * `updateWorldEvent = WorldEventsSys.updateWorldEvent;`. Pure plans, geometry
 * and timelines live in src/game/worldEvents.ts; stealth in ./stealth.ts; the
 * look in src/render/worldEventView.ts; the HUD panel in src/ui/worldEventHud.ts.
 *
 * Host/solo: rolls the stage's event (seeded), runs its timeline and all damage.
 * Snapshot: `we` = { k: kind index, t: event clock, p: plan numbers, d: done,
 * b: lava bombs, q: lava puddles, plus stealth fields }. Clients rebuild the
 * same holes and chasms from (k, p, t) and add/remove the same gap colliders
 * (walls grid rebuilt) as the host; they slow their own hero in flood water.
 */
import type { Game } from '../game';
import type { Enemy } from '../enemies';
import type { Hero } from '../hero';
import type { AABB } from '../../world/collision';
import { StaticBoxGrid } from '../../core/spatialHash';
import { biomeForStage } from '../../data/biomes';
import { isNightStage } from '../../render/biomeLook';
import { bossLike } from '../bossRules';
import { hazardTuning } from '../hazards';
import { SCAR_COLORS } from '../scars';
import { access, settings } from '../settings';
import { ARENA_SOURCE_NAMES, ENV_SOURCES } from './arena';
import { attractRunning } from './attract';
import { lookHooks, lookOverrides } from './look';
import {
  WORLD_EVENTS,
  WORLD_EVENT_KINDS,
  cellBox,
  collapseCrackAt,
  collapseFallAt,
  collapsePlan,
  eclipseBurstAt,
  eclipseNight,
  eventLength,
  eventSeed,
  floodDepth,
  floodLevel,
  floodPlan,
  flowerPhase,
  giantPlan,
  giantStep,
  giantStepTime,
  planWorldEvent,
  splitBoxes,
  splitPlan,
  stealthPlan,
  worldEventTuning as T,
  worldHooks,
  type WorldEventKind,
} from '../worldEvents';
import { WorldEventView } from '../../render/worldEventView';
import { WorldEventHud } from '../../ui/worldEventHud';
import { applyStealthNet, newStealth, stealthLure, stealthNet, stealthHidden, stealthLocal, updateStealth, type StealthState } from './stealth';

// Falls into the void, stomps and lava bombs are environmental kills (bonus score, ENV KILL popups, objective).
for (const s of ['void', 'stomp', 'volcano']) if (!ENV_SOURCES.includes(s)) ENV_SOURCES.push(s);
Object.assign(ARENA_SOURCE_NAMES, { void: 'The Void', stomp: 'Colossus', volcano: 'Lava Bombs' });

/** Test links / debug: force this stage's event (`at` = stage seconds; stealth always starts at 0). */
export const worldEventForce: { kind: WorldEventKind | null; at: number } = { kind: null, at: 2 };

/** One gap collider an event adds, from event time `at` on. */
export interface EventBox {
  key: string;
  box: AABB;
  at: number;
  on: boolean;
}

export interface LavaBomb {
  x: number;
  z: number;
  t: number;
  flight: number;
}

export interface WorldEvent {
  kind: WorldEventKind;
  /** Event clock (s): runs while the stage is being fought. */
  t: number;
  /** Plan numbers (see the plan functions in src/game/worldEvents.ts). */
  p: number[];
  /** Its action is over (holes and chasms stay until the stage ends). */
  done: boolean;
  boxes: EventBox[];
  /** Host: how far the timeline has been handled (waves, steps, bursts). */
  fired: number;
  tick: number;
  bombs: LavaBomb[];
  /** Lava puddles: x, z, life left. */
  puddles: { x: number; z: number; life: number }[];
  stealth: StealthState | null;
}

interface WorldRun {
  stage: number;
  arena: unknown;
  planned: { kind: WorldEventKind; at: number } | null;
  prev: WorldEventKind | null;
  ev: WorldEvent | null;
  /** Enemies made faster by the eclipse (and their uid, so a pooled enemy isn't slowed back). */
  boosted: Map<Enemy, number>;
  /** Gap colliders this lane has in `arena.colliders`. */
  added: Set<AABB>;
  addedArena: unknown;
  view: WorldEventView | null;
  hud: WorldEventHud | null;
  hooked: boolean;
  netKey: string;
  pos: { x: number; z: number };
  near: Enemy[];
}

const runs = new WeakMap<Game, WorldRun>();

export function worldRun(g: Game): WorldRun {
  let W = runs.get(g);
  if (!W) {
    W = { stage: -1, arena: null, planned: null, prev: null, ev: null, boosted: new Map(), added: new Set(), addedArena: null, view: null, hud: null, hooked: false, netKey: '', pos: { x: 0, z: 0 }, near: [] };
    runs.set(g, W);
  }
  return W;
}

/** The event running this stage (null = none), for other systems and tests. */
export function worldEventOf(g: Game): WorldEvent | null {
  return runs.get(g)?.ev ?? null;
}

// ------------------------------------------------------------------ flow

/** Host/solo step (called in Game.simulate after the arena and wind). */
export function updateWorldEvent(this: Game, dt: number): void {
  const W = worldRun(this);
  if (W.stage !== this.stage || W.arena !== this.arena) newStage(this, W);
  if (this.mode === 'title' && !attractRunning(this)) return;
  hook(this, W);
  const ev = W.ev;
  if (!ev) {
    const pl = W.planned;
    if (pl && this.mode === 'fight' && !this.director.bossSpawned && this.aliveHeroes.length && this.director.time >= pl.at && !this.runEvents.event) {
      if (this.director.time > Math.max(pl.at + 1, this.director.duration * T.latest)) W.planned = null; // too late now
      else startEvent(this, W, pl.kind);
    }
    return;
  }
  if (this.mode === 'fight' && this.aliveHeroes.length) {
    const t0 = ev.t;
    ev.t += dt;
    tickEvent(this, W, ev, t0, dt);
  }
  syncColliders(this, W);
  rescue(this, ev, this.hero); // remote heroes are moved (and rescued) by their own client
}

/**
 * A hero whose centre ends up over an open hole (it dropped under them, or they were squeezed in
 * where two sections meet) steps to the nearest solid spot: thrown clear, never dropped.
 */
function rescue(g: Game, ev: WorldEvent, h: Hero): void {
  const p = h.player;
  if (p.dead || h.left || !ev.boxes.length) return;
  const over = (x: number, z: number, pad: number) => ev.boxes.some((b) => b.on && x > b.box.minX - pad && x < b.box.maxX + pad && z > b.box.minZ - pad && z < b.box.maxZ + pad);
  if (!over(p.x, p.z, -0.02)) return;
  for (let d = 0.5; d <= 24; d += 0.5) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (over(x, z, p.radius + 0.05) || g.walls.hitCircle(x, z, p.radius)) continue;
      p.teleport(x, z);
      return;
    }
  }
}

function newStage(g: Game, W: WorldRun): void {
  clearEvent(g, W);
  W.stage = g.stage;
  W.arena = g.arena;
  W.planned = null;
  if (g.role === 'client' || !T.enabled || g.pvp || g.onboarding.training || g.runMode === 'bossrush' || attractRunning(g) || g.mode === 'title') return;
  const biome = biomeForStage(g.arenaStage);
  const night = isNightStage(g.arenaStage) || (biome.night ?? 0) >= 0.5;
  let pl: WorldRun['planned'] = null;
  const f = worldEventForce;
  if (f.kind) pl = { kind: f.kind, at: f.kind === 'stealth' ? 0 : f.at };
  else if (g.routeKind() === 'stealth') pl = { kind: 'stealth', at: 0 };
  else {
    const r = planWorldEvent(g.arena.seed, g.stage, biome.id, night, W.prev);
    if (r) pl = { kind: r.kind, at: r.kind === 'stealth' ? 0 : r.at * g.director.duration };
  }
  W.planned = pl;
  if (pl) {
    g.runEvents.suppressEvent(); // one big event per stage
    W.prev = pl.kind;
  }
}

/** Team centre (alive heroes). */
function teamCentre(g: Game, out: { x: number; z: number }): { x: number; z: number } {
  let n = 0;
  out.x = out.z = 0;
  for (const h of g.aliveHeroes) {
    out.x += h.player.x;
    out.z += h.player.z;
    n++;
  }
  if (n) {
    out.x /= n;
    out.z /= n;
  }
  return out;
}

/** Host: start an event now (the test links call this too). */
export function startWorldEvent(g: Game, kind: WorldEventKind): void {
  const W = worldRun(g);
  if (W.stage !== g.stage || W.arena !== g.arena) newStage(g, W);
  clearEvent(g, W);
  startEvent(g, W, kind);
}

function startEvent(g: Game, W: WorldRun, kind: WorldEventKind): void {
  W.planned = null;
  const c = teamCentre(g, W.pos);
  const seed = eventSeed(g.arena.seed, g.stage) ^ (WORLD_EVENT_KINDS.indexOf(kind) * 7919);
  const half = g.arena.halfSize;
  const R = (v: number) => Math.round(v * 100) / 100;
  let p: number[] = [];
  switch (kind) {
    case 'collapse': {
      const avoid = (x: number, z: number, r: number) => keepClear(g, x, z, r);
      p = collapsePlan(seed, c.x, c.z, half, avoid);
      break;
    }
    case 'split':
      p = splitPlan(seed, c.x, c.z, half).map(R);
      break;
    case 'flood':
      p = floodPlan(seed, c.x, c.z, half).map(R);
      break;
    case 'giant':
      p = giantPlan(seed, c.x, c.z).map((v) => Math.round(v * 1000) / 1000);
      break;
    case 'flower': {
      const s = flowerSpot(g, seed, c.x, c.z);
      p = [R(s.x), R(s.z)];
      break;
    }
    case 'volcano': {
      // At the shore on the team's side of the island.
      const a = Math.atan2(c.z, c.x) + ((seed % 1000) / 1000 - 0.5) * 1.2;
      const d = half + 6;
      p = [R(Math.cos(a) * d), R(Math.sin(a) * d)];
      break;
    }
    case 'stealth':
      p = stealthPlan(seed, half, (x, z, r) => g.walls.hitCircle(x, z, r));
      break;
    case 'eclipse':
      break;
  }
  const ev = makeEvent(kind, p, half);
  W.ev = ev;
  if (kind === 'stealth') ev.stealth = newStealth(ev.p);
  const def = WORLD_EVENTS[kind];
  g.vfx.banner(def.name, def.sub, 2.4);
  g.vfx.sound(kind === 'flower' ? 'jingle' : 'ominous', NaN, NaN);
  if (kind !== 'flower' && kind !== 'stealth') g.vfx.shake(NaN, NaN, 0.25);
}

/** Things that must stay reachable: toys, objective pieces, chests, barrels, the start plaza. */
function keepClear(g: Game, x: number, z: number, r: number): boolean {
  const near = (o: { x: number; z: number }, pad: number) => Math.abs(o.x - x) < r + pad && Math.abs(o.z - z) < r + pad;
  const t = g.toys;
  if (t.pads.some((o) => near(o, 1.5)) || t.pads.some((o) => near({ x: o.tx, z: o.tz }, 1.5)) || t.turrets.some((o) => near(o, 1.5))) return true;
  if (t.totems.some((o) => near(o, 1.5)) || t.shards.some((o) => near(o, 1)) || (t.beacon && near(t.beacon, 5))) return true;
  if (g.chests.list.some((o) => near(o, 1.2)) || g.barrels.list.some((o) => o.alive && near(o, 0.8))) return true;
  if (t.props.some((o) => o.alive && o.def.kind === 'pillar' && near(o.def, 1.5))) return true;
  return false;
}

/** A walkable spot 8-13 m from the team for the flower. */
function flowerSpot(g: Game, seed: number, cx: number, cz: number): { x: number; z: number } {
  const lim = g.arena.halfSize - 6;
  for (let k = 0; k < 24; k++) {
    const a = ((seed >>> (k % 24)) % 628) / 100 + k * 2.39996;
    const d = T.flowerDistMin + ((seed >>> 3) % 100) / 100 * (T.flowerDistMax - T.flowerDistMin);
    const x = cx + Math.cos(a) * d;
    const z = cz + Math.sin(a) * d;
    if (Math.abs(x) > lim || Math.abs(z) > lim || g.walls.hitCircle(x, z, T.flowerR * 0.6)) continue;
    return { x, z };
  }
  return { x: cx, z: cz };
}

/** Build an event record (host and client) from its kind and plan. */
export function makeEvent(kind: WorldEventKind, p: number[], half: number): WorldEvent {
  const boxes: EventBox[] = [];
  if (kind === 'collapse') {
    for (let i = 0; i + 2 < p.length; i += 3) boxes.push({ key: `c${p[i]},${p[i + 1]}`, box: cellBox(p[i], p[i + 1]), at: collapseFallAt(p[i + 2]), on: false });
  } else if (kind === 'split') {
    splitBoxes(p, half).forEach((box, i) => boxes.push({ key: `s${i}`, box, at: T.splitWarn, on: false }));
  }
  return { kind, t: 0, p, done: false, boxes, fired: 0, tick: 0, bombs: [], puddles: [], stealth: null };
}

function clearEvent(g: Game, W: WorldRun): void {
  const ev = W.ev;
  W.ev = null;
  if (ev) for (const b of ev.boxes) b.on = false;
  if (ev?.stealth) ev.stealth.active = false;
  syncColliders(g, W);
  restoreBoost(W);
  W.netKey = '';
}

/** Add/remove this lane's gap colliders to match the event clock; rebuild the walls grid on a change. */
export function syncColliders(g: Game, W: WorldRun): void {
  if (W.addedArena !== g.arena) {
    W.added.clear(); // a new arena: the old boxes went with the old one
    W.addedArena = g.arena;
  }
  let changed = false;
  const ev = W.ev;
  const cols = g.arena.colliders;
  if (ev) {
    for (const b of ev.boxes) {
      const want = ev.t >= b.at;
      if (want && !W.added.has(b.box)) {
        cols.push(b.box);
        W.added.add(b.box);
        changed = true;
      }
      b.on = want;
    }
  }
  for (const box of W.added) {
    if (ev && ev.boxes.some((b) => b.box === box && b.on)) continue;
    const k = cols.indexOf(box);
    if (k >= 0) cols.splice(k, 1);
    W.added.delete(box);
    changed = true;
  }
  if (changed) g.walls = new StaticBoxGrid(cols);
}

function hook(g: Game, W: WorldRun): void {
  if (W.hooked) return;
  W.hooked = true;
  g.enemyCtx.lure = (e) => {
    const ev = runs.get(g)?.ev;
    return ev?.stealth && !ev.done ? stealthLure(g, ev.stealth, e) : null;
  };
  // Auto weapons, pets and turrets hold fire at unaware enemies (looked up per enemy, so any Game works).
  worldHooks.hidden = stealthHidden;
}

// ------------------------------------------------------------------ the timelines (host)

const pt = { x: 0, z: 0 };

function tickEvent(g: Game, W: WorldRun, ev: WorldEvent, t0: number, dt: number): void {
  const t = ev.t;
  const crossed = (at: number) => t0 < at && t >= at;
  switch (ev.kind) {
    case 'collapse':
      tickCollapse(g, ev, t0, t, dt, crossed);
      break;
    case 'split':
      tickSplit(g, ev, t, dt, crossed);
      break;
    case 'flood':
      tickFlood(g, W, ev, dt);
      break;
    case 'giant':
      tickGiant(g, ev, crossed);
      break;
    case 'eclipse':
      tickEclipse(g, W, ev, crossed);
      break;
    case 'flower':
      tickFlower(g, ev, dt, crossed);
      break;
    case 'volcano':
      tickVolcano(g, ev, dt);
      break;
    case 'stealth':
      if (ev.stealth && !ev.done) {
        if (g.director.bossSpawned) endStealth(g, ev);
        else updateStealth(g, ev.stealth, ev.t, dt);
      }
      break;
  }
  if (!ev.done && ev.kind !== 'stealth' && t >= eventLength(ev.kind)) {
    ev.done = true;
    if (ev.kind === 'flood') g.vfx.toast('THE WATER DRAINS AWAY', 2);
  }
}

function endStealth(g: Game, ev: WorldEvent): void {
  ev.done = true;
  if (ev.stealth) ev.stealth.active = false;
  g.vfx.toast('THE BOSS HEARS EVERYTHING: STEALTH OVER', 3);
}

/** An enemy drops into a hole or chasm (elites and the Reaper only lose a share of their life; bosses never fall). */
function dropEnemy(g: Game, e: Enemy): void {
  if (!e.active || e.hp <= 0 || bossLike(e) || e.def.hidden || e.pvpOwner >= 0) return;
  const tough = e.elite || e.def.behavior === 'reaper';
  e.kx = e.kz = 0;
  g.vfx.num(e.x, 2.2, e.z, 'BYE-BYE!', 'crit');
  g.vfx.burst(e.x, 0.2, e.z, { count: 8, color: e.def.bodyColor, color2: '#1a1c2c', speed: [1, 3], size: [0.2, 0.4], life: [0.4, 0.7], up: -3, gravity: 8, drag: 2 });
  g.envHit(e, 'void', tough ? e.maxHp * hazardTuning.eliteFrac : e.hp + e.shield + 1);
}

function inBox(b: AABB, x: number, z: number, pad = 0): boolean {
  return x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;
}

/** A section or chasm opens: what stands on it falls (enemies) or is thrown clear (heroes). */
function openGround(g: Game, box: AABB, heroDmg: number, cause: string): void {
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  for (const e of g.enemies.list) if (e.active && inBox(box, e.x, e.z, -e.radius * 0.3)) dropEnemy(g, e);
  for (const h of g.aliveHeroes) {
    const p = h.player;
    if (!inBox(box, p.x, p.z, p.radius * 0.5)) continue;
    // Thrown to the nearest edge (the gap collider does the push); a hit, never a fall.
    const ex = Math.min(Math.abs(p.x - box.minX), Math.abs(box.maxX - p.x));
    const ez = Math.min(Math.abs(p.z - box.minZ), Math.abs(box.maxZ - p.z));
    const fx = ex < ez ? (p.x < cx ? cx + 99 : cx - 99) : p.x;
    const fz = ex < ez ? p.z : p.z < cz ? cz + 99 : cz - 99;
    g.hurtHero(h, heroDmg * g.director.dmgMul, fx, fz, null, cause);
  }
  g.barrels.igniteNear(cx, cz, Math.max(box.maxX - box.minX, box.maxZ - box.minZ) * 0.6, 0);
}

function tickCollapse(g: Game, ev: WorldEvent, t0: number, t: number, dt: number, crossed: (at: number) => boolean): void {
  const p = ev.p;
  for (let w = 0; w < T.waves; w++) {
    if (crossed(collapseCrackAt(w))) {
      g.vfx.sound('coverBreak', NaN, NaN, 0.6);
      g.vfx.shake(NaN, NaN, 0.18);
      if (w === 0) g.vfx.toast('CRACKS! GET OFF THEM!', 2);
    }
    const fall = collapseFallAt(w);
    // Rumble while cracking: dust puffs from the cracks.
    if (t > collapseCrackAt(w) && t < fall && Math.floor(t0 * 3) !== Math.floor(t * 3)) {
      for (let i = 0; i + 2 < p.length; i += 3) {
        if (p[i + 2] !== w) continue;
        g.vfx.burst(p[i] + (g.rng.next() - 0.5) * T.cell * 0.8, 0.2, p[i + 1] + (g.rng.next() - 0.5) * T.cell * 0.8, { count: 3, color: '#9a8a78', color2: '#5a4c44', speed: [0.5, 1.6], size: [0.18, 0.32], life: [0.3, 0.6], up: 2, gravity: 4, dust: 1 });
      }
    }
    if (crossed(fall)) {
      for (const b of ev.boxes) if (b.at === fall) openGround(g, b.box, T.collapseHeroDmg, 'The Void');
      for (let i = 0; i + 2 < p.length; i += 3) {
        if (p[i + 2] !== w) continue;
        g.vfx.burst(p[i], 0.3, p[i + 1], { count: 16, color: '#7a6a5a', color2: '#3a2c2c', speed: [2, 6], size: [0.25, 0.5], life: [0.4, 0.8], up: 5, gravity: 14, debris: 4, dust: 3 });
        g.vfx.sound('explode', p[i], p[i + 1], 0.7);
      }
      g.vfx.shake(NaN, NaN, 0.35);
      g.vfx.sound('bossSlam', NaN, NaN, 0.8);
    }
  }
  void dt;
}

function tickSplit(g: Game, ev: WorldEvent, t: number, dt: number, crossed: (at: number) => boolean): void {
  if (t < T.splitWarn && (ev.tick -= dt) <= 0) {
    ev.tick = 0.8;
    g.vfx.shake(NaN, NaN, 0.12);
    g.vfx.sound('coverBreak', NaN, NaN, 0.5);
  }
  if (crossed(T.splitWarn)) {
    for (const b of ev.boxes) openGround(g, b.box, T.splitHeroDmg, 'The Chasm');
    const [axis, pos] = ev.p;
    // Bursts along the opening, near the team only (effects traffic).
    teamCentre(g, pt);
    const along = axis === 0 ? pt.x : pt.z;
    for (let k = -4; k <= 4; k++) {
      const a = along + k * 3.5;
      const x = axis === 0 ? a : pos;
      const z = axis === 0 ? pos : a;
      if (g.walls.hitSolid(x, z, 0.2)) continue;
      g.vfx.burst(x, 0.3, z, { count: 6, color: '#7a6a5a', color2: '#3a2c2c', speed: [2, 5], size: [0.25, 0.45], life: [0.4, 0.8], up: 5, gravity: 14, debris: 2, dust: 2 });
    }
    g.vfx.shake(NaN, NaN, 0.5);
    g.vfx.sound('bossSlam', NaN, NaN, 0.7);
  }
}

function tickFlood(g: Game, W: WorldRun, ev: WorldEvent, dt: number): void {
  const level = floodLevel(ev.t);
  if (level <= 0) return;
  const p = ev.p;
  // Enemies wade (slowed); burning ones are doused.
  for (const e of g.enemies.list) {
    if (!e.alive || e.def.boss || e.hopY > 0) continue;
    const d = floodDepth(p, level, e.x, e.z);
    if (d <= 0) continue;
    e.slowT = Math.max(e.slowT, 0.15);
    e.slowAmt = Math.max(e.slowAmt, T.floodEnemySlow * d);
    if (e.burnT > 0) {
      e.burnT = 0;
      if (g.rng.chance(0.3)) g.vfx.burst(e.x, 0.8, e.z, { count: 3, color: '#f4f4f4', color2: '#94b0c2', speed: [0.5, 1.5], size: [0.25, 0.4], life: [0.4, 0.7], up: 3, drag: 2 });
    }
  }
  // Shock arcs through the water to other wet enemies.
  if ((ev.tick -= dt) <= 0) {
    ev.tick = T.floodShockEvery;
    let n = 0;
    for (const e of g.enemies.list) {
      if (n >= 16) break;
      if (!e.alive || e.shockT <= 0 || floodDepth(p, level, e.x, e.z) <= 0) continue;
      for (const o of g.enemiesInRadius(e.x, e.z, T.floodShockR, W.near)) {
        if (o === e || o.shockT > 0 || floodDepth(p, level, o.x, o.z) <= 0) continue;
        g.shock(o, nearestHero(g, o.x, o.z));
        g.vfx.burst(o.x, 0.6, o.z, { count: 3, color: '#73eff7', color2: '#f4f4f4', speed: [1, 3], size: [0.1, 0.2], life: [0.15, 0.3], arc: [e.x, e.z] });
        if (++n >= 16) break;
      }
    }
  }
  // This machine's hero wades (clients slow their own hero in worldEventLocal).
  wade(g.hero, level, ev.p);
}

/** Flood water slows the hero this machine moves (dashing powers through). */
function wade(h: Hero, level: number, p: number[]): void {
  const pl = h.player;
  if (pl.dead || pl.dashing || h.left) return;
  const d = floodDepth(p, level, pl.x, pl.z);
  if (d <= 0) return;
  const mul = 1 - (1 - T.floodHeroSlow) * d;
  pl.pos.x = pl.prev.x + (pl.pos.x - pl.prev.x) * mul;
  pl.pos.z = pl.prev.z + (pl.pos.z - pl.prev.z) * mul;
}

function tickGiant(g: Game, ev: WorldEvent, crossed: (at: number) => boolean): void {
  const half = g.arena.halfSize;
  for (let i = 0; i < T.giantSteps; i++) {
    const at = giantStepTime(i);
    giantStep(ev.p, i, pt);
    const inField = Math.abs(pt.x) < half - 1 && Math.abs(pt.z) < half - 1;
    if (crossed(at - T.giantWarn) && inField) {
      g.vfx.zone(pt.x, pt.z, T.giantR, T.giantWarn);
      if (i % 2 === 0) g.vfx.sound('bossWindup', pt.x, pt.z); // threat bus: points at the next footprint
    }
    if (!crossed(at)) continue;
    g.vfx.shake(NaN, NaN, 0.1); // every step rumbles the whole field
    g.vfx.sound('bossSlam', pt.x, pt.z, 0.6);
    if (!inField) {
      g.vfx.burst(pt.x, 0.2, pt.z, { count: 14, color: '#f4f4f4', color2: '#41a6f6', speed: [3, 8], size: [0.25, 0.5], life: [0.5, 0.9], up: 9, gravity: 16 });
      continue;
    }
    stomp(g, pt.x, pt.z);
  }
}

function stomp(g: Game, x: number, z: number): void {
  const R = T.giantR;
  g.vfx.shake(x, z, 0.9);
  g.vfx.ring(x, z, 1, R * 2.6, '#94b0c2', 0.4);
  g.vfx.burst(x, 0.3, z, { count: 22, color: '#c2b8a8', color2: '#6a5c50', speed: [3, 9], size: [0.25, 0.55], life: [0.4, 0.9], up: 6, gravity: 14, debris: 6, dust: 5 });
  g.vfx.scar(x, z, R * 0.9, SCAR_COLORS.crater, 25);
  for (const h of g.aliveHeroes) {
    const d = Math.hypot(h.player.x - x, h.player.z - z);
    if (d < R + h.player.radius) g.hurtHero(h, T.giantHeroDmg * g.director.dmgMul, x, z, null, 'The Colossus');
  }
  for (const e of g.enemiesInRadius(x, z, T.giantKnockR, [])) {
    const dx = e.x - x;
    const dz = e.z - z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < R && !bossLike(e) && !e.def.hidden) {
      g.vfx.num(e.x, 2, e.z, 'SQUASH!', 'crit');
      g.envHit(e, 'stomp', e.elite || e.def.behavior === 'reaper' ? e.maxHp * hazardTuning.eliteFrac : e.hp + e.shield + 1);
    } else if (!e.def.boss) {
      const k = 16 * (1 - d / T.giantKnockR) + 4;
      e.kx += (dx / d) * k;
      e.kz += (dz / d) * k;
    }
  }
  g.barrels.igniteNear(x, z, R, 0);
}

function tickEclipse(g: Game, W: WorldRun, ev: WorldEvent, crossed: (at: number) => boolean): void {
  const burst = eclipseBurstAt();
  if (ev.t < burst) {
    // In the dark, enemies hunt faster (new spawns too).
    if (eclipseNight(ev.t) > 0.6) {
      for (const e of g.enemies.list) {
        if (!e.active || e.def.boss || W.boosted.get(e) === e.uid) continue;
        e.speedMul *= 1 + T.eclipseSpeed;
        W.boosted.set(e, e.uid);
      }
    }
    if (crossed(T.eclipseFade)) g.vfx.toast('THEY MOVE FASTER IN THE DARK', 2.2);
    return;
  }
  if (!crossed(burst)) return;
  restoreBoost(W);
  g.vfx.banner('THE SUN RETURNS!', 'ENEMIES DAZZLED', 1.6);
  g.vfx.flash(0.8);
  g.vfx.sound('powerUp', NaN, NaN);
  for (const h of g.aliveHeroes) g.vfx.ring(h.player.x, h.player.z, 1, 40, '#ffcd75', 0.6);
  for (const e of g.enemies.list) {
    if (!e.alive || e.def.boss) continue;
    let near = false;
    for (const h of g.aliveHeroes) if (Math.abs(h.player.x - e.x) < T.eclipseRange && Math.abs(h.player.z - e.z) < T.eclipseRange) near = true;
    if (!near) continue;
    e.slowT = Math.max(e.slowT, T.eclipseDazzle);
    e.slowAmt = Math.max(e.slowAmt, T.eclipseDazzleSlow);
    e.flash = Math.max(e.flash, 0.15);
  }
}

function restoreBoost(W: WorldRun): void {
  for (const [e, uid] of W.boosted) if (e.active && e.uid === uid) e.speedMul /= 1 + T.eclipseSpeed;
  W.boosted.clear();
}

function tickFlower(g: Game, ev: WorldEvent, dt: number, crossed: (at: number) => boolean): void {
  const [x, z] = ev.p;
  const ph = flowerPhase(ev.t);
  if (crossed(T.flowerGrow)) {
    g.vfx.toast('THE FLOWER BLOOMS! STAND IN IT TO HEAL', 2.6);
    g.vfx.sound('heal', x, z);
    g.vfx.ring(x, z, 1, T.flowerR * 2.4, '#a7f070', 0.6);
    g.vfx.burst(x, 2.5, z, { count: 30, color: '#ffcd75', color2: '#f4f4f4', speed: [2, 6], size: [0.15, 0.3], life: [0.6, 1.1], up: 5, gravity: 3, drag: 1 });
  }
  if (crossed(T.flowerGrow + T.flowerBloom)) g.vfx.toast('THE FLOWER WILTS', 1.8);
  if (!ph.bloom) return;
  const pulse = (ev.tick -= dt) <= 0;
  if (pulse) ev.tick = 1;
  for (const h of g.aliveHeroes) {
    const p = h.player;
    if (Math.hypot(p.x - x, p.z - z) > T.flowerR) continue;
    const got = p.heal(p.maxHp * T.flowerHeal * dt);
    void got;
    if (pulse) g.vfx.num(p.x, 2.4, p.z, `+${Math.round(p.maxHp * T.flowerHeal)}`, 'heal');
  }
  for (const e of g.enemiesInRadius(x, z, T.flowerR, [])) {
    if (e.def.boss) continue;
    e.slowT = Math.max(e.slowT, 0.2);
    e.slowAmt = Math.max(e.slowAmt, T.flowerSlow);
  }
}

function tickVolcano(g: Game, ev: WorldEvent, dt: number): void {
  const t = ev.t;
  if (t < T.volcanoWarn) {
    if ((ev.tick -= dt) <= 0) {
      ev.tick = 0.7;
      g.vfx.shake(NaN, NaN, 0.1);
    }
  } else if (t < T.volcanoWarn + T.volcanoLen && (ev.tick -= dt) <= 0) {
    ev.tick = T.bombEvery;
    const hs = g.aliveHeroes;
    if (hs.length) {
      const h = g.rng.pick(hs);
      const a = g.rng.next() * Math.PI * 2;
      const d = g.rng.range(1.5, 8);
      const x = h.player.x + Math.cos(a) * d;
      const z = h.player.z + Math.sin(a) * d;
      const lim = g.arena.halfSize - 1.5;
      if (Math.abs(x) < lim && Math.abs(z) < lim) {
        ev.bombs.push({ x, z, t: T.bombFlight, flight: T.bombFlight });
        g.vfx.zone(x, z, T.bombR, T.bombFlight);
        if (g.rng.chance(0.35)) g.vfx.sound('threatMortar', x, z); // whistle on the threat bus (SOUND ARROWS)
      }
    }
  }
  for (let i = ev.bombs.length - 1; i >= 0; i--) {
    const b = ev.bombs[i];
    if ((b.t -= dt) > 0) continue;
    ev.bombs.splice(i, 1);
    lavaBomb(g, ev, b.x, b.z);
  }
  for (let i = ev.puddles.length - 1; i >= 0; i--) if ((ev.puddles[i].life -= dt) <= 0) ev.puddles.splice(i, 1);
  // Puddles burn whoever stands in them.
  if (ev.puddles.length && (ev.fired += dt) >= T.puddleTick) {
    ev.fired = 0;
    for (const q of ev.puddles) {
      for (const h of g.aliveHeroes) if (Math.hypot(h.player.x - q.x, h.player.z - q.z) < T.puddleR + h.player.radius * 0.5) g.hurtHero(h, T.puddleDmg * g.director.dmgMul, q.x, q.z, null, 'Lava');
      for (const e of g.enemiesInRadius(q.x, q.z, T.puddleR, [])) if (!e.def.boss) g.ignite(e, 6 + 2 * g.stage, nearestHero(g, e.x, e.z));
    }
  }
}

function lavaBomb(g: Game, ev: WorldEvent, x: number, z: number): void {
  const R = T.bombR;
  g.vfx.sound('explode', x, z);
  g.vfx.shake(x, z, 0.35);
  g.vfx.ring(x, z, 1, R * 2.2, '#ff7a2f', 0.3);
  g.vfx.burst(x, 0.6, z, { count: 16, color: '#ff7a2f', color2: '#ffcd75', speed: [3, 8], size: [0.2, 0.4], life: [0.3, 0.7], up: 6, gravity: 14, smoke: 3, sparks: 6, scorch: 0 });
  g.vfx.scar(x, z, R * 0.7, SCAR_COLORS.scorch, 14);
  for (const h of g.aliveHeroes) if (Math.hypot(h.player.x - x, h.player.z - z) < R + h.player.radius) g.hurtHero(h, T.bombHeroDmg * g.director.dmgMul, x, z, null, 'Lava Bomb');
  for (const e of g.enemiesInRadius(x, z, R, []).slice()) {
    if (e.def.boss) continue;
    const by = nearestHero(g, e.x, e.z);
    g.envHit(e, 'volcano', T.bombFoe * g.director.hpMul);
    if (e.active && e.hp > 0) g.ignite(e, 6 + 2 * g.stage, by);
  }
  g.barrels.igniteNear(x, z, R, 0);
  if (!g.walls.hitCircle(x, z, 0.5)) ev.puddles.push({ x, z, life: T.puddleLife });
}

function nearestHero(g: Game, x: number, z: number): Hero {
  let best = g.hero;
  let bd = Infinity;
  for (const h of g.aliveHeroes) {
    const d = (h.player.x - x) ** 2 + (h.player.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

// ------------------------------------------------------------------ net

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Snapshot: `we` holds what rarely changes (kind, plan, done), so the compact snapshot codec
 * leaves it out of most snapshots; `wt` (worldEventLive) the clock and the moving parts.
 */
export function worldEventNet(this: Game): Record<string, unknown> | null {
  const ev = worldRun(this).ev;
  return ev ? { k: WORLD_EVENT_KINDS.indexOf(ev.kind), p: ev.p, d: ev.done ? 1 : 0 } : null;
}

/** Snapshot `wt` for one client: event clock, lava bombs and puddles, Night Raid state near their hero. */
export function worldEventLive(this: Game, forHero: Hero): Record<string, unknown> | null {
  const ev = worldRun(this).ev;
  if (!ev) return null;
  const out: Record<string, unknown> = { t: r2(ev.t) };
  if (ev.kind === 'volcano') {
    const b: number[] = [];
    for (const x of ev.bombs) b.push(r2(x.x), r2(x.z), r2(x.t), r2(x.flight));
    const q: number[] = [];
    for (const x of ev.puddles) q.push(r2(x.x), r2(x.z), r2(x.life));
    out.b = b;
    out.q = q;
  }
  if (ev.stealth) Object.assign(out, stealthNet(this, ev.stealth, forHero));
  return out;
}

/** Client: mirror the host's event from the snapshot. */
export function applyWorldEventNet(this: Game, raw: unknown, live?: unknown): void {
  const W = worldRun(this);
  if (W.arena !== this.arena) {
    W.arena = this.arena;
    W.ev = null;
    W.netKey = '';
  }
  W.stage = this.stage;
  const m = raw ? { ...(raw as Record<string, unknown>), ...((live as Record<string, unknown> | null) ?? {}) } : null;
  if (!m) {
    if (W.ev) clearEvent(this, W);
    return;
  }
  const kind = WORLD_EVENT_KINDS[Number(m.k)];
  const p = (m.p as number[]) ?? [];
  if (!kind) return;
  const key = `${this.stage}|${kind}|${p.join(',')}`;
  if (!W.ev || W.netKey !== key) {
    if (W.ev) clearEvent(this, W);
    W.ev = makeEvent(kind, p.slice(), this.arena.halfSize);
    if (kind === 'stealth') W.ev.stealth = newStealth(W.ev.p);
    W.netKey = key;
  }
  const ev = W.ev;
  const t = Number(m.t) || 0;
  if (Math.abs(ev.t - t) > 0.25) ev.t = t; // otherwise the local clock runs on smoothly between snapshots
  ev.done = !!m.d;
  if (kind === 'volcano') {
    const b = (m.b as number[]) ?? [];
    ev.bombs.length = 0;
    for (let i = 0; i + 3 < b.length; i += 4) ev.bombs.push({ x: b[i], z: b[i + 1], t: b[i + 2], flight: b[i + 3] });
    const q = (m.q as number[]) ?? [];
    ev.puddles.length = 0;
    for (let i = 0; i + 2 < q.length; i += 3) ev.puddles.push({ x: q[i], z: q[i + 1], life: q[i + 2] });
  }
  if (ev.stealth) applyStealthNet(this, ev.stealth, m);
  syncColliders(this, W);
}

/** Client step: the event clock, colliders, wading and the stealth meter for this machine's hero. */
export function worldEventLocal(this: Game, dt: number): void {
  const W = worldRun(this);
  const ev = W.ev;
  if (!ev || W.arena !== this.arena) return;
  if (this.mode === 'fight') {
    ev.t += dt;
    for (const b of ev.bombs) b.t -= dt;
  }
  syncColliders(this, W);
  rescue(this, ev, this.hero);
  if (ev.kind === 'flood') wade(this.hero, floodLevel(ev.t), ev.p);
  if (ev.stealth) stealthLocal(this, ev.stealth, ev.t);
}

// ------------------------------------------------------------------ presentation (every machine)

/** Every rendered frame: the event's look, darkness, lights and HUD. */
export function renderWorldEvent(this: Game, frameDt: number): void {
  const W = worldRun(this);
  const live = this.mode !== 'title' && W.arena === this.arena ? W.ev : null;
  if (!W.view) {
    W.view = new WorldEventView(this.scene);
    const view = W.view;
    lookHooks.push((pk, night) => view.addLights(pk, night));
  }
  if (!W.hud) W.hud = new WorldEventHud();
  const frozen = this.paused || this.mode === 'levelup' || this.mode === 'shop';
  W.view.render(this, live, frozen ? 0 : frameDt);
  // Darkness: the eclipse curve, or a Night Raid's night (softer when NIGHT STAGES is off).
  let night = 0;
  if (live?.kind === 'eclipse') night = eclipseNight(live.t);
  else if (live?.kind === 'stealth') night = 1;
  if (!settings.nightStages) night *= 0.6;
  // The sun bursts back in one frame (REDUCE FLASHING: it fades back instead).
  if (live?.kind === 'eclipse' && lookOverrides.eventNight > 0.5 && night === 0 && !access.reduceFlash) lookOverrides.nightSnap = true;
  lookOverrides.eventNight = night;
  lookOverrides.lantern = live?.kind === 'stealth' && !live.done ? 0.4 : 1;
  W.hud.update(this, live);
}
