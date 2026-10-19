import * as THREE from 'three';
import { createRetroMaterial, type RetroMaterial } from '../render/retroMaterial';
import { commit } from '../render/instancing';
import { BULLET_Y } from './bullets';
import type { Game } from './game';
import { SUPERS, crateTuning, mechTuning, relicTuning, type SuperId } from './gameplay';
import type { GpDrop } from './systems/gameplay';

/**
 * Gameplay lane meshes, all cosmetic and derived from synced state on every
 * machine: the mech suit around a piloting hero (the hero rides in its open
 * cockpit), mech-suit drops and falling supply crates with their flares,
 * Satellite Rounds orbiting their hero, spikes on mutated enemies, and
 * ground rings plus a body glow for comeback mode and weapon overload.
 */

/** Mech look (debug panel friendly). */
export const mechLook = {
  pilotY: 1.95,
  scale: 1.45,
  stride: 2.2,
};

const MECH_COLORS = { body: '#ffb627', dark: '#333c57', joint: '#566c86', glass: '#73eff7', red: '#b13e53', white: '#f4f4f4', wood: '#b8653a' };

type Mats = Record<keyof typeof MECH_COLORS, RetroMaterial>;
const TINTS: Partial<Record<SuperId, RetroMaterial>> = {};

function boxAt(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** A chunky yellow mech: two legs on hip pivots, an open cockpit, arm cannons and shoulder missile pods. */
class MechModel {
  readonly root = new THREE.Group();
  readonly legs: THREE.Group[] = [];
  readonly body = new THREE.Group();
  readonly beacon: THREE.Mesh;
  phase = 0;

  constructor(mats: Mats) {
    const { body, dark, joint, glass, red, white } = mats;
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.55, 1.2, 0);
      boxAt(leg, 0.42, 0.7, 0.5, joint, 0, -0.35, 0);
      boxAt(leg, 0.56, 0.65, 0.62, body, 0, -0.85, 0.04);
      boxAt(leg, 0.72, 0.2, 1.0, dark, 0, -1.1, 0.12);
      this.legs.push(leg);
      this.root.add(leg);
    }
    this.root.add(this.body);
    boxAt(this.body, 1.35, 0.4, 0.85, dark, 0, 1.25, 0);
    // Cockpit tub: open on top; the hero stands in it from the waist up.
    boxAt(this.body, 1.5, 0.75, 0.32, body, 0, 1.75, 0.55);
    boxAt(this.body, 1.5, 0.75, 0.32, body, 0, 1.75, -0.55);
    boxAt(this.body, 0.32, 0.75, 1.42, body, -0.6, 1.75, 0);
    boxAt(this.body, 0.32, 0.75, 1.42, body, 0.6, 1.75, 0);
    boxAt(this.body, 1.1, 0.12, 0.12, glass, 0, 2.18, 0.68);
    boxAt(this.body, 1.6, 0.1, 0.14, dark, 0, 1.42, 0.72);
    for (const side of [-1, 1]) {
      // Shoulder, arm cannon (barrel forward), missile pod with red tips.
      boxAt(this.body, 0.5, 0.5, 0.6, joint, side * 1.0, 1.95, 0);
      boxAt(this.body, 0.45, 0.45, 1.2, dark, side * 1.15, 1.55, 0.35);
      boxAt(this.body, 0.3, 0.3, 0.5, body, side * 1.15, 1.55, 1.1);
      boxAt(this.body, 0.2, 0.2, 0.12, white, side * 1.15, 1.55, 1.38);
      boxAt(this.body, 0.55, 0.45, 0.7, body, side * 0.95, 2.45, -0.15);
      for (let k = 0; k < 4; k++) boxAt(this.body, 0.12, 0.12, 0.12, red, side * 0.95 + (k % 2 ? 0.13 : -0.13), 2.45 + (k < 2 ? 0.1 : -0.1), 0.22);
    }
    this.beacon = boxAt(this.body, 0.18, 0.18, 0.18, red, 0, 2.3, -0.75);
    this.root.scale.setScalar(mechLook.scale);
  }

  /** Walk animation from the hero's speed; the beacon blinks in the last seconds. */
  pose(speed: number, rdt: number, left: number, time: number): void {
    this.phase += speed * rdt * mechLook.stride * 0.5;
    const s = Math.sin(this.phase);
    this.legs[0].rotation.x = s * 0.45;
    this.legs[1].rotation.x = -s * 0.45;
    this.legs[0].position.y = 1.2 + Math.max(0, s) * 0.18;
    this.legs[1].position.y = 1.2 + Math.max(0, -s) * 0.18;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * (speed > 1 ? 0.08 : 0);
    this.beacon.visible = left > 3 || Math.floor(time * 8) % 2 === 0;
  }
}

