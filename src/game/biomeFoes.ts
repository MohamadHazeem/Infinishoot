import * as THREE from 'three';
import type { EnemyDef } from '../data/enemies';
import { aggro, flankBend, type Enemy, type EnemyCtx, type EnemyState } from './enemies';

/**
 * Biome-native enemies, one per biome (data in src/data/enemies.ts, filtered
 * by `EnemyDef.biomes` in the director). Pure behaviour and shared helpers;
 * the Game side (gusts, crashes, lava damage) is src/game/systems/biomeFoes.ts
 * and the ground telegraphs are src/game/biomeFoeView.ts.
 *
 * - Bumble Bee (meadow): circles you, then dives straight through; bees nearby
 *   dive right after it along the same line, so packs come in columns.
 * - Sand Shark (dunes): swims under the sand (can't be hit, only its fin and a
 *   ripple show), marks a ring under you, bursts out, then lies exposed.
 * - Snowball Roller (peaks): rolls in wide arcs and can't turn sharply; it
 *   grows as it rolls, and a big one shatters on walls and heroes.
 * - Lava Slug (magma): leaves burning puddles; now and then swells and spills a big one.
 * - Wind-up Soldier (factory): rewinds (key spins, line shows the path),
 *   marches straight in rank with its squad, then winds down, exposed.
 * - Gust Kite (sky ruins): keeps its distance and blows a cone of wind that shoves you.
 *
 * Clients see it all from synced state: `state`, `t`, the lunge angle, the
 * target point, and `Enemy.sub` (3 bits in the enemy record) for the shark
 * being underground and the snowball's size.
 */
export const biomeFoeTuning = {
  /** Lava puddles: most alive at once, hero damage tick (s). */
  puddleCap: 160,
  puddleTick: 0.4,
  /** Snowball crash: enemies in the blast are frozen this long. */
  crashFreeze: 1.2,
  /** Gust: how hard it shoves other enemies (x the hero push). */
  gustEnemies: 0.6,
  /** Shark: fin height while it swims under the sand (x radius). */
  sharkFin: 1.3,
};

/** Side effects the biome foes need from the game (host only). */
export interface BiomeFoeApi {
  /** Shark: dust when it dives under or bursts out. */
  puff(e: Enemy, kind: 'burrow' | 'surface'): void;
  /** Snowball shatters: hurts heroes within r, freezes enemies nearby, and dies. */
  crash(e: Enemy, r: number, damage: number): void;
  /** Kite: a cone of wind along (dirX, dirZ). */
  gust(e: Enemy, dirX: number, dirZ: number): void;
}

export interface BiomeOut {
  x: number;
  z: number;
  rigid: boolean;
}

const near: Enemy[] = [];

function enter(e: Enemy, s: EnemyState, t: number, squash: number, ctx?: EnemyCtx): void {
  e.state = s;
  e.t = t;
  e.squash(squash);
  if (s === 'attack') e.hitPlayer = false;
  if (s === 'windup' && ctx) ctx.onWindup(e);
}

function lockOn(e: Enemy, nx: number, nz: number): void {
  e.lungeX = nx;
  e.lungeZ = nz;
  e.facing = Math.atan2(nx, nz);
}

/** Hold a ring of radius `keep` around the target, circling sideways. */
function orbit(
  e: Enemy,
  nx: number,
  nz: number,
  dist: number,
  speed: number,
  keep: number,
  side: number,
  out: BiomeOut,
): void {
  const radial = dist > keep + 1 ? 1 : dist < keep - 1.2 ? -0.9 : 0;
  out.x = (nx * radial - nz * e.strafe * side) * speed;
  out.z = (nz * radial + nx * e.strafe * side) * speed;
}

/** Elites start a size step up; the snowball's growth adds to it. */
export function baseScale(e: Enemy): number {
  return e.elite ? 1.6 : 1;
}

/** Apply `e.sub` to what clients draw: the shark underground, the snowball's size. */
export function syncSub(e: Enemy): void {
  const d = e.def;
  if (d.burrow) e.under = e.sub === 1;
  else if (d.roll) {
    e.scale = baseScale(e) * (1 + d.roll.growth * e.sub);
    e.radius = d.radius * e.scale;
  }
}

