import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Input } from '../core/input';
import type { HeroDef } from '../data/heroes';
import { createRetroMaterial, type RetroMaterial } from '../render/retroMaterial';
import { createHero, type HeroRig } from './heroModel';
import type { Player } from './player';
import { createWeapon, type Weapon, type WeaponCtx } from './weapons';
import { heroes4Gear, isHeroes4 } from './heroes4';

/**
 * Hero mechanics (src/data/heroes.ts `mech`), pure state and presentation.
 * The Game side is src/game/systems/heroMechs.ts.
 *
 * - Duelist: no dash; the dash key parries, with a longer window and a short
 *   whiff cooldown. Each parry while the chain is alive adds a damage stack.
 * - Furnace: heat builds while standing still (damage up, a burning aura that
 *   grows) and vents when moving. Every machine derives heat from the hero's
 *   synced velocity, so the glow needs no network traffic; damage is the host's.
 * - Twin: a small mirror twin walks at your left and fires a copy of your
 *   left-click weapon at half damage (its own weapon instance, synced to
 *   clients through the hero snapshot's `tw`).
 */
export const heroMechTuning = {
  duelist: {
    parryWindowMul: 1.8, // x skillTuning.parryWindow
    whiffCooldown: 0.4, // seconds after a whiffed parry (the normal one is 0.6)
    chainMax: 6,
    chainDamage: 0.12, // +damage per stack
    chainTime: 4, // seconds a chain lasts without another parry
  },
  furnace: {
    stillSpeed: 1.2, // m/s: slower than this counts as standing still
    heatRise: 0.3, // heat per second standing still (full in ~3.3 s)
    heatDrop: 2.5, // heat lost per second moving
    damageMax: 0.6, // +damage at full heat
    auraFrom: 0.3, // heat where the aura lights
    auraMin: 2, // aura radius at auraFrom...
    auraMax: 4.5, // ...and at full heat
    auraTick: 0.5,
    auraDamage: 8, // per tick at full heat, x enemy toughness (power)
    burnDps: 3, // ignite, x power
  },
  twin: {
    damage: 0.5,
    side: 1.5, // metres to your left
    back: 0.35,
    follow: 10, // how fast it catches up (1/s)
    scale: 0.62,
  },
};

/** One hero's mechanic state. */
export class HeroMech {
  id: HeroDef['mech'] | '' = '';
  // Furnace
  heat = 0;
  auraT = 0;
  /** Seconds standing still right now, and the best this run (achievement). */
  stillT = 0;
  stillBest = 0;
  // Duelist
  chain = 0;
  chainT = 0;
  /** Parries landed this run (any hero; achievement). */
  parries = 0;
  /** Kills within 2.5 m this run (any hero; the Point Blank achievement, src/game/systems/heroes3.ts). */
  closeKills = 0;
  // Twin
  twin: TwinClone | null = null;

  reset(): void {
    this.heat =
      this.auraT =
      this.stillT =
      this.stillBest =
      this.chain =
      this.chainT =
      this.parries =
      this.closeKills =
        0;
  }

  /** Damage multiplier from heat or the parry chain. */
  get damageMul(): number {
    if (this.id === 'furnace') return 1 + heroMechTuning.furnace.damageMax * this.heat;
    if (this.id === 'duelist') return 1 + heroMechTuning.duelist.chainDamage * this.chain;
    return 1;
  }

  /** Furnace: heat follows how still the hero is (`speed` m/s). */
  tickHeat(dt: number, speed: number, fighting: boolean): void {
    const T = heroMechTuning.furnace;
    if (speed < T.stillSpeed && fighting) this.heat = Math.min(1, this.heat + T.heatRise * dt);
    else this.heat = Math.max(0, this.heat - T.heatDrop * dt);
  }

  /** Any hero: how long it has stood still (the Immovable achievement). */
  trackStill(dt: number, speed: number, fighting: boolean): void {
    if (speed < heroMechTuning.furnace.stillSpeed && fighting) {
      this.stillT += dt;
      this.stillBest = Math.max(this.stillBest, this.stillT);
    } else this.stillT = 0;
  }

