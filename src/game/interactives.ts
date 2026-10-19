import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from '../render/geometry';
import { commit } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';
import { textures } from '../render/textures';
import { access } from './settings';
import type { AABB } from '../world/collision';
import type { Arena, ArenaProp } from '../world/fieldArena';
import { Objective, objectiveTuning, pickObjective, totemHp, type ObjectiveKind } from './objectives';

/**
 * Arena toys: breakable cover (crates, stacks, toppling pillars), jump pads,
 * turrets you switch on by walking in, and the stage objective's pieces
 * (totems, relic shards, the beacon). Layout comes from the seeded arena, so
 * every machine builds the same toys; the host simulates them
 * (src/game/systems/arena.ts) and clients mirror `net()`.
 */
export const arenaTuning = {
  crateHp: 40,
  stackHp: 70,
  pillarHp: 150,
  hpPerStage: 0.45, // cover life x (1 + hpPerStage x (stage - 1))
  crateGold: 0.25, // chance a broken crate spills a coin
  // Pillars topple away from the last hit and crush everything under them.
  pillarLen: 5.4,
  pillarHalfWidth: 0.95,
  pillarFall: 0.5, // seconds to hit the ground
  pillarBossFrac: 0.08, // bosses lose this share of max life instead of dying
  pillarLie: 6, // seconds the rubble lies there
  // Jump pads
  padRadius: 1.0,
  jumpTime: 0.8,
  jumpHeight: 3.8,
  padCooldown: 0.6, // after landing, before a pad launches you again
  landRadius: 3.8,
  landDmg: 30,
  landDmgPerStage: 15,
  landKnock: 18,
  // Turrets
  turretPad: 1.4, // walk this close to switch it on
  turretTime: 20,
  turretCooldown: 40,
  turretRange: 16,
  turretRate: 0.18, // seconds between shots
  turretDmg: 9,
  turretDmgPerStage: 5,
  // Objectives
  shardRadius: 1.3,
};

export const PILLAR_H = 4.8;
const MAX_CRATES = 200;

export interface PropState {
  def: ArenaProp;
  hp: number;
  maxHp: number;
  alive: boolean;
  flash: number;
  /** Hero index credited with breaking it. */
  by: number;
  /** Direction of the last hit (pillars fall this way). */
  dirX: number;
  dirZ: number;
  /** Pillars: seconds since it started to fall (-1 standing); fall angle on the XZ plane. */
  fallT: number;
  fallA: number;
  /** Host: sim-time seconds since the fall started (the crush lands at pillarFall). */
  simT: number;
  crushed: boolean;
}

export interface TotemState {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  flash: number;
  box: AABB;
}

export interface TurretState {
  x: number;
  z: number;
  /** Seconds of firing left (0 = idle), cooldown before it can be switched on again. */
  t: number;
  cd: number;
  owner: number;
  fireT: number;
  aim: number;
}

export interface Jump {
  t: number;
  fx: number;
  fz: number;
  tx: number;
  tz: number;
  /** Host only: the landing shockwave hasn't fired yet. */
  pending: boolean;
}

/** Height of a jump arc at progress t01 (0..1): a parabola peaking at `h`. */
export function jumpHeight(t01: number, h: number): number {
  const t = Math.max(0, Math.min(1, t01));
  return 4 * h * t * (1 - t);
}

/** Is (px, pz) under a pillar that falls from (bx, bz) along angle a (len long, halfW wide)? */
export function underPillar(px: number, pz: number, r: number, bx: number, bz: number, a: number, len: number, halfW: number): boolean {
  const dx = Math.sin(a);
  const dz = Math.cos(a);
  const rx = px - bx;
  const rz = pz - bz;
  const along = rx * dx + rz * dz;
  const side = Math.abs(rx * dz - rz * dx);
  return along > -r && along < len + r && side < halfW + r;
}

function part(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  return paint(g.index ? g.toNonIndexed() : g, color);
}

function instanced(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, max: number, flash = false): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, max));
  if (flash) m.geometry.setAttribute('instanceFlash', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, max) * 4), 4));
  m.frustumCulled = false;
  m.count = 0;
  scene.add(m);
  return m;
}

