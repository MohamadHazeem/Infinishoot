/**
 * Time lane: a compact ring buffer of the world, recorded a few times a
 * second (timeTuning.recordHz) on solo and host machines. It feeds the
 * rewind (backward playback, then a full restore of the oldest frame) and
 * the death replay (slow-motion playback of the last moments).
 *
 * A frame holds the team numbers, every hero (position, life, dash, special
 * and ultimate meters, gold), every enemy (position, life and its AI and
 * status timers), every bullet, every pickup and the telegraphed strikes.
 * Storage is typed arrays per frame that only grow (to the largest crowd
 * seen), so recording makes no garbage once warmed up.
 *
 * Restoring matches enemies by uid: living ones are moved back, enemies
 * killed since come back (a fresh pool object given their old uid, so squad
 * links and co-op mirrors still line up), and enemies spawned since leave
 * quietly. Bosses and mini-bosses are never despawned or respawned (the boss
 * spawning is a history barrier anyway); their state is restored if alive.
 */
import type { Game } from './game';
import type { Enemy, EnemyState, BossAction } from './enemies';
import type { EnemyDef } from '../data/enemies';
import type { EliteModDef } from '../data/eliteMods';
import { Team, type BulletSpawn } from './bullets';
import { bossLike } from './bossRules';
import { timeTuning } from './timeRules';
import { endUlt } from './ultimates';

// ---------------------------------------------------------------- layouts

/** Team numbers (Float64: score can get big). */
const T_SCORE = 0, T_KILLS = 1, T_COMBO = 2, T_COMBOT = 3, T_XP = 4, T_DIRTIME = 5, T_VACUUM = 6, T_LEVEL = 7;
const TEAM_N = 8;

/** Per hero. */
const H_X = 0, H_Z = 1, H_VX = 2, H_VZ = 3, H_AX = 4, H_AZ = 5, H_HP = 6, H_DEAD = 7, H_DSTOCK = 8, H_DCD = 9, H_BOMB = 10, H_GOLD = 11, H_ULT = 12, H_GEARS = 13, H_HURT = 14, H_LEFT = 15;
const HERO_N = 16;
export const MAX_HEROES = 4;

/** Per enemy (Float32; uid kept apart in an Int32Array). */
const E = {
  def: 0, mod: 1, state: 2, action: 3, move: 4, bools: 5,
  x: 6, z: 7, vx: 8, vz: 9, kx: 10, kz: 11, hp: 12, maxHp: 13, shield: 14, t: 15,
  frozen: 16, slowT: 17, slowAmt: 18, shatter: 19, burnT: 20, burnDps: 21, burnAcc: 22, burnOwner: 23, shockT: 24, exposeT: 25,
  lungeX: 26, lungeZ: 27, facing: 28, phase: 29, timerA: 30, timerB: 31, hopY: 32, fromX: 33, fromZ: 34, targetX: 35, targetZ: 36,
  burst: 37, spin: 38, step: 39, roarT: 40, twistT: 41, modT: 42, leaderUid: 43, speedMul: 44, dmgMul: 45, scale: 46, radius: 47,
  strafe: 48, flank: 49, familyState: 50, sub: 51, tickT: 52, slot: 53, aiBits: 54, coverX: 55, coverZ: 56, coverT: 57, reroute: 58,
  rallyT: 59, rallyCd: 60, scatterT: 61, guardT: 62, guardAng: 63, blockT: 64,
} as const;
const EN = 65;
const B_ELITE = 1, B_ENRAGED = 2, B_UNDER = 4, B_COVER = 8, B_FLED = 16;

/** Per bullet. */
const BF = 13; // x z vx vz life radius damage knockback width length age homing blast
const BU = 6; // team pierce bounce owner kind shape

/** Per pickup. */
const PF = 7; // x z vx vz value pullT age
const PU = 2; // type pulled

/** Per strike: x z r t dmg foe cause. */
const SF = 7;
const MAX_STRIKES = 48;

function grow(a: Float32Array, need: number): Float32Array {
  if (a.length >= need) return a;
  const out = new Float32Array(Math.max(need, a.length * 2));
  out.set(a);
  return out;
}
function growU8(a: Uint8Array, need: number): Uint8Array {
  if (a.length >= need) return a;
  const out = new Uint8Array(Math.max(need, a.length * 2));
  out.set(a);
  return out;
}
function growI32(a: Int32Array, need: number): Int32Array {
  if (a.length >= need) return a;
  const out = new Int32Array(Math.max(need, a.length * 2));
  out.set(a);
  return out;
}
function growU32(a: Uint32Array, need: number): Uint32Array {
  if (a.length >= need) return a;
  const out = new Uint32Array(Math.max(need, a.length * 2));
  out.set(a);
  return out;
}

