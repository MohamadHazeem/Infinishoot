import * as THREE from 'three';
import type { ArenaDeco } from '../world/fieldArena';
import { createRetroMaterial, type RetroMaterial } from './retroMaterial';
import { biomeTex } from './biomeTextures';
import { commit } from './instancing';
import { viewCull } from './viewCull';

/**
 * Animated set dressing of the loop-2 biomes, purely cosmetic and local to
 * every machine (built from the arena's `deco`, which the seed decides):
 * - Neon City: flickering hologram billboards and puffing steam vents
 * - Sky Fortress: flags rippling in the wind and airships drifting past.
 * Meshes live in the arena group, so they're disposed with the arena.
 */
export const biomeFxTuning = {
  /** Steam: seconds a vent puffs, then rests (min, max). */
  ventOn: 2.6,
  ventOff: [2.5, 6] as [number, number],
  puffEvery: 0.06,
  puffLife: 1.5,
  puffRise: 2.4,
  /** Holograms: base brightness and how often they glitch (per second). */
  holoGlow: 0.85,
  glitchRate: 0.18,
  /** Only animate things this close to the camera target. */
  near: 40,
};

const MAX_PUFFS = 160;
const FLAG_W = 2;

interface Holo {
  mesh: THREE.Mesh;
  mat: RetroMaterial;
  base: THREE.Color;
  x: number;
  glitch: number;
  ph: number;
}

interface Flag {
  mesh: THREE.Mesh;
  pos: THREE.BufferAttribute;
  rest: Float32Array;
  ph: number;
}

interface Airship {
  root: THREE.Group;
  prop: THREE.Mesh;
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  len: number;
  speed: number;
  y: number;
  t: number;
}

export class BiomeFx {
  private holos: Holo[] = [];
  private flags: Flag[] = [];
  private ships: Airship[] = [];
  private vents: { x: number; z: number; t: number; on: boolean; emit: number }[] = [];
  private puffs: THREE.InstancedMesh | null = null;
  private px = new Float32Array(MAX_PUFFS);
  private py = new Float32Array(MAX_PUFFS);
  private pz = new Float32Array(MAX_PUFFS);
  private pa = new Float32Array(MAX_PUFFS);
  private pl = new Float32Array(MAX_PUFFS);
  private pvx = new Float32Array(MAX_PUFFS);
  private pvz = new Float32Array(MAX_PUFFS);
  private np = 0;
  private t = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  /** REDUCE FLASHING: holograms hold steady instead of glitching. */
  reduceFlash = false;

