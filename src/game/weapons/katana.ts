import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import { Team } from '../bullets';
import type { Enemy } from '../enemies';
import { bossLike } from '../bossRules';
import { heroes3Tuning, inSwordArc, nextComboStep, swingShape, swingWaves } from '../heroes3';
import { commit } from '../../render/instancing';
import { Weapon, type WeaponCtx } from './base';

const R = heroes3Tuning.ronin;
const MAX_WAVES = 24;
const WAVE_HITS = 12;
const SEGS = 18;
const now = () => performance.now() / 1000;

/**
 * The Ronin's left click: a 3-hit sword combo while fire is held. Hits 1 and
 * 2 sweep an arc in front (alternating sides), the third is a heavy cleave
 * with more reach, a wider arc, bigger knockback and a stagger. Swings cut
 * enemy bullets out of the air. Sword Waves ranks make swings throw a
 * crescent that flies on and cuts through crowds (range for a melee hero).
 * Evolutions: Tempest Blade (every swing throws a big, far wave) and Crimson
 * Edge (longer, wider, burning swings; the cleave goes all the way round).
 *
 * Network: [seq, step, angle, reach, arc, ...waves (x, z, angle, size)].
 * Every machine draws the slash trail from `seq` changes.
 */
export class Katana extends Weapon {
  private swingCd = 0;
  private idle = 9;
  /** Combo step of the last swing: 0, 1 or 2 (the cleave); -1 before the first. */
  step = -1;
  /** Swings so far (the trail starts when it changes). */
  seq = 0;
  /** Aim angle, reach and arc of the last swing. */
  angle = 0;
  reach = 2.6;
  arc = 130;
  /** Enemies the cleave hit this step (the system plays its hit-stop). */
  cleaveHits = 0;
  /** Any swing that hit this step (camera kick). */
  hits = 0;
  // Sword waves (simulated on the host, mirrored on clients).
  private wx = new Float32Array(MAX_WAVES);
  private wz = new Float32Array(MAX_WAVES);
  private wa = new Float32Array(MAX_WAVES);
  private wt = new Float32Array(MAX_WAVES);
  private wl = new Float32Array(MAX_WAVES);
  private wd = new Float32Array(MAX_WAVES);
  private ws = new Float32Array(MAX_WAVES);
  private wh = new Int32Array(MAX_WAVES * WAVE_HITS);
  private wn = new Uint8Array(MAX_WAVES);
  private waveN = 0;
  private netAt = 0;
  private remote = false;
  private scratch: Enemy[] = [];
  // Drawing
  private trail: THREE.Mesh;
  private core: THREE.Mesh;
  private waveMesh: THREE.InstancedMesh;
  private geoCache = new Map<number, [THREE.BufferGeometry, THREE.BufferGeometry]>();
  private drawnSeq = 0;
  private swingAt = -9;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const mat = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const [g0, g1] = this.geos(130);
    this.trail = new THREE.Mesh(g0, mat('#73eff7', 0.55));
    this.core = new THREE.Mesh(g1, mat('#ffffff', 0.95));
    // A crescent: a thick arc segment, flat on the ground.
    const crescent = new THREE.RingGeometry(0.55, 1, 10, 1, -1.1, 2.2).rotateX(-Math.PI / 2);
    this.waveMesh = new THREE.InstancedMesh(crescent, mat('#f4f4f4', 0.85), MAX_WAVES);
    // Always "visible" (an empty draw range when idle) so their shaders compile at run start, not on the first swing.
    for (const m of [this.trail, this.core, this.waveMesh]) {
      m.frustumCulled = false;
      m.renderOrder = 2;
      scene.add(m);
    }
    g0.setDrawRange(0, 0);
    g1.setDrawRange(0, 0);
    this.waveMesh.count = 0;
  }

  /** Trail geometries for an arc (outer colour band, inner white edge), built once per arc. */
  private geos(arcDeg: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
    const key = Math.round(arcDeg / 5) * 5;
    let g = this.geoCache.get(key);
    if (!g) {
      const len = (Math.min(360, key) * Math.PI) / 180;
      // Built from -half to +half; segments run in angle order so drawRange can sweep it.
      g = [new THREE.RingGeometry(0.35, 0.9, SEGS, 1, -len / 2, len).rotateX(-Math.PI / 2), new THREE.RingGeometry(0.9, 1, SEGS, 1, -len / 2, len).rotateX(-Math.PI / 2)];
      this.geoCache.set(key, g);
    }
    return g;
  }

  get evoColor(): string {
    const e = this.evoId;
    return e === 'tempest' ? '#73eff7' : e === 'crimson' ? '#ff5e3a' : '#f4f4f4';
  }

  net(): number[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const out = [this.seq, this.step, r2(this.angle), r2(this.reach), Math.round(this.arc)];
    for (let i = 0; i < this.waveN; i++) out.push(r2(this.wx[i]), r2(this.wz[i]), r2(this.wa[i]), r2(this.ws[i]));
    return out;
  }
  setNet(a: number[]): void {
    this.remote = true;
    this.seq = a[0] ?? 0;
    this.step = a[1] ?? -1;
    this.angle = a[2] ?? 0;
    this.reach = a[3] ?? 2.6;
    this.arc = a[4] ?? 130;
    this.waveN = 0;
    for (let k = 5; k + 3 < a.length && this.waveN < MAX_WAVES; k += 4) {
      const i = this.waveN++;
      this.wx[i] = a[k];
      this.wz[i] = a[k + 1];
      this.wa[i] = a[k + 2];
      this.ws[i] = a[k + 3];
    }
    this.netAt = now();
  }

  update(dt: number, ctx: WeaponCtx): void {
    this.cleaveHits = this.hits = 0;
    this.idle += dt;
    this.swingCd -= dt;
    this.updateWaves(dt, ctx);
    const pl = ctx.player;
    if (!ctx.firing || pl.dead || ctx.flags.busterDisabled || pl.dashing) {
      this.swingCd = Math.max(this.swingCd, 0);
      return;
    }
    if (this.swingCd > 0) return;
    this.step = nextComboStep(this.step, this.idle);
    this.idle = 0;
    this.seq = (this.seq + 1) % 1000;
    const interval = ctx.stats.cooldownMul / Math.max(0.5, this.p.rate);
    this.swingCd += interval * (this.step === 2 ? R.cleaveRecover : 1);
    if (this.swingCd < 0) this.swingCd = 0;
    this.swing(ctx, this.step);
  }

  private swing(ctx: WeaponCtx, k: number): void {
    const pl = ctx.player;
    const p = this.p;
    const crimson = this.evoId === 'crimson';
    const mega = this.megaShot(ctx); // Hair Trigger: a MEGA swing
    const shape = swingShape(p, k, ctx.stats.areaMul, crimson);
    const reach = shape.reach * (mega ? 1.5 : 1);
    const arc = shape.arc;
    const a0 = Math.atan2(pl.aim.z, pl.aim.x);
    this.angle = a0;
    this.reach = reach;
    this.arc = arc;
    const dmg = p.dmg * shape.mul * (mega ? 3 : 1);
    const cleave = k === 2;
    const knock = p.knock * (cleave ? R.cleaveKnock : 1);
    let n = 0;
    for (const e of ctx.inRadius(pl.x, pl.z, reach, this.scratch).slice()) {
      const dx = e.x - pl.x;
      const dz = e.z - pl.z;
      if (!inSwordArc(dx, dz, e.radius, a0, arc, reach)) continue;
      const d = Math.hypot(dx, dz) || 1;
      ctx.damage(e, dmg, { source: 'katana', dirX: dx / d, dirZ: dz / d, knockback: knock, hx: e.x - (dx / d) * e.radius, hz: e.z - (dz / d) * e.radius, canCrit: true, loud: n < 3 });
      // Hit reaction: a squash, and the cleave staggers (heavy slow) anything that isn't a boss.
      e.squash(cleave ? -9 : -5);
      if (cleave && e.active && !bossLike(e)) {
        e.slowT = Math.max(e.slowT, R.cleaveStagger);
        e.slowAmt = Math.max(e.slowAmt, 0.85);
      }
      n++;
    }
    this.hits = n;
    if (cleave) this.cleaveHits = n;
    // Cut enemy bullets out of the air.
    const b = ctx.bullets;
    let cut = 0;
    for (let i = 0; i < b.count; i++) {
      if (b.team[i] !== Team.Enemy) continue;
      if (!inSwordArc(b.x[i] - pl.x, b.z[i] - pl.z, b.radius[i], a0, arc, reach)) continue;
      if (cut++ < 3) ctx.fx.star(b.x[i], 1, b.z[i], 0.7, '#ffffff', 0.08);
      b.kill(i--);
    }
    ctx.hitBarrels(dmg, (x, z) => inSwordArc(x - pl.x, z - pl.z, 0.6, a0, arc, reach));
    // Sparks flung along the blade's path.
    const side = this.seq % 2 ? 1 : -1;
    const ta = a0 + side * (Math.PI / 2);
    const color = this.evoColor === '#f4f4f4' ? '#73eff7' : this.evoColor;
    ctx.particles.burst(pl.x + Math.cos(a0) * reach * 0.7, 1, pl.z + Math.sin(a0) * reach * 0.7, { count: cleave ? 10 : 5, color, color2: '#ffffff', speed: [5, 11], size: [0.08, 0.18], life: [0.08, 0.2], dir: { x: Math.cos(ta), z: Math.sin(ta), spread: 0.7 } });
    if (cleave) {
      ctx.fx.ring(pl.x, pl.z, reach * 0.5, reach * 2.1, color, 0.18);
      if (n > 0) ctx.shake(pl.x, pl.z, 0.18);
    }
    ctx.sound(cleave ? 'swordCombo' : 'swordSlash');
    pl.recoil = Math.max(pl.recoil, cleave ? 1.6 : 1);
    if (swingWaves(p.wave, k)) this.throwWave(ctx, a0, p.dmg * p.waveDmg * (cleave ? 1.4 : 1) * (mega ? 3 : 1));
  }

  private throwWave(ctx: WeaponCtx, a: number, dmg: number): void {
    if (this.waveN >= MAX_WAVES) return;
    const pl = ctx.player;
    const i = this.waveN++;
    const tempest = this.evoId === 'tempest';
    this.wx[i] = pl.x + Math.cos(a) * 1.2;
    this.wz[i] = pl.z + Math.sin(a) * 1.2;
    this.wa[i] = a;
    this.wt[i] = 0;
    this.wl[i] = R.waveLife * (tempest ? 2 : 1);
    this.wd[i] = dmg;
    this.ws[i] = this.p.waveSize * Math.sqrt(ctx.stats.areaMul);
    this.wn[i] = 0;
  }

  private updateWaves(dt: number, ctx: WeaponCtx): void {
    const b = ctx.bullets;
    const speed = R.waveSpeed * (this.evoId === 'tempest' ? 1.25 : 1);
    for (let i = 0; i < this.waveN; i++) {
      this.wt[i] += dt;
      if (this.wt[i] >= this.wl[i] || this.wn[i] >= R.waveHits) {
        this.removeWave(i--);
        continue;
      }
      const ca = Math.cos(this.wa[i]);
      const sa = Math.sin(this.wa[i]);
      this.wx[i] += ca * speed * dt;
      this.wz[i] += sa * speed * dt;
      const x = this.wx[i];
      const z = this.wz[i];
      const w = R.waveWidth * this.ws[i];
      for (const e of ctx.inRadius(x, z, w, this.scratch)) {
        if (this.wn[i] >= R.waveHits) break;
        if (this.waveHit(i, e.uid)) continue;
        this.wh[i * WAVE_HITS + Math.min(WAVE_HITS - 1, this.wn[i]++)] = e.uid;
        ctx.damage(e, this.wd[i], { source: 'katana', dirX: ca, dirZ: sa, knockback: 5, hx: e.x, hz: e.z, canCrit: true, loud: this.wn[i] <= 2 });
      }
      // Waves cut enemy bullets too.
      for (let k = 0; k < b.count; k++) {
        if (b.team[k] !== Team.Enemy) continue;
        const dx = b.x[k] - x;
        const dz = b.z[k] - z;
        if (dx * dx + dz * dz < w * w) b.kill(k--);
      }
    }
  }

  private waveHit(i: number, uid: number): boolean {
    const n = Math.min(WAVE_HITS, this.wn[i]);
    for (let k = 0; k < n; k++) if (this.wh[i * WAVE_HITS + k] === uid) return true;
    return false;
  }

  private removeWave(i: number): void {
    const j = --this.waveN;
    if (i === j) return;
    this.wx[i] = this.wx[j];
    this.wz[i] = this.wz[j];
    this.wa[i] = this.wa[j];
    this.wt[i] = this.wt[j];
    this.wl[i] = this.wl[j];
    this.wd[i] = this.wd[j];
    this.ws[i] = this.ws[j];
    this.wn[i] = this.wn[j];
    for (let k = 0; k < WAVE_HITS; k++) this.wh[i * WAVE_HITS + k] = this.wh[j * WAVE_HITS + k];
  }

  /** Seconds since the last swing started (render clock). */
  get swingAge(): number {
    return now() - this.swingAt;
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    const t = now();
    if (this.seq !== this.drawnSeq) {
      this.drawnSeq = this.seq;
      this.swingAt = t;
    }
    const age = t - this.swingAt;
    const show = !pl.dead && age < 0.22 && pl.rig.root.visible;
    if (!show) {
      this.trail.geometry.setDrawRange(0, 0);
      this.core.geometry.setDrawRange(0, 0);
    } else {
      const [g0, g1] = this.geos(this.arc);
      this.trail.geometry = g0;
      this.core.geometry = g1;
      // The blade sweeps across in 0.08 s (drawRange reveals the arc in angle order), then the trail fades.
      const sweep = Math.min(1, age / 0.08);
      const segs = Math.max(1, Math.ceil(sweep * SEGS));
      const side = this.seq % 2 ? 1 : -1;
      const cleave = this.step === 2;
      for (const m of [this.trail, this.core]) {
        const g = m.geometry;
        // Sweep from one side: mirrored swings reveal from the other end.
        g.setDrawRange(side > 0 ? 0 : (SEGS - segs) * 6, segs * 6);
        m.position.set(pl.rig.root.position.x, cleave ? 0.7 : 0.95, pl.rig.root.position.z);
        m.rotation.set(0, -this.angle, 0);
        m.scale.set(this.reach, 1, this.reach);
        const fade = age < 0.08 ? 1 : 1 - (age - 0.08) / 0.14;
        (m.material as THREE.MeshBasicMaterial).opacity = (m === this.core ? 0.95 : 0.55) * Math.max(0, fade);
      }
      (this.trail.material as THREE.MeshBasicMaterial).color.set(this.evoColor === '#f4f4f4' ? '#73eff7' : this.evoColor);
    }
    // Waves: crescents facing their flight; clients extrapolate between snapshots.
    const ext = this.remote ? Math.min(0.1, t - this.netAt) : 0;
    const speed = R.waveSpeed * (this.evoId === 'tempest' ? 1.25 : 1);
    let n = 0;
    for (let i = 0; i < this.waveN; i++) {
      const a = this.wa[i];
      const sc = this.ws[i] * R.waveWidth;
      this.q.setFromAxisAngle(this.up, -a);
      this.m4.compose(this.v.set(this.wx[i] + Math.cos(a) * speed * ext, 0.8, this.wz[i] + Math.sin(a) * speed * ext), this.q, this.s.set(sc, 1, sc));
      this.waveMesh.setMatrixAt(n++, this.m4);
    }
    this.waveMesh.count = n;
    (this.waveMesh.material as THREE.MeshBasicMaterial).color.set(this.evoColor);
    commit(this.waveMesh.instanceMatrix, n);
    this.poseArm(ctx, age);
  }

  /** The sword arm sweeps across with the swing; the cleave twists the whole body. */
  private poseArm(ctx: WeaponCtx, age: number): void {
    const rig = ctx.player.rig;
    if (ctx.player.dead || age > 0.3) return;
    const side = this.seq % 2 ? 1 : -1;
    const half = Math.min(Math.PI * 0.9, (this.arc * Math.PI) / 360);
    const k = Math.min(1, age / 0.08);
    const ease = 1 - (1 - k) * (1 - k);
    const back = age > 0.16 ? Math.min(1, (age - 0.16) / 0.14) : 0;
    const yaw = (side * half * (1 - 2 * ease)) * (1 - back);
    rig.armR.rotation.order = 'YXZ';
    rig.armR.rotation.y = yaw - 0.35;
    rig.armR.rotation.x = -Math.PI / 2 + 0.25;
    if (this.step === 2) rig.body.rotation.y += yaw * 0.45;
  }

  dispose(): void {
    for (const m of [this.trail, this.core, this.waveMesh]) {
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.waveMesh.geometry.dispose();
    for (const [a, b] of this.geoCache.values()) {
      a.dispose();
      b.dispose();
    }
  }
}
