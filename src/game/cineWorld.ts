/**
 * Cinematics lane: the 3D pieces (presentation only, built and animated
 * locally on every machine): the golden portal, golden jackpot chests, the
 * legendary light beam, the arena assembling under a falling hero, and the
 * skydive / leap / landing poses on a hero rig.
 */
import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { music } from '../audio/music';
import type { HeroRig } from './heroModel';
import { assemblyDelay, riseOffset, skyfallTuning, type SkyTimes } from './cinematics';

const WHITE = new THREE.Color('#ffffff');

function glowMat(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
}

/** The bonus portal after a flawless stage: gold and white, with a crown of sparkles. */
export class GoldPortal {
  readonly root = new THREE.Group();
  active = false;
  x = 0;
  z = 0;
  private age = 0;
  private ring: THREE.Mesh;
  private ring2: THREE.Mesh;
  private coreMat = glowMat('#ffe58a', 0.8);
  private pillarMat = glowMat('#ffd23f', 0.25);

  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.18, 6, 20), createRetroMaterial({ color: '#ffd23f', unlit: 0.7 }));
    this.ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.09, 5, 16), createRetroMaterial({ color: '#f4f4f4', unlit: 0.9 }));
    const core = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20), this.coreMat);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.55, 0.22, 12), createRetroMaterial({ color: '#ffcd75' }));
    base.position.y = 0.11;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 9, 10, 1, true), this.pillarMat);
    pillar.position.y = 4.5;
    const spin = new THREE.Group();
    spin.position.y = 1.55;
    spin.add(this.ring, this.ring2, core);
    this.root.add(base, spin, pillar);
    this.root.visible = false;
    scene.add(this.root);
  }

  open(x: number, z: number): void {
    if (this.active && this.x === x && this.z === z) return;
    this.active = true;
    this.x = x;
    this.z = z;
    this.age = 0;
    this.root.position.set(x, 0, z);
    this.root.visible = true;
  }

  close(): void {
    this.active = false;
    this.root.visible = false;
  }

  render(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    const pop = Math.min(1, this.age * 2.5);
    this.root.scale.setScalar(pop * (1 + Math.sin(this.age * 5) * 0.05 + music.pulse * 0.08));
    this.ring.rotation.z = this.age * 2.6;
    this.ring2.rotation.z = -this.age * 4;
    this.ring2.rotation.y = Math.sin(this.age * 2.4) * 0.6;
    this.coreMat.opacity = 0.6 + Math.sin(this.age * 8) * 0.2;
    this.pillarMat.opacity = 0.18 + Math.sin(this.age * 3) * 0.06;
  }
}

/** A golden jackpot chest on the map (a few at most, so plain meshes). */
export interface JackpotChest {
  id: number;
  x: number;
  z: number;
  facing: number;
  /** Seconds since it opened (-1 = closed). */
  openT: number;
}

class ChestView {
  readonly root = new THREE.Group();
  readonly lid = new THREE.Group();
  readonly pillarMat = glowMat('#ffd23f', 0.3);

  constructor(scene: THREE.Scene) {
    const gold = createRetroMaterial({ color: '#ffd23f', unlit: 0.35 });
    const trim = createRetroMaterial({ color: '#f4f4f4', unlit: 0.5 });
    const gem = createRetroMaterial({ color: '#b13e53', unlit: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.58, 0.78).translate(0, 0.29, 0), gold);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.82).translate(0, 0.1, 0), trim);
    const lidBox = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.3, 0.8).translate(0, 0.15, 0.4), gold);
    const lidBand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 0.84).translate(0, 0.15, 0.4), trim);
    const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.13).translate(0, 0.05, 0.82), gem);
    this.lid.position.set(0, 0.58, -0.4);
    this.lid.add(lidBox, lidBand, jewel);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 12, 10, 1, true), this.pillarMat);
    pillar.position.y = 6;
    this.root.add(body, band, this.lid, pillar);
    this.root.visible = false;
    scene.add(this.root);
  }
}

/** Draws the golden chests: bobbing, sparkling, a light pillar, the lid flying open. */
export class JackpotChests {
  private views: ChestView[] = [];
  constructor(private scene: THREE.Scene) {}

  render(list: readonly JackpotChest[], time: number): void {
    while (this.views.length < list.length) this.views.push(new ChestView(this.scene));
    this.views.forEach((v, i) => {
      const c = list[i];
      v.root.visible = !!c;
      if (!c) return;
      const closed = c.openT < 0;
      const bob = closed ? Math.abs(Math.sin(time * 3.4 + c.x)) * 0.1 : 0;
      v.root.position.set(c.x, bob, c.z);
      v.root.rotation.y = c.facing + (closed ? Math.sin(time * 1.3) * 0.08 : 0);
      const k = closed ? 0 : Math.min(1, c.openT / 0.22);
      v.lid.rotation.x = -k * 2.1;
      v.pillarMat.opacity = closed ? 0.22 + Math.sin(time * 4) * 0.08 : Math.max(0, 0.3 - c.openT * 0.2);
    });
  }

  dispose(): void {
    for (const v of this.views) this.scene.remove(v.root);
    this.views = [];
  }
}

