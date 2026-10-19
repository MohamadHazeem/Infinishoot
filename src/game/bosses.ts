import { biome3Brain, type Biome3Api } from './biome3Brain';
import { BIOME3_PHASE_LINES } from '../data/biome3';
/**
 * Boss brains: King Bopper, Rampage Rex, Hive Queen, Omega Overlord and the
 * mid-stage mini-bosses (smaller copies that share these brains).
 *
 * Phases: every boss def lists the HP fractions where its next phase starts
 * (`EnemyDef.phases`). Game.damage clamps HP at the threshold (`phaseGate`), so
 * a burst can't skip a phase, and the boss roars: idle and invulnerable for
 * `bossTuning.roar` seconds, then it opens its new attack set.
 *
 *   King Bopper  P1 rings, summons, jump slam; P2 slams chain and send out
 *                shockwave rings (dash through them); P3 three-hop slams, double
 *                rings, Bopper guard. Arena twist: tremors drop rubble on you.
 *   Rampage Rex  P1 charge chains (smashes through cover), spiral, gap waves;
 *                P2 figure-eight rampage; P3 fire breath. Arena twist: scorched
 *                earth, charges leave burning ground.
 *   Hive Queen   P1 fans, strike rain, Zippies, one hive; P2 plants hives that
 *                hatch Swarmers until destroyed; P3 swarm walls with one gap.
 *                Arena twist: hive link, every standing hive heals her.
 *   Omega        its own three phases (below), plus an orbital strike grid.
 *
 * Rematches (src/data/bossRemix.ts) reuse these brains with `def.remix` flags:
 * King Bopper EX (shockwaves from phase 1, a bullet ring on every landing,
 * veteran summons), Rampage Rex: Inferno (fire breath from phase 2, burning
 * charges, a 4-arm spiral), Hive Queen: Nightshade (swarm walls from phase 2,
 * wider fans, more hives, veteran Zippies). The Titan (src/game/titan.ts) only
 * passes through updateBoss to reach its own brain (BossApi.titan).
 *
 * Everything here runs on the host inside Enemies.update. Telegraph state the
 * clients need (phase, move, roar, shockwaves, fire) is synced by
 * src/game/systems/bossFight.ts.
 */
import type { Enemy, EnemyCtx, EnemyState, BossAction } from './enemies';
import { BOSS3_PHASE_LINES } from '../data/bosses3';
import { BOSS3_BEHAVIORS, bosses3Step, isFlyer3, type Bosses3Api } from './bosses3';

export const bossTuning = {
  hp: 8, // boss HP multiplier on top of the boss stage curve (loadout builds melted 2.4x bosses in 7-19 s)
  speed: 1.2, // move speed multiplier
  pace: 0.65, // multiplier on pauses between attacks and recovery times
  firstAttack: 1.5, // seconds before the first attack
  enrageAt: 0.5, // legacy (debug panel): regular bosses now use EnemyDef.phases
  enrageSpeed: 1.2, // Omega: extra speed from phase 2
  enragePace: 0.7, // Omega: extra pace multiplier from phase 2
  phaseSpeed: [1, 1.12, 1.25], // regular bosses: move speed per phase
  phasePace: [1, 0.85, 0.72], // regular bosses: pause multiplier per phase
  roar: 1.4, // seconds of invulnerable roar at a phase change
  intro: 1.5, // seconds the boss idles (invulnerable) during its entrance
};

/** Omega Overlord (final boss) phases; it uses bossTuning too (phase 2 counts as enraged). */
export const omegaTuning = {
  phase2At: 0.6, // HP fraction: adds the bullet spiral, gap waves and aimed fans (mirrored in its def's `phases`)
  phase3At: 0.25, // HP fraction: relentless, strikes rain with every attack
  phase3Pace: 0.75, // extra pace multiplier in phase 3
  phase3Speed: 1.15, // extra move speed in phase 3
};

/** New attacks and arena twists. */
export const bossMoveTuning = {
  shockSpeed: 9, // m/s a slam shockwave ring expands
  shockMax: 22, // radius where it fades
  shockBand: 0.55, // half-thickness that hurts
  shockDamage: 16,
  eightSize: 8.5, // figure-eight lobe length (mini 6)
  eightTime: 2.8, // seconds to run the whole eight (mini 2.3)
  breathTime: 1.6,
  breathArc: 0.6, // radians either side of the aim the breath sweeps
  breathRange: 10,
  fireDamage: 7, // per 0.5 s tick standing in fire
  fireLife: 6,
  hiveMax: 4, // most hives alive (mini 2)
  hiveHeal: 0.002, // Queen heals this fraction of max HP per hive per second (0.6% let her outheal a bot build)
  wallSpeed: 6.5,
  wallDamage: 16,
  tremorEvery: 7, // King: seconds between rubble drops (5 in phase 3)
  gridEvery: 9, // Omega: seconds between orbital strike lines (6 in phase 3)
};

