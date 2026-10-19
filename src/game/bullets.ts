import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { commit } from '../render/instancing';
import { KIND_SHAPE, SHAPE_COUNT, shapeGeometry, shapeSpin, BulletShape } from './bulletShapes';
import { trails, TrailStyle } from './trails';

/**
 * Pooled projectiles stored as struct-of-arrays, drawn with one InstancedMesh
 * plus an additive glow halo that shares the same instance buffers.
 * Simulation is 2D (x, z); `y` is only the visual flight height.
 */
const MAX = 1024;
/** Piercing bullets remember this many enemies so they never hit one twice (a single slot let them ping-pong between two). */
const HITS = 4;
export const BULLET_Y = 1.05;

/**
 * How a bullet looks beyond its colour: picked from what every co-op machine
 * knows about it (team, colour, shape), so clients draw the same thing.
 */
export const BulletLook = {
  Plain: 0,
  Enemy: 1,
  /** Fire shots (Flare Buster, Dragon's Breath, Star Cannon, mega shots): flame trail and heat haze. */
  Fire: 2,
  /** Long thin cyan bolts (Volt Buster): crackling sparks. */
  Shock: 3,
  /** Pellets and turret rounds: long thin tracer tails. */
  Tracer: 4,
  /** Big or charged shots (charge shots, Lance Shot, Mega Barrage): a ribbon trail. */
  Ribbon: 5,
} as const;
export type BulletLook = (typeof BulletLook)[keyof typeof BulletLook];

/** Look for a bullet (pure: tests and clients use it). */
export function bulletLook(team: number, hex: number, width: number, length: number): BulletLook {
  if (team !== 0) return BulletLook.Enemy;
  if (hex === 0xff7a2f || hex === 0xff5e3a) return BulletLook.Fire;
  if (hex === 0x7df9ff && length >= width * 4) return BulletLook.Shock;
  if (width >= 0.45 || length >= width * 6 || hex === 0x3dffb0) return BulletLook.Ribbon;
  if (hex === 0xffcd75 || hex === 0xffe9a8 || hex === 0xffb627 || hex === 0x7df9ff) return BulletLook.Tracer;
  return BulletLook.Plain;
}

/** Tail per look: length (m), width (x bullet width), brightness. */
export const bulletTailTuning: { len: number; width: number; alpha: number }[] = [
  { len: 1.1, width: 0.75, alpha: 0.55 }, // plain
  { len: 0.9, width: 0.85, alpha: 0.5 }, // enemy
  { len: 1.5, width: 1.1, alpha: 0.75 }, // fire
  { len: 1.6, width: 0.7, alpha: 0.7 }, // shock
  { len: 2.0, width: 0.5, alpha: 0.6 }, // tracer
  { len: 1.4, width: 0.9, alpha: 0.6 }, // ribbon
];