/** Movement for flying or burrowing foes ignores walls. */
export function ignoresWalls(e: Enemy): boolean {
  return e.under || e.def.behavior === 'kite';
}

/**
 * One biome foe's behaviour for this step. Writes the wanted velocity to
 * `out`; returns false if the enemy is gone (a snowball that shattered).
 */
export function behaveBiome(
  e: Enemy,
  dt: number,
  ctx: EnemyCtx,
  dx: number,
  dz: number,
  nx: number,
  nz: number,
  dist: number,
  speed: number,
  out: BiomeOut,
): boolean {
  out.x = out.z = 0;
  out.rigid = false;
  switch (e.def.behavior) {
    case 'diver':
      diver(e, dt, ctx, dx, dz, nx, nz, dist, speed, out);
      break;
    case 'burrower':
      burrower(e, dt, ctx, nx, nz, dist, speed, out);
      break;
    case 'roller':
      return roller(e, dt, ctx, nx, nz, dist, speed, out);
    case 'slug': {
      const O = e.def.ooze!;
      if (e.state === 'move') {
        const b = flankBend(e.flank, dist);
        const c = Math.cos(b);
        const s = Math.sin(b);
        out.x = (nx * c - nz * s) * speed;
        out.z = (nx * s + nz * c) * speed;
        e.facing = Math.atan2(out.x, out.z);
        e.timerA -= dt;
        if (e.timerA <= 0 && dist < 9 && ctx.targetAlive)
          enter(e, 'windup', aggro(e, O.windup, true), -6, ctx);
      } else if (e.state === 'windup') {
        // Swells up (drawn by the view); the spill itself is derived from the state change (see tickFoeFx).
        if (e.t <= 0) {
          e.state = 'move';
          e.squash(10);
          e.timerA = aggro(e, O.spill * (0.8 + Math.random() * 0.4));
        }
      } else e.state = 'move';
      break;
    }
    case 'marcher':
      marcher(e, dt, ctx, nx, nz, dist, speed, out);
      break;
    case 'kite': {
      const G = e.def.gust!;
      if (e.state === 'move') {
        orbit(e, nx, nz, dist, speed, G.keepDistance, 0.8, out);
        e.facing = Math.atan2(dx, dz);
        e.timerA -= dt;
        if (e.timerA <= 0 && dist < G.range + 1 && ctx.targetAlive) {
          lockOn(e, nx, nz);
          enter(e, 'windup', aggro(e, G.windup, true), -4, ctx);
        }
      } else if (e.state === 'windup') {
        // Tracks you for the first half of the wind-up, then the cone is set.
        if (e.t > aggro(e, G.windup, true) * 0.5) lockOn(e, nx, nz);
        if (e.t <= 0) {
          ctx.foe?.gust(e, e.lungeX, e.lungeZ);
          enter(e, 'recover', 0.5, 8);
        }
      } else if (e.t <= 0) {
        e.state = 'move';
        e.timerA = aggro(e, G.interval * (0.8 + Math.random() * 0.4));
      }
      break;
    }
  }
  return true;
}

function diver(
  e: Enemy,
  dt: number,
  ctx: EnemyCtx,
  dx: number,
  dz: number,
  nx: number,
  nz: number,
  dist: number,
  speed: number,
  out: BiomeOut,
): void {
  const D = e.def.dive!;
  if (e.state === 'move') {
    orbit(e, nx, nz, dist, speed, D.hover, 0.9, out);
    e.facing = Math.atan2(dx, dz);
    e.timerA -= dt;
    if (e.timerA <= 0 && dist < D.range && ctx.targetAlive) {
      lockOn(e, nx, nz);
      enter(e, 'windup', aggro(e, D.windup, true), -4, ctx);
      // Bees close by fall in behind it: same line, a beat later each.
      const n = ctx.hash.queryInto(e.x, e.z, D.follow, near);
      let k = 0;
      for (let i = 0; i < n && k < 5; i++) {
        const o = near[i];
        if (o === e || o.def.behavior !== 'diver' || o.state !== 'move' || !o.alive) continue;
        k++;
        o.lungeX = e.lungeX;
        o.lungeZ = e.lungeZ;
        o.facing = e.facing;
        enter(o, 'windup', e.t + 0.14 * k, -4);
      }
    }
  } else if (e.state === 'windup') {
    e.sq = Math.min(e.sq, -0.2);
    if (e.t <= 0) enter(e, 'attack', D.duration, 7);
  } else if (e.state === 'attack') {
    out.x = e.lungeX * D.speed;
    out.z = e.lungeZ * D.speed;
    out.rigid = true;
    if (e.t <= 0) enter(e, 'recover', aggro(e, D.recover), -3);
  } else if (e.t <= 0) {
    e.state = 'move';
    e.timerA = aggro(e, D.interval * (0.7 + Math.random() * 0.6));
  }
}

