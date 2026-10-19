import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { createRetroMaterial } from '../render/retroMaterial';
import { paint } from '../render/geometry';
import { textures } from '../render/textures';
import type { SpatialHash, StaticBoxGrid } from '../core/spatialHash';
import type { AABB } from '../world/collision';
import { commit } from '../render/instancing';
import { viewCull } from '../render/viewCull';
import { ELITE_MODS, type EliteModDef, type EliteModId } from '../data/eliteMods';
import { Corpses, EnemyAnim, poseEnemy, type EnemyPose } from './enemyAnim';
import { bossTuning, updateBoss, type BossApi } from './bosses';
import { crowdTuning, keepOffHeroes } from './crowd';

export type EnemyState = 'spawning' | 'move' | 'windup' | 'attack' | 'recover';
export type BossAction = 'ring' | 'summon' | 'slam' | 'charge' | 'spiral' | 'waves' | 'volley' | 'rain';
export const BOSS_ACTIONS: BossAction[] = ['ring', 'summon', 'slam', 'charge', 'spiral', 'waves', 'volley', 'rain'];

// Boss tuning and brains live in src/game/bosses.ts.
export { bossTuning, omegaTuning } from './bosses';

/** Elites (not bosses) hunt harder than their normal kin. */
export const eliteTuning = {
  speed: 1.2, // move speed multiplier
  pace: 0.65, // multiplier on wind-ups, recoveries and attack cooldowns
  minWindup: 0.3, // telegraphs never get shorter than this (seconds)
  track: 0.2, // lungers and chargers keep aiming until this fraction of the wind-up is left
  extraBullets: 2, // extra bullets per shooter volley (the fan widens to keep its gaps)
  bulletSpeed: 1.25, // shooter bullet speed multiplier
};

/** Crowd AI: flanking chasers, shooters using cover, chargers that don't charge walls. */
export const aiTuning = {
  flankMax: 0.7, // radians a chaser bends its approach at long range, so the crowd closes in from all sides
  wideShare: 0.25, // share of chasers that circle wide before closing in
  wideMin: 1.0, // their bend (radians at long range)
  wideMax: 1.35,
  flankNear: 3, // the bend fades out inside this distance...
  flankFar: 14, // ...and is full beyond this one
  coverSearch: 1.0, // seconds between a shooter's cover searches (jittered so they stagger)
  coverRange: 9, // cover boxes this close to the shooter count
  coverPeek: 0.8, // shooters leave cover this long before their next shot
  rerouteTime: 0.45, // chargers sidestep this long when a wall blocks the charge line
};

/** Elite squads: the escort that follows an elite in formation (src/game/systems/enemyAi.ts spawns it). */
export const squadTuning = {
  spacing: 1.7, // metres between formation rows
  engage: 7, // members break formation and attack inside this distance of a hero
  catchUp: 1.35, // speed multiplier while catching up to their slot
  rallyEvery: 6, // seconds between the elite's rallies
  rallyTime: 3, // rallied members move faster for this long
  rallySpeed: 1.25,
  rallyHeal: 0.15, // fraction of max life a rally heals
  rallyRange: 10,
  scatter: 2.5, // seconds the squad runs for it once its elite dies
};

/** Goldbug (treasure enemy). */
export const goldenTuning = {
  panic: 4.5, // runs faster when a hero gets this close...
  panicSpeed: 1.15, // ...by this much
  edge: 8, // turns back toward the middle this close to the arena edge
};

/**
 * Shield Bot damage factor for a hit coming from direction (fromX, fromZ)
 * (enemy -> attacker, any length): its own front arc, or the arc of the
 * Shield Bot an ally is hiding behind. 1 = no protection.
 */
export function guardFactor(e: Enemy, fromX: number, fromZ: number): number {
  const G = e.def.guard ?? (e.guardT > 0 ? GUARD_DEF : undefined);
  if (!G) return 1;
  const d = Math.hypot(fromX, fromZ);
  if (d < 1e-6) return 1;
  const ang = e.def.guard ? e.facing : e.guardAng;
  const c = (Math.sin(ang) * fromX + Math.cos(ang) * fromZ) / d;
  if (c < Math.cos((G.arcDeg * Math.PI) / 180)) return 1;
  return e.def.guard ? G.frontMul : G.behindMul;
}
const GUARD_DEF = ENEMIES.shielder.guard!;

