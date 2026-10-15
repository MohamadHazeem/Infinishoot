import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

const MAX_SEGMENTS = 1600;
const BOLT_LIFE = 0.16;

interface Bolt {
  pts: number[]; // x,y,z triples of the jagged path
  t: number;
}

/** Chain lightning: strikes the nearest enemy and arcs between nearby ones. */
export class Lightning extends Weapon {
  private bolts: Bolt[] = [];
  private lines: THREE.LineSegments;
  private positions: Float32Array;
  private mat: THREE.LineBasicMaterial;
  private chained = new Set<number>();

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    this.positions = new Float32Array(MAX_SEGMENTS * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.LineBasicMaterial({ color: '#fff9b0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    scene.add(this.lines);
  }

  protected applyLook(c: string | null): void {
    this.mat.color.set(c ?? '#fff9b0');
  }

  /** Bolts as [count, len, ...points, len, ...points]. */
  net(): number[] {
    const out: number[] = [this.bolts.length];
    for (const b of this.bolts) out.push(b.pts.length, ...b.pts.map((v) => Math.round(v * 100) / 100));
    return out;
  }
  setNet(a: number[]): void {
    this.bolts = [];
    let k = 1;
    for (let n = 0; n < (a[0] ?? 0); n++) {
      const len = a[k++];
      this.bolts.push({ pts: a.slice(k, k + len), t: BOLT_LIFE });
      k += len;
    }
  }

  update(dt: number, ctx: WeaponCtx): void {
    for (const b of this.bolts) b.t -= dt;
    this.bolts = this.bolts.filter((b) => b.t > 0);
    if (ctx.player.dead) return;
    const p = this.p;
    if (!this.tick(dt, ctx, p.cd)) return;
    const pl = ctx.player;
    let fired = false;
    for (let b = 0; b < p.bolts; b++) {
      this.chained.clear();
      // First target: nearest not already struck by another bolt this volley.
      let cur: Enemy | null = ctx.nearest(pl.x, pl.z, p.range, (e) => this.chained.has(e.uid));
      if (b > 0) cur = ctx.nearest(pl.x + (Math.random() - 0.5) * 8, pl.z + (Math.random() - 0.5) * 8, p.range, (e) => this.chained.has(e.uid));
      if (!cur) break;
      fired = true;
      const pts: number[] = [];
      let fx = pl.x;
      let fy = 2.2;
      let fz = pl.z;
      const superc = ctx.combos.has('superconductor');
      for (let c = 0; c <= p.chains + ctx.flags.chainBonus + (superc ? 2 : 0) && cur; c++) {
        const target: Enemy = cur;
        this.chained.add(target.uid);
        this.jag(pts, fx, fy, fz, target.x, 0.9, target.z);
        const d = Math.hypot(target.x - fx, target.z - fz) || 1;
        ctx.damage(target, p.dmg * (superc && target.frozen > 0 ? 2 : 1), { source: 'lightning', dirX: (target.x - fx) / d, dirZ: (target.z - fz) / d, knockback: 3, canCrit: true, loud: true });
        ctx.fx.star(target.x, 0.9, target.z, 1.2, '#fff35c', 0.1);
        fx = target.x;
        fy = 0.9;
        fz = target.z;
        cur = ctx.nearest(fx, fz, p.hop, (e) => this.chained.has(e.uid));
      }
      this.bolts.push({ pts, t: BOLT_LIFE });
    }
    if (fired) ctx.sound('zap');
  }

  /** Jagged path between two points, appended as line-segment pairs. */
  private jag(out: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const steps = 6;
    let px = x0;
    let py = y0;
    let pz = z0;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const j = i === steps ? 0 : 0.45;
      const x = x0 + (x1 - x0) * k + (Math.random() - 0.5) * j;
      const y = y0 + (y1 - y0) * k + (Math.random() - 0.5) * j * 0.5;
      const z = z0 + (z1 - z0) * k + (Math.random() - 0.5) * j;
      out.push(px, py, pz, x, y, z);
      px = x;
      py = y;
      pz = z;
    }
  }

  render(): void {
    let n = 0;
    for (const b of this.bolts) {
      for (let i = 0; i < b.pts.length && n < this.positions.length; i++) this.positions[n++] = b.pts[i];
    }
    this.lines.geometry.setDrawRange(0, n / 3);
    (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.mat.opacity = 0.75 + Math.random() * 0.25;
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose();
    this.mat.dispose();
  }
}
