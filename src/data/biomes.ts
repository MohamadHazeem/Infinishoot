import { BIOME3_AREAS } from './biome3';
import { seasonalStage } from './seasons';
import type { BiomeTexKey } from '../render/biomeTextures';
import type { TrackId } from '../audio/music/composition';

type TexKey = BiomeTexKey;

/** Weather motes that drift around the camera (src/game/ambience.ts). Rain replaces them on rainy stages. */
export type Weather = 'sprinkles' | 'bubbles' | 'pollen' | 'sand' | 'snow' | 'embers' | 'confetti' | 'wind' | 'leaves' | 'fireflies' | 'aurora' | 'ash' | 'neon';

/** Colour grade for an area (same shape as src/render/postfx.ts `Grade`). */
export interface BiomeGrade {
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  saturation: number;
}

/**
 * Biomes: each has its own ground, trail, wall and tree textures, cover props,
 * backdrop (sea, lava, ball pit or a sea of clouds), light, fog, weather,
 * sounds and hazard, so every stage reads as a new place while the layout
 * rules stay the same. Stages pick a biome with `biomeForStage` (the same on
 * every co-op machine, from the stage number alone).
 */
export interface BiomeDef {
  id: string;
  name: string;
  /** Remix id ('autumn', 'night'...) when a classic biome comes back in a later loop; '' for the base look. */
  variant?: string;
  ground: TexKey;
  /** Multiplies the ground texture (remixes recolour a biome without new art). */
  groundTint?: string;
  /** Per-tile floor colours (factory play mats); picked by a hash of the tile, so the seeded layout is unchanged. */
  tileColors?: string[];
  path: TexKey;
  pathTint?: string;
  /** Island rim (the cliff band around the field). */
  rim: TexKey;
  wall: TexKey;
  wallTint: string;
  /** 'brick': textured walls with a cap; 'blocks': stacked toy building blocks with studs. */
  wallStyle?: 'brick' | 'blocks';
  /** Building-block colours ('blocks' walls). */
  blockColors?: string[];
  capColor: string;
  pillarTint: string;
  /** Edge ring around the field (bushes, rocks, drifts, gumballs); `block` = a parapet / battlement of boxes. */
  edge: { tex: TexKey; colors: string[]; shape?: 'bush' | 'ball' | 'block' };
  /** Tree-like cover style (`lamp`: neon street lamps). */
  tree: 'round' | 'cactus' | 'pine' | 'dead' | 'toy' | 'lamp';
  leaves: TexKey;
  /** Multiplies the leaves texture. */
  leafTint?: string;
  trunk: string;
  /** Cluster mix: chance weights for ruin / crates / trees / rocks. */
  clusters: [number, number, number, number];
  /** Rock-like cover style (default 'stone'). */
  rock?: 'stone' | 'block' | 'column' | 'basalt' | 'pumpkin' | 'crystal';
  rockColors: string[];
  /** Flat decoration patches (lava pools, frozen ponds); never block movement. */
  pools?: { tex: TexKey; count: number; unlit: number; scroll: [number, number] };
  /** The backdrop below and around the island. `y` lowers it (a sea of clouds far below a floating island). */
  sea: { tex: TexKey; unlit: number; scroll: [number, number]; y?: number; tint?: string };
  /** How far the island's cliff runs down (m); floating islands are deep. */
  depth?: number;
  light: { sun: [number, number, number]; sky: [number, number, number]; ground: [number, number, number] };
  fog: string;
  /** Colour grade override (remixes); the base biomes' grades live in src/render/biomeLook.ts. */
  grade?: BiomeGrade;
  // --- Living world (all cosmetic and local) ---
  weather: Weather | null;
  /** Chance that a stage here is rainy (overrides rainTuning.chance for remixes). */
  rain?: number;
  /** Swaying grass tufts and their colours. */
  tufts?: string[];
  /** Foam or a glowing rim where the island meets the backdrop. */
  shore?: 'foam' | 'lava' | 'none';
  /** Lily pads on decorative ponds. */
  lilies?: boolean;
  /** Snow sparkles around the camera. */
  glints?: boolean;
  /** Dash/landing dust tint and footprint tint (no prints on grass, tiles or ash). */
  dust: string;
  prints?: string;
  /** Extra animated scenery: spinning gears (factory). */
  decor?: 'gears';
  // --- Sound (data only; the audio code plays it) ---
  footstep: 'grass' | 'sand' | 'snow' | 'metal';
  /** Ambience bed and room: the amb_<id> sample and reverb to reuse. */
  ambience: 'halloween' | 'meadow' | 'dunes' | 'peaks' | 'magma' | 'neon' | 'sky';
  music: TrackId;
  // --- Gameplay (identical on every machine: built from the arena seed) ---
  /** Extra ground hazard (lava and ice come from `pools`). */
  hazard?: 'quicksand' | 'thorns' | 'crusher' | null;
  /** Conveyor belts regardless of stage (undefined = the usual 3 from stage 2). */
  belts?: number;
  // --- Time of day and palette ---
  /** Special arena features: neon rooftops (signs, holos, vents) or sky islands (gaps, bridges, flags, wind). */
  kind?: 'neon' | 'sky';
  /** Always this dark (0..1 of the night look), whatever the stage number says. */
  night?: number;
  /** How far the stage's day-to-dusk shift goes (default 1). */
  dusk?: number;
  /** Time of day starts here (0 midday .. 1 sunset): twilight remixes. */
  duskFrom?: number;
  /** Multiplies every enemy's colours (a biome palette). */
  enemyTint?: string;
  /** Glowing enemy eyes at night. */
  eyeColor?: string;
  /** Loop-2+ remixes of this biome (see BIOME_ORDER). */
  remixes?: BiomeRemix[];
}