  /** Duelist: a parry landed. Returns the new chain length. */
  chainParry(): number {
    const T = heroMechTuning.duelist;
    this.chain = Math.min(T.chainMax, this.chain + 1);
    this.chainT = T.chainTime;
    return this.chain;
  }

  tickChain(dt: number): void {
    if (this.chainT > 0 && (this.chainT -= dt) <= 0) this.chain = 0;
  }

  /** Furnace aura radius for the current heat (0 = off). */
  get auraR(): number {
    const T = heroMechTuning.furnace;
    if (this.id !== 'furnace' || this.heat < T.auraFrom) return 0;
    return T.auraMin + (T.auraMax - T.auraMin) * ((this.heat - T.auraFrom) / (1 - T.auraFrom));
  }
}

/** The dash key (and its pad buttons), for the Duelist's parry. Matches Game.updateHero. */
export function dashKeyPressed(input: Input): boolean {
  return (
    input.actionPressed('dash') ||
    input.padButtonPressed(4) ||
    input.padButtonPressed(6) ||
    input.padButtonPressed(0)
  );
}

// ---------------------------------------------------------------- Twin

/**
 * The Twin's mirror clone: a mini hero at your left that fires its own copy of
 * your left-click weapon. Its weapon sees a proxy player (same aim, its own
 * position) and a proxy context that halves damage.
 */
export class TwinClone {
  weapon: Weapon | null = null;
  readonly rig: HeroRig;
  readonly ctx: WeaponCtx;
  private readonly proxy: Player;
  /** Simulated spot (follows the hero) and the drawn one. */
  x = 0;
  z = 0;
  private fakeRig = { root: { position: new THREE.Vector3() } };

  constructor(
    private scene: THREE.Scene,
    private player: Player,
    ctx: WeaponCtx,
    color: string,
  ) {
    this.rig = createHero(color);
    this.rig.root.scale.setScalar(heroMechTuning.twin.scale);
    scene.add(this.rig.root);
    // Proxy player: the hero's own aim, timers and stats, but the clone's position.
    const proxy = Object.create(player) as Player & {
      pos: { x: number; z: number };
      prev: { x: number; z: number };
    };
    Object.defineProperty(proxy, 'pos', { value: { x: player.x, z: player.z }, writable: true });
    Object.defineProperty(proxy, 'prev', { value: { x: player.x, z: player.z }, writable: true });
    Object.defineProperty(proxy, 'rig', { value: this.fakeRig, writable: true });
    this.proxy = proxy;
    // Proxy context: everything as the hero's, at half damage.
    const k = heroMechTuning.twin.damage;
    const bullets = Object.create(ctx.bullets) as WeaponCtx['bullets'];
    Object.defineProperty(bullets, 'spawn', {
      value: (b: Parameters<WeaponCtx['bullets']['spawn']>[0]) => {
        b.damage *= k;
        ctx.bullets.spawn(b);
      },
    });
    const c = Object.create(ctx) as WeaponCtx;
    Object.defineProperty(c, 'player', { value: proxy });
    Object.defineProperty(c, 'bullets', { value: bullets });
    Object.defineProperty(c, 'damage', {
      value: (
        e: Parameters<WeaponCtx['damage']>[0],
        base: number,
        o: Parameters<WeaponCtx['damage']>[2],
      ) => ctx.damage(e, base * k, o),
    });
    Object.defineProperty(c, 'blast', {
      value: (
        x: number,
        z: number,
        r: number,
        base: number,
        color: string,
        source: string,
        tags?: Parameters<WeaponCtx['blast']>[6],
      ) => ctx.blast(x, z, r * 0.8, base * k, color, source, tags),
    });
    Object.defineProperty(c, 'zap', {
      value: (from: Parameters<WeaponCtx['zap']>[0], hops: number, dmg: number) =>
        ctx.zap(from, hops, dmg * k),
    });
    Object.defineProperty(c, 'hitBarrels', {
      value: (dmg: number, inside: (x: number, z: number) => boolean) =>
        ctx.hitBarrels(dmg * k, inside),
    });
    this.ctx = c;
    this.snap();
  }

