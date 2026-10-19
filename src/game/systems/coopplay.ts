/**
 * Co-op that needs teamwork (coopplay lane, notes/lanes/coopplay.md):
 * - co-op stage objectives (two-switch vault, escort the core, hold two zones,
 *   carry the bomb), rolled instead of the solo objective with 2+ players and
 *   tracked by the usual objective HUD (src/game/objectives.ts, systems/arena.ts);
 * - carrying downed teammates (INTERACT, or the team button on a pad);
 * - the buddy tether: an energy link between heroes within 7 m, with a damage
 *   and regen bonus that grows while it holds;
 * - co-op banter: recorded teammate call-outs on the effects bus (src/audio/voices.ts).
 * Host/solo simulate; clients mirror the snapshot field `cy` and move their own hero.
 * Pure rules and tuning live in src/game/coopplay.ts.
 */
import * as THREE from 'three';
import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Enemy } from '../enemies';
import type { AABB } from '../../world/collision';
import { StaticBoxGrid } from '../../core/spatialHash';
import { PAD_TEAM } from '../../core/keybinds';
import { paint } from '../../render/geometry';
import { commit } from '../../render/instancing';
import { createRetroMaterial, type RetroMaterial } from '../../render/retroMaterial';
import { Objective } from '../objectives';
import { hazardAt } from '../hazards';
import { bossLike } from '../bossRules';
import { access, settings } from '../settings';
import { prompt } from '../../ui/prompts';
import { localize, localizeHtml } from '../../i18n';
import {
  BanterBrain,
  COOP_OBJECTIVE_KINDS,
  banterCue,
  banterTuning,
  carryTuning,
  coopObjTuning,
  coreStep,
  doorStep,
  escortPercent,
  isCoopKind,
  layoutCoop,
  linkStep,
  linkStrength,
  needHeld,
  pairLinked,
  pickCoopObjective,
  steerCore,
  tetherBonus,
  tetherTuning,
  zonesStep,
  type BanterLine,
  type CoopLayout,
  type CoopObjKind,
} from '../coopplay';

const MAXH = 4;
const PAIRS = (MAXH * (MAXH - 1)) / 2;
const SEGS = 10; // tether segments per pair

interface Reply {
  at: number;
  hero: number;
  line: BanterLine;
}

export class CoopPlayState {
  // ---- co-op objective (host truth; clients mirror)
  kind: CoopObjKind | null = null;
  stage = 0;
  lay: CoopLayout | null = null;
  held = [false, false];
  hold = 0;
  /** Door opened / bunker blown. */
  open = false;
  core = { x: 0, z: 0, hp: coopObjTuning.coreHp, moving: false, rx: 0, rz: 0, spin: 0, side: 1, best: Infinity, stuck: 0 };
  bomb = { x: 0, z: 0, by: -1, fuse: -1, boss: -1, rx: 0, rz: 0 };
  box: AABB | null = null;
  /** Hero who planted the bomb (credited with the blast). */
  planter = 0;
  announced = false;
  alone = [0, 0];
  /** Test links: force this co-op objective on the next stages. */
  force: CoopObjKind | null = null;
  // ---- carrying: carriedBy[i] = index of the hero carrying hero i, or -1
  carriedBy: number[] = [];
  // ---- tether: per-hero link time and the linked pairs (bit k = pair k)
  link: number[] = [];
  pairs = 0;
  pairT: number[] = new Array(PAIRS).fill(0);
  pairOff: number[] = new Array(PAIRS).fill(99);
  // ---- banter (host)
  brain = new BanterBrain();
  wasDead: boolean[] = [];
  /** Revive progress last step: a hero who gets up with a teammate's revive in progress says thanks. */
  reviving: number[] = [];
  pingAt: number[] = [];
  replies: Reply[] = [];
  behindT = 0;
  // ---- presentation (every machine)
  view: CoopView | null = null;
  hud: CoopHud | null = null;
  ownLinked = false;
  wasCarrying = -1;
}

const states = new WeakMap<Game, CoopPlayState>();
export function coopPlayState(g: Game): CoopPlayState {
  let s = states.get(g);
  if (!s) states.set(g, (s = new CoopPlayState()));
  return s;
}

const simNow = (g: Game) => g.stepN / 60;
const r1 = (v: number) => Math.round(v * 10) / 10;
function pairIndex(i: number, j: number): number {
  const a = Math.min(i, j);
  const b = Math.max(i, j);
  // (0,1)=0 (0,2)=1 (0,3)=2 (1,2)=3 (1,3)=4 (2,3)=5
  return a * MAXH - (a * (a + 1)) / 2 + (b - a - 1);
}

function team(g: Game): Hero[] {
  return g.heroes.filter((h) => !h.left);
}

function coopOn(g: Game): boolean {
  return team(g).length >= 2 && !g.pvp && !g.versus;
}

/** Heroes this machine moves itself (its own; local co-op and dummy heroes on a host). */
function movedHere(g: Game, h: Hero): boolean {
  return h === g.hero || (g.authority && !h.remote && !h.peerId);
}

function dropBox(g: Game, box: AABB | null): void {
  if (!box) return;
  const k = g.arena.colliders.indexOf(box);
  if (k < 0) return;
  g.arena.colliders.splice(k, 1);
  g.walls = new StaticBoxGrid(g.arena.colliders);
}

// ---------------------------------------------------------------- objective setup

function resetObjective(s: CoopPlayState, stage: number): void {
  s.kind = null;
  s.stage = stage;
  s.lay = null;
  s.held[0] = s.held[1] = false;
  s.hold = 0;
  s.open = false;
  s.box = null;
  s.announced = false;
  s.alone[0] = s.alone[1] = 0;
  s.bomb.by = -1;
  s.bomb.fuse = -1;
  s.bomb.boss = -1;
}

/** Install a co-op objective on this machine: replaces the stage's solo objective, places its pieces. */
function install(g: Game, s: CoopPlayState, kind: CoopObjKind, lay: CoopLayout): void {
  const before = g.arena.colliders.length;
  g.toys.clearObjectivePieces(g.arena.colliders);
  g.toys.objective = new Objective(kind, g.arenaStage);
  s.kind = kind;
  s.lay = lay;
  s.core.x = s.core.rx = lay.a.x;
  s.core.z = s.core.rz = lay.a.z;
  s.core.hp = coopObjTuning.coreHp;
  s.core.best = Infinity;
  s.core.stuck = 0;
  s.bomb.x = s.bomb.rx = lay.a.x;
  s.bomb.z = s.bomb.rz = lay.a.z;
  if (kind === 'door' || kind === 'bomb') {
    const half = kind === 'door' ? 1.15 : 1.3;
    s.box = { minX: lay.v.x - half, maxX: lay.v.x + half, minZ: lay.v.z - half, maxZ: lay.v.z + half };
    g.arena.colliders.push(s.box);
  }
  if (g.arena.colliders.length !== before) g.walls = new StaticBoxGrid(g.arena.colliders);
}

/** Free ground for a piece: no walls, hazards, pads or turrets, inside the field. */
function clearAt(g: Game, x: number, z: number, r: number): boolean {
  if (Math.abs(x) > 50 || Math.abs(z) > 50 || Math.hypot(x, z) < 8) return false;
  if (g.walls.hitCircle(x, z, r) || hazardAt(g.arena.hazards, x, z) >= 0) return false;
  for (const p of g.toys.pads) if (Math.hypot(p.x - x, p.z - z) < r + 1.6 || Math.hypot(p.tx - x, p.tz - z) < r + 1.2) return false;
  for (const t of g.toys.turrets) if (Math.hypot(t.x - x, t.z - z) < r + 1.8) return false;
  return true;
}

/** After the arena's toys load (systems/arena.ts loadToys): roll and place a co-op objective (host/solo). */
export function coopObjectiveLoad(g: Game): void {
  const s = coopPlayState(g);
  resetObjective(s, g.arenaStage);
  s.carriedBy.length = 0;
  s.bomb.by = -1;
  if (g.arenaStage <= 1) {
    // A new run: links and banter start fresh (they carry over between stages).
    s.link.length = 0;
    s.pairs = 0;
    s.pairT.fill(0);
    s.brain.reset();
    s.replies.length = 0;
  }
  if (!g.authority || !coopOn(g)) return;
  const kind = s.force ?? pickCoopObjective(g.arena.seed, g.arenaStage);
  if (!kind) return;
  const lay = layoutCoop(kind, g.arena.spots, (x, z, r) => clearAt(g, x, z, r), (g.arena.seed ^ Math.imul(g.arenaStage, 0x2545f491)) >>> 0);
  if (lay) install(g, s, kind, lay);
}

/** Test links / debug: put a co-op objective on the current stage now. */
export function forceCoopObjective(g: Game, kind: CoopObjKind): boolean {
  const s = coopPlayState(g);
  s.force = kind;
  dropBox(g, s.box);
  resetObjective(s, g.arenaStage);
  const lay = layoutCoop(kind, g.arena.spots, (x, z, r) => clearAt(g, x, z, r), (g.arena.seed ^ Math.imul(g.arenaStage, 0x2545f491)) >>> 0);
  if (!lay) return false;
  install(g, s, kind, lay);
  return true;
}

// ---------------------------------------------------------------- host step

/** One authoritative step (solo and host), from Game.simulate after the arena. */
export function coopPlayStep(g: Game, dt: number): void {
  const s = coopPlayState(g);
  if (!g.isCombatMode) return;
  hostInput(g, s);
  carryStep(g, s);
  tetherStep(g, s, dt);
  banterStep(g, s, dt);
  slowCarriers(g, s);
}