function burrower(
  e: Enemy,
  dt: number,
  ctx: EnemyCtx,
  nx: number,
  nz: number,
  dist: number,
  speed: number,
  out: BiomeOut,
): void {
  const B = e.def.burrow!;
  const tgt = ctx.target;
  if (e.state === 'move') {
    if (!e.under) {
      // Fresh from spawning (or done lying exposed): dive under.
      e.under = true;
      e.sub = 1;
      e.timerA = B.under;
      ctx.foe?.puff(e, 'burrow');
    }
    out.x = nx * speed * B.swim;
    out.z = nz * speed * B.swim;
    e.facing = Math.atan2(nx, nz);
    e.timerA -= dt;
    if (e.timerA <= 0 && dist < B.range * e.scale + 1 && ctx.targetAlive) {
      e.targetX = tgt.x;
      e.targetZ = tgt.z;
      enter(e, 'windup', aggro(e, B.windup, true), -3, ctx);
    }
  } else if (e.state === 'windup') {
    // Still under: creeps after you while the ring follows for the first half, then commits.
    out.x = nx * speed * 0.4;
    out.z = nz * speed * 0.4;
    if (e.t > aggro(e, B.windup, true) * 0.5) {
      e.targetX = tgt.x;
      e.targetZ = tgt.z;
    }
    if (e.t <= 0) {
      e.under = false;
      e.sub = 0;
      e.fromX = e.x;
      e.fromZ = e.z;
      ctx.foe?.puff(e, 'surface');
      enter(e, 'attack', B.air, 10);
    }
  } else if (e.state === 'attack') {
    const k = 1 - Math.max(0, e.t) / B.air;
    e.x = e.fromX + (e.targetX - e.fromX) * k;
    e.z = e.fromZ + (e.targetZ - e.fromZ) * k;
    e.hopY = Math.sin(k * Math.PI) * 1.6 * e.scale;
    e.facing = Math.atan2(e.targetX - e.fromX, e.targetZ - e.fromZ);
    out.rigid = true;
    if (e.t <= 0) {
      e.hopY = 0;
      ctx.land(e, B.radius * e.scale, B.damage);
      enter(e, 'recover', aggro(e, B.exposed), -10);
    }
  } else if (e.t <= 0) e.state = 'move'; // dives again on the next step
}

