/**
 * Photo mode filters (src/ui/photoMode.ts): pure pixel passes over RGBA
 * image data at the game's internal resolution, so the preview and the
 * saved PNG match exactly (the PNG is the same pixels scaled up).
 */
export type PhotoFilter = 'normal' | 'crt' | 'sepia' | 'comic' | 'neon' | 'bw';

export const PHOTO_FILTERS: { id: PhotoFilter; name: string }[] = [
  { id: 'normal', name: 'NORMAL' },
  { id: 'crt', name: 'RETRO CRT' },
  { id: 'sepia', name: 'SEPIA' },
  { id: 'comic', name: 'COMIC INK' },
  { id: 'neon', name: 'NEON GLOW' },
  { id: 'bw', name: 'BLACK & WHITE' },
];

/** Reusable work buffers (grown on demand, never shrunk). */
export interface FilterScratch {
  copy: Uint8ClampedArray;
  lum: Float32Array;
  glow: Float32Array;
  tmp: Float32Array;
}

export function filterScratch(): FilterScratch {
  return { copy: new Uint8ClampedArray(0), lum: new Float32Array(0), glow: new Float32Array(0), tmp: new Float32Array(0) };
}

const INK = [26, 28, 44];
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Darkening toward the corners: 1 in the middle, 1 - k at the corners. */
function vignette(x: number, y: number, w: number, h: number, k: number): number {
  const dx = (x / w - 0.5) * 2;
  const dy = (y / h - 0.5) * 2;
  return 1 - k * ((dx * dx + dy * dy) / 2);
}

/** Small deterministic noise in -1..1 (film grain without Math.random). */
function grain(x: number, y: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  h ^= h >>> 13;
  return ((h & 1023) / 511.5) - 1;
}

function ensure(s: FilterScratch, n: number): void {
  if (s.copy.length < n * 4) s.copy = new Uint8ClampedArray(n * 4);
  if (s.lum.length < n) s.lum = new Float32Array(n);
  if (s.glow.length < n * 3) {
    s.glow = new Float32Array(n * 3);
    s.tmp = new Float32Array(n * 3);
  }
}