  /** Where the clone wants to stand: beside you, mirroring your cannon arm. */
  private spot(out: { x: number; z: number }): void {
    const T = heroMechTuning.twin;
    const a = this.player.aim;
    // Opposite the arm cannon (the muzzle sits at +(aim.z, -aim.x)), a step back.
    out.x = this.player.x - a.z * T.side - a.x * T.back;
    out.z = this.player.z + a.x * T.side - a.z * T.back;
  }

  private tmp = { x: 0, z: 0 };

  /** Jump straight to its spot (new stage, respawn). */
  snap(): void {
    this.spot(this.tmp);
    this.x = this.tmp.x;
    this.z = this.tmp.z;
    this.syncProxy();
  }

  private syncProxy(): void {
    const p = this.proxy as unknown as {
      pos: { x: number; z: number };
      prev: { x: number; z: number };
    };
    p.prev.x = p.pos.x;
    p.prev.z = p.pos.z;
    p.pos.x = this.x;
    p.pos.z = this.z;
  }

  /** Keep the clone's weapon a copy of the hero's left click (id, level and build). */
  match(primary: Weapon | undefined): void {
    if (!primary) return;
    if (this.weapon?.def.id !== primary.def.id) {
      this.weapon?.dispose();
      this.weapon = createWeapon(primary.def.id, this.scene);
    }
    const w = this.weapon;
    if (primary.build) w.setBuildKey(primary.buildKey);
    else w.level = primary.level;
  }

  /** Simulation step (host): follow the hero, then fire. */
  update(dt: number, primary: Weapon | undefined): void {
    this.follow(dt);
    this.match(primary);
    if (!this.player.dead) this.weapon?.update(dt, this.ctx);
  }

  /** Move toward its spot (every machine; clients do it for the drawn clone). */
  follow(dt: number): void {
    this.spot(this.tmp);
    const dx = this.tmp.x - this.x;
    const dz = this.tmp.z - this.z;
    if (dx * dx + dz * dz > 64) {
      this.x = this.tmp.x;
      this.z = this.tmp.z;
    } else {
      const k = 1 - Math.exp(-heroMechTuning.twin.follow * dt);
      this.x += dx * k;
      this.z += dz * k;
    }
    this.syncProxy();
  }

  /** Draw the clone and its weapon. `rx, rz` = the hero's drawn offset from its sim position. */
  render(alpha: number, time: number, visible: boolean): void {
    const root = this.rig.root;
    root.visible = visible;
    if (!visible) return;
    const p = this.player;
    const ox = p.rig.root.position.x - p.x;
    const oz = p.rig.root.position.z - p.z;
    root.position.set(this.x + ox, Math.abs(Math.sin(time * 9)) * 0.06, this.z + oz);
    root.rotation.y = Math.atan2(p.aim.x, p.aim.z);
    // Arms out like the hero's, the cannon arm (right) pointing ahead.
    this.rig.armR.rotation.x = -Math.PI / 2 + 0.1;
    this.fakeRig.root.position.copy(root.position);
    // Mirror sheen: a soft cyan shimmer so it reads as a copy.
    const f = 0.2 + 0.08 * Math.sin(time * 5);
    for (const m of this.rig.materials) m.uniforms.uFlash.value.set(0.55, 0.95, 1, f);
    this.weapon?.draw(alpha, this.ctx);
  }

  /** Mirror the host's weapon state (client). */
  setNet(a: number[]): void {
    this.weapon?.setNet(a);
  }