/** One recorded moment. */
export class TimeFrame {
  /** Run time it was taken (Game.runTime). */
  t = 0;
  readonly team = new Float64Array(TEAM_N);
  readonly heroes = new Float32Array(MAX_HEROES * HERO_N);
  heroN = 0;
  en: Float32Array = new Float32Array(64 * EN);
  uid: Int32Array = new Int32Array(64);
  enN = 0;
  bf: Float32Array = new Float32Array(64 * BF);
  bu: Uint8Array = new Uint8Array(64 * BU);
  bc: Uint32Array = new Uint32Array(64);
  buN = 0;
  pf: Float32Array = new Float32Array(64 * PF);
  pu: Uint8Array = new Uint8Array(64 * PU);
  pkN = 0;
  readonly st = new Float32Array(MAX_STRIKES * SF);
  stN = 0;
  /** uid -> row, built on demand for the replay's interpolation. */
  private rows: Map<number, number> | null = null;
  private rowsFor = -1;

  /** Row of the enemy with this uid, or -1. */
  rowOf(uid: number, stamp: number): number {
    if (!this.rows) this.rows = new Map();
    if (this.rowsFor !== stamp) {
      this.rows.clear();
      for (let i = 0; i < this.enN; i++) this.rows.set(this.uid[i], i);
      this.rowsFor = stamp;
    }
    return this.rows.get(uid) ?? -1;
  }

  heroX(i: number): number {
    return this.heroes[i * HERO_N + H_X];
  }
  heroZ(i: number): number {
    return this.heroes[i * HERO_N + H_Z];
  }
  heroHp(i: number): number {
    return this.heroes[i * HERO_N + H_HP];
  }
  heroDead(i: number): boolean {
    return this.heroes[i * HERO_N + H_DEAD] > 0;
  }
  get combo(): number {
    return this.team[T_COMBO];
  }
}

/** What a restore writes: positions only (playback) or everything (the rewind's end). */
export type RestoreMode = 'visual' | 'full';

/**
 * The ring buffer plus the intern tables its frames index into (enemy defs,
 * elite mods, strings). One per Game (see systems/time.ts).
 */
export class Timeline {
  readonly frames: TimeFrame[] = [];
  /** Index of the oldest frame and how many are filled. */
  private head = 0;
  count = 0;
  /** Stage the history belongs to (a new stage clears it). */
  stage = 0;
  /** Bumped on every clear and record, so cached uid maps know they are stale. */
  stamp = 0;
  private defs: EnemyDef[] = [];
  private defIdx = new Map<EnemyDef, number>();
  private mods: (EliteModDef | null)[] = [null];
  private strs: string[] = [];
  private strIdx = new Map<string, number>();
  // Restore scratch (no allocation per call).
  private live = new Map<number, Enemy>();
  private seen = new Set<Enemy>();
  private spawn: BulletSpawn = { x: 0, z: 0, dirX: 0, dirZ: 0, speed: 1, life: 0, radius: 0, damage: 0, knockback: 0, team: Team.Player, color: 0, width: 0, length: 0 };

  constructor(readonly capacity = Math.ceil((timeTuning.rewindSeconds + 0.6) * timeTuning.recordHz) + 2) {
    for (let i = 0; i < capacity; i++) this.frames.push(new TimeFrame());
  }

  clear(): void {
    this.head = this.count = 0;
    this.stamp++;
  }

  /** Frame i, 0 = oldest .. count - 1 = newest. */
  at(i: number): TimeFrame {
    return this.frames[(this.head + i) % this.capacity];
  }
  get newest(): TimeFrame | null {
    return this.count ? this.at(this.count - 1) : null;
  }
  /** Seconds of play the history covers. */
  get span(): number {
    return this.count < 2 ? 0 : this.at(this.count - 1).t - this.at(0).t;
  }

  /** Index of the oldest frame no more than `seconds` before the newest. */
  indexBack(seconds: number): number {
    if (!this.count) return -1;
    const t = this.at(this.count - 1).t - seconds - 1e-4;
    for (let i = 0; i < this.count; i++) if (this.at(i).t >= t) return i;
    return this.count - 1;
  }

