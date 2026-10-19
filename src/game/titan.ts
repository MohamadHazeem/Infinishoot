/**
 * The Titan (bosses lane, wave 1): an arena-sized colossus that climbs out of
 * the ground and fights from where it stands. Its torso and head are terrain
 * (wall colliders you run around); its arms lie across the field as walkable
 * bridges until it lifts one and sweeps it across the ground in front of it.
 *
 * Five weak points, broken in order (src/data/bossRemix.ts TITAN_PARTS):
 *   phase 1  two shoulder armour plates
 *   phase 2  two hand cores (they ride on the sweeping arms)
 *   phase 3  the eye (its beam keeps firing from the core after)
 *   phase 4  the head cracks open and the core (the boss enemy itself) is exposed
 * Weak points of later phases are sealed (intangible) until their phase.
 *
 * Attacks: arm sweeps (a red sector telegraph, dash through the arm), eye beams
 * (an aim line that tracks you, then a beam that turns toward you), debris rain
 * (telegraphed ground strikes) and quakes (shockwave rings from its chest).
 *
 * Layout is in local metres around the body centre (cx, cz), +z = south (toward
 * the camera): the Titan always faces the camera so the fight reads from above.
 * Gameplay runs on the host (src/game/systems/bossLane.ts); clients mirror a
 * TitanNet and draw the same view.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AABB } from '../world/collision';
import { TITAN_PARTS } from '../data/bossRemix';
import { createRetroMaterial, type RetroMaterial } from '../render/retroMaterial';
import { paint } from '../render/geometry';

export const titanTuning = {
  rise: 3.0, // seconds to climb out of the ground
  wallsAt: 0.35, // rise fraction when its body starts blocking
  zoom: 1.7, // camera pull-back while it stands (auto zoom floor)
  lean: 6, // solo: the camera leans up to this many metres toward its body
  ahead: 12, // it rises this far north of the heroes (its eye ends up ~6 m from them)
  pace: [2.0, 1.6, 1.3, 1.05], // seconds between attacks, per phase
  roar: 2.2, // pause after a weak-point group breaks
  // Arm sweep
  sweepTele: 1.3, // telegraph (the arm rises)
  sweepTime: 0.7, // the swing
  sweepHold: 0.35,
  sweepBack: 1.4, // raised and harmless on the way back
  sweepArc: 1.75, // radians swept
  sweepWidth: 1.3, // half-thickness that hurts (plus the hero's radius)
  sweepDamage: 22,
  stagger: 0.75, // a double sweep's second arm starts this much later
  // Eye beam
  beamAim: 1.1, // aim line tracking you
  beamTime: 1.7, // firing
  beamTurn: 0.55, // rad/s it turns toward you while firing
  beamLen: 36,
  beamWidth: 1.0,
  beamDamage: 9, // per tick
  beamTick: 0.2,
  // Debris rain: strikes around each hero, per phase
  debris: [4, 5, 6, 8],
  debrisDamage: 20,
  quakeDamage: 18, // multiplier on the boss shockwave damage is the Titan's dmgMul
  partGold: 3, // gold drops per broken weak point
};

/** Body layout in local metres (+z = south, toward the camera). Right side shown; left mirrors x. */
export const titanLayout = {
  torso: { x: 0, z: -2, hx: 7, hz: 4 },
  head: { x: 0, z: 3.6, hx: 3, hz: 1.9 },
  core: { x: 0, z: 3.4 },
  plate: { x: 6.2, z: 2.9 },
  eye: { x: 0, z: 6.3 },
  shoulder: { x: 7, z: -1 },
  arm: 13, // shoulder to hand
  rest: Math.atan2(8, 10), // right arm's resting angle (atan2(z, x)); the left mirrors it
};

export type TitanMove = '' | 'sweep' | 'sweep2' | 'beam' | 'debris' | 'quake';

/** Attack rotation per phase. */
export const TITAN_ORDER: TitanMove[][] = [
  ['sweep', 'debris', 'sweep', 'beam'],
  ['beam', 'sweep2', 'debris', 'quake', 'sweep'],
  ['sweep2', 'beam', 'quake', 'debris', 'beam'],
  ['beam', 'sweep2', 'quake', 'debris', 'sweep2', 'beam'],
];