  dispose(): void {
    this.weapon?.dispose();
    this.weapon = null;
    this.scene.remove(this.rig.root);
    this.rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}

// ---------------------------------------------------------------- hero gear (silhouettes)

/**
 * Small accessories that give each mechanic hero its own silhouette and colour:
 * the Duelist's long scarf and plume, the Furnace's back chimney and shoulder
 * plates, the Twin's mirror visor. Added to the rig's body and head groups.
 */
export function attachHeroGear(rig: HeroRig, mech: HeroDef['mech'] | undefined): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  if (!mech) return out;
  const mat = (color: string, unlit = 0): RetroMaterial => {
    const m = createRetroMaterial({ color, unlit });
    rig.materials.push(m);
    return m;
  };
  const put = (
    parent: THREE.Object3D,
    g: THREE.BufferGeometry,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    name = '',
  ): THREE.Mesh => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.name = name;
    parent.add(o);
    out.push(o);
    return o;
  };
  heroes4Gear(rig, mech, mat, put); // Medic and Brawler (src/game/heroes4.ts)
  switch (mech) {
    case 'duelist': {
      const red = mat('#b13e53');
      const white = mat('#f4f4f4');
      // A long scarf flowing back from the neck, and a tall feather plume on the helmet.
      put(rig.body, new THREE.BoxGeometry(0.5, 0.12, 0.4), red, 0, 1.18, 0);
      put(
        rig.body,
        new THREE.BoxGeometry(0.2, 0.06, 0.9).rotateX(-0.35).rotateY(0.25),
        red,
        0.14,
        0.98,
        -0.55,
        'scarf',
      );
      put(
        rig.body,
        new THREE.BoxGeometry(0.16, 0.06, 0.6).rotateX(-0.5).rotateY(-0.3),
        red,
        -0.1,
        1.0,
        -0.45,
      );
      put(rig.head, new THREE.ConeGeometry(0.08, 0.6, 5).rotateX(-0.6), white, 0.12, 0.5, -0.15);
      put(rig.head, new THREE.SphereGeometry(0.07, 6, 4), red, 0.12, 0.28, 0.02);
      break;
    }
    case 'furnace': {
      const iron = mat('#333c57');
      const glow = mat('#ff7a2f', 1);
      // A stubby chimney on the back (its mouth glows) and wide shoulder plates.
      put(rig.body, new THREE.CylinderGeometry(0.16, 0.2, 0.55, 8), iron, 0, 1.25, -0.38);
      put(rig.body, new THREE.CylinderGeometry(0.13, 0.13, 0.05, 8), glow, 0, 1.54, -0.38, 'stack');
      for (const k of [-1, 1])
        put(rig.body, new THREE.BoxGeometry(0.34, 0.12, 0.42), iron, k * 0.42, 1.18, 0);
      put(rig.body, new THREE.BoxGeometry(0.22, 0.16, 0.06), glow, 0, 0.98, 0.3, 'grate');
      break;
    }
    case 'ronin': {
      const straw = mat('#d9a95b');
      const strawDark = mat('#a8763e');
      const red = mat('#b13e53');
      const steel = mat('#f4f4f4', 0.35);
      const edge = mat('#73eff7', 0.7);
      const gold = mat('#ffcd75');
      // A wide straw kasa hat over the helmet, its red band, and headband tails flying back.
      put(rig.head, new THREE.ConeGeometry(0.72, 0.3, 12), straw, 0, 0.5, -0.02, 'kasa');
      put(rig.head, new THREE.CylinderGeometry(0.73, 0.73, 0.03, 12), strawDark, 0, 0.36, -0.02);
      put(rig.head, new THREE.CylinderGeometry(0.4, 0.42, 0.07, 10), red, 0, 0.42, -0.02);
      put(rig.head, new THREE.BoxGeometry(0.08, 0.04, 0.5).rotateX(-0.5).rotateY(0.3), red, 0.1, 0.22, -0.55);
      put(rig.head, new THREE.BoxGeometry(0.07, 0.04, 0.42).rotateX(-0.7).rotateY(-0.25), red, -0.08, 0.2, -0.5);
      // A red sash at the waist.
      put(rig.body, new THREE.BoxGeometry(0.6, 0.1, 0.42), red, 0, 0.8, 0);
      put(rig.body, new THREE.BoxGeometry(0.12, 0.28, 0.06).rotateZ(0.2), red, 0.2, 0.66, -0.22);
      // The arm blade: a long katana out of the forearm (the arm points forward when raised).
      put(rig.armR, new THREE.BoxGeometry(0.3, 0.05, 0.22), gold, 0.04, -0.73, 0);
      put(rig.armR, new THREE.BoxGeometry(0.05, 1.15, 0.13), steel, 0.04, -1.33, 0, 'blade');
      put(rig.armR, new THREE.BoxGeometry(0.03, 1.1, 0.04), edge, 0.04, -1.33, 0.08);
      put(rig.armR, new THREE.ConeGeometry(0.07, 0.18, 4).rotateX(Math.PI), steel, 0.04, -2.0, 0.01);
      break;
    }
    case 'tinker': {
      const orange = mat('#ef7d57');
      const gold = mat('#ffcd75');
      const dark = mat('#333c57');
      const steel = mat('#566c86');
      const lens = mat('#73eff7', 0.6);
      const red = mat('#b13e53', 0.5);
      // Big goggles pushed up on the helmet.
      put(rig.head, new THREE.BoxGeometry(0.66, 0.08, 0.1), dark, 0, 0.27, 0.27);
      for (const k of [-1, 1]) {
        put(rig.head, new THREE.CylinderGeometry(0.13, 0.13, 0.1, 10).rotateX(Math.PI / 2), gold, k * 0.15, 0.3, 0.33);
        put(rig.head, new THREE.CylinderGeometry(0.09, 0.09, 0.04, 10).rotateX(Math.PI / 2), lens, k * 0.15, 0.3, 0.39);
      }
      // A tool backpack with a spinning cog and an antenna.
      put(rig.body, new THREE.BoxGeometry(0.52, 0.5, 0.3), orange, 0, 1.0, -0.34);
      put(rig.body, new THREE.BoxGeometry(0.54, 0.08, 0.32), dark, 0, 1.18, -0.34);
      put(rig.body, new THREE.CylinderGeometry(0.17, 0.17, 0.06, 8).rotateX(Math.PI / 2), gold, 0.0, 0.98, -0.52, 'cog');
      put(rig.body, new THREE.CylinderGeometry(0.02, 0.02, 0.55, 4), dark, -0.18, 1.45, -0.38);
      put(rig.body, new THREE.SphereGeometry(0.06, 6, 4), red, -0.18, 1.74, -0.38);
      // A wrench in the free hand.
      put(rig.armL, new THREE.BoxGeometry(0.07, 0.5, 0.07), steel, -0.03, -0.62, 0.05);
      put(rig.armL, new THREE.BoxGeometry(0.2, 0.08, 0.08), steel, -0.03, -0.88, 0.05);
      break;
    }
    case 'twin': {
      const cyan = mat('#73eff7', 0.6);
      // A mirror visor band and a small antenna with a diamond.
      put(rig.head, new THREE.BoxGeometry(0.62, 0.1, 0.1), cyan, 0, 0.08, 0.32);
      put(rig.head, new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), cyan, -0.2, 0.5, 0);
      put(rig.head, new THREE.OctahedronGeometry(0.08, 0), cyan, -0.2, 0.68, 0);
      break;
    }
  }
  // These kits arrived after the layered rigs: merge only static pieces on the
  // same joint/material to keep their outline/x-ray inside the 40-part budget.
  // Named animated parts (blade, cog, etc.) retain their own transforms.
  if (mech === 'ronin' || mech === 'tinker' || isHeroes4(mech)) for (let i = 0; i < out.length; i++) {
    const first = out[i] as THREE.Mesh;
    if (first.name) continue;
    const parts = out.filter((o) => !o.name && o.parent === first.parent && (o as THREE.Mesh).material === first.material) as THREE.Mesh[];
    if (parts.length < 2) continue;
    const geometries = parts.map((part) => {
      part.updateMatrix();
      return (part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone()).applyMatrix4(part.matrix);
    });
    const merged = mergeGeometries(geometries)!;
    for (const geometry of geometries) geometry.dispose();
    for (const part of parts) part.geometry.dispose();
    first.geometry = merged;
    first.position.set(0, 0, 0);
    first.rotation.set(0, 0, 0);
    first.scale.set(1, 1, 1);
    for (const part of parts.slice(1)) { part.removeFromParent(); out.splice(out.indexOf(part), 1); }
  }
  return out;
}

/** Remove gear added by attachHeroGear (and its materials from the rig). */
export function detachHeroGear(rig: HeroRig, gear: THREE.Object3D[]): void {
  for (const o of gear) {
    o.parent?.remove(o);
    const m = o as THREE.Mesh;
    if (!m.isMesh) continue;
    m.geometry.dispose();
    const mat = m.material as RetroMaterial;
    const i = rig.materials.indexOf(mat);
    if (i >= 0) rig.materials.splice(i, 1);
    mat.dispose();
  }
}