  private str(s: string): number {
    let i = this.strIdx.get(s);
    if (i === undefined) {
      i = this.strs.length;
      this.strs.push(s);
      this.strIdx.set(s, i);
    }
    return i;
  }
  private def(d: EnemyDef): number {
    let i = this.defIdx.get(d);
    if (i === undefined) {
      i = this.defs.length;
      this.defs.push(d);
      this.defIdx.set(d, i);
    }
    return i;
  }
  private mod(m: EliteModDef | null): number {
    if (!m) return 0;
    let i = this.mods.indexOf(m);
    if (i < 0) i = this.mods.push(m) - 1;
    return i;
  }

  // ---------------------------------------------------------------- record

  /** Write the world into the next slot (the oldest one once the ring is full). */
  record(g: Game): TimeFrame {
    let f: TimeFrame;
    if (this.count < this.capacity) f = this.frames[(this.head + this.count++) % this.capacity];
    else {
      // Full: the oldest frame becomes the newest.
      f = this.frames[this.head];
      this.head = (this.head + 1) % this.capacity;
    }
    this.stamp++;
    f.t = g.runTime;
    const T = f.team;
    T[T_SCORE] = g.score;
    T[T_KILLS] = g.kills;
    T[T_COMBO] = g.combo;
    T[T_COMBOT] = g.comboT;
    T[T_XP] = g.xp;
    T[T_DIRTIME] = g.director.time;
    T[T_VACUUM] = g.pickups.vacuum ? 1 : 0;
    T[T_LEVEL] = g.level;
    // Heroes
    f.heroN = Math.min(MAX_HEROES, g.heroes.length);
    for (let i = 0; i < f.heroN; i++) {
      const h = g.heroes[i];
      const p = h.player;
      const a = f.heroes;
      const o = i * HERO_N;
      a[o + H_X] = p.pos.x;
      a[o + H_Z] = p.pos.z;
      a[o + H_VX] = p.vel.x;
      a[o + H_VZ] = p.vel.z;
      a[o + H_AX] = p.aim.x;
      a[o + H_AZ] = p.aim.z;
      a[o + H_HP] = p.hp;
      a[o + H_DEAD] = p.dead ? 1 : 0;
      a[o + H_DSTOCK] = p.dashStock;
      a[o + H_DCD] = p.dashCd;
      a[o + H_BOMB] = h.bombCharge;
      a[o + H_GOLD] = h.gold;
      a[o + H_ULT] = h.skill.ult;
      a[o + H_GEARS] = h.rerollsLeft;
      a[o + H_HURT] = p.hurtFlash;
      a[o + H_LEFT] = h.left ? 1 : 0;
    }
    // Enemies
    const list = g.enemies.list;
    let n = 0;
    for (const e of list) if (e.active && e.pvpOwner < 0) n++;
    f.en = grow(f.en, n * EN);
    f.uid = growI32(f.uid, n);
    let k = 0;
    for (const e of list) {
      if (!e.active || e.pvpOwner >= 0) continue;
      f.uid[k] = e.uid;
      this.putEnemy(f.en, k * EN, e);
      k++;
    }
    f.enN = k;
    // Bullets
    const b = g.bullets;
    const nb = b.count;
    f.bf = grow(f.bf, nb * BF);
    f.bu = growU8(f.bu, nb * BU);
    f.bc = growU32(f.bc, nb);
    for (let i = 0; i < nb; i++) {
      const o = i * BF;
      const bf = f.bf;
      bf[o] = b.x[i];
      bf[o + 1] = b.z[i];
      bf[o + 2] = b.vx[i];
      bf[o + 3] = b.vz[i];
      bf[o + 4] = b.life[i];
      bf[o + 5] = b.radius[i];
      bf[o + 6] = b.damage[i];
      bf[o + 7] = b.knockback[i];
      bf[o + 8] = b.width[i];
      bf[o + 9] = b.length[i];
      bf[o + 10] = b.age[i];
      bf[o + 11] = b.homing[i];
      bf[o + 12] = b.blast[i];
      const u = i * BU;
      const bu = f.bu;
      bu[u] = b.team[i];
      bu[u + 1] = b.pierce[i];
      bu[u + 2] = b.bounce[i];
      bu[u + 3] = b.owner[i];
      bu[u + 4] = b.kind[i];
      bu[u + 5] = b.shape[i];
      f.bc[i] = b.colorHex(i);
    }
    f.buN = nb;
    // Pickups
    const pk = g.pickups;
    const np = pk.count;
    f.pf = grow(f.pf, np * PF);
    f.pu = growU8(f.pu, np * PU);
    for (let i = 0; i < np; i++) {
      const o = i * PF;
      const pf = f.pf;
      pf[o] = pk.x[i];
      pf[o + 1] = pk.z[i];
      pf[o + 2] = pk.vx[i];
      pf[o + 3] = pk.vz[i];
      pf[o + 4] = pk.value[i];
      pf[o + 5] = pk.pullT[i];
      pf[o + 6] = pk.age[i];
      f.pu[i * PU] = pk.type[i];
      f.pu[i * PU + 1] = pk.pulled[i];
    }
    f.pkN = np;
    // Telegraphed strikes
    f.stN = Math.min(MAX_STRIKES, g.strikes.length);
    for (let i = 0; i < f.stN; i++) {
      const s = g.strikes[i];
      const o = i * SF;
      f.st[o] = s.x;
      f.st[o + 1] = s.z;
      f.st[o + 2] = s.r;
      f.st[o + 3] = s.t;
      f.st[o + 4] = s.dmg;
      f.st[o + 5] = s.foe ?? 0;
      f.st[o + 6] = s.cause ? this.str(s.cause) : -1;
    }
    return f;
  }
  private putEnemy(a: Float32Array, o: number, e: Enemy): void {
    a[o + E.def] = this.def(e.def);
    a[o + E.mod] = this.mod(e.mod);
    a[o + E.state] = this.str(e.state);
    a[o + E.action] = this.str(e.action);
    a[o + E.move] = this.str(e.move);
    a[o + E.bools] = (e.elite ? B_ELITE : 0) | (e.enraged ? B_ENRAGED : 0) | (e.under ? B_UNDER : 0) | (e.hasCover ? B_COVER : 0) | (e.familyFled ? B_FLED : 0);
    a[o + E.x] = e.x;
    a[o + E.z] = e.z;
    a[o + E.vx] = e.vx;
    a[o + E.vz] = e.vz;
    a[o + E.kx] = e.kx;
    a[o + E.kz] = e.kz;
    a[o + E.hp] = e.hp;
    a[o + E.maxHp] = e.maxHp;
    a[o + E.shield] = e.shield;
    a[o + E.t] = e.t;
    a[o + E.frozen] = e.frozen;
    a[o + E.slowT] = e.slowT;
    a[o + E.slowAmt] = e.slowAmt;
    a[o + E.shatter] = e.shatter;
    a[o + E.burnT] = e.burnT;
    a[o + E.burnDps] = e.burnDps;
    a[o + E.burnAcc] = e.burnAcc;
    a[o + E.burnOwner] = e.burnOwner;
    a[o + E.shockT] = e.shockT;
    a[o + E.exposeT] = e.exposeT;
    a[o + E.lungeX] = e.lungeX;
    a[o + E.lungeZ] = e.lungeZ;
    a[o + E.facing] = e.facing;
    a[o + E.phase] = e.phase;
    a[o + E.timerA] = e.timerA;
    a[o + E.timerB] = e.timerB;
    a[o + E.hopY] = e.hopY;
    a[o + E.fromX] = e.fromX;
    a[o + E.fromZ] = e.fromZ;
    a[o + E.targetX] = e.targetX;
    a[o + E.targetZ] = e.targetZ;
    a[o + E.burst] = e.burst;
    a[o + E.spin] = e.spin;
    a[o + E.step] = e.step;
    a[o + E.roarT] = e.roarT;
    a[o + E.twistT] = e.twistT;
    a[o + E.modT] = e.modT;
    a[o + E.leaderUid] = e.leaderUid;
    a[o + E.speedMul] = e.speedMul;
    a[o + E.dmgMul] = e.dmgMul;
    a[o + E.scale] = e.scale;
    a[o + E.radius] = e.radius;
    a[o + E.strafe] = e.strafe;
    a[o + E.flank] = e.flank;
    a[o + E.familyState] = e.familyState;
    a[o + E.sub] = e.sub;
    a[o + E.tickT] = e.tickT;
    a[o + E.slot] = e.slot;
    a[o + E.aiBits] = e.aiBits;
    a[o + E.coverX] = e.coverX;
    a[o + E.coverZ] = e.coverZ;
    a[o + E.coverT] = e.coverT;
    a[o + E.reroute] = e.reroute;
    a[o + E.rallyT] = e.rallyT;
    a[o + E.rallyCd] = e.rallyCd;
    a[o + E.scatterT] = e.scatterT;
    a[o + E.guardT] = e.guardT;
    a[o + E.guardAng] = e.guardAng;
    a[o + E.blockT] = e.blockT;
  }