/** Boss special moves (beyond the BossAction the codec carries). Index = net code. */
export const BOSS_MOVES = ['', 'eight', 'breath', 'hive', 'wall', 'grid', 'drop', 'punch', 'pinball', 'gust', 'board'] as const; // grid..board: biome bosses (src/game/bosses3.ts)
export type BossMove = (typeof BOSS_MOVES)[number];

/** Short line shown with each phase change. */
export const PHASE_LINES: Record<string, string[]> = {
  ...BIOME3_PHASE_LINES,
  pumpking: ['', 'VINE GRABS: LEAVE THE MARKED PATCHES', 'CARVING KNIVES: KEEP YOUR DISTANCE'],
  boss: ['', 'SHOCKWAVE SLAMS: DASH THROUGH THE RINGS', 'ROYAL FURY'],
  rex: ['', 'FIGURE-EIGHT RAMPAGE', 'FIRE BREATH'],
  queen: ['', 'HIVES: DESTROY THEM BEFORE THEY HATCH', 'SWARM WALLS: FIND THE GAP'],
  omega: ['', 'OVERDRIVE', 'LAST PROTOCOL'],
  ...BOSS3_PHASE_LINES, // Glitch DJ, Boxer Jack, Admiral Gale (src/data/bosses3.ts)
};

/** Things the boss brains need from the game beyond EnemyCtx. Host only. */
export interface BossApi {
  biome3?: Biome3Api;
  /** An expanding shockwave ring centred on (x, z), starting after `delay`. */
  shockwave(e: Enemy, x: number, z: number, delay: number): void;
  /** Rex mid-charge: smash props and barrels it runs through; `fire` drops burning ground behind it. */
  rampage(e: Enemy, fire: boolean): void;
  /** Burning ground at (x, z) for bossMoveTuning.fireLife seconds. */
  firePatch(e: Enemy, x: number, z: number): void;
  /** Enemy bullet with its own colour, life and size. */
  shot(e: Enemy, dx: number, dz: number, speed: number, damage: number, color: string, life: number, radius: number): void;
  /** Telegraph a hive at (x, z); it lands shortly after. */
  plantHive(e: Enemy, x: number, z: number): boolean;
  hiveCount(): number;
  /** A wall of stingers sweeping toward (tx, tz) with one gap. */
  swarmWall(e: Enemy, tx: number, tz: number): void;
  /** True if (x, z) is free ground inside the arena. */
  open(x: number, z: number, r: number): boolean;
  /** The Titan's brain, one step (src/game/systems/bossLane.ts). */
  titan?(e: Enemy, dt: number): void;
  /** Biome bosses' arena (src/game/systems/bosses3.ts). */
  b3?: Bosses3Api;
}

// ------------------------------------------------------------------ phases (pure)

/** The phase a boss is in at a given HP fraction (1 + thresholds crossed). */
export function phaseFor(thresholds: readonly number[] | undefined, hp01: number): number {
  let p = 1;
  if (thresholds) for (const t of thresholds) if (hp01 <= t) p++;
  return p;
}

/**
 * Damage gate (call after HP drops). If HP fell to or past the next threshold,
 * clamps HP at it so no phase is skipped (and the boss can't die early) and
 * returns the phase to start; otherwise 0.
 */
export function phaseGate(e: Pick<Enemy, 'hp' | 'maxHp' | 'phase'> & { def: { phases?: number[] } }): number {
  const th = e.def.phases;
  const next = th?.[e.phase - 1];
  if (next === undefined || e.hp > next * e.maxHp) return 0;
  e.hp = Math.max(1, Math.round(next * e.maxHp));
  return e.phase + 1;
}

/** Enter a new phase: roar (idle, invulnerable), then the new attack set starts from its first move. */
export function startPhase(e: Enemy, phase: number): void {
  e.phase = phase;
  e.enraged = true;
  idle(e, bossTuning.roar);
  e.squash(-10);
}

/** Entrance: idle and invulnerable while the title card plays. */
export function startIntro(e: Enemy, seconds = bossTuning.intro): void {
  idle(e, seconds);
}

function idle(e: Enemy, seconds: number): void {
  e.roarT = seconds;
  e.state = 'recover';
  e.t = seconds;
  e.vx = e.vz = 0;
  if (e.def.behavior !== 'queen' && !isFlyer3(e)) e.hopY = 0;
  e.burst = 0;
  e.move = '';
  e.step = 0;
}

export const isMini = (e: Enemy): boolean => !!e.def.miniboss;

/** A point on the figure-eight rampage path: s in [0, 2pi], origin (ox, oz), heading (dx, dz). */
export function eightPoint(s: number, A: number, ox: number, oz: number, dx: number, dz: number, out: { x: number; z: number }): void {
  const lx = A * Math.sin(s);
  const ly = A * 0.55 * Math.sin(2 * s);
  out.x = ox + dx * lx - dz * ly;
  out.z = oz + dz * lx + dx * ly;
}