/** Per-frame caps on the extra trail pieces bullets add (fire ribbons, shock sparks, big ribbons). */
export const bulletFxTuning = { fire: 64, shock: 14, ribbon: 40, enemyPulse: 0.12 };

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
  /** Visual identity (BulletLook) and where the bullet was drawn last frame (NaN = not yet). */
  readonly look = new Uint8Array(MAX);
  private rx = new Float32Array(MAX);
  private rz = new Float32Array(MAX);
  private tail: THREE.InstancedMesh;
  private tailAlpha: THREE.InstancedBufferAttribute;
  private time = 0;
  private q3 = new THREE.Quaternion();
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
    // Tails: a flat streak behind every bullet, fading toward the back (shape and length per look).
    const tg = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2); // uv.y: 0 at the back, 1 at the head (local +z)
    this.tailAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute('aTail', this.tailAlpha);
    const tailMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: /* glsl */ `
        in float aTail;
        out vec2 vUv;
        out vec3 vCol;
        out float vA;
        void main() {
          vUv = uv;
          vCol = vec3(1.0);
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #endif
          vA = aTail;
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        in vec2 vUv;
        in vec3 vCol;
        in float vA;
        layout(location = 0) out vec4 outColor;
        void main() {
          // uv.y runs tail (0) to head (1) after the rotation; taper to a point at the back.
          float along = vUv.y;
          float half_ = 0.5 * along;
          float x = abs(vUv.x - 0.5);
          if (x > half_ + 0.02) discard;
          float edge = 1.0 - x / max(half_, 0.001);
          float a = vA * along * along * edge;
          outColor = vec4((vCol + vec3(0.35) * edge * along) * a, a * 0.3);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.tail = new THREE.InstancedMesh(tg, tailMat, MAX);
    this.tail.instanceColor = this.mesh.instanceColor;
    this.tail.frustumCulled = false;
    this.tail.renderOrder = 1;
    this.tail.count = 0;
    scene.add(this.tail);
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
    this.look[i] = bulletLook(b.team, this.colors[i].getHex(), b.width, b.length);
    this.rx[i] = this.rz[i] = NaN;
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
    this.look[i] = this.look[j];
    this.rx[i] = this.rx[j];
    this.rz[i] = this.rz[j];
    this.colors[i].copy(this.colors[j]);
  }

  clear(): void {
    this.count = 0;
  }

  setColor(i: number, color: THREE.ColorRepresentation): void {
    this.colors[i].set(color);
    this.look[i] = bulletLook(this.team[i], this.colors[i].getHex(), this.width[i], this.length[i]);
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

  render(alpha: number, dt = 1 / 60): void {
    this.time += dt;
    const ta = this.tailAlpha.array as Float32Array;
    let fire = 0;
    let shock = 0;
    let ribbon = 0;
    const F = bulletFxTuning;
    const pulse = 1 + F.enemyPulse * Math.sin(this.time * 18);
    for (const sm of this.shapeMeshes) sm.core.count = 0;
    for (let i = 0; i < this.count; i++) {
      const x = this.px[i] + (this.x[i] - this.px[i]) * alpha;
      const z = this.pz[i] + (this.z[i] - this.pz[i]) * alpha;
      const yaw = Math.atan2(this.vx[i], this.vz[i]);
      this.q.setFromAxisAngle(this.up, yaw);
      // Pop in over the first few frames so shots don't appear inside the gun.
      const grow = Math.min(1, 0.4 + this.age[i] * 12);
      // Shrink out over the last 0.08 s instead of vanishing.
      const fade = Math.min(1, this.life[i] / 0.08);
      const look = this.look[i];
      let w = this.width[i] * grow * fade;
      // Enemy shots throb so they read as danger at a glance.
      if (look === BulletLook.Enemy) w *= pulse;
      const len = this.length[i] * grow * fade;
      const sh = this.shape[i];
      const sm = sh ? this.shapeMeshes[sh - 1] : null;
      if (sm && sm.core.count < SHAPE_MAX) {
        // Evolved shots (stars, flames, bolts, lances) draw in their own mesh; the gem slot hides.
        // Stars spin and stay round; flames flicker; bolts jitter.
        this.q3.copy(this.q);
        const spin = shapeSpin(sh, this.age[i], i);
        if (spin) this.q3.multiply(this.q2.setFromAxisAngle(this.up, spin));
        const flick = sh === BulletShape.Flame ? 1 + 0.18 * Math.sin(this.age[i] * 40 + i) : 1;
        if (sh === BulletShape.Star) this.s.set(Math.max(w, len) * 1.25, w, Math.max(w, len) * 1.25);
        else this.s.set(w * (sh === BulletShape.Flame ? 1.15 : sh === BulletShape.Bolt ? 2.4 : 1.4) * flick, w, len * (sh === BulletShape.Flame ? 1.1 * (2 - flick) : 1));
        this.m4.compose(this.p.set(x, BULLET_Y, z), this.q3, this.s);
        const k = sm.core.count++;
        sm.core.setMatrixAt(k, this.m4);
        sm.core.setColorAt(k, this.colors[i]);
        this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
      } else {
        this.m4.compose(this.p.set(x, BULLET_Y, z), this.q, this.s.set(w, w, look === BulletLook.Enemy ? len * pulse : len));
        this.mesh.setMatrixAt(i, this.m4);
      }
      this.mesh.setColorAt(i, this.colors[i]);

      // Tail: grows out of the gun with distance flown, sits behind the bullet.
      const sp = Math.hypot(this.vx[i], this.vz[i]) || 1;
      const T = bulletTailTuning[look] ?? bulletTailTuning[0];
      const tl = Math.min(T.len * (0.6 + w * 1.2), this.age[i] * sp) * fade;
      const dx = this.vx[i] / sp;
      const dz = this.vz[i] / sp;
      const back = len * 0.35 + tl * 0.5;
      this.m4.compose(this.p.set(x - dx * back, BULLET_Y - 0.02, z - dz * back), this.q, this.s.set(Math.max(0.06, w * T.width * 1.6), 1, Math.max(0.01, tl)));
      this.tail.setMatrixAt(i, this.m4);
      ta[i] = tl > 0.05 ? T.alpha : 0;

      // Extra trail pieces from where it was drawn last frame (cosmetic, capped per frame).
      const lx = this.rx[i];
      const lz = this.rz[i];
      this.rx[i] = x;
      this.rz[i] = z;
      if (lx !== lx || dt <= 0) continue; // NaN: first frame
      if (look === BulletLook.Fire && fire < F.fire) {
        fire++;
        trails.seg(lx, BULLET_Y, lz, x, BULLET_Y, z, w * 1.3, w * 1.7, this.colors[i], 0.2, TrailStyle.Fire);
      } else if (look === BulletLook.Shock && shock < F.shock && Math.random() < 0.35) {
        shock++;
        const a = Math.random() * Math.PI * 2;
        const r = 0.35 + Math.random() * 0.45;
        trails.arc(x, BULLET_Y, z, x + Math.cos(a) * r - dx * 0.4, BULLET_Y + (Math.random() - 0.5) * 0.4, z + Math.sin(a) * r - dz * 0.4, this.colors[i], 0.05, 0.07, 0.12, false);
      } else if ((look === BulletLook.Ribbon || (this.blast[i] > 0 && this.team[i] === Team.Player)) && ribbon < F.ribbon) {
        ribbon++;
        trails.seg(lx, BULLET_Y, lz, x, BULLET_Y, z, w * 0.8, w * 0.9, this.colors[i], 0.26, TrailStyle.Glow);
      }
    }
    this.mesh.count = this.halo.count = this.tail.count = this.count;
    commit(this.mesh.instanceMatrix, this.mesh.count);
    commit(this.tail.instanceMatrix, this.count);
    commit(this.tailAlpha, this.count);
    if (this.mesh.instanceColor) commit(this.mesh.instanceColor, this.mesh.count);
    for (const sm of this.shapeMeshes) {
      sm.halo.count = sm.core.count;
      commit(sm.core.instanceMatrix, sm.core.count);
      if (sm.core.instanceColor) commit(sm.core.instanceColor, sm.core.count);
    }
  }
}