export class Interactives {
  props: PropState[] = [];
  totems: TotemState[] = [];
  turrets: TurretState[] = [];
  pads: Arena['pads'] = [];
  shards: { x: number; z: number; taken: boolean }[] = [];
  beacon: { x: number; z: number } | null = null;
  objective = new Objective('shards', 1);
  /** Jump in progress per hero index, and the per-hero pad cooldown. */
  jumps: (Jump | null)[] = [];
  padCd: number[] = [];
  /** Clients: remote heroes' jump progress from the host (-1 = on the ground). */
  netJumps: number[] = [];
  stage = 1;
  /** Test links: force this objective on every stage. */
  force: ObjectiveKind | null = null;
  /** Environmental kills this stage, the current streak and its window (host). */
  envKills = 0;
  envStreak = 0;
  envT = 0;
  /** Barrel chain length already announced. */
  shownChain = 0;
  /** Quicksand: seconds each enemy (by pool index, checked by uid) has been sinking. */
  sink: number[] = [];
  sinkUid: number[] = [];

  private crates: THREE.InstancedMesh;
  private pillars: THREE.InstancedMesh;
  private totemMesh: THREE.InstancedMesh;
  private turretBase: THREE.InstancedMesh;
  private turretHead: THREE.InstancedMesh;
  private padMesh: THREE.InstancedMesh;
  private landMesh: THREE.InstancedMesh;
  private shardMesh: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private beaconGroup = new THREE.Group();
  private beaconRing: THREE.Mesh;
  private beaconRingMat: ReturnType<typeof createRetroMaterial>;
  private beaconCrystal: THREE.Mesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private pillarTint = new THREE.Color('#ffd6f0');