/** Does the segment from (x, z) along unit (dx, dz) for `len` hit box `b` grown by `pad`? (slab test) */
export function segmentHitsBox(x: number, z: number, dx: number, dz: number, len: number, pad: number, b: AABB): boolean {
  let t0 = 0;
  let t1 = len;
  for (let axis = 0; axis < 2; axis++) {
    const o = axis ? z : x;
    const d = axis ? dz : dx;
    const lo = (axis ? b.minZ : b.minX) - pad;
    const hi = (axis ? b.maxZ : b.maxX) + pad;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let ta = (lo - o) / d;
    let tb = (hi - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** A chaser's approach bend (radians) at distance `dist`: full at long range, none up close. */
export function flankBend(flank: number, dist: number): number {
  const t = aiTuning;
  return flank * Math.max(0, Math.min(1, (dist - t.flankNear) / (t.flankFar - t.flankNear)));
}

/** Elite timing: pauses shrink by eliteTuning.pace; telegraphs too, but never below minWindup. */
function aggro(e: Enemy, t: number, telegraph = false): number {
  if (!e.elite) return t;
  const k = t * eliteTuning.pace;
  return telegraph ? Math.max(Math.min(t, eliteTuning.minWindup), k) : k;
}

const SPAWN_TIME = 0.45;
const BATCH_CAP = 700; // max simultaneous enemies of one type
const DARK = '#2b2f4a';

// ------------------------------------------------------------------ models

type Part = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => void;

/**
 * Builds a vertex-coloured, merged geometry for an enemy model. Each model is
 * authored around its def's radius so variants (e.g. Zippy vs Bopper) scale.
 */
function buildModel(def: EnemyDef, add: Part): void {
  const r = def.radius;
  const B = def.bodyColor;
  const A = def.accentColor;
  const eye = (y: number, z: number, s = 1) => {
    add(new THREE.SphereGeometry(r * 0.42 * s, 8, 6), '#ffffff', 0, y, z);
    add(new THREE.SphereGeometry(r * 0.2 * s, 6, 5), DARK, 0, y + r * 0.02, z + r * 0.34 * s);
  };
  switch (def.model) {
    case 'bopper':
      add(new THREE.SphereGeometry(r, 10, 8), B, 0, r + 0.08, 0);
      add(new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.14, 12), A, 0, r * 0.85, 0);
      eye(r * 1.25, r * 0.72);
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 4), DARK, 0, r * 2 + 0.25, 0);
      add(new THREE.SphereGeometry(0.11, 6, 4), A, 0, r * 2 + 0.47, 0);
      add(new THREE.BoxGeometry(r * 0.4, 0.14, r * 0.55), DARK, -r * 0.5, 0.07, 0.05);
      add(new THREE.BoxGeometry(r * 0.4, 0.14, r * 0.55), DARK, r * 0.5, 0.07, 0.05);
      break;
    case 'swarmer': {
      // Flying bat-ball: round body, two flat wings, one eye. Hovers above ground.
      const y = 0.9;
      add(new THREE.SphereGeometry(r, 8, 6), B, 0, y, 0);
      const wl = new THREE.BoxGeometry(r * 1.5, 0.05, r * 0.9).rotateZ(0.5);
      add(wl, A, -r * 1.1, y + 0.15, -0.05);
      const wr = new THREE.BoxGeometry(r * 1.5, 0.05, r * 0.9).rotateZ(-0.5);
      add(wr, A, r * 1.1, y + 0.15, -0.05);
      eye(y + 0.05, r * 0.7, 0.9);
      break;
    }
    case 'shooter':
      // Turret bot: drum body, dome head, cannon barrel, antenna.
      add(new THREE.CylinderGeometry(r * 0.8, r * 0.95, r * 1.2, 10), B, 0, r * 0.6 + 0.05, 0);
      add(new THREE.SphereGeometry(r * 0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), A, 0, r * 1.25, 0);
      add(new THREE.CylinderGeometry(r * 0.22, r * 0.26, r * 1.1, 8).rotateX(Math.PI / 2), DARK, 0, r * 0.75, r * 0.9);
      add(new THREE.BoxGeometry(r * 0.9, 0.12, r * 0.2), '#ffffff', 0, r * 1.45, r * 0.45);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4), DARK, r * 0.3, r * 1.9 + 0.1, 0);
      add(new THREE.SphereGeometry(0.09, 6, 4), '#ff3d5a', r * 0.3, r * 1.9 + 0.32, 0);
      break;
    case 'charger':
      // Rhino: boxy body, big horn pointing forward, stubby legs.
      add(new THREE.BoxGeometry(r * 1.6, r * 1.1, r * 2.0), B, 0, r * 0.85, 0);
      add(new THREE.BoxGeometry(r * 1.3, r * 0.9, r * 0.8), B, 0, r * 0.95, r * 1.2);
      add(new THREE.ConeGeometry(r * 0.28, r * 1.0, 6).rotateX(Math.PI / 2), A, 0, r * 1.05, r * 2.0);
      add(new THREE.BoxGeometry(r * 1.62, r * 0.2, r * 2.02), A, 0, r * 1.3, 0);
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(r * 0.4, r * 0.4, r * 0.4), DARK, sx * r * 0.5, r * 0.2, r * 0.6);
        add(new THREE.BoxGeometry(r * 0.4, r * 0.4, r * 0.4), DARK, sx * r * 0.5, r * 0.2, -r * 0.6);
        add(new THREE.SphereGeometry(r * 0.16, 6, 4), '#ffffff', sx * r * 0.45, r * 1.15, r * 1.55);
      }
      break;
    case 'exploder':
      // Cartoon bomb with legs and a sparking fuse.
      add(new THREE.SphereGeometry(r, 10, 8), B, 0, r + 0.12, 0);
      add(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.12, 12), A, 0, r + 0.12, 0);
      add(new THREE.CylinderGeometry(r * 0.25, r * 0.3, r * 0.3, 8), '#8a90c8', 0, r * 2 + 0.1, 0);
      add(new THREE.CylinderGeometry(0.04, 0.04, r * 0.5, 4), '#e8c27a', 0, r * 2.4 + 0.1, 0);
      add(new THREE.SphereGeometry(0.12, 6, 4), '#fff35c', 0, r * 2.7 + 0.1, 0);
      eye(r * 1.2, r * 0.75, 0.8);
      add(new THREE.BoxGeometry(0.12, 0.25, 0.12), DARK, -r * 0.45, 0.1, 0);
      add(new THREE.BoxGeometry(0.12, 0.25, 0.12), DARK, r * 0.45, 0.1, 0);
      break;
    case 'splitter':
      // Wobbly jelly cube with two eyes.
      add(new THREE.BoxGeometry(r * 1.7, r * 1.5, r * 1.7), B, 0, r * 0.75, 0);
      add(new THREE.BoxGeometry(r * 1.2, r * 0.25, r * 1.2), '#ffffff', 0, r * 1.55, 0);
      for (const sx of [-1, 1]) {
        add(new THREE.SphereGeometry(r * 0.24, 6, 5), '#ffffff', sx * r * 0.4, r * 0.95, r * 0.85);
        add(new THREE.SphereGeometry(r * 0.12, 6, 4), DARK, sx * r * 0.4, r * 0.95, r * 1.05);
      }
      break;
    case 'spawner':
      // Crystal pylon: wide base, tall spire, glowing orb.
      add(new THREE.CylinderGeometry(r * 1.0, r * 1.2, r * 0.5, 8), DARK, 0, r * 0.25, 0);
      add(new THREE.CylinderGeometry(r * 0.35, r * 0.8, r * 2.2, 6), B, 0, r * 1.6, 0);
      add(new THREE.OctahedronGeometry(r * 0.55, 0), A, 0, r * 3.2, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        add(new THREE.ConeGeometry(r * 0.2, r * 0.9, 4), A, Math.cos(a) * r * 0.9, r * 0.7, Math.sin(a) * r * 0.9);
      }
      break;
    case 'shielder': {
      // Squat tank bot holding a big riot shield out front.
      add(new THREE.BoxGeometry(r * 1.3, r * 1.2, r * 1.1), B, 0, r * 0.75, -r * 0.1);
      add(new THREE.SphereGeometry(r * 0.55, 8, 6), B, 0, r * 1.55, -r * 0.1);
      add(new THREE.BoxGeometry(r * 0.9, r * 0.18, r * 0.2), '#ffffff', 0, r * 1.6, r * 0.38);
      add(new THREE.BoxGeometry(r * 0.5, r * 0.08, r * 0.22), DARK, 0, r * 1.6, r * 0.42);
      // The shield: wide slab with a gold rim and an emblem.
      add(new THREE.BoxGeometry(r * 2.1, r * 1.9, r * 0.18), A, 0, r * 1.0, r * 0.85);
      add(new THREE.BoxGeometry(r * 1.8, r * 1.6, r * 0.2), '#73eff7', 0, r * 1.0, r * 0.87);
      add(new THREE.OctahedronGeometry(r * 0.32, 0), A, 0, r * 1.05, r * 1.0);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(r * 0.45, r * 0.3, r * 0.7), DARK, sx * r * 0.45, r * 0.15, 0);
      break;
    }
    case 'leaper': {
      // Springy frog: wide squat body, bulging eyes on top, big back legs.
      add(new THREE.SphereGeometry(r, 10, 8).scale(1.15, 0.75, 1.1), B, 0, r * 0.8, 0);
      add(new THREE.SphereGeometry(r * 0.75, 10, 6).scale(1.2, 0.5, 1), A, 0, r * 0.62, r * 0.35);
      for (const sx of [-1, 1]) {
        add(new THREE.SphereGeometry(r * 0.32, 8, 6), '#ffffff', sx * r * 0.45, r * 1.35, r * 0.45);
        add(new THREE.SphereGeometry(r * 0.16, 6, 4), DARK, sx * r * 0.45, r * 1.38, r * 0.72);
        add(new THREE.BoxGeometry(r * 0.45, r * 0.45, r * 1.0), B, sx * r * 0.85, r * 0.35, -r * 0.45);
        add(new THREE.BoxGeometry(r * 0.5, r * 0.12, r * 0.6), A, sx * r * 0.85, r * 0.06, -r * 0.1);
        add(new THREE.BoxGeometry(r * 0.25, r * 0.4, r * 0.25), B, sx * r * 0.5, r * 0.2, r * 0.7);
      }
      break;
    }
    case 'medic': {
      // Hovering medic drone: white capsule with a green cross, halo ring and an antenna light.
      add(new THREE.CylinderGeometry(r * 0.75, r * 0.6, r * 1.4, 10), B, 0, r * 1.2, 0);
      add(new THREE.SphereGeometry(r * 0.75, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), B, 0, r * 1.9, 0);
      add(new THREE.BoxGeometry(r * 0.75, r * 0.25, r * 0.12), A, 0, r * 1.3, r * 0.72);
      add(new THREE.BoxGeometry(r * 0.25, r * 0.75, r * 0.12), A, 0, r * 1.3, r * 0.72);
      add(new THREE.BoxGeometry(r * 0.8, r * 0.16, r * 0.14), DARK, 0, r * 1.95, r * 0.6);
      add(new THREE.TorusGeometry(r * 0.9, r * 0.08, 4, 16).rotateX(Math.PI / 2), A, 0, r * 0.45, 0);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 4), DARK, 0, r * 2.65 + 0.1, 0);
      add(new THREE.SphereGeometry(0.1, 6, 4), A, 0, r * 2.65 + 0.3, 0);
      break;
    }
    case 'mortar': {
      // Fat toad with a stubby mortar tube on its back pointing up.
      add(new THREE.SphereGeometry(r, 10, 8).scale(1.1, 0.8, 1.1), B, 0, r * 0.8, 0);
      add(new THREE.SphereGeometry(r * 0.7, 8, 6).scale(1.1, 0.5, 0.9), '#ffcd75', 0, r * 0.55, r * 0.45);
      add(new THREE.CylinderGeometry(r * 0.38, r * 0.45, r * 1.0, 10).rotateX(-0.35), A, 0, r * 1.7, -r * 0.3);
      add(new THREE.CylinderGeometry(r * 0.48, r * 0.48, r * 0.16, 10).rotateX(-0.35), '#f4f4f4', 0, r * 2.15, -r * 0.45);
      for (const sx of [-1, 1]) {
        add(new THREE.SphereGeometry(r * 0.26, 8, 6), '#ffffff', sx * r * 0.42, r * 1.3, r * 0.6);
        add(new THREE.SphereGeometry(r * 0.13, 6, 4), DARK, sx * r * 0.42, r * 1.32, r * 0.82);
        add(new THREE.BoxGeometry(r * 0.4, r * 0.3, r * 0.6), B, sx * r * 0.8, r * 0.15, 0);
      }
      break;
    }
    case 'golden': {
      // Goldbug: shiny gold beetle carrying a bulging loot sack.
      add(new THREE.SphereGeometry(r, 12, 8).scale(1, 0.85, 1.2), B, 0, r * 0.9, 0);
      add(new THREE.BoxGeometry(r * 0.08, r * 0.5, r * 2.2), '#ffb627', 0, r * 1.55, -r * 0.1);
      add(new THREE.SphereGeometry(r * 0.3, 6, 4), A, -r * 0.35, r * 1.5, r * 0.3);
      add(new THREE.SphereGeometry(r * 0.15, 5, 4), '#ffffff', -r * 0.3, r * 1.62, r * 0.35);
      add(new THREE.SphereGeometry(r * 0.5, 10, 6), B, 0, r * 0.95, r * 1.05);
      for (const sx of [-1, 1]) {
        add(new THREE.SphereGeometry(r * 0.2, 6, 5), '#ffffff', sx * r * 0.22, r * 1.15, r * 1.4);
        add(new THREE.SphereGeometry(r * 0.1, 5, 4), DARK, sx * r * 0.22, r * 1.17, r * 1.55);
        add(new THREE.CylinderGeometry(0.03, 0.03, r * 0.7, 4).rotateZ(sx * 0.5), DARK, sx * r * 0.25, r * 1.55, r * 1.2);
        for (let k = -1; k <= 1; k++) add(new THREE.BoxGeometry(r * 0.5, 0.08, 0.1), DARK, sx * r * 0.9, r * 0.25, k * r * 0.6);
      }
      // Loot sack with a coin on top.
      add(new THREE.SphereGeometry(r * 0.6, 8, 6), '#b86f50', 0, r * 1.75, -r * 0.65);
      add(new THREE.CylinderGeometry(r * 0.15, r * 0.25, r * 0.25, 6), '#b86f50', 0, r * 2.35, -r * 0.65);
      add(new THREE.CylinderGeometry(r * 0.28, r * 0.28, 0.06, 10).rotateX(Math.PI / 2), '#fff35c', 0, r * 2.65, -r * 0.65);
      break;
    }
    case 'hive': {
      // Royal hive: stacked honeycomb rings with a dark entrance and a pointed cap.
      add(new THREE.CylinderGeometry(r * 0.8, r * 1.0, r * 0.5, 6), B, 0, r * 0.25, 0);
      add(new THREE.CylinderGeometry(r * 0.95, r * 0.8, r * 0.5, 6), A, 0, r * 0.75, 0);
      add(new THREE.CylinderGeometry(r * 0.75, r * 0.95, r * 0.5, 6), B, 0, r * 1.25, 0);
      add(new THREE.ConeGeometry(r * 0.75, r * 0.7, 6), A, 0, r * 1.85, 0);
      add(new THREE.CylinderGeometry(r * 0.28, r * 0.28, 0.1, 8).rotateX(Math.PI / 2), DARK, 0, r * 0.8, r * 0.86);
      add(new THREE.SphereGeometry(r * 0.16, 6, 4), '#ffffff', 0, r * 2.25, 0);
      break;
    }
    case 'king': {
      add(new THREE.SphereGeometry(r, 14, 10), B, 0, r + 0.1, 0);
      add(new THREE.CylinderGeometry(r * 1.02, r * 1.02, r * 0.22, 16), A, 0, r * 0.85, 0);
      eye(r * 1.25, r * 0.72);
      // Crown
      add(new THREE.CylinderGeometry(r * 0.55, r * 0.6, r * 0.35, 10), '#ffd23f', 0, r * 2.0, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(r * 0.12, r * 0.45, 4), '#ffd23f', Math.cos(a) * r * 0.5, r * 2.35, Math.sin(a) * r * 0.5);
        add(new THREE.SphereGeometry(r * 0.08, 5, 4), '#ff3df0', Math.cos(a) * r * 0.58, r * 2.0, Math.sin(a) * r * 0.58);
      }
      add(new THREE.BoxGeometry(r * 0.5, r * 0.25, r * 0.7), DARK, -r * 0.5, r * 0.12, 0.1);
      add(new THREE.BoxGeometry(r * 0.5, r * 0.25, r * 0.7), DARK, r * 0.5, r * 0.12, 0.1);
      break;
    }
    case 'rex': {
      // Armoured dino-rhino: chunky body, horned head, back spikes, tail, stomping legs.
      add(new THREE.BoxGeometry(r * 1.5, r * 1.0, r * 1.9), B, 0, r * 0.95, -r * 0.1);
      add(new THREE.BoxGeometry(r * 1.2, r * 0.85, r * 0.9), B, 0, r * 1.15, r * 1.15);
      add(new THREE.BoxGeometry(r * 1.0, r * 0.3, r * 0.6), '#ffffff', 0, r * 0.8, r * 1.5);
      add(new THREE.ConeGeometry(r * 0.22, r * 0.9, 6).rotateX(Math.PI / 2.6), A, 0, r * 1.55, r * 1.65);
      add(new THREE.ConeGeometry(r * 0.12, r * 0.45, 5).rotateX(Math.PI / 2.6), A, 0, r * 1.15, r * 1.75);
      for (let k = 0; k < 4; k++) add(new THREE.ConeGeometry(r * 0.2, r * 0.55, 4), A, 0, r * 1.6, r * (0.6 - k * 0.45));
      add(new THREE.ConeGeometry(r * 0.35, r * 1.3, 6).rotateX(-Math.PI / 2), B, 0, r * 0.9, -r * 1.6);
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(r * 0.45, r * 0.6, r * 0.5), DARK, sx * r * 0.55, r * 0.3, r * 0.55);
        add(new THREE.BoxGeometry(r * 0.45, r * 0.6, r * 0.5), DARK, sx * r * 0.55, r * 0.3, -r * 0.65);
        add(new THREE.SphereGeometry(r * 0.17, 6, 4), '#ffffff', sx * r * 0.45, r * 1.35, r * 1.55);
        add(new THREE.SphereGeometry(r * 0.08, 5, 4), DARK, sx * r * 0.45, r * 1.37, r * 1.7);
      }
      break;
    }
    case 'queen': {
      // Flying hive queen: striped body, crown, big wings, stinger.
      add(new THREE.SphereGeometry(r * 0.75, 12, 8), B, 0, r * 1.3, r * 0.35);
      add(new THREE.SphereGeometry(r * 0.9, 12, 8).scale(1, 0.9, 1.25), B, 0, r * 1.1, -r * 0.9);
      for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(r * 0.88 - k * 0.12 * r, r * 0.88 - k * 0.12 * r, r * 0.16, 12).rotateX(Math.PI / 2), DARK, 0, r * 1.1, -r * (0.5 + k * 0.42));
      add(new THREE.ConeGeometry(r * 0.25, r * 0.8, 6).rotateX(-Math.PI / 2), DARK, 0, r * 1.05, -r * 2.25);
      eye(r * 1.45, r * 0.9, 0.9);
      add(new THREE.CylinderGeometry(r * 0.38, r * 0.42, r * 0.28, 8), A, 0, r * 2.05, r * 0.35);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        add(new THREE.ConeGeometry(r * 0.09, r * 0.35, 4), A, Math.cos(a) * r * 0.32, r * 2.32, r * 0.35 + Math.sin(a) * r * 0.32);
      }
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(r * 1.7, 0.06, r * 1.0).rotateZ(sx * -0.35), '#c8f4ff', sx * r * 1.3, r * 1.9, -r * 0.3);
        add(new THREE.BoxGeometry(r * 1.2, 0.06, r * 0.7).rotateZ(sx * -0.2), '#e8fbff', sx * r * 1.1, r * 1.6, -r * 0.9);
      }
      break;
    }
    case 'omega': {
      // Floating robot emperor: hover skirt, armoured chest with a glowing core,
      // gold pauldrons, detached fists, red visor and a fan of crown spikes.
      const GLOW = '#73eff7';
      add(new THREE.CylinderGeometry(r * 0.7, r * 0.3, r * 0.7, 8), B, 0, r * 0.55, 0);
      add(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 0.08, 8), GLOW, 0, r * 0.18, 0);
      add(new THREE.BoxGeometry(r * 1.6, r * 0.95, r * 1.0), B, 0, r * 1.3, 0);
      add(new THREE.BoxGeometry(r * 1.64, r * 0.14, r * 1.04), A, 0, r * 0.88, 0);
      add(new THREE.OctahedronGeometry(r * 0.28, 0), GLOW, 0, r * 1.35, r * 0.52);
      add(new THREE.BoxGeometry(r * 0.7, r * 0.55, r * 0.65), B, 0, r * 2.05, 0);
      add(new THREE.BoxGeometry(r * 0.74, r * 0.16, r * 0.2), '#ff3d5a', 0, r * 2.1, r * 0.28);
      for (let k = -2; k <= 2; k++) {
        add(new THREE.ConeGeometry(r * 0.09, r * (0.75 - Math.abs(k) * 0.15), 4).rotateZ(-k * 0.3), A, k * r * 0.2, r * 2.6, -r * 0.12);
      }
      for (const sx of [-1, 1]) {
        add(new THREE.SphereGeometry(r * 0.4, 8, 6), A, sx * r * 0.95, r * 1.75, 0);
        add(new THREE.ConeGeometry(r * 0.1, r * 0.5, 4).rotateZ(-sx * 0.7), '#ffffff', sx * r * 1.2, r * 2.1, 0);
        add(new THREE.BoxGeometry(r * 0.5, r * 0.5, r * 0.55), B, sx * r * 1.4, r * 0.95, r * 0.45);
        add(new THREE.BoxGeometry(r * 0.54, r * 0.14, r * 0.59), A, sx * r * 1.4, r * 1.12, r * 0.45);
      }
      break;
    }
    case 'reaper': {
      // Hooded spectre: floating tattered robe, void face with red eyes, scythe.
      add(new THREE.ConeGeometry(r * 0.95, r * 2.4, 8), B, 0, r * 1.5, 0);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        add(new THREE.ConeGeometry(r * 0.2, r * 0.5, 4).rotateX(Math.PI), B, Math.cos(a) * r * 0.75, r * 0.2, Math.sin(a) * r * 0.75);
      }
      add(new THREE.SphereGeometry(r * 0.55, 10, 8), B, 0, r * 2.4, 0);
      add(new THREE.ConeGeometry(r * 0.35, r * 0.6, 6).rotateX(-0.5), B, 0, r * 2.85, -r * 0.15);
      add(new THREE.CylinderGeometry(r * 0.36, r * 0.36, 0.04, 10).rotateX(Math.PI / 2), DARK, 0, r * 2.35, r * 0.5);
      for (const sx of [-1, 1]) add(new THREE.SphereGeometry(r * 0.08, 5, 4), '#ff3d5a', sx * r * 0.14, r * 2.42, r * 0.54);
      add(new THREE.BoxGeometry(r * 0.3, r * 0.3, r * 0.8), B, r * 0.55, r * 1.7, r * 0.35);
      add(new THREE.SphereGeometry(r * 0.14, 6, 4), '#f4f4f4', r * 0.85, r * 1.7, r * 0.6);
      add(new THREE.CylinderGeometry(0.05, 0.05, r * 3.6, 5), '#566c86', r * 0.85, r * 1.7, r * 0.6);
      // Blade hooks out and down from the top of the staff.
      add(new THREE.TorusGeometry(r * 0.9, r * 0.09, 3, 10, Math.PI * 0.75).rotateZ(-Math.PI / 4), A, r * 0.85, r * 2.6, r * 0.6);
      break;
    }
  }
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function enemyGeometry(def: EnemyDef): THREE.BufferGeometry {
  let geo = geoCache.get(def.id);
  if (geo) return geo;
  const parts: THREE.BufferGeometry[] = [];
  buildModel(def, (g, color, x, y, z) => {
    // mergeGeometries needs matching attributes and index-ness: de-index everything.
    const ng = (g.index ? g.toNonIndexed() : g).translate(x, y, z);
    parts.push(paint(ng, color));
  });
  // Re-index: corners shared by a face's two triangles become one vertex, so every
  // enemy (and its outline pass, which reuses the geometry) runs about a third fewer vertex shaders.
  geo = mergeVertices(mergeGeometries(parts)!);
  geoCache.set(def.id, geo);
  return geo;
}