  private takeEnemy(a: Float32Array, o: number, e: Enemy): void {
    e.state = this.strs[a[o + E.state]] as EnemyState;
    e.action = this.strs[a[o + E.action]] as BossAction;
    e.move = this.strs[a[o + E.move]] ?? '';
    const bits = a[o + E.bools];
    e.elite = (bits & B_ELITE) !== 0;
    e.enraged = (bits & B_ENRAGED) !== 0;
    e.under = (bits & B_UNDER) !== 0;
    e.hasCover = (bits & B_COVER) !== 0;
    e.familyFled = (bits & B_FLED) !== 0;
    e.vx = a[o + E.vx];
    e.vz = a[o + E.vz];
    e.kx = a[o + E.kx];
    e.kz = a[o + E.kz];
    e.hp = a[o + E.hp];
    e.maxHp = a[o + E.maxHp];
    e.shield = a[o + E.shield];
    e.t = a[o + E.t];
    e.frozen = a[o + E.frozen];
    e.slowT = a[o + E.slowT];
    e.slowAmt = a[o + E.slowAmt];
    e.shatter = a[o + E.shatter];
    e.burnT = a[o + E.burnT];
    e.burnDps = a[o + E.burnDps];
    e.burnAcc = a[o + E.burnAcc];
    e.burnOwner = a[o + E.burnOwner];
    e.shockT = a[o + E.shockT];
    e.exposeT = a[o + E.exposeT];
    e.lungeX = a[o + E.lungeX];
    e.lungeZ = a[o + E.lungeZ];
    e.facing = a[o + E.facing];
    e.phase = a[o + E.phase];
    e.timerA = a[o + E.timerA];
    e.timerB = a[o + E.timerB];
    e.hopY = a[o + E.hopY];
    e.fromX = a[o + E.fromX];
    e.fromZ = a[o + E.fromZ];
    e.targetX = a[o + E.targetX];
    e.targetZ = a[o + E.targetZ];
    e.burst = a[o + E.burst];
    e.spin = a[o + E.spin];
    e.step = a[o + E.step];
    e.roarT = a[o + E.roarT];
    e.twistT = a[o + E.twistT];
    e.modT = a[o + E.modT];
    e.leaderUid = a[o + E.leaderUid];
    e.speedMul = a[o + E.speedMul];
    e.dmgMul = a[o + E.dmgMul];
    e.scale = a[o + E.scale];
    e.radius = a[o + E.radius];
    e.strafe = a[o + E.strafe];
    e.flank = a[o + E.flank];
    e.familyState = a[o + E.familyState];
    e.sub = a[o + E.sub];
    e.tickT = a[o + E.tickT];
    e.slot = a[o + E.slot];
    e.aiBits = a[o + E.aiBits];
    e.coverX = a[o + E.coverX];
    e.coverZ = a[o + E.coverZ];
    e.coverT = a[o + E.coverT];
    e.reroute = a[o + E.reroute];
    e.rallyT = a[o + E.rallyT];
    e.rallyCd = a[o + E.rallyCd];
    e.scatterT = a[o + E.scatterT];
    e.guardT = a[o + E.guardT];
    e.guardAng = a[o + E.guardAng];
    e.blockT = a[o + E.blockT];
    e.flash = 0;
  }

