/**
 * Boss duel (bosses lane, wave 1): when a stage boss reaches its last phase,
 * the horde clears out (enemies vanish in a puff, no drops; pickups stay), the
 * director stops sending more, and a ring of fire closes in around the boss
 * and the heroes for a one-on-one showdown. Outside the ring you burn (a share
 * of max life per tick, through armour); the boss is held inside it.
 *
 * `game.bossDuel` (src/game/game.ts) is non-null on every machine while a duel
 * plays (clients get it in the boss extras). The music can key off it for a
 * call-and-response duel theme: `game.bossDuel.t` = seconds since it began.
 * Gameplay runs on the host in src/game/systems/bossLane.ts; this module is the
 * pure ring math and the ring-of-fire view.
 */
import * as THREE from 'three';
import { commit } from '../render/instancing';

export const duelTuning = {
  enabled: true,
  delay: 1.4, // seconds before the ring starts closing
  shrink: 11, // seconds to close from its start radius to the final one
  rMin: 9, // final radius (at least this...)
  bossPad: 3.5, // ...and at least the boss's radius x this
  rMax: 30, // start radius cap
  pad: 4, // start radius = farthest hero (or the boss) from the centre + this
  dps: 0.1, // share of max life per second outside the ring (ticks, through armour)
  tick: 0.5,
  flames: 84, // flame tongues around the ring
};

/** Live duel state (host simulates; clients mirror). */
export interface BossDuel {
  /** The boss's uid. */
  uid: number;
  /** Ring centre. */
  x: number;
  z: number;
  /** Current, start and final radius. */
  r: number;
  r0: number;
  r1: number;
  /** Seconds since the duel began. */
  t: number;
}

/** Ring radius `t` seconds into a duel. */
export function duelRadius(r0: number, r1: number, t: number): number {
  const T = duelTuning;
  const u = Math.max(0, Math.min(1, (t - T.delay) / T.shrink));
  const e = u * u * (3 - 2 * u);
  return r0 + (r1 - r0) * e;
}

/**
 * Where the ring goes and how big it starts: centred between the boss and the
 * heroes, wide enough to hold all of them (capped), kept inside the arena.
 */
export function duelStart(boss: { x: number; z: number; radius: number }, heroes: { x: number; z: number }[], half: number): { x: number; z: number; r0: number; r1: number } {
  const T = duelTuning;
  let hx = boss.x;
  let hz = boss.z;
  if (heroes.length) {
    hx = 0;
    hz = 0;
    for (const h of heroes) {
      hx += h.x;
      hz += h.z;
    }
    hx /= heroes.length;
    hz /= heroes.length;
  }
  const r1 = Math.max(T.rMin, boss.radius * T.bossPad);
  let x = (boss.x + hx) / 2;
  let z = (boss.z + hz) / 2;
  const lim = Math.max(0, half - r1 - 1);
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(lim, z));
  let far = Math.hypot(boss.x - x, boss.z - z) + boss.radius;
  for (const h of heroes) far = Math.max(far, Math.hypot(h.x - x, h.z - z));
  const r0 = Math.max(r1 + 2, Math.min(T.rMax, far + T.pad));
  return { x, z, r0, r1 };
}

/** Push a circle at (x, z) with radius r back inside ring (cx, cz, R). Returns true if it moved. */
export function keepInside(p: { x: number; z: number }, r: number, cx: number, cz: number, R: number): boolean {
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d = Math.hypot(dx, dz);
  const max = Math.max(0, R - r);
  if (d <= max || d < 1e-6) return false;
  p.x = cx + (dx / d) * max;
  p.z = cz + (dz / d) * max;
  return true;
}

export type DuelNet = [number, number, number, number, number, number, number];
const r2 = (v: number) => Math.round(v * 100) / 100;
export const packDuel = (d: BossDuel): DuelNet => [d.uid, r2(d.x), r2(d.z), r2(d.r), r2(d.r0), r2(d.r1), r2(d.t)];
export const unpackDuel = (n: DuelNet): BossDuel => ({ uid: n[0], x: n[1], z: n[2], r: n[3], r0: n[4], r1: n[5], t: n[6] });