/** Arm resting angle for side -1 (left) or 1 (right). */
export const restAngle = (side: number): number => (side > 0 ? titanLayout.rest : Math.PI - titanLayout.rest);
/** Where a sweep of that arm ends: across the ground in front of the Titan. */
export const sweepEnd = (side: number): number => restAngle(side) + side * titanTuning.sweepArc;

/** Wall boxes of the body at (cx, cz): the torso, and the head until the core is exposed. */
export function titanBoxes(cx: number, cz: number, head: boolean): AABB[] {
  const L = titanLayout;
  const box = (b: { x: number; z: number; hx: number; hz: number }): AABB => ({ minX: cx + b.x - b.hx, maxX: cx + b.x + b.hx, minZ: cz + b.z - b.hz, maxZ: cz + b.z + b.hz });
  return head ? [box(L.torso), box(L.head)] : [box(L.torso)];
}

/** Shoulder pivot of an arm. */
export function shoulderPos(cx: number, cz: number, side: number, out: { x: number; z: number }): void {
  out.x = cx + side * titanLayout.shoulder.x;
  out.z = cz + titanLayout.shoulder.z;
}

/** Hand position for an arm at angle `ang`. */
export function handPos(cx: number, cz: number, side: number, ang: number, out: { x: number; z: number }): void {
  shoulderPos(cx, cz, side, out);
  out.x += Math.cos(ang) * titanLayout.arm;
  out.z += Math.sin(ang) * titanLayout.arm;
}

/** World position of weak point i (TITAN_PARTS order) given the arm angles. */
export function partPos(i: number, cx: number, cz: number, arm: readonly number[], out: { x: number; z: number }): void {
  const p = TITAN_PARTS[i];
  const L = titanLayout;
  if (p.kind === 'hand') handPos(cx, cz, p.side, arm[p.side > 0 ? 1 : 0], out);
  else if (p.kind === 'plate') {
    out.x = cx + p.side * L.plate.x;
    out.z = cz + L.plate.z;
  } else {
    out.x = cx + L.eye.x;
    out.z = cz + L.eye.z;
  }
}

/** The phase the Titan is in, from which weak points still stand (1 + groups fully broken, up to 4). */
export function titanPhaseOf(alive: readonly boolean[]): number {
  for (let g = 1; g <= 3; g++) if (TITAN_PARTS.some((p, i) => p.group === g && alive[i])) return g;
  return 4;
}

/** Distance from (px, pz) to the segment (ax, az)-(bx, bz). */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * k), pz - (az + dz * k));
}

const smooth = (u: number): number => u * u * (3 - 2 * u);

/** An arm sweep at `t` seconds in: progress along the arc (0 = rest, 1 = swept), lift (0 down .. 1 raised), hurting? */
export function sweepPose(t: number, out: { k: number; lift: number; hurt: boolean; tele: number }): boolean {
  const T = titanTuning;
  out.hurt = false;
  out.tele = 0;
  if (t < 0) {
    out.k = 0;
    out.lift = 0;
    return false;
  }
  if (t < T.sweepTele) {
    const u = t / T.sweepTele;
    out.k = -0.08 * smooth(u); // winds back a little
    out.lift = smooth(u);
    out.tele = u;
    return false;
  }
  t -= T.sweepTele;
  if (t < T.sweepTime) {
    const u = t / T.sweepTime;
    out.k = smooth(u) * 1.08 - 0.08;
    out.lift = u < 0.2 ? 1 - (u / 0.2) * 0.92 : 0.08; // slams down, then drags along the ground
    out.hurt = u >= 0.14;
    out.tele = 1;
    return false;
  }
  t -= T.sweepTime;
  if (t < T.sweepHold) {
    out.k = 1;
    out.lift = 0.08;
    return false;
  }
  t -= T.sweepHold;
  if (t < T.sweepBack) {
    const u = t / T.sweepBack;
    out.k = 1 - smooth(u);
    out.lift = 0.08 + Math.sin(u * Math.PI) * 0.8; // raised on the way back: harmless
    return false;
  }
  out.k = 0;
  out.lift = 0;
  return true;
}

