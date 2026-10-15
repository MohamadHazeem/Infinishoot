import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { EnemyDef } from '../data/enemies';
import { createRetroMaterial } from '../render/retroMaterial';
import { paint } from '../render/geometry';
import { textures } from '../render/textures';
import type { SpatialHash } from '../core/spatialHash';
import { resolveCircleVsBoxes, type AABB } from '../world/collision';
import { commit } from '../render/instancing';
import { ELITE_MODS, type EliteModDef, type EliteModId } from '../data/eliteMods';

export type EnemyState = 'spawning' | 'move' | 'windup' | 'attack' | 'recover';
export type BossAction = 'ring' | 'summon' | 'slam' | 'charge' | 'spiral' | 'waves' | 'volley' | 'rain';
export const BOSS_ACTIONS: BossAction[] = ['ring', 'summon', 'slam', 'charge', 'spiral', 'waves', 'volley', 'rain'];

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
  geo = mergeGeometries(parts)!;
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
  lungeX = 0;
  lungeZ = 0;
  facing = 0;
  hitPlayer = false;
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
  /** Ka-Boomer fuse tick countdown (sound only). */
  tickT = 0;
  /** Elite modifier timer (teleport). */
  modT = 0;
  /** Boss phase (1-3) and how much faster its attack timers run. */
  phase = 1;
  rage = 1;
  rageT = 0;
  /** Squash-and-stretch spring: displacement and velocity. */
  sq = 0;
  sqV = 0;

  constructor(public def: EnemyDef) {}

  reset(x: number, z: number, o: SpawnOpts): void {
    this.uid = nextUid++;
    this.active = true;
    this.state = 'spawning';
    this.t = o.instant ? 0.01 : SPAWN_TIME;
    this.x = this.px = x;
    this.z = this.pz = z;
    this.vx = this.vz = this.kx = this.kz = 0;
    this.elite = !!o.elite;
    this.scale = this.elite ? 1.6 : 1;
    this.radius = this.def.radius * this.scale;
    this.hp = this.maxHp = Math.round(this.def.hp * (o.hpMul ?? 1) * (this.elite ? 10 : 1));
    this.speedMul = (o.speedMul ?? 1) * (this.elite ? 0.9 : 1);
    this.dmgMul = (o.dmgMul ?? 1) * (this.elite ? 1.5 : 1);
    this.mod = this.elite && o.eliteMod ? ELITE_MODS[o.eliteMod] : null;
    if (this.mod) {
      this.hp = this.maxHp = Math.round(this.maxHp * (this.mod.hpMul ?? 1));
      this.speedMul *= this.mod.speedMul ?? 1;
    }
    this.shield = Math.round(this.maxHp * (this.mod?.shield ?? 0));
    this.modT = this.mod?.teleport ?? 0;
    this.bombStamp = 0;
    this.flash = this.frozen = this.slowT = this.shatter = 0;
    this.burnT = this.burnDps = this.burnAcc = this.shockT = this.burnOwner = 0;
    this.sq = this.sqV = this.hopY = 0;
    this.timerA = this.def.boss ? 3 : 1 + Math.random() * 2;
    this.burst = this.spin = this.timerB = this.step = 0;
    this.phase = this.rage = 1;
    this.rageT = 0;
    this.action = 'ring';
    this.strafe = Math.random() < 0.5 ? -1 : 1;
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
  onWindup(e: Enemy): void;
  fireBullet(e: Enemy, dirX: number, dirZ: number, speed: number, damage: number): void;
  spawnChild(defId: string, x: number, z: number, parent: Enemy): void;
  detonate(e: Enemy): void;
  slam(e: Enemy): void;
  /** Mark a ground strike: telegraphed, then hits players inside after `delay`. */
  strike(x: number, z: number, r: number, delay: number, damage: number): void;
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
const AURA_CAP = 32;

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
    for (const m of [this.shadows, this.markers, this.lines, this.zones, this.discs, this.auras, this.bubbles]) {
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

  constructor(private scene: THREE.Scene) {
    this.decals = new GroundDecals(scene, 2048);
  }

  spawn(def: EnemyDef, x: number, z: number, o: SpawnOpts = {}): Enemy {
    let e = this.free.pop();
    if (e) e.def = def;
    else {
      e = new Enemy(def);
      this.list.push(e);
    }
    if (!this.batches.has(def.id)) this.batches.set(def.id, new EnemyBatch(def, this.scene));
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
      const dist = Math.hypot(dx, dz) || 1;
      const nx = dx / dist;
      const nz = dz / dist;
      const speed = e.def.speed * e.speedMul * (e.slowT > 0 ? 1 - e.slowAmt : 1);
      let wantX = 0;
      let wantZ = 0;
      let rigid = false; // attack movement ignores steering smoothing
      // Enraged bosses run their attack clock faster.
      const bdt = e.def.boss ? dt * e.rage : dt;
      e.t -= bdt;

      switch (e.def.behavior) {
        case 'chase':
          wantX = nx * speed;
          wantZ = nz * speed;
          e.facing = Math.atan2(dx, dz);
          break;

        case 'lunge': {
          const L = e.def.lunge!;
          if (e.state === 'move') {
            wantX = nx * speed;
            wantZ = nz * speed;
            e.facing = Math.atan2(dx, dz);
            if (dist < L.range * e.scale && ctx.targetAlive) this.enter(e, 'windup', L.windup, -5, ctx);
          } else if (e.state === 'windup') {
            if (e.t > L.windup * 0.5) this.lockOn(e, nx, nz, dx, dz);
            e.sq = Math.min(e.sq, -0.25);
            if (e.t <= 0) this.enter(e, 'attack', L.duration, 9);
          } else if (e.state === 'attack') {
            wantX = e.lungeX * L.speed;
            wantZ = e.lungeZ * L.speed;
            rigid = true;
            if (e.t <= 0) this.enter(e, 'recover', L.recover, -4);
          } else if (e.t <= 0) e.state = 'move';
          break;
        }

        case 'shooter': {
          const S = e.def.shoot!;
          e.facing = Math.atan2(dx, dz);
          if (e.state === 'move') {
            // Hold a ring around the player, strafing sideways.
            const radial = dist > S.keepDistance + 1 ? 1 : dist < S.keepDistance - 1.5 ? -1 : 0;
            wantX = (nx * radial - nz * e.strafe * 0.6) * speed;
            wantZ = (nz * radial + nx * e.strafe * 0.6) * speed;
            e.timerA -= dt;
            const reach = S.pattern === 'sniper' ? 20 : 15;
            if (e.timerA <= 0 && dist < reach && ctx.targetAlive) {
              if (S.pattern === 'sniper') {
                // Long aim: the line tracks you, then locks just before the shot.
                this.lockOn(e, nx, nz, dx, dz);
                this.enter(e, 'windup', 1.1, -3, ctx);
              } else this.enter(e, 'windup', 0.45, -4, ctx);
            }
          } else if (e.state === 'windup') {
            if (S.pattern === 'sniper' && e.t > 0.25) this.lockOn(e, nx, nz, dx, dz);
            if (e.t <= 0) {
              const base = Math.atan2(nz, nx);
              if (S.pattern === 'sniper') {
                ctx.fireBullet(e, e.lungeX, e.lungeZ, S.speed, S.damage);
                this.endVolley(e, S);
              } else if (S.pattern === 'spiral' || S.pattern === 'burst') {
                // Spirals stream bullets for a while; bursts fire three quick fans.
                e.burst = S.pattern === 'spiral' ? S.bullets : 3;
                e.spin = base;
                e.timerB = 0;
                this.enter(e, 'attack', 2, 4);
              } else {
                const spread = THREE.MathUtils.degToRad(S.spreadDeg);
                for (let i = 0; i < S.bullets; i++) {
                  const a = base + (S.bullets > 1 ? (i / (S.bullets - 1) - 0.5) * spread : 0);
                  ctx.fireBullet(e, Math.cos(a), Math.sin(a), S.speed, S.damage);
                }
                this.endVolley(e, S);
              }
            }
          } else if (e.state === 'attack') {
            wantX = wantZ = 0;
            e.timerB -= dt;
            if (e.timerB <= 0 && e.burst > 0) {
              e.burst--;
              if (S.pattern === 'spiral') {
                e.timerB = 0.075;
                e.spin += 0.55;
                for (const k of [0, Math.PI]) ctx.fireBullet(e, Math.cos(e.spin + k), Math.sin(e.spin + k), S.speed, S.damage);
              } else {
                e.timerB = 0.22;
                const base = Math.atan2(nz, nx);
                const spread = THREE.MathUtils.degToRad(S.spreadDeg);
                for (let i = 0; i < S.bullets; i++) {
                  const a = base + (S.bullets > 1 ? (i / (S.bullets - 1) - 0.5) * spread : 0);
                  ctx.fireBullet(e, Math.cos(a), Math.sin(a), S.speed, S.damage);
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
          if (e.state === 'move') {
            wantX = nx * speed;
            wantZ = nz * speed;
            e.facing = Math.atan2(dx, dz);
            if (dist < C.range && ctx.targetAlive) {
              this.lockOn(e, nx, nz, dx, dz);
              this.enter(e, 'windup', C.windup, -5, ctx);
            }
          } else if (e.state === 'windup') {
            e.sq = Math.min(e.sq, -0.2);
            if (e.t <= 0) this.enter(e, 'attack', C.duration, 8);
          } else if (e.state === 'attack') {
            wantX = e.lungeX * C.speed;
            wantZ = e.lungeZ * C.speed;
            rigid = true;
            if (e.t <= 0) this.enter(e, 'recover', C.recover, -5);
          } else if (e.t <= 0) e.state = 'move';
          break;
        }

        case 'exploder': {
          const F = e.def.fuse!;
          if (e.state === 'move') {
            wantX = nx * speed;
            wantZ = nz * speed;
            e.facing = Math.atan2(dx, dz);
            if (dist < F.range && ctx.targetAlive) this.enter(e, 'windup', F.time, -3, ctx);
          } else if (e.state === 'windup') {
            // Keeps creeping toward you while the fuse burns.
            wantX = nx * speed * 0.25;
            wantZ = nz * speed * 0.25;
            if (e.t <= 0) {
              ctx.detonate(e);
              continue;
            }
          }
          break;
        }

        case 'spawner': {
          const P = e.def.spawn!;
          if (e.state === 'move') {
            e.timerA -= dt;
            if (e.timerA <= 0) this.enter(e, 'windup', 0.7, -4, ctx);
          } else if (e.state === 'windup' && e.t <= 0) {
            for (let i = 0; i < P.count; i++) {
              const a = (i / P.count) * Math.PI * 2;
              ctx.spawnChild(P.into, e.x + Math.cos(a) * 1.6, e.z + Math.sin(a) * 1.6, e);
            }
            e.squash(8);
            e.timerA = P.interval;
            e.state = 'move';
          }
          break;
        }

        case 'boss':
          rigid = this.updateBoss(e, bdt, ctx, nx, nz, dist, speed);
          wantX = e.vx;
          wantZ = e.vz;
          break;
        case 'rex':
          rigid = this.updateRex(e, bdt, ctx, nx, nz, dist, speed);
          wantX = e.vx;
          wantZ = e.vz;
          break;
        case 'queen':
          this.updateQueen(e, bdt, ctx, nx, nz, dist, speed);
          wantX = e.vx;
          wantZ = e.vz;
          break;
      }

      // Separation from neighbours so crowds spread out instead of stacking.
      let sx = 0;
      let sz = 0;
      if (!e.def.boss) {
        const r = e.radius;
        ctx.hash.query(e.x, e.z, r * 2, (o) => {
          if (o === e || !o.alive) return;
          const ox = e.x - o.x;
          const oz = e.z - o.z;
          const d2 = ox * ox + oz * oz;
          const min = r + o.radius;
          if (d2 > 0.0001 && d2 < min * min) {
            const d = Math.sqrt(d2);
            const push = ((min - d) / min) * (o.def.boss ? 3 : 1);
            sx += (ox / d) * push;
            sz += (oz / d) * push;
          }
        });
        const steer = rigid ? 1 : 1 - Math.exp(-10 * dt);
        e.vx += (wantX - e.vx) * steer;
        e.vz += (wantZ - e.vz) * steer;
      }

      const kd = Math.exp(-9 * dt);
      e.kx *= kd;
      e.kz *= kd;
      e.x += (e.vx + e.kx + sx * 7) * dt;
      e.z += (e.vz + e.kz + sz * 7) * dt;
      const walled = e.def.behavior !== 'queen' && e.hopY <= 0 && resolveCircleVsBoxes(e, e.radius, ctx.colliders);
      if (walled && rigid && e.def.behavior === 'charger') {
        // Rhinos stop (and wobble) when they hit a wall mid-charge.
        this.enter(e, 'recover', e.def.charge!.recover, -7);
      }
    }
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
    e.timerA = S.interval * (0.8 + Math.random() * 0.4);
    e.state = 'move';
  }

  private lockOn(e: Enemy, nx: number, nz: number, dx: number, dz: number): void {
    e.lungeX = nx;
    e.lungeZ = nz;
    e.facing = Math.atan2(dx, dz);
  }

  /** King Bopper: chases, then cycles ring bursts, summons and a jump slam. Returns true while airborne. */
  private updateBoss(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): boolean {
    const tgt = ctx.target;
    e.facing = Math.atan2(nx, nz);
    if (e.state === 'move') {
      e.vx = nx * speed;
      e.vz = nz * speed;
      e.timerA -= dt;
      if (e.timerA <= 0 && ctx.targetAlive) {
        // Slam when far away, otherwise rotate through the attacks.
        e.action = dist > 9 ? 'slam' : e.action === 'ring' ? (Math.random() < 0.5 ? 'summon' : 'slam') : 'ring';
        e.vx = e.vz = 0;
        if (e.action === 'slam') {
          e.targetX = tgt.x;
          e.targetZ = tgt.z;
          this.enter(e, 'windup', 1.0, -6, ctx);
        } else this.enter(e, 'windup', 0.7, -5, ctx);
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
        const n = 18;
        const off = Math.random() * Math.PI;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          ctx.fireBullet(e, Math.cos(a), Math.sin(a), 7, 14);
        }
        for (let i = -2; i <= 2; i++) {
          const a = Math.atan2(nz, nx) + i * 0.12;
          ctx.fireBullet(e, Math.cos(a), Math.sin(a), 10, 14);
        }
        this.enter(e, 'recover', 0.8, 8);
      } else if (e.action === 'summon') {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.spawnChild('swarmer', e.x + Math.cos(a) * 3, e.z + Math.sin(a) * 3, e);
        }
        this.enter(e, 'recover', 0.8, 8);
      } else {
        e.fromX = e.x;
        e.fromZ = e.z;
        this.enter(e, 'attack', 0.55, 10);
      }
      return false;
    }
    if (e.state === 'attack') {
      // Airborne: arc from start to the target point.
      const k = 1 - Math.max(0, e.t) / 0.55;
      e.x = e.fromX + (e.targetX - e.fromX) * k;
      e.z = e.fromZ + (e.targetZ - e.fromZ) * k;
      e.hopY = Math.sin(k * Math.PI) * 5;
      e.vx = e.vz = 0;
      if (e.t <= 0) {
        e.hopY = 0;
        ctx.slam(e);
        this.enter(e, 'recover', 1.0, -10);
      }
      return true;
    }
    // recover
    e.vx = e.vz = 0;
    if (e.t <= 0) {
      e.state = 'move';
      e.timerA = 2.2;
    }
    return false;
  }

  /**
   * Rampage Rex: stomps after you, then cycles a chain of three charges (each
   * telegraphed by a ground line), a spinning bullet spiral, and expanding
   * shockwave rings. Returns true while charging.
   */
  private updateRex(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): boolean {
    const CHARGE_SPEED = 24;
    const CHARGE_TIME = 0.5;
    if (e.state === 'move') {
      e.facing = Math.atan2(nx, nz);
      e.vx = nx * speed;
      e.vz = nz * speed;
      e.timerA -= dt;
      if (e.timerA <= 0 && ctx.targetAlive) {
        const order: BossAction[] = ['charge', 'spiral', 'charge', 'waves'];
        e.action = dist > 13 ? 'charge' : order[e.step++ % order.length];
        e.vx = e.vz = 0;
        if (e.action === 'charge') {
          e.burst = 3;
          this.lockOn(e, nx, nz, nx, nz);
          this.enter(e, 'windup', 0.85, -6, ctx);
        } else this.enter(e, 'windup', 0.7, -5, ctx);
      }
      return false;
    }
    if (e.state === 'windup') {
      e.vx = e.vz = 0;
      // Charges keep aiming during the first half of the wind-up.
      if (e.action === 'charge' && e.t > 0.3) this.lockOn(e, nx, nz, nx, nz);
      if (e.t > 0) return false;
      if (e.action === 'charge') this.enter(e, 'attack', CHARGE_TIME, 9);
      else if (e.action === 'spiral') {
        e.spin = Math.atan2(nz, nx);
        e.timerB = 0;
        this.enter(e, 'attack', 2.6, 6);
      } else {
        e.burst = 3;
        e.timerB = 0;
        this.enter(e, 'attack', 1.5, 6);
      }
      return false;
    }
    if (e.state === 'attack') {
      if (e.action === 'charge') {
        e.vx = e.lungeX * CHARGE_SPEED;
        e.vz = e.lungeZ * CHARGE_SPEED;
        if (e.t <= 0) {
          e.vx = e.vz = 0;
          if (--e.burst > 0) {
            this.lockOn(e, nx, nz, nx, nz);
            this.enter(e, 'windup', 0.45, -5, ctx);
          } else this.enter(e, 'recover', 1.1, -8);
        }
        return true;
      }
      e.vx = e.vz = 0;
      e.timerB -= dt;
      if (e.action === 'spiral') {
        // Three arms turning steadily: walk around it, not through it.
        while (e.timerB <= 0) {
          e.timerB += 0.1;
          for (let k = 0; k < 3; k++) {
            const a = e.spin + (k / 3) * Math.PI * 2;
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
      if (e.t <= 0) this.enter(e, 'recover', 0.9, 6);
      return false;
    }
    e.vx = e.vz = 0;
    if (e.t <= 0) {
      e.state = 'move';
      e.timerA = 1.8;
    }
    return false;
  }

  /**
   * Hive Queen: hovers at range and circles you, firing aimed fans, raining
   * telegraphed strikes around you, and calling in Zippies.
   */
  private updateQueen(e: Enemy, dt: number, ctx: EnemyCtx, nx: number, nz: number, dist: number, speed: number): void {
    const tgt = ctx.target;
    e.facing = Math.atan2(nx, nz);
    e.timerB += dt;
    e.hopY = 1.4 + Math.sin(e.timerB * 3) * 0.3;
    if (e.state === 'move') {
      const radial = dist > 10 ? 1 : dist < 7 ? -1 : 0;
      e.vx = (nx * radial - nz * e.strafe * 0.8) * speed;
      e.vz = (nz * radial + nx * e.strafe * 0.8) * speed;
      e.timerA -= dt;
      if (e.timerA <= 0 && ctx.targetAlive) {
        const order: BossAction[] = ['volley', 'rain', 'volley', 'summon'];
        e.action = order[e.step++ % order.length];
        if (Math.random() < 0.3) e.strafe *= -1;
        this.enter(e, 'windup', e.action === 'rain' ? 0.5 : 0.6, -5, ctx);
      }
      return;
    }
    e.vx *= 0.9;
    e.vz *= 0.9;
    if (e.state === 'windup') {
      if (e.t > 0) return;
      if (e.action === 'volley') {
        e.burst = 3;
        e.spin = 0;
        this.enter(e, 'attack', 1.2, 4);
      } else if (e.action === 'rain') {
        ctx.strike(tgt.x, tgt.z, 2.2, 1.1, 18);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.random();
          const d = 3.5 + Math.random() * 3;
          ctx.strike(tgt.x + Math.cos(a) * d, tgt.z + Math.sin(a) * d, 2.2, 1.1 + i * 0.12, 18);
        }
        this.enter(e, 'recover', 1.0, 6);
      } else {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.spawnChild('zippy', e.x + Math.cos(a) * 2.5, e.z + Math.sin(a) * 2.5, e);
        }
        this.enter(e, 'recover', 0.8, 8);
      }
      return;
    }
    if (e.state === 'attack') {
      e.spin -= dt;
      if (e.spin <= 0 && e.burst > 0) {
        e.spin = 0.35;
        e.burst--;
        const base = Math.atan2(nz, nx);
        for (let i = 0; i < 7; i++) {
          const a = base + (i / 6 - 0.5) * 0.9;
          ctx.fireBullet(e, Math.cos(a), Math.sin(a), 9.5, 13);
        }
        e.squash(5);
      }
      if (e.t <= 0) this.enter(e, 'recover', 0.6, 4);
      return;
    }
    if (e.t <= 0) {
      e.state = 'move';
      e.timerA = 1.6;
    }
  }

  // ---------------------------------------------------------------- render

  /** Write every active enemy into its type's instanced mesh, plus ground decals. */
  render(alpha: number, time: number): void {
    for (const b of this.batches.values()) b.mesh.count = 0;
    const d = this.decals;
    d.shadows.count = d.markers.count = d.lines.count = d.zones.count = d.discs.count = d.auras.count = d.bubbles.count = 0;
    d.setPulse(time);

    for (const e of this.list) {
      if (!e.active) continue;
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
      } else if (e.state === 'move' && e.frozen <= 0 && e.def.speed > 0) {
        y += Math.abs(Math.sin(time * 12 + e.uid)) * 0.1 * e.scale;
      }

      // Telegraphs drawn on the ground.
      if (e.state === 'windup' && e.frozen <= 0) {
        if (e.def.shoot?.pattern === 'sniper') {
          // Sniper aim line: thin, long and blinking faster as the shot nears.
          this.q.setFromAxisAngle(this.up, Math.atan2(e.lungeX, e.lungeZ));
          const w = e.t < 0.3 ? 0.3 : 0.12;
          this.m4.compose(this.v.set(x, 0.05, z), this.q, this.s.set(w, 1, 20));
          d.lines.setMatrixAt(d.lines.count++, this.m4);
        } else if (e.def.behavior === 'charger' || (e.def.behavior === 'rex' && e.action === 'charge')) {
          const C = e.def.charge ?? { speed: 24, duration: 0.5 };
          const len = C.speed * C.duration + 1;
          this.q.setFromAxisAngle(this.up, Math.atan2(e.lungeX, e.lungeZ));
          this.m4.compose(this.v.set(x, 0.04, z), this.q, this.s.set(e.radius * 1.6, 1, len));
          d.lines.setMatrixAt(d.lines.count++, this.m4);
        } else if (e.def.behavior === 'exploder') {
          const F = e.def.fuse!;
          const k = 1 - e.t / F.time;
          sx *= 1 + k * 0.35;
          sy *= 1 + k * 0.35;
          this.m4.makeScale(F.radius, 1, F.radius).setPosition(x, 0.05, z);
          d.zones.setMatrixAt(d.zones.count++, this.m4);
        }
      }
      if (e.def.behavior === 'boss' && e.action === 'slam' && (e.state === 'windup' || e.state === 'attack')) {
        this.m4.makeScale(3.8, 1, 3.8).setPosition(e.targetX, 0.05, e.targetZ);
        d.zones.setMatrixAt(d.zones.count++, this.m4);
      }

      const b = this.batches.get(e.def.id)!;
      if (b.mesh.count >= BATCH_CAP) continue;
      const i = b.mesh.count++;
      this.q.setFromAxisAngle(this.up, e.facing);
      this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(sx, sy, sx));
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
      else if (e.def.boss && e.phase > 1) b.flash.setXYZW(i, 1, 0.15, 0.2, (e.phase === 3 ? 0.35 : 0.2) + 0.15 * Math.sin(time * (e.phase === 3 ? 14 : 8)));
      else if (e.mod) b.flash.setXYZW(i, e.mod.glow[0], e.mod.glow[1], e.mod.glow[2], 0.3 + 0.15 * Math.sin(time * 6));
      else if (e.elite) b.flash.setXYZW(i, 1, 0.85, 0.2, 0.25 + 0.15 * Math.sin(time * 6));
      else b.flash.setXYZW(i, 0, 0, 0, 0);

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
    for (const m of [d.shadows, d.markers, d.lines, d.zones, d.discs, d.auras, d.bubbles]) commit(m.instanceMatrix, m.count);
    if (d.auras.instanceColor) commit(d.auras.instanceColor, d.auras.count);
  }
}
