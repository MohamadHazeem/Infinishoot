/** Extra companion state and chunky, merged models. Gameplay lives in systems/pets2.ts. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from '../render/geometry';
import { createRetroMaterial } from '../render/retroMaterial';
import type { PetState } from './pet';

export class Pets2State {
  actionT = 1;
  supportT = 0;
  scanT = 0;
  splitT = 0;
  splitTick = 0;
  turretT = 0;
  turretTick = 0;
  turretX = 0;
  turretZ = 0;
  scoutX = 0;
  scoutZ = 0;
  /** 0 none, 1 threat, 2 elite; secret has a separate marker. */
  scoutKind = 0;
  secret = false;
  secretX = 0;
  secretZ = 0;
  stolen = new Set<number>();
  reset(): void {
    this.actionT = 1;
    this.supportT = this.scanT = this.splitT = this.splitTick = this.turretT = this.turretTick = 0;
    this.scoutKind = 0;
    this.secret = false;
    this.stolen.clear();
  }
  net(): number[] {
    const q = (n: number) => Math.round(n * 10) / 10;
    return [
      q(this.splitT),
      q(this.turretT),
      q(this.turretX),
      q(this.turretZ),
      this.scoutKind,
      q(this.scoutX),
      q(this.scoutZ),
      +this.secret,
      q(this.secretX),
      q(this.secretZ),
    ];
  }
  setNet(a?: number[]): void {
    if (!a || a.length < 10 || !a.every(Number.isFinite)) {
      this.reset();
      return;
    }
    [
      this.splitT,
      this.turretT,
      this.turretX,
      this.turretZ,
      this.scoutKind,
      this.scoutX,
      this.scoutZ,
    ] = a;
    this.secret = a[7] === 1;
    this.secretX = a[8];
    this.secretZ = a[9];
  }
}

export const PETS2_IDS = [
  'robopup',
  'owlbot',
  'slimebuddy',
  'hatchling',
  'catdrone',
  'minimech',
] as const;
export function isPets2(id: string): boolean {
  return (PETS2_IDS as readonly string[]).includes(id);
}

/** One mesh for each static body; only wings/helpers/turret need their own draw. */
function mesh(parts: THREE.BufferGeometry[]): THREE.Mesh {
  const merged = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return new THREE.Mesh(merged, createRetroMaterial({ vertexColors: true, unlit: 0.35 }));
}
const box = (w: number, h: number, d: number, c: string, x = 0, y = 0, z = 0) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const orb = (r: number, c: string, x = 0, y = 0, z = 0, sy = 1) =>
  paint(new THREE.SphereGeometry(r, 8, 6).scale(1, sy, 1).translate(x, y, z), c);
const ear = (c: string, x: number) =>
  paint(new THREE.ConeGeometry(0.11, 0.23, 4).translate(x, 0.26, 0), c);
const WHITE = '#f4f4f4',
  DARK = '#1a1c2c',
  GOLD = '#ffcd75';