  constructor(scene: THREE.Scene) {
    this.crates = instanced(scene, new THREE.BoxGeometry(1.2, 1.2, 1.2), createRetroMaterial({ map: textures.crate(), instanceFlash: true }), MAX_CRATES, true);

    // Pillar built with its base at the origin so it can tip over around it.
    const pillar = mergeGeometries([
      part(new THREE.BoxGeometry(1.45, 0.4, 1.45).translate(0, 0.2, 0), '#d8d0ff'),
      part(new THREE.CylinderGeometry(0.52, 0.62, PILLAR_H - 0.7, 8).translate(0, 0.4 + (PILLAR_H - 0.7) / 2, 0), '#f4ecff'),
      part(new THREE.CylinderGeometry(0.56, 0.56, 0.22, 8).translate(0, 1.5, 0), '#ff9ecf'),
      part(new THREE.CylinderGeometry(0.54, 0.54, 0.22, 8).translate(0, 3.0, 0), '#ff9ecf'),
      part(new THREE.BoxGeometry(1.5, 0.35, 1.5).translate(0, PILLAR_H - 0.17, 0), '#fff4c9'),
    ]);
    this.pillars = instanced(scene, pillar, createRetroMaterial({ vertexColors: true, instanceFlash: true }), 8, true);

    // Totem: three goofy stacked heads.
    const eye = (x: number, y: number, z: number) => part(new THREE.BoxGeometry(0.16, 0.16, 0.06).translate(x, y, z), '#1a1c2c');
    const totem = mergeGeometries([
      part(new THREE.BoxGeometry(1.2, 0.9, 1.2).translate(0, 0.45, 0), '#5d275d'),
      part(new THREE.BoxGeometry(1.0, 0.85, 1.0).translate(0, 1.32, 0), '#b13e53'),
      part(new THREE.BoxGeometry(1.1, 0.8, 1.1).translate(0, 2.15, 0), '#ef7d57'),
      part(new THREE.BoxGeometry(1.5, 0.18, 0.3).translate(0, 2.65, 0), '#ffcd75'),
      part(new THREE.ConeGeometry(0.18, 0.6, 4).translate(-0.6, 2.95, 0), '#ffcd75'),
      part(new THREE.ConeGeometry(0.18, 0.6, 4).translate(0.6, 2.95, 0), '#ffcd75'),
      eye(-0.22, 0.55, 0.62),
      eye(0.22, 0.55, 0.62),
      eye(-0.2, 1.42, 0.52),
      eye(0.2, 1.42, 0.52),
      part(new THREE.BoxGeometry(0.5, 0.12, 0.06).translate(0, 1.15, 0.52), '#1a1c2c'),
      eye(-0.22, 2.25, 0.57),
      eye(0.22, 2.25, 0.57),
      part(new THREE.BoxGeometry(0.3, 0.2, 0.06).translate(0, 1.98, 0.57), '#f4f4f4'),
    ]);
    this.totemMesh = instanced(scene, totem, createRetroMaterial({ vertexColors: true, instanceFlash: true }), 4, true);

    const base = mergeGeometries([
      part(new THREE.CylinderGeometry(1.4, 1.5, 0.12, 12).translate(0, 0.06, 0), '#3b5dc9'),
      part(new THREE.CylinderGeometry(1.15, 1.15, 0.14, 12).translate(0, 0.08, 0), '#73eff7'),
      part(new THREE.CylinderGeometry(0.55, 0.7, 0.8, 8).translate(0, 0.5, 0), '#566c86'),
    ]);
    this.turretBase = instanced(scene, base, createRetroMaterial({ vertexColors: true, instanceFlash: true }), 4, true);
    const head = mergeGeometries([
      part(new THREE.BoxGeometry(0.9, 0.6, 0.9).translate(0, 0, 0), '#94b0c2'),
      part(new THREE.BoxGeometry(0.92, 0.14, 0.5).translate(0, 0.18, 0.1), '#41a6f6'),
      part(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 6).rotateX(Math.PI / 2).translate(-0.18, -0.02, 0.75), '#333c57'),
      part(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 6).rotateX(Math.PI / 2).translate(0.18, -0.02, 0.75), '#333c57'),
      part(new THREE.BoxGeometry(0.3, 0.12, 0.08).translate(0, 0.05, 0.46), '#ffcd75'),
    ]);
    this.turretHead = instanced(scene, head, createRetroMaterial({ vertexColors: true, instanceFlash: true }), 4, true);

    // Jump pad: a springy disc with a chevron pointing at its landing spot (+Z = forward).
    const pad = mergeGeometries([
      part(new THREE.CylinderGeometry(1.15, 1.25, 0.16, 12).translate(0, 0.08, 0), '#333c57'),
      part(new THREE.CylinderGeometry(0.95, 0.95, 0.2, 12).translate(0, 0.12, 0), '#ef7d57'),
      part(new THREE.BoxGeometry(0.22, 0.06, 0.7).rotateY(0.7).translate(-0.22, 0.24, 0.1), '#ffcd75'),
      part(new THREE.BoxGeometry(0.22, 0.06, 0.7).rotateY(-0.7).translate(0.22, 0.24, 0.1), '#ffcd75'),
      part(new THREE.BoxGeometry(0.22, 0.06, 0.7).rotateY(0.7).translate(-0.22, 0.24, -0.4), '#ffcd75'),
      part(new THREE.BoxGeometry(0.22, 0.06, 0.7).rotateY(-0.7).translate(0.22, 0.24, -0.4), '#ffcd75'),
    ]);
    this.padMesh = instanced(scene, pad, createRetroMaterial({ vertexColors: true, unlit: 0.25, instanceFlash: true }), 6, true);
    const land = new THREE.RingGeometry(0.75, 1.0, 12);
    land.rotateX(-Math.PI / 2);
    this.landMesh = instanced(scene, land, createRetroMaterial({ color: '#ffcd75', unlit: 0.8 }), 6);

    const shard = mergeGeometries([part(new THREE.OctahedronGeometry(0.42, 0).scale(0.75, 1.3, 0.75), '#a7f070'), part(new THREE.OctahedronGeometry(0.22, 0).scale(1, 1.4, 1).translate(0, 0, 0.2), '#f4f4f4')]);
    this.shardMesh = instanced(scene, shard, createRetroMaterial({ vertexColors: true, unlit: 0.6 }), 8);
    this.beams = instanced(scene, new THREE.CylinderGeometry(0.1, 0.1, 9, 5).translate(0, 4.5, 0), createRetroMaterial({ color: '#ffcd75', unlit: 1 }), 12);

    // Beacon: pedestal, floating crystal and its ring on the ground.
    const ped = new THREE.Mesh(
      mergeGeometries([
        part(new THREE.CylinderGeometry(1.0, 1.2, 0.5, 8).translate(0, 0.25, 0), '#29366f'),
        part(new THREE.CylinderGeometry(0.45, 0.6, 1.4, 8).translate(0, 1.2, 0), '#3b5dc9'),
        part(new THREE.CylinderGeometry(0.75, 0.6, 0.2, 8).translate(0, 1.95, 0), '#ffcd75'),
      ]),
      createRetroMaterial({ vertexColors: true }),
    );
    this.beaconCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0).scale(0.8, 1.4, 0.8), createRetroMaterial({ color: '#73eff7', unlit: 0.8 }));
    const ring = new THREE.RingGeometry(objectiveTuning.beaconRadius - 0.25, objectiveTuning.beaconRadius, 32);
    ring.rotateX(-Math.PI / 2);
    this.beaconRingMat = createRetroMaterial({ color: '#73eff7', unlit: 1 });
    this.beaconRing = new THREE.Mesh(ring, this.beaconRingMat);
    this.beaconRing.position.y = 0.05;
    this.beaconGroup.add(ped, this.beaconCrystal, this.beaconRing);
    this.beaconGroup.visible = false;
    scene.add(this.beaconGroup);
  }

  /** Build the toys for a freshly generated arena. Adds totem colliders to `arena.colliders`. */
  load(arena: Arena, stage: number, pillarTint: string): void {
    this.stage = stage;
    this.pillarTint.set(pillarTint);
    const T = arenaTuning;
    const hpMul = 1 + T.hpPerStage * (stage - 1);
    this.props = arena.props.map((def) => {
      const hp = (def.kind === 'pillar' ? T.pillarHp : def.kind === 'stack' ? T.stackHp : T.crateHp) * hpMul;
      return { def, hp, maxHp: hp, alive: true, flash: 0, by: 0, dirX: 0, dirZ: 1, fallT: -1, fallA: 0, simT: 0, crushed: false };
    });
    this.turrets = arena.turrets.map((t) => ({ x: t.x, z: t.z, t: 0, cd: 0, owner: 0, fireT: 0, aim: 0 }));
    this.pads = arena.pads;
    this.jumps = [];
    this.padCd = [];
    this.netJumps = [];
    this.envKills = 0;
    this.objective = new Objective(this.force ?? pickObjective(arena.seed, stage), stage);
    this.totems = [];
    this.shards = [];
    this.beacon = null;
    const spots = arena.spots;
    if (this.objective.kind === 'totems') {
      // Three spots far apart.
      for (let i = 0; i < spots.length && this.totems.length < objectiveTuning.totems; i += 2) {
        const s = spots[i];
        const box = { minX: s.x - 0.6, maxX: s.x + 0.6, minZ: s.z - 0.6, maxZ: s.z + 0.6 };
        arena.colliders.push(box);
        const hp = totemHp(stage);
        this.totems.push({ x: s.x, z: s.z, hp, maxHp: hp, alive: true, flash: 0, box });
      }
    } else if (this.objective.kind === 'shards') {
      for (const s of spots.slice(0, objectiveTuning.shards)) this.shards.push({ x: s.x, z: s.z, taken: false });
    } else if (this.objective.kind === 'beacon' && spots.length) {
      // The spot closest to the middle, so defending it isn't a trek.
      let best = spots[0];
      for (const s of spots) if (Math.hypot(s.x, s.z) < Math.hypot(best.x, best.z)) best = s;
      this.beacon = { x: best.x, z: best.z };
    }
    // Shard count follows what fit on the map.
    if (this.objective.kind === 'shards' && this.shards.length < this.objective.max) this.objective = Object.assign(new Objective('shards', stage), { max: this.shards.length });
    if (this.objective.kind === 'totems' && this.totems.length < this.objective.max) this.objective = Object.assign(new Objective('totems', stage), { max: this.totems.length });
    this.beaconGroup.visible = !!this.beacon;
    if (this.beacon) this.beaconGroup.position.set(this.beacon.x, 0, this.beacon.z);
  }

  /** Index of a live prop whose box overlaps the circle, or -1. */
  propAt(x: number, z: number, r: number): number {
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      if (!p.alive) continue;
      const b = p.def.box;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return i;
    }
    return -1;
  }

  totemAt(x: number, z: number, r: number): number {
    for (let i = 0; i < this.totems.length; i++) {
      const t = this.totems[i];
      if (t.alive && Math.abs(x - t.x) < 0.6 + r && Math.abs(z - t.z) < 0.6 + r) return i;
    }
    return -1;
  }

  /** Jump progress (0..1) of hero i for drawing, or -1 on the ground. Hosts know every jump; clients get others' from `netJumps`. */
  jumpT01(i: number, remoteOnClient: boolean): number {
    const j = this.jumps[i];
    if (j) return Math.min(1, j.t / arenaTuning.jumpTime);
    if (remoteOnClient && this.netJumps[i] >= 0) return this.netJumps[i];
    return -1;
  }

  /** Snapshot payload for clients. */
  net(): Record<string, unknown> {
    const bits = (arr: readonly boolean[]) => {
      const out: number[] = [];
      for (let i = 0; i < arr.length; i++) if (arr[i]) out[i >> 4] = (out[i >> 4] ?? 0) | (1 << (i & 15));
      for (let i = 0; i < Math.ceil(arr.length / 16); i++) out[i] = out[i] ?? 0;
      return out;
    };
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      p: bits(this.props.map((p) => p.alive)),
      f: this.props.filter((p) => p.def.kind === 'pillar').map((p) => (p.fallT >= 0 ? Math.round(p.fallA * 100) : -999)),
      t: this.turrets.flatMap((t) => [r1(t.t), r1(t.cd), t.owner]),
      m: bits(this.totems.map((t) => t.alive)),
      s: bits(this.shards.map((s) => s.taken)),
      o: this.objective.net(),
      j: this.jumps.map((j) => (j ? Math.round((j.t / arenaTuning.jumpTime) * 100) / 100 : -1)),
    };
  }

  /**
   * Client: mirror the host. Returns props and totems that just broke (so the
   * caller can drop their colliders and play debris) and pillars that just started falling.
   */
  setNet(n: Record<string, unknown>, out: { broke: PropState[]; fell: PropState[]; totems: TotemState[] }): void {
    const bit = (a: unknown, i: number) => (((a as number[] | undefined)?.[i >> 4] ?? 0) & (1 << (i & 15))) !== 0;
    this.props.forEach((p, i) => {
      if (p.alive && !bit(n.p, i)) {
        p.alive = false;
        if (p.def.kind !== 'pillar') out.broke.push(p);
      }
    });
    const falls = (n.f as number[]) ?? [];
    let k = 0;
    for (const p of this.props) {
      if (p.def.kind !== 'pillar') continue;
      const a = falls[k++];
      if (a !== undefined && a !== -999 && p.fallT < 0) {
        p.fallT = 0;
        p.fallA = a / 100;
        p.alive = false;
        out.fell.push(p);
      }
    }
    const t = (n.t as number[]) ?? [];
    this.turrets.forEach((tu, i) => {
      tu.t = t[i * 3] ?? 0;
      tu.cd = t[i * 3 + 1] ?? 0;
      tu.owner = t[i * 3 + 2] ?? 0;
    });
    this.totems.forEach((tt, i) => {
      if (tt.alive && !bit(n.m, i)) {
        tt.alive = false;
        out.totems.push(tt);
      }
    });
    this.shards.forEach((s, i) => (s.taken = bit(n.s, i)));
    if (n.o) this.objective.setNet(n.o as number[]);
    this.netJumps = (n.j as number[]) ?? [];
  }

  /** Cosmetic per-frame update and instance upload. */
  render(time: number, frameDt: number): void {
    const m4 = this.m4;
    // Crates and stacks.
    let n = 0;
    const flash = this.crates.geometry.getAttribute('instanceFlash') as THREE.InstancedBufferAttribute;
    for (const p of this.props) {
      if (p.def.kind === 'pillar') continue;
      p.flash = Math.max(0, p.flash - frameDt * 6);
      if (!p.alive) continue;
      const sc = 1 + p.flash * 0.06;
      for (let level = 0; level < (p.def.kind === 'stack' ? 2 : 1) && n < MAX_CRATES; level++) {
        this.q.setFromAxisAngle(this.up, level ? p.def.rot2 : p.def.rot);
        m4.compose(this.v.set(p.def.x, 0.6 + level * 1.2, p.def.z), this.q, this.s.set(sc, sc, sc));
        this.crates.setMatrixAt(n, m4);
        flash.setXYZW(n, 1, 1, 1, p.flash * 0.8);
        n++;
      }
    }
    this.crates.count = n;
    commit(this.crates.instanceMatrix, n);
    commit(flash, n);

    // Pillars: standing, falling (rotating about the base) or lying, then sinking away.
    n = 0;
    const pf = this.pillars.geometry.getAttribute('instanceFlash') as THREE.InstancedBufferAttribute;
    const T = arenaTuning;
    for (const p of this.props) {
      if (p.def.kind !== 'pillar') continue;
      p.flash = Math.max(0, p.flash - frameDt * 6);
      let tilt = 0;
      let y = 0;
      if (p.fallT >= 0) {
        p.fallT += frameDt;
        const k = Math.min(1, p.fallT / T.pillarFall);
        tilt = k * k * (Math.PI / 2);
        const sink = p.fallT - T.pillarFall - T.pillarLie;
        if (sink > 1) continue;
        if (sink > 0) y = -sink * 1.3;
      } else if (!p.alive) continue;
      this.q.setFromAxisAngle(this.up, p.def.rot);
      if (tilt > 0) {
        this.axis.set(Math.cos(p.fallA), 0, -Math.sin(p.fallA));
        this.q2.setFromAxisAngle(this.axis, tilt);
        this.q.premultiply(this.q2);
      }
      const wob = p.flash * 0.05;
      m4.compose(this.v.set(p.def.x, y, p.def.z), this.q, this.s.set(1 + wob, 1, 1 + wob));
      this.pillars.setMatrixAt(n, m4);
      this.pillars.setColorAt(n, this.pillarTint);
      pf.setXYZW(n, 1, 1, 1, p.flash * 0.8);
      n++;
    }
    this.pillars.count = n;
    commit(this.pillars.instanceMatrix, n);
    commit(pf, n);
    if (this.pillars.instanceColor) commit(this.pillars.instanceColor, n);

    // Totems wobble; their beams mark them on the map.
    n = 0;
    let beams = 0;
    const tf = this.totemMesh.geometry.getAttribute('instanceFlash') as THREE.InstancedBufferAttribute;
    const live = this.objective.active;
    for (const t of this.totems) {
      t.flash = Math.max(0, t.flash - frameDt * 6);
      if (!t.alive) continue;
      this.q.setFromAxisAngle(this.up, Math.sin(time * 2 + t.x) * 0.15);
      const sq = 1 + t.flash * 0.1;
      m4.compose(this.v.set(t.x, 0, t.z), this.q, this.s.set(sq, 1 - t.flash * 0.06, sq));
      this.totemMesh.setMatrixAt(n, m4);
      tf.setXYZW(n, 1, 1, 1, t.flash * 0.85);
      n++;
      if (live) this.beam(beams++, t.x, t.z, time);
    }
    this.totemMesh.count = n;
    commit(this.totemMesh.instanceMatrix, n);
    commit(tf, n);

    // Shards spin and bob.
    n = 0;
    for (const s of this.shards) {
      if (s.taken || !live) continue;
      this.q.setFromAxisAngle(this.up, time * 2.5 + s.x);
      m4.compose(this.v.set(s.x, 1.0 + Math.sin(time * 3 + s.z) * 0.2, s.z), this.q, this.s.set(1, 1, 1));
      this.shardMesh.setMatrixAt(n++, m4);
      this.beam(beams++, s.x, s.z, time);
    }
    this.shardMesh.count = n;
    commit(this.shardMesh.instanceMatrix, n);

    // Beacon: the crystal spins faster while charging; the ring blinks when it's under attack.
    if (this.beacon) {
      const o = this.objective;
      this.beaconGroup.visible = o.state !== 'failed';
      this.beaconCrystal.position.y = 2.9 + Math.sin(time * 2) * 0.2;
      this.beaconCrystal.rotation.y += frameDt * (o.charging ? 6 : 1.2);
      // Under attack: the ring blinks (holds orange with Reduce Flashing on).
      const hurt = o.attacked && o.active && (access.reduceFlash || Math.floor(time * 3) % 2 === 0);
      this.beaconRingMat.uniforms.uColor.value.set(o.state === 'done' ? '#a7f070' : hurt ? '#ef7d57' : o.charging ? '#ffcd75' : '#73eff7');
      if (o.active) this.beam(beams++, this.beacon.x, this.beacon.z, time);
    }
    this.beams.count = beams;
    commit(this.beams.instanceMatrix, beams);

    // Turrets: the head tracks its aim and glows while firing.
    n = 0;
    const bf = this.turretBase.geometry.getAttribute('instanceFlash') as THREE.InstancedBufferAttribute;
    const hf = this.turretHead.geometry.getAttribute('instanceFlash') as THREE.InstancedBufferAttribute;
    for (const t of this.turrets) {
      this.q.set(0, 0, 0, 1);
      m4.compose(this.v.set(t.x, 0, t.z), this.q, this.s.set(1, 1, 1));
      this.turretBase.setMatrixAt(n, m4);
      if (t.t <= 0) t.aim += frameDt * (t.cd > 0 ? 0 : 0.6); // idle: slow scan
      this.q.setFromAxisAngle(this.up, t.aim);
      const bob = t.t > 0 ? Math.sin(time * 30) * 0.03 : 0;
      m4.compose(this.v.set(t.x, 1.2 + bob, t.z), this.q, this.s.set(1, 1, 1));
      this.turretHead.setMatrixAt(n, m4);
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      // Idle: the pad pulses cyan (step on me). Firing: hot. Cooling down: grey.
      if (t.t > 0) {
        bf.setXYZW(n, 0.45, 0.94, 0.97, 0.25 + pulse * 0.2);
        hf.setXYZW(n, 1, 0.8, 0.46, t.fireT > arenaTuning.turretRate * 0.6 ? 0.5 : 0.1);
      } else if (t.cd > 0) {
        bf.setXYZW(n, 0.2, 0.24, 0.34, 0.55);
        hf.setXYZW(n, 0.2, 0.24, 0.34, 0.55);
      } else {
        bf.setXYZW(n, 0.45, 0.94, 0.97, pulse * 0.45);
        hf.setXYZW(n, 1, 1, 1, 0);
      }
      n++;
    }
    this.turretBase.count = this.turretHead.count = n;
    commit(this.turretBase.instanceMatrix, n);
    commit(this.turretHead.instanceMatrix, n);
    commit(bf, n);
    commit(hf, n);

    // Jump pads squash in a springy rhythm; their landing rings blink.
    n = 0;
    const pdf = this.padMesh.geometry.getAttribute('instanceFlash') as THREE.InstancedBufferAttribute;
    for (const p of this.pads) {
      this.q.setFromAxisAngle(this.up, Math.atan2(p.tx - p.x, p.tz - p.z));
      const k = Math.max(0, Math.sin(time * 5 + p.x));
      m4.compose(this.v.set(p.x, 0, p.z), this.q, this.s.set(1 + k * 0.05, 1 + k * 0.6, 1 + k * 0.05));
      this.padMesh.setMatrixAt(n, m4);
      pdf.setXYZW(n, 1, 0.95, 0.6, k * 0.3);
      this.q.set(0, 0, 0, 1);
      const r = 1 + 0.15 * Math.sin(time * 4 + p.z);
      m4.compose(this.v.set(p.tx, 0.06, p.tz), this.q, this.s.set(r, 1, r));
      this.landMesh.setMatrixAt(n, m4);
      n++;
    }
    this.padMesh.count = this.landMesh.count = n;
    commit(this.padMesh.instanceMatrix, n);
    commit(this.landMesh.instanceMatrix, n);
    commit(pdf, n);
  }

  private beam(i: number, x: number, z: number, time: number): void {
    if (i >= 12) return;
    this.q.set(0, 0, 0, 1);
    const w = 1 + 0.35 * Math.sin(time * 6 + x);
    this.m4.compose(this.v.set(x, 0, z), this.q, this.s.set(w, 1, w));
    this.beams.setMatrixAt(i, this.m4);
  }
}