export const eightSize = (e: Enemy): number => (isMini(e) ? 6 : bossMoveTuning.eightSize);
export const eightTime = (e: Enemy): number => (isMini(e) ? 2.3 : bossMoveTuning.eightTime);

/** Fire breath aim at an attack's remaining time `t` (it sweeps across the telegraphed cone). */
export function breathAngle(base: number, t: number): number {
  const k = 1 - Math.max(0, Math.min(1, t / bossMoveTuning.breathTime));
  return base - bossMoveTuning.breathArc + 2 * bossMoveTuning.breathArc * k;
}

// ------------------------------------------------------------------ helpers

export function enter(e: Enemy, s: EnemyState, t: number, squash: number, ctx?: EnemyCtx): void {
  e.state = s;
  e.t = t;
  e.squash(squash);
  if (s === 'attack') e.hitPlayer = false;
  if (s === 'windup' && ctx) ctx.onWindup(e);
}

export function lockOn(e: Enemy, nx: number, nz: number): void {
  e.lungeX = nx;
  e.lungeZ = nz;
  e.facing = Math.atan2(nx, nz);
}

export function bossSpeed(e: Enemy, speed: number): number {
  if (e.def.behavior === 'omega') return speed * bossTuning.speed * (e.enraged ? bossTuning.enrageSpeed : 1) * (e.phase >= 3 ? omegaTuning.phase3Speed : 1);
  return speed * bossTuning.speed * (bossTuning.phaseSpeed[e.phase - 1] ?? 1.25);
}

/** Multiplier on boss pauses and recovery (smaller = more aggressive). */
export function pace(e: Enemy): number {
  if (e.def.behavior === 'omega') return bossTuning.pace * (e.enraged ? bossTuning.enragePace : 1) * (e.phase >= 3 ? omegaTuning.phase3Pace : 1);
  return bossTuning.pace * (bossTuning.phasePace[e.phase - 1] ?? 0.72);
}

/** Telegraphed ground strike on (x, z) plus `n` more scattered around it, landing one after another. */
export function rain(ctx: EnemyCtx, x: number, z: number, n: number, damage: number): void {
  ctx.strike(x, z, 2.2, 1.1, damage);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random();
    const d = 3.5 + Math.random() * 3;
    ctx.strike(x + Math.cos(a) * d, z + Math.sin(a) * d, 2.2, 1.1 + i * 0.12, damage);
  }
}

export function ring(e: Enemy, ctx: EnemyCtx, n: number, speed: number, damage: number, off: number): void {
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    ctx.fireBullet(e, Math.cos(a), Math.sin(a), speed, damage);
  }
}

/** Pick the next attack from a phase's rotation. */
export function next<T>(e: Enemy, order: T[]): T {
  return order[e.step++ % order.length];
}

// ------------------------------------------------------------------ update

/**
 * One step of a boss or mini-boss. Sets e.vx/e.vz (the caller moves it);
 * returns true while the move is rigid (charging, airborne).
 */
export function updateBoss(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): boolean {
  if (e.def.behavior === 'titan' || e.def.behavior === 'titanpart') {
    // The Titan doesn't walk: its body and weak points are posed by its own brain.
    e.vx = e.vz = 0;
    if (e.def.behavior === 'titan') ctx.boss?.titan?.(e, dt);
    return true;
  }
  if (e.roarT > 0) {
    // Roar / entrance: hold still, blink, then open the next attack set.
    e.roarT -= dt;
    e.vx = e.vz = 0;
    e.facing = Math.atan2(nx, nz);
    if (e.def.behavior === 'queen') hover(e, dt);
    if (e.phase > 1 && Math.floor(e.roarT * 8) % 2 === 0) e.flash = Math.max(e.flash, 0.07); // roar blink (not the entrance)
    if (e.roarT <= 0) {
      e.roarT = 0;
      e.state = 'move';
      e.timerA = 0.5;
      e.squash(8);
    }
    return false;
  }
  const sp = bossSpeed(e, speed);
  if (!isMini(e) && !BOSS3_BEHAVIORS.includes(e.def.behavior)) twist(e, dt, ctx);
  switch (e.def.behavior) {
    case 'boss':
      return king(e, dt, ctx, nx, nz, dist, sp);
    case 'rex':
      return rex(e, dt, ctx, nx, nz, dist, sp);
    case 'queen':
      queen(e, dt, ctx, nx, nz, dist, sp);
      return false;
    case 'cake':
    case 'kraken':
      return biome3Brain(e, dt, ctx, nx, nz, dist, sp);
    case 'glitch':
    case 'boxer':
    case 'gale':
      return bosses3Step(e, dt, ctx, nx, nz, dist, sp); // biome bosses (src/game/bosses3.ts)
    default:
      return omega(e, dt, ctx, nx, nz, dist, sp);
  }
}

