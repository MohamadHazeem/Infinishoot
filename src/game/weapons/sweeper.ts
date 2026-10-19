import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const MAX_BEAMS = 4;
const TICK = 0.1;

/**
 * Laser Sweep (auto weapon, id 'sweeper'): every cooldown, one or more beams sweep an arc that starts
 * aimed at the nearest enemy. Everything the beam crosses is hit every tick.
 */
export class Sweeper extends Weapon {
  private beams: THREE.Mesh[] = [];
  private mat: THREE.MeshBasicMaterial;
  private core: THREE.MeshBasicMaterial;
  private cores: THREE.Mesh[] = [];
  /** Sweep state: time left, start angle, and the sweep's direction. */
  private t = 0;
  private dur = 0;
  private a0 = 0;
  private dirSign = 1;
  private tickT = 0;
  private hits: Enemy[] = [];
  private len = 0;
  private wid = 0;

  constructor(
    def: WeaponDef,
    private scene: THREE.Scene,
  ) {
    super(def);
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    this.mat = new THREE.MeshBasicMaterial({ color: '#ff3d5a', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    this.core = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < MAX_BEAMS; i++) {
      const b = new THREE.Mesh(geo, this.mat);
      const c = new THREE.Mesh(geo, this.core);
      b.visible = c.visible = false;
      b.renderOrder = c.renderOrder = 3;
      scene.add(b, c);
      this.beams.push(b);
      this.cores.push(c);
    }
  }

  protected applyLook(c: string | null): void {
    this.mat.color.set(c ?? '#ff3d5a');
  }

  /** Current angle of beam `i`. */
  private angle(i: number, n: number): number {
    const p = this.p;
    const arc = THREE.MathUtils.degToRad(p.arc);
    const k = this.dur > 0 ? 1 - this.t / this.dur : 0;
    return this.a0 + this.dirSign * (k - 0.5) * arc + (i / n) * Math.PI * 2;
  }

  net(): number[] {
    if (this.t <= 0) return [0];
    const n = this.p.beams;
    const out = [n, Math.round(this.len * 10) / 10, Math.round(this.wid * 100) / 100];
    for (let i = 0; i < n; i++) out.push(Math.round(this.angle(i, n) * 1000) / 1000);
    return out;
  }

  private netAngles: number[] = [];
  setNet(a: number[]): void {
    const n = a[0] ?? 0;
    this.t = n > 0 ? 1 : 0;
    this.len = a[1] ?? 0;
    this.wid = a[2] ?? 0;
    this.netAngles = a.slice(3, 3 + n);
  }

  update(dt: number, ctx: WeaponCtx): void {
    const p = this.p;
    const pl = ctx.player;
    if (this.t > 0) {
      this.t -= dt;
      this.tickT -= dt;
      if (this.tickT <= 0) {
        this.tickT = TICK;
        this.len = p.range * Math.sqrt(ctx.stats.areaMul);
        this.wid = p.width * Math.sqrt(ctx.stats.areaMul);
        for (let i = 0; i < p.beams; i++) this.burn(ctx, this.angle(i, p.beams));
      }
      return;
    }
    if (pl.dead || !this.tick(dt, ctx, p.cd)) return;
    const e = ctx.nearest(pl.x, pl.z, p.range + 2);
    if (!e) {
      this.cd = 0.3;
      return;
    }
    this.a0 = Math.atan2(e.x - pl.x, e.z - pl.z);
    this.dirSign = ctx.rng.next() < 0.5 ? -1 : 1;
    this.t = this.dur = p.sweep;
    this.tickT = 0;
    ctx.sound('sweeper');
  }

  /** Damage everything along one beam. */
  private burn(ctx: WeaponCtx, a: number): void {
    const pl = ctx.player;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const mx = pl.x + dx * this.len * 0.5;
    const mz = pl.z + dz * this.len * 0.5;
    for (const e of ctx.inRadius(mx, mz, this.len * 0.5 + 1, this.hits)) {
      const rx = e.x - pl.x;
      const rz = e.z - pl.z;
      const along = rx * dx + rz * dz;
      if (along < 0 || along > this.len) continue;
      const side = Math.abs(rx * dz - rz * dx);
      if (side > this.wid * 0.5 + e.radius) continue;
      ctx.damage(e, this.p.dmg, { source: 'sweeper', dirX: dx, dirZ: dz, knockback: 1.5, canCrit: true });
    }
  }

  render(alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    const on = this.t > 0 && !pl.dead;
    const n = on ? (this.netAngles.length || this.p.beams) : 0;
    const x = pl.rig.root.position.x;
    const z = pl.rig.root.position.z;
    const flick = 0.85 + Math.random() * 0.3;
    for (let i = 0; i < MAX_BEAMS; i++) {
      const b = this.beams[i];
      const c = this.cores[i];
      b.visible = c.visible = i < n;
      if (i >= n) continue;
      const a = this.netAngles.length ? this.netAngles[i] : this.angle(i, n);
      b.position.set(x, 1.0, z);
      c.position.set(x, 1.0, z);
      b.rotation.set(0, a, 0);
      c.rotation.set(0, a, 0);
      b.scale.set(this.wid * flick, 0.25, this.len);
      c.scale.set(this.wid * 0.35, 0.12, this.len);
    }
    void alpha;
  }

  dispose(): void {
    for (const m of [...this.beams, ...this.cores]) this.scene.remove(m);
    this.beams[0]?.geometry.dispose();
    this.mat.dispose();
    this.core.dispose();
  }
}