/** A remix overrides any look fields of its biome (nested objects are replaced whole). Gameplay stays the biome's. */
export type BiomeRemix = { id: string; name: string } & Partial<Omit<BiomeDef, 'id' | 'name' | 'variant' | 'remixes' | 'hazard' | 'belts' | 'pools' | 'kind'>>;

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
    weather: 'pollen',
    tufts: ['#4fd36a', '#3fbf5a', '#6ee07a', '#38b764', '#a7f070'],
    shore: 'foam',
    lilies: true,
    dust: '#e6d9a8',
    footstep: 'grass',
    ambience: 'meadow',
    music: 'meadow',
    hazard: 'thorns',
    remixes: [
      { id: 'haunted', name: 'Haunted Meadow', ground: 'autumnGrass', groundTint: '#887699',
        pathTint: '#bf96b8', wallTint: '#86719e', capColor: '#ef7d57', pillarTint: '#b13e53',
        tree: 'dead', trunk: '#5d275d', rock: 'pumpkin', rockColors: ['#ef7d57', '#ffcd75'],
        clusters: [0.3, 0.1, 0.25, 0.35], fog: '#5d275d', night: 0.85, dusk: 0, rain: 0,
        light: { sun: [0.7, 0.46, 0.35], sky: [0.46, 0.36, 0.65], ground: [0.36, 0.25, 0.4] },
        grade: { lift: [0.025, 0, 0.04], gamma: [1, 1, 1.02], gain: [1.06, 0.95, 1.03], saturation: 1.1 },
        weather: 'fireflies', music: 'halloween', ambience: 'halloween', dust: '#b13e53',
        edge: { tex: 'autumnLeaves', colors: ['#5d275d', '#ef7d57', '#b13e53'] },
        tufts: ['#5d275d', '#b13e53'], eyeColor: '#ffcd75' },
      {
        id: 'autumn',
        name: 'Autumn Meadow',
        ground: 'autumnGrass',
        path: 'path',
        pathTint: '#ffe0b8',
        pillarTint: '#ffd9a8',
        capColor: '#ffe2b0',
        edge: { tex: 'autumnLeaves', colors: ['#ef7d57', '#ffb627', '#e2563c', '#ffcd75'] },
        leaves: 'autumnLeaves',
        trunk: '#8a4a2a',
        clusters: [0.3, 0.25, 0.3, 0.15],
        rock: 'pumpkin',
        rockColors: ['#ff8a2a', '#ffa23d', '#f07a1f'],
        light: { sun: [0.76, 0.66, 0.5], sky: [0.54, 0.52, 0.68], ground: [0.4, 0.32, 0.32] },
        fog: '#f4c8a0',
        grade: { lift: [0.025, 0.01, 0.0], gamma: [0.99, 1, 1.01], gain: [1.03, 1.0, 0.96], saturation: 1.04 },
        weather: 'leaves',
        rain: 0.25,
        tufts: ['#e0a040', '#c98a2e', '#f2c05a', '#b8862a', '#a8b040'],
        dust: '#f2c890',
      },
    ],
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
    weather: 'sand',
    shore: 'foam',
    dust: '#ffcf95',
    prints: '#8a4a2a',
    footstep: 'sand',
    ambience: 'dunes',
    music: 'dunes',
    hazard: 'quicksand',
    remixes: [
      {
        id: 'night',
        name: 'Night Dunes',
        groundTint: '#d8d0ff',
        pathTint: '#d0c8f0',
        wallTint: '#d8d0ff',
        capColor: '#bfe8ff',
        pillarTint: '#b8c8ff',
        edge: { tex: 'sandstone', colors: ['#8a86d8', '#7a7ac8', '#a29ae8'] },
        leafTint: '#9fe8c8',
        rock: 'crystal',
        rockColors: ['#73eff7', '#41a6f6', '#a7f070'],
        light: { sun: [0.62, 0.6, 0.72], sky: [0.42, 0.44, 0.7], ground: [0.3, 0.26, 0.42] },
        fog: '#7a7ad8',
        grade: { lift: [0.0, 0.01, 0.05], gamma: [1, 1, 1.02], gain: [0.98, 1.0, 1.05], saturation: 1.06 },
        weather: 'fireflies',
        night: 1,
        dust: '#c8c0f0',
        prints: '#4a4a8a',
      },
    ],
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
    weather: 'snow',
    shore: 'none',
    glints: true,
    dust: '#ffffff',
    prints: '#5d7fbf',
    footstep: 'snow',
    ambience: 'peaks',
    music: 'frost',
    remixes: [
      {
        id: 'aurora',
        name: 'Aurora Peaks',
        groundTint: '#c8f8ec',
        pathTint: '#b8e8f0',
        wallTint: '#a8e8e0',
        capColor: '#d8fff4',
        pillarTint: '#b8f0e0',
        edge: { tex: 'snow', colors: ['#c8fff0', '#b8f0e8', '#d8d0ff'] },
        leafTint: '#6fd8b8',
        rock: 'crystal',
        rockColors: ['#73eff7', '#a7f070', '#b8a8ff'],
        light: { sun: [0.46, 0.6, 0.62], sky: [0.4, 0.34, 0.66], ground: [0.26, 0.42, 0.46] },
        fog: '#5fb8c0',
        grade: { lift: [0.0, 0.025, 0.04], gamma: [1, 0.99, 1], gain: [0.95, 1.04, 1.02], saturation: 1.12 },
        weather: 'aurora',
        rain: 0,
      },
    ],
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
    weather: 'embers',
    shore: 'lava',
    dust: '#8d7aa3',
    footstep: 'metal',
    ambience: 'magma',
    music: 'magma',
    remixes: [
      {
        id: 'ashen',
        name: 'Ashen Magma',
        ground: 'greyAsh',
        pathTint: '#c8c0c0',
        wallTint: '#b8b4bc',
        capColor: '#ffb627',
        pillarTint: '#c8c0c8',
        edge: { tex: 'obsidian', colors: ['#6a6670', '#57535e', '#7a7480'] },
        trunk: '#2e2a33',
        rock: 'basalt',
        rockColors: ['#4a4652', '#3a3640', '#5a5560'],
        light: { sun: [0.92, 0.6, 0.42], sky: [0.46, 0.42, 0.5], ground: [0.56, 0.32, 0.26] },
        fog: '#a8706a',
        grade: { lift: [0.03, 0.01, 0.01], gamma: [1, 0.99, 1], gain: [1.06, 1.0, 0.95], saturation: 1.02 },
        weather: 'ash',
        dust: '#9a949e',
        duskFrom: 0.5,
      },
    ],
  },
  {
    id: 'factory',
    name: 'Toy Factory',
    ground: 'toyMat',
    tileColors: ['#5cb98c', '#d6bd5e', '#68a4d4', '#d58f6c', '#72bfb0'],
    path: 'plate',
    rim: 'toyBox',
    wall: 'blockFace',
    wallTint: '#ffffff',
    wallStyle: 'blocks',
    blockColors: ['#ff5a4a', '#ffcd3a', '#3b8cff', '#38c868', '#ff9a3a'],
    capColor: '#ffffff',
    pillarTint: '#ffe8a8',
    edge: { tex: 'blockFace', colors: ['#ff5a4a', '#ffcd3a', '#3b8cff', '#38c868', '#ffffff'], shape: 'ball' },
    tree: 'toy',
    leaves: 'blockFace',
    trunk: '#f4f4f4',
    clusters: [0.35, 0.25, 0.25, 0.15],
    rock: 'block',
    rockColors: ['#ffe2a8', '#c8f0ff', '#d8ffc8', '#ffd8c0'],
    sea: { tex: 'ballPit', unlit: 0.3, scroll: [0.035, 0.012] },
    light: { sun: [0.74, 0.68, 0.6], sky: [0.56, 0.54, 0.74], ground: [0.42, 0.36, 0.42] },
    fog: '#ffd9b8',
    weather: 'confetti',
    shore: 'none',
    dust: '#fff0d8',
    decor: 'gears',
    footstep: 'metal',
    ambience: 'magma',
    music: 'factory',
    hazard: 'crusher',
    belts: 5,
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
    weather: 'neon',
    rain: 0.6,
    shore: 'none',
    dust: '#8a7ab8',
    footstep: 'metal',
    ambience: 'neon',
    music: 'neon',
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
    weather: 'wind',
    shore: 'none',
    dust: '#e8ecf8',
    footstep: 'grass',
    ambience: 'sky',
    music: 'sky',
    kind: 'sky',
    dusk: 0.6,
  },
  ...BIOME3_AREAS,
];

