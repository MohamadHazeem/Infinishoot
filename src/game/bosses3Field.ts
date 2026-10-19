import * as THREE from 'three';
import { commit } from '../render/instancing';
import type { Enemy } from './enemies';
import { beatAt, beatLen, bosses3Tuning, gridShift } from './bosses3';

/** A Glitch DJ laser grid. Lines step along `ang`; the first hot beat is b0 + 2. */
export interface Grid3 {
  cx: number;
  cz: number;
  ang: number;
  n: number;
  sp: number;
  len: number;
  b0: number;
  beats: number;
  flip: boolean;
  dmg: number;
  /** Host: heroes hit this beat (bitmask) and which beat that was. */
  hit: number;
  hitBeat: number;
}

/** A straight hazard: a punch line (kind 0) or a pinball path segment (kind 1, never hurts). */
export interface Beam3 {
  x: number;
  z: number;
  ang: number;
  len: number;
  half: number;
  tele: number;
  life: number;
  dmg: number;
  hit: number;
  kind: number;
}

export interface Gust3 {
  dx: number;
  dz: number;
  tele: number;
  life: number;
  pulse: number;
}

export interface Bolt3 {
  x: number;
  z: number;
  t: number;
  /** Seconds the bolt has been on screen after striking (drawing only). */
  shown: number;
  dmg: number;
}

/** What clients get each snapshot (inside the boss extras, BossNet.g). */
export interface Bosses3Net {
  /** DJ beat clock (-1 = no DJ). */
  c: number;
  /** Grids: cx, cz, ang, n, spacing, length, b0, beats, flip. */
  g: [number, number, number, number, number, number, number, number, number][];
  /** Beams: x, z, ang, len, half, tele, life, kind. */
  m: [number, number, number, number, number, number, number, number][];
  /** Gust: dx, dz, tele, life. */
  w: [number, number, number, number] | null;
  /** Bolts: x, z, seconds to strike, seconds shown. */
  l: [number, number, number, number][];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const LINE_CAP = 160;
const ARROW_CAP = 48;
const BOLT_CAP = 16;
const BAR_CAP = 64;
const GLOVE_CAP = 6;

/**
 * The biome bosses' arena, shared by host and clients, and its drawing: laser
 * grids, punch lines and pinball paths, wind-gust arrows, lightning bolts, the
 * DJ's equalizer ring and Boxer Jack's gloves. Gameplay (damage, pushes,
 * spawns) runs on the host in src/game/systems/bosses3.ts.
 */
export class Bosses3Field {
  clock = 0;
  clockOn = false;
  grids: Grid3[] = [];
  beams: Beam3[] = [];
  gust: Gust3 | null = null;
  bolts: Bolt3[] = [];
  /** Host: boarding parties waiting to land. */
  boards: { x: number; z: number; t: number; n: number; uid: number }[] = [];

  private tele: THREE.InstancedMesh;
  private hot: THREE.InstancedMesh;
  private cold: THREE.InstancedMesh;
  private arrows: THREE.InstancedMesh;
  private boltMesh: THREE.InstancedMesh;
  private bars: THREE.InstancedMesh;
  private gloves: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private teleMat: THREE.MeshBasicMaterial;
  private arrowMat: THREE.MeshBasicMaterial;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  private beat = { n: 0, f: 0 };

