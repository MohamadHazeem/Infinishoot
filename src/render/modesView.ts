import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRetroMaterial } from './retroMaterial';
import { paint } from './geometry';
import { commit } from './instancing';
import { miniTuning, type MiniGame } from '../game/modes/minigames';
import { ghostPose, ghostTuning, type Ghost, type GhostPose } from '../game/modes/ghost';

/**
 * Modes lane drawing: the rhythm stage's disco floor (tiles round the local hero light up on every
 * beat), the mini-games' targets, coins, holes and bots, and the race ghost (a see-through chunky
 * hero). Presentation only: everything comes from synced state (src/game/systems/modes.ts).
 * One draw call per kind (InstancedMesh, only live slots uploaded).
 */

const FLOOR_N = 11;
const FLOOR_CELL = 2.2;
const MAX_ITEMS = 24;
const FLOOR_COLORS = ['#73eff7', '#ffcd75', '#38b764', '#41a6f6'].map((c) => new THREE.Color(c));

function part(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  return paint(g.index ? g.toNonIndexed() : g, color);
}

function instanced(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, max: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.geometry.setAttribute('instanceFlash', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
  m.frustumCulled = false;
  m.count = 0;
  m.visible = false;
  scene.add(m);
  return m;
}

/** A 1x1 texture whose alpha sets a transparent retro material's opacity. */
function alphaTex(a: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, Math.round(a * 255)]), 1, 1, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export class ModesView {
  private floor: THREE.InstancedMesh;
  private targets: THREE.InstancedMesh;
  private coins: THREE.InstancedMesh;
  private holes: THREE.InstancedMesh;
  private bots: THREE.InstancedMesh;
  private ghost: THREE.Group;
  private ghostSpin = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private pose: GhostPose = { x: 0, z: 0, facing: 0, visible: false, stage: 1 };
  private t = 0;
  private c = new THREE.Color();
  private readonly gold = new THREE.Color('#ffcd75');
  private readonly bomb = new THREE.Color('#1a1c2c');
  private readonly red = new THREE.Color('#b13e53');
  private readonly white = new THREE.Color('#ffffff');

  constructor(scene: THREE.Scene) {
    // Disco floor: additive tiles (black = invisible), coloured per instance.
    const tile = paint(new THREE.PlaneGeometry(FLOOR_CELL * 0.8, FLOOR_CELL * 0.8).rotateX(-Math.PI / 2), '#000000');
    const fm = createRetroMaterial({ vertexColors: true, unlit: 1, transparent: true, instanceFlash: true });
    // Add the colour, leave the alpha alone (it is the bloom pass's glow mask).
    fm.blending = THREE.CustomBlending;
    fm.blendEquation = THREE.AddEquation;
    fm.blendSrc = THREE.OneFactor;
    fm.blendDst = THREE.OneFactor;
    fm.blendSrcAlpha = THREE.ZeroFactor;
    fm.blendDstAlpha = THREE.OneFactor;
    fm.depthWrite = false;
    this.floor = instanced(scene, tile, fm, FLOOR_N * FLOOR_N);
    this.floor.renderOrder = 1;

    // Gallery target: a red and white board on a post, facing the camera.
    const board = mergeGeometries([
      part(new THREE.BoxGeometry(0.14, 1.1, 0.14).translate(0, 0.55, -0.05), '#5d275d'),
      part(new THREE.CylinderGeometry(0.85, 0.85, 0.12, 18).rotateX(Math.PI / 2).translate(0, 1.4, 0), '#b13e53'),
      part(new THREE.CylinderGeometry(0.58, 0.58, 0.16, 18).rotateX(Math.PI / 2).translate(0, 1.4, 0), '#f4f4f4'),
      part(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14).rotateX(Math.PI / 2).translate(0, 1.4, 0), '#b13e53'),
    ])!;
    this.targets = instanced(scene, board, createRetroMaterial({ vertexColors: true, unlit: 0.25, instanceFlash: true }), MAX_ITEMS);

    // Coin Dash coins.
    const coin = mergeGeometries([
      part(new THREE.CylinderGeometry(0.46, 0.46, 0.09, 12).rotateX(Math.PI / 2), '#ef7d57'),
      part(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 12).rotateX(Math.PI / 2), '#ffcd75'),
      part(new THREE.BoxGeometry(0.1, 0.36, 0.18), '#f4f4f4'),
    ])!;
    this.coins = instanced(scene, coin, createRetroMaterial({ vertexColors: true, unlit: 0.7, instanceFlash: true }), 48);

    // Whack-a-Bot holes and bots.
    this.holes = instanced(scene, part(new THREE.CircleGeometry(1.05, 16).rotateX(-Math.PI / 2), '#1a1c2c'), createRetroMaterial({ vertexColors: true, instanceFlash: true }), 9);
    const bot = mergeGeometries([
      part(new THREE.SphereGeometry(0.72, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#94b0c2'),
      part(new THREE.CylinderGeometry(0.72, 0.72, 0.5, 10).translate(0, -0.25, 0), '#566c86'),
      part(new THREE.BoxGeometry(0.2, 0.22, 0.1).translate(-0.24, 0.32, 0.62), '#f4f4f4'),
      part(new THREE.BoxGeometry(0.2, 0.22, 0.1).translate(0.24, 0.32, 0.62), '#f4f4f4'),
      part(new THREE.BoxGeometry(0.08, 0.4, 0.08).translate(0, 0.85, 0), '#333c57'),
      part(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 1.08, 0), '#ffcd75'),
    ])!;
    this.bots = instanced(scene, bot, createRetroMaterial({ vertexColors: true, unlit: 0.15, instanceFlash: true }), 9);

    // The race ghost: a chunky see-through hero.
    const alpha = alphaTex(ghostTuning.alpha);
    const gm = createRetroMaterial({ color: '#73eff7', transparent: true, map: alpha, unlit: 0.55 });
    const dark = createRetroMaterial({ color: '#29366f', transparent: true, map: alpha, unlit: 0.3 });
    gm.depthWrite = dark.depthWrite = false;
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat = gm) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      return m;
    };
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 16).rotateX(-Math.PI / 2), gm);
    ring.position.y = 0.05;
    this.ghost = new THREE.Group();
    this.ghost.add(
      box(0.36, 0.34, 0.5, -0.22, 0.17, 0.05),
      box(0.36, 0.34, 0.5, 0.22, 0.17, 0.05),
      box(0.72, 0.7, 0.48, 0, 0.75, 0),
      box(0.92, 0.8, 0.82, 0, 1.55, 0),
      box(0.7, 0.24, 0.1, 0, 1.55, 0.42, dark),
      box(0.3, 0.3, 0.8, 0.52, 0.95, 0.3),
      ring,
    );
    this.ghost.visible = false;
    this.ghost.renderOrder = 2;
    scene.add(this.ghost);
  }

  ghostPose(g: Ghost, t: number): GhostPose {
    return ghostPose(g, t, this.pose);
  }

  private set(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx: number, ry: number, flash: THREE.Color | null, fa: number): void {
    this.q.setFromEuler(this.e.set(rx, ry, 0));
    this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    m.setMatrixAt(i, this.m4);
    const f = m.geometry.getAttribute('instanceFlash') as THREE.InstancedBufferAttribute;
    if (flash) f.setXYZW(i, flash.r, flash.g, flash.b, fa);
    else f.setXYZW(i, 1, 1, 1, 0);
  }

  private done(m: THREE.InstancedMesh, n: number): void {
    m.count = n;
    m.visible = n > 0; // an empty InstancedMesh would still cost a draw call
    if (!n) return;
    commit(m.instanceMatrix, n);
    commit(m.geometry.getAttribute('instanceFlash') as THREE.InstancedBufferAttribute, n);
  }

  /** Rhythm floor: tiles round (cx, cz) light up on the beat in a checker that swaps every beat. */
  renderFloor(on: boolean, phase: number, beat: number, cx: number, cz: number, dt: number): void {
    this.t += dt;
    if (!on) {
      this.floor.count = 0;
      this.floor.visible = false;
      return;
    }
    const c = this.c;
    const half = (FLOOR_N - 1) / 2;
    const ox = Math.round(cx / FLOOR_CELL) * FLOOR_CELL;
    const oz = Math.round(cz / FLOOR_CELL) * FLOOR_CELL;
    const k = Math.pow(1 - phase, 2);
    const col = FLOOR_COLORS[((beat % FLOOR_COLORS.length) + FLOOR_COLORS.length) % FLOOR_COLORS.length];
    let n = 0;
    for (let i = 0; i < FLOOR_N; i++) {
      for (let j = 0; j < FLOOR_N; j++) {
        const gx = Math.round(ox / FLOOR_CELL) + i;
        const gz = Math.round(oz / FLOOR_CELL) + j;
        if (((gx + gz + beat) & 1) !== 0) continue;
        const x = ox + (i - half) * FLOOR_CELL;
        const z = oz + (j - half) * FLOOR_CELL;
        const d = Math.hypot(x - cx, z - cz) / (half * FLOOR_CELL);
        if (d > 1) continue;
        const a = (0.04 + 0.3 * k) * (1 - d * d);
        c.copy(col).multiplyScalar(a);
        this.set(this.floor, n++, x, 0.04, z, 1, 1, 1, 0, 0, c, 1);
      }
    }
    this.done(this.floor, n);
  }

  /** Mini-game pieces from the game state (host) or the snapshot (clients). */
  renderMini(mg: MiniGame | null, dt: number): void {
    void dt;
    let nt = 0;
    let nc = 0;
    let nh = 0;
    let nb = 0;
    if (mg) {
      const T = miniTuning;
      const { gold, bomb, red, white } = this;
      if (mg.kind === 'whack') for (const h of mg.holes) this.set(this.holes, nh++, h.x, 0.03, h.z, 1, 1, 1, 0, 0, null, 0);
      for (const it of mg.items) {
        const left = it.life - it.age;
        const blink = left < 0.45 && it.by === -1 && Math.floor(this.t * 16) % 2 === 0;
        if (mg.kind === 'gallery' && nt < MAX_ITEMS) {
          const rise = Math.min(1, it.age / T.galleryRise);
          const down = it.by === -1 ? Math.min(1, Math.max(0, left) / 0.2) : 1;
          const sy = it.by >= 0 ? 1 : Math.max(0.05, Math.min(rise, down));
          // Hit: the board flips back and drops.
          const flip = it.by >= 0 ? Math.min(Math.PI / 2, it.hitT * 7) : 0;
          const fl = it.kind === 1 ? gold : it.kind === 2 ? bomb : blink ? white : null;
          this.set(this.targets, nt++, it.x, it.by >= 0 ? -it.hitT * 1.5 : 0, it.z, 1, sy, 1, -flip, 0, fl, it.kind === 2 ? 0.72 : it.kind === 1 ? 0.55 : blink ? 0.5 : 0);
        } else if (mg.kind === 'coins' && nc < 48) {
          if (it.by >= 0) {
            if (it.hitT > 0.25) continue;
            this.set(this.coins, nc++, it.x, 0.7 + it.hitT * 6, it.z, 1 - it.hitT * 3, 1 - it.hitT * 3, 1, 0, this.t * 9, null, 0);
            continue;
          }
          if (left < 1 && Math.floor(this.t * 12) % 2 === 0) continue;
          const s = it.kind === 1 ? 1.6 : 1;
          const pop = Math.min(1, it.age * 5);
          this.set(this.coins, nc++, it.x, 0.65 + Math.sin(this.t * 4 + it.id) * 0.12, it.z, s * pop, s * pop, s, 0, this.t * 4 + it.id, it.kind === 1 ? white : null, it.kind === 1 ? 0.25 : 0);
        } else if (mg.kind === 'whack' && nb < 9) {
          const rise = Math.min(1, it.age / T.whackRise);
          const duck = it.by === -1 ? Math.min(1, Math.max(0, left) / 0.15) : 1;
          const y = -0.95 + 0.95 * Math.min(rise, duck);
          const squash = it.by >= 0 ? Math.max(0.15, 1 - it.hitT * 4) : 1;
          this.set(this.bots, nb++, it.x, it.by >= 0 ? 0 : y, it.z, 1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6, 0, 0, it.kind === 2 ? red : blink ? white : null, it.kind === 2 ? 0.6 : blink ? 0.4 : 0);
        }
      }
    }
    this.done(this.targets, nt);
    this.done(this.coins, nc);
    this.done(this.holes, nh);
    this.done(this.bots, nb);
  }

  /** The race ghost at its pose (null = hidden). */
  renderGhost(p: { x: number; z: number; facing: number } | null, dt: number): void {
    this.ghost.visible = !!p;
    if (!p) return;
    this.ghostSpin += dt;
    const g = this.ghost;
    const dx = p.x - g.position.x;
    const dz = p.z - g.position.z;
    // Ease toward the sample (snap after a teleport).
    if (Math.hypot(dx, dz) > 6) g.position.set(p.x, 0, p.z);
    else g.position.set(g.position.x + dx * Math.min(1, dt * 14), 0.05 + Math.sin(this.ghostSpin * 3) * 0.06, g.position.z + dz * Math.min(1, dt * 14));
    g.rotation.y = p.facing;
  }
}