  /** Build the animated pieces for a freshly generated arena (or clear them when it has none). */
  load(group: THREE.Group, deco: ArenaDeco | undefined): void {
    this.holos.length = 0;
    this.flags.length = 0;
    this.ships.length = 0;
    this.vents.length = 0;
    this.puffs = null;
    this.np = 0;
    if (!deco) return;
    const holoTex = deco.holos.length ? biomeTex('holo') : null;
    for (const h of deco.holos) {
      const mat = createRetroMaterial({ map: holoTex, color: h.color, unlit: 1, transparent: true, side: THREE.DoubleSide, uvScroll: [0, -0.18] });
      mat.blending = THREE.AdditiveBlending;
      mat.depthWrite = false;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h.w, h.h), mat);
      mesh.position.set(h.x, h.y, h.z);
      mesh.rotation.set(-0.18, h.rot, 0);
      mesh.renderOrder = 2;
      group.add(mesh);
      this.holos.push({ mesh, mat, base: new THREE.Color(h.color), x: h.x, glitch: 0, ph: Math.random() * 10 });
    }
    if (deco.vents.length) {
      const mat = createRetroMaterial({ color: '#f4f0ff', unlit: 0.7 });
      this.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 0), mat, MAX_PUFFS);
      this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.puffs.frustumCulled = false;
      this.puffs.count = 0;
      group.add(this.puffs);
      deco.vents.forEach((v, i) => this.vents.push({ x: v.x, z: v.z, t: (i * 1.7) % 5, on: false, emit: 0 }));
    }
    if (deco.flags.length) {
      const cloth = biomeTex('cloth');
      for (const f of deco.flags) {
        const geo = new THREE.PlaneGeometry(FLAG_W, 1.25, 6, 2);
        geo.translate(FLAG_W / 2, 0, 0); // hinge on the pole
        const mat = createRetroMaterial({ map: cloth, color: f.color, unlit: 0.4, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(f.x, f.h - 0.55, f.z);
        group.add(mesh);
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        pos.setUsage(THREE.DynamicDrawUsage);
        this.flags.push({ mesh, pos, rest: Float32Array.from(pos.array as Float32Array), ph: Math.random() * 6 });
      }
    }
    for (let i = 0; i < deco.airships; i++) this.ships.push(airship(group, i));
  }

  /** `wind`: direction and gust (Sky Fortress); `cx, cz`: camera target. */
  render(dt: number, cx: number, cz: number, wind: { x: number; z: number; gust: number; s: number }): void {
    this.t += dt;
    const t = this.t;
    const T = biomeFxTuning;
    // Holograms: a soft shimmer, and now and then a glitch (dropout plus a sideways jolt).
    for (const h of this.holos) {
      if (!this.reduceFlash && dt > 0 && h.glitch <= 0 && Math.random() < dt * T.glitchRate) h.glitch = 0.12 + Math.random() * 0.2;
      h.glitch -= dt;
      const g = h.glitch > 0;
      const k = T.holoGlow * (0.82 + 0.18 * Math.sin(t * 7 + h.ph)) * (g ? (Math.sin(t * 90) > 0 ? 0.25 : 1.1) : 1);
      h.mat.uniforms.uColor.value.copy(h.base).multiplyScalar(k);
      h.mesh.position.x = h.x + (g ? Math.sin(t * 60) * 0.12 : 0);
    }
    // Steam vents: on/off cycles; puffs rise, swell and shrink away.
    const pm = this.puffs;
    if (pm) {
      for (const v of this.vents) {
        v.t -= dt;
        if (v.t <= 0) {
          v.on = !v.on;
          v.t = v.on ? T.ventOn : T.ventOff[0] + Math.random() * (T.ventOff[1] - T.ventOff[0]);
        }
        if (!v.on || Math.abs(v.x - cx) > T.near || Math.abs(v.z - cz) > T.near) continue;
        v.emit -= dt;
        while (v.emit <= 0 && this.np < MAX_PUFFS) {
          v.emit += T.puffEvery;
          const i = this.np++;
          this.px[i] = v.x + (Math.random() - 0.5) * 0.8;
          this.pz[i] = v.z + (Math.random() - 0.5) * 0.8;
          this.py[i] = 0.2;
          this.pa[i] = 0;
          this.pl[i] = T.puffLife * (0.7 + Math.random() * 0.5);
          this.pvx[i] = (Math.random() - 0.5) * 0.6 + wind.x * wind.s * 0.4;
          this.pvz[i] = (Math.random() - 0.5) * 0.6 + wind.z * wind.s * 0.4;
        }
        if (v.emit <= 0) v.emit = 0;
      }
      let n = 0;
      for (let i = 0; i < this.np; i++) {
        this.pa[i] += dt;
        if (this.pa[i] >= this.pl[i]) continue;
        const k = this.pa[i] / this.pl[i];
        // Compact live puffs to the front as we go.
        this.px[n] = this.px[i] + this.pvx[i] * dt;
        this.pz[n] = this.pz[i] + this.pvz[i] * dt;
        this.py[n] = this.py[i] + T.puffRise * (1 - k * 0.6) * dt;
        this.pa[n] = this.pa[i];
        this.pl[n] = this.pl[i];
        this.pvx[n] = this.pvx[i];
        this.pvz[n] = this.pvz[i];
        const sc = (0.45 + k * 1.2) * (k > 0.65 ? (1 - k) / 0.35 : 1);
        this.q.setFromEuler(this.e.set(k * 2, i * 0.7, 0));
        this.m4.compose(this.v.set(this.px[n], this.py[n], this.pz[n]), this.q, this.s.set(sc, sc * 0.8, sc));
        pm.setMatrixAt(n, this.m4);
        n++;
      }
      this.np = n;
      pm.count = n;
      commit(pm.instanceMatrix, n);
    }
    // Flags: stream downwind and ripple, harder in gusts.
    if (this.flags.length) {
      const yaw = Math.atan2(-wind.z, wind.x);
      const amp = 0.08 + 0.1 * wind.gust;
      const freq = 6 + 4 * wind.gust;
      for (const f of this.flags) {
        f.mesh.rotation.y = yaw + Math.sin(t * 0.7 + f.ph) * 0.12;
        const m = f.mesh.position;
        if (Math.abs(m.x - cx) > T.near || Math.abs(m.z - cz) > T.near || !viewCull.sphere(m.x, m.y, m.z, 1.5)) continue;
        const a = f.pos.array as Float32Array;
        const r = f.rest;
        for (let k = 0; k < a.length; k += 3) {
          const u = r[k] / FLAG_W;
          a[k + 2] = Math.sin(t * freq - u * 5 + f.ph) * amp * 3 * u;
          a[k + 1] = r[k + 1] - u * u * 0.25 * (1 - wind.gust) + Math.sin(t * freq * 0.5 - u * 3) * 0.04 * u;
        }
        f.pos.needsUpdate = true;
      }
    }
    // Airships cruise along their lanes and wrap round; propellers spin.
    for (const a of this.ships) {
      a.t = (a.t + dt * a.speed) % a.len;
      const d = a.t - a.len / 2;
      a.root.position.set(a.x0 + a.dx * d, a.y + Math.sin(t * 0.5 + a.x0) * 0.4, a.z0 + a.dz * d);
      a.prop.rotation.x += dt * 14;
    }
  }
}