/** sweepT of an idle arm (a staggered sweep starts at -stagger, so idle needs its own value). */
export const SWEEP_IDLE = -9;
export const sweeping = (t: number): boolean => t > SWEEP_IDLE + 1;

/** Total length of one arm sweep. */
export const sweepLength = (): number => titanTuning.sweepTele + titanTuning.sweepTime + titanTuning.sweepHold + titanTuning.sweepBack;

/** Titan state on every machine (host simulates it; clients mirror TitanNet). */
export class TitanState {
  uid = 0;
  cx = 0;
  cz = 0;
  rise = 0;
  phase = 1;
  /** Arm angles (atan2(z, x)) and lifts, [left, right]. */
  arm = [restAngle(-1), restAngle(1)];
  lift = [0, 0];
  /** Seconds into each arm's sweep (SWEEP_IDLE = idle; negative = a staggered sweep about to start). */
  sweepT = [SWEEP_IDLE, SWEEP_IDLE];
  /** Heroes each arm already hit this sweep (bitmask). */
  hit = [0, 0];
  /** Beam: 0 off, 1 aiming, 2 firing; its angle and timers. */
  beamMode = 0;
  beamAng = Math.PI / 2;
  beamT = 0;
  beamTick = 0;
  move: TitanMove = '';
  moveT = 0;
  /** Seconds to the next attack. */
  cool = 1.2; // counts down once it has risen
  step = 0;
  /** Weak points: enemy uids and life fractions (0 = broken), TITAN_PARTS order. */
  partUid = [0, 0, 0, 0, 0];
  partHp = [1, 1, 1, 1, 1];
  /** Host: which parts have already been counted as broken. */
  broken = [false, false, false, false, false];
}

/** What clients get each snapshot (inside the boss extras, see systems/bossLane.ts). */
export interface TitanNet {
  u: number;
  c: [number, number];
  r: number;
  p: number;
  a: [number, number];
  l: [number, number];
  s: [number, number];
  b: [number, number];
  h: number[];
  i: number[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function packTitan(s: TitanState): TitanNet {
  return {
    u: s.uid,
    c: [r2(s.cx), r2(s.cz)],
    r: r2(s.rise),
    p: s.phase,
    a: [r3(s.arm[0]), r3(s.arm[1])],
    l: [r2(s.lift[0]), r2(s.lift[1])],
    s: [r2(s.sweepT[0]), r2(s.sweepT[1])],
    b: [s.beamMode, r3(s.beamAng)],
    h: s.partHp.map(r2),
    i: s.partUid.slice(),
  };
}

export function unpackTitan(n: TitanNet, s: TitanState): void {
  s.uid = n.u;
  s.cx = n.c[0];
  s.cz = n.c[1];
  s.rise = n.r;
  s.phase = n.p;
  s.arm[0] = n.a[0];
  s.arm[1] = n.a[1];
  s.lift[0] = n.l[0];
  s.lift[1] = n.l[1];
  s.sweepT[0] = n.s[0];
  s.sweepT[1] = n.s[1];
  s.beamMode = n.b[0];
  s.beamAng = n.b[1];
  for (let i = 0; i < 5; i++) {
    s.partHp[i] = n.h[i] ?? 0;
    s.partUid[i] = n.i[i] ?? 0;
  }
}

/** Where the beam starts: the eye while it stands, then the exposed core. */
export function beamOrigin(s: TitanState, out: { x: number; z: number }): void {
  const L = titanLayout;
  const eye = s.partHp[4] > 0;
  out.x = s.cx + (eye ? L.eye.x : L.core.x);
  out.z = s.cz + (eye ? L.eye.z : L.core.z);
}

// ------------------------------------------------------------------ view

const STONE = '#94b0c2';
const DARK = '#566c86';
const MOSS = '#38b764';
const GOLD = '#ffcd75';
const GLOW = '#73eff7';
const INK = '#1a1c2c';
const PART_COLORS = ['#ffcd75', '#ffcd75', '#73eff7', '#73eff7', '#ff3d5a'];

type Add = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => void;
function build(fn: (add: Add) => void): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  fn((g, color, x, y, z) => {
    const ng = (g.index ? g.toNonIndexed() : g).translate(x, y, z);
    ng.deleteAttribute('uv');
    parts.push(paint(ng, color));
  });
  return mergeGeometries(parts)!;
}

/**
 * The Titan's meshes: body, head (opens in phase 4), two arms (yaw at the
 * shoulder, pitch for the lift), weak points, sweep sectors, the beam and its
 * aim line. A handful of draw calls, only while a Titan stands.
 */
export class TitanView {
  readonly group = new THREE.Group();
  private body: THREE.Mesh;
  private head: THREE.Mesh;
  private jaw: THREE.Mesh;
  private armYaw: THREE.Group[] = [];
  private armLift: THREE.Group[] = [];
  private parts: THREE.Mesh[] = [];
  private partMats: RetroMaterial[] = [];
  private stubs: THREE.Mesh[] = [];
  private core: THREE.Mesh;
  private coreMat: RetroMaterial;
  private sectors: THREE.Mesh[] = [];
  private sectorMat: THREE.MeshBasicMaterial;
  private beam: THREE.Mesh;
  private beamCore: THREE.Mesh;
  private aim: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private aimMat: THREE.MeshBasicMaterial;
  private shown = { arm: [0, 0], lift: [0, 0], beam: 0, rise: 0, open: 0 };
  private p = { x: 0, z: 0 };
  /** Seconds since the Titan fell (-1 = standing); it sinks back into the ground. */
  fallT = -1;

