import * as THREE from 'three';
import type { EnemyDef } from '../data/enemies';
import type { RetroMaterial } from './retroMaterial';

export type ModelPart = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => void;

/** Vertex paint is baked only at arena changes; white eyes and telegraph colours stay untouched. */
export const BIOME_SKINS = {
  meadow: { body: '#a7f070', trim: '#ffcd75', mix: 0.18 },
  'meadow:haunted': { body: '#b13eec', trim: '#a7f070', mix: 0.32 },
  'meadow:autumn': { body: '#ef7d57', trim: '#ffcd75', mix: 0.36 },
  dunes: { body: '#efb77a', trim: '#ffcd75', mix: 0.35 },
  'dunes:night': { body: '#8f9edb', trim: '#73eff7', mix: 0.36 },
  peaks: { body: '#8dd9ee', trim: '#f4f4f4', mix: 0.38 },
  'peaks:aurora': { body: '#77d6bb', trim: '#f4f4f4', mix: 0.4 },
  magma: { body: '#753d4b', trim: '#ff9b55', mix: 0.4 },
  'magma:ashen': { body: '#566c86', trim: '#ffcd75', mix: 0.48 },
  neon: { body: '#6466bb', trim: '#73eff7', mix: 0.3 },
  factory: { body: '#f9a64c', trim: '#41a6f6', mix: 0.44 },
  sky: { body: '#b8d7ec', trim: '#ffcd75', mix: 0.4 },
} as const;
export type BiomeSkinKey = keyof typeof BIOME_SKINS;

export function biomeSkinKey(key: string): BiomeSkinKey {
  if (Object.hasOwn(BIOME_SKINS, key)) return key as BiomeSkinKey;
  const base = key.split(':')[0];
  return Object.hasOwn(BIOME_SKINS, base) ? base as BiomeSkinKey : 'meadow';
}

/** Native foes, seasonal characters, treasure and bosses keep their authored identity. */
export function hasBiomeSkin(def: EnemyDef): boolean {
  return !def.boss && !def.miniboss && !def.hidden && !def.biomes && !def.treasure &&
    ['bopper', 'swarmer', 'shooter', 'charger', 'exploder', 'splitter', 'spawner', 'shielder', 'medic', 'leaper', 'mortar', 'burrower', 'mirror', 'egg'].includes(def.model);
}

export function biomePaint(color: string, def: EnemyDef, key: BiomeSkinKey): string {
  const skin = BIOME_SKINS[key];
  if (color === def.bodyColor) return '#' + new THREE.Color(color).lerp(new THREE.Color(skin.body), skin.mix).getHexString();
  if (color === def.accentColor) return '#' + new THREE.Color(color).lerp(new THREE.Color(skin.trim), 0.55).getHexString();
  return color;
}

