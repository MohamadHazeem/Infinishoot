/**
 * Bosses lane, wave 1: boss rematches, the Titan and the boss duel.
 * Game functions (`this` is the Game), called from src/game/systems/bossFight.ts
 * (boss api, step, net, render, HUD), spawning.ts (which boss a stage gets),
 * runFlow.ts (world reset) and render.ts (the camera). Per-game state lives in a
 * WeakMap here, so Game only gains the documented `bossDuel` field.
 *
 *  - Rematches: from loop 2 a boss you beat this run comes back remixed
 *    (src/data/bossRemix.ts; brains read `def.remix` in src/game/bosses.ts).
 *  - The Titan (src/game/titan.ts): one boss slot per loop from loop 2. Its body
 *    adds wall colliders on every machine, its weak points are hidden enemies
 *    pinned to the body, the camera pulls back while it stands.
 *  - The duel (src/game/bossDuel.ts): a stage boss's last phase clears the horde
 *    and closes a ring of fire; `game.bossDuel` is set on every machine.
 */
import type { Game } from '../game';
import { ENEMIES, type EnemyDef } from '../../data/enemies';
import { TITAN_CORE_SHARE, TITAN_PARTS, remixBase, stageBossId } from '../../data/bossRemix';
import {
  SWEEP_IDLE,
  TITAN_ORDER,
  TitanState,
  TitanView,
  beamOrigin,
  handPos,
  packTitan,
  partPos,
  restAngle,
  segDist,
  shoulderPos,
  sweepEnd,
  sweepLength,
  sweepPose,
  sweeping,
  titanBoxes,
  titanLayout,
  titanPhaseOf,
  titanTuning,
  unpackTitan,
  type TitanNet,
} from '../titan';
import { DuelView, duelRadius, duelStart, duelTuning, keepInside, packDuel, unpackDuel, type DuelNet } from '../bossDuel';
import type { Enemy } from '../enemies';
import { StaticBoxGrid } from '../../core/spatialHash';
import type { AABB } from '../../world/collision';
import { smashCover } from '../coverBreak';
import { PickupType } from '../pickups';
import { access } from '../settings';
import { Team } from '../bullets';
import { bossLike } from '../bossRules';
import { setBossLaneHud } from '../../ui/bossLaneHud';
import type { BossBar } from './bossFight';

/** Test links: force the Titan or a remix as the stage boss; `move` pins the Titan's attack (screenshots). */
export const bossLaneForce = { titan: false, remix: false, move: '' as TitanState['move'] };

/** What the boss extras carry for this lane (inside BossNet, see bossFight.ts). */
export interface BossLaneNet {
  t?: TitanNet | null;
  d?: DuelNet | null;
}

interface LaneState {
  /** Base ids of the stage bosses beaten this run. */
  beaten: Set<string>;
  runSeed: number;
  runTime: number;
  /** Base id of the stage boss being fought (counted as beaten when the stage clears). */
  pendingBase: string;
  titan: TitanState | null;
  /** Host: the Titan's core enemy and its weak points. */
  core: Enemy | null;
  parts: (Enemy | null)[];
  /** Body colliders currently added to the arena, and which arena they're in. */
  walls: AABB[];
  wallsArena: unknown;
  wallsKey: string;
  view: TitanView | null;
  /** The last Titan pose, for its fall. */
  fallen: TitanState | null;
  duelView: DuelView | null;
  /** Host: uid of the boss whose duel already ran. */
  duelUid: number;
  duelTick: number;
  /** Every machine: uid of the duel whose camera beat played. */
  duelBeat: number;
  firstQuake: boolean;
}

const states = new WeakMap<Game, LaneState>();
function lane(g: Game): LaneState {
  let s = states.get(g);
  if (!s) {
    s = { beaten: new Set(), runSeed: NaN, runTime: 0, pendingBase: '', titan: null, core: null, parts: [], walls: [], wallsArena: null, wallsKey: '', view: null, fallen: null, duelView: null, duelUid: 0, duelTick: 0, duelBeat: 0, firstQuake: true };
    states.set(g, s);
  }
  return s;
}

const P = { x: 0, z: 0 };
const Q = { x: 0, z: 0 };
const POSE = { k: 0, lift: 0, hurt: false, tele: 0 };

/** A new run (new seed, or the run clock went back) forgets the bosses beaten. */
function trackRun(g: Game, L: LaneState): void {
  if (L.runSeed !== g.seed || g.runTime + 1e-6 < L.runTime) {
    L.beaten.clear();
    L.pendingBase = '';
  }
  L.runSeed = g.seed;
  L.runTime = g.runTime;
}

