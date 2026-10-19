import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { commit } from '../render/instancing';
import { streaks } from './streaks';
import { KIND_SHAPE, SHAPE_COUNT, shapeGeometry, shapeSpin, BulletShape } from './bulletShapes';

/**
 * Pooled projectiles stored as struct-of-arrays, drawn with one InstancedMesh
 * plus an additive glow halo that shares the same instance buffers.
 * Simulation is 2D (x, z); `y` is only the visual flight height.
 */
const MAX = 1024;
/** Piercing bullets remember this many enemies so they never hit one twice (a single slot let them ping-pong between two). */
const HITS = 4;
export const BULLET_Y = 1.05;

export const Team = { Player: 0, Enemy: 1 } as const;
export type Team = (typeof Team)[keyof typeof Team];

export interface BulletSpawn {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  life: number;
  radius: number;
  damage: number;
  knockback: number;
  team: Team;
  color: THREE.ColorRepresentation;
  width: number;
  length: number;
  pierce?: number;
  bounce?: number;
  homing?: number;
  /** Index of the hero who fired it (damage credit and Mod triggers). */
  owner?: number;
  /** Damage source: 0 Buster, 1 charge shot, 2 Scattergun, 3 Dragon's Breath, 4 reflected by Mirror Aegis. */
  kind?: number;
  /** Explodes with this radius when it dies (0 = no blast). */
  blast?: number;
  /** Silhouette (src/game/bulletShapes.ts); defaults from the player bullet's kind. */
  shape?: number;
}

/** Instances per non-gem shape mesh. */
const SHAPE_MAX = 256;