function roller(
  e: Enemy,
  dt: number,
  ctx: EnemyCtx,
  nx: number,
  nz: number,
  dist: number,
  speed: number,
  out: BiomeOut,
): boolean {
  const R = e.def.roll!;
  if (e.state !== 'move') e.state = 'move';
  // Turns slowly toward you (slower the bigger it gets), so a sidestep beats it.
  let da = Math.atan2(nx, nz) - e.facing;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  const turn = R.turn * (1 - 0.07 * e.sub) * dt;
  if (ctx.targetAlive) e.facing += Math.max(-turn, Math.min(turn, da));
  const v = speed * (1 + 0.08 * e.sub);
  const fx = Math.sin(e.facing);
  const fz = Math.cos(e.facing);
  out.x = fx * v;
  out.z = fz * v;
  out.rigid = true;
  // Grows a step every `growEvery` metres rolled: bigger, tougher, harder-hitting.
  e.timerB += v * dt;
  if (e.timerB >= R.growEvery && e.sub < R.maxSteps) {
    e.timerB = 0;
    const was = 1 + R.growth * e.sub;
    e.sub++;
    const k = (1 + R.growth * e.sub) / was;
    e.maxHp *= k;
    e.hp *= k;
    e.dmgMul *= k;
    syncSub(e);
    e.squash(4);
  }
  // A big snowball shatters on cover and on heroes.
  if (e.sub >= R.crashAt) {
    const hitHero = ctx.targetAlive && dist < ctx.target.radius + e.radius + 0.15;
    const ahead = e.radius + 0.25;
    if (hitHero || ctx.walls.hitCircle(e.x + fx * ahead, e.z + fz * ahead, 0.2)) {
      ctx.foe?.crash(e, R.radius * (e.scale / baseScale(e)) * (e.elite ? 1.3 : 1), R.damage);
      return false;
    }
  }
  return true;
}

function marcher(
  e: Enemy,
  dt: number,
  ctx: EnemyCtx,
  nx: number,
  nz: number,
  dist: number,
  speed: number,
  out: BiomeOut,
): void {
  const M = e.def.march!;
  if (e.state === 'move') {
    // Toddles toward you until its first rewind.
    out.x = nx * speed * 0.5;
    out.z = nz * speed * 0.5;
    e.facing = Math.atan2(nx, nz);
    e.timerA -= dt;
    if (e.timerA <= 0 && ctx.targetAlive) rewind(e, ctx, nx, nz, M.rank);
  } else if (e.state === 'windup') {
    e.sq = Math.min(e.sq, -0.15);
    if (e.t <= 0) enter(e, 'attack', M.walk, 6);
  } else if (e.state === 'attack') {
    out.x = e.lungeX * M.speed;
    out.z = e.lungeZ * M.speed;
    out.rigid = true;
    e.facing = Math.atan2(e.lungeX, e.lungeZ);
    if (e.t <= 0) {
      // Winds down: stands still and takes extra damage (Exposed) until it rewinds.
      enter(e, 'recover', aggro(e, M.rest), -6);
      e.exposeT = Math.max(e.exposeT, e.t);
    }
  } else if (e.t <= 0 && ctx.targetAlive) rewind(e, ctx, nx, nz, M.rank);
  void dist;
}

/** Wind-up soldier rewinds, and the soldiers near it fall into rank on the same heading. */
function rewind(e: Enemy, ctx: EnemyCtx, nx: number, nz: number, rank: number): void {
  const M = e.def.march!;
  lockOn(e, nx, nz);
  enter(e, 'windup', aggro(e, M.windup, true), -4, ctx);
  const n = ctx.hash.queryInto(e.x, e.z, rank, near);
  for (let i = 0; i < n; i++) {
    const o = near[i];
    if (
      o === e ||
      o.def.behavior !== 'marcher' ||
      !o.alive ||
      o.state === 'attack' ||
      o.state === 'windup'
    )
      continue;
    if (o.state === 'recover' && o.t > 0.6) continue; // still winding down
    o.lungeX = e.lungeX;
    o.lungeZ = e.lungeZ;
    o.facing = e.facing;
    enter(o, 'windup', e.t, -4);
  }
}

// ---------------------------------------------------------------- lava puddles (shared by host and clients)

export interface Puddle {
  x: number;
  z: number;
  r: number;
  t: number;
  life: number;
  dps: number;
  /** Damage multiplier of the slug that left it (stage scaling). */
  mul: number;
}

/**
 * Lava Slug puddles. Every machine derives them from the synced slugs (a small
 * puddle each `ooze.every` s while it moves, a big one when a swell ends), so
 * they cost no network traffic; only the host deals damage with them.
 */
export class LavaPuddles {
  readonly list: Puddle[] = [];
  private seen = new Map<
    Enemy,
    { uid: number; x: number; z: number; t: number; state: EnemyState }
  >();

  clear(): void {
    this.list.length = 0;
    this.seen.clear();
  }