/** The legendary reveal's column of light onto a hero, with a ring at their feet. */
export class RevealBeam {
  readonly root = new THREE.Group();
  private beamMat = glowMat('#fff6d5', 0.5);
  private coreMat = glowMat('#ffffff', 0.8);
  private ringMat = glowMat('#ffd23f', 0.7);
  private ring: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.25, 40, 12, 1, true), this.beamMat);
    beam.position.y = 20;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 40, 8, 1, true), this.coreMat);
    core.position.y = 20;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.4, 24), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.root.add(beam, core, this.ring);
    this.root.visible = false;
    scene.add(this.root);
  }

  /** k: 0..1 through the reveal (-1 hides it); land: when the item lands. */
  show(x: number, z: number, k: number, land: number, color: string): void {
    this.root.visible = k >= 0 && k < 1;
    if (!this.root.visible) return;
    this.root.position.set(x, 0, z);
    const inK = Math.min(1, k / 0.12);
    const out = k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
    const flare = k > land ? Math.max(0, 1 - (k - land) * 6) : 0;
    this.beamMat.color.set(color).lerp(WHITE, 0.55);
    this.beamMat.opacity = 0.16 * inK * out + flare * 0.25;
    this.coreMat.opacity = 0.32 * inK * out;
    this.root.scale.set(inK * (1 + flare * 0.6), 1, inK * (1 + flare * 0.6));
    this.ringMat.color.set(color);
    this.ringMat.opacity = 0.7 * out;
    this.ring.scale.setScalar(1 + (k > land ? (k - land) * 6 : 0));
  }
}

interface TileGround {
  attr: THREE.BufferAttribute;
  base: Float32Array;
  /** Vertices per tile (4 indexed, 6 not). */
  per: number;
  /** Per tile: its delay (s) and centre. */
  delay: Float32Array;
  cx: Float32Array;
  cz: Float32Array;
}

interface PropRise {
  obj: THREE.Object3D;
  y: number;
  delay: number;
  drop: number;
  dur: number;
}

/**
 * The new arena assembling beneath a falling hero: the island base rises out of the
 * void, flat ground tiles (4 vertices each, as fieldArena merges them) drop in and
 * grow into place in a wave from the landing spot, and standing pieces (props,
 * walls, trees) rise out of the ground after them. Everything
 * is put back exactly by `finish()`.
 */
export class ArenaAssembly {
  private ground: TileGround[] = [];
  private props: PropRise[] = [];
  private times: SkyTimes | null = null;
  private group: THREE.Object3D | null = null;
  done = true;

  start(group: THREE.Object3D, x: number, z: number, T: SkyTimes): void {
    this.finish();
    this.group = group;
    this.times = T;
    this.done = false;
    const box = new THREE.Box3();
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const geo = mesh.isMesh ? (mesh.geometry as THREE.BufferGeometry) : null;
      if (geo) {
        geo.boundingBox ?? geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const w = bb.max.x - bb.min.x;
        // The sea and other huge planes stay put; so do the island base and anything under the ground.
        if (w > 150) continue;
        const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
        // A tile is a quad: 4 vertices when indexed, 6 (two triangles) when not.
        const per = geo.index ? 4 : 6;
        if (pos && bb.max.y - bb.min.y < 0.02 && Math.abs(bb.max.y) < 0.05 && pos.count >= 64 && pos.count % per === 0 && child.position.y === 0) {
          this.addGround(pos, per, x, z, T);
          continue;
        }
        if (bb.max.y + child.position.y <= 0.05) {
          // The island base comes up first, out of the void, before the tiles cover it.
          if (w > 40) this.props.push({ obj: child, y: child.position.y, delay: assemblyDelay(0, T) - 0.35, drop: 9, dur: 0.6 });
          continue;
        }
      }
      // Standing pieces: rise by their centre's distance.
      box.setFromObject(child);
      if (box.isEmpty() || box.max.x - box.min.x > 150) continue;
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      const d = Math.hypot(cx - x, cz - z);
      this.props.push({ obj: child, y: child.position.y, delay: assemblyDelay(d, T) + 0.12, drop: skyfallTuning.propDrop, dur: skyfallTuning.propRise });
    }
  }

  private addGround(attr: THREE.BufferAttribute, per: number, x: number, z: number, T: SkyTimes): void {
    const base = new Float32Array(attr.array as ArrayLike<number>);
    const tiles = attr.count / per;
    const delay = new Float32Array(tiles);
    const tcx = new Float32Array(tiles);
    const tcz = new Float32Array(tiles);
    const step = attr.itemSize;
    for (let t = 0; t < tiles; t++) {
      let cx = 0;
      let cz = 0;
      for (let v = 0; v < per; v++) {
        cx += base[(t * per + v) * step];
        cz += base[(t * per + v) * step + 2];
      }
      cx /= per;
      cz /= per;
      tcx[t] = cx;
      tcz[t] = cz;
      // A little seeded jitter so the wave front reads as tiles, not a perfect circle.
      const j = Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453;
      delay[t] = assemblyDelay(Math.hypot(cx - x, cz - z), T) + (j - Math.floor(j)) * 0.12;
    }
    this.ground.push({ attr, base, per, delay, cx: tcx, cz: tcz });
  }

  /** Pose everything for transition time t. */
  update(t: number): void {
    if (this.done || !this.times) return;
    const S = skyfallTuning;
    let busy = false;
    for (const g of this.ground) {
      const arr = g.attr.array as Float32Array;
      const step = g.attr.itemSize;
      for (let tile = 0; tile < g.delay.length; tile++) {
        const since = t - g.delay[tile];
        // Tiles drop in from above (from below they'd hide under the island base).
        const off = -riseOffset(since, S.tileDrop, S.tileRise);
        if (off !== 0) busy = true;
        // Tiles grow from their centres as they rise (that's what reads from above).
        const k = since <= 0 ? 0 : Math.min(1, since / S.tileRise);
        const sc = k >= 1 ? 1 : 1 - (1 - k) * (1 - k);
        const cx = g.cx[tile];
        const cz = g.cz[tile];
        for (let v = 0; v < g.per; v++) {
          const i = (tile * g.per + v) * step;
          arr[i] = cx + (g.base[i] - cx) * sc;
          arr[i + 1] = g.base[i + 1] + off;
          arr[i + 2] = cz + (g.base[i + 2] - cz) * sc;
        }
      }
      g.attr.needsUpdate = true;
    }
    for (const p of this.props) {
      const off = riseOffset(t - p.delay, p.drop, p.dur);
      if (off !== 0) busy = true;
      p.obj.position.y = p.y + off;
    }
    if (!busy && t > this.times.cut) this.finish();
  }

  /** Put every tile and prop back where the arena built it. */
  finish(): void {
    for (const g of this.ground) {
      (g.attr.array as Float32Array).set(g.base);
      g.attr.needsUpdate = true;
    }
    for (const p of this.props) p.obj.position.y = p.y;
    this.ground = [];
    this.props = [];
    this.times = null;
    this.group = null;
    this.done = true;
  }

  /** What it found to animate (tests, debug). */
  debugCounts(): { ground: number; tiles: number; props: number } {
    return { ground: this.ground.length, tiles: this.ground.reduce((a, g) => a + g.delay.length, 0), props: this.props.length };
  }

  /** The arena this assembly is animating (null when done). */
  get target(): THREE.Object3D | null {
    return this.group;
  }
}