/** The ring of fire: flame tongues around the circle, a burning band and a red tint outside. */
export class DuelView {
  private flames: THREE.InstancedMesh;
  private band: THREE.Mesh;
  private outside: THREE.Mesh;
  private bandMat: THREE.MeshBasicMaterial;
  private outMat: THREE.MeshBasicMaterial;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  /** Seconds since the ring went out (fades the flames down). */
  private gone = -1;
  private last = { x: 0, z: 0, r: 0 };

  constructor(scene: THREE.Scene) {
    const n = duelTuning.flames;
    this.flames = new THREE.InstancedMesh(new THREE.ConeGeometry(0.45, 1, 4).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flames.setColorAt(0, this.c.set('#ef7d57'));
    this.flames.count = 0;
    this.bandMat = new THREE.MeshBasicMaterial({ color: '#ef7d57', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    this.band = new THREE.Mesh(new THREE.RingGeometry(0.955, 1, 72).rotateX(-Math.PI / 2), this.bandMat);
    this.outMat = new THREE.MeshBasicMaterial({ color: '#b13e53', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    this.outside = new THREE.Mesh(new THREE.RingGeometry(1, 3.2, 72).rotateX(-Math.PI / 2), this.outMat);
    for (const m of [this.flames, this.band, this.outside]) {
      m.frustumCulled = false;
      m.renderOrder = 1;
      m.visible = false;
      scene.add(m);
    }
  }

  hide(): void {
    this.flames.visible = this.band.visible = this.outside.visible = false;
    this.gone = -1;
  }

  /** Draw the ring (or fade out the last one when `d` is null). `calm` = REDUCE FLASHING (no flicker). */
  update(d: BossDuel | null, time: number, dt: number, calm: boolean): void {
    let fade = 1;
    if (d) {
      this.gone = -1;
      this.last.x = d.x;
      this.last.z = d.z;
      this.last.r = d.r;
    } else {
      if (this.gone < 0 && !this.band.visible) return;
      this.gone = this.gone < 0 ? 0 : this.gone + dt;
      fade = Math.max(0, 1 - this.gone / 0.8);
      if (fade <= 0) {
        this.hide();
        return;
      }
    }
    const { x, z, r } = this.last;
    // Born: the ring flares up from nothing over its first half second.
    const born = d ? Math.min(1, d.t / 0.5) : 1;
    const k = born * fade;
    this.band.visible = this.outside.visible = this.flames.visible = true;
    this.band.position.set(x, 0.09, z);
    this.band.scale.set(r, 1, r);
    this.outside.position.set(x, 0.06, z);
    this.outside.scale.set(r, 1, r);
    this.bandMat.opacity = (calm ? 0.7 : 0.6 + 0.2 * Math.sin(time * 14)) * k;
    this.outMat.opacity = 0.16 * k;
    const n = duelTuning.flames;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + time * 0.15;
      const flick = calm ? 0.8 : 0.6 + 0.4 * Math.abs(Math.sin(time * 9 + i * 1.7));
      const h = (1.1 + (i % 3) * 0.35) * flick * k;
      this.q.setFromAxisAngle(this.up, a);
      this.m4.compose(this.v.set(x + Math.cos(a) * r, 0, z + Math.sin(a) * r), this.q, this.s.set(1, h, 1));
      this.flames.setMatrixAt(i, this.m4);
      this.flames.setColorAt(i, this.c.set(i % 3 === 0 ? '#ffcd75' : i % 3 === 1 ? '#ef7d57' : '#b13e53'));
    }
    this.flames.count = n;
    commit(this.flames.instanceMatrix, n);
    if (this.flames.instanceColor) commit(this.flames.instanceColor, n);
  }
}
