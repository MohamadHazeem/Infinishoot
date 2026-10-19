import * as THREE from 'three';
import type { Input } from '../core/input';
import { resolveCircleVsBoxes, type AABB } from '../world/collision';
import { animateHero, applySkin, createHero, newPose, setExpression, type Expression, type HeroRig } from './heroModel';
import type { SkinDef } from '../data/skins';
import { dressHero } from './heroLooks';
import { textures } from '../render/textures';
import { baseStats, type Stats } from './stats';

/**
 * Twin-stick player. Simulation state is 2D (x, z); the hero rig is purely
 * presentation and is interpolated between the last two sim states.
 */
export const playerTuning = {
  maxHp: 100,
  maxSpeed: 7,
  accel: 14, // responsiveness when steering (higher = snappier)
  friction: 18, // stopping speed when no input
  radius: 0.45,
  turnSpeed: 22, // visual facing smoothing
  dashSpeed: 24,
  dashTime: 0.16,
  dashCooldown: 0.7, // once fully trained (team level >= dashTrainedLevel)
  dashCooldownStart: 1.6, // at team level 1
  dashTrainedLevel: 20,
  dashIframesExtra: 0.06, // invulnerability lingers slightly after the dash
  hurtIframes: 0.7,
  maxHitFrac: 0.35, // no single hit takes more than this share of max life
  hurtKnockback: 7,
};

/** Dash cooldown multiplier for the team level: slow at level 1, normal by dashTrainedLevel. */
export function dashLevelMul(level: number): number {
  const t = playerTuning;
  const k = Math.min(1, Math.max(0, (level - 1) / (t.dashTrainedLevel - 1)));
  return t.dashCooldownStart / t.dashCooldown + (1 - t.dashCooldownStart / t.dashCooldown) * k;
}

export class Player {
  readonly pos = { x: 0, z: 0 };
  readonly prev = { x: 0, z: 0 };
  readonly vel = { x: 0, z: 0 };
  /** Aim direction on the XZ plane (unit). */
  readonly aim = { x: 0, z: 1 };
  /** Distance to the aim point (mouse); Infinity when aiming by direction (stick). Lobbed weapons land here. */
  aimDist = Infinity;

  hp = playerTuning.maxHp;
  /** Upgrade-derived stats; the game replaces this object when upgrades change. */
  stats: Stats = baseStats();
  dead = false;
  recoil = 0;
  invuln = 0;
  dashT = 0;
  /** Recharge timer for the next dash charge. */
  dashCd = 0;
  /** Dashes ready to use (Dash Cells raise the max). */
  dashStock = 1;
  private dashX = 0;
  private dashZ = 0;
  private kx = 0;
  private kz = 0;
  hurtFlash = 0;
  /** Co-op: stay visible (lying down) while downed so teammates can revive you. */
  showWhenDead = false;
  private sq = 0;
  private sqV = 0;
  /** Ultimate speed multiplier (Sonic Blitz); 1 = normal. */
  ultSpeed = 1;
  /** Seconds of golden skill glow (perfect dash, parry, ultimate); presentation only. */
  skillGlow = 0;
  /** 0..1 orange heat glow (the Furnace hero standing still); presentation only. */
  heatGlow = 0;
  /** Heroes without a dash (the Duelist parries on the dash key instead). */
  noDash = false;

  readonly rig: HeroRig;
  private shadow: THREE.Mesh;
  private facing = 0;
  private blinkT = 0;
  // Face and pose (presentation only).
  /** Seconds of happy face left (level-ups, evolutions, chests). */
  happyT = 0;
  /** Victory pose (stage cleared). */
  cheer = false;
  /** Charging the buster: determined face. */
  focus = false;
  /** Hero build proportions (width, height). */
  buildScale: [number, number] = [1, 1];
  /** CUSTOMISE code (src/data/customise.ts): colours, accessory, weapon skin. Set before setSkin; synced in hello/start. */
  look = '---00';
  private pose = newPose();
  private hurtT = 0;
  private lastHp = -1;
  private eyeT = 3;