// ------------------------------------------------------------------ state

let nextUid = 1;

export interface SpawnOpts {
  hpMul?: number;
  speedMul?: number;
  dmgMul?: number;
  elite?: boolean;
  /** Elite modifier (only used with `elite`). */
  eliteMod?: EliteModId;
  instant?: boolean;
  /** Size x this (Giants mutator); bosses ignore it. */
  scale?: number;
}

/** Simulation state for one enemy. Pure data; drawn by `Enemies` via instancing. */
export class Enemy {
  uid = 0;
  active = false;
  state: EnemyState = 'spawning';
  t = 0;
  x = 0;
  z = 0;
  px = 0;
  pz = 0;
  vx = 0;
  vz = 0;
  kx = 0; // knockback velocity
  kz = 0;
  hp = 0;
  maxHp = 0;
  speedMul = 1;
  dmgMul = 1;
  scale = 1;
  radius = 0;
  elite = false;
  /** Elite modifier, if any (src/data/eliteMods.ts). */
  mod: EliteModDef | null = null;
  /** Shielded elites: hit points the shield still absorbs (clients only use > 0). */
  shield = 0;
  /** Id of the last bomb wave that hit this enemy (each bomb hits once). */
  bombStamp = 0;
  flash = 0;
  frozen = 0;
  slowT = 0;
  slowAmt = 0;
  shatter = 0; // bonus damage taken while frozen
  burnT = 0;
  burnDps = 0;
  burnAcc = 0;
  /** Hero index credited for burn damage. */
  burnOwner = 0;
  shockT = 0;
  /** Exposed by a right-click hit: takes more damage from everyone. */
  exposeT = 0;
  /** PvP: index of the hero this invisible stand-in belongs to (-1 for real enemies). */
  pvpOwner = -1;
  lungeX = 0;
  lungeZ = 0;
  facing = 0;
  hitPlayer = false;
  /** Boss past its first phase: faster, bigger attacks. */
  enraged = false;
  /** Boss phase: 1 + phase thresholds crossed (EnemyDef.phases, src/game/bosses.ts). */
  phase = 1;
  timerA = 0;
  action: BossAction = 'ring';
  hopY = 0;
  fromX = 0;
  fromZ = 0;
  targetX = 0;
  targetZ = 0;
  strafe = 1;
  /** Boss attack counters: sub-attacks left, spiral angle, pattern timer. */
  burst = 0;
  spin = 0;
  timerB = 0;
  /** Boss attack queue position. */
  step = 0;
  /** Bosses: seconds left of a phase-change roar or entrance (idle and invulnerable). */
  roarT = 0;
  /** Bosses: special move in progress (BOSS_MOVES in src/game/bosses.ts, '' = none). */
  move = '';
  /** Bosses: arena twist timer. */
  twistT = 0;
  /** Ka-Boomer fuse tick countdown (sound only). */
  tickT = 0;
  /** Elite modifier timer (teleport). */
  modT = 0;
  /** Squash-and-stretch spring: displacement and velocity. */
  sq = 0;
  sqV = 0;
  /** Crowd AI: approach bend at long range (radians, see aiTuning). */
  flank = 0;
  /** Shooters and mortars: cover spot behind a box, and the search timer. */
  coverX = 0;
  coverZ = 0;
  hasCover = false;
  coverT = 0;
  /** Chargers: sidestepping because the charge line is walled. */
  reroute = 0;
  /** Elite squads: the elite this enemy escorts (valid while its uid matches) and its formation slot. */
  leader: Enemy | null = null;
  leaderUid = 0;
  slot = 0;
  /** Rallied by its elite (faster), elite's rally cooldown, fleeing after the elite died. */
  rallyT = 0;
  rallyCd = 0;
  scatterT = 0;
  /** Hiding behind a Shield Bot facing `guardAng`. */
  guardT = 0;
  guardAng = 0;
  /** Shield Bot "BLOCK" popup cooldown. */
  blockT = 0;
  /** AI state clients draw (synced in the enemy record): 1 squad member, 2 rallied, 4 guarded. */
  aiBits = 0;
  /** Cosmetic animation state (src/game/enemyAnim.ts). */
  readonly anim = new EnemyAnim();

