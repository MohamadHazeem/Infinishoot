import type * as THREE from 'three';
import type { Rng } from '../core/rng';
import { makeTexture, textures } from './textures';

/**
 * Pixel textures for the loop-2 biomes (Neon City, Toy Factory, Sky Fortress)
 * and the classic-biome remixes, drawn the same way as src/render/textures.ts:
 * tiny canvases, flat colours, nearest filtering. Kept apart so the base
 * texture file stays untouched. Colours stay well away from the enemy bullet
 * magenta (#ff3df0) so shots read on every floor.
 */
function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, w = 1, h = 1): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function speckle(ctx: CanvasRenderingContext2D, s: number, rng: Rng, colors: string[], n: number): void {
  for (let i = 0; i < n; i++) px(ctx, rng.int(0, s - 1), rng.int(0, s - 1), rng.pick(colors));
}

/** Pixel glyphs for neon signs (5x7, '#' = lit). */
/** A filled pixel circle. */
function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: string, wrap = 0): void {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r + r * 0.6) continue;
      let X = cx + x;
      let Y = cy + y;
      if (wrap) {
        X = (X + wrap) % wrap;
        Y = (Y + wrap) % wrap;
      }
      px(ctx, X, Y, c);
    }
}

const GLYPHS = [
  ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'], // M
  ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], // C
  ['.#.#.', '#####', '#####', '#####', '.###.', '..#..', '.....'], // heart
  ['..#..', '.###.', '#.#.#', '..#..', '..#..', '..#..', '..#..'], // arrow
  ['#####', '..#..', '#####', '#.#.#', '#####', '..#..', '.###.'], // kanji-ish
  ['..#..', '..#..', '#####', '..#..', '.#.#.', '#...#', '.....'], // star-ish
  ['####.', '#...#', '####.', '#...#', '#...#', '#...#', '####.'], // B
  ['#...#', '#...#', '#####', '#...#', '#...#', '#...#', '#...#'], // H
];

