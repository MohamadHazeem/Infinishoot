import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import { Team } from '../bullets';
import type { Enemy } from '../enemies';
import { heroes3Tuning, iaidoStrike, segDist } from '../heroes3';
import { Weapon, type WeaponCtx } from './base';

const R = heroes3Tuning.ronin;
const now = () => performance.now() / 1000;
/** A strike may start this share of the recharge early (a client's `ready` arrives rounded and late). */
const READY_SLACK = 0.06;

/**
 * The Ronin's right click: hold to focus (0..1), release to dash-strike along
 * your aim. Everything the dash passes through takes a light cut and is marked;
 * a beat after the dash ends every marked enemy is cut again, hard (more focus:
 * further, harder). The hero is invulnerable while dashing.
 *
 * Movement belongs to whoever moves the hero: the weapon raises `lunge` and
 * src/game/systems/heroes3.ts dashes local heroes; a client dashes its own hero
 * (`predict`) and the host sweeps the path the client reports.
 * Evolutions: Phantom Step (the afterimage cuts again, kills refund recharge),
 * Raijin Strike (the cut chains lightning, Shock).
 *
 * Network: [focus, cutSeq, sx, sz, ex, ez].
 */
export class Iaido extends Weapon {
  /** 0..1 focus while held (host); up to 1.3 with Overcharge. */
  focus = 0;
  /** Client: its own hero's focus, predicted from its own input. */
  predFocus = 0;
  /** A strike wants the hero to dash (consumed by systems/heroes3.ts for local heroes). */
  readonly lunge = { want: false, dirX: 0, dirZ: 0, time: 0, speed: R.dashSpeed };
  /** Hit-stop the system should play this step (s). */
  stopReq = 0;
  private strikeT = 0;
  private lx = 0;
  private lz = 0;
  private sdx = 1;
  private sdz = 0;
  private passMul = 0;
  private cutMul = 0;
  private hitE: Enemy[] = [];
  private hitUid: number[] = [];
  private cutT = -1;
  private phantomT = -1;
  private extraCuts = 0;
  private scratch: Enemy[] = [];
  private sparkT = 0;
  // The cut line (net + drawing)
  cutSeq = 0;
  private sx = 0;
  private sz = 0;
  private ex = 0;
  private ez = 0;
  private line: THREE.Mesh;
  private glow: THREE.Mesh;
  private drawnSeq = 0;
  private cutAt = -9;

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    this.cd = 0; // ready from the start
    const mat = (color: string) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide });
    // A thin bright slash along the dash path (unit long on +X).
    this.line = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.22).rotateX(-Math.PI / 2).translate(0.5, 0, 0), mat('#ffffff'));
    // Focus glow at the blade while held.
    this.glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), mat('#ffcd75'));
    // Always "visible" (an empty draw range when idle) so their shaders compile at run start.
    for (const m of [this.line, this.glow]) {
      m.frustumCulled = false;
      m.renderOrder = 2;
      m.geometry.setDrawRange(0, 0);
      scene.add(m);
    }
  }

  get evoColor(): string {
    const e = this.evoId;
    return e === 'phantom' ? '#c4b8ff' : e === 'raijin' ? '#fff35c' : '#ffcd75';
  }

  net(): number[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return [r2(this.focus), this.cutSeq, r2(this.sx), r2(this.sz), r2(this.ex), r2(this.ez)];
  }
  setNet(a: number[]): void {
    this.focus = a[0] ?? 0;
    this.cutSeq = a[1] ?? 0;
    this.sx = a[2] ?? 0;
    this.sz = a[3] ?? 0;
    this.ex = a[4] ?? 0;
    this.ez = a[5] ?? 0;
  }

  private focusRate(ctx: WeaponCtx): number {
    return this.rightClickSpeed(ctx) / Math.max(0.15, this.p.time);
  }

  /**
   * Client: its own Ronin's dash, predicted from its own right click (the host
   * judges the damage). Returns the dash distance on release, else 0.
   */
  predict(dt: number, holding: boolean): number {
    if (holding) {
      this.predFocus = Math.min(1, this.predFocus + dt / Math.max(0.15, this.p.time));
      return 0;
    }
    const f = this.predFocus;
    this.predFocus = 0;
    // The host lets a strike through a little before the recharge ends (`READY_SLACK`), so the client may too.
    return f >= R.focusMin && this.ready >= 0.95 ? iaidoStrike(this.p, f).dist : 0;
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.cd -= dt;
    this.tickReady();
    this.stopReq = 0;
    this.lunge.want = false;
    const pl = ctx.player;
    const blocked = pl.dead || ctx.flags.busterDisabled;
    // Focus builds while held, even while recharging (like holding the Charge Shot); the strike needs the recharge done.
    if (ctx.charging && !blocked && this.strikeT <= 0) {
      const max = ctx.flags.overcharge ? 1.3 : 1;
      const before = this.focus;
      this.focus = Math.min(max, this.focus + dt * this.focusRate(ctx) * (this.focus >= 1 ? 0.5 : 1));
      if (before < 1 && this.focus >= 1) {
        ctx.sound('chargeFull');
        ctx.fx.ring(pl.x, pl.z, 0.5, 2.4, this.evoColor, 0.2);
      }
      if ((this.sparkT -= dt) <= 0) {
        this.sparkT = 0.09;
        const m = { x: 0, z: 0 };
        pl.muzzle(m);
        ctx.particles.burst(m.x, 1.05, m.z, { count: 1 + Math.round(this.focus * 2), color: this.evoColor, color2: '#ffffff', speed: [0.5, 2], size: [0.08, 0.16], life: [0.1, 0.2], up: 1.5, drag: 4 });
      }
    } else if (this.focus > 0) {
      if (this.focus >= R.focusMin && !blocked && this.cd <= READY_SLACK * this.cdMax && this.strikeT <= 0) this.start(ctx);
      this.focus = 0;
    }
    if (this.strikeT > 0) {
      this.strikeT -= dt;
      this.sweep(ctx);
      if (this.strikeT <= 0) {
        this.ex = pl.x;
        this.ez = pl.z;
        this.cutT = R.cutDelay;
      }
    }
    if (this.cutT >= 0 && (this.cutT -= dt) < 0) {
      this.cut(ctx, 1);
      if (this.evoId === 'phantom') this.phantomT = R.phantomDelay;
      else if (this.extraCuts > 0) this.phantomT = R.phantomDelay;
    }
    if (this.phantomT >= 0 && (this.phantomT -= dt) < 0) {
      this.cut(ctx, R.phantomDmg);
      if (--this.extraCuts > 0) this.phantomT = R.phantomDelay;
      else this.hitE.length = this.hitUid.length = 0;
    }
  }

  private start(ctx: WeaponCtx): void {
    const pl = ctx.player;
    const p = this.p;
    const f = Math.min(1, this.focus);
    const st = iaidoStrike(p, f);
    const over = this.focus > 1.05 ? 1.3 : 1; // Overcharge: a deeper focus cuts harder
    this.passMul = st.pass * over;
    this.cutMul = st.cut * over;
    this.extraCuts = ctx.flags.chargeSplit; // Split Shot Mods: the afterimage cuts again
    const l = Math.hypot(pl.aim.x, pl.aim.z) || 1;
    this.sdx = pl.aim.x / l;
    this.sdz = pl.aim.z / l;
    const time = st.dist / R.dashSpeed;
    Object.assign(this.lunge, { want: true, dirX: this.sdx, dirZ: this.sdz, time, speed: R.dashSpeed });
    // The sweep window outlasts the dash a little: a remote hero's path arrives late.
    this.strikeT = time + 0.2;
    this.lx = this.sx = pl.x;
    this.lz = this.sz = pl.z;
    this.hitE.length = this.hitUid.length = 0;
    this.cutT = this.phantomT = -1;
    this.startCooldown(p.cd / this.rightClickSpeed(ctx));
    ctx.sound('swordDash');
    ctx.fx.ring(pl.x, pl.z, 0.5, 3, this.evoColor, 0.2);
    ctx.particles.burst(pl.x, 0.6, pl.z, { count: 10, color: '#f4f4f4', color2: this.evoColor, speed: [2, 6], size: [0.15, 0.3], life: [0.2, 0.4], dir: { x: -this.sdx, z: -this.sdz, spread: 0.8 }, drag: 3 });
  }

  /** Cut everything between the last position and the hero's current one. */
  private sweep(ctx: WeaponCtx): void {
    const pl = ctx.player;
    const ax = this.lx;
    const az = this.lz;
    const bx = pl.x;
    const bz = pl.z;
    this.lx = bx;
    this.lz = bz;
    const w = this.p.width * Math.sqrt(ctx.stats.areaMul);
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const half = Math.hypot(bx - ax, bz - az) / 2;
    const dmg = this.p.dmg * this.passMul * ctx.stats.chargeDmg;
    let n = 0;
    for (const e of ctx.inRadius(mx, mz, half + w, this.scratch)) {
      if (this.hitE.includes(e) || segDist(e.x, e.z, ax, az, bx, bz) > w + e.radius) continue;
      this.hitE.push(e);
      this.hitUid.push(e.uid);
      // Pushed aside, off the path.
      const side = (e.x - pl.x) * -this.sdz + (e.z - pl.z) * this.sdx >= 0 ? 1 : -1;
      ctx.damage(e, dmg, { source: 'iaido', dirX: -this.sdz * side, dirZ: this.sdx * side, knockback: 9, hx: e.x, hz: e.z, canCrit: true, loud: n++ < 2 });
      e.squash(-6);
      ctx.fx.star(e.x, 1, e.z, 0.9, '#ffffff', 0.08);
    }
    const b = ctx.bullets;
    for (let i = 0; i < b.count; i++) if (b.team[i] === Team.Enemy && segDist(b.x[i], b.z[i], ax, az, bx, bz) < w + b.radius[i]) b.kill(i--);
    ctx.hitBarrels(dmg, (x, z) => segDist(x, z, ax, az, bx, bz) < w + 0.5);
    if (half > 0.05) ctx.particles.burst(mx, 0.9, mz, { count: 2, color: '#f4f4f4', color2: this.evoColor, speed: [0.3, 1.2], size: [0.25, 0.45], life: [0.12, 0.22], drag: 6 });
  }

  /** The delayed cut on everything the dash marked. */
  private cut(ctx: WeaponCtx, mul: number): void {
    this.cutSeq = (this.cutSeq + 1) % 1000;
    const dmg = this.p.dmg * this.cutMul * mul * ctx.stats.chargeDmg;
    const raijin = this.evoId === 'raijin';
    let n = 0;
    let kills = 0;
    for (let i = 0; i < this.hitE.length; i++) {
      const e = this.hitE[i];
      if (!e.active || e.uid !== this.hitUid[i] || e.hp <= 0) continue;
      ctx.damage(e, dmg, { source: 'iaido', dirX: this.sdx, dirZ: this.sdz, knockback: 6, hx: e.x, hz: e.z, canCrit: true, loud: n < 4 });
      if (n < 6) {
        ctx.fx.star(e.x, 1.1, e.z, 1.6, n % 2 ? this.evoColor : '#ffffff', 0.12);
        ctx.particles.burst(e.x, 1, e.z, { count: 4, color: '#ffffff', color2: this.evoColor, speed: [6, 12], size: [0.06, 0.14], life: [0.06, 0.14], dir: { x: this.sdz, z: -this.sdx, spread: 0.3 } });
      }
      n++;
      if (raijin && e.active && e.hp > 0) ctx.zap(e, R.raijinHops, dmg * R.raijinDmg);
      if (!e.active || e.hp <= 0) kills++;
    }
    if (kills > 0 && this.evoId === 'phantom') this.cd = Math.max(0, this.cd - this.cdMax * R.phantomRefund * kills);
    if (n > 0) {
      this.stopReq = R.cutStop;
      ctx.sound('swordCombo');
      ctx.shake(this.ex, this.ez, Math.min(0.5, 0.15 + n * 0.04));
    }
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    const t = now();
    if (this.cutSeq !== this.drawnSeq) {
      this.drawnSeq = this.cutSeq;
      this.cutAt = t;
    }
    const age = t - this.cutAt;
    const len = Math.hypot(this.ex - this.sx, this.ez - this.sz);
    const show = age < 0.3 && len > 0.3;
    this.line.geometry.setDrawRange(0, show ? Infinity : 0);
    if (show) {
      this.line.position.set(this.sx, 1, this.sz);
      this.line.rotation.set(0, -Math.atan2(this.ez - this.sz, this.ex - this.sx), 0);
      const k = age < 0.05 ? age / 0.05 : 1 - (age - 0.05) / 0.25;
      this.line.scale.set(len, 1, 0.4 + 1.6 * Math.max(0, k));
      const m = this.line.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, k);
      m.color.set(age < 0.08 ? '#ffffff' : this.evoColor);
    }
    // Focus: a glinting star at the blade tip that grows while held.
    const f = Math.max(this.focus, this.predFocus);
    const glowOn = f > 0.05 && !pl.dead;
    this.glow.geometry.setDrawRange(0, glowOn ? Infinity : 0);
    if (glowOn) {
      const m = { x: 0, z: 0 };
      pl.muzzle(m);
      const ox = pl.rig.root.position.x - pl.x;
      const oz = pl.rig.root.position.z - pl.z;
      this.glow.position.set(m.x + ox + pl.aim.x * 0.9, 1.05, m.z + oz + pl.aim.z * 0.9);
      const s = 0.6 + f * 1.2 + (f >= 1 ? Math.sin(t * 30) * 0.25 : 0);
      this.glow.scale.setScalar(s);
      this.glow.rotation.y = t * 8;
      (this.glow.material as THREE.MeshBasicMaterial).color.set(f >= 1 ? '#ffffff' : this.evoColor);
    }
  }

  dispose(): void {
    for (const m of [this.line, this.glow]) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
