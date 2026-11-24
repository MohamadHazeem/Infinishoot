import { dangerLayer } from '../render/noiseGovernor';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chestParts } from './chests';
import { createRetroMaterial } from '../render/retroMaterial';
import { commit, instanceMatrix } from '../render/instancing';
import { music } from '../audio/music';

/**
 * Pickups dropped in the world: XP gems (coloured by value), gold (run
 * currency), hearts, magnets (vacuum all gems), treasure chests and gears
 * (level-up rerolls, capped per hero).
 * Within magnet range they fly to the player, accelerating.
 */
export const PickupType = { Gem: 0, Bolt: 1, Heart: 2, Magnet: 3, Chest: 4, Gear: 5, Nuke: 6 } as const;
export type PickupType = (typeof PickupType)[keyof typeof PickupType];

const MAX = 1500;
const BASE_MAGNET = 3.2;

const GEM_COLORS = ['#4fc3ff', '#4fd36a', '#ff3d5a', '#ffd23f'];
function gemTier(v: number): number {
  return v >= 20 ? 3 : v >= 5 ? 2 : v >= 2 ? 1 : 0;
}

export interface Collector {
  x: number;
  z: number;
  magnet: number;
  alive: boolean;
}

export class Pickups {
  count = 0;
  readonly x = new Float32Array(MAX);
  readonly z = new Float32Array(MAX);
  readonly vx = new Float32Array(MAX);
  readonly vz = new Float32Array(MAX);
  readonly value = new Float32Array(MAX);
  readonly type = new Uint8Array(MAX);
  readonly pulled = new Uint8Array(MAX);
  /** Seconds since the magnet grabbed it. */
  readonly pullT = new Float32Array(MAX);
  readonly age = new Float32Array(MAX);
  /** When true every gem flies to the player (magnet pickup, stage clear). */
  vacuum = false;
  /** Stage clear: chests fly to whoever may open them too (boss chests to their owner), so a teammate taking the portal early can't strand them. */
  vacuumChests = false;

  private meshes: THREE.InstancedMesh[] = [];
  /** Gold trim of chest pickups: drawn with the same matrices as the wood (meshes[Chest]). */
  private chestTrim: THREE.InstancedMesh;
  /** Additive beam + ground glow over chest pickups (same matrices). */
  private chestGlow: THREE.InstancedMesh;
  private chestGlowMat: THREE.MeshBasicMaterial;
  private m4 = new THREE.Matrix4();

  private c = new THREE.Color();
  private readonly gemColors = GEM_COLORS.map(color => new THREE.Color(color));

