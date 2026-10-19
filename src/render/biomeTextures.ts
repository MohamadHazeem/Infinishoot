import * as THREE from 'three';
import { makeTexture } from './textures';
import type { Rng } from '../core/rng';

/**
 * Pixel-art textures for the loop-2 biomes (Toy Factory, Sky Ruins) and the
 * classic-biome remixes. Same rules as src/render/textures.ts: tiny canvases,
 * flat colours, nearest filtering. Colours stay well away from the enemy
 * bullet magenta (#ff3df0) so shots read on every floor.
 */
function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, w = 1, h = 1): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rng: Rng, colors: string[], n: number) {
  for (let i = 0; i < n; i++) px(ctx, rng.int(0, size - 1), rng.int(0, size - 1), rng.pick(colors));
}

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

export const biomeTextures = {
  // ---------------------------------------------------------------- Autumn Meadow

  /** Golden autumn grass with fallen red and orange leaves. */
  autumnGrass: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#d9a441', s, s);
      speckle(ctx, s, rng, ['#c99232', '#e6b552', '#b8862a', '#a8a040'], 150);
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

  // ---------------------------------------------------------------- Sky Ruins

  /** Pale mint sky-meadow grass with white clover. */
  skyGrass: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#86cc8e', s, s);
      speckle(ctx, s, rng, ['#78c084', '#98d8a0', '#6cb47a'], 150);
      for (let i = 0; i < 3; i++) {
        const x = rng.int(1, s - 2);
        const y = rng.int(1, s - 2);
        px(ctx, x, y - 1, '#ffffff');
        px(ctx, x - 1, y, '#ffffff');
        px(ctx, x + 1, y, '#ffffff');
        px(ctx, x, y + 1, '#ffffff');
        px(ctx, x, y, '#ffe680');
      }
    }, 71),

  /** Cream marble slabs with gold inlay. */
  marble: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#f4ecdc', s, s);
      speckle(ctx, s, rng, ['#ebe0cc', '#fbf6ea'], 110);
      let x = rng.int(0, s - 1);
      let y = 0;
      for (let k = 0; k < 18; k++) {
        px(ctx, x, y, '#d8cbb8');
        x = (x + rng.int(-1, 1) + s) % s;
        y = (y + rng.int(1, 2)) % s;
      }
      px(ctx, 0, 0, '#c8b898', s, 1);
      px(ctx, 0, 0, '#c8b898', 1, s);
      px(ctx, 15, 15, '#ffcd3a', 2, 2);
    }, 72),

  /** White ashlar blocks with a gold line (ruin walls). */
  marbleBrick: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#c8bca8', s, s);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 8 : 0;
        for (let col = -1; col < 3; col++) {
          px(ctx, col * 16 + off + 1, row * 8 + 1, rng.pick(['#fbf6ea', '#f4ecdc', '#fffaf0']), 14, 6);
          px(ctx, col * 16 + off + 1, row * 8 + 1, '#ffffff', 14, 1);
        }
      }
      px(ctx, 0, 15, '#ffcd3a', s, 1);
    }, 73),

  /** Warm cliff rock under the floating island. */
  skyRock: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#c89a72', s, s);
      for (let y = 0; y < s; y += 5) px(ctx, 0, y, rng.pick(['#b8865e', '#d8ab84']), s, 2);
      speckle(ctx, s, rng, ['#a87a54', '#e2bc96'], 60);
      px(ctx, 0, 0, '#7ed4a2', s, 2);
    }, 74),

  /** Cloud puffs (edge ring). */
  cloud: () =>
    makeTexture(16, (ctx, s, rng) => {
      px(ctx, 0, 0, '#ffffff', s, s);
      speckle(ctx, s, rng, ['#eef4ff', '#e2ecff'], 30);
    }, 75),

  /** Pale blossom canopy (white and soft peach). */
  blossom: () =>
    makeTexture(16, (ctx, s, rng) => {
      px(ctx, 0, 0, '#ffe2d0', s, s);
      speckle(ctx, s, rng, ['#ffffff', '#ffd0b8', '#fff0e0', '#f4c0a8'], 80);
    }, 76),

  /** Sea of clouds far below the island. */
  cloudSea: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#9ccfff', s, s);
      for (let i = 0; i < 9; i++) {
        const x = rng.int(0, s - 1);
        const y = rng.int(0, s - 1);
        const r = rng.int(3, 6);
        disc(ctx, x, y + 1, r, '#c8e2ff', s);
        disc(ctx, x, y, r, '#ffffff', s);
      }
    }, 77),

  /** Wind streaks (alpha-tested): white dashes along +V. */
  windStreak: () => {
    const t = makeTexture(16, (ctx, s, rng) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 5; i++) {
        const x = rng.int(0, s - 1);
        const y = rng.int(0, s - 1);
        const len = rng.int(3, 7);
        for (let k = 0; k < len; k++) px(ctx, x, (y + k) % s, k === len - 1 ? '#ffffff' : '#d8f0ff');
      }
    }, 78);
    t.format = THREE.RGBAFormat;
    return t;
  },
};
