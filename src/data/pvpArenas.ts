import type { ArenaLayoutApi } from '../world/fieldArena';

/**
 * Dedicated PvP arenas (pvp2 lane). Each is an authored layout on the normal
 * island field (src/world/fieldArena.ts `layout` option) in one biome's style:
 * cover is placed with 4-way rotational symmetry around the centre so every
 * spawn has the same view of the arena, and the closing ring (src/game/pvp.ts)
 * is always centred on (0, 0). Layout positions never come from the rng, so
 * the host and every client build the same arena from the id alone.
 */
export interface PvpArenaDef {
  id: string;
  name: string;
  /** Biome key for textures, props, light and music. */
  biome: string;
  /** One-line flavour for the round banner and the lobby. */
  blurb: string;
  /** Safe ring radius when a round starts (metres; grows with more players, see zoneStartFor). */
  zone: number;
  /** Heroes spawn on a circle this far out. */
  spawnR: number;
  build(api: ArenaLayoutApi): void;
}

/** Calls `f` at (x, z) and its three quarter-turns around the centre. */
function quad(x: number, z: number, f: (x: number, z: number, turn: number) => void): void {
  f(x, z, 0);
  f(-z, x, 1);
  f(-x, -z, 2);
  f(z, -x, 3);
}

/** A wall w x d at (x, z), turned with its quarter (w and d swap on odd turns). */
function quadWall(api: ArenaLayoutApi, x: number, z: number, w: number, d: number, h?: number): void {
  quad(x, z, (qx, qz, t) => api.wall(qx, qz, t % 2 ? d : w, t % 2 ? w : d, h));
}

export const PVP_ARENAS: PvpArenaDef[] = [
  {
    id: 'garden',
    name: 'Thorn Garden',
    biome: 'meadow',
    blurb: 'HEDGE MAZE · THORNS SLOW YOU · PADS TO THE MIDDLE',
    zone: 30,
    spawnR: 21,
    build(api) {
      // A grove in the middle and four broken ruin corners around it.
      quad(3.2, 3.2, (x, z) => api.tree(x, z));
      quadWall(api, 9, 4.5, 1, 5);
      quadWall(api, 4.5, 11, 4, 1, 1.2);
      // Thorn beds between the spawns and the middle: go round or take the slow way.
      quad(13, -9, (x, z) => api.patch('thorns', x, z, 2.6));
      // Crates and barrels on the outer ring (breakable cover).
      quad(10, 18, (x, z) => {
        api.crate(x, z, true);
        api.crate(x + Math.sign(x) * 1.4, z, false);
        api.barrel(x - Math.sign(x) * 1.6, z + Math.sign(z) * 0.4);
      });
      quad(25, 9, (x, z) => api.tree(x, z));
      // Jump pads near the spawns fling you into the grove.
      quad(24, -3, (x, z) => api.pad(x, z, x * 0.4, z * 0.4));
    },
  },
  {
    id: 'sandpit',
    name: 'Sandpit Ruins',
    biome: 'dunes',
    blurb: 'QUICKSAND PIT IN THE MIDDLE · LONG WALLS · PILLAR RING',
    zone: 32,
    spawnR: 22,
    build(api) {
      // The middle is a sinking pit: the shortest way across is the slowest.
      api.patch('quicksand', 0, 0, 4.2);
      // Long sandstone walls make firing lanes around the pit.
      quadWall(api, 0, 9, 7, 1, 2.2);
      // A ring of eight pillars to duck behind.
      for (let k = 0; k < 8; k++) {
        const a = (k + 0.5) * (Math.PI / 4);
        api.pillar(Math.cos(a) * 15, Math.sin(a) * 15);
      }
      quad(20, 12, (x, z) => {
        api.rock(x, z, 1.1);
        api.barrel(x - Math.sign(x) * 2, z);
        api.barrel(x - Math.sign(x) * 2, z - Math.sign(z) * 1.1);
      });
      quad(27, 11, (x, z) => api.patch('quicksand', x, z, 2.8));
      quad(26, -14, (x, z) => api.tree(x, z));
    },
  },
  {
    id: 'frost',
    name: 'Frost Court',
    biome: 'peaks',
    blurb: 'ICE RINK IN THE MIDDLE · PINE CORNERS · TOPPLING PILLARS',
    zone: 30,
    spawnR: 21,
    build(api) {
      // Slippery rink in the middle: dashes slide, knockback carries.
      api.pool(0, 0, 6.5);
      // Pines in the four corners, low ice walls on the sides.
      quad(12, 12, (x, z) => {
        api.tree(x, z);
        api.tree(x + Math.sign(x) * 2.2, z - Math.sign(z) * 0.6);
        api.tree(x - Math.sign(x) * 0.6, z + Math.sign(z) * 2.2);
      });
      quadWall(api, 0, 13, 5, 1, 1.2);
      // Toppling pillars at the rink's edge: shoot one onto whoever stands under it.
      quad(8.5, 0, (x, z) => api.topple(x, z));
      quad(20, 8, (x, z) => api.rock(x, z, 1.2));
      quad(26, -6, (x, z) => api.pool(x, z, 2.6));
      quad(17, -17, (x, z) => {
        api.crate(x, z, false);
        api.barrel(x + Math.sign(x) * 1.3, z);
      });
    },
  },
  {
    id: 'crucible',
    name: 'Lava Crucible',
    biome: 'magma',
    blurb: 'LAVA POOLS BURN · OBSIDIAN CROSS · PADS OVER THE LAVA',
    zone: 31,
    spawnR: 22,
    build(api) {
      // An obsidian cross in the middle splits the arena into four rooms.
      api.pillar(0, 0);
      quadWall(api, 0, 4, 1, 4.5, 2.2);
      // Lava pools on the diagonals: knock people in.
      quad(10, 10, (x, z) => api.pool(x, z, 3.4));
      quad(18, 0, (x, z) => {
        api.rock(x, z, 1.2);
        api.barrel(x, z + 2.2);
      });
      quad(24, 16, (x, z) => api.tree(x, z));
      quad(15, -22, (x, z) => api.wall(x, z, 3, 1, 1.2));
      // Pads near the spawns jump the lava into the cross's rooms.
      quad(25, -7, (x, z) => api.pad(x, z, x * 0.3, z * 0.3));
    },
  },
];

export const PVP_ARENA_BY_ID: Record<string, PvpArenaDef> = Object.fromEntries(PVP_ARENAS.map((a) => [a.id, a]));