/** Arena twists: field effects that run while the boss lives. */
function twist(e: Enemy, dt: number, ctx: EnemyCtx): void {
  const T = bossMoveTuning;
  e.twistT -= dt;
  if (e.twistT > 0) return;
  if (e.def.behavior === 'boss') {
    // Tremors: rubble falls around every hero.
    e.twistT = e.phase >= 3 ? T.tremorEvery - 2 : T.tremorEvery;
    for (const h of ctx.targets) {
      if (!h.alive) continue;
      for (let i = 0; i < (e.phase >= 2 ? 3 : 2); i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 1.2 + Math.random() * 3.5;
        ctx.strike(h.x + Math.cos(a) * d, h.z + Math.sin(a) * d, 1.7, 1.3 + i * 0.2, 14);
      }
    }
  } else if (e.def.behavior === 'omega') {
    // Orbital grid: a line of strikes across a hero, from a random angle.
    e.twistT = e.phase >= 3 ? T.gridEvery - 3 : T.gridEvery;
    const h = ctx.targets.find((t) => t.alive);
    if (!h) return;
    const a = Math.random() * Math.PI;
    for (let i = -3; i <= 3; i++) ctx.strike(h.x + Math.cos(a) * i * 2.6, h.z + Math.sin(a) * i * 2.6, 1.5, 1.2 + Math.abs(i) * 0.08, 18);
  } else if (e.def.behavior === 'queen') {
    // Hive link: every hive still standing heals her.
    e.twistT = 1;
    const n = ctx.boss?.hiveCount() ?? 0;
    if (n > 0 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * T.hiveHeal * n);
  } else e.twistT = 1; // Rex: scorched earth happens in its charges
}

/** King Bopper / Prince Bopper. Returns true while airborne. */
function king(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): boolean {
  const tgt = ctx.target;
  const ph = e.phase;
  const mini = isMini(e);
  const R = e.def.remix;
  e.facing = Math.atan2(nx, nz);
  if (e.state === 'move') {
    e.vx = nx * speed;
    e.vz = nz * speed;
    e.timerA -= dt;
    if (e.timerA <= 0 && ctx.targetAlive) {
      // Slam when far away, otherwise rotate through the phase's attacks.
      const order: BossAction[] = ph === 1 ? ['ring', 'slam', 'ring', 'summon'] : ph === 2 ? ['slam', 'ring', 'slam', 'summon'] : ['slam', 'ring', 'summon', 'slam', 'ring'];
      e.action = dist > 9 ? 'slam' : next(e, order);
      e.vx = e.vz = 0;
      if (e.action === 'slam') {
        e.burst = mini ? 1 : ph; // hops in a row
        e.targetX = tgt.x;
        e.targetZ = tgt.z;
        enter(e, 'windup', 1.0, -6, ctx);
      } else enter(e, 'windup', 0.7, -5, ctx);
    }
    return false;
  }
  if (e.state === 'windup') {
    e.vx = e.vz = 0;
    if (e.action === 'slam' && e.t > 0.45) {
      // Track the target a little during the wind-up, then commit.
      e.targetX += (tgt.x - e.targetX) * Math.min(1, dt * 3);
      e.targetZ += (tgt.z - e.targetZ) * Math.min(1, dt * 3);
    }
    if (e.t > 0) return false;
    if (e.action === 'ring') {
      const n = (mini ? 12 : 18) + (ph - 1) * 4;
      const off = Math.random() * Math.PI;
      ring(e, ctx, n, 7, 14, off);
      // Phase 3: a second ring sits in the first one's gaps.
      if (ph >= 3) ring(e, ctx, n, 5, 14, off + Math.PI / n);
      for (let i = -2; i <= 2; i++) {
        const a = Math.atan2(nz, nx) + i * 0.12;
        ctx.fireBullet(e, Math.cos(a), Math.sin(a), 10, 14);
      }
      enter(e, 'recover', 0.8 * pace(e), 8);
    } else if (e.action === 'summon') {
      if (ph >= 3) {
        // Royal guard: Boppers drop in around the target.
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          ctx.spawnChild(R?.vetSummons ? 'v_bopper' : 'bopper', tgt.x + Math.cos(a) * 6, tgt.z + Math.sin(a) * 6, e);
        }
      } else {
        const n = mini ? 5 : 8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          ctx.spawnChild(R?.vetSummons ? 'v_swarmer' : 'swarmer', e.x + Math.cos(a) * 3, e.z + Math.sin(a) * 3, e);
        }
      }
      enter(e, 'recover', 0.8 * pace(e), 8);
    } else {
      e.fromX = e.x;
      e.fromZ = e.z;
      enter(e, 'attack', 0.55, 10);
    }
    return false;
  }
  if (e.state === 'attack') {
    // Airborne: arc from start to the target point.
    const k = 1 - Math.max(0, e.t) / 0.55;
    e.x = e.fromX + (e.targetX - e.fromX) * k;
    e.z = e.fromZ + (e.targetZ - e.fromZ) * k;
    e.hopY = Math.sin(k * Math.PI) * (mini ? 3.5 : 5);
    e.vx = e.vz = 0;
    if (e.t <= 0) {
      e.hopY = 0;
      ctx.slam(e);
      // From phase 2 every landing sends out shockwave rings: dash through them (King EX: from phase 1).
      if (R?.landRing) ring(e, ctx, R.landRing, 6, 13, Math.random() * Math.PI);
      if (ph >= (R?.shockFrom ?? 2) && ctx.boss) {
        ctx.boss.shockwave(e, e.x, e.z, 0);
        if (ph >= 3 && !mini) ctx.boss.shockwave(e, e.x, e.z, 0.45);
      }
      if (--e.burst > 0) {
        e.targetX = tgt.x;
        e.targetZ = tgt.z;
        enter(e, 'windup', 0.6, -6, ctx);
      } else enter(e, 'recover', 1.0 * pace(e), -10);
    }
    return true;
  }
  // recover
  e.vx = e.vz = 0;
  if (e.t <= 0) {
    e.state = 'move';
    e.timerA = 2.2 * pace(e);
  }
  return false;
}

