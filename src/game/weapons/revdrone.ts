import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../../render/retroMaterial';
import { paint } from '../../render/geometry';
import { Weapon, type WeaponCtx } from './base';

const now = () => performance.now() / 1000;

/** Drone modes. */
export const DroneMode = { Idle: 0, Flying: 1, Reviving: 2, Shield: 3 } as const;

/**
 * The Medic's right click: a revive drone. A press asks for a launch (`req`);
 * src/game/systems/heroes4.ts decides what it does, because only the Game knows
 * the team: fly to the downed teammate closest to the cursor (in range) and
 * pick them up after `reviveTime` s hovering, or, with nobody down, shield the
 * living teammate at the cursor (else the Medic) from the next `hits` hits for
 * `shieldTime` s. The system moves the drone and spends the shield
 * (src/game/systems/statuses.ts hurtHero -> heroes4HitCare).
 * Evolutions: Guardian Drone (blocked hits zap the attacker; Shock) and Phoenix
 * Drone (full-life revives, a healing fire burst).
 *
 * Network: [mode, x, z, bubble x, bubble z, progress, shield hits].
 */
export class RevDrone extends Weapon {
  mode: number = DroneMode.Idle;
  /** Hero index the drone serves. */
  target = -1;
  x = 0;
  z = 0;
  /** Shield bubble centre (the shielded hero). */
  bx = 0;
  bz = 0;
  /** Revive progress 0..1. */
  prog = 0;
  hits = 0;
  shieldT = 0;
  /** A press this step that wants a launch (the system answers it). */
  req = false;
  private wasHeld = false;
  // Drawing
  private root = new THREE.Group();
  private tether: THREE.Mesh;
  private bubble: THREE.Mesh;
  private ring: THREE.Mesh;
  private dx = 0;
  private dz = 0;
  private drawn = false;

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    this.cd = 0;
    // One vertex-coloured mesh (one draw call): a white body with a red cross on top, a cyan eye,
    // a mint belly light, four arms and dark rotor discs (they read as spinning blades from above).
    const part = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => paint((g.index ? g.toNonIndexed() : g).translate(x, y, z), color);
    const parts = [
      part(new THREE.BoxGeometry(0.5, 0.22, 0.5), '#f4f4f4', 0, 0, 0),
      part(new THREE.BoxGeometry(0.3, 0.04, 0.09), '#b13e53', 0, 0.13, 0),
      part(new THREE.BoxGeometry(0.09, 0.04, 0.3), '#b13e53', 0, 0.13, 0),
      part(new THREE.BoxGeometry(0.2, 0.08, 0.04), '#73eff7', 0, 0.01, 0.26),
      part(new THREE.OctahedronGeometry(0.11, 0), '#a7f070', 0, -0.16, 0),
    ];
    for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) {
      parts.push(part(new THREE.BoxGeometry(0.06, 0.05, 0.06), '#566c86', x * 0.7, 0.08, z * 0.7));
      parts.push(part(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 8), '#333c57', x, 0.14, z));
    }
    const body = new THREE.Mesh(mergeGeometries(parts)!, createRetroMaterial({ vertexColors: true }));
    for (const g of parts) g.dispose();
    this.root.add(body);
    const glow = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.tether = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.18, 1, 6, 1, true).translate(0, -0.5, 0), glow('#a7f070', 0.55));
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), glow('#73eff7', 0.18));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 24, 1).rotateX(-Math.PI / 2), glow('#a7f070', 0.6));
    for (const o of [this.root, this.tether, this.bubble, this.ring]) {
      o.frustumCulled = false;
      o.visible = false;
      scene.add(o);
    }
    this.bubble.renderOrder = this.ring.renderOrder = 2;
  }

  get evoColor(): string {
    const e = this.evoId;
    return e === 'guardian' ? '#ffcd75' : e === 'phoenix' ? '#ef7d57' : '#a7f070';
  }

  /** Busy flying to or reviving someone. */
  get busy(): boolean {
    return this.mode === DroneMode.Flying || this.mode === DroneMode.Reviving;
  }

  net(): number[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return [this.mode, r2(this.x), r2(this.z), r2(this.bx), r2(this.bz), r2(this.prog), this.hits];
  }
  setNet(a: number[]): void {
    this.mode = a[0] ?? 0;
    this.x = a[1] ?? 0;
    this.z = a[2] ?? 0;
    this.bx = a[3] ?? 0;
    this.bz = a[4] ?? 0;
    this.prog = a[5] ?? 0;
    this.hits = a[6] ?? 0;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.cd -= dt;
    this.tickReady();
    const pl = ctx.player;
    const press = ctx.charging && !this.wasHeld;
    this.wasHeld = ctx.charging;
    this.req = press && !pl.dead && !ctx.flags.busterDisabled && this.cd <= 0 && !this.busy;
    if (this.mode === DroneMode.Shield) {
      this.shieldT -= dt;
      if (this.shieldT <= 0 || this.hits <= 0) this.endShield(ctx);
    }
    if (this.mode === DroneMode.Idle) {
      // Parked over the Medic's shoulder.
      this.x = pl.x - pl.aim.x * 0.6 + pl.aim.z * 0.5;
      this.z = pl.z - pl.aim.z * 0.6 - pl.aim.x * 0.5;
    }
  }

  /** Off to pick up a downed teammate. */
  launchRevive(target: number, ctx: WeaponCtx): void {
    this.mode = DroneMode.Flying;
    this.target = target;
    this.prog = 0;
    this.startCooldown(this.p.cd / this.rightClickSpeed(ctx));
    this.armFx(ctx, this.evoColor, 0.8);
    ctx.sound('drone');
  }

  /** Shield a hero. */
  launchShield(target: number, ctx: WeaponCtx): void {
    this.mode = DroneMode.Shield;
    this.target = target;
    this.hits = Math.round(this.p.hits);
    this.shieldT = this.p.shieldTime;
    this.startCooldown(this.p.shieldCd / this.rightClickSpeed(ctx));
    this.armFx(ctx, '#73eff7', 0.7);
    ctx.sound('shieldUp');
  }

  /** Done (revived, shield spent or timed out): fly home. */
  endShield(ctx: WeaponCtx | null): void {
    if (this.mode === DroneMode.Shield && ctx) ctx.fx.ring(this.bx, this.bz, 0.6, 2.2, '#73eff7', 0.2);
    this.mode = DroneMode.Idle;
    this.target = -1;
    this.hits = 0;
    this.prog = 0;
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    const t = now();
    const show = !pl.dead || this.mode !== DroneMode.Idle;
    this.root.visible = show && pl.rig.root.visible !== false;
    this.tether.visible = this.mode === DroneMode.Reviving;
    this.bubble.visible = this.mode === DroneMode.Shield;
    this.ring.visible = this.mode === DroneMode.Reviving;
    if (!show) {
      this.drawn = false;
      return;
    }
    // Glide toward the synced spot (smooth on clients and between steps).
    if (!this.drawn) {
      this.dx = this.x;
      this.dz = this.z;
      this.drawn = true;
    }
    const k = Math.min(1, 0.35);
    this.dx += (this.x - this.dx) * k;
    this.dz += (this.z - this.dz) * k;
    const bob = Math.sin(t * 6) * 0.08;
    const y = (this.mode === DroneMode.Idle ? 1.9 : 2.2) + bob;
    this.root.position.set(this.dx, y, this.dz);
    this.root.rotation.set(0, t * (this.mode === DroneMode.Flying ? 6 : 1.2), Math.sin(t * 3) * 0.08);
    if (this.mode === DroneMode.Reviving) {
      // A green tether down to the downed teammate, and a ring that closes as the revive completes.
      this.tether.position.set(this.dx, y - 0.1, this.dz);
      this.tether.scale.set(1 + Math.sin(t * 12) * 0.2, y - 0.2, 1 + Math.sin(t * 12) * 0.2);
      (this.tether.material as THREE.MeshBasicMaterial).color.set(this.evoColor);
      const r = 1.8 - this.prog * 1.2;
      this.ring.position.set(this.bx, 0.08, this.bz);
      this.ring.scale.set(r, 1, r);
      this.ring.rotation.y = t * 2;
      (this.ring.material as THREE.MeshBasicMaterial).color.set(this.evoColor);
    }
    if (this.mode === DroneMode.Shield) {
      const s = 1.15 + Math.sin(t * 7) * 0.04;
      this.bubble.position.set(this.bx, 0.9, this.bz);
      this.bubble.scale.set(s, s * 1.1, s);
      (this.bubble.material as THREE.MeshBasicMaterial).opacity = (this.hits > 1 ? 0.22 : 0.12) + Math.sin(t * 9) * 0.04;
      (this.bubble.material as THREE.MeshBasicMaterial).color.set(this.evoId === 'guardian' ? '#ffcd75' : '#73eff7');
    }
  }

  dispose(): void {
    this.scene.remove(this.root, this.tether, this.bubble, this.ring);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    for (const m of [this.tether, this.bubble, this.ring]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
