import * as THREE from 'three';
import { Rng } from '../core/rng';

/**
 * Procedural pixel-art textures drawn on tiny canvases. Placeholder art until
 * hand-painted textures exist, but already in the target style: small,
 * flat-coloured, nearest-filtered.
 */
type Draw = (ctx: CanvasRenderingContext2D, size: number, rng: Rng) => void;

export function makeTexture(size: number, draw: Draw, seed = 1): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx, size, new Rng(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, w = 1, h = 1): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rng: Rng, colors: string[], n: number) {
  for (let i = 0; i < n; i++) px(ctx, rng.int(0, size - 1), rng.int(0, size - 1), rng.pick(colors));
}

export const textures = {
  /** Chest wood: horizontal planks with dark seams, highlights, grain and nail heads. */
  chestWood: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#b8653a', s, s);
      speckle(ctx, s, rng, ['#a65a32', '#c4703f', '#9a5230'], 90);
      for (let y = 0; y < s; y += 8) {
        px(ctx, 0, y, '#d98a52', s, 1); // lit top edge of each plank
        px(ctx, 0, y + 7, '#5d2f1c', s, 1); // dark seam
        // grain streaks
        for (let k = 0; k < 2; k++) px(ctx, rng.int(0, s - 8), y + rng.int(2, 5), '#8e4a2b', rng.int(4, 9), 1);
        // nail heads near the plank ends
        px(ctx, 2, y + 3, '#333c57', 2, 2);
        px(ctx, s - 4, y + 3, '#333c57', 2, 2);
        px(ctx, 2, y + 3, '#94b0c2');
        px(ctx, s - 4, y + 3, '#94b0c2');
      }
    }),
  grass: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#5fcf4a', s, s);
      speckle(ctx, s, rng, ['#4cb83c', '#72de58', '#43a836'], 140);
      // little grass tufts
      for (let i = 0; i < 6; i++) {
        const x = rng.int(1, s - 2);
        const y = rng.int(2, s - 1);
        px(ctx, x, y, '#2f8f2a');
        px(ctx, x - 1, y - 1, '#2f8f2a');
        px(ctx, x + 1, y - 2, '#3a9e30');
      }
      // a couple of flowers
      for (let i = 0; i < 2; i++) {
        const x = rng.int(1, s - 2);
        const y = rng.int(1, s - 2);
        const c = rng.pick(['#fff35c', '#ff7eb6', '#ffffff']);
        px(ctx, x, y - 1, c);
        px(ctx, x - 1, y, c);
        px(ctx, x + 1, y, c);
        px(ctx, x, y + 1, c);
        px(ctx, x, y, '#ffb627');
      }
    }, 11),

  path: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#e8c27a', s, s);
      speckle(ctx, s, rng, ['#d9ad62', '#f2d394', '#c99a52'], 160);
      for (let i = 0; i < 5; i++) px(ctx, rng.int(0, s - 3), rng.int(0, s - 2), '#b88a4a', 2, 2);
    }, 12),

  sand: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#ffe3a1', s, s);
      speckle(ctx, s, rng, ['#f5d58a', '#fff0c4', '#efc979'], 180);
    }, 13),

  brick: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#8a7fb8', s, s); // mortar
      const bh = 8;
      for (let row = 0; row < s / bh; row++) {
        const off = row % 2 === 0 ? 0 : 8;
        for (let col = -1; col < s / 16 + 1; col++) {
          const x = col * 16 + off;
          const shade = rng.pick(['#c4b8ff', '#b6a8f5', '#cfc5ff', '#ab9ded']);
          px(ctx, x + 1, row * bh + 1, shade, 14, bh - 2);
          px(ctx, x + 1, row * bh + 1, '#ddd4ff', 14, 1); // top highlight
        }
      }
      speckle(ctx, s, rng, ['#9d90d6'], 20);
    }, 14),

  crate: () =>
    makeTexture(32, (ctx, s) => {
      px(ctx, 0, 0, '#e08a3c', s, s);
      for (let y = 0; y < s; y += 6) px(ctx, 0, y, '#c46f28', s, 1);
      px(ctx, 0, 0, '#8a4a1a', s, 3);
      px(ctx, 0, s - 3, '#8a4a1a', s, 3);
      px(ctx, 0, 0, '#8a4a1a', 3, s);
      px(ctx, s - 3, 0, '#8a4a1a', 3, s);
      for (let i = 0; i < s; i++) px(ctx, i, i, '#8a4a1a', 2, 2);
      px(ctx, 1, 1, '#ffd23f', 2, 2);
      px(ctx, s - 3, 1, '#ffd23f', 2, 2);
      px(ctx, 1, s - 3, '#ffd23f', 2, 2);
      px(ctx, s - 3, s - 3, '#ffd23f', 2, 2);
    }),

  water: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#2fa8ff', s, s);
      speckle(ctx, s, rng, ['#4bb8ff', '#279af0'], 120);
      for (let i = 0; i < 7; i++) {
        const x = rng.int(0, s - 6);
        const y = rng.int(0, s - 2);
        px(ctx, x, y, '#bfeaff', rng.int(3, 6), 1);
      }
    }, 15),

  leaves: () =>
    makeTexture(16, (ctx, s, rng) => {
      px(ctx, 0, 0, '#3fbf5a', s, s);
      speckle(ctx, s, rng, ['#2e9e48', '#5ad66f', '#7fe88a'], 70);
    }, 16),

  // ---------------------------------------------------------------- biome textures

  /** Sun-baked sand with wind ripples. */
  dunes: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#f7dca6', s, s);
      speckle(ctx, s, rng, ['#efd096', '#fbe8bf', '#e8c486'], 150);
      for (let i = 0; i < 4; i++) {
        const y = rng.int(1, s - 2);
        const x = rng.int(0, s - 12);
        px(ctx, x, y, '#dcb070', rng.int(6, 12), 1);
        px(ctx, x + 1, y - 1, '#fff3d6', rng.int(4, 8), 1);
      }
      if (rng.chance(0.6)) px(ctx, rng.int(2, s - 4), rng.int(2, s - 4), '#c98a3c', 2, 1);
    }, 21),

  /** Packed red-earth trail. */
  clay: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#e2b088', s, s);
      speckle(ctx, s, rng, ['#d6a078', '#ecc29e', '#c99468'], 170);
      for (let i = 0; i < 5; i++) px(ctx, rng.int(0, s - 3), rng.int(0, s - 2), '#b8845a', 2, 2);
    }, 22),

  sandstone: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#d9894a', s, s);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 8 : 0;
        for (let col = -1; col < 3; col++) {
          px(ctx, col * 16 + off + 1, row * 8 + 1, rng.pick(['#ffbf7a', '#f5ad66', '#ffca8c']), 14, 6);
          px(ctx, col * 16 + off + 1, row * 8 + 1, '#ffe0b0', 14, 1);
        }
      }
    }, 23),

  cactus: () =>
    makeTexture(16, (ctx, s, rng) => {
      px(ctx, 0, 0, '#3fbf6a', s, s);
      for (let x = 1; x < s; x += 4) px(ctx, x, 0, '#2e9e54', 1, s);
      speckle(ctx, s, rng, ['#fff8d0'], 8);
    }, 24),

  /** Fresh snow with blue shadows and a few sparkles. */
  snow: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#e3eefb', s, s);
      speckle(ctx, s, rng, ['#d0e0f5', '#dae7f8', '#c4d6ef'], 170);
      for (let i = 0; i < 5; i++) px(ctx, rng.int(0, s - 1), rng.int(0, s - 1), '#ffffff');
      for (let i = 0; i < 3; i++) px(ctx, rng.int(0, s - 1), rng.int(0, s - 1), '#9fd8ff');
    }, 31),

  /** Frozen path: pale ice with cracks. */
  ice: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#8fc6f0', s, s);
      speckle(ctx, s, rng, ['#a2d2f5', '#84bbe8', '#b4dcf8'], 140);
      let x = rng.int(0, s - 1);
      let y = rng.int(0, s - 1);
      for (let k = 0; k < 14; k++) {
        px(ctx, x, y, '#dff2ff');
        x = (x + rng.int(-1, 1) + s) % s;
        y = (y + rng.int(0, 1)) % s;
      }
    }, 32),

  iceBrick: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#6fa8e8', s, s);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 8 : 0;
        for (let col = -1; col < 3; col++) {
          px(ctx, col * 16 + off + 1, row * 8 + 1, rng.pick(['#bfe2ff', '#a8d4ff', '#d0ebff']), 14, 6);
          px(ctx, col * 16 + off + 2, row * 8 + 2, '#ffffff', 4, 1);
        }
      }
    }, 33),

  pine: () =>
    makeTexture(16, (ctx, s, rng) => {
      px(ctx, 0, 0, '#2fa86a', s, s);
      speckle(ctx, s, rng, ['#238a55', '#3fc07a', '#ffffff', '#ffffff'], 60);
    }, 34),

  /** Cooled volcanic rock with glowing ember flecks. */
  ash: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#6a4a7a', s, s);
      speckle(ctx, s, rng, ['#5a3d6a', '#7d5a8c', '#4f3460'], 170);
      for (let i = 0; i < 4; i++) px(ctx, rng.int(0, s - 1), rng.int(0, s - 1), rng.pick(['#ff9f3d', '#ffd23f']));
    }, 41),

  /** Crusted lava path with bright cracks. */
  crust: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#3d2a4a', s, s);
      speckle(ctx, s, rng, ['#4a3358', '#33223f'], 120);
      for (let i = 0; i < 4; i++) {
        let x = rng.int(0, s - 1);
        let y = rng.int(0, s - 1);
        for (let k = 0; k < 10; k++) {
          px(ctx, x, y, k % 3 ? '#ff7a2f' : '#ffd23f');
          x = (x + rng.int(-1, 1) + s) % s;
          y = (y + rng.int(0, 1)) % s;
        }
      }
    }, 42),

  obsidian: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#2a1d3a', s, s);
      for (let row = 0; row < 4; row++) {
        const off = row % 2 ? 8 : 0;
        for (let col = -1; col < 3; col++) {
          px(ctx, col * 16 + off + 1, row * 8 + 1, rng.pick(['#4a3566', '#55407a', '#3f2d58']), 14, 6);
          px(ctx, col * 16 + off + 1, row * 8 + 1, '#8a6ac8', 14, 1);
        }
      }
    }, 43),

  lava: () =>
    makeTexture(32, (ctx, s, rng) => {
      px(ctx, 0, 0, '#ff6a2a', s, s);
      speckle(ctx, s, rng, ['#ff8a3d', '#ff5a1f', '#ffb84d'], 140);
      for (let i = 0; i < 6; i++) px(ctx, rng.int(0, s - 6), rng.int(0, s - 2), '#ffe680', rng.int(2, 5), 1);
    }, 44),

  /** Conveyor belt: dark plates with yellow chevrons pointing along +V. */
  conveyor: () =>
    makeTexture(16, (ctx, s) => {
      px(ctx, 0, 0, '#333c57', s, s);
      px(ctx, 0, 0, '#29366f', 1, s);
      px(ctx, s - 1, 0, '#29366f', 1, s);
      for (let i = 0; i < 4; i++) {
        px(ctx, 3 + i, 9 - i, '#ffcd75', 1, 2);
        px(ctx, 12 - i, 9 - i, '#ffcd75', 1, 2);
      }
      px(ctx, 0, 15, '#1a1c2c', s, 1);
    }, 45),

  /** Painted anime face: big eyes, small mouth, transparent background. */
  face: () =>
    makeTexture(32, (ctx) => {
      const eye = (cx: number) => {
        px(ctx, cx - 3, 9, '#1b1f4a', 7, 1); // brow-ish lash line
        px(ctx, cx - 3, 10, '#1b1f4a', 1, 9);
        px(ctx, cx + 3, 10, '#1b1f4a', 1, 9);
        px(ctx, cx - 2, 19, '#1b1f4a', 5, 1);
        px(ctx, cx - 2, 10, '#ffffff', 5, 9);
        px(ctx, cx - 2, 12, '#2a9d4b', 4, 7); // iris
        px(ctx, cx - 1, 14, '#0f3d22', 2, 4); // pupil
        px(ctx, cx - 2, 12, '#ffffff', 2, 2); // highlight
        px(ctx, cx + 1, 17, '#9df2b4', 1, 1);
      };
      eye(10);
      eye(21);
      px(ctx, 14, 24, '#b5384a', 4, 1); // mouth
      px(ctx, 15, 25, '#e0606f', 2, 1);
      px(ctx, 5, 21, '#ff9fa8', 3, 1); // blush
      px(ctx, 24, 21, '#ff9fa8', 3, 1);
    }),

  blob: () =>
    makeTexture(16, (ctx, s) => {
      for (let y = 0; y < s; y++)
        for (let x = 0; x < s; x++) {
          const d = Math.hypot(x + 0.5 - s / 2, y + 0.5 - s / 2) / (s / 2);
          if (d < 1) px(ctx, x, y, `rgba(20, 16, 60, ${d < 0.7 ? 0.45 : 0.25})`);
        }
    }),
};