export class Pet2Model {
  readonly body: THREE.Mesh;
  private wings: THREE.Mesh[] = [];
  private helpers: THREE.Mesh[] = [];
  private turret: THREE.Mesh | null = null;
  constructor(
    private id: string,
    color: string,
    parent: THREE.Group,
    private root: THREE.Group,
    private scene: THREE.Scene,
  ) {
    const parts: THREE.BufferGeometry[] = [];
    if (id === 'robopup') {
      parts.push(
        box(0.5, 0.35, 0.52, color),
        box(0.32, 0.18, 0.2, GOLD, 0, -0.04, 0.3),
        box(0.1, 0.08, 0.06, DARK, 0, 0.02, 0.42),
      );
      for (const s of [-1, 1]) {
        parts.push(box(0.15, 0.32, 0.16, '#b13e53', s * 0.28, 0.07, 0));
        for (const z of [-0.17, 0.17])
          parts.push(box(0.12, 0.13, 0.15, '#94b0c2', s * 0.18, -0.22, z));
      }
      parts.push(box(0.09, 0.28, 0.08, GOLD, 0, 0.08, -0.32));
    } else if (id === 'owlbot') {
      parts.push(orb(0.31, color, 0, -0.02, 0, 0.9));
      for (const s of [-1, 1])
        parts.push(orb(0.15, GOLD, s * 0.15, 0.02, 0.22), ear('#257179', s * 0.21));
      parts.push(
        paint(
          new THREE.ConeGeometry(0.09, 0.16, 4).rotateX(Math.PI / 2).translate(0, -0.07, 0.35),
          GOLD,
        ),
      );
    } else if (id === 'slimebuddy') {
      parts.push(
        orb(0.35, color, 0, -0.06, 0, 0.78),
        orb(0.11, '#38b764', -0.22, -0.22, 0.1),
        orb(0.11, '#38b764', 0.22, -0.22, 0.1),
      );
      parts.push(box(0.1, 0.04, 0.03, DARK, 0, -0.1, 0.33));
    } else if (id === 'hatchling') {
      parts.push(
        orb(0.29, color),
        box(0.29, 0.18, 0.24, GOLD, 0, -0.06, 0.28),
        ear(GOLD, -0.18),
        ear(GOLD, 0.18),
      );
      parts.push(
        paint(
          new THREE.ConeGeometry(0.13, 0.55, 4).rotateX(-Math.PI / 2).translate(0, -0.12, -0.4),
          '#b13e53',
        ),
      );
    } else if (id === 'catdrone') {
      parts.push(box(0.49, 0.38, 0.4, color), ear(GOLD, -0.19), ear(GOLD, 0.19));
      parts.push(
        box(0.09, 0.05, 0.05, GOLD, 0, -0.04, 0.23),
        box(0.42, 0.04, 0.03, WHITE, 0, -0.1, 0.23),
      );
      parts.push(
        paint(
          new THREE.TorusGeometry(0.16, 0.04, 4, 8, Math.PI * 1.5).translate(0.32, 0, -0.15),
          GOLD,
        ),
      );
    } else {
      parts.push(box(0.43, 0.32, 0.38, color), box(0.3, 0.12, 0.05, DARK, 0, 0.04, 0.21));
      for (const s of [-1, 1])
        parts.push(
          box(0.15, 0.28, 0.22, '#94b0c2', s * 0.3, -0.06),
          box(0.18, 0.16, 0.25, '#333c57', s * 0.14, -0.24),
        );
      parts.push(box(0.19, 0.19, 0.2, GOLD, 0, -0.03, -0.27));
    }
    for (const s of [-1, 1]) {
      parts.push(box(0.13, 0.17, 0.08, WHITE, s * 0.13, 0.12, 0.33));
      parts.push(box(0.06, 0.1, 0.03, DARK, s * 0.13, 0.13, 0.385));
    }
    this.body = mesh(parts);
    parent.add(this.body);
    if (id === 'hatchling' || id === 'owlbot')
      for (const s of [-1, 1]) {
        const wing = mesh([
          paint(
            new THREE.ConeGeometry(0.22, 0.57, 3)
              .rotateZ((-s * Math.PI) / 2)
              .scale(1, 1, 0.25)
              .translate(s * 0.49, 0.03, -0.05),
            id === 'owlbot' ? '#257179' : '#b13e53',
          ),
        ]);
        parent.add(wing);
        this.wings.push(wing);
      }
    if (id === 'slimebuddy')
      for (let i = 0; i < 2; i++) {
        const helper = mesh([
          orb(0.2, color, 0, 0, 0, 0.8),
          box(0.18, 0.06, 0.03, DARK, 0, 0.01, 0.18),
        ]);
        root.add(helper);
        this.helpers.push(helper);
      }
    if (id === 'minimech') {
      this.turret = mesh([
        box(0.6, 0.18, 0.6, '#333c57'),
        box(0.4, 0.35, 0.4, color, 0, 0.23),
        box(0.1, 0.1, 0.55, GOLD, 0, 0.3, 0.35),
      ]);
      scene.add(this.turret);
    }
  }
  render(st: PetState, t: number, still: boolean): void {
    for (let i = 0; i < this.wings.length; i++) {
      const w = this.wings[i];
      w.visible = this.id === 'owlbot' || st.ranks.wings > 0;
      w.rotation.z = still ? 0 : Math.sin(t * 8) * 0.22 * (i ? 1 : -1);
    }
    for (let i = 0; i < this.helpers.length; i++) {
      const h = this.helpers[i];
      h.visible = st.extra.splitT > 0;
      const a = (still ? 0 : t * 2) + i * Math.PI;
      h.position.set(
        Math.cos(a) * 0.9,
        -0.8 + (still ? 0 : Math.abs(Math.sin(t * 6 + i)) * 0.22),
        Math.sin(a) * 0.9,
      );
    }
    if (this.turret) {
      this.turret.visible = this.root.visible && st.extra.turretT > 0;
      this.turret.position.set(st.extra.turretX, 0.2, st.extra.turretZ);
    }
  }
  hide(): void {
    if (this.turret) this.turret.visible = false;
  }
  dispose(): void {
    if (this.turret) {
      this.scene.remove(this.turret);
      this.turret.geometry.dispose();
      (this.turret.material as THREE.Material).dispose();
    }
  }
}