  constructor(public def: EnemyDef) {}

  reset(x: number, z: number, o: SpawnOpts): void {
    this.uid = nextUid++;
    this.active = true;
    this.pvpOwner = -1;
    this.state = 'spawning';
    this.t = o.instant ? 0.01 : SPAWN_TIME;
    this.x = this.px = x;
    this.z = this.pz = z;
    this.vx = this.vz = this.kx = this.kz = 0;
    this.elite = !!o.elite;
    this.scale = (this.elite ? 1.6 : 1) * (this.def.boss ? 1 : (o.scale ?? 1));
    this.radius = this.def.radius * this.scale;
    this.hp = this.maxHp = Math.round(this.def.hp * (o.hpMul ?? 1) * (this.elite ? 10 : 1));
    this.speedMul = (o.speedMul ?? 1) * (this.elite ? eliteTuning.speed : 1);
    this.dmgMul = (o.dmgMul ?? 1) * (this.elite ? 1.3 : 1);
    this.mod = this.elite && o.eliteMod ? ELITE_MODS[o.eliteMod] : null;
    if (this.mod) {
      this.hp = this.maxHp = Math.round(this.maxHp * (this.mod.hpMul ?? 1));
      this.speedMul *= this.mod.speedMul ?? 1;
    }
    this.shield = Math.round(this.maxHp * (this.mod?.shield ?? 0));
    this.modT = this.mod?.teleport ?? 0;
    this.bombStamp = 0;
    this.flash = this.frozen = this.slowT = this.shatter = 0;
    this.burnT = this.burnDps = this.burnAcc = this.shockT = this.burnOwner = this.exposeT = 0;
    this.sq = this.sqV = this.hopY = 0;
    this.timerA = this.def.boss ? bossTuning.firstAttack : aggro(this, 1 + Math.random() * 2);
    this.enraged = false;
    this.phase = 1;
    this.burst = this.spin = this.timerB = this.step = 0;
    this.roarT = 0;
    this.twistT = 4;
    this.move = '';
    this.action = 'ring';
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    const t = aiTuning;
    const side = Math.random() < 0.5 ? -1 : 1;
    this.flank = Math.random() < t.wideShare ? side * (t.wideMin + Math.random() * (t.wideMax - t.wideMin)) : (Math.random() * 2 - 1) * t.flankMax;
    this.coverT = Math.random() * t.coverSearch;
    this.hasCover = false;
    this.reroute = this.rallyT = this.scatterT = this.guardT = this.blockT = this.aiBits = this.slot = this.leaderUid = 0;
    this.leader = null;
    this.rallyCd = squadTuning.rallyEvery * (0.5 + Math.random() * 0.5);
    if (this.def.treasure) this.timerA = this.def.treasure.life;
    if (this.def.leap) this.timerA = 0.5 + Math.random();
  }

  get alive(): boolean {
    return this.active && this.state !== 'spawning';
  }

  get contactDamage(): number {
    return this.def.contactDamage * this.dmgMul;
  }

  /** Kick the squash spring: positive = stretch up, negative = squash down. */
  squash(amount: number): void {
    this.sqV += amount;
  }
}

/** Side effects enemies need from the game. */
export interface EnemyCtx {
  /** Every player that can be chased. Each enemy picks the nearest living one. */
  targets: { x: number; z: number; radius: number; alive: boolean }[];
  /** Set per enemy during update: the target it is currently chasing. */
  target: { x: number; z: number; radius: number };
  targetAlive: boolean;
  hash: SpatialHash<Enemy>;
  colliders: AABB[];
  /** Grid over `colliders` (rebuilt whenever they change). */
  readonly walls: StaticBoxGrid;
  onWindup(e: Enemy): void;
  onEnrage(e: Enemy): void;
  fireBullet(e: Enemy, dirX: number, dirZ: number, speed: number, damage: number): void;
  spawnChild(defId: string, x: number, z: number, parent: Enemy): void;
  detonate(e: Enemy): void;
  slam(e: Enemy): void;
  /** Mark a ground strike: telegraphed, then hits players inside after `delay`. */
  strike(x: number, z: number, r: number, delay: number, damage: number): void;
  /** Leaper lands: shockwave of radius `r` hurting heroes inside. */
  land(e: Enemy, r: number, damage: number): void;
  /** Medic pulse: heals allies within `r` by `frac` of their max life. */
  heal(e: Enemy, r: number, frac: number): void;
  /** Elite rallies its squad. */
  rally(e: Enemy): void;
  /** Goldbug: sparkle trail, and escaping when its time is up. */
  sparkle(e: Enemy): void;
  escape(e: Enemy): void;
  /** Arena half size (fleeing enemies steer away from the edge). */
  bounds(): number;
  /** Boss moves and arena twists (src/game/bosses.ts). */
  boss?: BossApi;
}

// ------------------------------------------------------------------ rendering helpers

/** One InstancedMesh per enemy type, with a per-instance hit-flash attribute. */
class EnemyBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly flash: THREE.InstancedBufferAttribute;

  constructor(def: EnemyDef, scene: THREE.Scene) {
    const geo = enemyGeometry(def).clone();
    this.flash = new THREE.InstancedBufferAttribute(new Float32Array(BATCH_CAP * 4), 4);
    this.flash.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('instanceFlash', this.flash);
    const mat = createRetroMaterial({ vertexColors: true, instanceFlash: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, BATCH_CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }
}

/** Instanced ground decals: blob shadows, spawn rings, charge lines, blast-radius rings. */
const AURA_CAP = 128;

class GroundDecals {
  readonly shadows: THREE.InstancedMesh;
  readonly markers: THREE.InstancedMesh;
  readonly lines: THREE.InstancedMesh;
  readonly zones: THREE.InstancedMesh;
  /** Filled danger discs (boss strike zones). */
  readonly discs: THREE.InstancedMesh;
  /** Elite modifier rings (per-instance colour) and shield bubbles. */
  readonly auras: THREE.InstancedMesh;
  readonly bubbles: THREE.InstancedMesh;
  /** Medic heal-pulse telegraph rings (green). */
  readonly heals: THREE.InstancedMesh;
  private healMat: THREE.MeshBasicMaterial;
  private bubbleMat: THREE.MeshBasicMaterial;
  private discMat: THREE.MeshBasicMaterial;
  private markerMat: THREE.MeshBasicMaterial;
  private dangerMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, cap: number) {
    const blobMat = new THREE.MeshBasicMaterial({ map: textures.blob(), transparent: true, depthWrite: false });
    this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), blobMat, cap);
    this.markerMat = new THREE.MeshBasicMaterial({ color: '#ff3d5a', transparent: true, depthWrite: false });
    this.markers = new THREE.InstancedMesh(new THREE.RingGeometry(0.45, 0.75, 16).rotateX(-Math.PI / 2), this.markerMat, cap);
    this.dangerMat = new THREE.MeshBasicMaterial({ color: '#ff2d4a', transparent: true, opacity: 0.45, depthWrite: false });
    // Line decal: unit length along +Z starting at the origin.
    this.lines = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
      this.dangerMat,
      64,
    );
    this.zones = new THREE.InstancedMesh(new THREE.RingGeometry(0.86, 1, 32).rotateX(-Math.PI / 2), this.dangerMat, 64);
    this.discMat = new THREE.MeshBasicMaterial({ color: '#ff2d4a', transparent: true, opacity: 0.3, depthWrite: false });
    this.discs = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), this.discMat, 32);
    this.auras = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.78, 1, 6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
      AURA_CAP,
    );
    this.auras.setColorAt(0, new THREE.Color('#ffffff'));
    this.bubbleMat = new THREE.MeshBasicMaterial({ color: '#73eff7', transparent: true, opacity: 0.3, depthWrite: false });
    this.bubbles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.bubbleMat, AURA_CAP);
    this.healMat = new THREE.MeshBasicMaterial({ color: '#a7f070', transparent: true, opacity: 0.5, depthWrite: false });
    this.heals = new THREE.InstancedMesh(new THREE.RingGeometry(0.88, 1, 32).rotateX(-Math.PI / 2), this.healMat, 32);
    for (const m of [this.shadows, this.markers, this.lines, this.zones, this.discs, this.auras, this.bubbles, this.heals]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.renderOrder = 1;
      scene.add(m);
    }
  }

  setPulse(time: number): void {
    this.markerMat.opacity = 0.5 + 0.5 * Math.sin(time * 25);
    this.dangerMat.opacity = 0.35 + 0.25 * Math.sin(time * 30);
    this.discMat.opacity = 0.28 + 0.1 * Math.sin(time * 30);
    this.bubbleMat.opacity = 0.26 + 0.08 * Math.sin(time * 9);
    this.healMat.opacity = 0.45 + 0.3 * Math.sin(time * 22);
  }
}