  // ---------------------------------------------------------------- restore

  /**
   * Put the world back to frame f. `visual` moves everything that's drawn
   * (heroes, enemies, bullets, pickups) and reconciles which enemies exist;
   * `full` also restores life, meters, timers, AI state and the team numbers.
   * `next` + `k` (0..1) blend positions toward a later frame (the replay's
   * slow motion). `keepDead` heroes stay where they are (the replay's dead).
   */
  restore(g: Game, f: TimeFrame, mode: RestoreMode, next: TimeFrame | null = null, k = 0): void {
    const full = mode === 'full';
    // ---- heroes
    for (let i = 0; i < f.heroN && i < g.heroes.length; i++) {
      const h = g.heroes[i];
      if (h.left) continue;
      const p = h.player;
      const a = f.heroes;
      const o = i * HERO_N;
      let x = a[o + H_X];
      let z = a[o + H_Z];
      if (next && i < next.heroN) {
        x += (next.heroes[o + H_X] - x) * k;
        z += (next.heroes[o + H_Z] - z) * k;
      }
      p.prev.x = p.pos.x;
      p.prev.z = p.pos.z;
      p.pos.x = x;
      p.pos.z = z;
      p.vel.x = a[o + H_VX];
      p.vel.z = a[o + H_VZ];
      p.setAimDir(a[o + H_AX], a[o + H_AZ], p.aimDist);
      p.hurtFlash = a[o + H_HURT];
      if (!full) {
        p.hp = a[o + H_HP];
        continue;
      }
      p.prev.x = x;
      p.prev.z = z;
      if (h.remote) {
        h.remote.x = x;
        h.remote.z = z;
      }
      p.hp = Math.max(1, a[o + H_HP]);
      if (p.dead && a[o + H_DEAD] === 0) {
        p.dead = false;
        p.rig.root.visible = true;
        h.reviveT = 0;
      }
      p.dashStock = a[o + H_DSTOCK];
      p.dashCd = a[o + H_DCD];
      h.bombCharge = a[o + H_BOMB];
      h.gold = Math.round(a[o + H_GOLD]);
      h.skill.ult = a[o + H_ULT];
      h.rerollsLeft = Math.round(a[o + H_GEARS]);
      p.invuln = Math.max(p.invuln, timeTuning.rewindIframes);
      // Transient moves stop: their meters came back, so they can't also keep going (no double bombs or ultimates).
      h.bombT = -1;
      h.bombNext = 0;
      h.bomblets.length = 0;
      if (h.skill.ultT > 0) endUlt(g, h);
    }
    // ---- team
    if (full) {
      const T = f.team;
      g.score = T[T_SCORE];
      g.kills = T[T_KILLS];
      g.combo = T[T_COMBO];
      g.comboT = T[T_COMBOT];
      if (T[T_LEVEL] === g.level) g.xp = T[T_XP];
      g.director.time = T[T_DIRTIME];
      g.pickups.vacuum = T[T_VACUUM] > 0;
    }
    this.restoreEnemies(g, f, full, next, k);
    this.restoreBullets(g, f, next ? k / timeTuning.recordHz : 0);
    this.restorePickups(g, f);
    if (full) {
      g.strikes.length = 0;
      g.enemies.zones.length = 0;
      for (let i = 0; i < f.stN; i++) {
        const o = i * SF;
        const c = f.st[o + 6];
        g.strikes.push({ x: f.st[o], z: f.st[o + 1], r: f.st[o + 2], t: f.st[o + 3], dmg: f.st[o + 4], foe: f.st[o + 5] || undefined, cause: c >= 0 ? this.strs[c] : undefined });
        g.vfx.zone(f.st[o], f.st[o + 1], f.st[o + 2], f.st[o + 3]);
      }
    }
  }