export const BIOME_BY_ID: Record<string, BiomeDef> = Object.fromEntries(BIOMES.map((b) => [b.id, b]));

/** Stages per biome row: matches LOOP_STAGES in src/game/game.ts (a test checks it). */
export const BIOME_LOOP = 4;

/**
 * Which biome each stage of a loop uses ('id' or 'id:remix'). Loop 1 is the
 * classic tour; loop 2 brings the new areas (Neon City, Toy Factory, Sky
 * Fortress) and ends on Ashen Magma; loop 3 adds Candy Kingdom and Sunken
 * Ruins; loop 4 tours classic remixes. Later loops repeat rows 2–4.
 */
export const BIOME_ORDER: string[][] = [
  ['meadow', 'dunes', 'peaks', 'magma'],
  ['neon', 'factory', 'sky', 'magma:ashen'],
  ['candy', 'ruins', 'peaks:aurora', 'magma'],
  ['meadow:autumn', 'dunes:night', 'peaks:aurora', 'magma'],
];

/** The biome key ('id' or 'id:remix') for a stage. Pure: every co-op machine agrees. */
export function biomeKeyForStage(stage: number): string {
  const s = Math.max(1, Math.floor(stage) || 1) - 1;
  const loop = Math.floor(s / BIOME_LOOP);
  const rows = BIOME_ORDER.length;
  const row = loop < rows ? BIOME_ORDER[loop] : BIOME_ORDER[1 + ((loop - 1) % (rows - 1))];
  return row[s % BIOME_LOOP];
}

