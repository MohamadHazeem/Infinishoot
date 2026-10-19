import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint } from '../render/geometry';
import * as THREE from 'three';
import type { EnemyDef } from '../data/enemies';
import { modelDetail, type ModelPart } from '../render/biomeSkins';

export function biome3Model(d: EnemyDef, add: ModelPart): boolean {
  const r = d.radius,
    B = d.bodyColor,
    A = d.accentColor;
  if (!['cake', 'kraken', 'gummy', 'jellyfish'].includes(d.model)) return false;
  const eye = (x: number, y: number, z: number) => {
    add(new THREE.SphereGeometry(r * 0.18, 6, 5), '#f4f4f4', x * r, y * r, z * r);
    add(new THREE.SphereGeometry(r * 0.09, 5, 4), '#1a1c2c', x * r, y * r, (z + 0.14) * r);
  };
  if (d.model === 'cake') {
    // Negative thresholds hide tiers as HP crosses phase gates; base always stays.
    for (let k = 0; k < 3; k++) {
      const rad = r * (1.1 - k * 0.27),
        y = r * (0.4 + k * 0.65);
      const threshold = k > 0 ? -(d.miniboss ? 0.5 : k === 2 ? 0.66 : 0.33) : 0;
      const part = (g: THREE.BufferGeometry, c: string, x: number, h: number, z: number) =>
        add(modelDetail(g, threshold), c, x, h, z);
      part(new THREE.CylinderGeometry(rad, rad, r * 0.64, 16), k === 1 ? A : B, 0, y, 0);
      part(new THREE.CylinderGeometry(rad * 1.04, rad, r * 0.14, 16), '#fff1df', 0, y + r * 0.3, 0);
      for (let j = 0; j < 10; j++) {
        const a = (j * Math.PI) / 5;
        part(
          new THREE.SphereGeometry(r * 0.14, 5, 4),
          '#fff1df',
          Math.cos(a) * rad,
          y + r * 0.19,
          Math.sin(a) * rad,
        );
      }
      part(
        new THREE.CylinderGeometry(r * 0.08, r * 0.08, r * 0.42, 6),
        '#73eff7',
        0,
        y + r * 0.56,
        0,
      );
      part(new THREE.OctahedronGeometry(r * 0.13), '#ffcd75', 0, y + r * 0.86, 0);
    }
    eye(-0.36, 0.49, 1.03);
    eye(0.36, 0.49, 1.03);
    add(new THREE.BoxGeometry(r * 0.35, r * 0.12, r * 0.1), '#5d275d', 0, r * 0.22, r * 1.1);
  } else if (d.model === 'gummy') {
    add(new THREE.SphereGeometry(r, 9, 7).scale(0.8, 1.05, 0.65), B, 0, r, 0);
    add(new THREE.SphereGeometry(r * 0.68, 8, 6), B, 0, r * 2, 0);
    for (const side of [-1, 1]) {
      add(new THREE.SphereGeometry(r * 0.3, 6, 5), B, side * r * 0.5, r * 2.5, 0);
      add(new THREE.SphereGeometry(r * 0.34, 6, 5), B, side * r * 0.75, r * 1.15, r * 0.1);
      add(new THREE.SphereGeometry(r * 0.35, 6, 5), B, side * r * 0.43, r * 0.3, r * 0.2);
      eye(side * 0.24, 2.12, 0.55);
    }
    add(new THREE.SphereGeometry(r * 0.18, 6, 5), A, 0, r * 1.88, r * 0.67);
  } else {
    const king = d.model === 'kraken';
    add(new THREE.SphereGeometry(r * 0.88, 10, 7).scale(1, king ? 1.2 : 0.6, 1), B, 0, r * 1.35, 0);
    add(new THREE.TorusGeometry(r * 0.84, r * 0.1, 5, 12).rotateX(Math.PI / 2), A, 0, r * 1.05, 0);
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4;
      const geo = king
        ? new THREE.TorusGeometry(r * 0.55, r * 0.18, 5, 8, Math.PI)
            .rotateX(-Math.PI / 2)
            .rotateZ(a)
        : new THREE.CylinderGeometry(r * 0.05, r * 0.09, r * 0.9, 5);
      add(geo, j % 2 ? A : B, Math.cos(a) * r * 0.75, r * 0.45, Math.sin(a) * r * 0.75);
    }
    eye(-0.3, 1.45, 0.78);
    eye(0.3, 1.45, 0.78);
    if (king) {
      add(new THREE.CylinderGeometry(r * 0.55, r * 0.5, r * 0.2, 8), '#ffcd75', 0, r * 2.4, 0);
      for (let j = -1; j <= 1; j++)
        add(new THREE.ConeGeometry(r * 0.17, r * 0.55, 4), '#ffcd75', j * r * 0.36, r * 2.7, 0);
    }
  }
  return true;
}

/** A hooked, tapered tentacle with pale suckers, merged once for the hazard pool. */
export function biome3TentacleGeometry(): THREE.BufferGeometry {
  const body = new THREE.ConeGeometry(0.65, 4, 8, 6).translate(0, 2, 0);
  const pos = body.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + pos.getY(i) ** 2 * 0.09);
  body.computeVertexNormals();
  const parts = [paint(body.toNonIndexed(), '#b13e83')];
  body.dispose();
  for (let i = 0; i < 5; i++) {
    const y = 0.45 + i * 0.6;
    const sucker = new THREE.SphereGeometry(0.12 - i * 0.012, 6, 4)
      .scale(1, 1, 0.4)
      .translate(y * y * 0.09, y, 0.65 * (1 - y / 4));
    parts.push(paint(sucker.toNonIndexed(), '#73eff7'));
    sucker.dispose();
  }
  const geo = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return geo;
}