export const biomeTextures = {
  // ---------------------------------------------------------------- Autumn Meadow

  /** Golden autumn grass with fallen red and orange leaves. */
  autumnGrass: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#b4a85e', s, s);
      speckle(ctx, s, rng, ['#a89a52', '#c4b46c', '#9a9c50', '#8c9248'], 150);
      for (let i = 0; i < 6; i++) {
        const x = rng.int(1, s - 3);
        const y = rng.int(1, s - 2);
        const c = rng.pick(['#e2563c', '#ef7d57', '#ffcd75', '#b13e53']);
        px(ctx, x, y, c, 2, 1);
        px(ctx, x + 1, y + 1, c);
      }
      for (let i = 0; i < 4; i++) px(ctx, rng.int(0, s - 1), rng.int(0, s - 1), '#8a6a24');
    }, 51),

  /** Orange, red and yellow canopy. */
  autumnLeaves: () =>
    makeTexture(16, (ctx, s, rng) => {
      px(ctx, 0, 0, '#ef7d57', s, s);
      speckle(ctx, s, rng, ['#e2563c', '#ffb627', '#ffcd75', '#c8492e'], 80);
    }, 52),

  /** Ashen Magma: cold grey ash with ember flecks. */
  greyAsh: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#6a6670', s, s);
      speckle(ctx, s, rng, ['#5c5862', '#7a7680', '#4e4a54', '#86828c'], 180);
      for (let i = 0; i < 4; i++) px(ctx, rng.int(0, s - 1), rng.int(0, s - 1), rng.pick(['#ff9f3d', '#ffd23f', '#ff7a2f']));
    }, 53),

  // ---------------------------------------------------------------- Toy Factory

  /** Foam play-mat tile: soft white with jigsaw nubs; tinted per tile by vertex colour. */
  toyMat: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#f2f2ee', s, s);
      speckle(ctx, s, rng, ['#e8e8e2', '#fafaf6'], 90);
      // Seams on the tile edge, darker on the bottom/right (bevel).
      px(ctx, 0, 0, '#ffffff', s, 1);
      px(ctx, 0, 0, '#ffffff', 1, s);
      px(ctx, 0, s - 1, '#b8b8c0', s, 1);
      px(ctx, s - 1, 0, '#b8b8c0', 1, s);
      // Jigsaw nubs: out on the top and left, in on the bottom and right.
      px(ctx, 13, 0, '#c8c8d0', 6, 3);
      px(ctx, 14, 1, '#f2f2ee', 4, 2);
      px(ctx, 0, 13, '#c8c8d0', 3, 6);
      px(ctx, 1, 14, '#f2f2ee', 2, 4);
      px(ctx, 13, s - 3, '#c8c8d0', 6, 3);
      px(ctx, s - 3, 13, '#c8c8d0', 3, 6);
      // A tiny star stamped in the corner.
      px(ctx, 6, 5, '#e0e0e8', 1, 3);
      px(ctx, 5, 6, '#e0e0e8', 3, 1);
    }, 61),

  /** Riveted diamond-plate walkway. */
  plate: () =>
    makeTexture(32, (ctx, s) => {
      px(ctx, 0, 0, '#8a96b4', s, s);
      for (let y = 0; y < s; y += 4)
        for (let x = (y / 4) % 2 ? 2 : 0; x < s; x += 4) {
          px(ctx, x, y, '#b4c0dc', 2, 1);
          px(ctx, x + 1, y + 1, '#6a7694');
        }
      px(ctx, 0, 0, '#566c86', s, 1);
      px(ctx, 0, 0, '#566c86', 1, s);
      for (const [x, y] of [[2, 2], [s - 3, 2], [2, s - 3], [s - 3, s - 3]]) {
        px(ctx, x, y, '#333c57', 2, 2);
        px(ctx, x, y, '#f4f4f4');
      }
    }, 62),

  /** The island's side: a big blue toy box with yellow dots. */
  toyBox: () =>
    makeTexture(32, (ctx, s) => {
      px(ctx, 0, 0, '#3b5dc9', s, s);
      for (const [x, y] of [[6, 6], [22, 14], [10, 24], [26, 28]]) disc(ctx, x, y, 3, '#ffcd75', s);
      px(ctx, 0, 0, '#5a7ae0', s, 2);
      px(ctx, 0, s - 2, '#29366f', s, 2);
    }, 63),

  /** A plain moulded-plastic face with a soft bevel (building blocks, toys): tinted by material colour. */
  blockFace: () =>
    makeTexture(16, (ctx, s) => {
      px(ctx, 0, 0, '#e8e8e8', s, s);
      px(ctx, 0, 0, '#ffffff', s, 1);
      px(ctx, 0, 0, '#ffffff', 1, s);
      px(ctx, 0, s - 1, '#b0b0b8', s, 1);
      px(ctx, s - 1, 0, '#b0b0b8', 1, s);
      px(ctx, 3, 3, '#f8f8f8', 3, 1);
    }, 64),

  /** Ball-pit sea: plastic balls in primary colours. */
  ballPit: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#29366f', s, s);
      const cols = ['#ff5a4a', '#ffcd3a', '#3b8cff', '#38c868', '#f4f4f4', '#ff9a3a'];
      for (let y = 0; y < s; y += 6)
        for (let x = (y / 6) % 2 ? 3 : 0; x < s; x += 6) {
          const c = rng.pick(cols);
          disc(ctx, x + 2, y + 2, 2, c, s);
          px(ctx, (x + 1) % s, (y + 1) % s, '#ffffff');
        }
    }, 65),

  /** Wooden alphabet block face: cream with a coloured frame and a big letter. */
  abcBlock: () =>
    makeTexture(16, (ctx, s) => {
      px(ctx, 0, 0, '#3b5dc9', s, s);
      px(ctx, 2, 2, '#fff4d6', s - 4, s - 4);
      // "A"
      px(ctx, 6, 4, '#e2563c', 4, 1);
      px(ctx, 5, 5, '#e2563c', 1, 7);
      px(ctx, 10, 5, '#e2563c', 1, 7);
      px(ctx, 6, 8, '#e2563c', 4, 1);
    }, 66),

  /** Crusher pad: yellow and black hazard stripes round a steel plate. */
  stampPad: () =>
    makeTexture(32, (ctx, s) => {
      px(ctx, 0, 0, '#333c57', s, s);
      for (let i = -s; i < s * 2; i += 6) for (let k = 0; k < 3; k++) for (let y = 0; y < s; y++) {
        const x = i + y + k;
        if (x >= 0 && x < s && (y < 5 || y >= s - 5 || x < 5 || x >= s - 5)) px(ctx, x, y, '#ffcd3a');
      }
      px(ctx, 6, 6, '#94b0c2', s - 12, s - 12);
      px(ctx, 7, 7, '#b4c8d8', s - 14, 1);
      px(ctx, 6, s - 7, '#566c86', s - 12, 1);
    }, 67),

  // ---------------------------------------------------------------- Neon City
  /** Wet rooftop: dark violet concrete with a few pink and cyan glints of reflected neon. */
  roof: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#46465e', s, s);
      speckle(ctx, s, rng, ['#40405a', '#4e4e68', '#3c3c54'], 170);
      for (let i = 0; i < 3; i++) px(ctx, rng.int(0, s - 6), rng.int(0, s - 1), '#56567a', rng.int(3, 6), 1);
      for (let i = 0; i < 2; i++) px(ctx, rng.int(0, s - 3), rng.int(0, s - 1), rng.pick(['#ff6ad5', '#5ef2ff']), rng.int(1, 2), 1);
      px(ctx, 0, s - 1, '#363650', s, 1);
      px(ctx, s - 1, 0, '#363650', 1, s);
    }, 61),

  /** Slick street tiles: dark squares with bright grout and neon streaks. */
  wetTile: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#26263c', s, s);
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          px(ctx, x * 16 + 1, y * 16 + 1, rng.pick(['#33334e', '#36365a', '#30304a']), 15, 15);
          px(ctx, x * 16 + 1, y * 16 + 1, '#4a4a6e', 15, 1);
        }
      // Wet sheen: a couple of faint coloured streaks.
      for (let i = 0; i < 2; i++) px(ctx, rng.int(2, s - 3), rng.int(3, s - 8), rng.pick(['#7a4a8a', '#3a7a96']), 1, rng.int(3, 6));
    }, 62),

  /** Concrete panels with seams, bolts and a grime line. */
  concrete: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#5a6a9a', s, s);
      speckle(ctx, s, rng, ['#52628f', '#6474a6', '#4e5c88'], 120);
      px(ctx, 0, 15, '#3a4670', s, 1);
      px(ctx, 15, 0, '#3a4670', 1, s);
      px(ctx, 0, 16, '#7484b8', s, 1);
      for (const [x, y] of [[2, 2], [13, 2], [18, 18], [29, 18]]) px(ctx, x, y, '#a0b0d8');
    }, 63),

  /** The city far below: dark blocks, glowing streets and window dots. */
  cityLights: () =>
    makeTexture(64, (ctx, s, rng) => {
      px(ctx, 0, 0, '#120f2a', s, s);
      for (let i = 0; i < s; i += 16) {
        px(ctx, i, 0, '#3a2a6a', 2, s);
        px(ctx, 0, i, '#3a2a6a', s, 2);
        for (let k = 0; k < s; k += 4) {
          px(ctx, i, k, rng.pick(['#ffd23f', '#ff9f3d']), 1, 1);
          px(ctx, k, i + 1, rng.pick(['#ff6ad5', '#5ef2ff']), 1, 1);
        }
      }
      for (let i = 0; i < 90; i++) px(ctx, rng.int(0, s - 1), rng.int(0, s - 1), rng.pick(['#ffe95e', '#5ef2ff', '#ff6ad5', '#a0ffb0']));
    }, 64),

  /** Building facade: rows of windows, some lit warm, some neon, many dark. */
  windows: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#262650', s, s);
      for (let y = 2; y < s; y += 6)
        for (let x = 2; x < s; x += 6) {
          const r = rng.next();
          px(ctx, x, y, r < 0.35 ? '#ffd27a' : r < 0.45 ? '#5ef2ff' : r < 0.52 ? '#ff6ad5' : '#1a1a3a', 3, 3);
        }
    }, 65),

  /** Neon sign faces: a 4x2 atlas of glowing pixel glyphs on a dark panel (white, tinted per sign). */
  neonSign: () =>
    makeTexture(64, (ctx) => {
      px(ctx, 0, 0, '#141428', 64, 64);
      for (let g = 0; g < 8; g++) {
        const ox = (g % 4) * 16;
        const oy = Math.floor(g / 4) * 32;
        px(ctx, ox + 1, oy + 1, '#ffffff', 14, 1);
        px(ctx, ox + 1, oy + 30, '#ffffff', 14, 1);
        px(ctx, ox + 1, oy + 1, '#ffffff', 1, 30);
        px(ctx, ox + 14, oy + 1, '#ffffff', 1, 30);
        const rows = GLYPHS[g];
        for (let y = 0; y < 7; y++)
          for (let x = 0; x < 5; x++) if (rows[y][x] === '#') px(ctx, ox + 3 + x * 2, oy + 9 + y * 2, '#ffffff', 2, 2);
      }
    }, 66),

  /** Hologram: scanlines, a big glyph block and noise; white so the material tints it. */
  holo: () =>
    makeTexture(32, (ctx, s, rng) => {
      ctx.clearRect(0, 0, s, s);
      for (let y = 0; y < s; y += 2) px(ctx, 0, y, 'rgba(255,255,255,0.35)', s, 1);
      px(ctx, 0, 0, '#ffffff', s, 1);
      px(ctx, 0, s - 1, '#ffffff', s, 1);
      for (let i = 0; i < 6; i++) px(ctx, rng.int(3, s - 10), rng.int(4, s - 6), '#ffffff', rng.int(4, 9), 2);
      for (let i = 0; i < 20; i++) px(ctx, rng.int(0, s - 1), rng.int(0, s - 1), '#ffffff');
    }, 67),

  /** Reflection streak on wet ground: broken horizontal ripples, white (tinted per sign). */
  ripple: () =>
    makeTexture(16, (ctx, s, rng) => {
      ctx.clearRect(0, 0, s, s);
      for (let y = 0; y < s; y += 2) {
        const w = rng.int(4, 12);
        const a = 0.35 + 0.65 * (1 - y / s);
        px(ctx, rng.int(0, s - w), y, `rgba(255,255,255,${a.toFixed(2)})`, w, 1);
      }
    }, 68),

  /** Puddle: near-black glossy water with streaks of reflected neon. */
  puddle: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#1a1b34', s, s);
      speckle(ctx, s, rng, ['#202240', '#16172e'], 60);
      for (let i = 0; i < 5; i++) px(ctx, rng.int(0, s - 10), rng.int(0, s - 1), rng.pick(['#c04aa8', '#3ab4d0', '#5a4ac8']), rng.int(5, 10), 1);
      for (let i = 0; i < 4; i++) px(ctx, rng.int(0, s - 1), rng.int(0, s - 1), '#ffffff');
    }, 69),

  /** Vent grate: dark slots in a metal frame. */
  grate: () =>
    makeTexture(16, (ctx, s) => {
      px(ctx, 0, 0, '#5a6a9a', s, s);
      for (let y = 2; y < s - 1; y += 3) px(ctx, 2, y, '#14142a', s - 4, 2);
      px(ctx, 0, 0, '#8a9ac8', s, 1);
    }, 70),

  // ---------------------------------------------------------------- Sky Fortress
  /** Pale flagstones with mossy cracks. */
  flagstone: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#a89cc0', s, s);
      const stones: [number, number, number, number][] = [[1, 1, 14, 9], [16, 1, 15, 13], [1, 11, 9, 11], [11, 11, 4, 11], [16, 15, 15, 7], [1, 23, 18, 8], [20, 23, 11, 8]];
      for (const [x, y, w, h] of stones) {
        px(ctx, x, y, rng.pick(['#d8d0e6', '#cfc6e0', '#e0d8ec', '#d4cce2']), w, h);
        px(ctx, x, y, '#ece6f6', w, 1);
        px(ctx, x, y + h - 1, '#bcb2d2', w, 1);
      }
      for (let i = 0; i < 8; i++) px(ctx, rng.int(0, s - 2), rng.int(0, s - 1), rng.pick(['#7ccf6a', '#5fb85a']), rng.int(1, 3), 1);
    }, 81),

  /** Boardwalk planks for paths and bridges. */
  planks: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#c88a52', s, s);
      for (let y = 0; y < s; y += 8) {
        px(ctx, 0, y, rng.pick(['#d89a60', '#cf9258', '#e0a86c']), s, 7);
        px(ctx, 0, y, '#f0c088', s, 1);
        px(ctx, 0, y + 7, '#6a3f24', s, 1);
        px(ctx, rng.int(0, s - 8), y + rng.int(2, 5), '#b07444', rng.int(4, 9), 1);
        px(ctx, 3, y + 3, '#4a3a4a');
        px(ctx, s - 4, y + 3, '#4a3a4a');
      }
    }, 82),

  /** Fortress stone: big white-blue blocks with gold-lit edges. */
  skyBrick: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#6a7ab8', s, s);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 8 : 0;
        for (let col = -1; col < 3; col++) {
          px(ctx, col * 16 + off + 1, row * 8 + 1, rng.pick(['#e8ecfa', '#dce2f6', '#f0f2fc']), 14, 6);
          px(ctx, col * 16 + off + 1, row * 8 + 1, '#ffffff', 14, 1);
          px(ctx, col * 16 + off + 1, row * 8 + 6, '#b8c2e4', 14, 1);
        }
      }
    }, 83),

  /** Cloud sea far below: blue with fluffy white puffs. */
  clouds: () =>
    makeTexture(64, (ctx, s, rng) => {
      px(ctx, 0, 0, '#5aa8f0', s, s);
      speckle(ctx, s, rng, ['#66b2f4', '#4e9ce8'], 300);
      for (let i = 0; i < 26; i++) {
        const x = rng.int(0, s - 1);
        const y = rng.int(0, s - 1);
        const r = rng.int(3, 8);
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy * 2.2 > r * r) continue;
            px(ctx, (x + dx + s) % s, (y + dy + s) % s, dy < -r * 0.3 ? '#ffffff' : dy > r * 0.4 ? '#d4ecff' : '#f2f8ff');
          }
      }
    }, 84),

  /** Loose cloud puffs on a transparent background (a drifting layer between the islands and the cloud sea). */
  cloudPuffs: () =>
    makeTexture(64, (ctx, s, rng) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 4; i++) {
        const x = rng.int(0, s - 1);
        const y = rng.int(0, s - 1);
        const r = rng.int(4, 8);
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r * 2; dx <= r * 2; dx++) {
            if (dx * dx * 0.25 + dy * dy * 1.6 > r * r) continue;
            px(ctx, (x + dx + s) % s, (y + dy + s) % s, dy < -r * 0.25 ? '#ffffff' : '#e2f0ff');
          }
      }
    }, 87),

  /** Mossy cliff rock under the islands. */
  cliff: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#8a7aa8', s, s);
      speckle(ctx, s, rng, ['#7a6a98', '#9a8ab8', '#6e5e8a'], 170);
      for (let i = 0; i < 5; i++) px(ctx, rng.int(0, s - 6), rng.int(0, s - 1), '#5e4e7a', rng.int(3, 7), 1);
      px(ctx, 0, 0, '#6ccf5a', s, 2);
      for (let x = 0; x < s; x += 2) px(ctx, x, 2, '#4fb050', 1, rng.int(1, 3));
    }, 85),

  /** Flag cloth: white with a coloured band and emblem (tinted per flag). */
  cloth: () =>
    makeTexture(16, (ctx) => {
      px(ctx, 0, 0, '#ffffff', 16, 16);
      px(ctx, 0, 0, '#d0d0e0', 16, 2);
      px(ctx, 0, 14, '#d0d0e0', 16, 2);
      px(ctx, 6, 5, '#ffe95e', 4, 6);
      px(ctx, 5, 6, '#ffe95e', 6, 4);
    }, 86),
};

export type BiomeTexKey = keyof typeof textures | keyof typeof biomeTextures;

/** A texture by key from either set (each call draws a fresh one, like `textures`). */
export function biomeTex(key: BiomeTexKey): THREE.Texture {
  if (key in biomeTextures) return biomeTextures[key as keyof typeof biomeTextures]();
  return textures[key as keyof typeof textures]();
}