  constructor(scene: THREE.Scene) {
    const make = (geo: THREE.BufferGeometry, color: string, unlit: number, cap: number) => {
      const m = this.add(scene, new THREE.InstancedMesh(geo, createRetroMaterial({ color, unlit }), cap));
      if (geo.userData.colored) for (let i = 0; i < cap; i++) m.setColorAt(i, this.c.set('#ffffff'));
      return m;
    };
    const gemGeo = new THREE.OctahedronGeometry(0.22, 0);
    gemGeo.scale(1, 1.5, 1);
    gemGeo.userData.colored = true;
    const boltGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.08, 6).rotateX(Math.PI / 2);
    const heart = new THREE.Shape();
    heart.moveTo(0, -0.3);
    heart.bezierCurveTo(-0.45, 0.05, -0.25, 0.4, 0, 0.18);
    heart.bezierCurveTo(0.25, 0.4, 0.45, 0.05, 0, -0.3);
    const heartGeo = new THREE.ExtrudeGeometry(heart, { depth: 0.12, bevelEnabled: false });
    const magnetGeo = new THREE.TorusGeometry(0.28, 0.1, 5, 10, Math.PI);
    // A cog: hub plus eight teeth, standing up like the gold bolts.
    const teeth = Array.from({ length: 8 }, (_, k) => new THREE.BoxGeometry(0.12, 0.1, 0.12).translate(0.3, 0, 0).rotateY((k / 8) * Math.PI * 2));
    const gearGeo = mergeGeometries([new THREE.CylinderGeometry(0.26, 0.26, 0.1, 8), ...teeth]).rotateX(Math.PI / 2);
    this.meshes[PickupType.Gem] = make(gemGeo, '#ffffff', 0.55, MAX);
    this.meshes[PickupType.Bolt] = make(boltGeo, '#ffb627', 0.4, 256);
    this.meshes[PickupType.Heart] = make(heartGeo, '#ff3d5a', 0.4, 64);
    this.meshes[PickupType.Magnet] = make(magnetGeo, '#ff3d5a', 0.3, 32);
    // Elite/boss chests look like the map chests (plank texture, gold trim), closed and at 80% size.
    const cp = chestParts();
    const shut = (geo: THREE.BufferGeometry) => geo.translate(0, 0.5, -0.34);
    const chestWood = mergeGeometries([cp.baseWood, shut(cp.lidWood)]).translate(0, -0.38, 0).scale(0.8, 0.8, 0.8);
    this.chestTrim = this.add(scene, new THREE.InstancedMesh(mergeGeometries([cp.baseTrim, shut(cp.lidTrim)]).translate(0, -0.38, 0).scale(0.8, 0.8, 0.8), cp.trimMat, 32));
    this.meshes[PickupType.Chest] = this.add(scene, new THREE.InstancedMesh(chestWood, cp.woodMat, 32));
    // A gold light beam and a ground glow so dropped chests stand out in a crowd (additive: black fades out).
    const beam = new THREE.CylinderGeometry(0.3, 0.3, 4, 8, 1, true).translate(0, 2.7, 0); // starts a little above the lid so the chest stays readable
    const disc = new THREE.CircleGeometry(1.1, 12).rotateX(-Math.PI / 2).translate(0, -0.28, 0);
    const fade = (geo: THREE.BufferGeometry, k: (x: number, y: number, z: number) => number) => {
      const pos = geo.getAttribute('position');
      const col = new Float32Array(pos.count * 3);
      const c = new THREE.Color('#ffd23f');
      for (let i = 0; i < pos.count; i++) {
        const f = k(pos.getX(i), pos.getY(i), pos.getZ(i));
        col.set([c.r * f, c.g * f, c.b * f], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.deleteAttribute('uv');
      return geo;
    };
    const glowGeo = mergeGeometries([fade(beam, (_x, y) => (y < 2 ? 1 : 0)), fade(disc, (x, _y, z) => (Math.hypot(x, z) < 0.01 ? 1 : 0))]);
    this.chestGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.chestGlow = this.add(scene, new THREE.InstancedMesh(glowGeo, this.chestGlowMat, 32));
    this.chestGlow.renderOrder = 2;
    this.meshes[PickupType.Gear] = make(gearGeo, '#d8def0', 0.6, 32);
    // Nuke: a fat warhead with fins, glowing hot.
    const nukeGeo = mergeGeometries([new THREE.CapsuleGeometry(0.22, 0.4, 3, 8), new THREE.BoxGeometry(0.62, 0.06, 0.12).translate(0, -0.3, 0), new THREE.BoxGeometry(0.12, 0.06, 0.62).translate(0, -0.3, 0)]).rotateZ(Math.PI / 5);
    this.meshes[PickupType.Nuke] = make(nukeGeo, '#ffcd75', 0.8, 8);
  }

  private add(scene: THREE.Scene, m: THREE.InstancedMesh): THREE.InstancedMesh {
    dangerLayer(m, 80);
    m.frustumCulled = false;
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
    return m;
  }

  spawn(type: PickupType, x: number, z: number, value = 1): void {
    // When full, fold gems into an existing gem instead of dropping XP.
    // Gems fold into an existing gem once the pool is nearly full, so the last
    // slots stay free for chests, gold, gears, hearts and nukes.
    if (this.count >= MAX - (type === PickupType.Gem ? 100 : 0)) {
      if (type === PickupType.Gem) {
        for (let i = this.count - 1; i >= 0; i--) {
          if (this.type[i] === PickupType.Gem) {
            this.value[i] += value;
            return;
          }
        }
      }
      return;
    }
    const i = this.count++;
    this.x[i] = x;
    this.z[i] = z;
    // Little pop outward so piles spread.
    const a = Math.random() * Math.PI * 2;
    const sp = type === PickupType.Gem ? Math.random() * 2 : 2.5;
    this.vx[i] = Math.cos(a) * sp;
    this.vz[i] = Math.sin(a) * sp;
    this.value[i] = value;
    this.type[i] = type;
    this.pulled[i] = 0;
    this.pullT[i] = 0;
    this.age[i] = 0;
  }

  clear(): void {
    this.count = 0;
    this.vacuum = this.vacuumChests = false;
  }

  private remove(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.z[i] = this.z[j];
    this.vx[i] = this.vx[j];
    this.vz[i] = this.vz[j];
    this.value[i] = this.value[j];
    this.type[i] = this.type[j];
    this.pulled[i] = this.pulled[j];
    this.pullT[i] = this.pullT[j];
    this.age[i] = this.age[j];
  }

  /**
   * Move, attract and collect. Each pickup flies to the nearest living
   * collector in range (its magnet stat scales the range); `collect` gets
   * the collector's index.
   */
  update(dt: number, collectors: Collector[], collect: (type: PickupType, value: number, who: number) => void, canTake: (type: PickupType, who: number, value: number) => boolean = () => true): void {
    const drag = Math.exp(-5 * dt);
    let reach = 0.75;
    for (const k of collectors) if (k.alive) reach = Math.max(reach, BASE_MAGNET * k.magnet);
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      // Nearest living collector that may take it: one that can't (gears at its cap, a teammate's
      // boss chest) leaves it to the others, or lying there. Checking only the nearest one let a
      // teammate standing closer block an owned chest from its owner (4-player co-op).
      const t = this.type[i];
      let ci = -1;
      // A pulled or vacuumed item tracks its owner at any distance. All other
      // items outside every magnet can take the ordinary drift path immediately.
      let d = this.pulled[i] || (this.vacuum && t === PickupType.Gem) || (this.vacuumChests && t === PickupType.Chest) ? Infinity : reach;
      for (let c = 0; c < collectors.length; c++) {
        const k = collectors[c];
        if (!k.alive) continue;
        const dx = k.x - this.x[i], dz = k.z - this.z[i];
        if (Math.abs(dx) >= d || Math.abs(dz) >= d) continue;
        const dd = Math.hypot(dx, dz);
        if (dd < d && canTake(t as PickupType, c, this.value[i])) {
          d = dd;
          ci = c;
        }
      }
      if (ci < 0) {
        this.pulled[i] = 0;
        this.vx[i] *= drag;
        this.vz[i] *= drag;
        this.x[i] += this.vx[i] * dt;
        this.z[i] += this.vz[i] * dt;
        continue;
      }
      const col = collectors[ci];
      const dx = col.x - this.x[i];
      const dz = col.z - this.z[i];
      // Chests and hearts need you to walk over them (no magnet), except during vacuum.
      const magnetic = t === PickupType.Gem || t === PickupType.Bolt || t === PickupType.Gear;
      const range = BASE_MAGNET * col.magnet;
      if (!this.pulled[i] && this.age[i] > 0.25 && ((magnetic && d < range) || (this.vacuum && t === PickupType.Gem) || (this.vacuumChests && t === PickupType.Chest))) {
        this.pulled[i] = 1;
        this.pullT[i] = 0;
        // Small hop away first, like it's been yanked.
        this.vx[i] = (-dx / (d || 1)) * 3;
        this.vz[i] = (-dz / (d || 1)) * 3;
      }
      if (this.pulled[i]) {
        // Home straight in: steer the whole velocity toward the player (no
        // sideways speed left over to orbit with), faster the longer it flies.
        this.pullT[i] += dt;
        const pt = this.pullT[i];
        const nx = dx / (d || 1);
        const nz = dz / (d || 1);
        const sp = Math.min(45, 12 + pt * 60);
        const k = pt < 0.1 ? 0 : pt > 0.35 ? 1 : 1 - Math.exp(-18 * dt);
        this.vx[i] += (nx * sp - this.vx[i]) * k;
        this.vz[i] += (nz * sp - this.vz[i]) * k;
      } else {
        this.vx[i] *= drag;
        this.vz[i] *= drag;
      }
      const homing = this.pulled[i] && this.pullT[i] > 0.1;
      const step = homing ? Math.hypot(this.vx[i], this.vz[i]) * dt : 0;
      this.x[i] += this.vx[i] * dt;
      this.z[i] += this.vz[i] * dt;
      // Collect on touch, or when this step would carry it past the player.
      if (d < 0.75 || (homing && d < step + 0.75)) {
        collect(t as PickupType, this.value[i], ci);
        this.remove(i--);
      }
    }
  }

