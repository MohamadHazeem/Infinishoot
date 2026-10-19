import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import { BULLET_Y, Team } from '../bullets';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const TICK = 0.2;
/** Durability an enemy's shove costs, as a share of its contact damage. */
const CONTACT = 0.4;

/**
 * Secondary arm weapon: press to deploy an energy shield that stays up on its
 * own for `dur` seconds, facing your aim. It eats enemy bullets (each costs
 * durability) and slams enemies away; at 0 durability it breaks early. Either
 * way it then recharges for `cd`. Evolutions: Mirror Aegis becomes a golden
 * dome all around you that reflects bullets back at enemies; Pyre Aegis is a
 * blazing wall that sets what it touches on fire (Fire tag from the evolution).
 */
export class Shield extends Weapon {
  private up = 0;
  /** Durability and uptime left (host). */
  private hp = 0;
  private upT = 0;
  /** Durability fraction 0..1, synced for clients. */
  private energy = 1;
  private tickT = 0;
  private hits: Enemy[] = [];
  private group = new THREE.Group();
  private arcMesh: THREE.Mesh;
  /** Curved wall above the ground arc; reads as a shield from the top-down camera. */
  private wall: THREE.Mesh;
  private dome: THREE.Mesh;
  /** Pyre Aegis: flame tongues standing on the wall. */
  private flames = new THREE.Group();
  private flameMats: THREE.MeshBasicMaterial[] = [];
  private flameGeo = new THREE.ConeGeometry(0.1, 1, 4).translate(0, 0.5, 0);
  private flameArc = -1;
  private arcMat: THREE.MeshBasicMaterial;
  private domeMat: THREE.MeshBasicMaterial;
  private builtArc = -1;
  /** Arc in degrees (level + Mega Buster), synced for clients. */
  private arc = 0;

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } as const;
    this.arcMat = new THREE.MeshBasicMaterial({ color: def.color, opacity: 0.7, ...additive });
    this.domeMat = new THREE.MeshBasicMaterial({ color: def.evos![0].color, opacity: 0.6, wireframe: true, ...additive });
    this.arcMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.arcMat);
    this.wall = new THREE.Mesh(new THREE.BufferGeometry(), this.arcMat);
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.domeMat);
    // Solid colours (not additive) so the flame shapes survive the glow pass on bright ground.
    for (const c of ['#ff7a2f', '#ffcd75']) this.flameMats.push(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    this.group.add(this.arcMesh, this.wall, this.dome, this.flames);
    this.group.renderOrder = 2;
    this.group.visible = false;
    scene.add(this.group);
  }

  net(): number[] {
    return [this.up, Math.round(this.energy * 100) / 100, this.arc];
  }
  setNet(a: number[]): void {
    this.up = a[0] ?? 0;
    this.energy = a[1] ?? 1;
    this.arc = a[2] ?? this.p.arc;
  }

  private radius(ctx: WeaponCtx): number {
    return this.p.radius * Math.sqrt(ctx.stats.areaMul);
  }

  /** Is (dx, dz) from the player inside the shield's arc? */
  private inArc(ctx: WeaponCtx, dx: number, dz: number): boolean {
    if (this.arc >= 360) return true;
    const a = Math.atan2(dz, dx) - Math.atan2(ctx.player.aim.z, ctx.player.aim.x);
    return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= (this.arc * Math.PI) / 360;
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    // Mega Buster widens the arc.
    this.arc = Math.min(360, p.arc + 60 * ctx.flags.chargeSplit);
    if (!this.up) {
      this.cd -= dt;
      this.tickReady();
      if (!ctx.charging || pl.dead || this.cd > 0 || ctx.flags.busterDisabled) return;
      this.up = 1;
      this.hp = p.hp;
      this.upT = p.dur;
      this.tickT = 0; // shove whatever is in front right away
      this.armFx(ctx, this.color, 1.2);
      ctx.fx.ring(pl.x, pl.z, 0.6, this.radius(ctx) * 4, this.color, 0.25);
      ctx.sound('shieldUp');
    }
    this.upT -= dt;

    const r = this.radius(ctx);
    // Bullets: blocked, or reflected by the Mirror Aegis (or with Overcharge).
    const reflect = p.reflect > 0 || ctx.flags.overcharge;
    const dmg = p.dmg * ctx.stats.chargeDmg;
    const b = ctx.bullets;
    for (let i = 0; i < b.count && this.hp > 0; i++) {
      if (!(ctx.hostileBullet ? ctx.hostileBullet(i) : b.team[i] === Team.Enemy)) continue;
      const dx = b.x[i] - pl.x;
      const dz = b.z[i] - pl.z;
      const d = Math.hypot(dx, dz);
      if (d > r + 0.3 || !this.inArc(ctx, dx, dz)) continue;
      this.hp -= b.damage[i];
      if (reflect) {
        const sp = Math.max(14, Math.hypot(b.vx[i], b.vz[i]) * 1.5);
        b.team[i] = Team.Player;
        b.vx[i] = (dx / (d || 1)) * sp;
        b.vz[i] = (dz / (d || 1)) * sp;
        b.damage[i] = dmg * 1.5;
        b.knockback[i] = 4;
        b.life[i] = 1;
        b.owner[i] = ctx.owner;
        b.kind[i] = 4;
        b.clearHits(i);
        b.pierce[i] = 1;
        b.blast[i] = 0;
        b.setColor(i, '#ffd23f');
        ctx.fx.star(b.x[i], BULLET_Y, b.z[i], 0.8, this.color, 0.08);
        ctx.sound('block');
      } else {
        ctx.particles.burst(b.x[i], BULLET_Y, b.z[i], { count: 5, color: this.color, color2: '#ffffff', speed: [2, 6], size: [0.1, 0.2], life: [0.1, 0.25] });
        ctx.fx.star(b.x[i], BULLET_Y, b.z[i], 0.7, '#ffffff', 0.08);
        ctx.sound('block');
        b.kill(i--);
      }
    }
    // Enemies touching the shield get hurt and slammed away; each shove wears it down.
    this.tickT -= dt;
    if (this.hp > 0 && this.tickT <= 0) {
      this.tickT = TICK;
      let n = 0;
      for (const e of ctx.inRadius(pl.x, pl.z, r + 0.6, this.hits)) {
        const dx = e.x - pl.x;
        const dz = e.z - pl.z;
        if (!this.inArc(ctx, dx, dz)) continue;
        const d = Math.hypot(dx, dz) || 1;
        const ux = dx / d;
        const uz = dz / d;
        ctx.damage(e, dmg, { source: 'shield', dirX: ux, dirZ: uz, knockback: p.knock, canCrit: true, loud: true });
        this.hp -= e.contactDamage * CONTACT;
        if (n++ < 4) {
          const hx = pl.x + ux * Math.min(d, r);
          const hz = pl.z + uz * Math.min(d, r);
          ctx.fx.ring(hx, hz, 0.3, 1.8, this.color, 0.18);
          ctx.particles.burst(hx, BULLET_Y, hz, { count: 6, color: this.color, color2: '#ffffff', speed: [4, 11], size: [0.12, 0.26], life: [0.12, 0.28], dir: { x: ux, z: uz, spread: 0.9 } });
        }
      }
      if (n) {
        ctx.sound('disc');
        ctx.shake(pl.x, pl.z, 0.12);
      }
      // Pyre Aegis: flames lick along the arc.
      if (this.evoId === 'pyre') {
        const a0 = Math.atan2(pl.aim.z, pl.aim.x);
        const arc = (this.arc * Math.PI) / 180;
        for (let k = 0; k < 3; k++) {
          const a = a0 + (ctx.rng.next() - 0.5) * arc;
          ctx.particles.burst(pl.x + Math.cos(a) * r, 0.5, pl.z + Math.sin(a) * r, { count: 2, color: '#ff7a2f', color2: '#ffcd75', speed: [0.5, 2], size: [0.18, 0.35], life: [0.25, 0.45], up: 3 });
        }
      }
      ctx.hitBarrels(dmg, (bx, bz) => (bx - pl.x) ** 2 + (bz - pl.z) ** 2 < (r + 0.6) ** 2 && this.inArc(ctx, bx - pl.x, bz - pl.z));
    }

    if (this.hp <= 0) {
      // Broken: shatter along the arc.
      const a0 = Math.atan2(pl.aim.z, pl.aim.x);
      const arc = (this.arc * Math.PI) / 180;
      for (let k = 0; k < 6; k++) {
        const a = a0 + (k / 5 - 0.5) * arc;
        ctx.particles.burst(pl.x + Math.cos(a) * r, BULLET_Y, pl.z + Math.sin(a) * r, { count: 5, color: this.color, color2: '#ffffff', speed: [3, 9], size: [0.12, 0.3], life: [0.25, 0.5], up: 3, gravity: 14 });
      }
      ctx.fx.ring(pl.x, pl.z, r, r * 2, '#ffffff', 0.2);
      ctx.sound('freeze');
      ctx.shake(pl.x, pl.z, 0.25);
    }
    this.energy = Math.max(0, this.hp / p.hp);
    if (this.hp <= 0 || this.upT <= 0 || pl.dead || ctx.flags.busterDisabled) {
      this.up = 0;
      this.startCooldown((p.cd * ctx.stats.cooldownMul) / this.rightClickSpeed(ctx));
    } else this.ready = Math.min(this.energy, this.upT / p.dur); // ends at whichever runs out first
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    this.group.visible = this.up > 0 && !pl.dead;
    if (!this.group.visible) return;
    const evo = this.evoId === 'mirror';
    if (this.builtArc !== this.arc) {
      this.builtArc = this.arc;
      const arc = (this.arc * Math.PI) / 180;
      this.arcMesh.geometry.dispose();
      // Centred on +X (the aim direction in the group's frame), lying flat.
      this.arcMesh.geometry = new THREE.RingGeometry(0.6, 1, 24, 1, -arc / 2, arc).rotateX(-Math.PI / 2);
      // Cylinder angles run from +Z toward +X, so centre the wall on +X too.
      this.wall.geometry.dispose();
      this.wall.geometry = new THREE.CylinderGeometry(1, 1, 0.9, 24, 1, true, Math.PI / 2 - arc / 2, arc);
    }
    const r = this.radius(ctx);
    this.group.position.set(pl.rig.root.position.x, BULLET_Y * 0.6, pl.rig.root.position.z);
    this.group.scale.setScalar(r);
    // RingGeometry's angle runs toward -Z after rotateX, so mirror the aim's z.
    this.arcMesh.rotation.y = this.wall.rotation.y = -Math.atan2(pl.aim.z, pl.aim.x) + (evo ? ctx.time * 2 : 0);
    this.wall.scale.y = 1 / r;
    this.arcMat.color.set(this.color);
    const pulse = 0.55 + Math.sin(ctx.time * 25) * 0.1;
    // Flickers when nearly broken.
    const crack = this.energy < 0.3 && Math.sin(ctx.time * 40) < 0 ? 0.4 : 1;
    this.arcMat.opacity = Math.min(1, pulse * 1.4 * (0.4 + 0.6 * this.energy)) * crack;
    this.dome.visible = evo;
    this.dome.position.y = -BULLET_Y * 0.6;
    this.renderFlames(r, ctx.time);
    this.dome.rotation.y = ctx.time * 1.5;
    this.domeMat.opacity = pulse * (0.3 + 0.5 * this.energy);
  }

  /** Pyre Aegis: a fringe of flickering flame tongues licking outward from the shield's edge. */
  private renderFlames(r: number, time: number): void {
    const pyre = this.evoId === 'pyre';
    this.flames.visible = pyre;
    if (!pyre) return;
    if (this.flameArc !== this.arc) {
      this.flameArc = this.arc;
      this.flames.clear();
      const arc = (Math.min(360, this.arc) * Math.PI) / 180;
      const n = Math.max(5, Math.round(arc * 5));
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();
      for (let k = 0; k < n; k++) {
        // Ring angles map to (cos t, -sin t) once the ring is laid flat; match that.
        const t = n > 1 ? (k / (n - 1) - 0.5) * arc : 0;
        const m = new THREE.Mesh(this.flameGeo, this.flameMats[k % 2]);
        m.position.set(Math.cos(t) * 0.95, 0, -Math.sin(t) * 0.95);
        // Cones point along +Y: turn each one to point outward and a little up.
        m.quaternion.setFromUnitVectors(up, dir.set(Math.cos(t), 0.35, -Math.sin(t)).normalize());
        this.flames.add(m);
      }
    }
    this.flames.rotation.y = this.arcMesh.rotation.y;
    this.flames.children.forEach((m, k) => {
      const f = 0.55 + 0.45 * Math.abs(Math.sin(time * 13 + k * 1.7)) + 0.12 * Math.sin(time * 31 + k);
      const w = (k % 2 ? 1.6 : 2.2) / r;
      m.scale.set(w, (f * (k % 2 ? 0.6 : 0.9)) / r, w);
    });
  }

  dispose(): void {
    this.flameGeo.dispose();
    for (const m of this.flameMats) m.dispose();
    this.scene.remove(this.group);
    this.arcMesh.geometry.dispose();
    this.wall.geometry.dispose();
    this.dome.geometry.dispose();
    this.arcMat.dispose();
    this.domeMat.dispose();
  }
}