// ------------------------------------------------------------------ manager

/** Pool, behaviour and rendering for all enemies. */
export class Enemies {
  readonly list: Enemy[] = [];
  private free: Enemy[] = [];
  private batches = new Map<string, EnemyBatch>();
  private decals: GroundDecals;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private col = new THREE.Color();
  private alive = 0;
  private counts = new Map<string, number>();
  /** Danger zones to draw this frame (owned by the game's effects bus). */
  zones: { x: number; z: number; r: number; t: number; life: number }[] = [];
  /** Flung corpses (cosmetic, src/game/enemyAnim.ts). */
  readonly corpses = new Corpses();
  private pose: EnemyPose = { y: 0, ox: 0, oz: 0, sx: 1, sy: 1, sz: 1, pitch: 0, roll: 0, yaw: 0 };
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private lastTime = -1;
  private putCorpse = (def: EnemyDef, m: THREE.Matrix4, r: number, g: number, b: number, a: number): void => {
    const bt = this.batch(def);
    if (bt.mesh.count >= BATCH_CAP) return;
    const i = bt.mesh.count++;
    bt.mesh.setMatrixAt(i, m);
    bt.flash.setXYZW(i, r, g, b, a);
  };
  private putShadow = (x: number, z: number, size: number): void => {
    const d = this.decals;
    if (d.shadows.count >= 2048) return;
    this.m4.makeScale(size, 1, size).setPosition(x, 0.02, z);
    d.shadows.setMatrixAt(d.shadows.count++, this.m4);
  };

  constructor(private scene: THREE.Scene) {
    this.decals = new GroundDecals(scene, 2048);
  }

  private batch(def: EnemyDef): EnemyBatch {
    let b = this.batches.get(def.id);
    if (!b) this.batches.set(def.id, (b = new EnemyBatch(def, this.scene)));
    return b;
  }

  /** Cosmetic death: the body is flung along (dirX, dirZ), tumbling (bosses shake apart in place). */
  fling(def: EnemyDef, x: number, y: number, z: number, scale: number, facing: number, dirX: number, dirZ: number): void {
    this.corpses.add(def, x, y, z, scale, facing, dirX, dirZ);
  }

  spawn(def: EnemyDef, x: number, z: number, o: SpawnOpts = {}): Enemy {
    let e = this.free.pop();
    if (e) e.def = def;
    else {
      e = new Enemy(def);
      this.list.push(e);
    }
    this.batch(def);
    e.reset(x, z, o);
    this.alive++;
    this.counts.set(def.id, (this.counts.get(def.id) ?? 0) + 1);
    return e;
  }

  get activeCount(): number {
    return this.alive;
  }

  /** Active enemies of a given type (as of the last update or spawn). */
  countOf(id: string): number {
    return this.counts.get(id) ?? 0;
  }

  kill(e: Enemy): void {
    if (!e.active) return;
    e.active = false;
    this.free.push(e);
    this.alive--;
    this.counts.set(e.def.id, (this.counts.get(e.def.id) ?? 1) - 1);
  }

  clear(): void {
    for (const e of this.list) if (e.active) this.kill(e);
    this.corpses.clear();
  }

  update(dt: number, ctx: EnemyCtx): void {
    const away = { x: 1e6, z: 1e6, radius: 0 };
    for (const e of this.list) {
      if (!e.active) continue;
      e.px = e.x;
      e.pz = e.z;
      e.flash = Math.max(0, e.flash - dt);
      e.sqV += (-220 * e.sq - 14 * e.sqV) * dt;
      e.sq += e.sqV * dt;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.def.behavior === 'reaper') e.frozen = e.slowT = 0; // nothing slows the Reaper
      if (e.guardT > 0) e.guardT -= dt;
      if (e.blockT > 0) e.blockT -= dt;
      if (e.rallyT > 0) e.rallyT -= dt;
      if (e.scatterT > 0) e.scatterT -= dt;
      // Escorts whose elite is gone scatter.
      if (e.leader && (!e.leader.active || e.leader.uid !== e.leaderUid)) {
        e.leader = null;
        e.scatterT = Math.max(e.scatterT, squadTuning.scatter);
      }
      e.aiBits = (e.leader ? 1 : 0) | (e.rallyT > 0 ? 2 : 0) | (e.guardT > 0 ? 4 : 0);

      if (e.state === 'spawning') {
        e.t -= dt;
        if (e.t <= 0) {
          e.state = 'move';
          e.squash(5);
        }
        continue;
      }
      // Frozen solid: no thinking, no moving (knockback still slides a little).
      if (e.frozen > 0) {
        e.frozen -= dt;
        const kd = Math.exp(-6 * dt);
        e.kx *= kd;
        e.kz *= kd;
        e.x += e.kx * dt * 0.3;
        e.z += e.kz * dt * 0.3;
        continue;
      }

      // Chase the nearest living player.
      let best: EnemyCtx['target'] | null = null;
      let bd = Infinity;
      for (const t of ctx.targets) {
        if (!t.alive) continue;
        const d = (t.x - e.x) ** 2 + (t.z - e.z) ** 2;
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      ctx.target = best ?? away;
      ctx.targetAlive = !!best;
      const tgt = ctx.target;
      const dx = tgt.x - e.x;
      const dz = tgt.z - e.z;
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      const nx = dx / dist;
      const nz = dz / dist;
      const speed = e.def.speed * e.speedMul * (e.slowT > 0 ? 1 - e.slowAmt : 1) * (e.rallyT > 0 ? squadTuning.rallySpeed : 1);
      let wantX = 0;
      let wantZ = 0;
      let rigid = false; // attack movement ignores steering smoothing
      e.t -= dt;

      // Elites rally their squad now and then.
      if (e.elite && (e.rallyCd -= dt) <= 0) {
        e.rallyCd = squadTuning.rallyEvery;
        ctx.rally(e);
      }

      if (e.scatterT > 0 && e.state === 'move' && !e.def.boss) {
        // Their elite is down: run for it.
        wantX = -nx * speed * 1.1;
        wantZ = -nz * speed * 1.1;
        e.facing = Math.atan2(-dx, -dz);
      } else if (!this.behave(e, dt, ctx, dx, dz, nx, nz, dist, speed)) continue;
      else {
        wantX = this.wantX;
        wantZ = this.wantZ;
        rigid = this.rigid;
      }

      // Escorts hold formation behind their elite until a hero is close.
      const L = e.leader;
      if (L && e.state === 'move' && e.scatterT <= 0 && dist > squadTuning.engage) {
        const row = (e.slot >> 1) + 1;
        const lx = (e.slot & 1 ? 1 : -1) * row * squadTuning.spacing * 0.8;
        const lz = -row * squadTuning.spacing;
        const fs = Math.sin(L.facing);
        const fc = Math.cos(L.facing);
        const ox = L.x + fc * lx + fs * lz - e.x;
        const oz = L.z - fs * lx + fc * lz - e.z;
        const od = Math.hypot(ox, oz);
        if (od > 0.3) {
          const v = Math.min(speed * squadTuning.catchUp, od * 4);
          wantX = (ox / od) * v;
          wantZ = (oz / od) * v;
        } else {
          wantX = L.vx;
          wantZ = L.vz;
        }
        e.facing = L.facing;
      }

      // Separation from neighbours so crowds spread out instead of stacking.
      let sx = 0;
      let sz = 0;
      let hx = 0;
      let hz = 0;
      let jam = 0;
      if (!e.def.boss && e.def.behavior !== 'reaper') {
        const r = e.radius;
        // queryInto + a plain loop: a closure here allocated a context (and boxed sx/sz) per enemy per step.
        const near = this.near;
        const n = ctx.hash.queryInto(e.x, e.z, r * 2, near);
        for (let i = 0; i < n; i++) {
          const o = near[i];
          if (o === e || !o.alive) continue;
          const ox = e.x - o.x;
          const oz = e.z - o.z;
          const d2 = ox * ox + oz * oz;
          const min = r + o.radius;
          if (d2 > 0.0001 && d2 < min * min) {
            const d = Math.sqrt(d2);
            const push = ((min - d) / min) * (o.def.boss ? 3 : 1);
            sx += (ox / d) * push;
            sz += (oz / d) * push;
            jam += push;
            // Readability: deep overlaps are corrected outright (src/game/crowd.ts).
            const hard = min * crowdTuning.hardGap;
            if (d < hard) {
              const f = ((hard - d) / d) * crowdTuning.hardFix;
              hx += ox * f;
              hz += oz * f;
            }
          }
        }
        const steer = rigid ? 1 : 1 - Math.exp(-10 * dt);
        if (!rigid && jam > 0) {
          // Jammed in a crowd: push on less, so the swarm doesn't pack into one blob.
          const k = 1 / (1 + jam * crowdTuning.jam);
          wantX *= k;
          wantZ *= k;
        }
        e.vx += (wantX - e.vx) * steer;
        e.vz += (wantZ - e.vz) * steer;
      }

      const kd = Math.exp(-9 * dt);
      e.kx *= kd;
      e.kz *= kd;
      e.x += (e.vx + e.kx + sx * crowdTuning.push) * dt + hx;
      e.z += (e.vz + e.kz + sz * crowdTuning.push) * dt + hz;
      if (!rigid && e.hopY <= 0 && !e.def.boss && !e.def.hidden && e.def.behavior !== 'reaper') keepOffHeroes(e, ctx.targets);
      if (e.def.behavior === 'reaper') {
        e.x = Math.max(-58, Math.min(58, e.x));
        e.z = Math.max(-58, Math.min(58, e.z));
      }
      // Rex smashes straight through cover while it charges.
      const walled = e.def.behavior !== 'queen' && e.def.behavior !== 'reaper' && !(rigid && e.def.behavior === 'rex') && e.hopY <= 0 && ctx.walls.resolveCircle(e, e.radius);
      if (walled && e.reroute > 0 && e.state === 'move') e.strafe *= -1;
      if (walled && rigid && e.def.behavior === 'charger') {
        // Rhinos stop (and wobble) when they hit a wall mid-charge.
        this.enter(e, 'recover', aggro(e, e.def.charge!.recover), -7);
      }
    }
  }

