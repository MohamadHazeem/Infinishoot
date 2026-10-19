/**
 * Models for the biome bosses (bosses3 lane), built like every enemy model
 * (merged, vertex-coloured, instanced): Glitch DJ behind its floating deck,
 * Boxer Jack's box, spring and clown head, Admiral Gale's little airship.
 * Authored around the def's radius so the mini-bosses scale. The moving extras
 * (Jack's punching gloves, the DJ's equalizer ring) are drawn by
 * src/game/bosses3Field.ts.
 */
import * as THREE from 'three';
import type { EnemyDef } from '../data/enemies';

type Part = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => void;

const DARK = '#2b2f4a';
const INK = '#1a1c2c';
const WHITE = '#f4f4f4';
const PINK = '#ff3df0';

export function buildBosses3Model(def: EnemyDef, add: Part): void {
  const r = def.radius;
  const B = def.bodyColor;
  const A = def.accentColor;
  switch (def.model) {
    case 'dj': {
      // Floating deck: a slab with two turntables, a neon strip and hover jets.
      add(new THREE.BoxGeometry(r * 2.4, r * 0.32, r * 1.1), DARK, 0, r * 0.95, r * 0.45);
      add(new THREE.BoxGeometry(r * 2.42, r * 0.1, r * 0.08), A, 0, r * 0.95, r * 1.02);
      add(new THREE.BoxGeometry(r * 2.42, r * 0.06, r * 0.08), PINK, 0, r * 0.82, r * 1.02);
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(r * 0.42, r * 0.42, r * 0.06, 14), INK, sx * r * 0.62, r * 1.14, r * 0.45);
        add(new THREE.CylinderGeometry(r * 0.13, r * 0.13, r * 0.08, 8), sx < 0 ? PINK : A, sx * r * 0.62, r * 1.16, r * 0.45);
        add(new THREE.ConeGeometry(r * 0.22, r * 0.45, 6).rotateX(Math.PI), A, sx * r * 0.8, r * 0.6, r * 0.45);
        // Arms reaching to the decks.
        add(new THREE.BoxGeometry(r * 0.22, r * 0.22, r * 0.75).rotateX(0.5), B, sx * r * 0.62, r * 1.45, r * 0.1);
        add(new THREE.SphereGeometry(r * 0.16, 6, 5), WHITE, sx * r * 0.62, r * 1.27, r * 0.38);
      }
      // Robot DJ: torso, a speaker grille, square head with a glitching visor, big headphones.
      add(new THREE.BoxGeometry(r * 1.1, r * 0.9, r * 0.75), B, 0, r * 1.55, -r * 0.3);
      add(new THREE.CylinderGeometry(r * 0.24, r * 0.24, r * 0.06, 10).rotateX(Math.PI / 2), INK, 0, r * 1.55, r * 0.09);
      add(new THREE.CylinderGeometry(r * 0.1, r * 0.1, r * 0.08, 8).rotateX(Math.PI / 2), A, 0, r * 1.55, r * 0.1);
      add(new THREE.BoxGeometry(r * 0.95, r * 0.8, r * 0.8), B, 0, r * 2.45, -r * 0.3);
      add(new THREE.BoxGeometry(r * 0.82, r * 0.34, r * 0.06), INK, 0, r * 2.5, r * 0.1);
      add(new THREE.BoxGeometry(r * 0.22, r * 0.12, r * 0.07), A, -r * 0.2, r * 2.53, r * 0.12);
      add(new THREE.BoxGeometry(r * 0.22, r * 0.12, r * 0.07), PINK, r * 0.2, r * 2.49, r * 0.12);
      add(new THREE.BoxGeometry(r * 0.5, r * 0.05, r * 0.07), A, 0, r * 2.2, r * 0.1);
      for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(r * 0.3, r * 0.3, r * 0.22, 12).rotateZ(Math.PI / 2), PINK, sx * r * 0.56, r * 2.45, -r * 0.3);
      add(new THREE.TorusGeometry(r * 0.56, r * 0.07, 4, 12, Math.PI), DARK, 0, r * 2.5, -r * 0.3);
      add(new THREE.CylinderGeometry(0.04, 0.04, r * 0.4, 4), DARK, r * 0.25, r * 3.0, -r * 0.3);
      add(new THREE.SphereGeometry(r * 0.09, 6, 4), A, r * 0.25, r * 3.22, -r * 0.3);
      break;
    }
    case 'jack': {
      // The box: a toy crate with gold trim and a star on the front, lid flung open behind.
      const s = r * 1.7;
      add(new THREE.BoxGeometry(s, s, s), B, 0, s / 2, 0);
      for (const y of [0.04, s - 0.04]) add(new THREE.BoxGeometry(s + 0.06, r * 0.12, s + 0.06), A, 0, y, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(r * 0.12, s, r * 0.12), A, (sx * s) / 2, s / 2, (sz * s) / 2);
      add(new THREE.OctahedronGeometry(r * 0.38, 0).scale(1, 1, 0.3), PINK, 0, s * 0.52, s / 2 + 0.02);
      add(new THREE.BoxGeometry(s, r * 0.1, s).rotateX(-1.1), B, 0, s + r * 0.6, -s / 2 - r * 0.32);
      // The crank on its right side.
      add(new THREE.CylinderGeometry(r * 0.08, r * 0.08, r * 0.4, 6).rotateZ(Math.PI / 2), WHITE, s / 2 + r * 0.2, s * 0.55, 0);
      add(new THREE.BoxGeometry(r * 0.08, r * 0.5, r * 0.08), WHITE, s / 2 + r * 0.4, s * 0.55 + r * 0.2, 0);
      add(new THREE.SphereGeometry(r * 0.1, 6, 4), '#ff3d5a', s / 2 + r * 0.4, s * 0.55 + r * 0.45, 0);
      // The spring.
      for (let k = 0; k < 4; k++) add(new THREE.TorusGeometry(r * 0.3, r * 0.06, 4, 10).rotateX(Math.PI / 2), '#94b0c2', 0, s + r * (0.12 + k * 0.17), 0);
      // Clown head: white face, red nose, painted eyes and grin, a frilled collar and a striped hat.
      const hy = s + r * 1.15;
      add(new THREE.CylinderGeometry(r * 0.62, r * 0.5, r * 0.18, 12), A, 0, hy - r * 0.55, 0);
      add(new THREE.SphereGeometry(r * 0.62, 12, 10), WHITE, 0, hy, 0);
      add(new THREE.SphereGeometry(r * 0.15, 8, 6), '#ff3d5a', 0, hy - r * 0.02, r * 0.62);
      for (const sx of [-1, 1]) {
        add(new THREE.BoxGeometry(r * 0.12, r * 0.22, r * 0.05), INK, sx * r * 0.22, hy + r * 0.18, r * 0.55);
        add(new THREE.SphereGeometry(r * 0.12, 6, 4), '#ff7eb6', sx * r * 0.38, hy - r * 0.12, r * 0.45);
      }
      add(new THREE.BoxGeometry(r * 0.5, r * 0.08, r * 0.05), '#b13e53', 0, hy - r * 0.3, r * 0.56);
      add(new THREE.ConeGeometry(r * 0.38, r * 0.75, 8), PINK, 0, hy + r * 0.85, 0);
      add(new THREE.CylinderGeometry(r * 0.3, r * 0.34, r * 0.1, 8), A, 0, hy + r * 0.6, 0);
      add(new THREE.SphereGeometry(r * 0.12, 6, 4), A, 0, hy + r * 1.25, 0);
      break;
    }
    case 'airship': {
      // Balloon with gold bands and tail fins (set back so the deck reads from above),
      // a wooden hull with cannons, the admiral at the bow.
      const by = r * 2.15;
      const bz = -r * 0.45;
      add(new THREE.SphereGeometry(r, 14, 10).scale(0.62, 0.5, 1.1), B, 0, by, bz);
      for (const z of [-0.5, 0, 0.5]) {
        const k = r * 0.63 * Math.sqrt(1 - (z / 1.1) ** 2);
        add(new THREE.CylinderGeometry(k, k, r * 0.1, 14).rotateX(Math.PI / 2).scale(1, 0.81, 1), A, 0, by, bz + z * r);
      }
      add(new THREE.BoxGeometry(0.06, r * 0.5, r * 0.45), A, 0, by + r * 0.35, bz - r * 1.05);
      add(new THREE.BoxGeometry(r * 0.8, 0.06, r * 0.45), A, 0, by, bz - r * 1.05);
      const hy = r * 0.85;
      add(new THREE.BoxGeometry(r * 1.0, r * 0.42, r * 1.8), '#b86f50', 0, hy, r * 0.1);
      add(new THREE.BoxGeometry(r * 1.04, r * 0.08, r * 1.84), '#5d275d', 0, hy + r * 0.22, r * 0.1);
      add(new THREE.ConeGeometry(r * 0.5, r * 0.7, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.6, 1), '#b86f50', 0, hy, r * 1.35);
      for (const sx of [-1, 1]) {
        for (const z of [-0.45, 0.25]) add(new THREE.CylinderGeometry(r * 0.12, r * 0.14, r * 0.45, 8).rotateZ(Math.PI / 2), DARK, sx * r * 0.62, hy + r * 0.05, z * r);
        for (const z of [-0.8, 0]) add(new THREE.CylinderGeometry(0.03, 0.03, by - hy - r * 0.3, 4), '#566c86', sx * r * 0.36, (by + hy) / 2, bz + z * r * 0.5 + r * 0.2);
      }
      // Propeller.
      add(new THREE.BoxGeometry(r * 0.9, r * 0.1, 0.05), WHITE, 0, hy, -r * 0.85);
      add(new THREE.BoxGeometry(r * 0.1, r * 0.9, 0.05), WHITE, 0, hy, -r * 0.85);
      // The admiral at the bow: navy coat with gold epaulettes, a face, a bicorne hat.
      const ay = hy + r * 0.2;
      const az = r * 0.75;
      add(new THREE.BoxGeometry(r * 0.46, r * 0.5, r * 0.34), '#29366f', 0, ay + r * 0.27, az);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(r * 0.16, r * 0.07, r * 0.22), '#ffcd75', sx * r * 0.24, ay + r * 0.5, az);
      add(new THREE.SphereGeometry(r * 0.26, 8, 6), '#ffd7b0', 0, ay + r * 0.72, az);
      add(new THREE.BoxGeometry(r * 0.3, r * 0.08, r * 0.1), WHITE, 0, ay + r * 0.62, az + r * 0.22);
      add(new THREE.BoxGeometry(r * 0.7, r * 0.2, r * 0.2), INK, 0, ay + r * 0.98, az);
      add(new THREE.BoxGeometry(r * 0.72, r * 0.05, r * 0.22), '#ffcd75', 0, ay + r * 0.9, az);
      add(new THREE.SphereGeometry(r * 0.07, 6, 4), '#b13e53', 0, ay + r * 1.0, az + r * 0.11);
      break;
    }
  }
}