/** One drop on the ground: a mech suit (small mech on a pad) or a supply crate under its chute. */
class DropModel {
  readonly root = new THREE.Group();
  readonly crate = new THREE.Group();
  readonly chute = new THREE.Group();
  readonly beam: THREE.Mesh;
  readonly ring: THREE.Mesh;
  mini: MechModel | null = null;

  constructor(
    readonly kind: 'mech' | SuperId,
    mats: Mats,
    beamMat: THREE.MeshBasicMaterial,
    ringMat: THREE.MeshBasicMaterial,
  ) {
    if (kind === 'mech') {
      this.mini = new MechModel(mats);
      this.mini.root.scale.setScalar(0.42);
      this.root.add(this.mini.root);
      boxAt(this.root, 1.6, 0.12, 1.6, mats.dark, 0, 0.06, 0);
      for (let k = 0; k < 4; k++) boxAt(this.root, k % 2 ? 0.2 : 1.6, 0.14, k % 2 ? 1.6 : 0.2, mats.body, k === 1 ? 0.7 : k === 3 ? -0.7 : 0, 0.08, k === 0 ? 0.7 : k === 2 ? -0.7 : 0);
    } else {
      const tint = (TINTS[kind] ??= createRetroMaterial({ color: SUPERS[kind].color, unlit: 0.25 }));
      boxAt(this.crate, 1.05, 0.8, 1.05, mats.wood, 0, 0.4, 0);
      boxAt(this.crate, 1.1, 0.22, 1.1, tint, 0, 0.4, 0);
      boxAt(this.crate, 0.5, 0.06, 0.5, tint, 0, 0.83, 0);
      this.root.add(this.crate);
      // Parachute: a white dome on four cords.
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mats.white);
      dome.position.y = 3.2;
      dome.scale.y = 0.6;
      this.chute.add(dome);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const cord = boxAt(this.chute, 0.04, 2.5, 0.04, mats.joint, Math.cos(a) * 0.65, 2.05, Math.sin(a) * 0.65);
        cord.rotation.z = Math.cos(a) * 0.2;
        cord.rotation.x = -Math.sin(a) * 0.2;
      }
      this.crate.add(this.chute);
    }
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 14, 6, 1, true).translate(0, 7, 0), beamMat);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2), ringMat);
    this.ring.position.y = 0.05;
    this.root.add(this.beam, this.ring);
  }

  pose(d: GpDrop, time: number): void {
    const fall = crateTuning.fall;
    this.root.position.set(d.x, 0, d.z);
    if (this.mini) {
      this.mini.root.rotation.y = time * 1.2;
      this.mini.root.position.y = 0.15 + Math.sin(time * 3) * 0.08;
      this.mini.pose(0, 0, 10, time);
      this.ring.scale.setScalar(1.3 + 0.15 * Math.sin(time * 6));
      const left = fall + mechTuning.dropLife - d.t;
      this.root.visible = left > 5 || Math.floor(time * 6) % 2 === 0;
      return;
    }
    const k = Math.min(1, d.t / fall);
    const y = d.t < fall ? 16 * Math.pow(1 - k, 1.2) : 0;
    this.crate.position.y = y;
    this.crate.rotation.y = d.t < fall ? Math.sin(time * 2) * 0.3 : 0.4;
    this.chute.visible = d.t < fall;
    this.ring.visible = true;
    this.ring.scale.setScalar(d.t < fall ? 2.2 - k : 1.2 + 0.1 * Math.sin(time * 5));
    this.beam.scale.set(d.t < fall ? 1.4 : 0.7, 1, d.t < fall ? 1.4 : 0.7);
    const left = fall + crateTuning.life - d.t;
    this.root.visible = left > 4 || Math.floor(time * 6) % 2 === 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); // materials are shared and kept
  }
}

const SPIKES = 6;
const SPIKE_CAP = 40 * (SPIKES + 1);
const SAT_CAP = 48;
const AURA_CAP = 16;

