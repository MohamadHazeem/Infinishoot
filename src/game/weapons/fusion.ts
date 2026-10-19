import * as THREE from 'three';
import { FUSION_BY_ID, childParams, type FusionDef } from '../../data/fusions';
import { WEAPONS, type WeaponDef } from '../../data/weapons';
import type { Bullets, BulletSpawn } from '../bullets';
import type { Enemy } from '../enemies';
import type { BurstOptions } from '../particles';
import { Weapon, type DamageOpts, type FxApi, type ParticleApi, type WeaponCtx } from './base';
import { Fire } from './fire';

type Make = (id: string, scene: THREE.Scene, def: WeaponDef) => Weapon;

/** Colours that stay as they are when a fusion re-tints its parts' effects (white cores, smoke). */
const KEEP = new Set(['#ffffff', '#e8e8f0', '#f4f4f4']);

/**
 * A fused weapon (src/data/fusions.ts): runs its two parts as children at
 * their evolved strength, through a wrapped WeaponCtx that credits every hit
 * to the fusion (name, tags, damage breakdown, Mods), re-tints their effects
 * in the fusion's colours and adds the rider that links them (zaps, freezes,
 * pops, napalm). Children keep their own net()/setNet(), so clients draw
 * them like any weapon.
 */
export class FusionWeapon extends Weapon {
  readonly fusion: FusionDef;
  readonly parts: Weapon[];
  private fire: Fire | null = null;
  private base: WeaponCtx | null = null;
  private wrapped: WeaponCtx | null = null;
  private zapAt = 0;
  private popAt = 0;
  /** Current tint (Prism Satellites cycle it). */
  private col: string;
  private col2: string;
  private hueStep = -1;
  private c = new THREE.Color();

  constructor(def: WeaponDef, scene: THREE.Scene, make: Make) {
    super(def);
    this.fusion = FUSION_BY_ID[def.id];
    this.col = this.fusion.color;
    this.col2 = this.fusion.color2;
    this.parts = this.fusion.children.map((c) => {
      const part = WEAPONS[c.weapon];
      // The child is stored "partner-evolved" with the fused params, so it wears the fusion's colour.
      const childDef: WeaponDef = { ...part, evolution: { name: this.fusion.name, color: this.fusion.color, passive: '', text: '', p: childParams(part, c) } };
      const w = make(c.weapon, scene, childDef);
      w.level = part.levels.length + 1;
      if (w instanceof Fire) this.fire = w;
      return w;
    });
  }

  get evolved(): boolean {
    return true;
  }
  get name(): string {
    return this.fusion.name;
  }
  get color(): string {
    return this.fusion.color;
  }
  get iconId(): string {
    return this.def.id;
  }

  private tint(c: string | undefined): string | undefined {
    return !c || KEEP.has(c) ? c : this.col;
  }
  private tint2(c: string | undefined): string | undefined {
    return !c || KEEP.has(c) ? c : this.col2;
  }