/** Rampage Rex / Rex Jr. Returns true while charging. */
function rex(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): boolean {
  const T = bossMoveTuning;
  const CHARGE_SPEED = 24;
  const CHARGE_TIME = 0.5;
  const ph = e.phase;
  const mini = isMini(e);
  const R = e.def.remix;
  if (e.state === 'move') {
    e.facing = Math.atan2(nx, nz);
    e.vx = nx * speed;
    e.vz = nz * speed;
    e.timerA -= dt;
    if (e.timerA <= 0 && ctx.targetAlive) {
      type Pick = BossAction | 'eight' | 'breath';
      const order: Pick[] =
        ph === 1
          ? ['charge', 'spiral', 'charge', 'waves']
          : ph === 2
            ? (R?.breathFrom ?? 3) <= 2
              ? ['eight', 'charge', 'breath', 'spiral', 'charge', 'waves']
              : ['eight', 'charge', 'spiral', 'charge', 'waves']
            : ['breath', 'charge', 'waves', 'eight', 'breath', 'spiral'];
      let pick: Pick = next(e, order);
      if (dist > 13 && pick !== 'eight' && pick !== 'breath') pick = 'charge';
      e.vx = e.vz = 0;
      e.move = '';
      if (pick === 'eight' || pick === 'breath') {
        e.action = 'summon'; // no stock telegraph; the move draws its own
        e.move = pick;
        lockOn(e, nx, nz);
        e.targetX = e.x;
        e.targetZ = e.z;
        enter(e, 'windup', pick === 'eight' ? 1.1 : 0.9, -6, ctx);
      } else {
        e.action = pick;
        if (pick === 'charge') {
          e.burst = mini ? 2 : ph >= 2 ? 4 : 3;
          lockOn(e, nx, nz);
          enter(e, 'windup', 0.85, -6, ctx);
        } else enter(e, 'windup', 0.7, -5, ctx);
      }
    }
    return false;
  }
  if (e.state === 'windup') {
    e.vx = e.vz = 0;
    // Charges and the breath keep aiming during the first half of the wind-up.
    if ((e.action === 'charge' || e.move === 'breath') && e.t > 0.3) lockOn(e, nx, nz);
    if (e.t > 0) return false;
    if (e.move === 'eight') enter(e, 'attack', eightTime(e), 9);
    else if (e.move === 'breath') {
      e.timerB = 0;
      e.spin = 0;
      enter(e, 'attack', T.breathTime, 6);
    } else if (e.action === 'charge') enter(e, 'attack', CHARGE_TIME, 9);
    else if (e.action === 'spiral') {
      e.spin = Math.atan2(nz, nx);
      e.timerB = 0;
      enter(e, 'attack', mini ? 1.8 : 2.6, 6);
    } else {
      e.burst = mini ? 2 : ph >= 2 ? 4 : 3;
      e.timerB = 0;
      enter(e, 'attack', 1.5, 6);
    }
    return false;
  }
  if (e.state === 'attack') {
    if (e.move === 'eight') {
      // Run the telegraphed figure-eight, straight through cover.
      const s = (1 - Math.max(0, e.t) / eightTime(e)) * Math.PI * 2;
      const p = SCRATCH;
      eightPoint(s, eightSize(e), e.targetX, e.targetZ, e.lungeX, e.lungeZ, p);
      const vx = (p.x - e.x) / Math.max(dt, 1e-4);
      const vz = (p.z - e.z) / Math.max(dt, 1e-4);
      e.vx = vx;
      e.vz = vz;
      if (vx * vx + vz * vz > 0.01) e.facing = Math.atan2(vx, vz);
      ctx.boss?.rampage(e, !mini);
      if (e.t <= 0) {
        e.vx = e.vz = 0;
        e.move = '';
        enter(e, 'recover', 1.0 * pace(e), -8);
      }
      return true;
    }
    if (e.move === 'breath') {
      e.vx = e.vz = 0;
      const base = Math.atan2(e.lungeZ, e.lungeX);
      const a = breathAngle(base, e.t);
      e.facing = Math.atan2(Math.cos(a), Math.sin(a));
      e.timerB -= dt;
      while (e.timerB <= 0) {
        e.timerB += 0.045;
        for (let k = 0; k < 2; k++) {
          const j = a + (Math.random() - 0.5) * 0.16;
          ctx.boss?.shot(e, Math.cos(j), Math.sin(j), 12 + Math.random() * 2, 9, '#ff7a2f', T.breathRange / 13, 0.34);
        }
      }
      e.spin -= dt;
      if (e.spin <= 0) {
        e.spin = 0.4;
        const d = 4 + Math.random() * 4;
        ctx.boss?.firePatch(e, e.x + Math.cos(a) * d, e.z + Math.sin(a) * d);
      }
      if (e.t <= 0) {
        e.move = '';
        enter(e, 'recover', 0.9 * pace(e), 6);
      }
      return false;
    }
    if (e.action === 'charge') {
      e.vx = e.lungeX * CHARGE_SPEED;
      e.vz = e.lungeZ * CHARGE_SPEED;
      ctx.boss?.rampage(e, !mini);
      if (e.t <= 0) {
        e.vx = e.vz = 0;
        if (--e.burst > 0) {
          lockOn(e, nx, nz);
          enter(e, 'windup', 0.45, -5, ctx);
        } else enter(e, 'recover', 1.1 * pace(e), -8);
      }
      return true;
    }
    e.vx = e.vz = 0;
    e.timerB -= dt;
    if (e.action === 'spiral') {
      // Three arms turning steadily: walk around it, not through it (Inferno: four).
      const arms = R?.spiralArms ?? 3;
      while (e.timerB <= 0) {
        e.timerB += 0.1;
        for (let k = 0; k < arms; k++) {
          const a = e.spin + (k / arms) * Math.PI * 2;
          ctx.fireBullet(e, Math.cos(a), Math.sin(a), 7, 12);
        }
        e.spin += 0.24;
      }
    } else if (e.timerB <= 0 && e.burst > 0) {
      // Shockwave rings with a gap that rotates each wave.
      e.timerB = 0.5;
      e.burst--;
      e.squash(-6);
      const n = 22;
      const gap = Math.atan2(nz, nx) + e.burst * 1.3;
      for (let i = 0; i < n; i++) {
        const a = gap + ((i + 1.5) / (n + 2)) * Math.PI * 2;
        ctx.fireBullet(e, Math.cos(a), Math.sin(a), 6.5, 14);
      }
    }
    if (e.t <= 0) enter(e, 'recover', 0.9 * pace(e), 6);
    return false;
  }
  e.vx = e.vz = 0;
  if (e.t <= 0) {
    e.state = 'move';
    e.timerA = 1.8 * pace(e);
  }
  return false;
}

