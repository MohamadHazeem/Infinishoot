/**
 * Content lane: the Game side of the biome-native enemies (src/game/biomeFoes.ts).
 * Shark dust, snowball crashes, kite gusts, and lava-slug puddles that burn
 * heroes. Game methods (`this` is the Game), installed on the class as fields.
 */
import type { Game } from '../game';
import { biomeForStage } from '../../data/biomes';
import { biomeFoeTuning, lavaPuddles, type BiomeFoeApi } from '../biomeFoes';
import type { Enemy } from '../enemies';
import { SCAR_COLORS } from '../scars';

let puddleArena = -1;
/** Per-hero puddle burn cooldown. */
const burnCd = new WeakMap<object, number>();

/** EnemyCtx.foe (host only). */
export function biomeFoeApi(this: Game): BiomeFoeApi {
  return {
    puff: (e, kind) => {
      const up = kind === 'surface';
      this.vfx.burst(e.x, 0.2, e.z, {
        count: up ? 16 : 10,
        color: '#f2e2b8',
        color2: '#ffcd75',
        speed: [2, up ? 7 : 4],
        size: [0.15, 0.32],
        life: [0.3, 0.6],
        up: up ? 6 : 3,
        gravity: 12,
      });
      this.vfx.ring(e.x, e.z, 0.5, e.radius * 3, '#f2e2b8', 0.3);
      this.vfx.sound(up ? 'jumpPad' : 'whoosh', e.x, e.z, up ? 0.8 : 1.2);
    },
    crash: (e, r, damage) => this.snowballCrash(e, r, damage),
    gust: (e, dx, dz) => this.kiteGust(e, dx, dz),
  };
}

/** A big snowball shatters: snow burst, frost scar, heroes inside hurt, enemies nearby frozen. */
export function snowballCrash(this: Game, e: Enemy, r: number, damage: number): void {
  this.vfx.ring(e.x, e.z, 1, r * 2, '#ffffff', 0.35);
  this.vfx.ring(e.x, e.z, 0.6, r * 1.6, '#73eff7', 0.3);
  this.vfx.burst(e.x, 0.8, e.z, {
    count: 30,
    color: '#ffffff',
    color2: '#9fe8ff',
    speed: [4, 10],
    size: [0.18, 0.4],
    life: [0.4, 0.8],
    up: 7,
    gravity: 16,
  });
  this.vfx.star(e.x, 1, e.z, r, '#ffffff', 0.14);
  this.vfx.scar(e.x, e.z, r * 0.8, SCAR_COLORS.frost, 10);
  this.vfx.sound('bossSlam', e.x, e.z, 1.4);
  this.vfx.sound('w:freeze', e.x, e.z);
  this.vfx.shake(e.x, e.z, 0.35);
  for (const h of this.aliveHeroes) {
    if (Math.hypot(h.player.x - e.x, h.player.z - e.z) < r + h.player.radius)
      this.hurtHero(h, damage * e.dmgMul, e.x, e.z, e, e.def.name);
  }
  for (const o of this.enemiesInRadius(e.x, e.z, r, this.scratch))
    if (o !== e && !o.def.boss) o.frozen = Math.max(o.frozen, biomeFoeTuning.crashFreeze);
  if (e.active) this.killEnemy(e, 'roller', null);
}

/** A Gust Kite's wind: shoves heroes (and other enemies) in a cone away from it. */
export function kiteGust(this: Game, e: Enemy, dx: number, dz: number): void {
  const G = e.def.gust!;
  const range = G.range * Math.sqrt(e.scale);
  const cos = Math.cos((G.arcDeg * Math.PI) / 180);
  const push = G.push * (e.elite ? 1.3 : 1);
  const inCone = (x: number, z: number, pad: number) => {
    const ox = x - e.x;
    const oz = z - e.z;
    const d = Math.hypot(ox, oz);
    return d < range + pad && (d < 0.5 || (ox * dx + oz * dz) / d >= cos);
  };
  for (const h of this.aliveHeroes) {
    const p = h.player;
    if (p.dashing || !inCone(p.x, p.z, p.radius)) continue;
    if (h === this.hero) {
      p.shove(dx, dz, push);
      this.juice.kick(dx, dz, 4);
    } else this.tell(h, { t: 'shove', dx, dz, f: push });
    if (G.damage > 0) this.hurtHero(h, G.damage * e.dmgMul, e.x, e.z, e, e.def.name);
  }
  for (const o of this.enemiesInRadius(e.x, e.z, range, this.scratch)) {
    if (o === e || o.def.boss || !inCone(o.x, o.z, o.radius)) continue;
    const k = push * biomeFoeTuning.gustEnemies * (1 - o.def.knockbackResist);
    o.kx += dx * k;
    o.kz += dz * k;
  }
  // Streaks of wind along the cone.
  for (let i = 0; i < 4; i++) {
    const a = Math.atan2(dz, dx) + (i / 3 - 0.5) * ((G.arcDeg * Math.PI) / 180) * 1.4;
    this.vfx.burst(e.x + Math.cos(a) * 1.2, 0.9, e.z + Math.sin(a) * 1.2, {
      count: 4,
      color: '#e8fbff',
      color2: '#9fe8ff',
      speed: [range * 1.2, range * 2],
      size: [0.1, 0.22],
      life: [0.25, 0.45],
      drag: 2,
      dir: { x: Math.cos(a), z: Math.sin(a), spread: 0.15 },
    });
  }
  this.vfx.ring(e.x, e.z, 0.6, 3, '#e8fbff', 0.25);
  this.vfx.sound('whoosh', e.x, e.z, 0.8);
}

/** Host step: which biome the director spawns for, lava puddles and their burns. */
export function updateBiomeFoes(this: Game, dt: number): void {
  this.director.biome = biomeForStage(this.arenaStage).id;
  if (puddleArena !== this.arenaStage) {
    puddleArena = this.arenaStage;
    lavaPuddles.clear();
  }
  lavaPuddles.tick(dt, this.enemies.list);
  if (!this.isCombatMode || !lavaPuddles.list.length) return;
  for (const h of this.aliveHeroes) {
    const p = h.player;
    const cd = (burnCd.get(h) ?? 0) - dt;
    burnCd.set(h, cd);
    if (cd > 0 || p.dashing) continue;
    const pd = lavaPuddles.at(p.x, p.z, p.radius * 0.5);
    if (!pd) continue;
    burnCd.set(h, biomeFoeTuning.puddleTick);
    this.vfx.burst(p.x, 0.3, p.z, {
      count: 6,
      color: '#ff7a2f',
      color2: '#ffd23f',
      speed: [1, 3],
      size: [0.15, 0.3],
      life: [0.3, 0.5],
      up: 5,
    });
    this.hurtHero(h, pd.dps * biomeFoeTuning.puddleTick * pd.mul, pd.x, pd.z, null, 'Lava Slug');
  }
}

/** Client step: puddles are derived from the synced slugs, so they draw without network traffic. */
export function biomeFoesClient(this: Game, dt: number): void {
  if (puddleArena !== this.arenaStage) {
    puddleArena = this.arenaStage;
    lavaPuddles.clear();
  }
  lavaPuddles.tick(dt, this.enemies.list);
}
