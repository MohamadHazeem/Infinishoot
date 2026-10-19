import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { makeTexture } from '../render/textures';
import { commit } from '../render/instancing';
import { INSTRUMENTS, INSTRUMENT_IDS } from '../audio/instruments';

/**
 * Sound lane drawing (local to every machine, from synced state):
 * - the instrument pickup: a chunky floating music note in the instrument's
 *   colour, spinning and bobbing on the beat, over a glowing ring;
 * - tells over sound-reactive enemies: a bouncing ♪ when a loud noise is
 *   pulling them in, a drifting zZ when it's quiet and they've lost you.
 */

const DARK = '#1a1c2c';

/** 16 px pixel textures: 0 = ♪ (attracted), 1 = zZ (calm). */
function tellTex(kind: 0 | 1): THREE.CanvasTexture {
  return makeTexture(16, (ctx) => {
    const px = (x: number, y: number, c: string, w = 1, h = 1) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    if (kind === 0) {
      // A beamed note, outlined so it reads on any floor.
      px(3, 9, DARK, 5, 5);
      px(10, 8, DARK, 5, 5);
      px(6, 1, DARK, 3, 10);
      px(12, 1, DARK, 3, 9);
      px(6, 1, DARK, 9, 4);
      px(4, 10, '#ffcd75', 3, 3);
      px(11, 9, '#ffcd75', 3, 3);
      px(7, 2, '#ffcd75', 1, 9);
      px(13, 2, '#ffcd75', 1, 8);
      px(7, 2, '#ffcd75', 7, 2);
      px(4, 10, '#f4f4f4', 1, 1);
    } else {
      // zZ: a big Z and a small one.
      px(1, 6, DARK, 9, 9);
      px(2, 7, '#73eff7', 7, 1);
      px(6, 8, '#73eff7', 2, 1);
      px(5, 9, '#73eff7', 2, 1);
      px(4, 10, '#73eff7', 2, 1);
      px(3, 11, '#73eff7', 2, 1);
      px(2, 12, '#73eff7', 7, 2);
      px(9, 1, DARK, 6, 6);
      px(10, 2, '#94b0c2', 4, 1);
      px(12, 3, '#94b0c2', 1, 1);
      px(11, 4, '#94b0c2', 1, 1);
      px(10, 5, '#94b0c2', 4, 1);
    }
  }, 11 + kind);
}

class Marks {
  readonly mesh: THREE.InstancedMesh;
  n = 0;
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  constructor(kind: 0 | 1, parent: THREE.Object3D, readonly cap = 64) {
    const mat = createRetroMaterial({ map: tellTex(kind), unlit: 1, transparent: true, alphaTest: 0.5 });
    mat.depthTest = false;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 0.8), mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.count = 0;
    parent.add(this.mesh);
  }
  add(x: number, y: number, z: number, q: THREE.Quaternion): void {
    if (this.n >= this.cap) return;
    this.m.compose(this.v.set(x, y, z), q, this.s);
    this.mesh.setMatrixAt(this.n++, this.m);
  }
  end(): void {
    this.mesh.count = this.n;
    if (this.n) commit(this.mesh.instanceMatrix, this.n);
    this.n = 0;
  }
}

export interface TellSource {
  x: number;
  z: number;
  radius: number;
  state: number;
}

export class SoundLaneView {
  private root = new THREE.Group();
  private note = new THREE.Group();
  private ring: THREE.Mesh;
  private mats: ReturnType<typeof createRetroMaterial>[] = [];
  private kind = -1;
  private time = 0;
  private marks: [Marks, Marks];

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    // A chunky eighth note: head, stem, flag (one material per instrument colour, made on demand).
    const head = new THREE.SphereGeometry(0.34, 8, 6);
    head.scale(1.25, 0.9, 0.8);
    head.translate(0, 0.32, 0);
    const stem = new THREE.BoxGeometry(0.12, 1.05, 0.12).translate(0.32, 0.85, 0);
    const flag = new THREE.BoxGeometry(0.42, 0.14, 0.12).rotateZ(-0.6).translate(0.5, 1.22, 0);
    const mat = createRetroMaterial({ color: '#ffcd75', unlit: 0.55 });
    this.mats.push(mat);
    for (const g of [head, stem, flag]) this.note.add(new THREE.Mesh(g, mat));
    this.note.visible = false;
    this.root.add(this.note);
    const ringMat = createRetroMaterial({ color: '#ffcd75', unlit: 1, transparent: true });
    ringMat.depthWrite = false;
    this.mats.push(ringMat);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.15, 16).rotateX(-Math.PI / 2), ringMat);
    this.ring.visible = false;
    this.root.add(this.ring);
    this.marks = [new Marks(0, this.root), new Marks(1, this.root)];
  }

  /**
   * Draw this frame. `drop` is the instrument pickup (kind index) or null;
   * `beat` 0..1 is the music pulse; `tells` are the eared enemies' states
   * near this machine's hero (1 = ♪, 2 = zZ).
   */
  render(dt: number, drop: { kind: number; x: number; z: number } | null, beat: number, tells: Iterable<TellSource>, cam: THREE.Camera): void {
    this.time += dt;
    if (drop) {
      if (drop.kind !== this.kind) {
        this.kind = drop.kind;
        const c = INSTRUMENTS[INSTRUMENT_IDS[drop.kind] ?? 'cowbell'].color;
        for (const m of this.mats) m.uniforms.uColor.value.set(c);
      }
      const bob = Math.sin(this.time * 2.6) * 0.18 + beat * 0.12;
      this.note.visible = this.ring.visible = true;
      this.note.position.set(drop.x - 0.45, 0.5 + bob, drop.z);
      this.note.rotation.y = this.time * 1.8;
      const s = 1.8 * (1 + beat * 0.15);
      this.note.scale.setScalar(s);
      this.ring.position.set(drop.x, 0.06, drop.z);
      this.ring.scale.setScalar(1.5 + 0.3 * Math.sin(this.time * 4));
    } else this.note.visible = this.ring.visible = false;
    const q = cam.quaternion;
    for (const t of tells) {
      if (t.state !== 1 && t.state !== 2) continue;
      const y = 1.4 + t.radius * 1.4 + (t.state === 1 ? Math.abs(Math.sin(this.time * 8 + t.x)) * 0.25 : Math.sin(this.time * 2 + t.z) * 0.1);
      this.marks[t.state - 1].add(t.x + (t.state === 2 ? 0.25 : 0), y, t.z, q);
    }
    this.marks[0].end();
    this.marks[1].end();
  }
}
