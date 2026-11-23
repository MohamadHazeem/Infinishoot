import * as THREE from 'three';
import {
  Afterheat,
  CORES,
  CORE_COLOR,
  Crossfeed,
  Concussion,
  FRAME,
  FRAMES,
  Induction,
  MODIFIERS,
  Ratchet,
  Sight,
  Standing,
  Thermal,
  craftInteractions,
  craftTuning,
  type Part,
  type Recipe,
} from '../../data/craftParts';
import type { Tag } from '../../data/tags';
import { newBuild } from '../../data/tracks';
import type { WeaponDef } from '../../data/weapons';
import { craftEn } from '../../i18n/g5craft';
import { freezeMul } from '../bossRules';
import type { Enemy } from '../enemies';
import { Weapon, type WeaponCtx } from './base';
import { WeaponBatch, segmentDistanceSq, compactWeaponNet } from './weapons3Shared';

declare module './base' {
  interface WeaponCtx {
    craftPartner?(tag: Tag): boolean;
  }
}
const noPartner = () => false;
const colorBare = '#94b0c2';
const pulse = () => ({
  active: false,
  landed: false,
  fromX: 0,
  fromZ: 0,
  x: 0,
  z: 0,
  toX: 0,
  toZ: 0,
  age: 0,
  delay: 0,
  repeat: false,
  offset: 0,
  radius: 0,
  power: 0,
  mask: 0,
  target: null as Enemy | null,
  uid: -1,
  warnedUid: -1,
  warnX: 0,
  warnZ: 0,
});
type Pulse = ReturnType<typeof pulse>;
const POOL = 16;

export class Crafted extends Weapon {
  // Build-bearing weapons use buildKey for snapshots, migrations and PvP rebuilds.
  // The three sockets replace the usual rank ladder.
  override readonly build = newBuild(this.def);
  recipe: Recipe = { frame: 'projector', core: null, mod: null };
  discoveries = 0;
  private key = '';
  private elements: Tag[] = [];
  private pulses = Array.from({ length: POOL }, pulse);
  private batch: WeaponBatch;
  private hits: Enemy[] = [];
  private arcs: Enemy[] = [];
  private opts = { source: 'crafted', canCrit: true, loud: false };
  private angle = 0;
  private mirrored = false;
  private excludeUid = -1;
  private skipLast = (e: Enemy) => e.uid === this.excludeUid;

  constructor(def: WeaponDef, scene: THREE.Scene) {
    super(def);
    this.batch = new WeaponBatch(scene, new THREE.BoxGeometry(1, 1, 1), POOL * 2);
    this.configure(this.recipe);
  }
  configure(recipe: Recipe): void {
    this.recipe = { ...recipe };
    this.elements = [FRAME[recipe.frame].tag];
    if (recipe.core && !this.elements.includes(recipe.core)) this.elements.push(recipe.core);
    if (recipe.mod === 'linger' && !this.elements.includes('trail')) this.elements.push('trail');
    this.level = 1 + Number(!!recipe.core) + Number(!!recipe.mod);
    for (const p of this.pulses) p.active = false;
    this.cacheKey();
  }
  private cacheKey(): void {
    const r = this.recipe;
    this.key = [r.frame, r.core ?? '', r.mod ?? '', this.discoveries].join('/');
  }
  override get buildKey(): string {
    return this.key;
  }
  override setBuildKey(key: string): void {
    if (this.key === key || typeof key !== 'string') return;
    const [f, c, m, mask] = key.split('/');
    const frame = FRAMES.find((v) => v === f);
    if (!frame) return;
    this.discoveries = (Number(mask) | 0) & 255;
    this.configure({
      frame,
      core: CORES.find((v) => v === c) ?? null,
      mod: MODIFIERS.find((v) => v === m) ?? null,
    });
  }
  override get tags(): readonly Tag[] {
    return this.elements;
  }
  override get maxed(): boolean {
    return true;
  } // no XP or chest levels
  override get name(): string {
    return craftEn[`craft.${this.recipe.frame}`];
  }
  override get color(): string {
    return this.recipe.core ? CORE_COLOR[this.recipe.core] : colorBare;
  }
  get description(): string {
    return [this.recipe.frame, this.recipe.core, this.recipe.mod]
      .filter((v): v is Part => !!v)
      .map((id) => craftEn[`craft.${id}`])
      .join(' · ');
  }