/** Apply a filter in place to RGBA pixels `px` (w x h). */
export function applyPhotoFilter(px: Uint8ClampedArray, w: number, h: number, f: PhotoFilter, s: FilterScratch = filterScratch()): void {
  const n = w * h;
  if (f === 'normal' || n === 0) return;
  ensure(s, n);
  if (f === 'sepia') {
    for (let y = 0, i = 0; y < h; y++)
      for (let x = 0; x < w; x++, i += 4) {
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const v = vignette(x, y, w, h, 0.45) * (1 + grain(x, y) * 0.03);
        px[i] = clamp((r * 0.393 + g * 0.769 + b * 0.189) * v);
        px[i + 1] = clamp((r * 0.349 + g * 0.686 + b * 0.168) * v);
        px[i + 2] = clamp((r * 0.272 + g * 0.534 + b * 0.131) * v);
      }
    return;
  }
  if (f === 'bw') {
    for (let y = 0, i = 0; y < h; y++)
      for (let x = 0; x < w; x++, i += 4) {
        const l = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
        const v = clamp(((l - 128) * 1.3 + 128) * vignette(x, y, w, h, 0.35) + grain(x, y) * 7);
        px[i] = px[i + 1] = px[i + 2] = v;
      }
    return;
  }
  if (f === 'crt') {
    const src = s.copy;
    src.set(px.subarray(0, n * 4));
    for (let y = 0, i = 0; y < h; y++) {
      // Every other row is a dark scanline; colours fringe sideways like an old tube.
      const line = y & 1 ? 0.68 : 1.08;
      for (let x = 0; x < w; x++, i += 4) {
        const l = x > 0 ? i - 4 : i;
        const rr = x < w - 1 ? i + 4 : i;
        let r = src[l];
        let g = src[i + 1];
        let b = src[rr + 2];
        const m = (r + g + b) / 3;
        r = m + (r - m) * 1.25;
        g = m + (g - m) * 1.25;
        b = m + (b - m) * 1.25;
        const v = line * vignette(x, y, w, h, 0.5);
        // Phosphor triads: a faint RGB column pattern.
        const col = x % 3;
        px[i] = clamp(r * v * (col === 0 ? 1.08 : 0.94));
        px[i + 1] = clamp(g * v * (col === 1 ? 1.08 : 0.94));
        px[i + 2] = clamp(b * v * (col === 2 ? 1.08 : 0.94));
      }
    }
    return;
  }
  if (f === 'comic') {
    // Brightness, softened 3x3 so ground texture doesn't turn into ink speckles.
    const lum = s.lum;
    const raw = s.glow;
    for (let k = 0, i = 0; k < n; k++, i += 4) raw[k] = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy)) * w;
          for (let dx = -1; dx <= 1; dx++) sum += raw[yy + Math.min(w - 1, Math.max(0, x + dx))];
        }
        lum[y * w + x] = sum / 9;
      }
    for (let y = 0, i = 0; y < h; y++)
      for (let x = 0; x < w; x++, i += 4) {
        const k = y * w + x;
        // Sobel edge strength: strong edges become ink lines.
        const xl = x > 0 ? -1 : 0;
        const xr = x < w - 1 ? 1 : 0;
        const yu = y > 0 ? -w : 0;
        const yd = y < h - 1 ? w : 0;
        const gx = lum[k + yu + xr] + 2 * lum[k + xr] + lum[k + yd + xr] - lum[k + yu + xl] - 2 * lum[k + xl] - lum[k + yd + xl];
        const gy = lum[k + yd + xl] + 2 * lum[k + yd] + lum[k + yd + xr] - lum[k + yu + xl] - 2 * lum[k + yu] - lum[k + yu + xr];
        // Ink only on the darker side of an edge, so lines stay one pixel thin on small sprites.
        if (gx * gx + gy * gy > 50 * 50 && raw[k] < lum[k] - 1) {
          px[i] = INK[0];
          px[i + 1] = INK[1];
          px[i + 2] = INK[2];
          continue;
        }
        // Flat, punchy colour: saturate, then posterize to 4 levels per channel.
        const l = lum[k];
        let r = px[i];
        let g = px[i + 1];
        let b = px[i + 2];
        const m = (r + g + b) / 3;
        r = clamp(m + (r - m) * 1.5 + 12);
        g = clamp(m + (g - m) * 1.5 + 12);
        b = clamp(m + (b - m) * 1.5 + 12);
        px[i] = Math.round(r / 85) * 85;
        px[i + 1] = Math.round(g / 85) * 85;
        px[i + 2] = Math.round(b / 85) * 85;
        // Halftone dots in the shadows.
        if (l < 110 && (x + (y & 2)) % 4 === 0 && y % 2 === 0) {
          px[i] = px[i] * 0.5;
          px[i + 1] = px[i + 1] * 0.5;
          px[i + 2] = px[i + 2] * 0.58;
        }
      }
    return;
  }
  if (f === 'neon') {
    // Bright, saturated pixels glow; everything else sinks into a dark blue night.
    const glow = s.glow;
    const tmp = s.tmp;
    for (let k = 0, i = 0; k < n; k++, i += 4) {
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      // Only strongly coloured, bright pixels glow (sand and stone stay dark).
      const sat = (mx - mn) / (mx || 1);
      const k01 = Math.max(0, (mx - 110) / 145) * Math.max(0, (sat - 0.42) / 0.58) * 1.6 + (mn > 235 ? 0.6 : 0);
      glow[k * 3] = r * k01;
      glow[k * 3 + 1] = g * k01;
      glow[k * 3 + 2] = b * k01;
    }
    boxBlur3(glow, tmp, w, h, 3);
    boxBlur3(glow, tmp, w, h, 3);
    for (let y = 0, i = 0; y < h; y++)
      for (let x = 0; x < w; x++, i += 4) {
        const k = (y * w + x) * 3;
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const m = (r + g + b) / 3;
        const v = vignette(x, y, w, h, 0.4);
        // Dark base with a violet-blue cast, sharp bright cores, plus the halo.
        const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / (Math.max(r, g, b) || 1);
        const keep = 0.16 + Math.min(1, Math.max(0, (sat - 0.42) / 0.4)) * 0.75;
        px[i] = clamp(((m + (r - m) * 1.8) * keep * 0.85 + 8 + glow[k] * 2.2) * v);
        px[i + 1] = clamp(((m + (g - m) * 1.8) * keep * 0.8 + 6 + glow[k + 1] * 2.2) * v);
        px[i + 2] = clamp(((m + (b - m) * 1.8) * keep + 30 + glow[k + 2] * 2.2) * v);
      }
  }
}