  private restoreEnemies(g: Game, f: TimeFrame, full: boolean, next: TimeFrame | null, k: number): void {
    const live = this.live;
    const seen = this.seen;
    live.clear();
    seen.clear();
    for (const e of g.enemies.list) if (e.active && e.pvpOwner < 0) live.set(e.uid, e);
    for (let i = 0; i < f.enN; i++) {
      const o = i * EN;
      const uid = f.uid[i];
      const a = f.en;
      let e = live.get(uid);
      const def = this.defs[a[o + E.def]];
      if (!e) {
        // Killed since: bring it back (bosses and mini-bosses stay dead: their deaths are barriers or own their bars).
        if (def.boss) continue;
        const mod = this.mods[a[o + E.mod]];
        e = g.enemies.spawn(def, a[o + E.x], a[o + E.z], { instant: true, elite: (a[o + E.bools] & B_ELITE) !== 0, eliteMod: mod ? mod.id : undefined });
        e.uid = uid;
        e.mod = mod ?? null;
        this.takeEnemy(a, o, e);
        e.px = e.x = a[o + E.x];
        e.pz = e.z = a[o + E.z];
        live.set(uid, e);
      } else {
        e.px = e.x;
        e.pz = e.z;
        let x = a[o + E.x];
        let z = a[o + E.z];
        if (next) {
          const j = next.rowOf(uid, this.stamp);
          if (j >= 0) {
            x += (next.en[j * EN + E.x] - x) * k;
            z += (next.en[j * EN + E.z] - z) * k;
          }
        }
        e.x = x;
        e.z = z;
        if (full) this.takeEnemy(a, o, e);
        else {
          e.facing = a[o + E.facing];
          e.hopY = a[o + E.hopY];
          e.hp = a[o + E.hp];
          e.state = this.strs[a[o + E.state]] as EnemyState;
          e.lungeX = a[o + E.lungeX];
          e.lungeZ = a[o + E.lungeZ];
        }
        if (full) {
          e.px = e.x;
          e.pz = e.z;
        }
      }
      seen.add(e);
    }
    // Spawned since: leave quietly (no kill, no drops). Bosses and mini-bosses stay.
    for (const e of live.values()) {
      if (seen.has(e) || bossLike(e) || e === g.bossField.mini) continue;
      g.enemies.kill(e);
    }
    if (!full) return;
    // Squad links follow the restored uids.
    for (const e of seen) {
      if (!e.leaderUid) continue;
      const l = live.get(e.leaderUid);
      e.leader = l && l.active && l.uid === e.leaderUid ? l : null;
    }
  }