/** Enemies go for the escorted core too (after the hero targets, Game.simulate). */
export function coopPlayTargets(g: Game): void {
  const s = coopPlayState(g);
  const o = g.toys.objective;
  if (s.kind !== 'escort' || !o.active || g.mode !== 'fight') return;
  coreTarget.x = s.core.x;
  coreTarget.z = s.core.z;
  g.targets.push(coreTarget);
}
const coreTarget = { x: 0, z: 0, radius: 0.9, alive: true };

/** The objective's step (systems/arena.ts updateObjective, fight mode only). */
export function coopObjectiveStep(g: Game, dt: number): void {
  const s = coopPlayState(g);
  const o = g.toys.objective;
  if (!s.kind || !s.lay || !o.active || o.kind !== s.kind) return;
  const T = coopObjTuning;
  const lay = s.lay;
  const need = needHeld(team(g).length);
  if (!s.announced) {
    s.announced = true;
    announce(g, s);
  }
  if (s.kind === 'door' || s.kind === 'zones') {
    const r = s.kind === 'door' ? T.switchRadius : T.zoneRadius;
    let held = 0;
    for (let k = 0; k < 2; k++) {
      const p = k ? lay.b : lay.a;
      const was = s.held[k];
      s.held[k] = g.aliveHeroes.some((h) => (h.player.x - p.x) ** 2 + (h.player.z - p.z) ** 2 < r * r);
      if (s.held[k]) held++;
      if (s.held[k] && !was) {
        g.vfx.sound(s.kind === 'door' ? 'menuSelect' : 'powerUp', p.x, p.z, s.kind === 'door' ? 0.9 : 1);
        g.vfx.ring(p.x, p.z, 0.6, r * 1.6, '#a7f070', 0.3);
      }
    }
    // A hero alone on a piece asks for help (ping on the other piece + "Group up!").
    for (let k = 0; k < 2; k++) {
      s.alone[k] = s.held[k] && held < need ? s.alone[k] + dt : 0;
      if (s.alone[k] >= banterTuning.switchWait) {
        s.alone[k] = -6; // again in 6 s at the earliest
        const p = k ? lay.a : lay.b;
        g.vfx.ring(p.x, p.z, 0.5, 5, '#ffcd75', 0.6);
        g.vfx.num(p.x, 3, p.z, s.kind === 'door' ? 'NEED A BUDDY HERE!' : 'HOLD THIS ZONE!', 'score');
        g.vfx.sound('telegraph', p.x, p.z);
        const q = k ? lay.b : lay.a;
        const h = g.aliveHeroes.find((x) => (x.player.x - q.x) ** 2 + (x.player.z - q.z) ** 2 < r * r);
        if (h) say(g, s, h, 'groupup');
      }
    }
    o.cur = s.kind === 'door' ? held : o.cur;
    o.charging = held >= need;
    if (s.kind === 'door') {
      s.hold = doorStep(s.hold, held, need, dt);
      if (s.hold >= T.holdTime) {
        o.cur = 2;
        o.state = 'done';
        openVault(g, s);
      }
    } else {
      let contested = false;
      if (o.charging) {
        for (let k = 0; k < 2 && !contested; k++) {
          if (!s.held[k]) continue;
          const p = k ? lay.b : lay.a;
          for (const e of g.enemiesInRadius(p.x, p.z, T.zoneRadius, g.scratch)) if (e.pvpOwner < 0 && !e.def.hidden) contested = true;
        }
      }
      o.attacked = contested;
      const wasCharging = o.cur;
      o.cur = zonesStep(o.cur, held, need, contested, dt);
      if (o.charging && wasCharging < 0.05 && o.cur > 0) g.vfx.toast('BOTH ZONES HELD - KEEP THEM!');
      if (o.cur >= o.max) {
        o.state = 'done';
        finish(g, lay.v.x, lay.v.z);
      }
    }
  } else if (s.kind === 'escort') {
    const c = s.core;
    let near = false;
    for (const h of g.aliveHeroes) if ((h.player.x - c.x) ** 2 + (h.player.z - c.z) ** 2 < T.escortRadius * T.escortRadius) near = true;
    let chewing = 0;
    for (const e of g.enemiesInRadius(c.x, c.z, T.coreHit, g.scratch)) if (e.pvpOwner < 0 && !e.def.hidden && e.hp > 0) chewing++;
    const hp0 = c.hp;
    c.hp = coreStep(c.hp, chewing, dt);
    o.hp = c.hp;
    o.attacked = chewing > 0;
    if (chewing > 0 && Math.floor(hp0 / 10) !== Math.floor(c.hp / 10)) {
      g.vfx.burst(c.x, 1, c.z, { count: 6, color: '#73eff7', color2: '#ef7d57', speed: [2, 5], size: [0.1, 0.2], life: [0.2, 0.4], up: 4 });
      g.vfx.sound('hitMetal', c.x, c.z, 1.2);
    }
    if (c.hp <= 0) {
      o.state = 'failed';
      o.charging = false;
      g.vfx.toast('THE CORE WAS DESTROYED!', 2.6);
      g.vfx.sound('explode', c.x, c.z);
      g.vfx.sound('shieldBreak', c.x, c.z, 0.6);
      g.vfx.burst(c.x, 1, c.z, { count: 30, color: '#73eff7', color2: '#29366f', speed: [3, 9], size: [0.2, 0.4], life: [0.4, 0.8], up: 7, gravity: 14 });
      return;
    }
    c.moving = near;
    o.charging = c.moving;
    if (c.moving) {
      const speed = chewing >= 3 ? T.escortSpeed * 0.35 : T.escortSpeed; // swarmed: it grinds on slowly
      // Follows walls around cover; if it hasn't got any closer for 3 s it squeezes through.
      const ghost = c.stuck > 3;
      const nx = steerCore(c.x, c.z, lay.b.x, lay.b.z, speed * dt, (x, z) => !ghost && g.walls.hitCircle(x, z, 0.8), c.side);
      c.side = nx.side;
      c.x = nx.x;
      c.z = nx.z;
      const left = Math.hypot(lay.b.x - c.x, lay.b.z - c.z);
      if (left < c.best - 0.3) {
        c.best = left;
        c.stuck = 0;
      } else c.stuck += dt;
      if (ghost && !g.walls.hitCircle(c.x, c.z, 0.8)) c.stuck = Math.min(c.stuck, 2.5);
    }
    o.cur = escortPercent(lay.a.x, lay.a.z, lay.b.x, lay.b.z, c.x, c.z);
    if (Math.hypot(lay.b.x - c.x, lay.b.z - c.z) < T.coreArrive) {
      o.cur = o.max;
      o.state = 'done';
      finish(g, lay.b.x, lay.b.z);
    }
  } else if (s.kind === 'bomb') {
    bombStep(g, s, dt);
  }
}

function announce(g: Game, s: CoopPlayState): void {
  const lay = s.lay!;
  const o = g.toys.objective;
  g.vfx.banner('CO-OP OBJECTIVE', o.title, 2.4);
  g.vfx.sound('telegraph', NaN, NaN);
  const mark = (x: number, z: number, label: string, color: string) => {
    g.vfx.ring(x, z, 0.5, 4, color, 0.7);
    g.vfx.star(x, 2, z, 1.6, color, 0.5);
    g.vfx.num(x, 3.2, z, label, 'score');
  };
  if (s.kind === 'door') {
    mark(lay.a.x, lay.a.z, 'SWITCH A', '#ffcd75');
    mark(lay.b.x, lay.b.z, 'SWITCH B', '#ffcd75');
    mark(lay.v.x, lay.v.z, 'VAULT', '#a7f070');
  } else if (s.kind === 'zones') {
    mark(lay.a.x, lay.a.z, 'ZONE A', '#73eff7');
    mark(lay.b.x, lay.b.z, 'ZONE B', '#73eff7');
  } else if (s.kind === 'escort') {
    mark(lay.a.x, lay.a.z, 'CORE', '#73eff7');
    mark(lay.b.x, lay.b.z, 'BEACON', '#a7f070');
  } else {
    mark(lay.a.x, lay.a.z, 'BOMB', '#ef7d57');
    mark(lay.v.x, lay.v.z, 'BUNKER', '#b13e53');
  }
}

/** Rewards for everyone (gold, a chest each, score) plus a small team heal. */
function finish(g: Game, x: number, z: number): void {
  g.completeObjective(x, z);
  g.vfx.banner('TEAMWORK!', 'CO-OP OBJECTIVE COMPLETE', 2);
  for (const h of g.aliveHeroes) {
    h.player.heal(h.player.maxHp * 0.2);
    g.vfx.ring(h.player.x, h.player.z, 1, 3.5, '#a7f070', 0.35);
  }
}

function openVault(g: Game, s: CoopPlayState): void {
  const v = s.lay!.v;
  s.open = true;
  g.vfx.sound('chest', v.x, v.z);
  g.vfx.sound('explode', v.x, v.z, 0.8);
  g.vfx.shake(v.x, v.z, 0.35);
  g.vfx.burst(v.x, 1.5, v.z, { count: 30, color: '#ffcd75', color2: '#f4f4f4', speed: [3, 9], size: [0.15, 0.35], life: [0.5, 0.9], up: 8, gravity: 10 });
  g.vfx.num(v.x, 3.6, v.z, 'VAULT OPEN!', 'score');
  finish(g, v.x, v.z + 1.6);
}

