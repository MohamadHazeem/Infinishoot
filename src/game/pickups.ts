import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from '../render/retroMaterial';
import { commit } from '../render/instancing';
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

  private meshes: THREE.InstancedMesh[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const make = (geo: THREE.BufferGeometry, color: string, unlit: number, cap: number) => {
      const m = new THREE.InstancedMesh(geo, createRetroMaterial({ color, unlit }), cap);
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (geo.userData.colored) for (let i = 0; i < cap; i++) m.setColorAt(i, this.c.set('#ffffff'));
      scene.add(m);
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
    const chestGeo = new THREE.BoxGeometry(0.8, 0.55, 0.55);
    // A cog: hub plus eight teeth, standing up like the gold bolts.
    const teeth = Array.from({ length: 8 }, (_, k) => new THREE.BoxGeometry(0.12, 0.1, 0.12).translate(0.3, 0, 0).rotateY((k / 8) * Math.PI * 2));
    const gearGeo = mergeGeometries([new THREE.CylinderGeometry(0.26, 0.26, 0.1, 8), ...teeth]).rotateX(Math.PI / 2);
    this.meshes[PickupType.Gem] = make(gemGeo, '#ffffff', 0.55, MAX);
    this.meshes[PickupType.Bolt] = make(boltGeo, '#ffb627', 0.4, 256);
    this.meshes[PickupType.Heart] = make(heartGeo, '#ff3d5a', 0.4, 64);
    this.meshes[PickupType.Magnet] = make(magnetGeo, '#ff3d5a', 0.3, 32);
    this.meshes[PickupType.Chest] = make(chestGeo, '#e0a83c', 0.15, 32);
    this.meshes[PickupType.Gear] = make(gearGeo, '#d8def0', 0.6, 32);
    // Nuke: a fat warhead with fins, glowing hot.
    const nukeGeo = mergeGeometries([new THREE.CapsuleGeometry(0.22, 0.4, 3, 8), new THREE.BoxGeometry(0.62, 0.06, 0.12).translate(0, -0.3, 0), new THREE.BoxGeometry(0.12, 0.06, 0.62).translate(0, -0.3, 0)]).rotateZ(Math.PI / 5);
    this.meshes[PickupType.Nuke] = make(nukeGeo, '#ffcd75', 0.8, 8);
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
    this.vacuum = false;
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
  update(dt: number, collectors: Collector[], collect: (type: PickupType, value: number, who: number) => void, canTake: (type: PickupType, who: number) => boolean = () => true): void {
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      // Nearest living collector.
      let ci = -1;
      let d = Infinity;
      for (let c = 0; c < collectors.length; c++) {
        const k = collectors[c];
        if (!k.alive) continue;
        const dd = Math.hypot(k.x - this.x[i], k.z - this.z[i]);
        if (dd < d) {
          d = dd;
          ci = c;
        }
      }
      const t = this.type[i];
      // A collector that can't take it (gears at the cap) leaves it lying there.
      if (ci >= 0 && !canTake(t as PickupType, ci)) {
        ci = -1;
        this.pulled[i] = 0;
      }
      if (ci < 0) {
        const f = Math.exp(-5 * dt);
        this.vx[i] *= f;
        this.vz[i] *= f;
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
      if (!this.pulled[i] && this.age[i] > 0.25 && ((magnetic && d < range) || (this.vacuum && t === PickupType.Gem))) {
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
        const f = Math.exp(-5 * dt);
        this.vx[i] *= f;
        this.vz[i] *= f;
      }
      const step = Math.hypot(this.vx[i], this.vz[i]) * dt;
      this.x[i] += this.vx[i] * dt;
      this.z[i] += this.vz[i] * dt;
      // Collect on touch, or when this step would carry it past the player.
      if (d < 0.75 || (this.pulled[i] && this.pullT[i] > 0.1 && d < step + 0.75)) {
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
      if (t === PickupType.Gem) {
        const tier = gemTier(this.value[i]);
        sc *= 1 + tier * 0.3;
        m.setColorAt(k, this.c.set(GEM_COLORS[tier]));
        this.q.setFromEuler(this.e.set(0, time * 2 + i, 0));
      } else if (t === PickupType.Chest) {
        y = 0.3;
        this.q.setFromEuler(this.e.set(0, Math.sin(time * 2) * 0.3, 0));
        sc *= 1 + Math.max(0, Math.sin(time * 6)) * 0.08;
      } else {
        y = 0.6 + bob;
        sc *= 1.3;
        this.q.setFromEuler(this.e.set(0, time * 3, 0));
      }
      this.m4.compose(this.v.set(this.x[i], y, this.z[i]), this.q, this.s.set(sc, sc, sc));
      m.setMatrixAt(k, this.m4);
    }
    for (const m of this.meshes) {
      commit(m.instanceMatrix, m.count);
      if (m.instanceColor) commit(m.instanceColor, m.count);
    }
  }
}
