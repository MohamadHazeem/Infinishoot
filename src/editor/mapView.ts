/**
 * Top-down pixel map of a custom arena for the editor (editor lane). Drawn on
 * a 2D canvas with the biome's own ground/wall/leaf/lava textures and colours,
 * so a Magma arena looks like magma and a Toy Factory like the play-mat.
 * World x runs right and z runs down, like the game camera. The ground layer
 * is cached per biome and size; pieces, the reach overlay and the cursor are
 * redrawn on demand (not every frame unless the cursor blinks).
 */
import { biomeByKey, type BiomeDef } from '../data/biomes';
import { biomeTex } from '../render/biomeTextures';
import { textures } from '../render/textures';
import { SIZE_HALF, beltOf, hazardRadius, padTarget, type ArenaPiece, type CustomArena, type Validity } from './arenaData';
import { PIECE_BY_ID, dirOf, footprint, type PieceId } from './pieces';

type Ctx = CanvasRenderingContext2D;

const INK = '#1a1c2c';
const SHADOW = 'rgba(26,28,44,0.45)';

function texCanvas(key: string): CanvasImageSource | null {
  try {
    const t = key === 'conveyor' || key === 'crate' ? textures[key]() : biomeTex(key as Parameters<typeof biomeTex>[0]);
    const img = t.image as CanvasImageSource & { width?: number };
    return img && (img as { width?: number }).width ? img : null;
  } catch {
    return null;
  }
}

/** Fill the current path/rect with a texture tiled every `tile` canvas pixels. */
function texFill(ctx: Ctx, key: string, tile: number, fallback: string, x: number, y: number, w: number, h: number, tint?: string): void {
  const img = texCanvas(key);
  ctx.fillStyle = fallback;
  ctx.fillRect(x, y, w, h);
  if (img) {
    try {
      const pat = ctx.createPattern(img, 'repeat');
      const iw = (img as { width: number }).width;
      if (pat && typeof pat.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
        pat.setTransform(new DOMMatrix().scale(tile / iw, tile / iw));
        ctx.fillStyle = pat;
        ctx.fillRect(x, y, w, h);
      }
    } catch {
      // Patterns can fail on tainted or mocked canvases: the flat colour stays.
    }
  }
  if (tint && tint.toLowerCase() !== '#ffffff') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
}

export interface CursorView {
  x: number;
  z: number;
  piece: PieceId | null;
  r: number;
  ok: boolean;
  erase: boolean;
}