export class GameplayView {
  private mats: Mats;
  private mechs = new Map<number, MechModel>();
  private shadows = new Map<number, THREE.Mesh>();
  private drops = new Map<number, DropModel>();
  private spikes: THREE.InstancedMesh;
  private sats: THREE.InstancedMesh;
  private auras: THREE.InstancedMesh;
  private flareMat = new THREE.MeshBasicMaterial({ color: '#ff7a2f', transparent: true, opacity: 0.35, depthWrite: false });
  private beamMats = new Map<string, THREE.MeshBasicMaterial>();
  private ringMat = new THREE.MeshBasicMaterial({ color: '#ffcd75', transparent: true, opacity: 0.8, depthWrite: false });
  private shadowMat = new THREE.MeshBasicMaterial({ color: '#1a1c2c', transparent: true, opacity: 0.35, depthWrite: false });
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private time = 0;

  constructor(private scene: THREE.Scene) {
    this.mats = Object.fromEntries(Object.entries(MECH_COLORS).map(([k, c]) => [k, createRetroMaterial({ color: c, unlit: k === 'glass' || k === 'red' ? 0.6 : 0 })])) as Mats;
    const spikeGeo = new THREE.ConeGeometry(0.11, 0.45, 4).translate(0, 0.22, 0);
    this.spikes = new THREE.InstancedMesh(spikeGeo, createRetroMaterial({ color: '#a7f070', unlit: 0.35 }), SPIKE_CAP);
    this.sats = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.2, 0), createRetroMaterial({ color: '#7df9ff', unlit: 0.9 }), SAT_CAP);
    this.auras = new THREE.InstancedMesh(new THREE.RingGeometry(0.82, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false }), AURA_CAP);
    this.auras.setColorAt(0, this.c.set('#ffffff'));
    for (const m of [this.spikes, this.sats, this.auras]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.auras.renderOrder = 1;
  }

  private beamMat(kind: 'mech' | SuperId): THREE.MeshBasicMaterial {
    const color = kind === 'mech' ? '#ffb627' : SUPERS[kind].color;
    let m = this.beamMats.get(color);
    if (!m) this.beamMats.set(color, (m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false })));
    return m;
  }

  render(g: Game, drops: readonly GpDrop[], alpha: number, rdt: number): void {
    this.time += rdt;
    const time = this.time;
    this.renderMechs(g, rdt, time);
    this.renderDrops(drops, time);
    this.renderSpikes(g, alpha, time);
    this.renderHeroFx(g, time);
  }

  private renderMechs(g: Game, rdt: number, time: number): void {
    for (const h of g.heroes) {
      const pl = h.play;
      const p = h.player;
      let m = this.mechs.get(h.index);
      const on = pl.mechT > 0 && !h.left && !p.dead && g.mode !== 'title';
      if (!on) {
        if (m) m.root.visible = false;
        const sh = this.shadows.get(h.index);
        if (sh) sh.visible = false;
        continue;
      }
      if (!m) {
        m = new MechModel(this.mats);
        this.mechs.set(h.index, m);
        this.scene.add(m.root);
        const sh = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16).rotateX(-Math.PI / 2), this.shadowMat);
        this.shadows.set(h.index, sh);
        this.scene.add(sh);
      }
      const root = p.rig.root;
      m.root.visible = true;
      m.root.position.set(root.position.x, 0, root.position.z);
      m.root.rotation.y = root.rotation.y;
      m.pose(p.speed, rdt, pl.mechT, time);
      const sh = this.shadows.get(h.index)!;
      sh.visible = true;
      sh.position.set(root.position.x, 0.025, root.position.z);
      // The pilot rides in the cockpit.
      root.position.y = mechLook.pilotY + m.body.position.y * mechLook.scale;
    }
  }

  private renderDrops(drops: readonly GpDrop[], time: number): void {
    const seen = new Set<number>();
    for (const d of drops) {
      seen.add(d.id);
      let m = this.drops.get(d.id);
      if (!m || m.kind !== d.kind) {
        m?.dispose();
        m = new DropModel(d.kind, this.mats, d.kind === 'mech' ? this.beamMat('mech') : this.beamMat(d.kind), this.ringMat);
        this.drops.set(d.id, m);
        this.scene.add(m.root);
      }
      // The flare's column is orange while a crate falls, then the beam takes the crate's colour.
      m.beam.material = d.kind !== 'mech' && d.t < crateTuning.fall ? this.flareMat : this.beamMat(d.kind);
      m.pose(d, time);
    }
    for (const [id, m] of this.drops) {
      if (seen.has(id)) continue;
      m.dispose();
      this.drops.delete(id);
    }
    this.flareMat.opacity = 0.25 + 0.15 * Math.sin(time * 14);
  }

  private renderSpikes(g: Game, alpha: number, time: number): void {
    const sp = this.spikes;
    sp.count = 0;
    for (const e of g.enemies.list) {
      if (!e.active || !e.mutated || e.def.hidden || e.under) continue;
      if (sp.count + SPIKES + 1 > SPIKE_CAP) break;
      const x = e.px + (e.x - e.px) * alpha;
      const z = e.pz + (e.z - e.pz) * alpha;
      const r = e.radius;
      const y = r * 1.05 + e.hopY;
      const spin = time * 1.5 + e.uid;
      const k = 0.8 + r * 1.1;
      for (let i = 0; i < SPIKES; i++) {
        const a = spin + (i / SPIKES) * Math.PI * 2;
        // Cone points +Y; tip it outward and a little up.
        const dir = this.v.set(Math.cos(a), 0.35, Math.sin(a)).normalize();
        this.q.setFromUnitVectors(UP, dir);
        this.m4.compose(this.s.set(x + Math.cos(a) * r * 1.05, y, z + Math.sin(a) * r * 1.05), this.q, SCALE.set(k, k, k));
        sp.setMatrixAt(sp.count++, this.m4);
      }
      // A crown spike on top.
      this.q.identity();
      this.m4.compose(this.s.set(x, r * 2 + e.hopY, z), this.q, SCALE.set(k * 1.2, k * 1.4, k * 1.2));
      sp.setMatrixAt(sp.count++, this.m4);
    }
    commit(sp.instanceMatrix, sp.count);
  }

  private renderHeroFx(g: Game, time: number): void {
    const sats = this.sats;
    const au = this.auras;
    sats.count = 0;
    au.count = 0;
    const T = relicTuning;
    for (const h of g.heroes) {
      const p = h.player;
      if (h.left || p.dead || g.mode === 'title') continue;
      const pl = h.play;
      const root = p.rig.root;
      const x = root.position.x;
      const z = root.position.z;
      for (const s of pl.sats) {
        if (sats.count >= SAT_CAP) break;
        const a = g.runTime * 6 + s.a;
        this.q.setFromEuler(this.e.set(time * 4, time * 3, 0));
        this.m4.compose(this.v.set(x + Math.cos(a) * T.orbitRadius, BULLET_Y + 0.15 * Math.sin(time * 8 + s.a), z + Math.sin(a) * T.orbitRadius), this.q, SCALE.set(1, 1, 1));
        sats.setMatrixAt(sats.count++, this.m4);
      }
      // Ground rings: comeback (red pulse), overload firing (spinning colour) or ready (gold).
      const ring = (r: number, color: string, spin: number) => {
        if (au.count >= AURA_CAP) return;
        this.q.setFromAxisAngle(UP, spin);
        this.m4.compose(this.v.set(x, 0.04, z), this.q, SCALE.set(r, 1, r));
        au.setMatrixAt(au.count, this.m4);
        au.setColorAt(au.count++, this.c.set(color));
      };
      let glow: [number, number, number, number] | null = null;
      if (pl.overloadT > 0) {
        const k = Math.floor(time * 10) % 3;
        ring(2.2 + 0.2 * Math.sin(time * 12), ['#3dffb0', '#7df9ff', '#ffd23f'][k], time * 4);
        glow = k === 0 ? [0.25, 1, 0.7, 0.45] : k === 1 ? [0.5, 0.97, 1, 0.45] : [1, 0.82, 0.25, 0.45];
      } else if (pl.overloadReady) {
        ring(1.1 + 0.05 * Math.sin(time * 4), pl.overload01 >= 0.8 ? '#ffd23f' : '#ffcd75', time);
        glow = [1, 0.85, 0.3, 0.08 + 0.12 * pl.overload01 * (0.5 + 0.5 * Math.sin(time * 6))];
      }
      if (pl.comeback) {
        ring(1.5 + 0.15 * Math.sin(time * 10), '#ff3d5a', -time * 2);
        glow = [1, 0.15, 0.2, 0.3 + 0.2 * Math.sin(time * 10)];
      }
      if (glow && p.hurtFlash <= 0 && !p.dashing) for (const m of p.rig.materials) m.uniforms.uFlash.value.set(...glow);
    }
    commit(sats.instanceMatrix, sats.count);
    commit(au.instanceMatrix, au.count);
    if (au.instanceColor) commit(au.instanceColor, au.count);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const SCALE = new THREE.Vector3();