  constructor(
    private scene: THREE.Scene,
    color?: string,
    skin?: SkinDef,
  ) {
    this.rig = createHero(color, skin);
    scene.add(this.rig.root);

    const shadowMat = new THREE.MeshBasicMaterial({
      map: textures.blob(),
      transparent: true,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);
  }

  dispose(): void {
    this.scene.remove(this.rig.root, this.shadow);
    this.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.shadow.geometry.dispose();
  }

  /** Set state from the network: host applying a client's own movement, or a client mirroring a snapshot. */
  netSet(x: number, z: number, vx: number, vz: number, ax: number, az: number, dashing: boolean): void {
    this.prev.x = this.pos.x;
    this.prev.z = this.pos.z;
    this.pos.x = x;
    this.pos.z = z;
    this.vel.x = vx;
    this.vel.z = vz;
    this.setAimDir(ax, az);
    this.dashT = dashing ? Math.max(this.dashT, 0.05) : 0;
  }

  /** Decay timers for a hero whose movement comes from the network (host side). */
  tickTimers(dt: number): void {
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.recoil *= Math.exp(-18 * dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.sqV += (-260 * this.sq - 16 * this.sqV) * dt;
    this.sq += this.sqV * dt;
  }

  /** Give back one dash charge (perfect dash); `all` refills every charge (Sonic Blitz). */
  refundDash(all = false): void {
    this.dashStock = all ? this.dashMax : Math.min(this.dashMax, this.dashStock + 1);
    if (this.dashStock >= this.dashMax) this.dashCd = 0;
  }

  /** Squash-and-stretch kick (negative squashes down). */
  bounce(v: number): void {
    this.sqV += v;
  }

  /** Knockback impulse (client: host told us we got hit). */
  knock(dirX: number, dirZ: number): void {
    this.kx = dirX * playerTuning.hurtKnockback;
    this.kz = dirZ * playerTuning.hurtKnockback;
    this.hurtFlash = 0.15;
    this.sqV -= 6;
  }

  /** Shoved without damage (a Gust Kite's wind): adds to the knockback, which slides ~force/10 m. */
  shove(dirX: number, dirZ: number, force: number): void {
    this.kx += dirX * force;
    this.kz += dirZ * force;
    this.sqV -= 4;
  }

  get radius(): number {
    return playerTuning.radius;
  }
  get x(): number {
    return this.pos.x;
  }
  get z(): number {
    return this.pos.z;
  }
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get dashing(): boolean {
    return this.dashT > 0;
  }
  get dashMax(): number {
    return Math.max(1, Math.round(this.stats.dashCharges));
  }

  private get dashCooldownFull(): number {
    return playerTuning.dashCooldown * this.stats.dashCooldownMul;
  }

  /** 0..1, 1 = a dash is available. */
  get dashReady01(): number {
    return this.dashStock >= 1 ? 1 : 1 - this.dashCd / this.dashCooldownFull;
  }
  get maxHp(): number {
    return this.stats.maxHp;
  }

  heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  reset(stats: Stats): void {
    this.stats = stats;
    this.teleport(0, 0);
    this.hp = stats.maxHp;
    this.recoil = 0;
    this.dead = false;
    this.invuln = 1;
    this.dashT = this.dashCd = 0;
    this.dashStock = this.dashMax;
    this.ultSpeed = 1;
    this.skillGlow = 0;
    this.rig.root.visible = true;
  }

  /** Move instantly (no interpolation smear), e.g. when entering a new stage. */
  teleport(x: number, z: number): void {
    this.pos.x = this.prev.x = x;
    this.pos.z = this.prev.z = z;
    this.vel.x = this.vel.z = this.kx = this.kz = 0;
  }

  /** Muzzle position on the XZ plane (arm buster on the hero's local +X side). */
  muzzle(out: { x: number; z: number }): void {
    out.x = this.pos.x + this.aim.x * 0.85 + this.aim.z * 0.38;
    out.z = this.pos.z + this.aim.z * 0.85 - this.aim.x * 0.38;
  }

  /** Aim at a world point on the ground (mouse) or along a stick direction (pad). */
  setAimPoint(x: number, z: number): void {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const l = Math.hypot(dx, dz);
    if (l > 0.3) {
      this.aim.x = dx / l;
      this.aim.z = dz / l;
    }
    this.aimDist = l;
  }

  /** Where lobbed and called-in weapons land: the cursor, clamped to [min, max]. */
  landDist(min: number, max: number): number {
    return Math.max(min, Math.min(max, this.aimDist));
  }

  setAimDir(x: number, z: number, dist = Infinity): void {
    this.aimDist = dist;
    const l = Math.hypot(x, z);
    if (l > 0) {
      this.aim.x = x / l;
      this.aim.z = z / l;
    }
  }

  /** Returns true when a dash starts this step. */
  /** Ground under the hero this step: slipperiness (0 = normal, 1 = pure ice) and conveyor push. */
  readonly ground = { slip: 0, pushX: 0, pushZ: 0 };

  update(dt: number, input: Input | null, colliders: AABB[], wantDash: boolean): boolean {
    this.prev.x = this.pos.x;
    this.prev.z = this.pos.z;
    if (this.dead) return false;

    const t = playerTuning;
    this.invuln = Math.max(0, this.invuln - dt);
    // Charges refill one at a time.
    if (this.dashStock < this.dashMax) {
      this.dashCd -= dt;
      if (this.dashCd <= 0) {
        this.dashStock++;
        this.dashCd = this.dashStock < this.dashMax ? this.dashCd + this.dashCooldownFull : 0;
      }
    } else {
      this.dashStock = this.dashMax;
      this.dashCd = 0;
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.recoil *= Math.exp(-18 * dt);
    this.sqV += (-260 * this.sq - 16 * this.sqV) * dt;
    this.sq += this.sqV * dt;

    const maxSpeed = t.maxSpeed * this.stats.moveSpeedMul * this.ultSpeed;
    const mx = input ? input.move.x : 0;
    const mz = input ? input.move.y : 0; // screen-down = world +Z (camera has no yaw)
    const hasInput = mx !== 0 || mz !== 0;

    let dashed = false;
    if (wantDash && !this.noDash && this.dashStock >= 1 && this.dashT <= 0) {
      // Dash where you're moving; if standing still, dash toward the aim.
      this.dashX = hasInput ? mx : this.aim.x;
      this.dashZ = hasInput ? mz : this.aim.z;
      const l = Math.hypot(this.dashX, this.dashZ) || 1;
      this.dashX /= l;
      this.dashZ /= l;
      this.dashT = t.dashTime;
      if (this.dashStock >= this.dashMax) this.dashCd = this.dashCooldownFull;
      this.dashStock--;
      this.invuln = Math.max(this.invuln, t.dashTime + t.dashIframesExtra);
      this.sqV -= 7;
      dashed = true;
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vel.x = this.dashX * t.dashSpeed;
      this.vel.z = this.dashZ * t.dashSpeed;
      if (this.dashT <= 0) {
        // Exit the dash carrying normal run speed, not dash speed.
        this.vel.x = this.dashX * maxSpeed;
        this.vel.z = this.dashZ * maxSpeed;
        this.sqV += 5;
      }
    } else {
      const grip = 1 - this.ground.slip * 0.85;
      const k = 1 - Math.exp(-(hasInput ? t.accel : t.friction) * grip * dt);
      this.vel.x += (mx * maxSpeed - this.vel.x) * k;
      this.vel.z += (mz * maxSpeed - this.vel.z) * k;
    }

    const kd = Math.exp(-10 * dt);
    this.kx *= kd;
    this.kz *= kd;
    this.pos.x += (this.vel.x + this.kx + this.ground.pushX) * dt;
    this.pos.z += (this.vel.z + this.kz + this.ground.pushZ) * dt;
    resolveCircleVsBoxes(this.pos, t.radius, colliders);
    return dashed;
  }

  /** Apply damage. Returns false if ignored (i-frames / dead). */
  hurt(damage: number, dirX: number, dirZ: number): boolean {
    if (this.invuln > 0 || this.dead) return false;
    this.hp -= damage;
    this.invuln = playerTuning.hurtIframes;
    this.hurtFlash = 0.15;
    this.kx = dirX * playerTuning.hurtKnockback;
    this.kz = dirZ * playerTuning.hurtKnockback;
    this.sqV -= 6;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.rig.root.visible = this.showWhenDead;
    }
    return true;
  }

  setSkin(armorColor: string, skin: SkinDef): void {
    applySkin(this.rig, armorColor, skin);
    dressHero(this.rig, this.look, armorColor === skin.armor); // CUSTOMISE colours and accessory (graphics lane)
  }

  /** Pick the painted face from what's happening. */
  private updateFace(dt: number): void {
    if (this.lastHp >= 0 && this.hp < this.lastHp - 0.5) this.hurtT = 0.6;
    this.lastHp = this.hp;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.happyT = Math.max(0, this.happyT - dt);
    this.eyeT -= dt;
    if (this.eyeT < -0.12) this.eyeT = 2.5 + Math.random() * 2.5;
    let e: Expression = 'normal';
    if (this.dead) e = 'ko';
    else if (this.hurtT > 0) e = 'hurt';
    else if (this.cheer || this.happyT > 0) e = 'happy';
    else if (this.focus) e = 'focus';
    else if (this.eyeT < 0) e = 'blink';
    setExpression(this.rig, e);
  }

  /** Called every render frame with the interpolation factor. */
  render(alpha: number, frameDt: number): void {
    this.updateFace(frameDt);
    const x = this.prev.x + (this.pos.x - this.prev.x) * alpha;
    const z = this.prev.z + (this.pos.z - this.prev.z) * alpha;
    this.rig.root.position.set(x, 0, z);
    this.shadow.position.set(x, 0.02, z);
    this.shadow.visible = !this.dead;

    // Smoothly turn to face the aim direction (shortest arc).
    const target = Math.atan2(this.aim.x, this.aim.z);
    let diff = target - this.facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.facing += diff * (1 - Math.exp(-playerTuning.turnSpeed * frameDt));
    this.rig.root.rotation.y = this.facing;

    // Pose inputs for the procedural animation (src/game/heroModel.ts).
    const pose = this.pose;
    pose.dt = frameDt;
    pose.vx = this.vel.x / playerTuning.maxSpeed;
    pose.vz = this.vel.z / playerTuning.maxSpeed;
    pose.facing = this.facing;
    pose.recoil = Math.min(1, this.recoil);
    pose.dashing = this.dashing;
    pose.hurtFlash = this.hurtFlash;
    const kl = Math.hypot(this.kx, this.kz);
    if (kl > 0.5) {
      pose.hitX = this.kx / kl;
      pose.hitZ = this.kz / kl;
    } else if (this.hurtFlash <= 0) pose.hitX = pose.hitZ = 0;
    pose.dead = this.dead;
    pose.cheer = this.cheer && !this.dead;
    pose.sq = this.sq;
    [pose.bw, pose.bh] = this.buildScale;
    animateHero(this.rig, pose);

    // Down: the death fall plays, then the hero lies there greyed out (co-op: until revived).
    if (this.dead) {
      this.rig.root.visible = true;
      const grey = Math.min(1, Math.max(0, (this.rig.anim.deathT - 0.6) * 3)) * 0.55;
      for (const m of this.rig.materials) m.uniforms.uFlash.value.set(0.5, 0.5, 0.6, grey);
      return;
    }
    // Blink while invulnerable after a hit (not during dash i-frames).
    const blinking = this.invuln > 0 && !this.dashing && this.hurtFlash <= 0 && this.invuln > playerTuning.dashIframesExtra;
    this.blinkT += frameDt;
    this.rig.root.visible = !blinking || Math.floor(this.blinkT * 16) % 2 === 0;
    this.skillGlow = Math.max(0, this.skillGlow - frameDt);
    // Skill glow: a golden shimmer after a perfect dash or parry, and while an ultimate runs.
    const glow = this.hurtFlash <= 0 && !this.dashing && this.skillGlow > 0 ? 0.25 + 0.2 * Math.sin(this.blinkT * 30) : 0;
    // Furnace heat: a pulsing orange glow that grows while standing still.
    const heat = this.hurtFlash <= 0 && !this.dashing && glow <= 0 && this.heatGlow > 0.05 ? this.heatGlow * (0.32 + 0.12 * Math.sin(this.blinkT * 12)) : 0;
    const fa = this.hurtFlash > 0 ? 0.85 : this.dashing ? 0.35 : glow || heat;
    const [r, g, b] = this.hurtFlash > 0 ? [1, 0.2, 0.3] : glow > 0 ? [1, 0.85, 0.3] : heat > 0 ? [1, 0.42, 0.1] : [0.6, 0.9, 1];
    for (const m of this.rig.materials) m.uniforms.uFlash.value.set(r, g, b, fa);
  }

  /** Interpolated render position (for camera follow). */
  renderPos(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      this.prev.x + (this.pos.x - this.prev.x) * alpha,
      0,
      this.prev.z + (this.pos.z - this.prev.z) * alpha,
    );
  }
}
