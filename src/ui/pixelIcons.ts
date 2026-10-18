import { ICON_ART, ICON_ART_SIZE } from '../data/iconArt';

/**
 * Turns game-icons.net silhouettes into small pixel-art sprites: the icon is
 * sampled onto a 24x24 grid and cleaned up (pinholes filled, stray pixels
 * dropped) so it reads as a solid silhouette, then drawn with a dark outline,
 * dark interior detail lines, and light/shade only on its outer top-left and
 * bottom-right edges, in colours snapped to the UI palette. Results are cached
 * as data URLs and shown with `image-rendering: pixelated` at 1x, 2x or 3x.
 */
export const ICON_GRID = 24;
const INNER = 20; // icon area inside the grid; the rest is room for the outline
const SS = 4; // supersampling per pixel when measuring coverage

/** Sweetie 16 by GrafxKid: the UI and icon palette. */
export const PALETTE = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
];
const INK = '#1a1c2c';

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PAL = PALETTE.map(hex);

function nearest(c: RGB, skip: RGB[] = []): RGB {
  let best = PAL[0];
  let bd = Infinity;
  for (const p of PAL) {
    if (skip.includes(p)) continue;
    // Weighted RGB distance (eyes care most about green).
    const d = 2 * (p[0] - c[0]) ** 2 + 4 * (p[1] - c[1]) ** 2 + 3 * (p[2] - c[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Base, light and shade colours from the palette for an item colour. */
function ramp(color: string): [RGB, RGB, RGB] {
  const ink = PAL[0];
  const base = nearest(hex(color), [ink]);
  let light = nearest(mix(base, [255, 255, 255], 0.45), [ink]);
  let shade = nearest(mix(base, [0, 0, 0], 0.4));
  if (light === base) light = mix(base, [255, 255, 255], 0.35) as RGB;
  if (shade === base || shade === ink) shade = mix(base, [0, 0, 0], 0.3) as RGB;
  return [base, light, shade];
}

/** Coverage mask (1 = icon pixel) for an item's icon on the grid. */
const maskCache = new Map<string, Uint8Array | null>();
function mask(id: string): Uint8Array | null {
  if (maskCache.has(id)) return maskCache.get(id)!;
  const paths = ICON_ART[id];
  if (!paths) {
    maskCache.set(id, null);
    return null;
  }
  const hi = ICON_GRID * SS;
  const c = document.createElement('canvas');
  c.width = c.height = hi;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const off = ((ICON_GRID - INNER) / 2) * SS;
  ctx.translate(off, off);
  ctx.scale((INNER * SS) / ICON_ART_SIZE, (INNER * SS) / ICON_ART_SIZE);
  for (const d of paths) ctx.fill(new Path2D(d));
  const px = ctx.getImageData(0, 0, hi, hi).data;
  const m = new Uint8Array(ICON_GRID * ICON_GRID);
  for (let y = 0; y < ICON_GRID; y++)
    for (let x = 0; x < ICON_GRID; x++) {
      let a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) a += px[((y * SS + sy) * hi + x * SS + sx) * 4 + 3];
      m[y * ICON_GRID + x] = a / (SS * SS * 255) > 0.45 ? 1 : 0;
    }
  cleanup(m);
  maskCache.set(id, m);
  return m;
}

/** Filled 4-neighbours of (x, y). */
function neighbours(m: Uint8Array, x: number, y: number): number {
  const N = ICON_GRID;
  let n = 0;
  if (x > 0 && m[y * N + x - 1]) n++;
  if (x < N - 1 && m[y * N + x + 1]) n++;
  if (y > 0 && m[(y - 1) * N + x]) n++;
  if (y < N - 1 && m[(y + 1) * N + x]) n++;
  return n;
}

/**
 * Downsampled detail turns into speckle: fill 1-pixel holes and notches (an
 * empty pixel with 3+ filled neighbours) and drop lone pixels, so the icon
 * reads as a bold silhouette with only its larger cut-outs left.
 */
function cleanup(m: Uint8Array): void {
  const N = ICON_GRID;
  for (let pass = 0; pass < 1; pass++) {
    const fill: number[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!m[y * N + x] && neighbours(m, x, y) >= 3) fill.push(y * N + x);
    for (const k of fill) m[k] = 1;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y * N + x] && neighbours(m, x, y) === 0) m[y * N + x] = 0;
}

/** Empty pixels connected to the grid's border (outside the icon, as opposed to holes in it). */
function exterior(m: Uint8Array): Uint8Array {
  const N = ICON_GRID;
  const out = new Uint8Array(N * N);
  const stack: number[] = [];
  for (let i = 0; i < N; i++) stack.push(i, (N - 1) * N + i, i * N, i * N + N - 1);
  while (stack.length) {
    const k = stack.pop()!;
    if (out[k] || m[k]) continue;
    out[k] = 1;
    const x = k % N;
    const y = (k - x) / N;
    if (x > 0) stack.push(k - 1);
    if (x < N - 1) stack.push(k + 1);
    if (y > 0) stack.push(k - N);
    if (y < N - 1) stack.push(k + N);
  }
  return out;
}

const urlCache = new Map<string, string>();

/** Data URL of the pixel sprite for an item, or '' if it has no icon art. */
export function pixelIconUrl(id: string, color: string): string {
  const key = `${id}|${color}`;
  const hit = urlCache.get(key);
  if (hit !== undefined) return hit;
  const m = mask(id);
  if (!m) {
    urlCache.set(key, '');
    return '';
  }
  const N = ICON_GRID;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && m[y * N + x] === 1;
  const ext = exterior(m);
  // Off-grid counts as outside.
  const out = (x: number, y: number) => x < 0 || y < 0 || x >= N || y >= N || ext[y * N + x] === 1;
  const [base, light, shade] = ramp(color);
  const ink = hex(INK);
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const put = (x: number, y: number, rgb: RGB, a = 255) => {
    const k = (y * N + x) * 4;
    img.data[k] = rgb[0];
    img.data[k + 1] = rgb[1];
    img.data[k + 2] = rgb[2];
    img.data[k + 3] = a;
  };
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (at(x, y)) {
        // Lit from the top-left on the outer silhouette only; edges along holes stay flat, so detail reads as lines.
        const col = out(x, y + 1) || out(x + 1, y) ? shade : out(x, y - 1) || out(x - 1, y) ? light : base;
        put(x, y, col);
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) put(x, y, ink);
      else if (at(x - 1, y - 1)) put(x, y, ink, 110); // soft 1px drop shadow
    }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  urlCache.set(key, url);
  return url;
}

/** `<img>` markup for an item icon; falls back to its text glyph without art. */
export function iconHtml(id: string, color: string, glyph = '', cls = 'px-icon'): string {
  const url = pixelIconUrl(id, color);
  return url ? `<img class="${cls}" src="${url}" alt="" draggable="false">` : `<span class="${cls} glyph">${glyph}</span>`;
}