  private restoreBullets(g: Game, f: TimeFrame, ahead: number): void {
    const b = g.bullets;
    b.clear();
    const s = this.spawn;
    for (let i = 0; i < f.buN; i++) {
      const o = i * BF;
      const u = i * BU;
      const bf = f.bf;
      s.x = bf[o] + bf[o + 2] * ahead;
      s.z = bf[o + 1] + bf[o + 3] * ahead;
      s.dirX = bf[o + 2];
      s.dirZ = bf[o + 3];
      s.speed = 1;
      s.life = bf[o + 4];
      s.radius = bf[o + 5];
      s.damage = bf[o + 6];
      s.knockback = bf[o + 7];
      s.width = bf[o + 8];
      s.length = bf[o + 9];
      s.homing = bf[o + 11];
      s.blast = bf[o + 12];
      s.team = f.bu[u] === Team.Enemy ? Team.Enemy : Team.Player;
      s.pierce = f.bu[u + 1];
      s.bounce = f.bu[u + 2];
      s.owner = f.bu[u + 3];
      s.kind = f.bu[u + 4];
      s.shape = f.bu[u + 5];
      s.color = f.bc[i];
      const before = b.count;
      b.spawn(s);
      if (b.count > before) b.age[b.count - 1] = bf[o + 10];
    }
  }

  private restorePickups(g: Game, f: TimeFrame): void {
    const pk = g.pickups;
    const n = Math.min(f.pkN, pk.x.length);
    for (let i = 0; i < n; i++) {
      const o = i * PF;
      pk.x[i] = f.pf[o];
      pk.z[i] = f.pf[o + 1];
      pk.vx[i] = f.pf[o + 2];
      pk.vz[i] = f.pf[o + 3];
      pk.value[i] = f.pf[o + 4];
      pk.pullT[i] = f.pf[o + 5];
      pk.age[i] = f.pf[o + 6];
      pk.type[i] = f.pu[i * PU];
      pk.pulled[i] = f.pu[i * PU + 1];
    }
    pk.count = n;
  }

  /** Best team combo recorded in the last `seconds` of history. */
  bestCombo(seconds: number): number {
    let best = 0;
    if (!this.count) return 0;
    const t = this.at(this.count - 1).t - seconds;
    for (let i = this.count - 1; i >= 0 && this.at(i).t >= t; i--) best = Math.max(best, this.at(i).combo);
    return best;
  }

  /** Recorded state of row `row` in frame f (tests). */
  stateOf(f: TimeFrame, row: number): EnemyState {
    return this.strs[f.en[row * EN + E.state]] as EnemyState;
  }

  /** Recorded life of the enemy with this uid in frame f, or -1 (tests). */
  hpOf(f: TimeFrame, uid: number): number {
    for (let i = 0; i < f.enN; i++) if (f.uid[i] === uid) return f.en[i * EN + E.hp];
    return -1;
  }
}