  update(dt: number, ctx: WeaponCtx): void {
    // A promoted client starts fresh volleys. Snapshot transforms carry no hit intent.
    if (this.mirrored) {
      for (const p of this.pulses) p.active = false;
      this.mirrored = false;
    }
    if (ctx.player.dead) return;
    const r = this.recipe,
      frame = FRAME[r.frame];
    this.angle = (this.angle + dt * 3) % (Math.PI * 2);
    this.cd -= dt;
    if (this.cd <= 0) {
      const mask = craftInteractions(r, ctx.craftPartner ?? noPartner);
      const reach = frame.reach * (mask & Sight ? 1.2 : 1);
      const target = ctx.nearest(ctx.player.x, ctx.player.z, reach);
      this.cd = target ? frame.cd * ctx.stats.cooldownMul * (mask & Ratchet ? 0.88 : 1) : 0.12;
      if (target) {
        this.launch(ctx, target, mask, r.mod === 'split' ? -1 : 0, reach);
        if (r.mod === 'split') this.launch(ctx, target, mask, 1, reach);
        ctx.sound(r.frame === 'beam' ? 'beam' : r.frame === 'lobber' ? 'lob' : 'drone');
      }
    }
    for (const p of this.pulses) {
      if (!p.active) continue;
      p.age += dt;
      if (!p.landed) {
        const k = Math.min(1, p.age / p.delay);
        if (!p.repeat) this.steer(p, ctx, k);
        if (p.age >= p.delay) {
          p.landed = true;
          this.impact(p, ctx);
        }
      } else if (p.age > p.delay + 0.12) p.active = false;
    }
  }

  private launch(ctx: WeaponCtx, target: Enemy, mask: number, offset: number, reach: number): void {
    const p = this.pulses.find(freePulse);
    if (!p) return;
    const { frame, core, mod } = this.recipe,
      f = FRAME[frame],
      pl = ctx.player;
    const dx = target.x - pl.x,
      dz = target.z - pl.z,
      len = Math.hypot(dx, dz) || 1;
    p.active = true;
    p.landed = false;
    p.repeat = false;
    p.age = 0;
    p.mask = mask;
    p.offset = offset;
    p.fromX = p.x = pl.x;
    p.fromZ = p.z = pl.z;
    const dist = frame === 'beam' ? reach : len;
    p.toX = pl.x + (dx * dist - dz * offset * 1.2) / len;
    p.toZ = pl.z + (dz * dist + dx * offset * 1.2) / len;
    p.target = target;
    p.uid = target.uid;
    p.delay =
      frame === 'lobber'
        ? 0.48
        : frame === 'projector'
          ? Math.max(0.08, len / 32)
          : frame === 'orbiter'
            ? 0.26
            : 0.09;
    p.radius =
      f.radius *
      ctx.stats.areaMul *
      (core === 'explosive' ? 1.4 : 1) *
      (mask & Standing ? 1.2 : 1) *
      (mask & Concussion ? 1.25 : 1);
    const power = core && mod ? 1 : core || mod ? craftTuning.corePower : craftTuning.barePower;
    this.warnDuelTarget(p, target, ctx);
    if (frame === 'lobber' && p.warnedUid < 0)
      ctx.fx.ring(p.toX, p.toZ, p.radius * 2, 0.3, this.color, p.delay);
    p.power =
      craftTuning.damage * f.power * power * (offset ? 0.65 : 1) * (mask & Crossfeed ? 1.12 : 1);
  }

  // Duel stand-ins can be hit only inside their own announced mark. This also
  // prevents an unannounced splash or chain from tagging a second player.
  private warnDuelTarget(p: Pulse, target: Enemy | null, ctx: WeaponCtx): void {
    p.warnedUid = -1;
    if (!target || target.pvpOwner < 0) return;
    p.warnedUid = target.uid;
    p.warnX = target.x;
    p.warnZ = target.z;
    p.delay = Math.max(p.delay, 0.6);
    ctx.fx.ring(p.warnX, p.warnZ, 4, 0.98, '#ffcd75', p.delay);
  }

  private steer(p: Pulse, ctx: WeaponCtx, k: number): void {
    const r = this.recipe,
      pl = ctx.player;
    const track =
      r.mod === 'home' && p.target?.uid === p.uid && p.target.targetable && p.warnedUid < 0;
    if (track && p.target) {
      p.toX = p.target.x;
      p.toZ = p.target.z;
    }
    if (r.frame === 'field' || r.frame === 'orbiter') {
      const orbit = r.frame === 'orbiter' ? 4.1 : p.offset ? 1.7 : 0;
      const a = this.angle + p.offset * 1.4;
      p.x = pl.x + Math.cos(a) * orbit;
      p.z = pl.z + Math.sin(a) * orbit;
      if (track) {
        p.x += (p.toX - p.x) * 0.6;
        p.z += (p.toZ - p.z) * 0.6;
      }
    } else {
      p.x = p.fromX + (p.toX - p.fromX) * k;
      p.z = p.fromZ + (p.toZ - p.fromZ) * k;
    }
  }

  private strike(ctx: WeaponCtx, e: Enemy, amount: number, p: Pulse): boolean {
    if (!e.targetable || e.hp <= 0) return false;
    if (
      e.pvpOwner >= 0 &&
      (p.warnedUid !== e.uid || (e.x - p.warnX) ** 2 + (e.z - p.warnZ) ** 2 > 4)
    )
      return false;
    const thermal = !!(p.mask & Thermal) && e.exposeT > 0;
    if (ctx.damage(e, amount * (thermal ? 1.3 : 1), this.opts) <= 0) return false;
    if (thermal) this.discoveries |= Thermal;
    if (this.recipe.core === 'frost' && e.active && e.shield <= 0)
      e.frozen = Math.max(e.frozen, 0.24 * freezeMul(e));
    return true;
  }