  add(x: number, z: number, r: number, life: number, dps: number, mul: number): void {
    if (this.list.length >= biomeFoeTuning.puddleCap) this.list.shift();
    this.list.push({ x, z, r, t: 0, life, dps, mul });
  }

  /** Advance puddles and drop new ones behind every slug in `enemies`. */
  tick(dt: number, enemies: readonly Enemy[]): void {
    for (let i = this.list.length - 1; i >= 0; i--)
      if ((this.list[i].t += dt) >= this.list[i].life) this.list.splice(i, 1);
    for (const e of enemies) {
      const O = e.def.ooze;
      if (!O || !e.active || e.state === 'spawning') continue;
      let s = this.seen.get(e);
      if (!s || s.uid !== e.uid)
        this.seen.set(e, (s = { uid: e.uid, x: e.x, z: e.z, t: 0, state: e.state }));
      s.t += dt;
      if (s.t >= O.every && (e.x - s.x) ** 2 + (e.z - s.z) ** 2 > 0.04) {
        s.t = 0;
        s.x = e.x;
        s.z = e.z;
        this.add(e.x, e.z, O.r * e.scale, O.life, O.dps, e.dmgMul);
      }
      if (s.state === 'windup' && e.state !== 'windup')
        this.add(e.x, e.z, O.spillR * e.scale, O.life * 1.5, O.dps, e.dmgMul);
      s.state = e.state;
    }
    if (this.seen.size > 64)
      for (const [e, s] of this.seen) if (!e.active || e.uid !== s.uid) this.seen.delete(e);
  }

  /** The puddle (x, z) stands in, if any. */
  at(x: number, z: number, pad: number): Puddle | null {
    for (const p of this.list) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + pad) ** 2) return p;
    return null;
  }
}

export const lavaPuddles = new LavaPuddles();

// ---------------------------------------------------------------- models

type Part = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => void;
const DARK = '#2b2f4a';