  /** The children's view of the game: same hero and world, fusion credit, tints and riders. */
  private wrap(b: WeaponCtx): WeaponCtx {
    if (this.base === b && this.wrapped) return this.wrapped;
    this.base = b;
    const f = this.fusion;
    const r = f.rider;
    const fx: FxApi = {
      star: (x, y, z, s, color, life) => b.fx.star(x, y, z, s, this.tint(color), life),
      ring: (x, z, s, g, color, life) => b.fx.ring(x, z, s, g, this.tint(color)!, life),
      scar: (x, z, rr, color, life) => b.fx.scar(x, z, rr, color, life),
    };
    const particles: ParticleApi = {
      burst: (x: number, y: number, z: number, o: BurstOptions) => {
        if (typeof o.color === 'string') o.color = this.tint(o.color)!;
        if (typeof o.color2 === 'string') o.color2 = this.tint2(o.color2)!;
        b.particles.burst(x, y, z, o);
      },
    };
    const spawn = (s: BulletSpawn) => {
      s.kind = f.bulletKind;
      s.color = f.color;
      b.bullets.spawn(s);
    };
    const bullets =
      f.bulletKind === undefined
        ? b.bullets
        : (new Proxy(b.bullets, {
            get: (t, k) => {
              if (k === 'spawn') return spawn;
              const v = (t as unknown as Record<string | symbol, unknown>)[k];
              return typeof v === 'function' ? v.bind(t) : v;
            },
          }) as Bullets);
    const w = Object.create(b) as WeaponCtx;
    Object.defineProperties(w, {
      fx: { value: fx },
      particles: { value: particles },
      bullets: { value: bullets },
      damage: {
        value: (e: Enemy, base: number, o: DamageOpts) => {
          const from = o.source;
          o.source = f.id;
          o.tags = f.tags;
          const dealt = b.damage(e, base, o);
          this.rider(w, b, e, base, from);
          return dealt;
        },
      },
      blast: {
        value: (x: number, z: number, rad: number, base: number, _color: string, source: string) => {
          b.blast(x, z, rad, base, this.col, f.id, f.tags);
          if (r.napalm && r.napalm.on === source && this.fire) {
            this.fire.drop(x, z, r.napalm.life, r.napalm.radius * b.stats.areaMul);
          }
          if (r.blastZap && r.blastZap.on === source) {
            const e = b.nearest(x, z, rad);
            if (e) {
              b.fx.ring(x, z, 0.6, rad * 2.2, f.color2, 0.25);
              b.zap(e, r.blastZap.hops, r.blastZap.dmg);
            }
          }
        },
      },
    });
    this.wrapped = w;
    return w;
  }

  /** The rider: what a part's hit does on top (zaps, freezes, pops). */
  private rider(w: WeaponCtx, b: WeaponCtx, e: Enemy, base: number, from: string): void {
    const r = this.fusion.rider;
    if (!e.active || e.hp <= 0) return;
    const t = b.time;
    if (r.freeze && r.freeze.on === from) {
      e.frozen = Math.max(e.frozen, r.freeze.time * (e.def.boss ? 0.15 : 1));
      e.shatter = Math.max(e.shatter, r.freeze.shatter);
    }
    if (r.zap && r.zap.on === from && t >= this.zapAt && b.rng.next() < r.zap.chance) {
      this.zapAt = t + r.zap.gap;
      b.zap(e, r.zap.hops, r.zap.dmg);
    }
    if (r.pop && r.pop.on === from && t >= this.popAt && b.rng.next() < r.pop.chance) {
      this.popAt = t + r.pop.gap;
      const rad = r.pop.radius * b.stats.areaMul;
      w.fx.star(e.x, 1, e.z, 1.4, this.col2, 0.12);
      b.blast(e.x, e.z, rad, base * r.pop.mul, this.col2, this.fusion.id, this.fusion.tags);
    }
  }

  update(dt: number, ctx: WeaponCtx): void {
    const w = this.wrap(ctx);
    for (const p of this.parts) p.update(dt, w);
  }

  /** Prism Satellites: walk the hue with the run clock and re-skin the parts 8 times a second (cosmetic, every machine). */
  private cycle(time: number): void {
    const step = Math.floor(time * 8);
    if (step === this.hueStep) return;
    this.hueStep = step;
    const h = step / 32;
    this.col = '#' + this.c.setHSL(h % 1, 1, 0.62).getHexString();
    this.col2 = '#' + this.c.setHSL((h + 0.5) % 1, 1, 0.7).getHexString();
    for (const p of this.parts) (p as unknown as { applyLook(c: string | null): void }).applyLook(this.col);
  }

  /** Each child's state, length-prefixed. */
  net(): number[] {
    const out: number[] = [];
    for (const p of this.parts) {
      const a = p.net();
      out.push(a.length, ...a);
    }
    return out;
  }
  setNet(a: number[]): void {
    let k = 0;
    for (const p of this.parts) {
      const n = a[k] ?? 0;
      p.setNet(a.slice(k + 1, k + 1 + n));
      k += 1 + n;
    }
  }

  render(alpha: number, ctx: WeaponCtx): void {
    const w = this.wrap(ctx);
    if (this.fusion.rider.prism) this.cycle(ctx.time);
    for (const p of this.parts) p.draw(alpha, w);
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
  }
}