/** Skydive: belly to the ground, arms and legs spread, a little flutter. */
export function poseSkydive(rig: HeroRig, y: number, time: number, k: number): void {
  rig.root.visible = true;
  rig.root.position.y = y;
  rig.root.scale.setScalar(1);
  const flutter = Math.sin(time * 17) * 0.06;
  rig.body.rotation.set(1.32 + flutter * 0.5, 0, Math.sin(time * 2.3) * 0.12);
  rig.body.position.y = 0.9;
  rig.armL.rotation.set(-0.5 + flutter, 0, 1.25);
  rig.armR.rotation.set(-0.5 - flutter, 0, -1.25);
  rig.legL.rotation.set(-0.55 - flutter, 0, -0.35);
  rig.legR.rotation.set(-0.55 + flutter, 0, 0.35);
  rig.head.rotation.set(-0.7, 0, 0);
  // Brace just before touchdown: tuck the legs under.
  if (k > 0.85) {
    const b = (k - 0.85) / 0.15;
    rig.body.rotation.x = 1.32 * (1 - b);
    rig.body.position.y = 0.9 * (1 - b);
    rig.legL.rotation.x = rig.legR.rotation.x = -0.55 * (1 - b) + 0.5 * b;
    rig.head.rotation.x = -0.7 * (1 - b);
  }
}

/** The leap into the portal: tucked, leaning in, shrinking. */
export function poseLeap(rig: HeroRig, x: number, y: number, z: number, scale: number, k: number): void {
  rig.root.visible = true;
  rig.root.position.set(x, y, z);
  rig.root.scale.setScalar(scale);
  rig.body.rotation.x = Math.min(1, k * 1.6) * 0.9;
  rig.armL.rotation.set(-2.6 * Math.min(1, k * 2), 0, 0.25);
  rig.armR.rotation.set(-2.6 * Math.min(1, k * 2), 0, -0.25);
  rig.legL.rotation.x = 0.6 * Math.min(1, k * 2);
  rig.legR.rotation.x = -0.3 * Math.min(1, k * 2);
}

/** Superhero landing: one knee down, fist on the ground, then up. k: 0..1 through the settle. */
export function poseLand(rig: HeroRig, k: number): void {
  const c = Math.max(0, 1 - k * 1.6);
  if (c <= 0) {
    rig.root.scale.setScalar(1);
    return;
  }
  rig.root.position.y = 0;
  rig.root.scale.set(1 + 0.12 * c, 1 - 0.22 * c, 1 + 0.12 * c);
  rig.body.rotation.x = 0.45 * c;
  rig.body.position.y = -0.18 * c;
  rig.armR.rotation.set(-0.9 * c, 0, -0.3 * c);
  rig.legL.rotation.x = -0.9 * c;
  rig.legR.rotation.x = 0.7 * c;
}