  constructor(scene: THREE.Scene) {
    const L = titanLayout;
    const mat = createRetroMaterial({ vertexColors: true });
    // Torso: a mossy stone hump with a darker spine and crystal spikes, shoulder boulders.
    const T = L.torso;
    this.body = new THREE.Mesh(
      build((add) => {
        add(new THREE.BoxGeometry(T.hx * 2, 6, T.hz * 2), STONE, T.x, 3, T.z);
        add(new THREE.BoxGeometry(T.hx * 2 - 2, 2.4, T.hz * 2 - 1.5), DARK, T.x, 7.2, T.z - 0.5);
        add(new THREE.BoxGeometry(T.hx * 2 - 4, 0.6, T.hz * 2 - 3), MOSS, T.x, 8.6, T.z - 0.8);
        add(new THREE.BoxGeometry(T.hx * 2 + 0.2, 0.5, 0.5), GOLD, T.x, 5.6, T.z + T.hz + 0.05);
        for (let k = -2; k <= 2; k++) add(new THREE.ConeGeometry(0.9, 3 - Math.abs(k) * 0.4, 4), GLOW, k * 2.6, 9.6 - Math.abs(k) * 0.3, T.z - 1.5);
        for (const sx of [-1, 1]) {
          add(new THREE.BoxGeometry(4, 4.6, 5), STONE, sx * L.shoulder.x, 4.4, L.shoulder.z);
          add(new THREE.BoxGeometry(4.2, 0.6, 5.2), DARK, sx * L.shoulder.x, 6.9, L.shoulder.z);
          add(new THREE.ConeGeometry(0.7, 2.2, 4), GOLD, sx * (L.shoulder.x + 0.8), 8, L.shoulder.z);
          // Glowing cracks down the chest.
          add(new THREE.BoxGeometry(0.3, 3.4, 0.2), GLOW, sx * 2.2, 2.6, T.z + T.hz + 0.02);
        }
      }),
      mat,
    );
    // Head: a heavy stone skull resting on the ground; the brow and horns frame the eye.
    const H = L.head;
    this.head = new THREE.Mesh(
      build((add) => {
        add(new THREE.BoxGeometry(H.hx * 2, 4.2, H.hz * 2), STONE, 0, 2.6, 0);
        add(new THREE.BoxGeometry(H.hx * 2 + 0.6, 1, H.hz * 2 + 0.4), DARK, 0, 4.9, 0.2);
        add(new THREE.BoxGeometry(1.8, 1.8, 0.4), INK, 0, 3.2, H.hz + 0.05); // eye socket
        for (const sx of [-1, 1]) add(new THREE.ConeGeometry(0.6, 2.6, 4).rotateZ(-sx * 0.5), GOLD, sx * (H.hx + 0.2), 5.6, 0);
      }),
      mat,
    );
    this.head.position.set(H.x, 0, H.z);
    this.jaw = new THREE.Mesh(
      build((add) => {
        add(new THREE.BoxGeometry(H.hx * 2 - 0.4, 1.2, H.hz * 2 - 0.2), DARK, 0, 0.6, 0);
        for (let k = -2; k <= 2; k++) add(new THREE.ConeGeometry(0.25, 0.7, 4), '#f4f4f4', k * 1.1, 1.4, H.hz - 0.2);
      }),
      mat,
    );
    this.jaw.position.set(H.x, 0, H.z);
    this.group.add(this.body, this.head, this.jaw);
    // Arms: built along +x from the shoulder; the forearm and fist lie low on the ground (walkable).
    const armGeo = build((add) => {
      const A = L.arm;
      add(new THREE.BoxGeometry(5.6, 2.2, 2.4).rotateZ(-0.38), STONE, 2.6, 3.0, 0);
      add(new THREE.BoxGeometry(5.8, 0.4, 2.5).rotateZ(-0.38), DARK, 2.7, 4.1, 0);
      add(new THREE.SphereGeometry(1.3, 6, 4), DARK, 5.6, 1.7, 0);
      add(new THREE.BoxGeometry(A - 7.5, 1.1, 2.2), STONE, (5.6 + A - 1.6) / 2, 0.75, 0);
      add(new THREE.BoxGeometry(A - 7.5, 0.25, 2.3), MOSS, (5.6 + A - 1.6) / 2, 1.35, 0);
      add(new THREE.BoxGeometry(3.2, 1.6, 3.2), STONE, A, 0.8, 0);
      for (let k = -1; k <= 1; k++) add(new THREE.BoxGeometry(1.4, 0.8, 0.7), DARK, A + 1.9, 0.4, k * 1.05);
      add(new THREE.BoxGeometry(0.9, 0.8, 0.8), DARK, A - 0.6, 0.5, 1.9);
    });
    for (const sx of [-1, 1]) {
      const yaw = new THREE.Group();
      yaw.position.set(sx * L.shoulder.x, 3.6, L.shoulder.z);
      const lift = new THREE.Group();
      const arm = new THREE.Mesh(armGeo, mat);
      arm.position.y = -3.6;
      lift.add(arm);
      yaw.add(lift);
      this.group.add(yaw);
      this.armYaw.push(yaw);
      this.armLift.push(lift);
    }
    // Weak points: plates on the shoulders, cores on the fists, the eye in its socket.
    const plateGeo = build((add) => {
      add(new THREE.BoxGeometry(3, 2.4, 0.7), '#ffffff', 0, 0, 0);
      add(new THREE.BoxGeometry(3.3, 0.35, 0.8), GOLD, 0, 1.25, 0);
      add(new THREE.BoxGeometry(3.3, 0.35, 0.8), GOLD, 0, -1.25, 0);
      add(new THREE.OctahedronGeometry(0.45, 0), GOLD, 0, 0, 0.4);
    });
    const coreGeo = new THREE.OctahedronGeometry(1.1, 0);
    const eyeGeo = new THREE.SphereGeometry(0.95, 8, 6);
    const stubGeo = paint(new THREE.CylinderGeometry(0.8, 1.1, 0.5, 6).toNonIndexed(), INK);
    const stubMat = createRetroMaterial({ vertexColors: true });
    TITAN_PARTS.forEach((p, i) => {
      const m = createRetroMaterial({ color: PART_COLORS[i], unlit: p.kind === 'plate' ? 0.25 : 1 });
      const mesh = new THREE.Mesh(p.kind === 'plate' ? plateGeo : p.kind === 'hand' ? coreGeo : eyeGeo, m);
      const stub = new THREE.Mesh(stubGeo, stubMat);
      stub.visible = false;
      if (p.kind === 'hand') {
        // Rides on the fist (inside the arm's lift group).
        mesh.position.set(L.arm, 2.2 - 3.6, 0);
        stub.position.set(L.arm, 1.75 - 3.6, 0);
        this.armLift[p.side > 0 ? 1 : 0].add(mesh, stub);
      } else if (p.kind === 'plate') {
        mesh.position.set(p.side * L.plate.x, 4.4, L.plate.z - 0.6);
        mesh.rotation.y = p.side * 0.25;
        stub.position.set(p.side * L.plate.x, 4.4, L.plate.z - 0.7);
        stub.rotation.x = Math.PI / 2;
        this.group.add(mesh, stub);
      } else {
        mesh.position.set(0, 3.2, H.hz + 0.2);
        this.head.add(mesh);
        stub.position.set(0, 3.2, H.hz + 0.15);
        stub.rotation.x = Math.PI / 2;
        this.head.add(stub);
      }
      this.parts.push(mesh);
      this.partMats.push(m);
      this.stubs.push(stub);
    });
    this.coreMat = createRetroMaterial({ color: GOLD, unlit: 1 });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 0), this.coreMat);
    this.core.position.set(L.core.x, 2.6, L.core.z);
    this.core.visible = false;
    this.group.add(this.core);
    // Telegraphs (world space, not part of the body group).
    this.sectorMat = new THREE.MeshBasicMaterial({ color: '#ff2d4a', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
    const secGeo = new THREE.CircleGeometry(1, 28, 0, titanTuning.sweepArc + 0.16).rotateX(-Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(secGeo, this.sectorMat);
      m.visible = false;
      m.renderOrder = 1;
      m.frustumCulled = false;
      scene.add(m);
      this.sectors.push(m);
    }
    const unitBeam = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: '#ff3d5a', transparent: true, opacity: 0.75, depthWrite: false });
    this.beam = new THREE.Mesh(unitBeam, this.beamMat);
    this.beamCore = new THREE.Mesh(unitBeam, new THREE.MeshBasicMaterial({ color: '#f4f4f4' }));
    this.aimMat = new THREE.MeshBasicMaterial({ color: '#ff2d4a', transparent: true, opacity: 0.5, depthWrite: false });
    this.aim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0), this.aimMat);
    for (const m of [this.beam, this.beamCore, this.aim]) {
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 1;
      scene.add(m);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  hide(): void {
    this.group.visible = false;
    for (const m of [...this.sectors, this.beam, this.beamCore, this.aim]) m.visible = false;
    this.fallT = -1;
  }

  /**
   * Pose the Titan for this frame. `flash(i)` is weak point i's hit flash (0..1,
   * index 5 = the core). Arms and beam ease toward the synced pose so clients
   * stay smooth between snapshots.
   */
  update(s: TitanState, time: number, dt: number, flash: (i: number) => number, calm: boolean): void {
    const L = titanLayout;
    const sh = this.shown;
    const k = 1 - Math.exp(-18 * dt);
    this.group.visible = true;
    this.group.position.set(s.cx, 0, s.cz);
    // Rising out of the ground (and sinking back when it falls).
    const fall = this.fallT >= 0 ? Math.min(1, this.fallT / 2.4) : 0;
    sh.rise += (s.rise - sh.rise) * k;
    const sink = (1 - sh.rise) * 11 + fall * fall * 12;
    this.group.position.y = -sink + (this.fallT >= 0 ? Math.sin(time * 40) * 0.12 * (1 - fall) : 0);
    this.group.rotation.z = this.fallT >= 0 ? fall * 0.12 : 0;
    // Head opens in phase 4: the skull tips back, the jaw drops, the core glows inside.
    const open = s.phase >= 4 ? 1 : 0;
    sh.open += (open - sh.open) * (1 - Math.exp(-3 * dt));
    this.head.rotation.x = -sh.open * 1.1;
    this.head.position.z = L.head.z - sh.open * 1.6;
    this.jaw.position.z = L.head.z + sh.open * 1.2;
    this.jaw.position.y = -sh.open * 0.5;
    this.core.visible = sh.open > 0.05;
    this.core.rotation.y = time * 1.6;
    this.core.position.y = 2.6 + Math.sin(time * 3) * 0.25;
    const cf = flash(5);
    this.coreMat.uniforms.uFlash.value.set(1, 1, 1, cf > 0 ? 0.85 : 0);
    // Arms.
    for (let a = 0; a < 2; a++) {
      let d = s.arm[a] - sh.arm[a];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      sh.arm[a] += d * k;
      sh.lift[a] += (s.lift[a] - sh.lift[a]) * k;
      this.armYaw[a].rotation.y = -sh.arm[a];
      this.armLift[a].rotation.z = sh.lift[a] * 0.75;
    }
    // Weak points: lit while they can be hit, dim while sealed, stubs once broken.
    TITAN_PARTS.forEach((p, i) => {
      const alive = s.partHp[i] > 0;
      const open = alive && p.group <= s.phase;
      const mesh = this.parts[i];
      mesh.visible = alive;
      this.stubs[i].visible = !alive;
      const m = this.partMats[i];
      m.uniforms.uColor.value.set(PART_COLORS[i]).multiplyScalar(open ? 1 : 0.35);
      const f = flash(i);
      const pulse = open && !calm ? 0.18 + 0.12 * Math.sin(time * 9 + i) : 0;
      m.uniforms.uFlash.value.set(1, f > 0 ? 1 : 0.9, f > 0 ? 1 : 0.6, f > 0 ? 0.85 : pulse);
      if (p.kind !== 'plate') mesh.rotation.y = time * 1.3 + i;
      // Cracks: a weak point shrinks a little as it loses life.
      const sc = 0.8 + 0.2 * s.partHp[i];
      mesh.scale.setScalar(sc);
    });
    // Sweep telegraphs: a red sector from the shoulder over the arc the arm will cover.
    const P = this.p;
    this.sectorMat.opacity = calm ? 0.3 : 0.22 + 0.12 * Math.sin(time * 26);
    for (let a = 0; a < 2; a++) {
      const side = a === 0 ? -1 : 1;
      const t = s.sweepT[a];
      const sec = this.sectors[a];
      const live = t >= 0 && sweeping(t) && t < titanTuning.sweepTele + titanTuning.sweepTime && this.fallT < 0;
      sec.visible = live;
      if (!live) continue;
      shoulderPos(s.cx, s.cz, side, P);
      const lo = Math.min(restAngle(side), sweepEnd(side)) - 0.08;
      const hi = lo + titanTuning.sweepArc + 0.16;
      sec.position.set(P.x, 0.07, P.z);
      sec.rotation.y = -hi; // base sector covers [-arc, 0]; rotating maps it to [lo, hi]
      const R = (L.arm + 1.8) * (t < titanTuning.sweepTele ? 0.55 + 0.45 * (t / titanTuning.sweepTele) : 1);
      sec.scale.set(R, 1, R);
    }
    // Eye beam: an aim line while it tracks you, then the beam.
    beamOrigin(s, P);
    const bm = this.fallT >= 0 ? 0 : s.beamMode;
    let bd = s.beamAng - sh.beam;
    bd = Math.atan2(Math.sin(bd), Math.cos(bd));
    sh.beam += bd * (bm ? k : 1);
    this.aim.visible = bm === 1;
    this.beam.visible = this.beamCore.visible = bm === 2;
    const y = this.group.position.y;
    if (bm === 1) {
      this.aim.position.set(P.x, 0.08, P.z);
      this.aim.rotation.y = -sh.beam;
      this.aim.scale.set(titanTuning.beamLen, 1, 0.25 + (calm ? 0 : 0.1 * Math.sin(time * 30)));
      this.aimMat.opacity = calm ? 0.55 : 0.4 + 0.25 * Math.sin(time * 24);
    } else if (bm === 2) {
      const w = titanTuning.beamWidth * 2 * (calm ? 1 : 0.9 + 0.1 * Math.sin(time * 50));
      this.beam.position.set(P.x, 1.3 + Math.max(0, y), P.z);
      this.beam.rotation.y = -sh.beam;
      this.beam.scale.set(titanTuning.beamLen, w * 0.8, w);
      this.beamCore.position.copy(this.beam.position);
      this.beamCore.rotation.y = -sh.beam;
      this.beamCore.scale.set(titanTuning.beamLen, w * 0.35, w * 0.4);
    }
  }
}