  /** Behaviour outputs of behave(). */
  private wantX = 0;
  private wantZ = 0;
  private rigid = false;

  /**
   * One enemy's behaviour for this step (split out of update() so both stay
   * small enough for the optimizing compiler). Writes the wanted velocity to
   * wantX/wantZ and whether it is an attack move to rigid; returns false if
   * the enemy is gone (detonated, escaped).
   */
  private behave(e: Enemy, dt: number, ctx: EnemyCtx, dx: number, dz: number, nx: number, nz: number, dist: number, speed: number): boolean {
    const tgt = ctx.target;
    let wantX = 0;
    let wantZ = 0;
    let rigid = false;
    switch (e.def.behavior) {
      case 'chase':
        this.bend(e, nx, nz, dist);
        wantX = this.ax * speed;
        wantZ = this.az * speed;
        e.facing = Math.atan2(this.ax, this.az);
        break;

      case 'lunge': {
        const L = e.def.lunge!;
        if (e.state === 'move') {
          this.bend(e, nx, nz, dist);
          wantX = this.ax * speed;
          wantZ = this.az * speed;
          e.facing = Math.atan2(this.ax, this.az);
          if (dist < L.range * e.scale && ctx.targetAlive) this.enter(e, 'windup', aggro(e, L.windup, true), -5, ctx);
        } else if (e.state === 'windup') {
          if (e.t > aggro(e, L.windup, true) * (e.elite ? eliteTuning.track : 0.5)) this.lockOn(e, nx, nz, dx, dz);
          e.sq = Math.min(e.sq, -0.25);
          if (e.t <= 0) this.enter(e, 'attack', L.duration, 9);
        } else if (e.state === 'attack') {
          wantX = e.lungeX * L.speed;
          wantZ = e.lungeZ * L.speed;
          rigid = true;
          if (e.t <= 0) this.enter(e, 'recover', aggro(e, L.recover), -4);
        } else if (e.t <= 0) e.state = 'move';
        break;
      }

      case 'shooter': {
        const S = e.def.shoot!;
        e.facing = Math.atan2(dx, dz);
        if (e.state === 'move') {
          // Hold a ring around the player, strafing sideways, or wait behind cover between shots.
          this.coverMove(e, dt, ctx, nx, nz, dist, speed, S.keepDistance);
          wantX = this.ax;
          wantZ = this.az;
          e.timerA -= dt;
          const reach = S.pattern === 'sniper' ? 20 : 15;
          if (e.timerA <= 0 && dist < reach && ctx.targetAlive) {
            if (S.pattern === 'sniper') {
              // Long aim: the line tracks you, then locks just before the shot.
              this.lockOn(e, nx, nz, dx, dz);
              this.enter(e, 'windup', aggro(e, 1.1, true), -3, ctx);
            } else this.enter(e, 'windup', aggro(e, 0.45, true), -4, ctx);
          }
        } else if (e.state === 'windup') {
          if (S.pattern === 'sniper' && e.t > 0.25) this.lockOn(e, nx, nz, dx, dz);
          if (e.t <= 0) {
            const base = Math.atan2(nz, nx);
            const bulletSpeed = S.speed * (e.elite ? eliteTuning.bulletSpeed : 1);
            if (S.pattern === 'sniper') {
              ctx.fireBullet(e, e.lungeX, e.lungeZ, bulletSpeed, S.damage);
              this.endVolley(e, S);
            } else if (S.pattern === 'spiral' || S.pattern === 'burst') {
              // Spirals stream bullets for a while; bursts fire three quick fans.
              e.burst = S.pattern === 'spiral' ? S.bullets : 3;
              e.spin = base;
              e.timerB = 0;
              this.enter(e, 'attack', 2, 4);
            } else {
              const n = S.bullets + (e.elite ? eliteTuning.extraBullets : 0);
              const spread = THREE.MathUtils.degToRad(S.spreadDeg) * ((n - 1) / Math.max(1, S.bullets - 1));
              for (let i = 0; i < n; i++) {
                const a = base + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
                ctx.fireBullet(e, Math.cos(a), Math.sin(a), bulletSpeed, S.damage);
              }
              this.endVolley(e, S);
            }
          }
        } else if (e.state === 'attack') {
          wantX = wantZ = 0;
          e.timerB -= dt;
          if (e.timerB <= 0 && e.burst > 0) {
            e.burst--;
            const bulletSpeed = S.speed * (e.elite ? eliteTuning.bulletSpeed : 1);
            if (S.pattern === 'spiral') {
              e.timerB = 0.075;
              e.spin += 0.55;
              for (const k of [0, Math.PI]) ctx.fireBullet(e, Math.cos(e.spin + k), Math.sin(e.spin + k), bulletSpeed, S.damage);
            } else {
              e.timerB = 0.22;
              const base = Math.atan2(nz, nx);
              const n = S.bullets + (e.elite ? eliteTuning.extraBullets : 0);
              const spread = THREE.MathUtils.degToRad(S.spreadDeg) * ((n - 1) / Math.max(1, S.bullets - 1));
              for (let i = 0; i < n; i++) {
                const a = base + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
                ctx.fireBullet(e, Math.cos(a), Math.sin(a), bulletSpeed, S.damage);
              }
            }
            e.squash(3);
          }
          if (e.burst <= 0 || e.t <= 0) this.endVolley(e, S);
        }
        break;
      }

      case 'charger': {
        const C = e.def.charge!;
        if (e.state === 'move' && e.reroute > 0) {
          // The charge line was walled: sidestep to find a clear one.
          e.reroute -= dt;
          wantX = (-nz * e.strafe + nx * 0.3) * speed;
          wantZ = (nx * e.strafe + nz * 0.3) * speed;
          e.facing = Math.atan2(dx, dz);
        } else if (e.state === 'move') {
          wantX = nx * speed;
          wantZ = nz * speed;
          e.facing = Math.atan2(dx, dz);
          if (dist < C.range && ctx.targetAlive) {
            if (this.walled(e.x, e.z, nx, nz, Math.min(dist - 0.5, C.speed * C.duration), e.radius * 0.8, ctx.colliders)) {
              // Keep sidestepping the same way (it turns round if it bumps into something).
              e.reroute = aiTuning.rerouteTime;
            } else {
              this.lockOn(e, nx, nz, dx, dz);
              this.enter(e, 'windup', aggro(e, C.windup, true), -5, ctx);
            }
          }
        } else if (e.state === 'windup') {
          // Elites keep re-aiming the charge line for most of the wind-up.
          if (e.elite && e.t > aggro(e, C.windup, true) * eliteTuning.track) this.lockOn(e, nx, nz, dx, dz);
          e.sq = Math.min(e.sq, -0.2);
          if (e.t <= 0) this.enter(e, 'attack', C.duration, 8);
        } else if (e.state === 'attack') {
          wantX = e.lungeX * C.speed;
          wantZ = e.lungeZ * C.speed;
          rigid = true;
          if (e.t <= 0) this.enter(e, 'recover', aggro(e, C.recover), -5);
        } else if (e.t <= 0) e.state = 'move';
        break;
      }

      case 'exploder': {
        const F = e.def.fuse!;
        if (e.state === 'move') {
          wantX = nx * speed;
          wantZ = nz * speed;
          e.facing = Math.atan2(dx, dz);
          if (dist < F.range && ctx.targetAlive) this.enter(e, 'windup', aggro(e, F.time, true), -3, ctx);
        } else if (e.state === 'windup') {
          // Keeps creeping toward you while the fuse burns.
          wantX = nx * speed * 0.25;
          wantZ = nz * speed * 0.25;
          if (e.t <= 0) {
            ctx.detonate(e);
            return false;
          }
        }
        break;
      }

      case 'spawner': {
        const P = e.def.spawn!;
        if (e.state === 'move') {
          e.timerA -= dt;
          if (e.timerA <= 0) this.enter(e, 'windup', aggro(e, 0.7, true), -4, ctx);
        } else if (e.state === 'windup' && e.t <= 0) {
          for (let i = 0; i < P.count; i++) {
            const a = (i / P.count) * Math.PI * 2;
            ctx.spawnChild(P.into, e.x + Math.cos(a) * 1.6, e.z + Math.sin(a) * 1.6, e);
          }
          e.squash(8);
          e.timerA = aggro(e, P.interval);
          e.state = 'move';
        }
        break;
      }

      case 'shielder': {
        const G = e.def.guard!;
        const L = e.def.lunge!;
        // Turns slowly toward its target, so getting round the side beats the shield.
        let da = Math.atan2(dx, dz) - e.facing;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const turn = G.turn * (e.elite ? 1.3 : 1) * dt * (e.state === 'move' ? 1 : 0.3);
        e.facing += Math.max(-turn, Math.min(turn, da));
        if (e.state === 'move') {
          wantX = nx * speed;
          wantZ = nz * speed;
          if (dist < L.range * e.scale && ctx.targetAlive && Math.abs(da) < 0.6) {
            e.lungeX = Math.sin(e.facing);
            e.lungeZ = Math.cos(e.facing);
            this.enter(e, 'windup', aggro(e, L.windup, true), -5, ctx);
          }
        } else if (e.state === 'windup') {
          e.sq = Math.min(e.sq, -0.2);
          if (e.t <= 0) this.enter(e, 'attack', L.duration, 8);
        } else if (e.state === 'attack') {
          // Shield bash.
          wantX = e.lungeX * L.speed;
          wantZ = e.lungeZ * L.speed;
          rigid = true;
          if (e.t <= 0) this.enter(e, 'recover', aggro(e, L.recover), -4);
        } else if (e.t <= 0) e.state = 'move';
        if ((e.timerB -= dt) <= 0) {
          e.timerB = 0.25;
          this.guardAllies(e, G.range * e.scale, ctx);
        }
        break;
      }

      case 'leaper': {
        const P = e.def.leap!;
        if (e.state === 'move') {
          this.bend(e, nx, nz, dist);
          wantX = this.ax * speed;
          wantZ = this.az * speed;
          e.facing = Math.atan2(this.ax, this.az);
          e.timerA -= dt;
          if (e.timerA <= 0 && dist < P.range && ctx.targetAlive) {
            e.targetX = tgt.x;
            e.targetZ = tgt.z;
            this.enter(e, 'windup', aggro(e, P.windup, true), -6, ctx);
          }
        } else if (e.state === 'windup') {
          e.sq = Math.min(e.sq, -0.3);
          // The landing ring follows you for the first half, then commits.
          if (e.t > aggro(e, P.windup, true) * 0.5) {
            e.targetX = tgt.x;
            e.targetZ = tgt.z;
          }
          e.facing = Math.atan2(e.targetX - e.x, e.targetZ - e.z);
          if (e.t <= 0) {
            const jx = e.targetX - e.x;
            const jz = e.targetZ - e.z;
            const jd = Math.hypot(jx, jz);
            const max = P.range * 1.2;
            if (jd > max) {
              e.targetX = e.x + (jx / jd) * max;
              e.targetZ = e.z + (jz / jd) * max;
            }
            e.fromX = e.x;
            e.fromZ = e.z;
            this.enter(e, 'attack', P.air, 10);
          }
        } else if (e.state === 'attack') {
          // Airborne: walls don't stop it (the wall check skips hopping enemies).
          const k = 1 - Math.max(0, e.t) / P.air;
          e.x = e.fromX + (e.targetX - e.fromX) * k;
          e.z = e.fromZ + (e.targetZ - e.fromZ) * k;
          e.hopY = Math.sin(k * Math.PI) * P.height * e.scale;
          rigid = true;
          if (e.t <= 0) {
            e.hopY = 0;
            ctx.land(e, P.radius * e.scale, P.damage);
            e.timerA = aggro(e, P.cooldown * (0.8 + Math.random() * 0.4));
            this.enter(e, 'recover', aggro(e, P.recover), -10);
          }
        } else if (e.t <= 0) e.state = 'move';
        break;
      }

      case 'medic': {
        const H = e.def.heal!;
        e.facing = Math.atan2(dx, dz);
        if (e.state === 'move') {
          // Hangs back behind the crowd.
          const radial = dist > H.keepDistance + 1 ? 1 : dist < H.keepDistance - 2 ? -1.2 : 0;
          wantX = (nx * radial - nz * e.strafe * 0.5) * speed;
          wantZ = (nz * radial + nx * e.strafe * 0.5) * speed;
          if ((e.timerA -= dt) <= 0) this.enter(e, 'windup', aggro(e, H.windup, true), -4, ctx);
        } else if (e.state === 'windup' && e.t <= 0) {
          ctx.heal(e, H.radius * e.scale, H.frac);
          e.squash(8);
          e.timerA = aggro(e, H.interval);
          e.state = 'move';
        }
        break;
      }

      case 'mortar': {
        const M = e.def.mortar!;
        e.facing = Math.atan2(dx, dz);
        if (e.state === 'move') {
          this.coverMove(e, dt, ctx, nx, nz, dist, speed, M.keepDistance);
          wantX = this.ax;
          wantZ = this.az;
          e.timerA -= dt;
          if (e.timerA <= 0 && dist < 18 && ctx.targetAlive) this.enter(e, 'windup', aggro(e, 0.7, true), -6, ctx);
        } else if (e.state === 'windup' && e.t <= 0) {
          const n = M.shells + (e.elite ? 2 : 0);
          const dmg = M.damage * (e.elite ? 1.3 : 1);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = i === 0 ? 0 : 1.6 + Math.random() * 2.2;
            ctx.strike(tgt.x + Math.cos(a) * r, tgt.z + Math.sin(a) * r, M.radius, M.delay + i * 0.15, dmg);
          }
          e.squash(10);
          e.timerA = aggro(e, M.interval * (0.85 + Math.random() * 0.3));
          e.state = 'move';
        }
        break;
      }

      case 'golden': {
        // Runs away, zig-zagging, and escapes when its time is up.
        e.timerA -= dt;
        e.t = e.timerA; // synced so clients can blink it before it escapes
        if (e.timerA <= 0) {
          ctx.escape(e);
          return false;
        }
        const wob = Math.sin(e.timerA * 3.1 + e.uid) * 0.7;
        const c = Math.cos(wob);
        const sn = Math.sin(wob);
        let fx = -nx * c + nz * sn;
        let fz = -nz * c - nx * sn;
        const lim = ctx.bounds() - goldenTuning.edge;
        if (Math.abs(e.x) > lim) fx -= Math.sign(e.x) * ((Math.abs(e.x) - lim) / goldenTuning.edge) * 2;
        if (Math.abs(e.z) > lim) fz -= Math.sign(e.z) * ((Math.abs(e.z) - lim) / goldenTuning.edge) * 2;
        const fd = Math.hypot(fx, fz) || 1;
        const v = speed * (dist < goldenTuning.panic ? goldenTuning.panicSpeed : 1);
        wantX = (fx / fd) * v;
        wantZ = (fz / fd) * v;
        e.facing = Math.atan2(wantX, wantZ);
        if ((e.timerB -= dt) <= 0) {
          e.timerB = 0.2;
          ctx.sparkle(e);
        }
        break;
      }

      case 'boss':
      case 'rex':
      case 'queen':
      case 'omega':
        rigid = updateBoss(e, dt, ctx, nx, nz, dist, speed);
        wantX = e.vx;
        wantZ = e.vz;
        break;
      case 'reaper':
        // Straight at you, ignoring the speed scaling: just faster than a hero's base speed.
        wantX = e.vx = nx * e.def.speed;
        wantZ = e.vz = nz * e.def.speed;
        e.facing = Math.atan2(dx, dz);
        break;
    }
    this.wantX = wantX;
    this.wantZ = wantZ;
    this.rigid = rigid;
    return true;
  }

  /** Scratch list for neighbour queries (SpatialHash.queryInto). */
  private near: Enemy[] = [];

  /** Scratch output of bend() / coverMove(). */
  private ax = 0;
  private az = 0;

  /** Chasers approach at their own angle so the crowd surrounds you instead of queueing. */
  private bend(e: Enemy, nx: number, nz: number, dist: number): void {
    const b = flankBend(e.flank, dist);
    const c = Math.cos(b);
    const s = Math.sin(b);
    this.ax = nx * c - nz * s;
    this.az = nx * s + nz * c;
  }

  /** Shooter movement: wait behind nearby cover between shots, otherwise strafe a ring around the target. */
  private coverMove(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number, keep: number): void {
    if ((e.coverT -= dt) <= 0) {
      e.coverT = aiTuning.coverSearch * (0.8 + Math.random() * 0.4);
      this.findCover(e, ctx, keep);
    }
    if (e.hasCover && e.timerA > aiTuning.coverPeek && dist > 5) {
      const ox = e.coverX - e.x;
      const oz = e.coverZ - e.z;
      const od = Math.hypot(ox, oz);
      const v = od > 0.3 ? (speed * Math.min(1, od)) / od : 0;
      this.ax = ox * v;
      this.az = oz * v;
      return;
    }
    const radial = dist > keep + 1 ? 1 : dist < keep - 1.5 ? -1 : 0;
    this.ax = (nx * radial - nz * e.strafe * 0.6) * speed;
    this.az = (nz * radial + nx * e.strafe * 0.6) * speed;
  }

  /** Nearest spot behind a small box (as seen from the target) at about the shooter's range. */
  private findCover(e: Enemy, ctx: EnemyCtx, keep: number): void {
    e.hasCover = false;
    if (!ctx.targetAlive) return;
    const tgt = ctx.target;
    const R2 = aiTuning.coverRange * aiTuning.coverRange;
    let best = R2;
    for (const b of ctx.colliders) {
      const hw = (b.maxX - b.minX) / 2;
      const hd = (b.maxZ - b.minZ) / 2;
      if (hw > 3.5 || hd > 3.5) continue;
      const cx = b.minX + hw;
      const cz = b.minZ + hd;
      if ((cx - e.x) ** 2 + (cz - e.z) ** 2 > R2) continue;
      const vx = cx - tgt.x;
      const vz = cz - tgt.z;
      const vd = Math.hypot(vx, vz) || 1;
      if (vd < keep - 4 || vd > keep + 6) continue;
      const off = Math.max(hw, hd) + e.radius + 0.5;
      const px = cx + (vx / vd) * off;
      const pz = cz + (vz / vd) * off;
      const d = (px - e.x) ** 2 + (pz - e.z) ** 2;
      if (d < best) {
        best = d;
        e.coverX = px;
        e.coverZ = pz;
        e.hasCover = true;
      }
    }
  }

  /** Is a charge from (x, z) along (dx, dz) for `len` metres blocked by a wall? */
  private walled(x: number, z: number, dx: number, dz: number, len: number, pad: number, boxes: AABB[]): boolean {
    for (const b of boxes) if (segmentHitsBox(x, z, dx, dz, len, pad, b)) return true;
    return false;
  }

  /** Shield Bot: allies just behind it are covered by its shield for a moment. */
  private guardSrc: Enemy | null = null;
  private guardR = 0;
  private markGuard = (o: Enemy): void => {
    const s = this.guardSrc!;
    if (o === s || !o.alive || o.def.guard || o.def.boss) return;
    const rx = o.x - s.x;
    const rz = o.z - s.z;
    if (rx * Math.sin(s.facing) + rz * Math.cos(s.facing) > -0.2 || rx * rx + rz * rz > this.guardR * this.guardR) return;
    o.guardT = 0.4;
    o.guardAng = s.facing;
  };
  private guardAllies(e: Enemy, r: number, ctx: EnemyCtx): void {
    this.guardSrc = e;
    this.guardR = r;
    ctx.hash.query(e.x, e.z, r, this.markGuard);
    this.guardSrc = null;
  }

  private enter(e: Enemy, s: EnemyState, t: number, squash: number, ctx?: EnemyCtx): void {
    e.state = s;
    e.t = t;
    e.squash(squash);
    if (s === 'attack') e.hitPlayer = false;
    if (s === 'windup' && ctx) ctx.onWindup(e);
  }

  private endVolley(e: Enemy, S: NonNullable<EnemyDef['shoot']>): void {
    e.squash(6);
    e.timerA = aggro(e, S.interval * (0.8 + Math.random() * 0.4));
    e.state = 'move';
  }

  private lockOn(e: Enemy, nx: number, nz: number, dx: number, dz: number): void {
    e.lungeX = nx;
    e.lungeZ = nz;
    e.facing = Math.atan2(dx, dz);
  }

  // ---------------------------------------------------------------- render

  /** Write every active enemy into its type's instanced mesh, plus ground decals. */
  render(alpha: number, time: number): void {
    for (const b of this.batches.values()) b.mesh.count = 0;
    const d = this.decals;
    d.shadows.count = d.markers.count = d.lines.count = d.zones.count = d.discs.count = d.auras.count = d.bubbles.count = d.heals.count = 0;
    d.setPulse(time);
    const fdt = this.lastTime < 0 ? 0 : Math.max(0, Math.min(0.05, time - this.lastTime));
    this.lastTime = time;
    const P = this.pose;

    for (const e of this.list) {
      if (!e.active || e.def.hidden) continue;
      const x = e.px + (e.x - e.px) * alpha;
      const z = e.pz + (e.z - e.pz) * alpha;
      let sx = (1 - e.sq * 0.5) * e.scale;
      let sy = (1 + e.sq) * e.scale;
      let y = e.hopY;

      if (e.state === 'spawning') {
        const k = 1 - e.t / SPAWN_TIME;
        const ring = (1.6 - k * 0.6) * e.radius * 1.6;
        this.m4.makeScale(ring, 1, ring).setPosition(x, 0.03, z);
        d.markers.setMatrixAt(d.markers.count++, this.m4);
        const pop = Math.max(0, (k - 0.4) / 0.6);
        if (pop <= 0) continue;
        sx *= pop;
        sy *= pop * 1.3;
      }
      // Body language: gait, lean, wind-up pose, hit wobble (cosmetic, src/game/enemyAnim.ts).
      poseEnemy(e, e.anim, x, z, fdt, time, P);
      y += P.y;

      // Telegraphs drawn on the ground.
      if (e.state === 'windup' && e.frozen <= 0) {
        if (e.def.shoot?.pattern === 'sniper') {
          // Sniper aim line: thin, long and blinking faster as the shot nears.
          this.q.setFromAxisAngle(this.up, Math.atan2(e.lungeX, e.lungeZ));
          const w = e.t < 0.3 ? 0.3 : 0.12;
          this.m4.compose(this.v.set(x, 0.05, z), this.q, this.s.set(w, 1, 20));
          d.lines.setMatrixAt(d.lines.count++, this.m4);
        } else if (e.def.behavior === 'charger' || ((e.def.behavior === 'rex' || e.def.behavior === 'omega') && e.action === 'charge')) {
          const C = e.def.charge ?? { speed: 24, duration: 0.5 };
          const len = C.speed * C.duration + 1;
          this.q.setFromAxisAngle(this.up, Math.atan2(e.lungeX, e.lungeZ));
          this.m4.compose(this.v.set(x, 0.04, z), this.q, this.s.set(e.radius * 1.6, 1, len));
          d.lines.setMatrixAt(d.lines.count++, this.m4);
        } else if (e.def.behavior === 'exploder') {
          const F = e.def.fuse!;
          const k = 1 - e.t / aggro(e, F.time, true);
          sx *= 1 + k * 0.35;
          sy *= 1 + k * 0.35;
          this.m4.makeScale(F.radius, 1, F.radius).setPosition(x, 0.05, z);
          d.zones.setMatrixAt(d.zones.count++, this.m4);
        }
      }
      // Leaper landing ring (filled while it's in the air) and the medic's heal pulse.
      if (e.def.leap && (e.state === 'windup' || e.state === 'attack') && d.discs.count < 32 && d.zones.count < 62) {
        const lr = e.def.leap.radius * e.scale;
        this.m4.makeScale(lr, 1, lr).setPosition(e.targetX, 0.05, e.targetZ);
        d.zones.setMatrixAt(d.zones.count++, this.m4);
        if (e.state === 'attack') {
          this.m4.setPosition(e.targetX, 0.045, e.targetZ);
          d.discs.setMatrixAt(d.discs.count++, this.m4);
        }
      }
      if (e.def.heal && e.state === 'windup' && d.heals.count < 32) {
        const hr = e.def.heal.radius * e.scale * (0.7 + 0.3 * Math.min(1, Math.max(0, 1 - e.t / e.def.heal.windup)));
        this.m4.makeScale(hr, 1, hr).setPosition(x, 0.05, z);
        d.heals.setMatrixAt(d.heals.count++, this.m4);
      }
      if ((e.def.behavior === 'boss' || e.def.behavior === 'omega') && e.action === 'slam' && (e.state === 'windup' || e.state === 'attack')) {
        this.m4.makeScale(3.8, 1, 3.8).setPosition(e.targetX, 0.05, e.targetZ);
        d.zones.setMatrixAt(d.zones.count++, this.m4);
      }

      // Off screen: no body, shadow or aura (telegraphs above still draw; they can be long).
      if (!viewCull.sphere(x, y + e.radius, z, e.radius * 2)) continue;
      const b = this.batches.get(e.def.id)!;
      if (b.mesh.count >= BATCH_CAP) continue;
      const i = b.mesh.count++;
      this.q.setFromEuler(this.euler.set(P.pitch, e.facing + P.yaw, P.roll));
      this.m4.compose(this.v.set(x + P.ox, y, z + P.oz), this.q, this.s.set(sx * P.sx, sy * P.sy, sx * P.sz));
      b.mesh.setMatrixAt(i, this.m4);

      // Flash priority: hit > frozen > telegraph > elite glow.
      if (e.flash > 0) b.flash.setXYZW(i, 1, 1, 1, 0.9);
      else if (e.frozen > 0) b.flash.setXYZW(i, 0.6, 0.95, 1, 0.6);
      else if (e.state === 'windup') {
        const fast = e.def.behavior === 'exploder' ? 70 : 40;
        b.flash.setXYZW(i, 1, 0.25, 0.3, 0.35 + 0.35 * Math.sin(time * fast));
      } else if (e.burnT > 0 && e.shockT > 0) b.flash.setXYZW(i, 1, 0.9, 0.3, 0.5);
      else if (e.burnT > 0) b.flash.setXYZW(i, 1, 0.45, 0.1, 0.3 + 0.2 * Math.sin(time * 18 + e.uid));
      else if (e.shockT > 0) b.flash.setXYZW(i, 1, 1, 0.4, Math.sin(time * 50 + e.uid) > 0.3 ? 0.55 : 0.1);
      else if (e.def.treasure) {
        // Goldbug shimmer; blinks in its last two seconds before escaping.
        const blink = e.t < 2 && Math.sin(time * 30) > 0;
        b.flash.setXYZW(i, 1, 0.95, 0.55, blink ? 0.75 : 0.2 + 0.2 * Math.sin(time * 10 + e.uid));
      } else if (e.def.boss && e.enraged) b.flash.setXYZW(i, 1, 0.15, 0.2, (e.phase >= 3 ? 0.35 : 0.2) + 0.15 * Math.sin(time * (e.phase >= 3 ? 14 : 8)));
      else if (e.exposeT > 0) b.flash.setXYZW(i, 0.8, 0.6, 1, 0.3 + 0.15 * Math.sin(time * 12 + e.uid));
      else if (e.mod) b.flash.setXYZW(i, e.mod.glow[0], e.mod.glow[1], e.mod.glow[2], 0.3 + 0.15 * Math.sin(time * 6));
      else if (e.elite) b.flash.setXYZW(i, 1, 0.85, 0.2, 0.25 + 0.15 * Math.sin(time * 6));
      else if (e.aiBits & 2) b.flash.setXYZW(i, 1, 0.8, 0.3, 0.25 + 0.15 * Math.sin(time * 14 + e.uid));
      else if (e.aiBits & 4) b.flash.setXYZW(i, 0.45, 0.85, 1, 0.22);
      else b.flash.setXYZW(i, 0, 0, 0, 0);

      // Elite squad escorts: a small gold ring underfoot while their elite lives.
      if (e.aiBits & 1 && e.state !== 'spawning' && d.auras.count < AURA_CAP) {
        const ar = e.radius * 1.35;
        this.q.setFromAxisAngle(this.up, -time * 2);
        this.m4.compose(this.v.set(x, 0.034, z), this.q, this.s.set(ar, 1, ar));
        d.auras.setMatrixAt(d.auras.count, this.m4);
        d.auras.setColorAt(d.auras.count++, this.col.set('#ffcd75'));
      }

      // Elite modifier: a coloured ground ring, plus a bubble while a shield holds.
      if (e.mod && e.state !== 'spawning' && d.auras.count < AURA_CAP) {
        const ar = e.radius * (1.7 + 0.08 * Math.sin(time * 8 + e.uid));
        this.q.setFromAxisAngle(this.up, time * 1.5);
        this.m4.compose(this.v.set(x, 0.035, z), this.q, this.s.set(ar, 1, ar));
        d.auras.setMatrixAt(d.auras.count, this.m4);
        d.auras.setColorAt(d.auras.count++, this.col.set(e.mod.color));
        if (e.shield > 0) {
          const br = e.radius * 1.45;
          this.m4.compose(this.v.set(x, y + e.radius * 0.9, z), this.q, this.s.set(br, br, br));
          d.bubbles.setMatrixAt(d.bubbles.count++, this.m4);
        }
      }

      const ss = e.radius * 2.6 * Math.min(1, sx / e.scale) * (1 - Math.min(0.6, e.hopY * 0.1));
      this.m4.makeScale(ss, 1, ss).setPosition(x, 0.02, z);
      d.shadows.setMatrixAt(d.shadows.count++, this.m4);
    }

    this.corpses.render(fdt, time, this.m4, this.putCorpse, this.putShadow);

    for (const zn of this.zones) {
      if (d.zones.count >= 62 || d.discs.count >= 32) break;
      this.m4.makeScale(zn.r, 1, zn.r).setPosition(zn.x, 0.045, zn.z);
      d.discs.setMatrixAt(d.discs.count++, this.m4);
      this.m4.makeScale(zn.r, 1, zn.r).setPosition(zn.x, 0.05, zn.z);
      d.zones.setMatrixAt(d.zones.count++, this.m4);
      const k = Math.max(0.05, zn.t / zn.life) * zn.r;
      this.m4.makeScale(k, 1, k).setPosition(zn.x, 0.05, zn.z);
      d.zones.setMatrixAt(d.zones.count++, this.m4);
    }
    for (const b of this.batches.values()) {
      commit(b.mesh.instanceMatrix, b.mesh.count);
      commit(b.flash, b.mesh.count);
    }
    for (const m of [d.shadows, d.markers, d.lines, d.zones, d.discs, d.auras, d.bubbles, d.heals]) commit(m.instanceMatrix, m.count);
    if (d.auras.instanceColor) commit(d.auras.instanceColor, d.auras.count);
  }
}