  private impact(p: Pulse, ctx: WeaponCtx): void {
    const { frame, core, mod } = this.recipe;
    const beam = frame === 'beam' && !p.repeat;
    const line = beam || (mod === 'pierce' && !p.repeat);
    const ax = beam ? p.fromX : p.x,
      az = beam ? p.fromZ : p.z;
    let bx = p.x,
      bz = p.z;
    if (mod === 'pierce') {
      const dx = p.x - p.fromX,
        dz = p.z - p.fromZ,
        l = Math.hypot(dx, dz);
      bx += (l ? dx / l : ctx.player.aim.x) * 4;
      bz += (l ? dz / l : ctx.player.aim.z) * 4;
    }
    const len = Math.hypot(bx - ax, bz - az);
    ctx.inRadius((ax + bx) / 2, (az + bz) / 2, len / 2 + p.radius, this.hits);
    const previous = this.discoveries;
    let first: Enemy | null = null;
    for (const e of this.hits) {
      if (line && segmentDistanceSq(e.x, e.z, ax, az, bx, bz) > (p.radius + e.radius) ** 2)
        continue;
      if (this.strike(ctx, e, p.power, p)) first ??= e;
    }
    ctx.fx.ring(p.x, p.z, 0.3, p.radius * 2, this.color, 0.18);
    if (first) {
      this.discoveries |= p.mask & ~(Thermal | Induction | Afterheat);
      if (p.repeat && mod === 'linger') this.discoveries |= p.mask & Afterheat;
      let hops = (core === 'chain' ? 1 : 0) + (p.mask & Induction ? 1 : 0);
      this.arcs.length = 0;
      let prev = first;
      while (hops-- > 0) {
        this.arcs.push(prev);
        const next = ctx.nearest(prev.x, prev.z, 5, this.skipArc);
        if (!next || !this.strike(ctx, next, p.power * 0.55, p)) break;
        ctx.fx.star(next.x, 1, next.z, 0.85, this.color, 0.12);
        if (!hops) this.discoveries |= p.mask & Induction;
        prev = next;
      }
      if (this.discoveries !== previous) this.cacheKey();
    }
    if (p.repeat || (mod !== 'linger' && mod !== 'bounce')) return;
    let nextMark: Enemy | null = first;
    if (mod === 'bounce') {
      if (!first) return;
      this.excludeUid = first.uid;
      const next = ctx.nearest(p.x, p.z, 6, this.skipLast);
      if (!next) return;
      nextMark = next;
      p.fromX = p.x;
      p.fromZ = p.z;
      p.x = next.x;
      p.z = next.z;
      ctx.fx.star(p.x, 1, p.z, 0.8, this.color, 0.15);
    }
    p.repeat = true;
    p.landed = false;
    p.age = 0;
    p.delay = mod === 'linger' ? 0.36 : 0.13;
    this.warnDuelTarget(p, nextMark, ctx);
    p.power *= mod === 'linger' && p.mask & Afterheat ? 0.9 : 0.45;
  }
  private skipArc = (e: Enemy) => this.arcs.includes(e);

  // Only live visuals travel. Clients draw the quantized transforms directly.
  net(): number[] {
    const out: number[] = [];
    for (const p of this.pulses)
      if (p.active) out.push(p.x, p.z, p.fromX, p.fromZ, p.age, p.delay, Number(p.repeat));
    return compactWeaponNet(out);
  }
  setNet(a: number[]): void {
    this.mirrored = true;
    for (let i = 0; i < POOL; i++) {
      const p = this.pulses[i],
        k = i * 7;
      p.active = k + 6 < a.length;
      if (!p.active) continue;
      p.x = a[k];
      p.z = a[k + 1];
      p.fromX = a[k + 2];
      p.fromZ = a[k + 3];
      p.age = a[k + 4];
      p.delay = a[k + 5];
      p.repeat = !!a[k + 6];
    }
  }
  render(): void {
    this.batch.begin(this.color);
    for (const p of this.pulses) {
      if (!p.active) continue;
      const f = this.recipe.frame;
      if (f === 'beam' || (p.repeat && this.recipe.mod === 'bounce'))
        this.batch.line(p.fromX, p.fromZ, p.x, p.z, 0.2);
      const k = Math.min(1, p.age / Math.max(0.01, p.delay));
      const height = f === 'lobber' && !p.repeat ? 1 + 3.5 * Math.sin(Math.PI * k) : 1;
      this.batch.add(p.x, height, p.z, 0.5, 0.32, 0.5, k * 2);
    }
    this.batch.end();
  }
  dispose(): void {
    this.batch.dispose();
  }
}
function freePulse(p: Pulse): boolean {
  return !p.active;
}