/** Bosses beaten this run (base ids). */
export function bossesBeaten(this: Game): ReadonlySet<string> {
  return lane(this).beaten;
}

// ------------------------------------------------------------------ which boss

/** spawnBoss hook: the boss this stage actually gets (a remix, the Titan or the rotation boss `def`). */
export function stageBossDef(this: Game, def: EnemyDef): EnemyDef {
  const L = lane(this);
  trackRun(this, L);
  L.pendingBase = remixBase(def.id);
  const id = stageBossId(this.stage, def.id, L.beaten, { titan: bossLaneForce.titan, remix: bossLaneForce.remix });
  return ENEMIES[id] ?? def;
}

/** Remix entrance: a REMATCH! toast under the title card. */
export function remixArrival(this: Game, e: Enemy): void {
  if (!e.def.remixOf) return;
  this.vfx.toast(`REMATCH! ${ENEMIES[e.def.remixOf]?.name.toUpperCase() ?? ''} IS BACK, REMIXED`, 3);
}

// ------------------------------------------------------------------ Titan: spawn and brain (host)

/** Host: the Titan climbs out of the ground in front of the heroes. */
export function spawnTitan(this: Game, def: EnemyDef): void {
  const L = lane(this);
  const heroes = this.aliveHeroes.length ? this.aliveHeroes : [this.hero];
  let hx = 0;
  let hz = 0;
  for (const h of heroes) {
    hx += h.player.x;
    hz += h.player.z;
  }
  hx /= heroes.length;
  hz /= heroes.length;
  const half = this.arena.halfSize;
  const cx = Math.round(Math.max(-(half - 21), Math.min(half - 21, hx)) * 10) / 10;
  const cz = Math.round(Math.max(-(half - 9), Math.min(half - 12, hz - titanTuning.ahead)) * 10) / 10;
  const s = new TitanState();
  s.cx = cx;
  s.cz = cz;
  const lay = titanLayout;
  const core = this.enemies.spawn(def, cx + lay.core.x, cz + lay.core.z, this.spawnOpts({ hpMul: this.director.bossHpMul, instant: true }));
  core.under = true; // sealed until its weak points are broken
  s.uid = core.uid;
  L.parts = [];
  TITAN_PARTS.forEach((p, i) => {
    partPos(i, cx, cz, s.arm, P);
    const pd = ENEMIES[p.kind === 'plate' ? 'titan_plate' : p.kind === 'hand' ? 'titan_hand' : 'titan_eye'];
    const e = this.enemies.spawn(pd, P.x, P.z, this.spawnOpts({ instant: true }));
    e.hp = e.maxHp = Math.max(1, Math.round(core.maxHp * p.share));
    e.dmgMul = core.dmgMul;
    e.under = p.group > 1;
    s.partUid[i] = e.uid;
    L.parts.push(e);
  });
  L.titan = s;
  L.core = core;
  L.fallen = null;
  L.firstQuake = true;
  this.boss = core;
  // Cover where the body comes up breaks apart.
  for (const b of titanBoxes(cx, cz, true)) {
    for (let x = b.minX + 1; x < b.maxX; x += 3) for (let z = b.minZ + 1; z < b.maxZ; z += 3) smashCover(this, x, z, 1.5);
  }
  this.startBossIntro(core);
  this.vfx.shake(NaN, NaN, 0.8);
  this.vfx.sound('bossSlam', cx, cz + 4, 0.6);
  for (let k = -3; k <= 3; k++) {
    this.vfx.burst(cx + k * 2.4, 0.5, cz + 2.2, { count: 10, color: '#94b0c2', color2: '#566c86', speed: [3, 9], size: [0.3, 0.6], life: [0.6, 1.1], up: 9, gravity: 16, debris: 4 });
  }
  this.vfx.scar(cx, cz + 2.5, 6, '#333c57', 40);
}