const SCRATCH = { x: 0, z: 0 };

function hover(e: Enemy, dt: number): void {
  e.timerB += dt;
  e.hopY = (isMini(e) ? 1.1 : 1.4) + Math.sin(e.timerB * 3) * 0.3;
}

/** Hive Queen / Hive Princess: hovers at range and circles you. */
function queen(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): void {
  const tgt = ctx.target;
  const ph = e.phase;
  const mini = isMini(e);
  const R = e.def.remix;
  e.facing = Math.atan2(nx, nz);
  hover(e, dt);
  if (e.state === 'move') {
    const radial = dist > 10 ? 1 : dist < 7 ? -1 : 0;
    e.vx = (nx * radial - nz * e.strafe * 0.8) * speed;
    e.vz = (nz * radial + nx * e.strafe * 0.8) * speed;
    e.timerA -= dt;
    if (e.timerA <= 0 && ctx.targetAlive) {
      type Pick = BossAction | 'hive' | 'wall';
      const order: Pick[] =
        ph === 1
          ? mini
            ? ['volley', 'rain', 'volley', 'summon']
            : ['hive', 'volley', 'rain', 'volley', 'summon']
          : ph === 2
            ? (R?.wallFrom ?? 3) <= 2
              ? ['hive', 'volley', 'wall', 'rain', 'hive', 'volley', 'summon']
              : ['hive', 'volley', 'rain', 'hive', 'volley', 'summon']
            : ['wall', 'volley', 'hive', 'rain', 'wall', 'volley'];
      let pick = next(e, order);
      const cap = mini ? 2 : bossMoveTuning.hiveMax;
      if (pick === 'hive' && (ctx.boss?.hiveCount() ?? cap) >= cap) pick = 'volley';
      e.move = pick === 'hive' || pick === 'wall' ? pick : '';
      e.action = e.move ? 'summon' : (pick as BossAction);
      if (Math.random() < 0.3) e.strafe *= -1;
      enter(e, 'windup', e.move === 'wall' ? 0.5 : e.action === 'rain' ? 0.5 : 0.6, -5, ctx);
    }
    return;
  }
  e.vx *= 0.9;
  e.vz *= 0.9;
  if (e.state === 'windup') {
    if (e.t > 0) return;
    if (e.move === 'hive') {
      // Plant hives around the target; each lands after its own telegraph.
      const n = (mini || ph === 1 ? 1 : 2) + (R?.extraHives ?? 0);
      for (let i = 0, tries = 0; i < n && tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2;
        const d = 5 + Math.random() * 3.5;
        if (ctx.boss?.plantHive(e, tgt.x + Math.cos(a) * d, tgt.z + Math.sin(a) * d)) i++;
      }
      e.move = '';
      enter(e, 'recover', 0.8 * pace(e), 8);
    } else if (e.move === 'wall') {
      ctx.boss?.swarmWall(e, tgt.x, tgt.z);
      e.move = '';
      enter(e, 'recover', 1.4 * pace(e), 8);
    } else if (e.action === 'volley') {
      e.burst = mini ? 2 : ph >= 2 ? 4 : 3;
      e.spin = 0;
      enter(e, 'attack', 1.2, 4);
    } else if (e.action === 'rain') {
      rain(ctx, tgt.x, tgt.z, mini ? 4 : ph >= 2 ? 9 : 6, 18);
      enter(e, 'recover', 1.0 * pace(e), 6);
    } else {
      const n = mini ? 4 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.spawnChild(R?.vetSummons ? 'v_zippy' : 'zippy', e.x + Math.cos(a) * 2.5, e.z + Math.sin(a) * 2.5, e);
      }
      enter(e, 'recover', 0.8 * pace(e), 8);
    }
    return;
  }
  if (e.state === 'attack') {
    e.spin -= dt;
    if (e.spin <= 0 && e.burst > 0) {
      e.spin = 0.35;
      e.burst--;
      const base = Math.atan2(nz, nx);
      const fan = R?.fanBullets ?? 7; // the fan widens with the bullets, keeping its gaps
      for (let i = 0; i < fan; i++) {
        const a = base + (i / (fan - 1) - 0.5) * 0.9 * ((fan - 1) / 6);
        ctx.fireBullet(e, Math.cos(a), Math.sin(a), 9.5, 13);
      }
      e.squash(5);
    }
    if (e.t <= 0) enter(e, 'recover', 0.6 * pace(e), 4);
    return;
  }
  if (e.t <= 0) {
    e.state = 'move';
    e.timerA = 1.6 * pace(e);
  }
}