/** A chunky toy airship: striped balloon, gondola, fins and a propeller, on a lane around the fortress. */
function airship(group: THREE.Group, i: number): Airship {
  const colors = ['#ff7eb6', '#ffcd75', '#73eff7'];
  const root = new THREE.Group();
  const body = createRetroMaterial({ color: colors[i % 3] });
  const stripe = createRetroMaterial({ color: '#ffffff' });
  const wood = createRetroMaterial({ color: '#8a5a3c' });
  const dark = createRetroMaterial({ color: '#333c57' });
  const size = 1.6 + (i % 2) * 0.5;
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 6), body);
  balloon.scale.set(2.6, 1, 1);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.62, 0.5, 10), stripe);
  band.rotation.z = Math.PI / 2;
  band.scale.set(1, 1, 1);
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 0.9), wood);
  gondola.position.y = -1.9;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.12), body);
  fin.position.set(-3.8, 0, 0);
  const fin2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.8), body);
  fin2.position.set(-3.8, 0, 0);
  const prop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.2), dark);
  prop.position.set(-4.5, 0, 0);
  root.add(balloon, band, gondola, fin, fin2, prop);
  root.scale.setScalar(size / 1.6);
  // Lanes: two across the far side, one down a flank; never between the camera and the field.
  const lanes = [
    { x0: 0, z0: -88, dx: 1, dz: 0, y: 6 },
    { x0: 0, z0: -112, dx: -1, dz: 0, y: 12 },
    { x0: i % 2 ? -92 : 92, z0: -30, dx: 0, dz: 1, y: 3 },
  ];
  const l = lanes[i % 3];
  root.rotation.y = Math.atan2(-l.dz, l.dx);
  group.add(root);
  return { root, prop, x0: l.x0, z0: l.z0, dx: l.dx, dz: l.dz, len: l.dz ? 140 : 300, speed: 2.4 + i * 0.6, y: l.y, t: (i * 97) % 140 };
}
