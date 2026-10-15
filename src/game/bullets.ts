import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { commit } from '../render/instancing';
import { streaks } from './streaks';

/**
 * Pooled projectiles stored as struct-of-arrays, drawn with one InstancedMesh
 * plus an additive glow halo that shares the same instance buffers.
 * Simulation is 2D (x, z); `y` is only the visual flight height.
 */
const MAX = 1024;
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
  /** 1 = charged Buster shot (credited to 'charge'). */
  kind?: number;
  /** Explodes with this radius when it dies (0 = no blast). */
  blast?: number;
}

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
  /** uid of the last enemy hit, so piercing shots don't hit it twice. */
  readonly lastHit = new Int32Array(MAX);
  readonly owner = new Uint8Array(MAX);
  readonly kind = new Uint8Array(MAX);
  readonly blast = new Float32Array(MAX);
  private colors: THREE.Color[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

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
    this.lastHit[i] = -1;
    this.owner[i] = b.owner ?? 0;
    this.kind[i] = b.kind ?? 0;
    this.blast[i] = b.blast ?? 0;
    this.colors[i].set(b.color);
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
    this.lastHit[i] = this.lastHit[j];
    this.owner[i] = this.owner[j];
    this.kind[i] = this.kind[j];
    this.blast[i] = this.blast[j];
    this.colors[i].copy(this.colors[j]);
  }

  clear(): void {
    this.count = 0;
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
      this.m4.compose(this.p.set(x, BULLET_Y, z), this.q, this.s.set(w, w, this.length[i] * grow * fade));
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, this.colors[i]);
    }
    this.mesh.count = this.halo.count = this.count;
    commit(this.mesh.instanceMatrix, this.mesh.count);
    if (this.mesh.instanceColor) commit(this.mesh.instanceColor, this.mesh.count);
  }
}