const resolved = new Map<string, BiomeDef>();
/** Content packs are installed once before arena construction. */
export const modBiomeStages: Record<number, string> = {};
export function clearBiomeCache(): void { resolved.clear(); }

/** A biome by key: 'meadow' or a remix like 'meadow:autumn' (the remix's look over its biome). */
export function biomeByKey(key: string): BiomeDef {
  let b = resolved.get(key);
  if (b) return b;
  const [id, variant] = key.split(':');
  const base = BIOME_BY_ID[id] ?? BIOMES[0];
  const remix = variant ? base.remixes?.find((r) => r.id === variant) : undefined;
  b = remix ? { ...base, ...remix, id: base.id, variant: remix.id, remixes: undefined } : { ...base, variant: '' };
  resolved.set(key, b);
  return b;
}

/** The biome key of a resolved biome. */
export function biomeKey(b: BiomeDef): string {
  return b.variant ? `${b.id}:${b.variant}` : b.id;
}

/** Test links can pin a biome ('factory', 'meadow:autumn'); null follows the stage. Solo test use only. */
export const biomeForce: { key: string | null } = { key: null };

/** Stage 1 is the meadow; loop 1 tours the classics, later loops bring the new biomes and remixes. */
export function biomeForStage(stage: number): BiomeDef {
  return biomeByKey(biomeForce.key ?? modBiomeStages[stage] ?? seasonalStage(stage)?.biome ?? biomeKeyForStage(stage));
}

/** Every biome key that shows up in the first `stages` stages (title attract mode picks from these). */
export function biomeKeysUpTo(stages: number): string[] {
  const out: string[] = [];
  for (let s = 1; s <= Math.max(1, stages); s++) {
    const k = biomeKeyForStage(s);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** The first stage that shows each biome reached in `stages` stages (title attract mode picks from these). */
export function biomeStagesUpTo(stages: number): number[] {
  const out: number[] = [];
  const keys: string[] = [];
  for (let s = 1; s <= Math.max(1, Math.min(48, stages)); s++) {
    const k = biomeKeyForStage(s);
    if (keys.includes(k)) continue;
    keys.push(k);
    out.push(s);
  }
  return out;
}

/** All biome keys: every biome and every remix. */
export function allBiomeKeys(): string[] {
  return BIOMES.flatMap((b) => [b.id, ...(b.remixes ?? []).map((r) => `${b.id}:${r.id}`)]);
}
