import * as THREE from 'three';
import type { WeaponDef } from '../../data/weapons';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';

/** Electric field around the player: periodic damage (and slow at higher levels). */
export class Aura extends Weapon {
  private disc: THREE.Mesh;
  private edge: THREE.Mesh;
  private discMat: THREE.MeshBasicMaterial;
  private edgeMat: THREE.MeshBasicMaterial;
  private group = new THREE.Group();
  private hits: Enemy[] = [];
  private pulse = 0;

  constructor(def: WeaponDef, private scene: THREE.Scene) {
    super(def);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false } as const;
    this.discMat = new THREE.MeshBasicMaterial({ color: '#1a6f78', opacity: 0.35, ...additive });
    this.edgeMat = new THREE.MeshBasicMaterial({ color: '#3de0c8', opacity: 0.9, ...additive });
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), this.discMat);
    this.edge = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 40).rotateX(-Math.PI / 2), this.edgeMat);
    this.disc.position.y = 0.07;
    this.edge.position.y = 0.08;
    this.group.add(this.disc, this.edge);
    this.group.renderOrder = 2;
    scene.add(this.group);
  }

  protected applyLook(c: string | null): void {
    this.edgeMat.color.set(c ?? '#3de0c8');
    this.discMat.color.set(c ? new THREE.Color(c).multiplyScalar(0.45) : '#1a6f78');
  }

  private radius(ctx: WeaponCtx): number {
    return this.p.radius * ctx.stats.areaMul;
  }

  net(): number[] {
    return [Math.round(this.pulse * 100) / 100];
  }
  setNet(a: number[]): void {
    this.pulse = a[0] ?? 0;
  }

  update(dt: number, ctx: WeaponCtx): void {
    if (ctx.player.dead) return;
    this.pulse = Math.max(0, this.pulse - dt * 4);
    const p = this.p;
    const r = this.radius(ctx);
    const pl = ctx.player;
    // Slow applies continuously; damage on each tick.
    if (p.slow > 0) {
      for (const e of ctx.inRadius(pl.x, pl.z, r, this.hits)) {
        e.slowT = 0.15;
        e.slowAmt = Math.max(e.slowAmt, p.slow);
      }
    }
    if (!this.tick(dt, ctx, p.tick)) return;
    this.pulse = 1;
    let n = 0;
    for (const e of ctx.inRadius(pl.x, pl.z, r, this.hits)) {
      const d = Math.hypot(e.x - pl.x, e.z - pl.z) || 1;
      ctx.damage(e, p.dmg, { source: 'aura', dirX: (e.x - pl.x) / d, dirZ: (e.z - pl.z) / d, knockback: 1.5, canCrit: true, loud: n < 3 });
      if (n++ < 6) ctx.fx.star(e.x, 0.9, e.z, 0.6, '#3de0c8', 0.08);
    }
    if (n > 0) ctx.sound('zap');
  }

  render(_alpha: number, ctx: WeaponCtx): void {
    const pl = ctx.player;
    this.group.visible = !pl.dead;
    const r = this.radius(ctx);
    this.group.position.set(pl.rig.root.position.x, 0, pl.rig.root.position.z);
    this.group.scale.setScalar(r * (1 + this.pulse * 0.05));
    this.edge.rotation.y = ctx.time * 2;
    this.discMat.opacity = 0.22 + this.pulse * 0.25 + Math.sin(ctx.time * 20) * 0.04;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.disc.geometry.dispose();
    this.edge.geometry.dispose();
    this.discMat.dispose();
    this.edgeMat.dispose();
  }
}