/** Tiny silhouette accents, merged into the same indexed mesh as the body. No accessory draws. */
export function addBiomeParts(def: EnemyDef, key: BiomeSkinKey, add: ModelPart): void {
  const r = def.radius, skin = BIOME_SKINS[key], base = key.split(':')[0];
  // Crown of the body, excluding antennae/barrels (all values are in radius units).
  const top = def.model === 'swarmer' ? 0.9 + r : r * ({ charger: 1.43, splitter: 1.7, shooter: 1.95, spawner: 3.7, shielder: 2.1, leaper: 1.6, mortar: 1.8, egg: 1.4 }[def.model as string] ?? 2.05);
  const cap = (g: THREE.BufferGeometry, c: string, x = 0, y = 0, z = 0) => add(g, c, x * r, top + y * r, z * r);
  switch (base) {
    case 'meadow':
      cap(new THREE.CylinderGeometry(r * 0.045, r * 0.06, r * 0.28, 4), '#566c50', 0.38, 0.1, -0.1);
      cap(new THREE.OctahedronGeometry(r * 0.2).scale(1.3, 0.35, 0.6).rotateZ(0.4), key === 'meadow:autumn' ? '#ef7d57' : skin.trim, 0.53, 0.22, -0.1);
      break;
    case 'dunes':
      cap(new THREE.CylinderGeometry(r * 0.63, r * 0.7, r * 0.18, 8), skin.trim, 0, -0.15);
      cap(new THREE.BoxGeometry(r * 0.3, r * 0.5, r * 0.09).rotateZ(0.2), skin.trim, -0.6, -0.33, -0.12);
      break;
    case 'peaks':
      cap(new THREE.SphereGeometry(r * 0.66, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.38, 1), '#f4f4f4', 0, -0.15);
      for (const side of [-1, 1]) cap(new THREE.ConeGeometry(r * 0.095, r * 0.3, 4).rotateX(Math.PI), '#b8e9ff', side * 0.45, -0.22, 0.3);
      break;
    case 'magma':
      for (const side of [-1, 1]) cap(new THREE.ConeGeometry(r * 0.2, r * 0.48, 4).rotateZ(side * -0.25), '#333c57', side * 0.44, 0, -0.1);
      cap(new THREE.BoxGeometry(r * 0.5, r * 0.08, r * 0.1), skin.trim, 0, -0.16, 0.52);
      break;
    case 'neon':
      for (const side of [-1, 1]) {
        cap(new THREE.BoxGeometry(r * 0.16, r * 0.55, r * 0.36), '#333c57', side * 0.65, -0.34);
        cap(new THREE.BoxGeometry(r * 0.18, r * 0.06, r * 0.39), skin.trim, side * 0.65, -0.16);
      }
      break;
    case 'factory':
      cap(new THREE.BoxGeometry(r * 0.08, r * 0.3, r * 0.08), '#ffcd75', 0, 0.08, -0.15);
      cap(new THREE.BoxGeometry(r * 0.65, r * 0.16, r * 0.12), skin.trim, 0, 0.28, -0.15);
      for (const side of [-1, 1]) cap(new THREE.BoxGeometry(r * 0.12, r * 0.3, r * 0.12), '#ef7d57', side * 0.32, 0.28, -0.15);
      break;
    case 'sky':
      for (const side of [-1, 1]) cap(new THREE.BoxGeometry(r * 0.65, r * 0.09, r * 0.45).rotateZ(side * 0.3), '#f4f4f4', side * 0.65, -0.17, -0.1);
      cap(new THREE.OctahedronGeometry(r * 0.18), skin.trim, 0, 0.1);
      break;
  }
}

/** The four original bosses (and their rematches/minis) share this cheap material extension. */
export function hasBossDamage(def: EnemyDef): boolean {
  return ['king', 'rex', 'queen', 'omega'].includes(def.model);
}

/** Detail.x: HP fraction below which the part appears; detail.y: steady emissive strength. */
export function modelDetail(g: THREE.BufferGeometry, threshold = 0, glow = 0): THREE.BufferGeometry {
  const n = g.getAttribute('position').count, a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { a[i * 2] = threshold; a[i * 2 + 1] = glow; }
  g.setAttribute('modelDetail', new THREE.BufferAttribute(a, 2));
  return g;
}

/** No pulsing or time uniform: reduced flashing/motion always gets the same calm damage state. */
export function bossDamageMaterial(mat: RetroMaterial): void {
  mat.vertexShader = mat.vertexShader.replace('void main() {', `
    in vec2 modelDetail;
    in float modelHealth;
    out vec2 vModelDetail;
    out float vModelHealth;
    void main() {
      vModelDetail = modelDetail;
      vModelHealth = modelHealth;
  `);
  mat.fragmentShader = mat.fragmentShader.replace('void main() {', `
    in vec2 vModelDetail;
    in float vModelHealth;
    void main() {
      if (vModelDetail.x > 0.0 && vModelHealth > vModelDetail.x + 0.5 / 255.0) discard;
  `).replace('col = mix(col, uFlash.rgb, uFlash.a);', `
    col = mix(col, base.rgb, vModelDetail.y);
    col = mix(col, uFlash.rgb, uFlash.a);
  `).replace('glow * (1.0 - vFog)', 'max(glow, vModelDetail.y) * (1.0 - vFog)');
}