function bombStep(g: Game, s: CoopPlayState, dt: number): void {
  const T = coopObjTuning;
  const o = g.toys.objective;
  const b = s.bomb;
  const lay = s.lay!;
  const boss = bossTarget(g);
  o.boss = !!boss;
  if (b.fuse >= 0) {
    // Planted: stuck to the boss if it went on one.
    const on = b.boss >= 0 ? g.enemies.list.find((e) => e.active && e.uid === b.boss) : undefined;
    if (on) {
      b.x = on.x;
      b.z = on.z;
    }
    b.fuse -= dt;
    o.attacked = true;
    o.charging = false;
    if (b.fuse <= 0) blow(g, s, on ?? null);
    return;
  }
  const carrier = b.by >= 0 ? g.heroes[b.by] : undefined;
  if (carrier && (carrier.player.dead || carrier.left)) {
    b.by = -1;
    g.vfx.num(b.x, 2.4, b.z, 'BOMB DROPPED!', 'crit');
  } else if (carrier) {
    b.x = carrier.player.x;
    b.z = carrier.player.z;
  }
  if (b.by < 0) {
    // Walk over it to pick it up (not while carrying a teammate).
    const h = g.aliveHeroes.find((x) => (x.player.x - b.x) ** 2 + (x.player.z - b.z) ** 2 < T.bombPick * T.bombPick && carryingOf(s, x.index) < 0);
    if (h) {
      b.by = h.index;
      g.vfx.sound('v:s:carry_lift', b.x, b.z);
      g.vfx.num(h.player.x, 2.8, h.player.z, `${h.name.toUpperCase()} HAS THE BOMB!`, 'score');
      g.vfx.ring(b.x, b.z, 0.5, 3, '#ef7d57', 0.3);
    }
  }
  o.charging = b.by >= 0;
  o.attacked = false;
  if (b.by < 0) return;
  // Plant: at the bunker, or on a boss.
  if (!s.open && Math.hypot(b.x - lay.v.x, b.z - lay.v.z) < T.bombPlant + 1.3) {
    plant(g, s, lay.v.x, lay.v.z, -1);
  } else if (boss && Math.hypot(b.x - boss.x, b.z - boss.z) < T.bombPlant + boss.radius) {
    plant(g, s, boss.x, boss.z, boss.uid);
  }
}

function bossTarget(g: Game): Enemy | null {
  if (g.boss && g.boss.active && g.boss.hp > 0) return g.boss;
  const m = g.bossField.mini;
  return m && m.active && m.hp > 0 && bossLike(m) ? m : null;
}

function plant(g: Game, s: CoopPlayState, x: number, z: number, bossUid: number): void {
  const b = s.bomb;
  const by = g.heroes[b.by];
  b.x = x;
  b.z = z;
  b.fuse = coopObjTuning.bombFuse;
  b.boss = bossUid;
  b.by = -1;
  g.vfx.zone(x, z, coopObjTuning.bombBlast, coopObjTuning.bombFuse);
  g.vfx.sound('fuseTick', x, z, 1.2);
  g.vfx.num(x, 3, z, 'BOMB PLANTED! CLEAR OUT!', 'crit');
  if (by) g.vfx.ring(by.player.x, by.player.z, 0.6, 3, '#ef7d57', 0.3);
  s.planter = by ? by.index : 0;
}

function blow(g: Game, s: CoopPlayState, boss: Enemy | null): void {
  const T = coopObjTuning;
  const b = s.bomb;
  const o = g.toys.objective;
  const by = g.heroes[s.planter] ?? g.hero;
  b.fuse = -1;
  g.vfx.sound('explode', b.x, b.z, 0.7);
  g.vfx.sound('impact', b.x, b.z, 2.5);
  g.vfx.shake(b.x, b.z, 0.9);
  g.vfx.flash(0.35);
  g.vfx.ring(b.x, b.z, 1, T.bombBlast * 2.2, '#ef7d57', 0.45);
  g.vfx.burst(b.x, 1, b.z, { count: 40, color: '#ef7d57', color2: '#ffcd75', speed: [4, 12], size: [0.2, 0.5], life: [0.4, 0.9], up: 9, gravity: 14 });
  g.vfx.scar(b.x, b.z, 2.4, '#1a1c2c', 16);
  const dmg = T.bombBlastDmg + T.bombBlastPerStage * (g.stage - 1);
  for (const e of g.enemiesInRadius(b.x, b.z, T.bombBlast, g.scratch).slice()) {
    if (e.pvpOwner >= 0 || e === boss) continue;
    const d = Math.hypot(e.x - b.x, e.z - b.z) || 1;
    g.damage(e, bossLike(e) ? e.maxHp * T.bombBossFrac * 0.5 : dmg, { source: 'coopbomb', fixed: bossLike(e), dirX: (e.x - b.x) / d, dirZ: (e.z - b.z) / d, knockback: 14 }, by);
  }
  if (boss && boss.active) {
    const shield = boss.shield;
    boss.shield = 0;
    g.damage(boss, boss.maxHp * T.bombBossFrac, { source: 'coopbomb', fixed: true, noStatus: true }, by);
    g.vfx.num(boss.x, 4.2, boss.z, shield > 0 ? 'SHIELD BLOWN!' : 'BOSS BLASTED!', 'crit');
    if (shield > 0) g.vfx.sound('shieldBreak', boss.x, boss.z);
  } else if (!s.open) {
    s.open = true;
    dropBox(g, s.box);
    g.vfx.num(b.x, 3.6, b.z, 'BUNKER BLOWN!', 'crit');
    g.vfx.sound('coverBreak', b.x, b.z);
  }
  o.cur = o.max;
  o.state = 'done';
  o.attacked = false;
  finish(g, b.x, b.z + 1.6);
}

/** Where the objective arrow points for this machine's hero (systems/arena.ts objectiveTarget). */
export function coopObjectiveTarget(g: Game): { x: number; z: number } | null {
  const s = coopPlayState(g);
  const L = s.lay;
  if (!L || !s.kind) return null;
  const p = g.hero.player;
  const nearer = (a: { x: number; z: number }, b: { x: number; z: number }) => (Math.hypot(a.x - p.x, a.z - p.z) <= Math.hypot(b.x - p.x, b.z - p.z) ? a : b);
  if (s.kind === 'door' || s.kind === 'zones') {
    if (s.held[0] !== s.held[1]) return s.held[0] ? L.b : L.a;
    return nearer(L.a, L.b);
  }
  if (s.kind === 'escort') return s.core;
  const b = s.bomb;
  if (b.by === g.hero.index) {
    const boss = bossTarget(g);
    if (boss && (s.open || Math.hypot(boss.x - p.x, boss.z - p.z) < Math.hypot(L.v.x - p.x, L.v.z - p.z))) return boss;
    return L.v;
  }
  return b;
}

// ---------------------------------------------------------------- carrying

function carryingOf(s: CoopPlayState, i: number): number {
  return s.carriedBy.indexOf(i);
}

/** Is this downed hero being carried? (systems/coop.ts: no revive progress while carried.) */
export function isCarried(g: Game, h: Hero): boolean {
  return (coopPlayState(g).carriedBy[h.index] ?? -1) >= 0;
}

function interactPressed(g: Game, s: CoopPlayState, h: Hero): boolean {
  const input = g.input;
  if (input.actionPressed('interact')) return true;
  // On a pad (and on T) the team button doubles as INTERACT while a downed teammate is in reach or you carry something.
  const team = input.actionPressed('team') || PAD_TEAM.some((b) => input.padButtonPressed(b));
  if (!team || !(carryingOf(s, h.index) >= 0 || s.bomb.by === h.index || downedNear(g, s, h))) return false;
  input.consumeAction('team');
  for (const b of PAD_TEAM) input.consumePad(b);
  return true;
}