/** Omega Overlord attack rotation per phase. */
const OMEGA_ORDER: BossAction[][] = [
  ['ring', 'charge', 'rain', 'slam', 'summon'],
  ['spiral', 'charge', 'waves', 'rain', 'volley', 'slam', 'summon'],
  ['spiral', 'charge', 'waves', 'volley', 'slam', 'ring'],
];

/**
 * Omega Overlord, the final boss. Phase 1 mixes the other bosses' attacks:
 * staggered rings, charge chains, strike rain, jump slams and summons. Phase 2
 * (omegaTuning.phase2At) adds a counter-rotating bullet spiral, gap waves and
 * aimed fans, and its charges end in a burst. Phase 3 (phase3At) is faster and
 * rains strikes on you with every attack. Every attack winds up for at least
 * 0.4 s and every pattern leaves gaps. Returns true while charging or airborne.
 */
function omega(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): boolean {
  const tgt = ctx.target;
  const ph = Math.min(3, e.phase);
  const C = e.def.charge!;
  if (e.state === 'move') {
    e.facing = Math.atan2(nx, nz);
    e.vx = nx * speed;
    e.vz = nz * speed;
    e.timerA -= dt;
    if (e.timerA <= 0 && ctx.targetAlive) {
      const order = OMEGA_ORDER[ph - 1];
      // Far away: close in with a charge or a jump.
      e.action = dist > C.range ? (e.step % 2 ? 'slam' : 'charge') : order[e.step % order.length];
      e.step++;
      e.vx = e.vz = 0;
      e.burst = e.action === 'slam' ? ph : ph + 1; // slams, charges, rings, waves, fans
      e.targetX = tgt.x;
      e.targetZ = tgt.z;
      if (e.action === 'charge') lockOn(e, nx, nz);
      if (ph === 3 && e.action !== 'rain') rain(ctx, tgt.x, tgt.z, 2, 22);
      enter(e, 'windup', e.action === 'charge' ? C.windup : e.action === 'slam' ? 1.0 : 0.7, -6, ctx);
    }
    return false;
  }
  if (e.state === 'windup') {
    e.vx = e.vz = 0;
    if (e.action === 'charge' && e.t > 0.35) lockOn(e, nx, nz);
    if (e.action === 'slam' && e.t > 0.45) {
      e.targetX += (tgt.x - e.targetX) * Math.min(1, dt * 3);
      e.targetZ += (tgt.z - e.targetZ) * Math.min(1, dt * 3);
    }
    if (e.t > 0) return false;
    if (e.action === 'charge') enter(e, 'attack', C.duration, 9);
    else if (e.action === 'slam') {
      e.fromX = e.x;
      e.fromZ = e.z;
      enter(e, 'attack', 0.6, 10);
    } else if (e.action === 'rain') {
      rain(ctx, tgt.x, tgt.z, 4 + ph * 2, 22);
      enter(e, 'recover', pace(e), 6);
    } else if (e.action === 'summon') {
      const n = 6 + ph * 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.spawnChild(ph >= 2 && i % 2 ? 'exploder' : 'zippy', e.x + Math.cos(a) * 3.2, e.z + Math.sin(a) * 3.2, e);
      }
      enter(e, 'recover', 0.8 * pace(e), 8);
    } else {
      // Timed patterns (ring, spiral, waves, volley) play out in 'attack'.
      e.timerB = 0;
      e.spin = Math.atan2(nz, nx);
      enter(e, 'attack', e.action === 'spiral' ? 2 + ph * 0.5 : e.burst * (e.action === 'waves' ? 0.5 : 0.35), 6);
    }
    return false;
  }
  if (e.state === 'attack') {
    if (e.action === 'charge') {
      e.vx = e.lungeX * C.speed;
      e.vz = e.lungeZ * C.speed;
      if (e.t <= 0) {
        e.vx = e.vz = 0;
        if (ph >= 2) ring(e, ctx, ph === 3 ? 16 : 10, 6, 14, Math.random());
        if (--e.burst > 0) {
          lockOn(e, nx, nz);
          enter(e, 'windup', 0.45, -5, ctx);
        } else enter(e, 'recover', C.recover * pace(e), -8);
      }
      return true;
    }
    if (e.action === 'slam') {
      const k = 1 - Math.max(0, e.t) / 0.6;
      e.x = e.fromX + (e.targetX - e.fromX) * k;
      e.z = e.fromZ + (e.targetZ - e.fromZ) * k;
      e.hopY = Math.sin(k * Math.PI) * 6;
      e.vx = e.vz = 0;
      if (e.t <= 0) {
        e.hopY = 0;
        ctx.slam(e);
        if (ph >= 3) ctx.boss?.shockwave(e, e.x, e.z, 0);
        if (--e.burst > 0) {
          e.targetX = tgt.x;
          e.targetZ = tgt.z;
          enter(e, 'windup', 0.6, -6, ctx);
        } else enter(e, 'recover', pace(e), -10);
      }
      return true;
    }
    e.vx = e.vz = 0;
    e.timerB -= dt;
    if (e.action === 'spiral') {
      // Fast arms one way, slower sparse arms the other: weave through the lattice.
      while (e.timerB <= 0) {
        e.timerB += 0.1;
        e.burst = e.burst ? 0 : 1;
        for (let k = 0; k < 3; k++) {
          const a = e.spin + (k / 3) * Math.PI * 2;
          ctx.fireBullet(e, Math.cos(a), Math.sin(a), 7, 13);
          const b = -e.spin + (k / 3) * Math.PI * 2 + Math.PI / 3;
          if (e.burst) ctx.fireBullet(e, Math.cos(b), Math.sin(b), 5, 13);
        }
        e.spin += 0.22;
      }
    } else if (e.timerB <= 0 && e.burst > 0) {
      e.timerB = e.action === 'waves' ? 0.5 : 0.35;
      e.burst--;
      const aim = Math.atan2(nz, nx);
      if (e.action === 'ring') {
        // Each ring sits in the gaps of the last: slip through, then sidestep.
        ring(e, ctx, 22, 7.5, 15, e.spin + (e.burst % 2) * (Math.PI / 22));
        e.squash(5);
      } else if (e.action === 'waves') {
        // Shockwave rings with a wide gap that moves each wave.
        const n = 24;
        const gap = aim + e.burst * 1.3;
        for (let i = 0; i < n; i++) {
          const a = gap + ((i + 1.5) / (n + 2)) * Math.PI * 2;
          ctx.fireBullet(e, Math.cos(a), Math.sin(a), 6.5, 15);
        }
        e.squash(-6);
      } else {
        for (let i = 0; i < 7; i++) {
          const a = aim + (i / 6 - 0.5) * 0.9;
          ctx.fireBullet(e, Math.cos(a), Math.sin(a), 10, 14);
        }
        e.squash(5);
      }
    }
    if (e.t <= 0) enter(e, 'recover', 0.8 * pace(e), 6);
    return false;
  }
  e.vx = e.vz = 0;
  if (e.t <= 0) {
    e.state = 'move';
    e.timerA = 2.0 * pace(e);
  }
  return false;
}
