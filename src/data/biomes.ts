import type { BiomeTexKey } from '../render/biomeTextures';

type TexKey = BiomeTexKey;

/**
 * Biomes cycle by stage. Each has its own ground, trail, wall and tree
 * textures, cover props, sea, light and fog, so every stage reads as a new
 * place while the layout rules stay the same.
 */
export interface BiomeDef {
  id: string;
  name: string;
  ground: TexKey;
  path: TexKey;
  /** Island rim (the cliff band around the field). */
  rim: TexKey;
  wall: TexKey;
  wallTint: string;
  capColor: string;
  pillarTint: string;
  /** Edge ring around the field (bushes, rocks, drifts); `block` = a parapet / battlement of boxes. */
  edge: { tex: TexKey; colors: string[]; shape?: 'bush' | 'block' };
  /** Tree-like cover style (`lamp`: neon street lamps). */
  tree: 'round' | 'cactus' | 'pine' | 'dead' | 'lamp';
  leaves: TexKey;
  trunk: string;
  /** Cluster mix: chance weights for ruin / crates / trees / rocks. */
  clusters: [number, number, number, number];
  rockColors: string[];
  /** Flat decoration patches (lava pools, frozen ponds); never block movement. */
  pools?: { tex: TexKey; count: number; unlit: number; scroll: [number, number] };
  /** `y`: height of the backdrop plane (default -0.4, the sea; lower for a city or clouds far below). */
  sea: { tex: TexKey; unlit: number; scroll: [number, number]; y?: number };
  light: { sun: [number, number, number]; sky: [number, number, number]; ground: [number, number, number] };
  fog: string;
  /** Special arena features: neon rooftops (signs, holos, vents) or sky islands (gaps, bridges, flags, wind). */
  kind?: 'neon' | 'sky';
  /** Always this dark (0..1 of the night look), whatever the stage number says. */
  night?: number;
  /** How far the stage's day-to-dusk shift goes (default 1). */
  dusk?: number;
  /** Multiplies every enemy's colours (a biome palette). */
  enemyTint?: string;
  /** Glowing enemy eyes at night. */
  eyeColor?: string;
}