function downedNear(g: Game, s: CoopPlayState, h: Hero): Hero | null {
  const R = carryTuning.pickRange;
  let best: Hero | null = null;
  let bd = R * R;
  for (const o of g.heroes) {
    if (o === h || o.left || !o.player.dead || (s.carriedBy[o.index] ?? -1) >= 0) continue;
    const d = (o.player.x - h.player.x) ** 2 + (o.player.z - h.player.z) ** 2;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function hostInput(g: Game, s: CoopPlayState): void {
  const h = g.hero;
  if (g.screens.current !== 'none' || g.paused || h.player.dead || h.left || g.heroes.length < 2) return;
  if (interactPressed(g, s, h)) toggleCarry(g, s, h);
}

/** Host: a client pressed INTERACT. */
export function coopPlayMessage(g: Game, h: Hero, m: Record<string, unknown>): void {
  if (m.t !== 'carry' || !g.isCombatMode || h.player.dead || h.left) return;
  toggleCarry(g, coopPlayState(g), h);
}

/** Pick up the nearest downed teammate, or put down whoever (or the bomb) you carry. */
export function toggleCarry(g: Game, s: CoopPlayState, h: Hero): boolean {
  const p = h.player;
  const held = carryingOf(s, h.index);
  if (held >= 0) {
    putDown(g, s, h, g.heroes[held]);
    return true;
  }
  const o = downedNear(g, s, h);
  if (!o) {
    if (s.bomb.by === h.index) {
      s.bomb.by = -1;
      g.vfx.num(p.x, 2.4, p.z, 'BOMB DOWN', 'score');
      return true;
    }
    return false;
  }
  if (s.bomb.by === h.index) s.bomb.by = -1; // hands full: the bomb drops
  s.carriedBy[o.index] = h.index;
  for (let i = 0; i < g.heroes.length; i++) s.carriedBy[i] ??= -1;
  g.vfx.sound('v:s:carry_lift', p.x, p.z);
  g.vfx.num(p.x, 3, p.z, `CARRYING ${o.name.toUpperCase()}!`, 'heal');
  g.vfx.ring(p.x, p.z, 0.5, 3, o.color, 0.3);
  return true;
}

function putDown(g: Game, s: CoopPlayState, h: Hero, o: Hero | undefined): void {
  if (!o) return;
  s.carriedBy[o.index] = -1;
  const p = h.player;
  // In front of the carrier if there's room, else at their feet.
  const ax = p.aim.x;
  const az = p.aim.z;
  const al = Math.hypot(ax, az) || 1;
  let x = p.x + (ax / al) * carryTuning.dropAhead;
  let z = p.z + (az / al) * carryTuning.dropAhead;
  if (g.walls.hitCircle(x, z, o.player.radius)) {
    x = p.x;
    z = p.z;
  }
  place(o, x, z);
  g.vfx.num(x, 2.4, z, 'SAFE! NOW REVIVE!', 'heal');
  g.vfx.burst(x, 0.3, z, { count: 8, color: '#f2e2b8', color2: '#ffffff', speed: [1, 3], size: [0.15, 0.3], life: [0.3, 0.5], up: 2, gravity: 8 });
}

function place(o: Hero, x: number, z: number): void {
  const q = o.player;
  q.prev.x = q.pos.x;
  q.prev.z = q.pos.z;
  q.pos.x = x;
  q.pos.z = z;
  if (o.remote) {
    o.remote.x = x;
    o.remote.z = z;
  }
}

function carryStep(g: Game, s: CoopPlayState): void {
  for (let i = 0; i < s.carriedBy.length; i++) {
    const c = s.carriedBy[i];
    if (c < 0) continue;
    const o = g.heroes[i];
    const h = g.heroes[c];
    if (!o || !h || o.left || !o.player.dead || h.left || h.player.dead) {
      // Revived (or left) while carried, or the carrier fell: put down here.
      s.carriedBy[i] = -1;
      if (o && h && !o.left && o.player.dead) place(o, h.player.x, h.player.z);
      continue;
    }
    place(o, h.player.x, h.player.z);
  }
}

/** Carriers move slowly (on the machine that moves them). */
function slowCarriers(g: Game, s: CoopPlayState): void {
  for (const h of g.heroes) if (movedHere(g, h)) slowHero(s, h);
}

function slowHero(s: CoopPlayState, h: Hero): void {
  const p = h.player;
  if (p.dead) return;
  const mul = carryingOf(s, h.index) >= 0 ? carryTuning.speed : s.bomb.by === h.index && !h.petState.ranks.porter ? coopObjTuning.bombSpeed : 1;
  if (mul >= 1) return;
  p.pos.x = p.prev.x + (p.pos.x - p.prev.x) * mul;
  p.pos.z = p.prev.z + (p.pos.z - p.prev.z) * mul;
}

// ---------------------------------------------------------------- tether

function tetherStep(g: Game, s: CoopPlayState, dt: number): void {
  const hs = g.heroes;
  let mask = 0;
  const on = coopOn(g) && g.mode === 'fight';
  for (let i = 0; i < hs.length && i < MAXH; i++) {
    for (let j = i + 1; j < hs.length && j < MAXH; j++) {
      const k = pairIndex(i, j);
      const a = hs[i];
      const b = hs[j];
      const alive = on && !a.left && !b.left && !a.player.dead && !b.player.dead;
      const was = (s.pairs & (1 << k)) !== 0;
      const linked = alive && pairLinked(Math.hypot(a.player.x - b.player.x, a.player.z - b.player.z), was);
      if (linked) {
        mask |= 1 << k;
        // The hum when a link forms (not again for a pair that only just broke: no buzzing at the edge).
        if (!was && s.pairOff[k] > 2) g.vfx.sound('v:s:tether_hum', (a.player.x + b.player.x) / 2, (a.player.z + b.player.z) / 2);
        s.pairT[k] += dt;
        s.pairOff[k] = 0;
      } else {
        if (was && s.pairT[k] >= tetherTuning.snapMin && on) snapFx(g, a, b);
        s.pairT[k] = 0;
        s.pairOff[k] += dt;
      }
    }
  }
  s.pairs = mask;
  for (let i = 0; i < hs.length; i++) {
    let linked = false;
    for (let j = 0; j < hs.length && i < MAXH && j < MAXH; j++) if (j !== i && mask & (1 << pairIndex(i, j))) linked = true;
    s.link[i] = linkStep(s.link[i] ?? 0, linked, dt);
  }
  s.link.length = hs.length;
}

function snapFx(g: Game, a: Hero, b: Hero): void {
  const x = (a.player.x + b.player.x) / 2;
  const z = (a.player.z + b.player.z) / 2;
  g.vfx.burst(x, 1.1, z, { count: 12, color: a.color, color2: b.color, speed: [3, 7], size: [0.1, 0.2], life: [0.2, 0.4], up: 3, drag: 2 });
  g.vfx.star(x, 1.1, z, 1.2, '#ffffff', 0.12);
  g.vfx.num(x, 2.2, z, 'LINK BROKEN', 'hit');
  g.vfx.sound('shieldBreak', x, z, 1.7);
}

/** Tether bonus on live stats (Game.updateHero, after refreshLive and the team auras). */
export function coopPlayStats(g: Game, h: Hero): void {
  const t = coopPlayState(g).link[h.index] ?? 0;
  if (t <= 0 || h.player.dead) return;
  const b = tetherBonus(t);
  h.stats.damageMul += b.damage;
  h.stats.regen += b.regen;
}

// ---------------------------------------------------------------- banter (host)

function say(g: Game, s: CoopPlayState, h: Hero, line: BanterLine): boolean {
  if (h.left || !s.brain.say(h.index, line, simNow(g))) return false;
  g.vfx.sound(banterCue(h.heroDef.id, line), NaN, NaN);
  return true;
}

function banterStep(g: Game, s: CoopPlayState, dt: number): void {
  const hs = g.heroes;
  if (!coopOn(g)) {
    for (const h of hs) s.wasDead[h.index] = h.player.dead;
    return;
  }
  const now = simNow(g);
  // Revived by a teammate: "Thanks for the revive!"
  for (const h of hs) {
    const was = s.wasDead[h.index] ?? false;
    const rev = s.reviving[h.index] ?? 0;
    s.wasDead[h.index] = h.player.dead;
    s.reviving[h.index] = h.reviveT;
    if (!was || h.player.dead || h.left || rev < 1) continue;
    const helper = g.aliveHeroes.some((o) => o !== h && Math.hypot(o.player.x - h.player.x, o.player.z - h.player.z) < 4);
    if (helper) say(g, s, h, 'thanks');
  }
  // Pings: the pinger asks to group up if the team is spread out; the nearest teammate answers.
  for (const h of hs) {
    const at = h.pingAt;
    const prev = s.pingAt[h.index] ?? at;
    s.pingAt[h.index] = at;
    if (at === prev || h.player.dead || h.left) continue;
    const mates = g.aliveHeroes.filter((o) => o !== h);
    if (!mates.length) continue;
    const dist = (o: Hero) => Math.hypot(o.player.x - h.player.x, o.player.z - h.player.z);
    const avg = mates.reduce((a, o) => a + dist(o), 0) / mates.length;
    if (avg > banterTuning.groupUpSpread) say(g, s, h, 'groupup');
    let near = mates[0];
    for (const o of mates) if (dist(o) < dist(near)) near = o;
    if (dist(near) > banterTuning.onMyWayDist) s.replies.push({ at: now + banterTuning.onMyWayDelay, hero: near.index, line: 'onmyway' });
  }
  for (let i = s.replies.length - 1; i >= 0; i--) {
    const r = s.replies[i];
    if (r.at > now) continue;
    s.replies.splice(i, 1);
    const h = hs[r.hero];
    if (h && !h.player.dead) say(g, s, h, r.line);
  }
  // Enemies closing in behind a teammate: someone nearby shouts "Behind you!"
  s.behindT -= dt;
  if (s.behindT <= 0) {
    s.behindT = banterTuning.behindEvery;
    for (const h of g.aliveHeroes) {
      const p = h.player;
      const al = Math.hypot(p.aim.x, p.aim.z) || 1;
      let n = 0;
      let elite = false;
      for (const e of g.enemiesInRadius(p.x, p.z, banterTuning.behindRange, g.scratch)) {
        if (e.pvpOwner >= 0 || e.def.hidden) continue;
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        if ((dx * p.aim.x + dz * p.aim.z) / (d * al) > -0.35) continue; // not behind
        n++;
        if (e.elite || bossLike(e)) elite = true;
      }
      if (n < banterTuning.behindCount && !elite) continue;
      const caller = g.aliveHeroes.find((o) => o !== h && Math.hypot(o.player.x - p.x, o.player.z - p.z) < banterTuning.behindCallRange);
      if (caller && say(g, s, caller, 'behind')) break;
    }
  }
}

/** killEnemy hook (host/solo): saves and great shots. */
export function coopPlayKill(g: Game, e: Enemy, by: Hero | null): void {
  if (!by || !g.authority || !coopOn(g)) return;
  const s = coopPlayState(g);
  const big = e.elite || bossLike(e) || e.def.id === 'reaper';
  // A teammate in trouble right next to the kill: "Nice save!"
  for (const h of g.aliveHeroes) {
    if (h === by) continue;
    const d = Math.hypot(h.player.x - e.x, h.player.z - e.z);
    if (d < banterTuning.saveRange && (h.player.hp / Math.max(1, h.player.maxHp) < banterTuning.saveHp || big)) {
      if (say(g, s, h, 'nicesave')) return;
    }
  }
  if (!big) return;
  let mate: Hero | null = null;
  let md = banterTuning.greatShotRange;
  for (const h of g.aliveHeroes) {
    if (h === by) continue;
    const d = Math.hypot(h.player.x - by.player.x, h.player.z - by.player.z);
    if (d < md) {
      md = d;
      mate = h;
    }
  }
  if (mate) say(g, s, mate, 'greatshot');
}

// ---------------------------------------------------------------- network

const KINDS = COOP_OBJECTIVE_KINDS;

export function coopPlayNet(g: Game): Record<string, unknown> | null {
  const s = coopPlayState(g);
  if (g.heroes.length < 2 && !s.kind) return null;
  const out: Record<string, unknown> = {
    c: g.heroes.map((h) => s.carriedBy[h.index] ?? -1),
    t: g.heroes.map((h) => Math.ceil(s.link[h.index] ?? 0)), // whole seconds: the HUD bar and bonus don't need more
    p: s.pairs,
  };
  if (s.kind && s.lay) {
    const L = s.lay;
    const b = s.bomb;
    out.o = [
      g.arenaStage,
      KINDS.indexOf(s.kind),
      r1(L.a.x), r1(L.a.z), r1(L.b.x), r1(L.b.z), r1(L.v.x), r1(L.v.z),
      (s.held[0] ? 1 : 0) | (s.held[1] ? 2 : 0) | (s.open ? 4 : 0) | (s.core.moving ? 8 : 0),
      r1(s.core.x), r1(s.core.z), r1(b.x), r1(b.z), b.by, r1(b.fuse),
    ];
  }
  return out;
}

export function applyCoopPlayNet(g: Game, data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const s = coopPlayState(g);
  const n = data as { c?: number[]; t?: number[]; p?: number; o?: number[] };
  s.carriedBy = Array.isArray(n.c) ? n.c.map(Number) : [];
  s.link = Array.isArray(n.t) ? n.t.map(Number) : [];
  s.pairs = Number(n.p) || 0;
  const o = n.o;
  if (!Array.isArray(o) || o[0] !== g.arenaStage) return;
  const kind = KINDS[o[1]];
  if (!kind) return;
  if (s.kind !== kind || s.stage !== g.arenaStage || g.toys.objective.kind !== kind) {
    dropBox(g, s.box);
    resetObjective(s, g.arenaStage);
    install(g, s, kind, { a: { x: o[2], z: o[3] }, b: { x: o[4], z: o[5] }, v: { x: o[6], z: o[7] } });
  }
  const f = o[8] | 0;
  s.held[0] = (f & 1) !== 0;
  s.held[1] = (f & 2) !== 0;
  s.core.moving = (f & 8) !== 0;
  s.core.x = o[9];
  s.core.z = o[10];
  s.bomb.x = o[11];
  s.bomb.z = o[12];
  s.bomb.by = o[13];
  s.bomb.fuse = o[14];
  if ((f & 4) !== 0 && !s.open) {
    s.open = true;
    if (kind === 'bomb') dropBox(g, s.box);
  }
  g.toys.objective.boss = !!bossTarget(g);
}

/** Client: INTERACT goes to the host; the carrier's slow and a carried hero's position are local. */
export function coopPlayClientInput(g: Game, control: boolean): void {
  if (!control || g.heroes.length < 2) return;
  const s = coopPlayState(g);
  if (interactPressed(g, s, g.hero)) g.client?.send({ t: 'carry' });
}

export function coopPlayLocal(g: Game): void {
  const s = coopPlayState(g);
  const h = g.hero;
  slowHero(s, h);
  const c = s.carriedBy[h.index] ?? -1;
  const by = c >= 0 ? g.heroes[c] : undefined;
  if (by && h.player.dead) place(h, by.player.x, by.player.z);
}

// ---------------------------------------------------------------- presentation

/** Every frame on every machine: objective pieces, tethers, carried heroes, HUD. */
export function renderCoopPlay(g: Game, rdt: number): void {
  const s = coopPlayState(g);
  const fighting = g.isCombatMode && g.mode !== 'title' && !g.pvp;
  const objOn = fighting && !!s.kind && !!s.lay && g.toys.objective.kind === s.kind;
  if (!s.view && !objOn && g.heroes.length < 2) return;
  const view = (s.view ??= new CoopView(g.scene));
  view.update(g, s, objOn, rdt);
  // Carried heroes ride on their carrier's shoulders.
  for (let i = 0; i < s.carriedBy.length; i++) {
    const c = s.carriedBy[i];
    const o = g.heroes[i];
    const h = c >= 0 ? g.heroes[c] : undefined;
    if (!o || !h || !o.player.dead) continue;
    const root = o.player.rig.root;
    const hr = h.player.rig.root;
    root.position.set(hr.position.x, carryTuning.lift + Math.abs(Math.sin(g.animTime * 8)) * 0.06, hr.position.z);
    root.rotation.y = hr.rotation.y + Math.PI / 2;
    root.visible = true;
  }
  const own = s.carriedBy.indexOf(g.hero.index);
  if (own !== s.wasCarrying && own >= 0 && g.hero === g.heroes[g.local]) g.juice.shake(0.06);
  s.wasCarrying = own;
  (s.hud ??= new CoopHud()).update(g, s, objOn);
}

const UP = new THREE.Vector3(0, 1, 0);

class CoopView {
  readonly group = new THREE.Group();
  private switches: { g: THREE.Group; mat: RetroMaterial; ring: RetroMaterial }[] = [];
  private zones: { g: THREE.Mesh; mat: RetroMaterial }[] = [];
  private vault = new THREE.Group();
  private door = new THREE.Group();
  private stripes = new THREE.Group();
  private rubble: THREE.Mesh;
  private core = new THREE.Group();
  private coreRing: THREE.Mesh;
  private coreMat: RetroMaterial;
  private beacon = new THREE.Group();
  private bomb = new THREE.Group();
  private bombLight: RetroMaterial;
  private beams: THREE.InstancedMesh;
  private tether: THREE.InstancedMesh;
  private tetherCore: THREE.InstancedMesh;
  private beads: THREE.InstancedMesh;
  private pylons: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private col = new THREE.Color();
  private col2 = new THREE.Color();
  private col3 = new THREE.Color();
  private doorT = 0;

  constructor(scene: THREE.Scene) {
    const box = (w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(), color);
    const cyl = (r1: number, r2: number, h: number, seg: number, color: string, y = 0) => paint(new THREE.CylinderGeometry(r1, r2, h, seg).translate(0, y, 0).toNonIndexed(), color);
    const vc = createRetroMaterial({ vertexColors: true });
    // Switch plates: a base, a plate that lights up and a ring around it.
    for (let k = 0; k < 2; k++) {
      const sg = new THREE.Group();
      sg.add(new THREE.Mesh(cyl(1.35, 1.5, 0.22, 10, '#333c57', 0.11), vc));
      const mat = createRetroMaterial({ color: '#ef7d57', unlit: 0.7 });
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.05, 0.16, 10).translate(0, 0.26, 0), mat);
      plate.name = 'plate';
      sg.add(plate);
      const ring = createRetroMaterial({ color: '#ffcd75', unlit: 1 });
      const rg = new THREE.RingGeometry(coopObjTuning.switchRadius - 0.14, coopObjTuning.switchRadius, 20);
      rg.rotateX(-Math.PI / 2);
      const rm = new THREE.Mesh(rg, ring);
      rm.position.y = 0.04;
      sg.add(rm);
      this.switches.push({ g: sg, mat, ring });
      this.group.add(sg);
    }
    // Zones: a wide ring on the ground with an inner dashed ring.
    for (let k = 0; k < 2; k++) {
      const mat = createRetroMaterial({ color: '#73eff7', unlit: 1 });
      const rg = new THREE.RingGeometry(coopObjTuning.zoneRadius - 0.42, coopObjTuning.zoneRadius, 32);
      rg.rotateX(-Math.PI / 2);
      const inner = new THREE.RingGeometry(coopObjTuning.zoneRadius * 0.55 - 0.12, coopObjTuning.zoneRadius * 0.55, 16, 1, 0, Math.PI * 2);
      inner.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(rg, mat);
      m.add(new THREE.Mesh(inner, mat));
      m.position.y = 0.05;
      this.zones.push({ g: m, mat });
      this.group.add(m);
    }
    // Vault: a chunky steel safe with gold trim and a round door (also the bomb's bunker, with hazard stripes).
    this.vault.add(
      new THREE.Mesh(
        mergeParts([
          box(2.3, 2.1, 2.3, '#566c86', 0, 1.05, 0),
          box(2.5, 0.25, 2.5, '#333c57', 0, 0.12, 0),
          box(2.4, 0.2, 2.4, '#94b0c2', 0, 2.15, 0),
          box(2.5, 0.1, 0.18, '#ffcd75', 0, 2.27, 1.16),
          box(2.5, 0.1, 0.18, '#ffcd75', 0, 2.27, -1.16),
          box(0.18, 0.1, 2.5, '#ffcd75', 1.16, 2.27, 0),
          box(0.18, 0.1, 2.5, '#ffcd75', -1.16, 2.27, 0),
          box(0.8, 0.12, 0.8, '#ffcd75', 0, 2.3, 0),
          box(0.4, 0.14, 0.4, '#ef7d57', 0, 2.34, 0),
          box(0.25, 2.1, 0.25, '#ffcd75', 1.15, 1.05, 1.15),
          box(0.25, 2.1, 0.25, '#ffcd75', -1.15, 1.05, 1.15),
          box(0.25, 2.1, 0.25, '#ffcd75', 1.15, 1.05, -1.15),
          box(0.25, 2.1, 0.25, '#ffcd75', -1.15, 1.05, -1.15),
          box(1.7, 1.6, 0.1, '#1a1c2c', 0, 1.05, 1.17),
        ]),
        vc,
      ),
    );
    this.door.position.set(-0.8, 0, 1.24);
    this.door.add(
      new THREE.Mesh(
        mergeParts([
          box(1.6, 1.5, 0.16, '#94b0c2', 0.8, 1.05, 0),
          cyl(0.42, 0.42, 0.12, 8, '#ffcd75', 0).rotateX(Math.PI / 2).translate(0.8, 1.05, 0.12),
          box(0.9, 0.12, 0.08, '#ef7d57', 0.8, 1.05, 0.2),
          box(0.12, 0.9, 0.08, '#ef7d57', 0.8, 1.05, 0.2),
        ]),
        vc,
      ),
    );
    this.vault.add(this.door);
    for (let i = 0; i < 5; i++) this.stripes.add(new THREE.Mesh(box(0.28, 2.15, 2.36, i % 2 ? '#1a1c2c' : '#ffcd75', -0.9 + i * 0.45, 1.06, 0).rotateY(0), vc));
    this.stripes.add(new THREE.Mesh(box(1.2, 0.5, 0.08, '#b13e53', 0, 1.6, 1.22), vc));
    this.vault.add(this.stripes);
    this.group.add(this.vault);
    this.rubble = new THREE.Mesh(
      mergeParts([box(0.9, 0.5, 0.8, '#566c86', -0.6, 0.25, 0.3), box(0.7, 0.4, 0.9, '#333c57', 0.7, 0.2, -0.2), box(0.5, 0.35, 0.5, '#ffcd75', 0.1, 0.18, 0.8), box(0.6, 0.3, 0.6, '#94b0c2', 0.2, 0.15, -0.8)]),
      vc,
    );
    this.group.add(this.rubble);
    // Core: a glowing ball in a gold ring that rolls along.
    this.coreMat = createRetroMaterial({ color: '#73eff7', unlit: 0.8 });
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), this.coreMat);
    ball.position.y = 0.95;
    ball.name = 'ball';
    this.coreRing = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.13, 4, 12), createRetroMaterial({ color: '#ffcd75', unlit: 0.4 }));
    this.coreRing.position.y = 0.95;
    this.core.add(ball, this.coreRing, new THREE.Mesh(cyl(0.9, 1.0, 0.12, 10, '#29366f', 0.06), vc));
    this.group.add(this.core);
    // Beacon: a pole with a flag and a ground ring.
    const br = new THREE.RingGeometry(coopObjTuning.coreArrive + 0.4, coopObjTuning.coreArrive + 0.65, 20);
    br.rotateX(-Math.PI / 2);
    const brm = new THREE.Mesh(br, createRetroMaterial({ color: '#a7f070', unlit: 1 }));
    brm.position.y = 0.05;
    this.beacon.add(new THREE.Mesh(mergeParts([cyl(0.12, 0.14, 3.4, 6, '#f4f4f4', 1.7), box(1.1, 0.7, 0.08, '#a7f070', 0.6, 3.0, 0), cyl(0.5, 0.6, 0.25, 8, '#333c57', 0.12)]), vc), brm);
    this.group.add(this.beacon);
    // Bomb: a round black bomb with a fuse and a blinking light.
    this.bombLight = createRetroMaterial({ color: '#b13e53', unlit: 1 });
    const light = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), this.bombLight);
    light.position.set(0, 1.25, 0);
    this.bomb.add(new THREE.Mesh(mergeParts([paint(new THREE.IcosahedronGeometry(0.55, 1).translate(0, 0.6, 0), '#1a1c2c'), cyl(0.12, 0.14, 0.3, 6, '#94b0c2', 1.15), box(0.7, 0.12, 0.12, '#ef7d57', 0, 0.75, 0.48)]), vc), light);
    this.group.add(this.bomb);
    // Map beams (like the solo objective's): tall columns over the pieces.
    this.beams = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 9, 5).translate(0, 4.5, 0), createRetroMaterial({ color: '#ffcd75', unlit: 1 }), 4);
    this.beams.frustumCulled = false;
    this.beams.count = 0;
    this.group.add(this.beams);
    // Tethers: wavy segments in the pair's colours with a white core.
    const seg = paint(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), '#ffffff');
    this.tether = new THREE.InstancedMesh(seg, createRetroMaterial({ vertexColors: true, unlit: 1 }), PAIRS * SEGS);
    this.tether.setColorAt(0, this.col.set('#ffffff'));
    this.tetherCore = new THREE.InstancedMesh(seg, createRetroMaterial({ color: '#f4f4f4', unlit: 1 }), PAIRS * SEGS);
    this.beads = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), createRetroMaterial({ color: '#ffcd75', unlit: 1 }), PAIRS * 2);
    // Zone pylons: 8 short posts around each zone that light up in its colour.
    this.pylons = new THREE.InstancedMesh(paint(new THREE.BoxGeometry(0.3, 1, 0.3).translate(0, 0.5, 0).toNonIndexed(), '#ffffff'), createRetroMaterial({ vertexColors: true, unlit: 0.6 }), 16);
    this.pylons.setColorAt(0, this.col.set('#ffffff'));
    for (const m of [this.tether, this.tetherCore, this.beads, this.pylons]) {
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
    }
    for (const o of [this.vault, this.core, this.beacon, this.bomb, this.rubble, ...this.switches.map((x) => x.g), ...this.zones.map((x) => x.g)]) o.visible = false;
    scene.add(this.group);
  }

  update(g: Game, s: CoopPlayState, objOn: boolean, dt: number): void {
    const t = g.animTime;
    const o = g.toys.objective;
    const lay = s.lay;
    const kind = objOn ? s.kind : null;
    const live = objOn && o.active;
    const blink = (hz: number) => access.reduceFlash || Math.floor(t * hz) % 2 === 0;
    let beams = 0;
    let pylons = 0;
    const beam = (x: number, z: number) => {
      if (beams >= 4) return;
      this.q.setFromAxisAngle(UP, t);
      this.m4.compose(this.v.set(x, 0, z), this.q, this.sc.set(1 + Math.sin(t * 4 + x) * 0.2, 1, 1 + Math.sin(t * 4 + x) * 0.2));
      this.beams.setMatrixAt(beams++, this.m4);
    };
    // Switches / zones
    for (let k = 0; k < 2; k++) {
      const sw = this.switches[k];
      const zn = this.zones[k];
      const p = lay ? (k ? lay.b : lay.a) : null;
      sw.g.visible = kind === 'door' && !!p;
      zn.g.visible = kind === 'zones' && !!p;
      if (!p) continue;
      const held = s.held[k];
      if (sw.g.visible) {
        sw.g.position.set(p.x, 0, p.z);
        const plate = sw.g.getObjectByName('plate')!;
        plate.position.y = held || o.state === 'done' ? -0.1 : 0;
        sw.mat.uniforms.uColor.value.set(o.state === 'done' || held ? '#a7f070' : '#ef7d57');
        sw.ring.uniforms.uColor.value.set(held ? '#a7f070' : live && !blink(2) ? '#f4f4f4' : '#ffcd75');
        if (live && !held) beam(p.x, p.z);
      }
      if (zn.g.visible) {
        this.col.set(o.state === 'done' ? '#a7f070' : held ? (o.attacked ? '#ef7d57' : o.charging ? '#a7f070' : '#ffcd75') : '#73eff7');
        const R = coopObjTuning.zoneRadius;
        for (let q = 0; q < 8; q++) {
          const ang = (q / 8) * Math.PI * 2 + k * 0.4;
          const lit = held && o.charging ? (Math.floor(t * 6) + q) % 8 < 3 : true;
          const hgt = 0.7 + (lit && held ? 0.4 : 0) + (q % 2) * 0.15;
          this.m4.compose(this.v.set(p.x + Math.cos(ang) * R, 0, p.z + Math.sin(ang) * R), this.q.identity(), this.sc.set(1, hgt, 1));
          this.pylons.setMatrixAt(pylons, this.m4);
          this.pylons.setColorAt(pylons++, lit ? this.col : this.col2.copy(this.col).multiplyScalar(0.45));
        }
        zn.g.position.set(p.x, 0.05, p.z);
        zn.g.rotation.y += dt * (held && o.charging ? 1.5 : 0.3);
        zn.mat.uniforms.uColor.value.set(o.state === 'done' ? '#a7f070' : held ? (o.attacked && blink(4) ? '#ef7d57' : o.charging ? '#a7f070' : '#ffcd75') : '#73eff7');
        if (live && !held) beam(p.x, p.z);
      }
    }
    // Vault / bunker
    const vaultOn = (kind === 'door' || kind === 'bomb') && !!lay;
    const blown = kind === 'bomb' && s.open;
    this.vault.visible = vaultOn && !blown;
    this.rubble.visible = vaultOn && blown;
    if (vaultOn && lay) {
      this.vault.position.set(lay.v.x, 0, lay.v.z);
      this.rubble.position.set(lay.v.x, 0, lay.v.z);
      this.stripes.visible = kind === 'bomb';
      this.door.visible = kind === 'door';
      this.doorT = s.open && kind === 'door' ? Math.min(1, this.doorT + dt * 2) : 0;
      this.door.rotation.y = -this.doorT * 1.9;
      if (kind === 'bomb' && live && !s.open && s.bomb.by >= 0) beam(lay.v.x, lay.v.z);
    }
    // Core and its beacon
    const escort = kind === 'escort' && !!lay;
    this.core.visible = escort && o.state !== 'failed';
    this.beacon.visible = escort;
    if (escort && lay) {
      const c = s.core;
      const k = 1 - Math.exp(-12 * dt);
      c.rx += (c.x - c.rx) * k;
      c.rz += (c.z - c.rz) * k;
      this.core.position.set(c.rx, 0, c.rz);
      const ball = this.core.getObjectByName('ball')!;
      ball.rotation.x = (c.spin = c.spin + Math.hypot(c.x - c.rx, c.z - c.rz) * 0.2) * 1.3;
      ball.rotation.y += dt * (c.moving ? 3 : 0.6);
      this.coreRing.rotation.x = Math.PI / 2 + Math.sin(t * 2) * 0.3;
      this.coreRing.rotation.z += dt * (c.moving ? 4 : 1);
      this.coreMat.uniforms.uColor.value.set(o.attacked && blink(6) ? '#ef7d57' : '#73eff7');
      this.beacon.position.set(lay.b.x, 0, lay.b.z);
      if (live) beam(lay.b.x, lay.b.z);
    }
    // Bomb
    const bombOn = kind === 'bomb' && !!lay && (o.active || s.bomb.fuse >= 0);
    this.bomb.visible = bombOn;
    if (bombOn) {
      const b = s.bomb;
      const carrier = b.by >= 0 ? g.heroes[b.by] : undefined;
      let x = b.x;
      let z = b.z;
      let y = 0;
      if (carrier && !carrier.player.dead) {
        x = carrier.player.rig.root.position.x;
        z = carrier.player.rig.root.position.z;
        y = 1.9 + Math.abs(Math.sin(t * 7)) * 0.08;
        if (carrier.petState.ranks.porter && carrier.petView) {
          const pet = carrier.petView.root.position;
          x = pet.x; z = pet.z; y = pet.y + 0.35;
        }
        b.rx = x;
        b.rz = z;
      } else {
        const k = 1 - Math.exp(-12 * dt);
        b.rx += (x - b.rx) * k;
        b.rz += (z - b.rz) * k;
        x = b.rx;
        z = b.rz;
      }
      this.bomb.position.set(x, y, z);
      const fast = b.fuse >= 0;
      this.bombLight.uniforms.uColor.value.set(blink(fast ? 10 : 2) ? '#ff004d' : '#5d275d');
      const sc = (fast ? 1 + Math.abs(Math.sin(t * 12)) * 0.12 : 1) * 1.3;
      this.bomb.scale.setScalar(carrier?.petState.ranks.porter ? sc * 0.55 : sc);
      if (live && b.by < 0 && !fast) beam(b.x, b.z);
    }
    this.beams.count = beams;
    commit(this.beams.instanceMatrix, beams);
    this.pylons.count = pylons;
    commit(this.pylons.instanceMatrix, pylons);
    if (this.pylons.instanceColor) commit(this.pylons.instanceColor, pylons);
    this.renderTether(g, s, t);
  }

  private renderTether(g: Game, s: CoopPlayState, t: number): void {
    let n = 0;
    let beads = 0;
    const on = settings.tetherVisual !== false && g.isCombatMode && !g.pvp;
    const hs = g.heroes;
    if (on && s.pairs) {
      for (let i = 0; i < hs.length && i < MAXH; i++) {
        for (let j = i + 1; j < hs.length && j < MAXH; j++) {
          if (!(s.pairs & (1 << pairIndex(i, j)))) continue;
          const a = hs[i].player.rig.root.position;
          const b = hs[j].player.rig.root.position;
          const k = Math.min(linkStrength(s.link[i] ?? 0), linkStrength(s.link[j] ?? 0));
          this.col.set(hs[i].color);
          this.col2.set(hs[j].color);
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const len = Math.hypot(dx, dz);
          if (len < 0.3) continue;
          this.dir.set(dx / len, 0, dz / len);
          const thick = 0.13 + 0.1 * k;
          const amp = access.reduceFlash ? 0.05 : 0.12 + 0.1 * (1 - k);
          for (let q = 0; q < SEGS; q++) {
            const f0 = q / SEGS;
            const f1 = (q + 1) / SEGS;
            const wave = (f: number) => Math.sin(f * Math.PI) * (Math.sin(t * 9 + f * 12 + i * 2) * amp + 0.15);
            const y0 = 1.15 + wave(f0);
            const y1 = 1.15 + wave(f1);
            const x0 = a.x + dx * f0;
            const z0 = a.z + dz * f0;
            const segLen = Math.hypot(len / SEGS, y1 - y0);
            this.v.set(x0 + (dx / SEGS) * 0.5, (y0 + y1) / 2, z0 + (dz / SEGS) * 0.5);
            // Orient the unit box's z along the segment.
            this.sc.set(dx / SEGS, y1 - y0, dz / SEGS).normalize();
            this.q.setFromUnitVectors(FWD, this.sc);
            this.m4.compose(this.v, this.q, this.sc.set(thick, thick, segLen * 1.05));
            this.tether.setMatrixAt(n, this.m4);
            this.m4.compose(this.v, this.q, this.sc.set(thick * 0.4, thick * 0.4, segLen * 1.05));
            this.tetherCore.setMatrixAt(n, this.m4);
            this.tether.setColorAt(n, this.col3.copy(this.col).lerp(this.col2, (f0 + f1) / 2));
            n++;
          }
          // Two bright beads run along the link (faster as it grows).
          for (let q = 0; q < 2 && beads < PAIRS * 2; q++) {
            const f = (t * (0.5 + k) + q * 0.5 + i * 0.13) % 1;
            this.v.set(a.x + dx * f, 1.15 + Math.sin(f * Math.PI) * 0.15, a.z + dz * f);
            const r = 0.2 + 0.12 * k;
            this.m4.compose(this.v, this.q.identity(), this.sc.set(r, r, r));
            this.beads.setMatrixAt(beads++, this.m4);
          }
        }
      }
    }
    this.tether.count = this.tetherCore.count = n;
    this.beads.count = beads;
    commit(this.beads.instanceMatrix, beads);
    commit(this.tether.instanceMatrix, n);
    commit(this.tetherCore.instanceMatrix, n);
    if (this.tether.instanceColor) commit(this.tether.instanceColor, n);
  }
}
const FWD = new THREE.Vector3(0, 0, 1);

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    g.computeVertexNormals();
    pos.push(...(g.getAttribute('position').array as Float32Array));
    col.push(...(g.getAttribute('color').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

// ---------------------------------------------------------------- HUD

const CSS = `
#cp-link {
  position: relative;
  min-width: 190px;
  padding: var(--p) calc(3 * var(--p)) calc(2 * var(--p));
  --bg: var(--navy);
  --hi: var(--blue);
  --lo: var(--ink);
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--lo),
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink);
  pointer-events: none;
  text-shadow: var(--outline);
}
#cp-link .h { display: flex; justify-content: space-between; gap: 10px; font: 10px var(--label); letter-spacing: 1px; color: var(--cyan); }
#cp-link .s { font: 13px var(--font); color: var(--white); }
#cp-link .bar { margin-top: var(--p); height: var(--p); background: var(--ink); }
#cp-link .bar div { height: 100%; background: var(--cyan); }
#cp-link.max { --hi: var(--cyan); }
#cp-link.max .bar div { background: var(--yellow); }
#cp-prompt {
  position: absolute;
  left: 50%;
  bottom: 168px;
  transform: translateX(-50%);
  zoom: var(--ui);
  padding: var(--p) calc(3 * var(--p));
  --bg: var(--ink);
  background-color: var(--bg);
  box-shadow: 0 calc(-1 * var(--p)) 0 0 var(--ink), 0 var(--p) 0 0 var(--ink), calc(-1 * var(--p)) 0 0 0 var(--ink), var(--p) 0 0 0 var(--ink), inset 0 calc(-1 * var(--p)) 0 0 var(--slate);
  font: 16px var(--font);
  color: var(--white);
  text-shadow: var(--outline);
  pointer-events: none;
  white-space: nowrap;
}
#cp-prompt.carry { color: var(--lime); }
#cp-prompt.pop { animation: cppop 0.3s steps(2); }
@keyframes cppop { 0% { transform: translateX(-50%) translateY(calc(-2 * var(--p))); } 100% { transform: translateX(-50%); } }
#cp-marks { position: absolute; inset: 0; pointer-events: none; }
#cp-marks .mk {
  position: absolute;
  left: 0;
  top: 0;
  font: 11px var(--label);
  letter-spacing: 1px;
  color: var(--ink);
  text-shadow: none;
  white-space: nowrap;
}
#cp-marks .mk b {
  display: block;
  transform: translate(-50%, -100%);
  padding: 1px calc(2 * var(--p));
  background: var(--yellow);
  box-shadow: 0 calc(-1 * var(--p)) 0 0 var(--ink), 0 var(--p) 0 0 var(--ink), calc(-1 * var(--p)) 0 0 0 var(--ink), var(--p) 0 0 0 var(--ink);
  font-weight: normal;
}
#cp-marks .mk.ok b { background: var(--lime); }
#cp-marks .mk.hot b { background: var(--orange); color: var(--white); }
#cp-marks .mk.cy b { background: var(--cyan); }
#cp-marks .mk i {
  position: absolute;
  left: -7px;
  top: -7px;
  width: 14px;
  height: 14px;
  background: var(--yellow);
  clip-path: polygon(0 0, 100% 50%, 0 100%, 25% 50%);
}
#cp-marks .mk.ok i { background: var(--lime); }
#cp-marks .mk.hot i { background: var(--orange); }
#cp-marks .mk.cy i { background: var(--cyan); }
`;

interface Mark {
  x: number;
  z: number;
  y: number;
  text: string;
  cls: string;
}

class CoopHud {
  private link: HTMLElement | null = null;
  private prompt: HTMLElement | null = null;
  private marks: HTMLElement | null = null;
  private pool: HTMLElement[] = [];
  private lastLink = '';
  private lastPrompt = '';
  private v = new THREE.Vector3();
  private list: Mark[] = [];

  private mount(): boolean {
    if (this.link) return true;
    const root = document.getElementById('ingame');
    if (!root) return false;
    if (!document.getElementById('coopplay-css')) {
      const st = document.createElement('style');
      st.id = 'coopplay-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.link = document.createElement('div');
    this.link.id = 'cp-link';
    this.link.hidden = true;
    const goals = document.getElementById('goals');
    if (goals) goals.insertBefore(this.link, document.getElementById('spice'));
    else root.append(this.link);
    this.prompt = document.createElement('div');
    this.prompt.id = 'cp-prompt';
    this.prompt.hidden = true;
    this.marks = document.createElement('div');
    this.marks.id = 'cp-marks';
    root.append(this.marks, this.prompt);
    return true;
  }

  update(g: Game, s: CoopPlayState, objOn: boolean): void {
    if (!this.mount()) return;
    const combat = g.isCombatMode && g.mode !== 'title' && !g.pvp && g.screens.current === 'none';
    const me = g.hero;
    // Buddy link panel.
    const lt = combat && g.heroes.length > 1 ? (s.link[me.index] ?? 0) : 0;
    let key = '';
    if (lt > 0 && !me.player.dead) {
      const b = tetherBonus(lt);
      const full = lt >= tetherTuning.ramp;
      key = `${Math.round(b.damage * 100)}|${b.regen.toFixed(1)}|${Math.round(linkStrength(lt) * 10)}|${full}`;
      if (key !== this.lastLink) {
        this.link!.innerHTML = localizeHtml(
          `<div class="h"><span>⚡ BUDDY LINK</span><span>${full ? 'MAX' : ''}</span></div>` +
            `<div class="s">+${Math.round(b.damage * 100)}% DAMAGE · +${b.regen.toFixed(1)} LIFE/S</div>` +
            `<div class="bar"><div style="width:${Math.round(linkStrength(lt) * 100)}%"></div></div>`,
        );
        this.link!.classList.toggle('max', full);
      }
    }
    this.link!.hidden = !key;
    this.lastLink = key;
    // Carry prompt.
    let pr = '';
    let carry = false;
    if (combat && g.heroes.length > 1) {
      const held = s.carriedBy.indexOf(me.index);
      const by = s.carriedBy[me.index] ?? -1;
      if (me.player.dead && by >= 0) pr = `${g.heroes[by]?.name.toUpperCase() ?? 'A TEAMMATE'} IS CARRYING YOU TO SAFETY`;
      else if (!me.player.dead && held >= 0) {
        pr = `${prompt('interact')} PUT ${g.heroes[held]?.name.toUpperCase() ?? 'THEM'} DOWN`;
        carry = true;
      } else if (!me.player.dead) {
        const o = downedNear(g, s, me);
        if (o) pr = `${prompt('interact')} CARRY ${o.name.toUpperCase()}`;
        else if (s.bomb.by === me.index && s.kind === 'bomb' && objOn) pr = `${prompt('interact')} DROP THE BOMB`;
      }
    }
    if (pr !== this.lastPrompt) {
      this.lastPrompt = pr;
      this.prompt!.hidden = !pr;
      if (pr) {
        this.prompt!.innerHTML = localizeHtml(pr);
        this.prompt!.className = carry ? 'carry pop' : 'pop';
      }
    }
    // Objective markers.
    const list = this.list;
    list.length = 0;
    const o = g.toys.objective;
    if (combat && objOn && o.active && s.lay) this.collect(g, s, list);
    this.place(g, list);
  }

  private collect(g: Game, s: CoopPlayState, out: Mark[]): void {
    const L = s.lay!;
    const o = g.toys.objective;
    const add = (x: number, z: number, y: number, text: string, cls = '') => out.push({ x, z, y, text, cls });
    if (s.kind === 'door') {
      add(L.a.x, L.a.z, 1.6, s.held[0] ? 'A: HELD' : 'SWITCH A', s.held[0] ? 'ok' : '');
      add(L.b.x, L.b.z, 1.6, s.held[1] ? 'B: HELD' : 'SWITCH B', s.held[1] ? 'ok' : '');
      add(L.v.x, L.v.z, 3, 'VAULT', 'cy');
    } else if (s.kind === 'zones') {
      add(L.a.x, L.a.z, 1, s.held[0] ? 'ZONE A: HELD' : 'ZONE A', s.held[0] ? (o.attacked ? 'hot' : 'ok') : 'cy');
      add(L.b.x, L.b.z, 1, s.held[1] ? 'ZONE B: HELD' : 'ZONE B', s.held[1] ? (o.attacked ? 'hot' : 'ok') : 'cy');
    } else if (s.kind === 'escort') {
      add(s.core.rx, s.core.rz, 2.4, `CORE ${Math.round(o.hp)}%`, o.attacked ? 'hot' : s.core.moving ? 'ok' : 'cy');
      add(L.b.x, L.b.z, 3.6, 'BEACON', 'ok');
    } else if (s.kind === 'bomb') {
      const b = s.bomb;
      if (b.fuse >= 0) add(b.rx, b.rz, 2, `BOOM IN ${Math.ceil(b.fuse)}`, 'hot');
      else if (b.by >= 0) add(b.rx, b.rz, 3.4, `BOMB: ${g.heroes[b.by]?.name.toUpperCase() ?? '?'}`, 'hot');
      else add(b.rx, b.rz, 1.6, 'BOMB', 'hot');
      if (!s.open) add(L.v.x, L.v.z, 3, 'BUNKER', '');
      const boss = bossTarget(g);
      if (boss && b.fuse < 0) add(boss.x, boss.z, 4.5, 'BOMB THE BOSS!', '');
    }
  }

  private place(g: Game, list: Mark[]): void {
    const box = this.marks!;
    while (this.pool.length < list.length) {
      const el = document.createElement('div');
      el.className = 'mk';
      el.innerHTML = '<b></b><i hidden></i>';
      box.append(el);
      this.pool.push(el);
    }
    const W = innerWidth;
    const H = innerHeight;
    for (let i = 0; i < this.pool.length; i++) {
      const el = this.pool[i];
      const m = list[i];
      if (!m) {
        if (!el.hidden) el.hidden = true;
        continue;
      }
      el.hidden = false;
      this.v.set(m.x, m.y, m.z).project(g.cam.camera);
      let sx = ((this.v.x + 1) / 2) * W;
      let sy = ((1 - this.v.y) / 2) * H;
      const behind = this.v.z > 1;
      const off = behind || sx < 24 || sx > W - 24 || sy < 40 || sy > H - 24;
      const arrow = el.lastElementChild as HTMLElement;
      if (off) {
        const cx = W / 2;
        const cy = H / 2;
        let dx = sx - cx;
        let dy = sy - cy;
        if (behind) {
          dx = -dx;
          dy = -dy;
        }
        // Keep clear of the HUD corners (as the objective arrow does).
        const mx = Math.max(150, W * 0.2);
        const my = Math.max(120, H * 0.24);
        const k = Math.min((cx - mx) / Math.max(1e-3, Math.abs(dx)), (cy - my) / Math.max(1e-3, Math.abs(dy)));
        sx = cx + dx * k;
        sy = cy + dy * k;
        arrow.hidden = false;
        arrow.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(2)}rad) translate(22px, 0)`;
      } else if (!arrow.hidden) arrow.hidden = true;
      el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
      const cls = 'mk' + (m.cls ? ' ' + m.cls : '');
      if (el.className !== cls) el.className = cls;
      const label = el.firstElementChild as HTMLElement;
      const text = localize(m.text);
      if (label.textContent !== text) label.textContent = text;
    }
  }
}

/** Debug panel / tests. */
export function coopPlayDebug(g: Game): CoopPlayState {
  return coopPlayState(g);
}

export { isCoopKind };