  /** Client: replace all pickups with a snapshot (no simulation). */
  setFromNet(n: number, get: (i: number) => [number, number, number, number]): void {
    this.count = 0;
    for (let i = 0; i < n && this.count < MAX; i++) {
      const [type, x, z, value] = get(i);
      const k = this.count++;
      this.type[k] = type;
      this.x[k] = x;
      this.z[k] = z;
      this.value[k] = value;
      this.age[k] = 1;
      this.vx[k] = this.vz[k] = 0;
      this.pulled[k] = 0;
      this.pullT[k] = 0;
    }
  }

  render(time: number): void {
    for (const m of this.meshes) m.count = 0;
    // Pickups bounce to the music's beat.
    const beat = 1 + music.pulse * 0.14;
    for (let i = 0; i < this.count; i++) {
      const t = this.type[i];
      const m = this.meshes[t];
      if (m.count >= m.instanceMatrix.count) continue;
      const k = m.count++;
      const bob = Math.sin(time * 4 + i) * 0.08;
      let y = 0.45 + bob;
      let sc = Math.min(1, this.age[i] * 6) * beat;
      let yaw: number;
      if (t === PickupType.Gem) {
        const tier = gemTier(this.value[i]);
        sc *= 1 + tier * 0.3;
        m.setColorAt(k, this.gemColors[tier]);
        yaw = time * 2 + i;
      } else if (t === PickupType.Chest) {
        y = 0.3;
        yaw = Math.sin(time * 2) * 0.3;
        sc *= 1 + Math.max(0, Math.sin(time * 6)) * 0.08;
      } else {
        y = 0.6 + bob;
        sc *= 1.3;
        yaw = time * 3;
      }
      // All pickups spin around Y with uniform scale.
      const m4 = this.m4.elements;
      const sin = Math.sin(yaw) * sc, cos = Math.cos(yaw) * sc;
      m4[0] = m4[10] = cos;
      m4[2] = -sin;
      m4[8] = sin;
      m4[5] = sc;
      m4[12] = this.x[i];
      m4[13] = y;
      m4[14] = this.z[i];
      instanceMatrix(m, k, this.m4);
      if (t === PickupType.Chest) {
        instanceMatrix(this.chestTrim, k, this.m4);
        instanceMatrix(this.chestGlow, k, this.m4);
      }
    }
    this.chestTrim.count = this.chestGlow.count = this.meshes[PickupType.Chest].count;
    this.chestGlowMat.opacity = 0.4 + 0.2 * Math.sin(time * 4);
    for (const m of this.meshes) {
      commit(m.instanceMatrix, m.count);
      if (m.instanceColor) commit(m.instanceColor, m.count);
    }
    commit(this.chestTrim.instanceMatrix, this.chestTrim.count);
    commit(this.chestGlow.instanceMatrix, this.chestGlow.count);
  }
}