export const BIOMES: BiomeDef[] = [
  {
    id: 'meadow',
    name: 'Bright Meadow',
    ground: 'grass',
    path: 'path',
    rim: 'sand',
    wall: 'brick',
    wallTint: '#ffffff',
    capColor: '#fff4c9',
    pillarTint: '#ffd6f0',
    edge: { tex: 'leaves', colors: ['#4fd36a', '#3fbf5a', '#6ee07a', '#38b06a'] },
    tree: 'round',
    leaves: 'leaves',
    trunk: '#a86a3c',
    clusters: [0.35, 0.3, 0.35, 0],
    rockColors: ['#c4b8ff'],
    sea: { tex: 'water', unlit: 0.35, scroll: [0.05, 0.03] },
    light: { sun: [0.72, 0.66, 0.52], sky: [0.5, 0.56, 0.78], ground: [0.36, 0.3, 0.4] },
    fog: '#9fd8ff',
  },
  {
    id: 'dunes',
    name: 'Sunset Dunes',
    ground: 'dunes',
    path: 'clay',
    rim: 'sandstone',
    wall: 'sandstone',
    wallTint: '#ffffff',
    capColor: '#ffe9c4',
    pillarTint: '#ffd0a8',
    edge: { tex: 'sandstone', colors: ['#ffb36b', '#ff9f5a', '#ffc98a'] },
    tree: 'cactus',
    leaves: 'cactus',
    trunk: '#3fbf6a',
    clusters: [0.35, 0.2, 0.25, 0.2],
    rockColors: ['#ff9f5a', '#e8803f', '#ffb36b'],
    sea: { tex: 'water', unlit: 0.45, scroll: [0.04, 0.02] },
    light: { sun: [0.78, 0.68, 0.54], sky: [0.58, 0.52, 0.62], ground: [0.42, 0.32, 0.34] },
    fog: '#ffc58f',
  },
  {
    id: 'peaks',
    name: 'Frosty Peaks',
    ground: 'snow',
    path: 'ice',
    rim: 'iceBrick',
    wall: 'iceBrick',
    wallTint: '#ffffff',
    capColor: '#ffffff',
    pillarTint: '#d8f0ff',
    edge: { tex: 'snow', colors: ['#ffffff', '#e6f2ff', '#d4e8ff'] },
    tree: 'pine',
    leaves: 'pine',
    trunk: '#8a5a3c',
    clusters: [0.25, 0.25, 0.4, 0.1],
    rockColors: ['#9fc8f0', '#bfe0ff', '#8ab4e8'],
    pools: { tex: 'ice', count: 7, unlit: 0.3, scroll: [0, 0] },
    sea: { tex: 'ice', unlit: 0.3, scroll: [0.01, 0.005] },
    light: { sun: [0.58, 0.6, 0.66], sky: [0.5, 0.58, 0.8], ground: [0.38, 0.42, 0.56] },
    fog: '#cfe8ff',
  },
  {
    id: 'magma',
    name: 'Magma Isle',
    ground: 'ash',
    path: 'crust',
    rim: 'obsidian',
    wall: 'obsidian',
    wallTint: '#ffffff',
    capColor: '#ff9f3d',
    pillarTint: '#c8a2ff',
    edge: { tex: 'obsidian', colors: ['#6a4a9a', '#55407a', '#7d5aa8'] },
    tree: 'dead',
    leaves: 'obsidian',
    trunk: '#4a3358',
    clusters: [0.35, 0.15, 0.2, 0.3],
    rockColors: ['#55407a', '#6a4a9a', '#3f2d58'],
    pools: { tex: 'lava', count: 9, unlit: 1, scroll: [0.03, 0.02] },
    sea: { tex: 'lava', unlit: 1, scroll: [0.02, 0.015] },
    light: { sun: [0.9, 0.56, 0.4], sky: [0.46, 0.36, 0.62], ground: [0.56, 0.28, 0.24] },
    fog: '#b0517a',
  },
  {
    id: 'neon',
    name: 'Neon City',
    ground: 'roof',
    path: 'wetTile',
    rim: 'concrete',
    wall: 'concrete',
    wallTint: '#ffffff',
    capColor: '#2c2c58',
    pillarTint: '#9aa8e0',
    edge: { tex: 'concrete', colors: ['#5a6aa0', '#4e5e94', '#6676ac'], shape: 'block' },
    tree: 'lamp',
    leaves: 'neonSign',
    trunk: '#3a3a62',
    clusters: [0.42, 0.28, 0.18, 0.12],
    rockColors: ['#6a7ab0', '#56669a'],
    pools: { tex: 'puddle', count: 12, unlit: 0.6, scroll: [0.004, 0] },
    sea: { tex: 'cityLights', unlit: 1, scroll: [0, 0], y: -18 },
    light: { sun: [0.52, 0.46, 0.66], sky: [0.4, 0.38, 0.62], ground: [0.42, 0.24, 0.44] },
    fog: '#33205e',
    kind: 'neon',
    night: 0.62,
    dusk: 0,
    enemyTint: '#f0d4ff',
    eyeColor: '#5ef2ff',
  },
  {
    id: 'sky',
    name: 'Sky Fortress',
    ground: 'flagstone',
    path: 'planks',
    rim: 'cliff',
    wall: 'skyBrick',
    wallTint: '#ffffff',
    capColor: '#ffcd75',
    pillarTint: '#eef0fc',
    edge: { tex: 'skyBrick', colors: ['#ffffff', '#eef0fc', '#dce2f6'], shape: 'block' },
    tree: 'round',
    leaves: 'leaves',
    trunk: '#a86a3c',
    clusters: [0.45, 0.25, 0.25, 0.05],
    rockColors: ['#c4b8ff', '#a8dcff'],
    sea: { tex: 'clouds', unlit: 0.75, scroll: [0.012, 0.006], y: -14 },
    light: { sun: [0.74, 0.68, 0.54], sky: [0.5, 0.6, 0.86], ground: [0.4, 0.4, 0.56] },
    fog: '#b4e2ff',
    kind: 'sky',
    dusk: 0.6,
  },
];

export const BIOME_BY_ID: Readonly<Record<string, BiomeDef>> = Object.fromEntries(BIOMES.map((b) => [b.id, b]));

/** The first loop (stages 1-4, ending with the first Omega) keeps the four original areas in order. */
export const FIRST_LOOP = ['meadow', 'dunes', 'peaks', 'magma'];
/**
 * From loop 2 on, Neon City and Sky Fortress join: six areas cycling four
 * stages per loop. Loop 2 is neon, dunes, sky, magma (both new areas, Omega
 * back on Magma Isle); loop 3 meadow, peaks, neon, dunes; loop 4 sky, magma,
 * meadow, peaks; then round again. Bosses rotate by stage as before.
 */
export const LATER_ROTATION = ['neon', 'dunes', 'sky', 'magma', 'meadow', 'peaks'];

/** Test links force an area (`&biome=neon`); null follows the stage. Local only. */
export const biomeOverride: { id: string | null } = { id: null };

/** The biome id for a stage, from the stage number alone so every co-op machine agrees. Pure. */
export function biomeIdForStage(stage: number): string {
  const s = Math.max(1, Math.floor(stage) || 1);
  if (s <= FIRST_LOOP.length) return FIRST_LOOP[s - 1];
  return LATER_ROTATION[(s - FIRST_LOOP.length - 1) % LATER_ROTATION.length];
}

/** Stages 1-4: meadow, dunes, peaks, magma; then the six-area rotation above. */
export function biomeForStage(stage: number): BiomeDef {
  const id = biomeOverride.id && BIOME_BY_ID[biomeOverride.id] ? biomeOverride.id : biomeIdForStage(stage);
  return BIOME_BY_ID[id];
}