/** Merged vertex-coloured models for the biome foes (see buildModel in enemies.ts). */
export function buildBiomeModel(def: EnemyDef, add: Part): void {
  const r = def.radius;
  const B = def.bodyColor;
  const A = def.accentColor;
  const eyes = (y: number, z: number, sx: number, s: number) => {
    for (const k of [-1, 1]) {
      add(new THREE.SphereGeometry(r * 0.24 * s, 8, 6), '#ffffff', k * sx, y, z);
      add(
        new THREE.SphereGeometry(r * 0.12 * s, 6, 4),
        DARK,
        k * sx,
        y + r * 0.02,
        z + r * 0.16 * s,
      );
    }
  };
  switch (def.model) {
    case 'bee': {
      // Round striped bumble bee with glassy wings and a stinger, hovering.
      const y = 1.0;
      add(new THREE.SphereGeometry(r, 10, 8).scale(1, 0.95, 1.2), B, 0, y, 0);
      for (const z of [-0.25, 0.2])
        add(
          new THREE.CylinderGeometry(r * 0.98, r * 0.98, r * 0.22, 12).rotateX(Math.PI / 2),
          A,
          0,
          y,
          z * r * 2,
        );
      add(
        new THREE.ConeGeometry(r * 0.22, r * 0.6, 6).rotateX(-Math.PI / 2),
        A,
        0,
        y - r * 0.1,
        -r * 1.35,
      );
      for (const k of [-1, 1]) {
        add(
          new THREE.BoxGeometry(r * 1.05, 0.05, r * 0.6).rotateZ(k * -0.45),
          '#e8fbff',
          k * r * 0.8,
          y + r * 0.75,
          -r * 0.1,
        );
        add(
          new THREE.CylinderGeometry(0.025, 0.025, r * 0.7, 4).rotateZ(k * -0.4),
          DARK,
          k * r * 0.3,
          y + r * 1.05,
          r * 0.7,
        );
        add(new THREE.SphereGeometry(r * 0.12, 5, 4), A, k * r * 0.45, y + r * 1.35, r * 0.75);
      }
      eyes(y + r * 0.2, r * 0.95, r * 0.35, 1.1);
      break;
    }
    case 'shark': {
      // Sand shark: long body, tall dorsal fin (all that shows while it swims), tail, toothy grin.
      const y = r * 0.7;
      add(new THREE.SphereGeometry(r, 12, 8).scale(0.8, 0.62, 1.55), B, 0, y, 0);
      add(
        new THREE.SphereGeometry(r * 0.85, 10, 6).scale(0.75, 0.4, 1.4),
        '#f4f4f4',
        0,
        y - r * 0.22,
        r * 0.1,
      );
      add(
        new THREE.ConeGeometry(r * 0.32, r * 1.05, 4).scale(0.35, 1, 1.2),
        B,
        0,
        y + r * 0.9,
        -r * 0.15,
      );
      add(new THREE.BoxGeometry(r * 0.08, r * 0.2, r * 0.4), A, 0, y + r * 1.35, -r * 0.25);
      add(
        new THREE.ConeGeometry(r * 0.38, r * 0.7, 4).rotateX(-Math.PI / 2).scale(0.3, 1.4, 1),
        B,
        0,
        y + r * 0.1,
        -r * 1.75,
      );
      add(new THREE.BoxGeometry(r * 0.9, r * 0.1, r * 0.08), '#ffffff', 0, y - r * 0.15, r * 1.42);
      for (const k of [-1, 1]) {
        add(
          new THREE.BoxGeometry(r * 0.7, r * 0.06, r * 0.35).rotateZ(k * 0.4),
          B,
          k * r * 0.75,
          y - r * 0.25,
          r * 0.15,
        );
        add(
          new THREE.SphereGeometry(r * 0.13, 6, 4),
          '#ffffff',
          k * r * 0.4,
          y + r * 0.22,
          r * 1.15,
        );
        add(new THREE.SphereGeometry(r * 0.07, 5, 4), DARK, k * r * 0.42, y + r * 0.24, r * 1.24);
      }
      break;
    }
    case 'snowball': {
      // Built round its centre so it can roll in place (the view lifts it by its radius).
      add(new THREE.IcosahedronGeometry(r, 1), B, 0, 0, 0);
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4;
        const b = (i % 2 ? 0.6 : -0.4) + i * 0.2;
        add(
          new THREE.OctahedronGeometry(r * 0.28, 0),
          A,
          Math.cos(a) * Math.cos(b) * r * 0.92,
          Math.sin(b) * r * 0.92,
          Math.sin(a) * Math.cos(b) * r * 0.92,
        );
      }
      for (const k of [-1, 1])
        add(
          new THREE.BoxGeometry(r * 0.16, r * 0.2, r * 0.1),
          DARK,
          k * r * 0.3,
          r * 0.25,
          r * 0.93,
        );
      add(
        new THREE.ConeGeometry(r * 0.12, r * 0.5, 5).rotateX(Math.PI / 2),
        '#ff7a2f',
        0,
        r * 0.05,
        r * 1.15,
      );
      add(new THREE.BoxGeometry(r * 0.5, r * 0.08, r * 0.08), DARK, 0, -r * 0.3, r * 0.92);
      break;
    }
    case 'slug': {
      // Lava slug: low slimy body, glowing magma ridge along the back, eye stalks.
      add(new THREE.SphereGeometry(r, 12, 8).scale(0.95, 0.5, 1.6), B, 0, r * 0.42, 0);
      add(
        new THREE.SphereGeometry(r * 1.05, 12, 6).scale(1.05, 0.18, 1.7),
        '#5d275d',
        0,
        r * 0.1,
        0,
      );
      for (let k = 0; k < 4; k++)
        add(
          new THREE.OctahedronGeometry(r * (0.26 - k * 0.03), 0).scale(1, 0.8, 1.3),
          A,
          0,
          r * 0.88 - k * r * 0.04,
          r * (0.55 - k * 0.5),
        );
      for (const k of [-1, 1]) {
        add(
          new THREE.CylinderGeometry(0.04, 0.05, r * 0.7, 4).rotateZ(k * -0.3),
          B,
          k * r * 0.25,
          r * 1.0,
          r * 1.15,
        );
        add(new THREE.SphereGeometry(r * 0.17, 6, 5), '#ffffff', k * r * 0.36, r * 1.35, r * 1.18);
        add(new THREE.SphereGeometry(r * 0.09, 5, 4), DARK, k * r * 0.36, r * 1.37, r * 1.3);
      }
      break;
    }
    case 'soldier': {
      // Tin wind-up soldier: tall shako hat, white cross-belt, big brass key on its back.
      add(new THREE.BoxGeometry(r * 0.32, r * 0.7, r * 0.36), DARK, -r * 0.24, r * 0.35, 0);
      add(new THREE.BoxGeometry(r * 0.32, r * 0.7, r * 0.36), DARK, r * 0.24, r * 0.35, 0);
      add(new THREE.CylinderGeometry(r * 0.55, r * 0.6, r * 1.2, 10), B, 0, r * 1.3, 0);
      add(new THREE.BoxGeometry(r * 0.2, r * 1.1, r * 1.22).rotateX(0.6), '#f4f4f4', 0, r * 1.3, 0);
      add(new THREE.SphereGeometry(r * 0.42, 10, 8), '#f4d6b0', 0, r * 2.2, 0);
      add(new THREE.CylinderGeometry(r * 0.4, r * 0.44, r * 0.75, 10), DARK, 0, r * 2.75, 0);
      add(new THREE.BoxGeometry(r * 0.5, r * 0.1, r * 0.3), DARK, 0, r * 2.4, r * 0.3);
      add(new THREE.SphereGeometry(r * 0.16, 6, 4), '#ff3d5a', 0, r * 3.2, r * 0.05);
      for (const k of [-1, 1]) {
        add(new THREE.SphereGeometry(r * 0.08, 5, 4), DARK, k * r * 0.15, r * 2.25, r * 0.38);
        add(
          new THREE.CylinderGeometry(r * 0.12, r * 0.12, r * 0.9, 6),
          B,
          k * r * 0.68,
          r * 1.3,
          0,
        );
      }
      // The key: a shaft out of its back and two brass loops.
      add(
        new THREE.CylinderGeometry(0.05, 0.05, r * 0.6, 5).rotateX(Math.PI / 2),
        A,
        0,
        r * 1.45,
        -r * 0.85,
      );
      add(
        new THREE.TorusGeometry(r * 0.28, r * 0.07, 4, 10).rotateY(Math.PI / 2),
        A,
        0,
        r * 1.45 + r * 0.32,
        -r * 1.15,
      );
      add(
        new THREE.TorusGeometry(r * 0.28, r * 0.07, 4, 10).rotateY(Math.PI / 2),
        A,
        0,
        r * 1.45 - r * 0.32,
        -r * 1.15,
      );
      break;
    }
    case 'kite': {
      // Diamond kite with a face, cross spars and a tail of bows; it floats (the view adds the bob).
      const y = 1.3;
      add(
        new THREE.BoxGeometry(r * 1.5, r * 1.5, 0.08)
          .rotateZ(Math.PI / 4)
          .scale(0.8, 1.15, 1)
          .rotateX(-1.1),
        B,
        0,
        y,
        0,
      );
      add(new THREE.BoxGeometry(r * 0.06, r * 2.4, 0.06).rotateX(-1.1), DARK, 0, y, 0.02);
      add(new THREE.BoxGeometry(r * 1.7, r * 0.06, 0.06).rotateX(-1.1), DARK, 0, y + 0.05, 0.03);
      eyes(y + r * 0.35, r * 0.25, r * 0.28, 1);
      for (let k = 0; k < 4; k++) {
        const z = -r * (1.1 + k * 0.45);
        add(
          new THREE.BoxGeometry(r * 0.3, 0.06, r * 0.14),
          A,
          (k % 2 ? 1 : -1) * r * 0.08,
          y - r * 0.4 - k * 0.12,
          z,
        );
      }
      add(
        new THREE.CylinderGeometry(0.02, 0.02, r * 2, 4).rotateX(Math.PI / 2 - 0.3),
        '#f4f4f4',
        0,
        y - r * 0.55,
        -r * 1.75,
      );
      break;
    }
  }
}