/** Nearest living hero to (x, z), or null. */
function nearestHero(g: Game, x: number, z: number) {
  let best = null as Game['heroes'][number] | null;
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

/** BossApi.titan: one step of the Titan's brain (host, from Enemies.update). */
export function titanStep(this: Game, e: Enemy, dt: number): void {
  const L = lane(this);
  const s = L.titan;
  if (!s || s.uid !== e.uid) return;
  const T = titanTuning;
  if (e.roarT > 0) e.roarT = Math.max(0, e.roarT - dt); // its entrance idle doesn't apply: the body rises instead
  if (s.rise < 1) {
    s.rise = Math.min(1, s.rise + dt / T.rise);
    if (this.stepN % 20 === 0) {
      this.vfx.shake(NaN, NaN, 0.25);
      const x = s.cx + this.rng.range(-9, 9);
      this.vfx.burst(x, 0.3, s.cz + this.rng.range(-2, 5), { count: 6, color: '#94b0c2', color2: '#5d275d', speed: [2, 6], size: [0.25, 0.5], life: [0.5, 0.9], up: 7, gravity: 14, debris: 2 });
    }
  }
  // Pick the next attack.
  if (!s.move && s.rise >= 1) {
    s.cool -= dt;
    const h = nearestHero(this, s.cx, s.cz + 3);
    if (s.cool <= 0 && h && bossLaneForce.move) startMove(this, s, bossLaneForce.move, h.player.x);
    else if (s.cool <= 0 && h) startMove(this, s, TITAN_ORDER[Math.min(3, s.phase - 1)][s.step++ % TITAN_ORDER[Math.min(3, s.phase - 1)].length], h.player.x);
  }
  // Arms.
  for (let a = 0; a < 2; a++) {
    if (!sweeping(s.sweepT[a])) continue;
    const side = a === 0 ? -1 : 1;
    s.sweepT[a] += dt;
    const done = sweepPose(s.sweepT[a], POSE);
    s.arm[a] = restAngle(side) + (sweepEnd(side) - restAngle(side)) * POSE.k;
    if (s.move !== 'quake') s.lift[a] = POSE.lift;
    if (POSE.hurt) armHits(this, s, e, a);
    if (s.sweepT[a] - dt < T.sweepTele && s.sweepT[a] >= T.sweepTele) {
      handPos(s.cx, s.cz, side, s.arm[a], P);
      this.vfx.sound('whoosh', P.x, P.z, 0.7);
      this.vfx.sound('bossSlam', P.x, P.z, 0.8);
      this.vfx.shake(P.x, P.z, 0.4);
    }
    if (done) {
      s.sweepT[a] = SWEEP_IDLE;
      s.arm[a] = restAngle(side);
      s.lift[a] = 0;
    }
  }
  // Beam.
  if (s.beamMode) beamStep(this, s, e, dt);
  // Moves end when their parts have played out.
  if (s.move) {
    s.moveT += dt;
    if (s.move === 'quake') quakeStep(this, s, e);
    const busy = sweeping(s.sweepT[0]) || sweeping(s.sweepT[1]) || s.beamMode > 0 || (s.move === 'quake' && s.moveT < 1.2) || (s.move === 'debris' && s.moveT < 1.2);
    if (!busy) {
      s.move = '';
      s.cool = Math.max(s.cool, T.pace[Math.min(3, s.phase - 1)]);
    }
  }
  pinTitan(L);
}

function startMove(g: Game, s: TitanState, move: TitanState['move'], tx: number): void {
  const T = titanTuning;
  s.move = move;
  s.moveT = 0;
  const near = tx < s.cx ? 0 : 1;
  if (move === 'sweep' || move === 'sweep2') {
    s.sweepT[near] = 0;
    s.hit[near] = 0;
    if (move === 'sweep2') {
      s.sweepT[1 - near] = -T.stagger;
      s.hit[1 - near] = 0;
    }
    shoulderPos(s.cx, s.cz, near ? 1 : -1, P);
    g.vfx.sound('bossWindup', P.x, P.z);
    g.vfx.sound('telegraph', P.x, P.z);
  } else if (move === 'beam') {
    s.beamMode = 1;
    s.beamT = 0;
    beamOrigin(s, P);
    const h = nearestHero(g, P.x, P.z);
    if (h) s.beamAng = Math.atan2(h.player.z - P.z, h.player.x - P.x);
    g.vfx.sound('chargerWindup', P.x, P.z);
    g.vfx.sound('telegraph', P.x, P.z);
  } else if (move === 'debris') {
    const n = T.debris[Math.min(3, s.phase - 1)];
    for (const h of g.aliveHeroes) {
      const p = h.player;
      g.enemyCtx.strike(p.x + p.vel.x * 0.5, p.z + p.vel.z * 0.5, 2, 1.4, T.debrisDamage);
      for (let i = 0; i < n; i++) {
        const a = g.rng.range(0, Math.PI * 2);
        const d = g.rng.range(2.5, 8);
        g.enemyCtx.strike(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 2, 1 + g.rng.range(0, 0.9), T.debrisDamage);
      }
    }
    g.vfx.sound('bossRoar', s.cx, s.cz);
    g.vfx.shake(NaN, NaN, 0.45);
    for (let k = 0; k < 6; k++) g.vfx.burst(s.cx + g.rng.range(-6, 6), 9, s.cz + g.rng.range(-5, 0), { count: 5, color: '#94b0c2', color2: '#566c86', speed: [3, 8], size: [0.3, 0.6], life: [0.6, 1], up: 10, gravity: 18, debris: 3 });
  } else if (move === 'quake') {
    g.vfx.sound('bossWindup', s.cx, s.cz);
    if (g.bossDuel === null && (lane(g).firstQuake || s.phase >= 4)) g.vfx.toast('QUAKE! DASH THROUGH THE RINGS');
    lane(g).firstQuake = false;
  }
}

/** Quake: both arms rise, then the Titan slams its chest: shockwave rings (dash through). */
function quakeStep(g: Game, s: TitanState, e: Enemy): void {
  const up = Math.min(1, s.moveT / 0.9);
  for (let a = 0; a < 2; a++) if (!sweeping(s.sweepT[a])) s.lift[a] = s.moveT < 0.9 ? up * 0.9 : Math.max(0, 0.9 - (s.moveT - 0.9) * 6);
  const t0 = s.moveT - 1 / 60;
  if (t0 < 0.9 && s.moveT >= 0.9) {
    const x = s.cx;
    const z = s.cz + titanLayout.head.z + 1;
    g.bossApi.shockwave(e, x, z, 0);
    if (s.phase >= 3) g.bossApi.shockwave(e, x, z, 0.5);
    g.vfx.sound('bossSlam', x, z);
    g.vfx.shake(NaN, NaN, 0.8);
    g.vfx.burst(x, 0.4, z, { count: 24, color: '#94b0c2', color2: '#ffcd75', speed: [4, 10], size: [0.3, 0.6], life: [0.5, 0.9], up: 8, gravity: 16, debris: 6 });
  }
}

/** A sweeping arm hits heroes along it (dashing heroes slip through). */
function armHits(g: Game, s: TitanState, e: Enemy, a: number): void {
  const side = a === 0 ? -1 : 1;
  shoulderPos(s.cx, s.cz, side, P);
  handPos(s.cx, s.cz, side, s.arm[a], Q);
  for (const h of g.aliveHeroes) {
    const p = h.player;
    const bit = 1 << h.index;
    if (s.hit[a] & bit || p.dashing || p.invuln > 0) continue;
    if (segDist(p.x, p.z, P.x, P.z, Q.x, Q.z) < titanTuning.sweepWidth + p.radius) {
      s.hit[a] |= bit;
      g.hurtHero(h, titanTuning.sweepDamage * e.dmgMul, Q.x, Q.z, null, "The Titan's arm");
      g.vfx.shake(p.x, p.z, 0.5);
    }
  }
}

/** Eye beam: an aim line that tracks the nearest hero, then a beam that turns toward them. */
function beamStep(g: Game, s: TitanState, e: Enemy, dt: number): void {
  const T = titanTuning;
  s.beamT += dt;
  beamOrigin(s, P);
  const h = nearestHero(g, P.x, P.z);
  if (h) {
    const want = Math.atan2(h.player.z - P.z, h.player.x - P.x);
    let d = want - s.beamAng;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const turn = (s.beamMode === 1 ? (s.beamT < T.beamAim * 0.75 ? 6 : 0) : T.beamTurn) * dt; // locks just before it fires
    s.beamAng += Math.max(-turn, Math.min(turn, d));
  }
  if (s.beamMode === 1) {
    if (s.beamT >= T.beamAim) {
      s.beamMode = 2;
      s.beamT = 0;
      s.beamTick = 0;
      g.vfx.sound('thunder', P.x, P.z);
      g.vfx.shake(NaN, NaN, 0.35);
    }
    return;
  }
  // Firing: ticks hurt every hero on the beam.
  s.beamTick -= dt;
  if (s.beamTick <= 0) {
    s.beamTick = T.beamTick;
    const ex = P.x + Math.cos(s.beamAng) * T.beamLen;
    const ez = P.z + Math.sin(s.beamAng) * T.beamLen;
    for (const hh of g.aliveHeroes) {
      const p = hh.player;
      if (p.dashing || p.invuln > 0) continue;
      if (segDist(p.x, p.z, P.x, P.z, ex, ez) < T.beamWidth + p.radius) g.hurtHero(hh, T.beamDamage * e.dmgMul, P.x, P.z, null, "The Titan's eye beam");
    }
    // Scorch along the beam now and then (cosmetic, replayed on clients).
    if (g.stepN % 24 === 0) {
      const d = g.rng.range(4, T.beamLen * 0.7);
      g.vfx.burst(P.x + Math.cos(s.beamAng) * d, 0.3, P.z + Math.sin(s.beamAng) * d, { count: 6, color: '#ff3d5a', color2: '#ffcd75', speed: [2, 5], size: [0.15, 0.3], life: [0.3, 0.5], up: 4, gravity: 10 });
    }
  }
  if (s.beamT >= T.beamTime) s.beamMode = 0;
}

/** Hold the core and the weak points where the body is (after crowds and walls moved them). */
function pinTitan(L: LaneState): void {
  const s = L.titan;
  if (!s) return;
  const core = L.core;
  if (core && core.active && core.uid === s.uid) {
    core.x = core.px = s.cx + titanLayout.core.x;
    core.z = core.pz = s.cz + titanLayout.core.z;
    core.vx = core.vz = core.kx = core.kz = 0;
  }
  L.parts.forEach((e, i) => {
    if (!e || !e.active || e.uid !== s.partUid[i]) return;
    partPos(i, s.cx, s.cz, s.arm, P);
    e.x = e.px = P.x;
    e.z = e.pz = P.z;
    e.vx = e.vz = e.kx = e.kz = 0;
  });
}

// ------------------------------------------------------------------ host step

/** Host step (from updateBossFight): Titan bookkeeping, the duel, bosses beaten. */
export function updateBossLane(this: Game, dt: number): void {
  const L = lane(this);
  trackRun(this, L);
  if (L.pendingBase && this.mode === 'cleared') {
    L.beaten.add(L.pendingBase);
    L.pendingBase = '';
  }
  if (L.titan) updateTitan(this, L);
  syncTitanWalls(this, L);
  updateDuelHost(this, L, dt);
}

function updateTitan(g: Game, L: LaneState): void {
  const s = L.titan!;
  const core = L.core;
  if (!core || !core.active || core.uid !== s.uid) {
    titanFell(g, L);
    return;
  }
  pinTitan(L);
  const alive: boolean[] = [];
  let sum = 0;
  L.parts.forEach((e, i) => {
    const ok = !!e && e.active && e.uid === s.partUid[i] && e.hp > 0;
    alive.push(ok);
    if (ok) {
      sum += e!.hp;
      s.partHp[i] = Math.max(0.01, e!.hp / e!.maxHp);
    } else s.partHp[i] = 0;
  });
  alive.forEach((ok, i) => {
    if (ok || s.broken[i]) return;
    s.broken[i] = true;
    partBroken(g, s, i, alive);
  });
  const sealed = s.phase < 4; // the bar is the parts' life plus the core's until the core opens
  const phase = titanPhaseOf(alive);
  if (phase !== s.phase) titanPhase(g, L, phase);
  L.parts.forEach((e, i) => {
    if (e && alive[i]) e.under = TITAN_PARTS[i].group > s.phase;
  });
  core.phase = s.phase;
  core.under = s.phase < 4;
  core.enraged = s.phase > 1;
  if (sealed) core.hp = Math.round(core.maxHp * TITAN_CORE_SHARE) + sum;
}

function partBroken(g: Game, s: TitanState, i: number, alive: boolean[]): void {
  partPos(i, s.cx, s.cz, s.arm, P);
  const kind = TITAN_PARTS[i].kind;
  const color = kind === 'plate' ? '#94b0c2' : kind === 'hand' ? '#73eff7' : '#ff3d5a';
  g.vfx.burst(P.x, 2.5, P.z, { count: 36, color, color2: '#ffcd75', speed: [4, 12], size: [0.25, 0.55], life: [0.5, 1], up: 9, gravity: 16, debris: 10 });
  g.vfx.ring(P.x, P.z, 2, 8, color, 0.5);
  g.vfx.star(P.x, 2.5, P.z, 5, '#ffffff', 0.18);
  g.vfx.num(P.x, 4, P.z, 'WEAK POINT!', 'crit');
  g.vfx.sound('explode', P.x, P.z);
  g.vfx.sound('shieldBreak', P.x, P.z);
  g.vfx.shake(P.x, P.z, 0.7);
  g.juice.freeze(0.08);
  for (let k = 0; k < titanTuning.partGold; k++) g.pickups.spawn(PickupType.Bolt, P.x + g.rng.range(-1, 1), P.z + 1.5 + g.rng.range(-1, 1), 1);
  const left = alive.filter(Boolean).length;
  if (TITAN_PARTS.some((p, j) => p.group === TITAN_PARTS[i].group && alive[j])) g.vfx.toast(`WEAK POINT DOWN! ${left} LEFT`);
}

const TITAN_PHASE_LINES = ['', 'ARMOUR BROKEN: SMASH THE HAND CORES', 'HANDS DOWN: SHOOT THE EYE', 'THE CORE IS EXPOSED!'];

function titanPhase(g: Game, L: LaneState, phase: number): void {
  const s = L.titan!;
  s.phase = phase;
  s.cool = Math.max(s.cool, titanTuning.roar);
  const last = phase >= 4;
  g.vfx.banner(last ? 'FINAL PHASE!' : `PHASE ${phase}!`, TITAN_PHASE_LINES[phase] ?? '', 2.2);
  g.vfx.sound('bossPhase', s.cx, s.cz);
  g.vfx.sound('bossRoar', s.cx, s.cz, 0.8);
  g.vfx.shake(NaN, NaN, 0.9);
  g.vfx.flash(0.35);
  g.juice.freeze(0.12);
  if (last) {
    // The head cracks open: rubble flies and the core starts to glow.
    const x = s.cx + titanLayout.head.x;
    const z = s.cz + titanLayout.head.z;
    g.vfx.burst(x, 4, z, { count: 40, color: '#566c86', color2: '#ffcd75', speed: [4, 12], size: [0.3, 0.7], life: [0.6, 1.2], up: 10, gravity: 16, debris: 12 });
    g.vfx.ring(x, z, 3, 10, '#ffcd75', 0.6);
  }
  // A breather: the roar clears enemy bullets near the heroes.
  for (let i = 0; i < g.bullets.count; i++) if (g.bullets.team[i] === Team.Enemy) g.bullets.kill(i--);
}

/** The core died (or the Titan was removed): its body sinks back into the ground. */
function titanFell(g: Game, L: LaneState): void {
  const s = L.titan!;
  const killed = !!L.core && L.core.hp <= 0;
  for (const e of L.parts) if (e && e.active && TITAN_PARTS.some((_, i) => s.partUid[i] === e.uid)) g.enemies.kill(e);
  if (killed) {
    g.vfx.sound('bossSlam', s.cx, s.cz);
    for (let k = -3; k <= 3; k++) g.vfx.burst(s.cx + k * 2.4, 3, s.cz + g.rng.range(-3, 3), { count: 12, color: '#566c86', color2: '#ffcd75', speed: [3, 10], size: [0.3, 0.7], life: [0.7, 1.3], up: 9, gravity: 14, debris: 6, smoke: 4 });
  }
  L.fallen = s;
  if (L.view) L.view.fallT = 0;
  L.titan = null;
  L.core = null;
  L.parts = [];
}

/** Add or remove the Titan's body colliders (every machine); rebuilds the wall grid when they change. */
function syncTitanWalls(g: Game, L: LaneState): void {
  if (L.wallsArena !== g.arena) {
    L.walls = []; // that arena (and its colliders) is gone
    L.wallsKey = '';
    L.wallsArena = g.arena;
  }
  const s = L.titan;
  const on = !!s && s.rise >= titanTuning.wallsAt;
  const key = on ? `${s!.cx},${s!.cz},${s!.phase >= 4 ? 1 : 2}` : '';
  if (key === L.wallsKey) return;
  const cols = g.arena.colliders;
  for (const b of L.walls) {
    const k = cols.indexOf(b);
    if (k >= 0) cols.splice(k, 1);
  }
  L.walls = on ? titanBoxes(s!.cx, s!.cz, s!.phase < 4) : [];
  for (const b of L.walls) cols.push(b);
  L.wallsKey = key;
  g.walls = new StaticBoxGrid(cols);
}

// ------------------------------------------------------------------ duel (host)

function updateDuelHost(g: Game, L: LaneState, dt: number): void {
  const b = g.boss;
  if (!g.bossDuel && duelTuning.enabled && b && b.active && b.def.boss && b.def.behavior !== 'titan' && !g.pvp && g.mode === 'fight' && L.duelUid !== b.uid) {
    const last = (b.def.phases?.length ?? 0) + 1;
    if (b.phase >= last) startDuel(g, L, b);
  }
  const d = g.bossDuel;
  if (!d) return;
  if (!b || !b.active || b.uid !== d.uid || g.mode !== 'fight') {
    endDuel(g);
    return;
  }
  d.t += dt;
  d.r = duelRadius(d.r0, d.r1, d.t);
  g.director.hold = true;
  // The boss is held inside the ring.
  keepInside(b, b.radius, d.x, d.z, d.r);
  // Heroes outside burn.
  L.duelTick -= dt;
  if (L.duelTick > 0) return;
  L.duelTick = duelTuning.tick;
  for (const h of g.aliveHeroes) {
    const p = h.player;
    if (Math.hypot(p.x - d.x, p.z - d.z) <= d.r - p.radius * 0.3) continue;
    g.hurtHero(h, p.maxHp * duelTuning.dps * duelTuning.tick + h.stats.armor, d.x, d.z, null, 'The ring of fire');
    g.vfx.burst(p.x, 0.6, p.z, { count: 6, color: '#ef7d57', color2: '#ffcd75', speed: [2, 5], size: [0.15, 0.3], life: [0.3, 0.5], up: 5, gravity: 8 });
  }
}

function startDuel(g: Game, L: LaneState, b: Enemy): void {
  L.duelUid = b.uid;
  L.duelTick = duelTuning.delay;
  const heroes = g.aliveHeroes.map((h) => ({ x: h.player.x, z: h.player.z }));
  const st = duelStart(b, heroes, g.arena.halfSize);
  g.bossDuel = { uid: b.uid, x: st.x, z: st.z, r: st.r0, r0: st.r0, r1: st.r1, t: 0 };
  g.director.hold = true;
  // Everything else clears out: the horde vanishes in a puff (no drops), the boss's hives stay.
  let puffs = 0;
  for (const e of g.enemies.list) {
    if (!e.active || e === b || bossLike(e) || e.def.id === 'hive' || e.pvpOwner >= 0) continue;
    if (puffs < 40 && g.aliveHeroes.some((h) => Math.hypot(h.player.x - e.x, h.player.z - e.z) < 26)) {
      puffs++;
      g.vfx.burst(e.x, 0.6, e.z, { count: 5, color: '#f4f4f4', color2: e.def.bodyColor, speed: [1, 4], size: [0.2, 0.4], life: [0.3, 0.6], up: 3, drag: 3 });
    }
    g.enemies.kill(e);
  }
  for (let i = 0; i < g.bullets.count; i++) if (g.bullets.team[i] === Team.Enemy) g.bullets.kill(i--);
  g.vfx.banner('SHOWDOWN!', `${b.def.name.toUpperCase()} · ONE ON ONE`, 2.4);
  g.vfx.toast('THE RING OF FIRE CLOSES IN: STAY INSIDE!', 3);
  g.vfx.sound('bossPhase', NaN, NaN);
  g.vfx.sound('wave', st.x, st.z);
  g.vfx.shake(NaN, NaN, 0.7);
  g.vfx.flash(0.3); // the HUD scales flashes down with REDUCE FLASHING
  g.vfx.ring(st.x, st.z, st.r0 * 2, 1.02, '#ef7d57', 0.5);
}

function endDuel(g: Game): void {
  g.bossDuel = null;
  g.director.hold = false;
}

// ------------------------------------------------------------------ net

/** Host: this lane's boss extras for the snapshot. */
export function bossLaneNet(this: Game): BossLaneNet {
  const L = lane(this);
  return { t: L.titan ? packTitan(L.titan) : null, d: this.bossDuel ? packDuel(this.bossDuel) : null };
}

/** Client: mirror the Titan and the duel. */
export function applyBossLaneNet(this: Game, n: BossLaneNet): void {
  const L = lane(this);
  if (n.t) {
    if (!L.titan || L.titan.uid !== n.t.u) {
      L.titan = new TitanState();
      L.fallen = null;
      if (L.view) L.view.fallT = -1;
    }
    unpackTitan(n.t, L.titan);
  } else if (L.titan) {
    L.fallen = L.titan;
    L.titan = null;
    if (L.view) L.view.fallT = 0;
  }
  syncTitanWalls(this, L); // the body blocks this machine's own movement too
  if (n.d) {
    const d = unpackDuel(n.d);
    if (this.bossDuel && this.bossDuel.uid === d.uid) Object.assign(this.bossDuel, d);
    else this.bossDuel = d;
  } else this.bossDuel = null;
}

/** World reset (clearWorld, every machine): no Titan, no duel. */
export function clearBossLane(this: Game): void {
  const L = lane(this);
  L.titan = null;
  L.core = null;
  L.parts = [];
  L.fallen = null;
  syncTitanWalls(this, L);
  L.view?.hide();
  L.duelView?.hide();
  this.bossDuel = null;
  this.director.hold = false;
}

// ------------------------------------------------------------------ render, camera, HUD (every machine)

export function renderBossLane(this: Game, frameDt: number, paused: boolean): void {
  const L = lane(this);
  const dt = paused ? 0 : frameDt;
  const client = this.role === 'client';
  const s = L.titan;
  if (client) {
    // Between snapshots: telegraph clocks run on, walls follow the mirrored body.
    if (s) for (let a = 0; a < 2; a++) if (sweeping(s.sweepT[a]) && s.sweepT[a] < sweepLength()) s.sweepT[a] += dt;
    syncTitanWalls(this, L);
    const d = this.bossDuel;
    if (d && dt > 0) {
      d.t += dt;
      d.r = duelRadius(d.r0, d.r1, d.t);
    }
  }
  const calm = access.reduceFlash;
  if (s || (L.view && L.view.fallT >= 0 && L.fallen)) {
    L.view ??= new TitanView(this.scene);
    const v = L.view;
    if (s) {
      v.fallT = -1;
      v.update(s, this.animTime, dt, (i) => titanFlash(this, L, s, i), calm);
    } else {
      v.fallT += dt;
      if (v.fallT > 3) {
        v.hide();
        L.fallen = null;
      } else v.update(L.fallen!, this.animTime, dt, () => 0, calm);
    }
  }
  // The duel: ring of fire, plus a camera beat when it starts.
  const d = this.bossDuel;
  if (d || L.duelView) {
    L.duelView ??= new DuelView(this.scene);
    L.duelView.update(d, this.animTime, dt, calm);
  }
  if (d && L.duelBeat !== d.uid) {
    L.duelBeat = d.uid;
    const b = this.enemies.list.find((e) => e.active && e.uid === d.uid) ?? (client ? this.netEnemies.get(d.uid) : undefined);
    if (b) this.cam.killCam(b.x, b.z);
  }
}

function titanFlash(g: Game, L: LaneState, s: TitanState, i: number): number {
  const uid = i === 5 ? s.uid : s.partUid[i];
  const e = g.role === 'client' ? g.netEnemies.get(uid) : i === 5 ? L.core : L.parts[i];
  return e && e.active && e.uid === uid ? e.flash : 0;
}

/** After the camera director: pull the camera back while a Titan stands, so its whole body reads. */
export function bossCamera(this: Game): void {
  const L = lane(this);
  const s = L.titan;
  if (!s || !this.isCombatMode) return;
  this.cam.auto = Math.max(this.cam.auto, titanTuning.zoom);
  // Solo: lean the view toward the body so its weak points stay on screen (co-op keeps its team framing).
  if (this.heroes.length > 1) return;
  const dx = s.cx - this.playerPos.x;
  const dz = s.cz - this.playerPos.z;
  const d = Math.hypot(dx, dz);
  const k = d > 0 ? Math.min(titanTuning.lean, d * 0.5) / d : 0;
  this.cam.frameTeam(dx * k, dz * k, 1);
}

/** Boss bar extras: the Titan's weak points; the duel tag. */
export function bossLaneHud(this: Game, bar: BossBar | null): BossBar | null {
  const L = lane(this);
  const s = L.titan;
  setBossLaneHud(s && bar && !bar.mini ? s.partHp : null, s?.phase ?? 1, !!this.bossDuel && !!bar && !bar.mini);
  if (!s || !bar || bar.mini) return bar;
  const left = s.partHp.filter((v) => v > 0).length;
  return { ...bar, name: `${bar.name} · ${left ? `${left} WEAK POINT${left > 1 ? 'S' : ''}` : 'CORE EXPOSED'}`, ticks: ENEMIES.titan.phases, phase: s.phase };
}

/** Debug/test links: the Titan's state (host). */
export function titanDebug(this: Game): { titan: TitanState | null; parts: (Enemy | null)[]; walls: number } {
  const L = lane(this);
  return { titan: L.titan, parts: L.parts, walls: L.walls.length };
}
