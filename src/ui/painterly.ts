/**
 * Painterly panels for the ending cinematic (src/ui/cinematicsUi.ts): every
 * panel is painted once onto an offscreen canvas with thousands of seeded
 * brush strokes (colour jitter, strokes following each shape's flow, light
 * from one side), a watercolour wash under them, then a paper texture
 * multiplied on top and a torn, bleeding edge. No image files; the same seed
 * paints the same picture.
 */
import { endingTuning } from '../game/cinematics';

/** Colours the panels need from the run: the hero's look and the final boss's. */
export interface EndingCast {
  armor: string;
  accent: string;
  suit: string;
  hair: string;
  boss: string;
  bossAccent: string;
  loop: number;
}

type Ctx = CanvasRenderingContext2D;

/** Small seeded generator (mulberry32) so a panel always paints the same. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** '#rrggbb' or 'rgb(r,g,b)' (what `mix` returns, so mixes can be mixed again) -> [r, g, b]. */
export function rgb(c: string): [number, number, number] {
  if (c.startsWith('rgb')) {
    const m = c.match(/\d+/g) ?? [];
    return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
  }
  const n = parseInt(c.replace('#', '').slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix two colours (t 0..1) and soften toward paper cream (`soft` 0..1). */
export function mix(a: string, b: string, t: number, soft = 0): string {
  const A = rgb(a);
  const B = rgb(b);
  const P = [244, 236, 214];
  const c = A.map((v, i) => {
    const m = v + (B[i] - v) * t;
    return Math.round(m + (P[i] - m) * soft);
  });
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

interface Brush {
  r: () => number;
  ctx: Ctx;
  density: number;
}

/**
 * Fill the current path's area with strokes: colour from `top` to `bottom` down the
 * box (y0..y1), strokes of `len` px along `angle` (rad), jittered.
 */
function strokes(b: Brush, x0: number, y0: number, x1: number, y1: number, top: string, bottom: string, angle: number, len: number, width: number, soft = 0.15, jitter = 0.18): void {
  const { ctx, r } = b;
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  const n = Math.round((area / (len * width * 0.55)) * b.density);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0);
    const y = y0 + r() * (y1 - y0);
    const t = Math.max(0, Math.min(1, (y - y0) / Math.max(1, y1 - y0) + (r() - 0.5) * jitter * 2));
    const a = angle + (r() - 0.5) * 0.5;
    const l = len * (0.6 + r() * 0.8);
    const dx = Math.cos(a) * l * 0.5;
    const dy = Math.sin(a) * l * 0.5;
    const bend = (r() - 0.5) * l * 0.3;
    ctx.strokeStyle = mix(top, bottom, t, soft + (r() - 0.5) * 0.12);
    ctx.globalAlpha = 0.35 + r() * 0.45;
    ctx.lineWidth = width * (0.6 + r() * 0.8);
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.quadraticCurveTo(x - dy * 0.3 + bend, y + dx * 0.3, x + dx, y + dy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** A flat watercolour wash under the strokes, so no paper shows through the paint by accident. */
function wash(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, top: string, bottom: string): void {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, mix(top, top, 0, 0.1));
  g.addColorStop(1, mix(bottom, bottom, 0, 0.1));
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/** Clip to a shape drawn by `shape`, paint inside it, restore. */
function inside(ctx: Ctx, shape: (c: Ctx) => void, paint: () => void): void {
  ctx.save();
  ctx.beginPath();
  shape(ctx);
  ctx.clip();
  paint();
  ctx.restore();
}

/** Lumpy blob outline (islands, clouds, smoke) around (cx, cy). */
function blob(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, r: () => number, lumps = 9, flatBottom = false): void {
  const n = lumps * 3;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + Math.sin(a * lumps * 0.5 + r() * 0.6) * 0.12 + (r() - 0.5) * 0.06;
    let y = cy + Math.sin(a) * ry * k;
    if (flatBottom && y > cy) y = cy + (y - cy) * 0.25;
    const x = cx + Math.cos(a) * rx * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Paper grain and fibres, multiplied over the paint. */
function paper(ctx: Ctx, w: number, h: number, r: () => number): void {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const g = 228 + r() * 27;
    d[i * 4] = g;
    d[i * 4 + 1] = g - 4;
    d[i * 4 + 2] = g - 14;
    d[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d');
  if (!t) return;
  t.putImageData(img, 0, 0);
  // Fibres: faint long lines.
  t.globalAlpha = 0.08;
  t.strokeStyle = '#8a7a60';
  t.lineWidth = 0.5;
  for (let i = 0; i < 70; i++) {
    const x = r() * w;
    const y = r() * h;
    const a = r() * Math.PI;
    t.beginPath();
    t.moveTo(x, y);
    t.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18);
    t.stroke();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

/** Torn, bleeding edge: the paint fades into the paper toward the panel's border. */
function deckle(ctx: Ctx, w: number, h: number, r: () => number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  const m = 9;
  const pts = 60;
  for (let i = 0; i <= pts; i++) {
    const k = i / pts;
    ctx[i === 0 ? 'moveTo' : 'lineTo'](m + k * (w - 2 * m), m + (r() - 0.5) * 6);
  }
  for (let i = 0; i <= pts * 0.6; i++) ctx.lineTo(w - m + (r() - 0.5) * 6, m + (i / (pts * 0.6)) * (h - 2 * m));
  for (let i = 0; i <= pts; i++) ctx.lineTo(w - m - (i / pts) * (w - 2 * m), h - m + (r() - 0.5) * 6);
  for (let i = 0; i <= pts * 0.6; i++) ctx.lineTo(m + (r() - 0.5) * 6, h - m - (i / (pts * 0.6)) * (h - 2 * m));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Bleed: a soft dark rim just inside the tear, like pigment pooling at the edge of a wash.
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#5d275d';
  ctx.lineWidth = 3;
  ctx.strokeRect(m + 2, m + 2, w - 2 * m - 4, h - 2 * m - 4);
  ctx.restore();
}

// ---------------------------------------------------------------- the panels

function paintFall(b: Brush, w: number, h: number, c: EndingCast): void {
  const { ctx, r } = b;
  // Storm-sunset sky.
  wash(ctx, 0, 0, w, h, '#5d275d', '#ef7d57');
  strokes(b, 0, 0, w, h * 0.75, '#5d275d', '#ef7d57', 0.15, 26, 7, 0.2);
  // Sea.
  inside(ctx, (k) => k.rect(0, h * 0.7, w, h * 0.3), () => {
    wash(ctx, 0, h * 0.7, w, h, '#b13e53', '#29366f');
    strokes(b, 0, h * 0.7, w, h, '#ef7d57', '#29366f', 0, 30, 4, 0.15, 0.1);
  });
  // Light bursting from the boss: long rays.
  const ox = w * 0.62;
  const oy = h * 0.42;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI * 0.95 + (i / 13) * Math.PI * 0.9 + (r() - 0.5) * 0.1;
    ctx.globalAlpha = 0.07 + r() * 0.07;
    ctx.fillStyle = '#ffcd75';
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a - 0.04) * w, oy + Math.sin(a - 0.04) * w);
    ctx.lineTo(ox + Math.cos(a + 0.04) * w, oy + Math.sin(a + 0.04) * w);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Omega: a huge horned dome tipping into the sea, its one great eye cracked and guttering.
  const R = h * 0.3;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(-0.38);
  ctx.translate(-ox, -oy);
  // Horns.
  for (const sx of [-1, 1]) {
    inside(ctx, (k) => {
      k.moveTo(ox + sx * R * 0.45, oy - R * 0.55);
      k.lineTo(ox + sx * R * 0.95, oy - R * 1.25);
      k.lineTo(ox + sx * R * 0.78, oy - R * 0.42);
      k.closePath();
    }, () => strokes(b, ox - R * 1.2, oy - R * 1.3, ox + R * 1.2, oy - R * 0.4, c.bossAccent, mix(c.bossAccent, '#5d275d', 0.6), -1.1, 8, 3, 0.05));
  }
  // Dome.
  inside(ctx, (k) => k.ellipse(ox, oy, R * 1.1, R * 0.82, 0, 0, Math.PI * 2), () => {
    wash(ctx, ox - R * 1.2, oy - R, ox + R * 1.2, oy + R, mix(c.boss, '#73eff7', 0.3), mix(c.boss, '#1a1c2c', 0.5));
    strokes(b, ox - R * 1.2, oy - R * 0.9, ox + R * 1.2, oy + R * 0.9, mix(c.boss, '#f4f4f4', 0.4), mix(c.boss, '#1a1c2c', 0.45), 0.25, 14, 4, 0.05, 0.25);
  });
  // Visor band.
  inside(ctx, (k) => k.rect(ox - R * 1.15, oy - R * 0.2, R * 2.3, R * 0.42), () => strokes(b, ox - R * 1.2, oy - R * 0.22, ox + R * 1.2, oy + R * 0.24, '#333c57', '#1a1c2c', 0, 12, 3, 0.02));
  // The eye: a glowing ring, a white-hot core.
  inside(ctx, (k) => k.ellipse(ox, oy, R * 0.34, R * 0.3, 0, 0, Math.PI * 2), () => strokes(b, ox - R * 0.4, oy - R * 0.35, ox + R * 0.4, oy + R * 0.35, c.bossAccent, '#b13e53', 0.6, 6, 3, 0, 0.3));
  inside(ctx, (k) => k.ellipse(ox, oy, R * 0.15, R * 0.13, 0, 0, Math.PI * 2), () => strokes(b, ox - R * 0.2, oy - R * 0.2, ox + R * 0.2, oy + R * 0.2, '#f4f4f4', '#ffcd75', 0.6, 4, 2, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = c.bossAccent;
  ctx.beginPath();
  ctx.arc(ox, oy, R * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();
  // Cracks of light across the hull.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = '#ffcd75';
  for (let i = 0; i < 6; i++) {
    let x = ox + (r() - 0.5) * R * 0.5;
    let y = oy + (r() - 0.5) * R * 0.5;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 2.2 - i * 0.25;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (r() - 0.5) * R * 0.5;
      y += (r() - 0.3) * R * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  // Shards of hull flying off.
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * (0.15 + r() * 0.7);
    const d = R * (1.15 + r() * 0.5);
    const sx = ox + Math.cos(a) * d;
    const sy = oy + Math.sin(a) * d;
    const z = 5 + r() * 7;
    inside(ctx, (k) => {
      k.moveTo(sx, sy - z);
      k.lineTo(sx + z * 0.9, sy + z * 0.3);
      k.lineTo(sx - z * 0.6, sy + z * 0.6);
      k.closePath();
    }, () => strokes(b, sx - z, sy - z, sx + z, sy + z, mix(c.boss, '#f4f4f4', 0.2), '#1a1c2c', r() * 3, 4, 2, 0.05));
  }
  // Smoke drifting up from the hull.
  for (let i = 0; i < 6; i++) {
    const sx = ox + (r() - 0.5) * R * 1.6;
    const sy = oy - R * (0.6 + r() * 0.9);
    inside(ctx, (k) => blob(k, sx, sy, 22 + r() * 18, 12 + r() * 8, r, 6), () => strokes(b, sx - 40, sy - 20, sx + 40, sy + 20, '#566c86', '#333c57', -0.5, 12, 4, 0.25));
  }
  // Splash where it meets the sea.
  inside(ctx, (k) => blob(k, ox, h * 0.73, R * 1.5, 14, r, 12, true), () => strokes(b, ox - R * 1.6, h * 0.68, ox + R * 1.6, h * 0.78, '#f4f4f4', '#73eff7', -0.2, 10, 3, 0.1));
  // The hero on a rock in the foreground (left), arm cannon still raised.
  const hx = w * 0.17;
  const hy = h * 0.82;
  inside(ctx, (k) => blob(k, hx, hy + 18, 62, 26, r, 8, true), () => strokes(b, hx - 70, hy, hx + 70, hy + 45, '#333c57', '#1a1c2c', 0.3, 10, 4, 0.05));
  heroFigure(b, hx, hy, 0.62, c, 'side');
}

function paintCalm(b: Brush, w: number, h: number, c: EndingCast): void {
  const { ctx, r } = b;
  void c;
  // Dawn: peach low, pale sky high.
  wash(ctx, 0, 0, w, h * 0.62, '#94b0c2', '#ffcd75');
  strokes(b, 0, 0, w, h * 0.62, '#73eff7', '#ffcd75', 0.05, 30, 7, 0.4, 0.12);
  // Soft clouds.
  for (let i = 0; i < 7; i++) {
    const cx = r() * w;
    const cy = h * (0.08 + r() * 0.35);
    const rx = 30 + r() * 45;
    inside(ctx, (k) => blob(k, cx, cy, rx, rx * 0.28, r, 7, true), () => strokes(b, cx - rx, cy - rx * 0.3, cx + rx, cy + rx * 0.3, '#f4f4f4', '#ef7d57', 0, 14, 4, 0.5, 0.25));
  }
  // The sun just over the horizon.
  inside(ctx, (k) => k.arc(w * 0.7, h * 0.6, 26, 0, Math.PI * 2), () => strokes(b, w * 0.7 - 30, h * 0.6 - 30, w * 0.7 + 30, h * 0.6 + 30, '#f4f4f4', '#ffcd75', 0.8, 8, 3, 0.2));
  // Calm sea: long horizontal strokes, glitter under the sun.
  inside(ctx, (k) => k.rect(0, h * 0.6, w, h * 0.4), () => {
    wash(ctx, 0, h * 0.6, w, h, '#41a6f6', '#29366f');
    strokes(b, 0, h * 0.6, w, h, '#73eff7', '#29366f', 0, 34, 3, 0.25, 0.08);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 60; i++) {
      ctx.globalAlpha = 0.25 + r() * 0.3;
      ctx.fillStyle = '#ffcd75';
      const y = h * 0.62 + r() * h * 0.3;
      const x = w * 0.7 + (r() - 0.5) * (y - h * 0.55) * 1.3;
      ctx.fillRect(x, y, 4 + r() * 10, 1);
    }
    ctx.restore();
  });
  // Islands, far to near: paler with distance.
  const isles: [number, number, number, number][] = [
    [0.18, 0.6, 70, 0.55],
    [0.47, 0.61, 46, 0.45],
    [0.86, 0.61, 34, 0.5],
    [0.32, 0.74, 95, 0.1],
  ];
  for (const [ix, iy, rx, far] of isles) {
    const x = w * ix;
    const y = h * iy;
    inside(ctx, (k) => blob(k, x, y, rx, rx * 0.42, r, 8, true), () => {
      wash(ctx, x - rx, y - rx * 0.5, x + rx, y + 4, mix('#38b764', '#94b0c2', far), mix('#257179', '#94b0c2', far));
      strokes(b, x - rx, y - rx * 0.5, x + rx, y + 4, mix('#a7f070', '#94b0c2', far), mix('#257179', '#94b0c2', far), -0.6, 9, 3, 0.15 + far * 0.3);
    });
    // Sandy rim at the waterline.
    inside(ctx, (k) => k.ellipse(x, y + 1, rx * 0.95, 4, 0, 0, Math.PI * 2), () => strokes(b, x - rx, y - 4, x + rx, y + 5, '#ffcd75', mix('#ef7d57', '#94b0c2', far), 0, 8, 2, 0.2));
  }
  // A few birds.
  ctx.strokeStyle = '#333c57';
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < 5; i++) {
    const x = w * (0.45 + r() * 0.3);
    const y = h * (0.2 + r() * 0.15);
    const s = 4 + r() * 4;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.4);
    ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.6, x, y);
    ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.6, x + s, y - s * 0.4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintLookout(b: Brush, w: number, h: number, c: EndingCast): void {
  const { ctx, r } = b;
  // Golden evening, a violet band on the horizon where something stirs.
  wash(ctx, 0, 0, w, h, '#3b5dc9', '#ef7d57');
  strokes(b, 0, 0, w, h * 0.7, '#3b5dc9', '#ffcd75', 0.1, 28, 7, 0.25);
  inside(ctx, (k) => k.rect(0, h * 0.55, w, h * 0.12), () => strokes(b, 0, h * 0.55, w, h * 0.67, '#5d275d', '#b13e53', 0, 30, 4, 0.2));
  // The distant spire on the horizon, faint, with a glint.
  const sx = w * 0.72;
  inside(ctx, (k) => {
    k.moveTo(sx - 9, h * 0.6);
    k.lineTo(sx - 2, h * 0.38);
    k.lineTo(sx + 2, h * 0.38);
    k.lineTo(sx + 9, h * 0.6);
    k.closePath();
  }, () => strokes(b, sx - 12, h * 0.36, sx + 12, h * 0.61, '#5d275d', '#29366f', 1.5, 6, 2, 0.25));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#73eff7';
  ctx.beginPath();
  ctx.arc(sx, h * 0.39, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Sea below.
  inside(ctx, (k) => k.rect(0, h * 0.6, w, h * 0.4), () => strokes(b, 0, h * 0.6, w, h, '#ef7d57', '#29366f', 0, 30, 3, 0.2, 0.1));
  // The cliff the hero stands on (bottom left, cutting the frame).
  inside(ctx, (k) => {
    k.moveTo(-10, h + 10);
    k.lineTo(-10, h * 0.66);
    k.quadraticCurveTo(w * 0.2, h * 0.62, w * 0.42, h * 0.7);
    k.lineTo(w * 0.47, h + 10);
    k.closePath();
  }, () => {
    wash(ctx, 0, h * 0.6, w * 0.5, h, '#566c86', '#1a1c2c');
    strokes(b, 0, h * 0.6, w * 0.5, h, '#94b0c2', '#1a1c2c', 1.1, 12, 4, 0.05, 0.25);
    strokes(b, 0, h * 0.62, w * 0.45, h * 0.7, '#a7f070', '#38b764', 0, 8, 3, 0.1);
  });
  // Grass tufts swept by the wind.
  ctx.strokeStyle = '#38b764';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 40; i++) {
    const x = r() * w * 0.42;
    const y = h * 0.65 + (x / (w * 0.42)) * h * 0.04 + r() * 4;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 3, y - 6, x + 8, y - 8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  heroFigure(b, w * 0.25, h * 0.66, 1.25, c, 'back');
}

/** The last card: a pale wash with a brushed blot behind the DOM title. */
function paintEnd(b: Brush, w: number, h: number): void {
  const { ctx, r } = b;
  wash(ctx, 0, 0, w, h, '#f4f4f4', '#ffcd75');
  strokes(b, 0, 0, w, h, '#f4f4f4', '#ffcd75', 0.3, 30, 8, 0.55, 0.3);
  inside(ctx, (k) => blob(k, w / 2, h * 0.45, w * 0.33, h * 0.2, r, 10), () => strokes(b, w * 0.1, h * 0.2, w * 0.9, h * 0.7, '#5d275d', '#b13e53', -0.2, 18, 6, 0.15, 0.3));
}

/**
 * The hero, painted: chunky body, big helmet, arm cannon. `side` faces right
 * (towards the falling boss), `back` stands with its back to us, looking out.
 */
function heroFigure(b: Brush, x: number, y: number, s: number, c: EndingCast, view: 'side' | 'back'): void {
  const { ctx } = b;
  const u = 30 * s;
  const part = (shape: (k: Ctx) => void, top: string, bottom: string, x0: number, y0: number, x1: number, y1: number, angle = 1.4) =>
    inside(ctx, shape, () => {
      wash(ctx, x0, y0, x1, y1, top, bottom);
      strokes(b, x0, y0, x1, y1, mix(top, '#f4f4f4', 0.3), mix(bottom, top, 0.35), angle, Math.max(4, u * 0.25), Math.max(1.5, u * 0.08), 0.05, 0.2);
    });
  // Legs and boots.
  for (const dx of [-0.32, 0.32]) {
    part((k) => k.rect(x + dx * u - u * 0.16, y - u * 0.9, u * 0.32, u * 0.7), c.suit, mix(c.suit, '#1a1c2c', 0.5), x - u, y - u, x + u, y);
    part((k) => k.ellipse(x + dx * u, y - u * 0.15, u * 0.3, u * 0.18, 0, 0, Math.PI * 2), c.armor, mix(c.armor, '#1a1c2c', 0.5), x - u, y - u * 0.4, x + u, y + u * 0.1);
  }
  // Torso.
  part((k) => k.ellipse(x, y - u * 1.25, u * 0.55, u * 0.5, 0, 0, Math.PI * 2), c.armor, mix(c.armor, '#1a1c2c', 0.45), x - u, y - u * 1.8, x + u, y - u * 0.7);
  // Arms: the cannon arm.
  if (view === 'side') {
    part((k) => {
      k.save();
      k.translate(x + u * 0.35, y - u * 1.35);
      k.rotate(-0.45);
      k.rect(0, -u * 0.17, u * 1.05, u * 0.34);
      k.restore();
    }, c.accent, mix(c.accent, '#1a1c2c', 0.45), x, y - u * 2, x + u * 1.6, y - u);
    // Muzzle glow.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#73eff7';
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(x + u * 1.3, y - u * 1.82, u * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    part((k) => k.ellipse(x - u * 0.62, y - u * 1.1, u * 0.2, u * 0.42, 0.15, 0, Math.PI * 2), c.armor, mix(c.armor, '#1a1c2c', 0.5), x - u, y - u * 1.6, x, y - u * 0.6);
    part((k) => k.ellipse(x + u * 0.66, y - u * 1.08, u * 0.27, u * 0.45, -0.1, 0, Math.PI * 2), c.accent, mix(c.accent, '#1a1c2c', 0.5), x, y - u * 1.6, x + u, y - u * 0.6);
  }
  // Big head: helmet (back view shows the helmet and a tuft of hair).
  part((k) => k.arc(x, y - u * 2.15, u * 0.62, 0, Math.PI * 2), c.armor, mix(c.armor, '#1a1c2c', 0.5), x - u, y - u * 2.8, x + u, y - u * 1.5, 0.6);
  if (view === 'back') part((k) => k.ellipse(x, y - u * 1.72, u * 0.4, u * 0.16, 0, 0, Math.PI * 2), c.hair, mix(c.hair, '#1a1c2c', 0.5), x - u, y - u * 1.9, x + u, y - u * 1.5);
  else part((k) => k.ellipse(x + u * 0.25, y - u * 2.08, u * 0.32, u * 0.3, 0, 0, Math.PI * 2), '#f4f4f4', '#ffcd75', x - u, y - u * 2.5, x + u, y - u * 1.7);
  // Rim light from the sky behind.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#ffcd75';
  ctx.lineWidth = Math.max(1, u * 0.06);
  ctx.beginPath();
  ctx.arc(x, y - u * 2.15, u * 0.62, -Math.PI * 0.9, -Math.PI * 0.2);
  ctx.stroke();
  ctx.restore();
}

/** Paint one ending panel (index into ENDING_PANELS) onto `canvas`. */
export function paintPanel(canvas: HTMLCanvasElement, panel: number, cast: EndingCast): void {
  const w = (canvas.width = endingTuning.width);
  const h = (canvas.height = endingTuning.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const r = rng(0x5eed + panel * 977 + cast.loop * 31);
  const b: Brush = { ctx, r, density: endingTuning.strokes };
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#f4ecd6';
  ctx.fillRect(0, 0, w, h);
  if (panel === 0) paintFall(b, w, h, cast);
  else if (panel === 1) paintCalm(b, w, h, cast);
  else if (panel === 2) paintLookout(b, w, h, cast);
  else paintEnd(b, w, h);
  paper(ctx, w, h, r);
  deckle(ctx, w, h, r);
}