/** Draw one piece. `S(x)` maps world -> canvas along both axes; ppm is pixels per metre. */
export function drawPiece(ctx: Ctx, p: ArenaPiece, biome: BiomeDef, ppm: number, S: (v: number) => number, alpha = 1, index = 0): void {
  const def = PIECE_BY_ID[p.k];
  const f = footprint(p.k, p.r);
  const px = Math.max(1, Math.round(ppm / 8));
  const cx = S(p.x);
  const cy = S(p.z);
  const w = f.w * ppm;
  const h = f.d * ppm;
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  ctx.globalAlpha = alpha;
  const shadow = (sx: number, sy: number, sw: number, sh: number, lift: number) => {
    ctx.fillStyle = SHADOW;
    ctx.fillRect(sx + lift, sy + lift, sw, sh);
  };
  const box = (fill: () => void, lift: number, cap: string) => {
    shadow(x0, y0, Math.round(w), Math.round(h), lift);
    fill();
    ctx.fillStyle = cap;
    ctx.fillRect(x0, y0, Math.round(w), px);
    ctx.fillRect(x0, y0, px, Math.round(h));
    ctx.fillStyle = INK;
    ctx.fillRect(x0, y0 + Math.round(h) - px, Math.round(w), px);
    ctx.fillRect(x0 + Math.round(w) - px, y0, px, Math.round(h));
  };
  const circle = (x: number, y: number, r: number, c: string) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();
  };
  const ring = (x: number, y: number, r: number, c: string, lw = px) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
    ctx.stroke();
  };
  const arrow = (x: number, y: number, len: number, c: string) => {
    const d = dirOf(p.r);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x + d.x * len, y + d.z * len);
    ctx.lineTo(x - d.z * len * 0.6 - d.x * len * 0.3, y + d.x * len * 0.6 - d.z * len * 0.3);
    ctx.lineTo(x + d.z * len * 0.6 - d.x * len * 0.3, y - d.x * len * 0.6 - d.z * len * 0.3);
    ctx.closePath();
    ctx.fill();
  };
  switch (p.k) {
    case 'wall':
    case 'longwall':
    case 'block': {
      const blocks = biome.wallStyle === 'blocks' && biome.blockColors?.length;
      box(() => {
        if (blocks) {
          const cols = biome.blockColors!;
          const step = Math.max(2, Math.round(ppm));
          for (let yy = 0; yy < h; yy += step)
            for (let xx = 0; xx < w; xx += step) {
              ctx.fillStyle = cols[(((Math.floor(xx / step) + Math.floor(yy / step) + p.x + p.z) % cols.length) + cols.length) % cols.length];
              ctx.fillRect(x0 + xx, y0 + yy, Math.min(step, w - xx), Math.min(step, h - yy));
            }
        } else texFill(ctx, biome.wall, 2 * ppm, '#94b0c2', x0, y0, Math.round(w), Math.round(h), biome.wallTint);
      }, Math.max(px, Math.round(ppm * (p.k === 'longwall' ? 0.5 : 0.35))), biome.capColor);
      break;
    }
    case 'pillar':
    case 'topple': {
      circle(cx + px * 2, cy + px * 2, 0.7 * ppm, SHADOW);
      circle(cx, cy, 0.7 * ppm, INK);
      circle(cx, cy, 0.7 * ppm - px, p.k === 'topple' ? '#ffcd75' : biome.pillarTint);
      ctx.fillStyle = biome.capColor;
      ctx.fillRect(Math.round(cx - 0.35 * ppm), Math.round(cy - 0.35 * ppm), Math.round(0.7 * ppm), Math.round(0.7 * ppm));
      if (p.k === 'topple') {
        ctx.fillStyle = '#b13e53';
        ctx.fillRect(Math.round(cx - px), Math.round(cy - 0.5 * ppm), px * 2, Math.round(ppm));
      }
      break;
    }
    case 'rock': {
      const r = 0.82 * ppm;
      circle(cx + px * 2, cy + px * 2, r, SHADOW);
      ctx.fillStyle = INK;
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + p.x;
        const rr = r * (0.82 + 0.18 * Math.sin(k * 2.3 + p.z));
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      circle(cx, cy, r * 0.72, biome.rockColors[0] ?? '#566c86');
      circle(cx - r * 0.2, cy - r * 0.2, r * 0.32, biome.rockColors[1] ?? biome.rockColors[0] ?? '#94b0c2');
      break;
    }
    case 'tree': {
      const r = 1.25 * ppm;
      circle(cx + px * 3, cy + px * 3, r, SHADOW);
      circle(cx, cy, r, INK);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r - px, 0, Math.PI * 2);
      ctx.clip();
      texFill(ctx, biome.leaves, 2 * ppm, '#38b764', cx - r, cy - r, r * 2, r * 2, biome.leafTint);
      ctx.restore();
      circle(cx - r * 0.3, cy - r * 0.3, r * 0.3, 'rgba(255,255,255,0.25)');
      break;
    }
    case 'crate':
    case 'stack': {
      box(() => texFill(ctx, 'crate', w, '#ef7d57', x0, y0, Math.round(w), Math.round(h)), Math.max(px, Math.round(ppm * (p.k === 'stack' ? 0.6 : 0.3))), '#ffcd75');
      if (p.k === 'stack') {
        ctx.fillStyle = 'rgba(26,28,44,0.35)';
        ctx.fillRect(x0 + Math.round(w * 0.2), y0 + Math.round(h * 0.2), Math.round(w * 0.6), Math.round(h * 0.6));
      }
      break;
    }
    case 'barrel': {
      const r = 0.45 * ppm;
      circle(cx + px, cy + px, r, SHADOW);
      circle(cx, cy, r, INK);
      circle(cx, cy, r - px, '#b13e53');
      circle(cx, cy, r * 0.5, '#ffcd75');
      break;
    }
    case 'lava':
    case 'ice':
    case 'water':
    case 'sand':
    case 'thorns': {
      const R = hazardRadius(p) * ppm;
      circle(cx, cy, R * 1.06, p.k === 'sand' ? '#f2d29a' : p.k === 'thorns' ? '#6b5a3a' : '#333c57');
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      if (p.k === 'thorns') {
        ctx.fillStyle = '#6b5a3a';
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        for (let k = 0; k < Math.round(hazardRadius(p) * 5); k++) {
          const a = k * 2.399;
          const d = Math.sqrt((k + 0.5) / (hazardRadius(p) * 5)) * R * 0.85;
          circle(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.5 * ppm, k % 3 ? '#38b764' : '#257179');
          ctx.fillStyle = '#ff7eb6';
          ctx.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d - 0.5 * ppm), px, px);
        }
      } else {
        const key = p.k === 'sand' ? 'clay' : p.k;
        const fall = p.k === 'lava' ? '#ef7d57' : p.k === 'ice' ? '#bfefff' : p.k === 'sand' ? '#b98a5a' : '#41a6f6';
        texFill(ctx, key, 2 * ppm, fall, cx - R, cy - R, R * 2, R * 2, p.k === 'sand' ? '#b98a5a' : undefined);
        if (p.k === 'sand') circle(cx, cy, R * 0.45, '#7a5038');
      }
      ctx.restore();
      break;
    }
    case 'belt': {
      const b = beltOf(p);
      const bw = b.w * ppm;
      const bh = b.d * ppm;
      const bx = Math.round(cx - bw / 2);
      const by = Math.round(cy - bh / 2);
      ctx.fillStyle = INK;
      ctx.fillRect(bx - px, by - px, Math.round(bw) + px * 2, Math.round(bh) + px * 2);
      ctx.fillStyle = '#333c57';
      ctx.fillRect(bx, by, Math.round(bw), Math.round(bh));
      // Chevrons along the direction.
      const d = dirOf(p.r);
      const len = Math.max(b.w, b.d);
      for (let s = -len / 2 + 1; s < len / 2; s += 1.6) {
        const ax = cx + d.x * s * ppm;
        const ay = cy + d.z * s * ppm;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.fillStyle = '#ffcd75';
        ctx.beginPath();
        const k = ppm * 0.7;
        ctx.moveTo(d.x * k * 0.6, d.z * k * 0.6);
        ctx.lineTo(-d.z * k - d.x * k * 0.2, d.x * k - d.z * k * 0.2);
        ctx.lineTo(-d.z * k * 0.6 - d.x * k * 0.5, d.x * k * 0.6 - d.z * k * 0.5);
        ctx.lineTo(0, 0);
        ctx.lineTo(d.z * k * 0.6 - d.x * k * 0.5, -d.x * k * 0.6 - d.z * k * 0.5);
        ctx.lineTo(d.z * k - d.x * k * 0.2, -d.x * k - d.z * k * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'pad': {
      const t = padTarget(p);
      ctx.strokeStyle = 'rgba(115,239,247,0.8)';
      ctx.lineWidth = px;
      ctx.setLineDash?.([px * 3, px * 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(S(t.x), S(t.z));
      ctx.stroke();
      ctx.setLineDash?.([]);
      ring(S(t.x), S(t.z), 0.8 * ppm, '#73eff7');
      circle(cx, cy, 0.9 * ppm, INK);
      circle(cx, cy, 0.9 * ppm - px, '#3b5dc9');
      circle(cx, cy, 0.55 * ppm, '#41a6f6');
      arrow(cx, cy, 0.6 * ppm, '#f4f4f4');
      break;
    }
    case 'turret': {
      box(() => {
        ctx.fillStyle = '#566c86';
        ctx.fillRect(x0, y0, Math.round(w), Math.round(h));
      }, px * 2, '#94b0c2');
      circle(cx, cy, 0.55 * ppm, INK);
      circle(cx, cy, 0.45 * ppm, '#94b0c2');
      ctx.fillStyle = INK;
      ctx.fillRect(Math.round(cx - px), Math.round(cy - 0.9 * ppm), px * 2, Math.round(0.6 * ppm));
      break;
    }
    case 'hero': {
      circle(cx, cy, 0.8 * ppm, INK);
      circle(cx, cy, 0.8 * ppm - px, '#3b5dc9');
      circle(cx, cy, 0.45 * ppm, '#41a6f6');
      label(ctx, String(index + 1), cx, cy, ppm, '#f4f4f4');
      break;
    }
    case 'boss': {
      ring(cx, cy, 1.5 * ppm, INK, px * 3);
      ring(cx, cy, 1.5 * ppm, '#b13e53', px * 2);
      circle(cx, cy, 0.8 * ppm, INK);
      circle(cx, cy, 0.8 * ppm - px, '#b13e53');
      // A tiny pixel skull.
      ctx.fillStyle = '#f4f4f4';
      const u = Math.max(1, Math.round(ppm / 5));
      for (const [sx, sy] of [[-2, -2], [-1, -2], [0, -2], [1, -2], [-2, -1], [1, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1]]) ctx.fillRect(Math.round(cx + sx * u), Math.round(cy + sy * u), u, u);
      ctx.fillStyle = INK;
      ctx.fillRect(Math.round(cx - u), Math.round(cy - u), u, u);
      ctx.fillRect(Math.round(cx), Math.round(cy - u), u, u);
      break;
    }
    case 'chest': {
      box(() => {
        ctx.fillStyle = '#a86a3c';
        ctx.fillRect(x0, y0, Math.round(w), Math.round(h));
      }, px, '#ffcd75');
      ctx.fillStyle = '#ffcd75';
      ctx.fillRect(x0, Math.round(cy - px / 2), Math.round(w), px);
      ctx.fillRect(Math.round(cx - px), Math.round(cy - px), px * 2, px * 2);
      break;
    }
    case 'gate': {
      circle(cx, cy, 0.85 * ppm, INK);
      circle(cx, cy, 0.85 * ppm - px, '#5d275d');
      ring(cx, cy, 0.5 * ppm, '#b13e53');
      arrow(cx, cy, 0.5 * ppm, '#ff4d5e');
      break;
    }
  }
  if (def.group === 'hazard' && alpha < 1) ring(cx, cy, hazardRadius(p) * ppm, '#f4f4f4');
  ctx.globalAlpha = 1;
}

function label(ctx: Ctx, s: string, x: number, y: number, ppm: number, c: string): void {
  ctx.fillStyle = c;
  ctx.font = `${Math.max(8, Math.round(ppm))}px Silkscreen, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y + 1);
}

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: Ctx | null;
  private ground: HTMLCanvasElement;
  private groundKey = '';
  /** Pixels per metre at the current canvas size. */
  ppm = 8;
  half = 34;
  grid = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ae-map';
    this.ctx = this.canvas.getContext('2d');
    this.ground = document.createElement('canvas');
  }

  /** Size the canvas for an arena (whole pixels per metre, about `target` px across). */
  fit(a: CustomArena, target: number): void {
    const half = SIZE_HALF[a.size];
    const ppm = Math.max(4, Math.floor(target / (half * 2)));
    if (ppm === this.ppm && half === this.half && this.canvas.width === half * 2 * ppm) return;
    this.ppm = ppm;
    this.half = half;
    this.canvas.width = this.canvas.height = half * 2 * ppm;
    this.groundKey = '';
  }

  S = (v: number): number => (v + this.half) * this.ppm;

  /** Canvas client coordinates -> world metres. */
  toWorld(clientX: number, clientY: number): { x: number; z: number } {
    const r = this.canvas.getBoundingClientRect();
    const k = (this.half * 2) / Math.max(1, r.width);
    return { x: (clientX - r.left) * k - this.half, z: (clientY - r.top) * (this.half * 2 / Math.max(1, r.height)) - this.half };
  }

  private drawGround(biome: BiomeDef): void {
    const key = `${biome.id}:${biome.variant ?? ''}:${this.half}:${this.ppm}`;
    if (key === this.groundKey) return;
    this.groundKey = key;
    const W = this.canvas.width;
    this.ground.width = this.ground.height = W;
    const g = this.ground.getContext('2d');
    if (!g) return;
    g.imageSmoothingEnabled = false;
    const ppm = this.ppm;
    texFill(g, biome.ground, 2 * ppm, biome.fog, 0, 0, W, W, biome.groundTint);
    // Tile checker like the field's ground tiles, and the central plaza.
    g.fillStyle = 'rgba(26,28,44,0.06)';
    for (let tz = 0; tz < this.half; tz++) for (let tx = 0; tx < this.half; tx++) if ((tx + tz) % 2) g.fillRect(tx * 2 * ppm, tz * 2 * ppm, 2 * ppm, 2 * ppm);
    g.save();
    g.beginPath();
    g.arc(W / 2, W / 2, 5 * ppm, 0, Math.PI * 2);
    g.clip();
    texFill(g, biome.path, 2 * ppm, '#b98a5a', 0, 0, W, W, biome.pathTint);
    g.restore();
    // The fence (or the island's hedge on XL).
    const t = ppm;
    if (this.half < SIZE_HALF.xl) {
      texFill(g, biome.wall, 2 * ppm, '#94b0c2', 0, 0, W, t, biome.wallTint);
      texFill(g, biome.wall, 2 * ppm, '#94b0c2', 0, W - t, W, t, biome.wallTint);
      texFill(g, biome.wall, 2 * ppm, '#94b0c2', 0, 0, t, W, biome.wallTint);
      texFill(g, biome.wall, 2 * ppm, '#94b0c2', W - t, 0, t, W, biome.wallTint);
    } else {
      g.fillStyle = biome.edge.colors[0] ?? '#38b764';
      g.fillRect(0, 0, W, t);
      g.fillRect(0, W - t, W, t);
      g.fillRect(0, 0, t, W);
      g.fillRect(W - t, 0, t, W);
    }
    g.fillStyle = INK;
    g.fillRect(t, t, W - 2 * t, Math.max(1, ppm / 8));
    g.fillRect(t, t, Math.max(1, ppm / 8), W - 2 * t);
  }

  draw(a: CustomArena, v: Validity | null, cursor: CursorView | null, time: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const biome = biomeByKey(a.rules.biome);
    this.drawGround(biome);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.ground, 0, 0);
    const ppm = this.ppm;
    const W = this.canvas.width;
    if (this.grid) {
      ctx.fillStyle = 'rgba(26,28,44,0.16)';
      for (let k = 2; k < this.half * 2; k += 2) {
        ctx.fillRect(k * ppm, ppm, 1, W - 2 * ppm);
        ctx.fillRect(ppm, k * ppm, W - 2 * ppm, 1);
      }
      ctx.fillStyle = 'rgba(244,244,244,0.35)';
      ctx.fillRect(Math.round(W / 2), ppm, 1, W - 2 * ppm);
      ctx.fillRect(ppm, Math.round(W / 2), W - 2 * ppm, 1);
    }
    // Ground pieces first, then objects, then markers on top.
    const order = (p: ArenaPiece) => (PIECE_BY_ID[p.k].round ? 0 : p.k === 'belt' ? 1 : PIECE_BY_ID[p.k].group === 'marker' ? 3 : 2);
    const sorted = a.pieces.map((p, i) => ({ p, i })).sort((x, y) => order(x.p) - order(y.p) || x.i - y.i);
    let hero = 0;
    for (const { p } of sorted) drawPiece(ctx, p, biome, ppm, this.S, 1, p.k === 'hero' ? hero++ : 0);
    // Floor the heroes can't reach: hatched.
    if (v && v.half === this.half) {
      const n = this.half * 2;
      ctx.fillStyle = 'rgba(26,28,44,0.42)';
      for (let j = 1; j < n - 1; j++)
        for (let i = 1; i < n - 1; i++) {
          if (v.reach[j * n + i]) continue;
          if ((i + j) % 2 === 0) ctx.fillRect(i * ppm, j * ppm, ppm, ppm);
        }
      const blink = Math.floor(time * 4) % 2 === 0;
      for (const e of v.errors) {
        if (e.id === 'noHero') continue;
        ctx.strokeStyle = blink ? '#ff4d5e' : '#f4f4f4';
        ctx.lineWidth = Math.max(2, ppm / 4);
        ctx.strokeRect(this.S(e.x) - 1.6 * ppm, this.S(e.z) - 1.6 * ppm, 3.2 * ppm, 3.2 * ppm);
      }
      for (const w of v.warnings) {
        if (w.id === 'noBoss') continue;
        ctx.strokeStyle = '#ffcd75';
        ctx.lineWidth = Math.max(1, ppm / 6);
        ctx.strokeRect(this.S(w.x) - 1.2 * ppm, this.S(w.z) - 1.2 * ppm, 2.4 * ppm, 2.4 * ppm);
      }
    }
    if (cursor) {
      if (cursor.piece && !cursor.erase) drawPiece(ctx, { k: cursor.piece, x: cursor.x, z: cursor.z, r: cursor.r }, biome, ppm, this.S, 0.6);
      const f = cursor.piece && !cursor.erase ? footprint(cursor.piece, cursor.r) : { w: 1, d: 1 };
      const cw = Math.max(1, f.w) * ppm;
      const ch = Math.max(1, f.d) * ppm;
      ctx.strokeStyle = cursor.erase ? '#ff4d5e' : cursor.ok ? '#a7f070' : '#ff4d5e';
      ctx.lineWidth = Math.max(2, Math.round(ppm / 5));
      ctx.strokeRect(Math.round(this.S(cursor.x) - cw / 2), Math.round(this.S(cursor.z) - ch / 2), Math.round(cw), Math.round(ch));
      if (cursor.erase) {
        ctx.beginPath();
        ctx.moveTo(this.S(cursor.x) - cw / 2, this.S(cursor.z) - ch / 2);
        ctx.lineTo(this.S(cursor.x) + cw / 2, this.S(cursor.z) + ch / 2);
        ctx.moveTo(this.S(cursor.x) + cw / 2, this.S(cursor.z) - ch / 2);
        ctx.lineTo(this.S(cursor.x) - cw / 2, this.S(cursor.z) + ch / 2);
        ctx.stroke();
      }
    }
  }
}

/** A small palette icon for a piece, drawn with the same renderer. */
export function pieceIcon(k: PieceId, biomeKey: string, size = 40): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.className = 'ae-icon';
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.imageSmoothingEnabled = false;
  const biome = biomeByKey(biomeKey);
  const f = footprint(k, 0);
  const span = PIECE_BY_ID[k].round ? 6.5 : k === 'belt' ? 10.5 : k === 'pad' ? 3.6 : Math.max(2.4, f.w + 1, f.d + 1);
  const ppm = size / span;
  const S = (v: number) => size / 2 + v * ppm;
  ctx.fillStyle = '#333c57';
  ctx.fillRect(0, 0, size, size);
  const p: ArenaPiece = { k, x: 0, z: 0, r: PIECE_BY_ID[k].round ? 1 : 0 };
  drawPiece(ctx, p, biome, ppm, S, 1); // a pad's landing ring falls off the icon
  return c;
}