  constructor(scene: THREE.Scene) {
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, order = 1) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.renderOrder = order;
      m.count = 0;
      scene.add(m);
      return m;
    };
    // Flat strips along +Z (length 1, width 1), lying on the ground.
    const strip = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.teleMat = new THREE.MeshBasicMaterial({ color: '#ff2d4a', transparent: true, opacity: 0.4, depthWrite: false });
    this.tele = inst(strip(), this.teleMat, LINE_CAP);
    this.hot = inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: '#ffffff' }), LINE_CAP, 2);
    this.hot.setColorAt(0, this.c.set('#ffffff'));
    this.cold = inst(strip(), new THREE.MeshBasicMaterial({ color: '#73eff7', transparent: true, opacity: 0.22, depthWrite: false }), LINE_CAP);
    // Gust chevrons: a flat arrowhead pointing +Z.
    const chev = new THREE.BufferGeometry();
    chev.setAttribute('position', new THREE.Float32BufferAttribute([-0.6, 0, -0.3, 0, 0, 0.35, 0, 0, 0.05, 0.6, 0, -0.3, 0, 0, 0.35, 0, 0, 0.05, -0.6, 0, -0.3, -0.6, 0, -0.6, 0, 0, 0.05, 0.6, 0, -0.3, 0, 0, 0.05, 0.6, 0, -0.6], 3));
    this.arrowMat = new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.arrows = inst(chev, this.arrowMat, ARROW_CAP);
    this.boltMesh = inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#fff6a0' }), BOLT_CAP * 5, 2);
    this.bars = inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), BAR_CAP);
    this.bars.setColorAt(0, this.c.set('#73eff7'));
    this.gloves = inst(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff3d5a' }), GLOVE_CAP);
    this.arms = inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: '#f4f4f4' }), GLOVE_CAP);
  }

  clear(): void {
    this.clock = 0;
    this.clockOn = false;
    this.grids.length = 0;
    this.beams.length = 0;
    this.gust = null;
    this.bolts.length = 0;
    this.boards.length = 0;
  }

  /** Host: snapshot extras for clients. */
  pack(): Bosses3Net {
    return {
      c: this.clockOn ? r2(this.clock) : -1,
      g: this.grids.map((g) => [r2(g.cx), r2(g.cz), r2(g.ang), g.n, g.sp, g.len, g.b0, g.beats, g.flip ? 1 : 0]),
      m: this.beams.map((b) => [r2(b.x), r2(b.z), r2(b.ang), r2(b.len), r2(b.half), r2(b.tele), r2(b.life), b.kind]),
      w: this.gust ? [r2(this.gust.dx), r2(this.gust.dz), r2(this.gust.tele), r2(this.gust.life)] : null,
      l: this.bolts.map((b) => [r2(b.x), r2(b.z), r2(b.t), r2(b.shown)]),
    };
  }

  /** Client: mirror the host's arena. */
  unpack(n: Bosses3Net | undefined): void {
    if (!n) {
      this.clear();
      return;
    }
    this.clockOn = n.c >= 0;
    // Keep the local clock smooth: only snap when it drifted.
    if (!this.clockOn) this.clock = 0;
    else if (Math.abs(this.clock - n.c) > 0.12) this.clock = n.c;
    this.grids.length = 0;
    for (const [cx, cz, ang, nn, sp, len, b0, beats, flip] of n.g) this.grids.push({ cx, cz, ang, n: nn, sp, len, b0, beats, flip: !!flip, dmg: 0, hit: 0, hitBeat: -1 });
    this.beams.length = 0;
    for (const [x, z, ang, len, half, tele, life, kind] of n.m) this.beams.push({ x, z, ang, len, half, tele, life, dmg: 0, hit: 0, kind });
    this.gust = n.w ? { dx: n.w[0], dz: n.w[1], tele: n.w[2], life: n.w[3], pulse: 0 } : null;
    this.bolts.length = 0;
    for (const [x, z, t, shown] of n.l) this.bolts.push({ x, z, t, shown, dmg: 0 });
  }

  /** Client: run the clocks on between snapshots. */
  advance(dt: number): void {
    if (this.clockOn) this.clock += dt;
    for (const b of this.beams) {
      if (b.tele > 0) b.tele -= dt;
      else b.life -= dt;
    }
    const g = this.gust;
    if (g) {
      if (g.tele > 0) g.tele -= dt;
      else g.life -= dt;
    }
    for (const b of this.bolts) {
      if (b.t > 0) b.t -= dt;
      else b.shown += dt;
    }
  }

  /** Grid lines hot right now (the first `gridHot` seconds after a hot beat)? Returns the shift, or NaN. */
  hotShift(g: Grid3): number {
    beatAt(this.clock, this.beat);
    const b = this.beat.n;
    if (b < g.b0 + 2 || b > g.b0 + 1 + g.beats) return NaN;
    if (this.beat.f * beatLen() > bosses3Tuning.gridHot) return NaN;
    return gridShift(b, g.b0 + 2, g.sp, g.flip);
  }

  /** Draw it all. `focus` = where the local camera looks (gust arrows fill the view around it). */
  render(enemies: readonly Enemy[], time: number, focusX: number, focusZ: number, calm: boolean): void {
    const T = bosses3Tuning;
    let nt = 0;
    let nh = 0;
    let nc = 0;
    beatAt(this.clock, this.beat);
    const bn = this.beat.n;
    this.teleMat.opacity = calm ? 0.35 : 0.3 + 0.2 * Math.sin(time * 22);
    // Laser grids: dim lines where it is, red lines where it will be on the next beat, white-hot on the beat.
    for (const g of this.grids) {
      const ux = Math.cos(g.ang);
      const uz = Math.sin(g.ang);
      const lineAng = Math.atan2(-uz, ux); // lines run along (-uz, ux); the strip points along +Z
      const live = bn >= g.b0 + 2 && bn <= g.b0 + 1 + g.beats;
      const cur = gridShift(Math.max(bn, g.b0 + 2), g.b0 + 2, g.sp, g.flip);
      const nxt = gridShift(Math.max(bn + 1, g.b0 + 2), g.b0 + 2, g.sp, g.flip);
      const hot = !Number.isNaN(this.hotShift(g));
      const showNext = bn + 1 <= g.b0 + 1 + g.beats;
      const first = -((g.n - 1) / 2) * g.sp;
      for (let k = 0; k < g.n; k++) {
        for (const [s, kind] of [
          [cur, hot && live ? 2 : 0],
          [nxt, 1],
        ] as const) {
          if (kind === 1 && !showNext) continue;
          if (kind === 0 && !live) continue;
          const off = first + k * g.sp + s;
          const x = g.cx + ux * off - -uz * (g.len / 2);
          const z = g.cz + uz * off - ux * (g.len / 2);
          this.q.setFromAxisAngle(this.up, lineAng);
          if (kind === 2 && nh < LINE_CAP) {
            this.m4.compose(this.v.set(x, 0.02, z), this.q, this.s.set(T.gridHalf * 2, 0.22, g.len));
            this.hot.setMatrixAt(nh, this.m4);
            this.hot.setColorAt(nh++, this.c.set(k % 2 ? '#ff3df0' : '#73eff7'));
          } else if (kind === 0 && nc < LINE_CAP) {
            this.m4.compose(this.v.set(x, 0.035, z), this.q, this.s.set(0.18, 1, g.len));
            this.cold.setMatrixAt(nc++, this.m4);
          } else if (kind === 1 && nt < LINE_CAP) {
            this.m4.compose(this.v.set(x, 0.04, z), this.q, this.s.set(0.14 + 0.5 * this.beat.f, 1, g.len));
            this.tele.setMatrixAt(nt++, this.m4);
          }
        }
      }
    }
    // Punch lines and pinball paths.
    for (const b of this.beams) {
      const a = Math.atan2(Math.cos(b.ang), Math.sin(b.ang));
      this.q.setFromAxisAngle(this.up, a);
      if (b.tele > 0 || b.kind === 1) {
        if (nt >= LINE_CAP) continue;
        const w = b.kind === 1 ? 0.35 : b.half * 2 * (b.tele < 0.12 ? 1 : 0.5);
        this.m4.compose(this.v.set(b.x, 0.045, b.z), this.q, this.s.set(w, 1, b.len));
        this.tele.setMatrixAt(nt++, this.m4);
      } else if (b.life > 0 && nh < LINE_CAP) {
        this.m4.compose(this.v.set(b.x, 0.05, b.z), this.q, this.s.set(b.half * 2, 0.3, b.len));
        this.hot.setMatrixAt(nh, this.m4);
        this.hot.setColorAt(nh++, this.c.set('#ffcd75'));
      }
    }
    this.tele.count = nt;
    this.hot.count = nh;
    this.cold.count = nc;

    // Gust: chevrons sweeping across the view in the wind's direction (blinking while it builds).
    let na = 0;
    const g = this.gust;
    if (g && (g.tele > 0 || g.life > 0)) {
      this.arrowMat.opacity = g.tele > 0 ? (calm ? 0.35 : 0.2 + 0.3 * (Math.sin(time * 18) > 0 ? 1 : 0)) : 0.6;
      const a = Math.atan2(g.dx, g.dz);
      this.q.setFromAxisAngle(this.up, a);
      const scroll = ((time * (g.tele > 0 ? 3 : 12)) % 6) - 3;
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3 && na < ARROW_CAP; j++) {
          const along = j * 6 + scroll + ((i & 1) * 3);
          const side = i * 5;
          const x = focusX + g.dx * along - g.dz * side;
          const z = focusZ + g.dz * along + g.dx * side;
          this.m4.compose(this.v.set(x, 0.06, z), this.q, this.s.set(1.6, 1, 1.6));
          this.arrows.setMatrixAt(na++, this.m4);
        }
      }
    }
    this.arrows.count = na;

    // Lightning: a jagged column for a moment after it strikes.
    let nb = 0;
    for (const b of this.bolts) {
      if (b.t > 0 || b.shown > 0.3) continue;
      let px = b.x;
      let pz = b.z;
      for (let k = 0; k < 5 && nb < BOLT_CAP * 5; k++) {
        const y0 = k * 3;
        const jx = Math.sin(b.x * 3.1 + k * 2.3) * 0.7;
        const jz = Math.cos(b.z * 2.7 + k * 1.9) * 0.7;
        const w = 0.35 * (1 - b.shown / 0.3) + 0.08;
        this.m4.compose(this.v.set(px, y0, pz), this.q.identity(), this.s.set(w, 3.2, w));
        this.boltMesh.setMatrixAt(nb++, this.m4);
        px = b.x + jx;
        pz = b.z + jz;
      }
    }
    this.boltMesh.count = nb;

    // The DJ's equalizer ring and Boxer Jack's gloves.
    let nbar = 0;
    let ng = 0;
    for (const e of enemies) {
      if (!e.active) continue;
      const bh = e.def.behavior;
      if (bh === 'glitch') {
        const n = 16;
        const R = e.radius * 1.5;
        for (let i = 0; i < n && nbar < BAR_CAP; i++) {
          const a = (i / n) * Math.PI * 2;
          const h = 0.25 + (calm ? 0.4 : 1.1 * Math.exp(-5 * this.beat.f) * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + bn * 0.9))));
          this.q.setFromAxisAngle(this.up, -a);
          this.m4.compose(this.v.set(e.x + Math.cos(a) * R, e.hopY * 0.5, e.z + Math.sin(a) * R), this.q, this.s.set(0.3, h, 0.3));
          this.bars.setMatrixAt(nbar, this.m4);
          this.bars.setColorAt(nbar++, this.c.set(i % 4 === 0 ? '#ff3df0' : i % 2 ? '#73eff7' : '#a7f070'));
        }
      } else if (bh === 'boxer' && ng < GLOVE_CAP - 1) {
        // Gloves at its sides; on a punch one shoots out along the line.
        const fx = Math.sin(e.facing);
        const fz = Math.cos(e.facing);
        const r = e.radius;
        const punching = e.move === 'punch' && e.state === 'attack';
        const winding = e.move === 'punch' && e.state === 'windup';
        for (const side of [-1, 1]) {
          const sx = e.x - fz * side * r * 0.95;
          const sz = e.z + fx * side * r * 0.95;
          const out = punching && side === 1 ? (e.def.miniboss ? T.punchLength * 0.75 : T.punchLength) : winding && side === 1 ? -0.4 : 0.4;
          const gx = sx + fx * out;
          const gz = sz + fz * out;
          const y = e.hopY + r * 1.0;
          const gr = r * 0.42 * (punching && side === 1 ? 1.25 : 1);
          this.m4.compose(this.v.set(gx, y, gz), this.q.identity(), this.s.set(gr, gr, gr));
          this.gloves.setMatrixAt(ng, this.m4);
          // Arm: a stretched spring from the shoulder to the glove.
          this.q.setFromAxisAngle(this.up, Math.atan2(gx - sx, gz - sz));
          this.m4.compose(this.v.set(sx, y, sz), this.q, this.s.set(0.18, 0.18, Math.max(0.05, Math.hypot(gx - sx, gz - sz))));
          this.arms.setMatrixAt(ng++, this.m4);
        }
      }
    }
    this.bars.count = nbar;
    this.gloves.count = ng;
    this.arms.count = ng;
    for (const m of [this.tele, this.hot, this.cold, this.arrows, this.boltMesh, this.bars, this.gloves, this.arms]) commit(m.instanceMatrix, m.count);
    for (const m of [this.hot, this.bars]) if (m.instanceColor) commit(m.instanceColor, m.count);
  }
}