export class Bullets {
  readonly mesh: THREE.InstancedMesh;
  private halo: THREE.InstancedMesh;
  count = 0;
  readonly x = new Float32Array(MAX);
  readonly z = new Float32Array(MAX);
  readonly px = new Float32Array(MAX);
  readonly pz = new Float32Array(MAX);
  readonly vx = new Float32Array(MAX);
  readonly vz = new Float32Array(MAX);
  readonly life = new Float32Array(MAX);
  readonly radius = new Float32Array(MAX);
  readonly damage = new Float32Array(MAX);
  readonly knockback = new Float32Array(MAX);
  readonly team = new Uint8Array(MAX);
  readonly width = new Float32Array(MAX);
  readonly length = new Float32Array(MAX);
  readonly age = new Float32Array(MAX);
  readonly pierce = new Uint8Array(MAX);
  readonly bounce = new Uint8Array(MAX);
  readonly homing = new Float32Array(MAX);
  /** uids of the last HITS enemies hit (ring buffer), so piercing shots don't hit one twice. */
  private readonly hits = new Int32Array(MAX * HITS);
  private readonly hitN = new Uint8Array(MAX);
  readonly owner = new Uint8Array(MAX);
  readonly kind = new Uint8Array(MAX);
  readonly blast = new Float32Array(MAX);
  /** Silhouette per bullet (0 = gem). */
  readonly shape = new Uint8Array(MAX);
  /** Core + halo meshes for the other silhouettes (index = shape - 1). */
  private shapeMeshes: { core: THREE.InstancedMesh; halo: THREE.InstancedMesh }[] = [];
  private colors: THREE.Color[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private q2 = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    // Elongated gem along +Z; reads well from the top-down camera.
    this.mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.5, 0), createRetroMaterial({ unlit: 1 }), MAX);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.colors.push(new THREE.Color());
      this.mesh.setColorAt(i, this.colors[i]);
    }
    this.mesh.count = 0;
    scene.add(this.mesh);

    // Soft additive halo, 2x the size, reusing the core's instance data.
    const haloMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1.0, 0), haloMat, MAX);
    this.halo.instanceMatrix = this.mesh.instanceMatrix;
    this.halo.instanceColor = this.mesh.instanceColor;
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 2;
    this.halo.count = 0;
    scene.add(this.halo);

    // Evolved shots: stars, flames, bolts and lances, each its own core + halo pair.
    for (let k = 1; k < SHAPE_COUNT; k++) {
      const core = new THREE.InstancedMesh(shapeGeometry(k as BulletShape), createRetroMaterial({ unlit: 1, side: THREE.DoubleSide }), SHAPE_MAX);
      const halo = new THREE.InstancedMesh(shapeGeometry(k as BulletShape, true), haloMat, SHAPE_MAX);
      core.setColorAt(0, new THREE.Color());
      halo.instanceMatrix = core.instanceMatrix;
      halo.instanceColor = core.instanceColor;
      core.frustumCulled = halo.frustumCulled = false;
      halo.renderOrder = 2;
      core.count = halo.count = 0;
      scene.add(core, halo);
      this.shapeMeshes.push({ core, halo });
    }
  }

  spawn(b: BulletSpawn): void {
    if (this.count >= MAX) return;
    const i = this.count++;
    this.x[i] = this.px[i] = b.x;
    this.z[i] = this.pz[i] = b.z;
    this.vx[i] = b.dirX * b.speed;
    this.vz[i] = b.dirZ * b.speed;
    this.life[i] = b.life;
    this.radius[i] = b.radius;
    this.damage[i] = b.damage;
    this.knockback[i] = b.knockback;
    this.team[i] = b.team;
    this.width[i] = b.width;
    this.length[i] = b.length;
    this.age[i] = 0;
    this.pierce[i] = b.pierce ?? 0;
    this.bounce[i] = b.bounce ?? 0;
    this.homing[i] = b.homing ?? 0;
    this.clearHits(i);
    this.owner[i] = b.owner ?? 0;
    this.kind[i] = b.kind ?? 0;
    this.blast[i] = b.blast ?? 0;
    this.shape[i] = b.shape ?? (b.team === Team.Player ? (KIND_SHAPE[b.kind ?? 0] ?? 0) : 0);
    this.colors[i].set(b.color);
  }

  hasHit(i: number, uid: number): boolean {
    const n = Math.min(this.hitN[i], HITS);
    for (let k = 0; k < n; k++) if (this.hits[i * HITS + k] === uid) return true;
    return false;
  }

  /** `hitN` counts every hit; the slot it lands in wraps around the last HITS. */
  markHit(i: number, uid: number): void {
    this.hits[i * HITS + (this.hitN[i] % HITS)] = uid;
    this.hitN[i] = Math.min(255, this.hitN[i] + 1);
  }

  clearHits(i: number): void {
    this.hitN[i] = 0;
  }

  /** Remove bullet i by swapping the last one into its slot. */
  kill(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.z[i] = this.z[j];
    this.px[i] = this.px[j];
    this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j];
    this.vz[i] = this.vz[j];
    this.life[i] = this.life[j];
    this.radius[i] = this.radius[j];
    this.damage[i] = this.damage[j];
    this.knockback[i] = this.knockback[j];
    this.team[i] = this.team[j];
    this.width[i] = this.width[j];
    this.length[i] = this.length[j];
    this.age[i] = this.age[j];
    this.pierce[i] = this.pierce[j];
    this.bounce[i] = this.bounce[j];
    this.homing[i] = this.homing[j];
    this.hits.copyWithin(i * HITS, j * HITS, j * HITS + HITS);
    this.hitN[i] = this.hitN[j];
    this.owner[i] = this.owner[j];
    this.kind[i] = this.kind[j];
    this.blast[i] = this.blast[j];
    this.shape[i] = this.shape[j];
    this.colors[i].copy(this.colors[j]);
  }

  clear(): void {
    this.count = 0;
  }

  setColor(i: number, color: THREE.ColorRepresentation): void {
    this.colors[i].set(color);
  }

  /** Bullet colour (for network snapshots). */
  colorOf(i: number): string {
    return '#' + this.colors[i].getHexString();
  }

  /** Integrate motion. Collision is resolved by the game (needs enemies/walls). */
  integrate(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      this.px[i] = this.x[i];
      this.pz[i] = this.z[i];
      this.x[i] += this.vx[i] * dt;
      this.z[i] += this.vz[i] * dt;
      this.life[i] -= dt;
      this.age[i] += dt;
    }
  }

  /** Rotate bullet i's velocity toward (tx, tz) by at most `maxTurn` radians. */
  steer(i: number, tx: number, tz: number, maxTurn: number): void {
    const cur = Math.atan2(this.vz[i], this.vx[i]);
    const want = Math.atan2(tz - this.z[i], tx - this.x[i]);
    let d = want - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const a = cur + Math.max(-maxTurn, Math.min(maxTurn, d));
    const sp = Math.hypot(this.vx[i], this.vz[i]);
    this.vx[i] = Math.cos(a) * sp;
    this.vz[i] = Math.sin(a) * sp;
  }

  render(alpha: number): void {
    let n0 = 0;
    for (const sm of this.shapeMeshes) sm.core.count = 0;
    for (let i = 0; i < this.count; i++) {
      const x = this.px[i] + (this.x[i] - this.px[i]) * alpha;
      const z = this.pz[i] + (this.z[i] - this.pz[i]) * alpha;
      this.q.setFromAxisAngle(this.up, Math.atan2(this.vx[i], this.vz[i]));
      // Pop in over the first few frames so shots don't appear inside the gun.
      const grow = Math.min(1, 0.4 + this.age[i] * 12);
      // Shrink out over the last 0.08 s instead of vanishing.
      const fade = Math.min(1, this.life[i] / 0.08);
      const w = this.width[i] * grow * fade;
      // Charge shots leave a glowing streak.
      if (this.blast[i] > 0 && this.team[i] === Team.Player) streaks.add(this.px[i], this.pz[i], x, z, BULLET_Y, w * 0.7, this.colors[i], 0.14);
      const sh = this.shape[i];
      const sm = sh ? this.shapeMeshes[sh - 1] : null;
      if (sm && sm.core.count < SHAPE_MAX) {
        // Stars spin and stay round; flames flicker; bolts jitter.
        const spin = shapeSpin(sh, this.age[i], i);
        if (spin) this.q.multiply(this.q2.setFromAxisAngle(this.up, spin));
        const len = this.length[i] * grow * fade;
        const flick = sh === BulletShape.Flame ? 1 + 0.18 * Math.sin(this.age[i] * 40 + i) : 1;
        if (sh === BulletShape.Star) this.s.set(Math.max(w, len) * 1.25, w, Math.max(w, len) * 1.25);
        else this.s.set(w * (sh === BulletShape.Flame ? 1.15 : sh === BulletShape.Bolt ? 2.4 : 1.4) * flick, w, len * (sh === BulletShape.Flame ? 1.1 * (2 - flick) : 1));
        this.m4.compose(this.p.set(x, BULLET_Y, z), this.q, this.s);
        const k = sm.core.count++;
        sm.core.setMatrixAt(k, this.m4);
        sm.core.setColorAt(k, this.colors[i]);
        continue;
      }
      this.m4.compose(this.p.set(x, BULLET_Y, z), this.q, this.s.set(w, w, this.length[i] * grow * fade));
      this.mesh.setMatrixAt(n0, this.m4);
      this.mesh.setColorAt(n0++, this.colors[i]);
    }
    this.mesh.count = this.halo.count = n0;
    commit(this.mesh.instanceMatrix, this.mesh.count);
    if (this.mesh.instanceColor) commit(this.mesh.instanceColor, this.mesh.count);
    for (const sm of this.shapeMeshes) {
      sm.halo.count = sm.core.count;
      commit(sm.core.instanceMatrix, sm.core.count);
      if (sm.core.instanceColor) commit(sm.core.instanceColor, sm.core.count);
    }
  }
}