/** Separable box blur of an RGB float image, radius r, in place (tmp is scratch of the same size). */
function boxBlur3(a: Float32Array, tmp: Float32Array, w: number, h: number, r: number): void {
  const d = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++)
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) sum += a[(row + Math.min(w - 1, Math.max(0, x))) * 3 + c];
      for (let x = 0; x < w; x++) {
        tmp[(row + x) * 3 + c] = sum * d;
        sum += a[(row + Math.min(w - 1, x + r + 1)) * 3 + c] - a[(row + Math.max(0, x - r)) * 3 + c];
      }
    }
  for (let x = 0; x < w; x++)
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c];
      for (let y = 0; y < h; y++) {
        a[(y * w + x) * 3 + c] = sum * d;
        sum += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c] - tmp[(Math.max(0, y - r) * w + x) * 3 + c];
      }
    }
}

// ---------------------------------------------------------------- free camera

export const photoTuning = {
  /** Pan speed (m/s at the default distance; scales with distance), x3 with Shift. */
  pan: 12,
  rotate: 1.7,
  tilt: 0.9,
  /** Zoom speed (fraction of the distance per second). */
  zoom: 1.4,
  /** How far the camera's focus may wander from where photo mode opened (m). */
  maxPan: 32,
  minDist: 5,
  maxDist: 70,
  /** Camera pitch limits (degrees above the ground). */
  minPitch: 12,
  maxPitch: 89,
  /** Saved PNG height (the image is the game's pixels scaled up by a whole number). */
  outHeight: 1080,
};

export interface PhotoCam {
  x: number;
  z: number;
  /** Rotation around the focus (radians, 0 = the game's own view). */
  yaw: number;
  /** Degrees above the ground. */
  pitch: number;
  dist: number;
}

/** Keep the photo camera inside its limits around the start point (ox, oz). Mutates and returns `c`. */
export function clampPhotoCam(c: PhotoCam, ox: number, oz: number): PhotoCam {
  const t = photoTuning;
  const dx = c.x - ox;
  const dz = c.z - oz;
  const d = Math.hypot(dx, dz);
  if (d > t.maxPan) {
    c.x = ox + (dx / d) * t.maxPan;
    c.z = oz + (dz / d) * t.maxPan;
  }
  c.pitch = Math.min(t.maxPitch, Math.max(t.minPitch, c.pitch));
  c.dist = Math.min(t.maxDist, Math.max(t.minDist, c.dist));
  c.yaw = Math.atan2(Math.sin(c.yaw), Math.cos(c.yaw));
  return c;
}

/** Camera position for a photo camera (looks at its focus on the ground). */
export function photoCamPosition(c: PhotoCam, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const p = (c.pitch * Math.PI) / 180;
  out.x = c.x + Math.sin(c.yaw) * Math.cos(p) * c.dist;
  out.y = Math.sin(p) * c.dist;
  out.z = c.z + Math.cos(c.yaw) * Math.cos(p) * c.dist;
  return out;
}

/** Whole-number upscale that brings an image of height h closest to `target` pixels tall (1..8). */
export function photoScale(h: number, target = photoTuning.outHeight): number {
  return Math.max(1, Math.min(8, Math.round(target / Math.max(1, h))));
}

/** File name for a photo taken at `d`: InfiniShoot-2026-10-19-143005.png */
export function photoFileName(d: Date): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `InfiniShoot-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}
