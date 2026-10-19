import { paintBiome3Portrait } from './biome3Portraits';
/**
 * Painted pixel portraits, generated on the fly (no image files): each hero
 * (in any skin and co-op armour colour), each boss model and the announcer,
 * in six expressions. A 32x32 bust is built from simple shapes on a pixel
 * grid: round parts get sphere shading lit from the top left (three tones
 * with a checker dither at the band edges, shadows hue-shifted toward navy,
 * lights toward warm white), flat parts a light/dark rim, and the silhouette
 * an ink outline, like the item icons. `paintPortrait` is pure (RGBA bytes,
 * testable in Node); `portraitCanvas` caches a canvas per look and face.
 */
import type { SkinDef } from '../data/skins';

export type Expression = 'neutral' | 'determined' | 'hurt' | 'grinning' | 'shocked' | 'victorious';
export const EXPRESSIONS: readonly Expression[] = ['neutral', 'determined', 'hurt', 'grinning', 'shocked', 'victorious'];
/** Portrait grid size in pixels. */
export const PORTRAIT = 32;

export interface PortraitLook {
  kind: 'hero' | 'boss' | 'announcer';
  /** Hero id (rookie, bulwark, dash, ace) or boss model (king, rex, queen, omega, dj, jack, airship; anything else gets a generic blob). */
  model: string;
  /** Hero: armor, accent, suit, hair, gem, iris. Boss: body, accent. */
  colors: Readonly<Record<string, string>>;
}

export function heroLook(heroId: string, skin: Pick<SkinDef, 'armor' | 'accent' | 'suit' | 'hair' | 'gem' | 'iris'>, armor = skin.armor): PortraitLook {
  return { kind: 'hero', model: heroId, colors: { armor, accent: skin.accent, suit: skin.suit, hair: skin.hair, gem: skin.gem, iris: skin.iris } };
}

export function bossLook(def: { id: string; model?: string; bodyColor: string; accentColor: string }): PortraitLook {
  if (def.id === 'shadow_hero') return heroLook('rookie', { armor: '#5d275d', accent: '#73eff7', suit: '#1a1c2c', hair: '#94b0c2', gem: '#a7f070', iris: '#73eff7' });
  return { kind: 'boss', model: def.model ?? def.id, colors: { body: def.bodyColor, accent: def.accentColor } };
}

export const ANNOUNCER_LOOK: PortraitLook = { kind: 'announcer', model: 'mc', colors: {} };

export function lookKey(l: PortraitLook): string {
  return `${l.kind}:${l.model}:${Object.values(l.colors).join(',')}`;
}

// ---------------------------------------------------------------- colour

const INK = 0x1a1c2c;
const WHITE = 0xf4f4f4;
const SKIN = 0xffd7b0;
/** Warm skin ramp: shading skin toward navy reads as dirt. */
const SKIN_TONES: [number, number, number, number] = [0xd9876f, 0xf2b08c, SKIN, 0xfff0dc];
const MOUTH = 0xb13e53;
const SWEAT = 0x73eff7;
const BLUSH = 0xff7eb6;
const GOLD = 0xffcd75;

const hexInt = (h: string): number => parseInt(h.slice(1, 7), 16) || 0;
const r8 = (c: number) => (c >> 16) & 255;
const g8 = (c: number) => (c >> 8) & 255;
const b8 = (c: number) => c & 255;
function mix(a: number, b: number, t: number): number {
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return (m(r8(a), r8(b)) << 16) | (m(g8(a), g8(b)) << 8) | m(b8(a), b8(b));
}
/** Deep shade, shade, base, light: shadows lean navy, lights lean warm white. */
function ramp(base: number): [number, number, number, number] {
  return [mix(base, 0x1a1c2c, 0.55), mix(base, 0x29366f, 0.38), base, mix(base, 0xfff6d0, 0.42)];
}

// ---------------------------------------------------------------- painter

type Inside = (x: number, y: number) => boolean;
type Shade = 'sphere' | 'rim' | 'flat';
interface Opts {
  shade?: Shade;
  /** Ink border on the shape's own edge pixels. */
  ink?: boolean;
  /** Only paint where this is true (pixel coords). */
  clip?: (x: number, y: number) => boolean;
  /** Sphere shading centre and radii (defaults to the shape's). */
  sphere?: [number, number, number, number];
  /** Custom tones (deep, shade, base, light) instead of the hue-shifted ramp. */
  tones?: [number, number, number, number];
}

const N = PORTRAIT;
const LIGHT = [-0.55, -0.62, 0.56];

class Painter {
  readonly px = new Int32Array(N * N).fill(-1);

  shape(inside: Inside, color: number, o: Opts = {}, bounds?: [number, number, number, number]): void {
    const [x0, y0, x1, y1] = bounds ?? [0, 0, N - 1, N - 1];
    const tones = o.tones ?? ramp(color);
    const shade = o.shade ?? 'rim';
    const sp = o.sphere;
    for (let y = Math.max(0, y0); y <= Math.min(N - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(N - 1, x1); x++) {
        if (!inside(x + 0.5, y + 0.5) || (o.clip && !o.clip(x, y))) continue;
        let c = color;
        const edge = !inside(x - 0.5, y + 0.5) || !inside(x + 1.5, y + 0.5) || !inside(x + 0.5, y - 0.5) || !inside(x + 0.5, y + 1.5);
        if (o.ink && edge) c = INK;
        else if (shade === 'sphere' && sp) {
          const nx = (x + 0.5 - sp[0]) / sp[2];
          const ny = (y + 0.5 - sp[1]) / sp[3];
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          const i = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] + ((x + y) & 1 ? 0.07 : -0.07);
          c = i > 0.66 ? tones[3] : i > 0.08 ? tones[2] : i > -0.32 ? tones[1] : tones[0];
        } else if (shade === 'rim') {
          if (!inside(x + 0.5, y - 0.5) || !inside(x - 0.5, y + 0.5)) c = tones[3];
          else if (!inside(x + 0.5, y + 1.5) || !inside(x + 1.5, y + 0.5)) c = tones[1];
        }
        this.px[y * N + x] = c;
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, color: number, o: Opts = {}): void {
    const inside: Inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    this.shape(inside, color, { shade: 'sphere', sphere: [cx, cy, rx, ry], ...o }, [Math.floor(cx - rx), Math.floor(cy - ry), Math.ceil(cx + rx), Math.ceil(cy + ry)]);
  }

  /** Inclusive pixel rectangle. */
  rect(x0: number, y0: number, x1: number, y1: number, color: number, o: Opts = {}): void {
    const inside: Inside = (x, y) => x >= x0 && x <= x1 + 1 && y >= y0 && y <= y1 + 1;
    this.shape(inside, color, o, [x0, y0, x1, y1]);
  }

  /** Filled polygon (pixel-corner coordinates, even-odd). */
  poly(pts: number[], color: number, o: Opts = {}): void {
    const inside: Inside = (x, y) => {
      let c = false;
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    this.shape(inside, color, o);
  }

  dot(x: number, y: number, color: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < N && y < N) this.px[y * N + x] = color;
  }

  /** Several pixels: [x, y, x, y, ...]. */
  dots(xy: number[], color: number): void {
    for (let i = 0; i < xy.length; i += 2) this.dot(xy[i], xy[i + 1], color);
  }

  /** Mirror a list of pixels around the portrait's centre line too. */
  pair(xy: number[], color: number): void {
    for (let i = 0; i < xy.length; i += 2) {
      this.dot(xy[i], xy[i + 1], color);
      this.dot(N - 1 - xy[i], xy[i + 1], color);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.dot(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), color);
  }

  /** Ink outline around the whole silhouette, then RGBA bytes. */
  finish(): Uint8ClampedArray {
    const src = this.px;
    const out = new Uint8ClampedArray(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let c = src[y * N + x];
        if (c < 0) {
          const near = (dx: number, dy: number) => {
            const ax = x + dx;
            const ay = y + dy;
            return ax >= 0 && ay >= 0 && ax < N && ay < N && src[ay * N + ax] >= 0 && src[ay * N + ax] !== INK;
          };
          if (near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1)) c = INK;
        }
        if (c < 0) continue;
        const i = (y * N + x) * 4;
        out[i] = r8(c);
        out[i + 1] = g8(c);
        out[i + 2] = b8(c);
        out[i + 3] = 255;
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- shared face bits

/** A small 4-point sparkle. */
function sparkle(p: Painter, x: number, y: number, c = WHITE): void {
  p.dots([x, y - 1, x - 1, y, x, y, x + 1, y, x, y + 1], c);
  p.dot(x, y, GOLD);
}

function sweat(p: Painter, x: number, y: number): void {
  p.dots([x, y, x, y + 1, x - 1, y + 2, x, y + 2, x + 1, y + 2, x, y + 3], SWEAT);
  p.dot(x, y + 2, WHITE);
}

/**
 * A pair of anime eyes. `lx` is the left eye's left column, `rx` the right
 * eye's; eyes are 4 wide, lid row at `y`, 5 rows tall.
 */
function eyes(p: Painter, lx: number, rx: number, y: number, iris: number, expr: Expression, blink: boolean, brow: number): void {
  const irisDark = mix(iris, 0x1a1c2c, 0.5);
  for (const [x0, side] of [[lx, -1], [rx, 1]] as const) {
    const inner = side < 0 ? x0 + 3 : x0; // column nearest the nose
    const outer = side < 0 ? x0 : x0 + 3;
    if (blink || expr === 'victorious') {
      if (blink) {
        p.line(x0, y + 3, x0 + 3, y + 3, INK);
        p.dot(outer - side, y + 2, INK);
      } else {
        // Happy closed eyes: ^ ^
        p.dots([x0, y + 3, x0 + 1, y + 2, x0 + 2, y + 2, x0 + 3, y + 3], INK);
        p.dots([x0, y + 4, x0 + 3, y + 4], INK);
      }
    } else if (expr === 'hurt') {
      // Squeezed shut: > <
      const a = side < 0 ? x0 : x0 + 3;
      const d = side < 0 ? 1 : -1;
      p.dots([a, y + 1, a + d, y + 2, a + 2 * d, y + 3, a + d, y + 4, a, y + 5], INK);
      p.dots([a + d, y + 1, a + 2 * d, y + 2, a + 3 * d, y + 3, a + 2 * d, y + 4, a + d, y + 5], INK);
    } else {
      const wide = expr === 'shocked';
      // Sclera
      p.rect(x0, y + 1, x0 + 3, y + 4, WHITE, { shade: 'flat' });
      if (wide) p.rect(x0, y, x0 + 3, y, WHITE, { shade: 'flat' });
      // Lids
      p.line(x0, wide ? y - 1 : y, x0 + 3, wide ? y - 1 : y, INK);
      p.dot(outer + side, wide ? y - 1 : y, INK); // lash
      if (!wide) p.dot(outer, y + 1, INK);
      if (wide) {
        // Tiny pupils, white all round.
        p.dots([inner - side, y + 2, inner - side, y + 3], INK);
      } else {
        const ix = side < 0 ? x0 + 1 : x0 + 1;
        p.rect(ix, y + 1, ix + 1, y + 4, iris, { shade: 'flat' });
        p.rect(ix, y + 2, ix + 1, y + 3, irisDark, { shade: 'flat' });
        p.dot(ix, y + 1, WHITE); // catch-light
        p.dot(ix + 1, y + 4, mix(iris, 0xffffff, 0.4));
      }
      p.line(x0, y + 5, x0 + 3, y + 5, wide ? INK : mix(INK, 0xffd7b0, 0.35));
      if (expr === 'determined') p.dot(inner, y + 1, INK); // the lid dips at the inner corner: a hard stare
      if (expr === 'grinning') {
        // Cheeks push the lower lid up.
        p.line(x0, y + 4, x0 + 3, y + 4, INK);
        p.dot(inner, y + 3, INK);
        p.dot(outer, y + 3, INK);
      }
    }
    // Brows
    const by = y - 2;
    if (expr === 'determined') {
      // Thick brows slanting down to the nose.
      p.dots([outer, by, outer - side, by, inner + side, by + 1, inner, by + 1, inner, by + 2], brow);
      p.dots([outer - side, by + 1, inner + side, by + 2], brow);
    }
    else if (expr === 'hurt' || expr === 'shocked') p.dots([outer, by + (expr === 'shocked' ? -1 : 1), outer - side, by, inner + side, by - 1 + (expr === 'shocked' ? 0 : 0), inner, by - 1], brow);
    else if (expr === 'grinning' || expr === 'victorious') p.dots([outer, by, outer - side, by - 1, inner + side, by - 1, inner, by], brow);
    else p.dots([outer, by + 1, outer - side, by, inner + side, by, inner, by], brow);
  }
}

/** Mouths centred on the line between columns 15 and 16. */
function mouth(p: Painter, y: number, expr: Expression, cx = 16): void {
  const L = cx - 1;
  const R = cx;
  switch (expr) {
    case 'neutral':
      p.dots([L - 2, y, L - 1, y + 1, L, y + 1, R, y + 1, R + 1, y + 1, R + 2, y], INK);
      break;
    case 'determined':
      // Confident smirk: one corner up.
      p.line(L - 2, y + 1, R + 1, y + 1, INK);
      p.dot(R + 2, y, INK);
      break;
    case 'hurt':
      p.rect(L - 2, y, R + 2, y + 2, MOUTH, { ink: true, shade: 'flat' });
      p.line(L - 1, y + 1, R + 1, y + 1, WHITE);
      p.dots([L - 1, y + 1, R, y + 1], INK);
      break;
    case 'grinning':
      p.rect(L - 3, y - 1, R + 3, y + 2, WHITE, { ink: true, shade: 'flat' });
      p.dots([L, y, L, y + 1, R, y, R, y + 1, L - 2, y, R + 2, y], mix(WHITE, INK, 0.25));
      p.dots([L - 4, y - 2, R + 4, y - 2], INK);
      break;
    case 'shocked':
      p.ellipse(cx, y + 1.5, 1.6, 2.2, MOUTH, { ink: true, shade: 'flat' });
      break;
    case 'victorious':
      p.poly([L - 3, y - 1, R + 4, y - 1, R + 2, y + 3, L - 1, y + 3], MOUTH, { ink: true, shade: 'flat' });
      p.line(L - 2, y, R + 2, y, WHITE);
      p.dots([L, y + 2, R, y + 2], 0xff7eb6);
      break;
  }
}

// ---------------------------------------------------------------- heroes

function paintHero(p: Painter, look: PortraitLook, expr: Expression, blink: boolean): void {
  const c = look.colors;
  const armor = hexInt(c.armor);
  const accent = hexInt(c.accent);
  const suit = hexInt(c.suit);
  const hair = hexInt(c.hair);
  const gem = hexInt(c.gem);
  const iris = hexInt(c.iris);
  const id = look.model;
  const wide = id === 'bulwark' ? 1 : id === 'dash' ? -0.5 : 0;
  const hurt = expr === 'hurt' ? 1 : 0; // flinch: the head dips a pixel

  // Shoulders and collar
  p.ellipse(16, 34, 14 + wide, 7.5, suit);
  p.ellipse(5 - wide, 29.5, 6 + wide, 4.6, armor);
  p.ellipse(27 + wide, 29.5, 6 + wide, 4.6, armor);
  p.rect(13, 23, 18, 27, SKIN_TONES[1], { shade: 'flat' });
  p.ellipse(16, 28.5, 6, 2.6, accent, { ink: true });

  // Dash: hair spikes out the back.
  if (id === 'dash') {
    p.poly([5, 18, 1, 25, 8, 22], hair);
    p.poly([27, 18, 31, 25, 24, 22], hair);
  }

  // Face
  const fy = 17 + hurt;
  const face: Opts = { sphere: [14.5, fy - 3, 13, 13], tones: SKIN_TONES };
  p.ellipse(16, fy, 8.2 + wide * 0.8, 8.4, SKIN, face);
  p.ellipse(16, fy + 3, 7 + wide * 0.6, 5.6, SKIN, face);

  // Helmet: dome, side guards with round ear covers, front brim.
  const hy = 12.5 + hurt;
  p.ellipse(16, hy, 10.6 + wide, 10, armor, { clip: (_x, y) => y <= 12 + hurt });
  p.rect(5 - wide, 11 + hurt, 9, 19 + hurt, armor, { clip: (x, y) => x <= 8 || y <= 12 + hurt });
  p.rect(22, 11 + hurt, 26 + wide, 19 + hurt, armor, { clip: (x, y) => x >= 23 || y <= 12 + hurt });
  p.ellipse(6.5 - wide, 17 + hurt, 3.4, 3.8, armor);
  p.ellipse(25.5 + wide, 17 + hurt, 3.4, 3.8, armor);
  p.ellipse(6.5 - wide, 17 + hurt, 1.6, 1.8, accent, { shade: 'flat' });
  p.ellipse(25.5 + wide, 17 + hurt, 1.6, 1.8, accent, { shade: 'flat' });
  // Accent ridge and the forehead gem.
  p.rect(14, 2 + hurt, 17, 7 + hurt, accent, { clip: (x, y) => ((x - 15.5) / 10.6) ** 2 + ((y + 0.5 - hy) / 10) ** 2 <= 0.92 });
  p.rect(14, 8 + hurt, 17, 10 + hurt, gem, { ink: true, shade: 'flat' });
  p.dot(15, 9 + hurt, mix(gem, 0xffffff, 0.6));
  p.dot(16, 9 + hurt, gem);
  // Brim line
  p.line(8, 12 + hurt, 23, 12 + hurt, mix(armor, 0x1a1c2c, 0.45));

  if (id === 'dash') {
    // Wing fins sweeping back off the ear covers.
    p.poly([3, 15, 0, 6, 7, 12], accent, { ink: true });
    p.poly([29, 15, 32, 6, 25, 12], accent, { ink: true });
  }
  if (id === 'ace') {
    // Antenna with a gem tip.
    p.line(22, 6 + hurt, 25, 1 + hurt, INK);
    p.line(23, 6 + hurt, 26, 1 + hurt, accent);
    p.rect(25, 0 + hurt, 27, 2 + hurt, gem, { ink: false, shade: 'flat' });
    p.dot(25, hurt, WHITE);
  }
  if (id === 'bulwark') {
    // Cheek guards and a heavier brow plate.
    p.rect(6, 19 + hurt, 9, 24 + hurt, armor, { clip: (x, y) => y - (19 + hurt) <= x - 5 });
    p.rect(22, 19 + hurt, 25, 24 + hurt, armor, { clip: (x, y) => y - (19 + hurt) <= 26 - x });
    p.line(9, 11 + hurt, 22, 11 + hurt, mix(armor, 0xfff6d0, 0.3));
  }

  if (id === 'tinker') {
    // Big goggles pushed up on the helmet: a dark strap, gold rims, cyan lenses.
    p.line(5, 9 + hurt, 26, 9 + hurt, 0x333c57);
    for (const gx of [11.5, 20.5]) {
      p.ellipse(gx, 8.5 + hurt, 3, 2.8, 0xffcd75, { ink: true });
      p.ellipse(gx, 8.5 + hurt, 1.7, 1.6, 0x73eff7, { shade: 'flat' });
      p.dot(gx - 1, 7.5 + hurt, WHITE);
    }
  }

  // Fringe under the brim.
  const hy2 = 13 + hurt;
  p.rect(9, hy2, 22, hy2, hair, { shade: 'flat' });
  p.dots([9, hy2 + 1, 10, hy2 + 1, 12, hy2 + 1, 13, hy2 + 2, 15, hy2 + 1, 18, hy2 + 1, 19, hy2 + 2, 21, hy2 + 1, 22, hy2 + 1], hair);
  p.dots([11, hy2, 16, hy2, 20, hy2], mix(hair, 0xfff6d0, 0.35));

  // Face
  const ey = 15 + hurt;
  eyes(p, 10, 18, ey, iris, expr, blink, mix(hair, 0x1a1c2c, 0.3));
  if (id === 'ace') {
    // Targeting monocle over the right eye.
    p.rect(17, ey - 1, 22, ey + 6, gem, { clip: (x, y) => x === 17 || x === 22 || y === ey - 1 || y === ey + 6 });
    p.dots([22, ey + 2, 23, ey + 2, 23, ey + 3], INK);
    p.dot(21, ey, WHITE);
  }
  // Nose hint
  p.dot(16, 21 + hurt, mix(SKIN, 0xb13e53, 0.35));
  mouth(p, 22 + hurt, expr);
  if (expr === 'grinning' || expr === 'victorious') p.dots([9, 21 + hurt, 10, 21 + hurt, 21, 21 + hurt, 22, 21 + hurt], BLUSH);
  if (expr === 'hurt') sweat(p, 24, 9);
  if (expr === 'shocked') {
    sweat(p, 24, 10);
    sweat(p, 7, 11);
    p.dots([11, 14, 13, 14, 18, 14, 20, 14], mix(SKIN, 0x3b5dc9, 0.55)); // gloom lines
  }
  if (expr === 'victorious') sparkle(p, 28, 4);
  if (id === 'ronin') {
    // A wide straw kasa over the helmet, with a red band, and a headband tail flying out.
    const STRAW = 0xd9a95b;
    p.poly([0, 10 + hurt, 16, -1 + hurt, 32, 10 + hurt, 28, 11 + hurt, 4, 11 + hurt], STRAW, { ink: true });
    p.line(3, 10 + hurt, 28, 10 + hurt, mix(STRAW, 0x1a1c2c, 0.35));
    p.line(9, 7 + hurt, 22, 7 + hurt, 0xb13e53);
    p.line(8, 8 + hurt, 23, 8 + hurt, mix(0xb13e53, 0x1a1c2c, 0.3));
    p.dots([13, 3 + hurt, 15, 2 + hurt, 18, 4 + hurt, 11, 5 + hurt], mix(STRAW, 0xfff6d0, 0.4));
    p.poly([26, 16 + hurt, 31, 19 + hurt, 30, 21 + hurt, 25, 18 + hurt], 0xb13e53, { ink: true });
  }
}

// ---------------------------------------------------------------- bosses

/** One big cyclops eye (King, Queen, generic). */
function bigEye(p: Painter, cx: number, cy: number, r: number, body: number, expr: Expression): void {
  const lid = mix(body, 0x1a1c2c, 0.25);
  if (expr === 'victorious') {
    p.dots([cx - 4, cy + 1, cx - 3, cy, cx - 2, cy - 1, cx - 1, cy - 1, cx, cy - 1, cx + 1, cy, cx + 2, cy + 1], INK);
    p.dots([cx - 4, cy + 2, cx + 2, cy + 2], INK);
    return;
  }
  if (expr === 'hurt') {
    p.dots([cx - 4, cy - 2, cx - 3, cy - 1, cx - 2, cy, cx - 1, cy, cx, cy, cx + 1, cy - 1, cx + 2, cy - 2], INK);
    p.dots([cx - 3, cy + 1, cx - 2, cy + 1, cx, cy + 1, cx + 1, cy + 1], INK);
    p.dots([cx - 5, cy + 3, cx + 3, cy + 3, cx - 5, cy + 4], SWEAT); // tears
    return;
  }
  const big = expr === 'shocked' ? 1.25 : 1;
  p.ellipse(cx - 0.5, cy, r * big, r * big * 1.05, WHITE, { ink: true, shade: 'flat' });
  if (expr === 'shocked') p.rect(cx - 1, cy - 1, cx, cy, INK, { shade: 'flat' });
  else {
    const py = expr === 'grinning' ? cy + 1.5 : cy;
    p.ellipse(cx - 0.5, py + 0.5, r * (expr === 'grinning' ? 0.4 : 0.5), r * (expr === 'grinning' ? 0.4 : 0.55), INK, { shade: 'flat' });
    p.dot(cx - 2, py - 1, WHITE);
    p.dot(cx - 1, py - 2, WHITE);
  }
  if (expr === 'determined' || expr === 'grinning') {
    // A heavy lid: angry slant, or smug half-closed.
    const top = Math.floor(cy - r * 1.1);
    const k = expr === 'determined' ? 0.45 : 0;
    const cut = (x: number) => Math.floor(cy - (expr === 'grinning' ? 2 : r * 0.35) + Math.abs(x + 0.5 - cx) * -k);
    p.rect(Math.floor(cx - r - 1), top, Math.ceil(cx + r), cy, lid, { shade: 'flat', clip: (x, y) => y <= cut(x) && ((x + 0.5 - cx + 0.5) / (r + 1)) ** 2 + ((y + 0.5 - cy) / (r * 1.15 + 1)) ** 2 <= 1 });
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r) - 1; x++) {
      const y = cut(x) + 1;
      if (((x + 0.5 - cx + 0.5) / (r + 1)) ** 2 + ((y + 0.5 - cy) / (r * 1.15 + 1)) ** 2 <= 1) p.dot(x, y, INK);
    }
  }
}

function paintKing(p: Painter, body: number, accent: number, expr: Expression): void {
  const gold = 0xffd23f;
  const hurt = expr === 'hurt' ? 1 : 0;
  p.ellipse(16, 21, 13.6, 12, body);
  p.rect(2, 25, 29, 27, accent, { clip: (x, y) => ((x + 0.5 - 16) / 13.6) ** 2 + ((y + 0.5 - 21) / 12) ** 2 <= 1 });
  // Crown (tilted when hurt)
  const t = hurt;
  p.rect(9 + t, 5 + t, 22 + t, 9, gold, { ink: false });
  for (const sx of [9, 13, 18, 22]) p.poly([sx - 1 + t, 6 + t, sx + 0.5 + t, 0 + t + (sx === 13 || sx === 18 ? 1 : 2), sx + 2 + t, 6 + t], gold);
  p.dots([11 + t, 7 + t, 15 + t, 7 + t, 16 + t, 7 + t, 20 + t, 7 + t], 0xff3df0);
  p.line(9 + t, 9, 22 + t, 9, mix(gold, 0x1a1c2c, 0.4));
  bigEye(p, 16, 15, 4.3, body, expr);
  mouth(p, 21, expr);
  if (expr === 'shocked') sweat(p, 26, 10);
  if (expr === 'victorious') sparkle(p, 27, 4);
}

function paintRex(p: Painter, body: number, accent: number, expr: Expression): void {
  const snout = 0xf4f4f4;
  const hurt = expr === 'hurt' ? 1 : 0;
  // Back spikes
  for (const [a, b, tip] of [[3, 10, 3], [10, 17, 0], [15, 22, 0], [22, 29, 3]]) p.poly([a, 11, (a + b) / 2, tip, b, 11], accent);
  p.ellipse(16, 16 + hurt, 13.2, 10.5, body);
  p.rect(4, 16 + hurt, 27, 27, body, { clip: (x, y) => y >= 17 + hurt && Math.abs(x + 0.5 - 16) <= 12.5 - (y - 17) * 0.25 });
  // Snout
  p.rect(9, 20 + hurt, 22, 29, snout, { clip: (x, y) => Math.abs(x + 0.5 - 16) <= 7 - Math.max(0, y - 26) });
  p.dots([12, 24 + hurt, 19, 24 + hurt], INK);
  // Horns
  p.poly([12, 21 + hurt, 16, 7 + hurt, 20, 21 + hurt], accent, { sphere: [14, 12, 6, 10], shade: 'sphere' });
  p.poly([14, 12 + hurt, 16, 6 + hurt, 18, 12 + hurt], mix(accent, 0xfff6d0, 0.3));
  // Eyes
  for (const [x, side] of [[8, -1], [23, 1]] as const) {
    const y = 14 + hurt;
    if (expr === 'victorious') p.dots([x - 2, y + 1, x - 1, y, x, y, x + 1, y + 1], INK);
    else if (expr === 'hurt') p.dots([x - 2, y - 1, x - 1, y, x, y + 1, x - 1, y + 2, x - 2, y + 3].map((v, i) => (i % 2 === 0 && side > 0 ? 2 * x - 1 - v : v)), INK);
    else {
      const r = expr === 'shocked' ? 2.9 : 2.3;
      p.ellipse(x - 0.5 + 0.5, y + 1, r, r, WHITE, { ink: true, shade: 'flat' });
      if (expr === 'shocked') p.dot(x, y + 1, INK);
      else p.rect(x - (side < 0 ? 0 : 1), y, x - (side < 0 ? 0 : 1) + 1, y + 2, INK, { shade: 'flat' });
    }
    // Brow ridge
    const brow = mix(body, 0x1a1c2c, 0.5);
    if (expr === 'determined' || expr === 'grinning') p.line(x - 3 * -side - side, y - 3, x + 2 * -side, y - 1, brow);
    else if (expr === 'shocked') p.line(x - 3, y - 3, x + 2, y - 3, brow);
    else p.line(x - 2, y - 2, x + 1, y - 2, brow);
  }
  // Jaw
  const jy = 27 + hurt;
  if (expr === 'grinning' || expr === 'victorious' || expr === 'shocked' || expr === 'hurt') {
    p.rect(10, jy - 1, 21, jy + 2, MOUTH, { ink: true, shade: 'flat', clip: (x, y) => expr !== 'shocked' || Math.abs(x + 0.5 - 16) < 3.5 || y === jy - 1 });
    if (expr !== 'shocked') for (let x = 11; x <= 20; x += 2) p.dot(x, jy, WHITE);
  } else {
    p.line(9, jy, 22, jy, INK);
    for (let x = 11; x <= 20; x += 3) p.dot(x, jy + 1, WHITE);
  }
  if (expr === 'shocked') sweat(p, 28, 9);
  if (expr === 'victorious') sparkle(p, 28, 13);
}

function paintQueen(p: Painter, body: number, accent: number, expr: Expression): void {
  const wing = 0xc8f4ff;
  const hurt = expr === 'hurt' ? 1 : 0;
  p.ellipse(5.5, 12, 5.5, 9, wing, { shade: 'flat', ink: true });
  p.ellipse(26.5, 12, 5.5, 9, wing, { shade: 'flat', ink: true });
  p.line(4, 6, 8, 16, mix(wing, 0x41a6f6, 0.6));
  p.line(28, 6, 24, 16, mix(wing, 0x41a6f6, 0.6));
  // Striped thorax
  p.ellipse(16, 32, 9.5, 6.5, body);
  for (const sy of [28, 31]) p.rect(6, sy, 25, sy + 1, mix(body, 0x1a1c2c, 0.7), { shade: 'flat', clip: (x, y) => ((x + 0.5 - 16) / 9.5) ** 2 + ((y + 0.5 - 32) / 6.5) ** 2 <= 1 });
  // Antennae
  p.line(12, 7, 8, 1, INK);
  p.line(20, 7, 24, 1, INK);
  p.rect(7, 0, 8, 1, accent, { shade: 'flat' });
  p.rect(23, 0, 24, 1, accent, { shade: 'flat' });
  // Head
  p.ellipse(16, 17 + hurt, 10, 9.6, body);
  p.rect(8, 23 + hurt, 23, 24 + hurt, mix(body, 0x5d275d, 0.55), { clip: (x, y) => ((x + 0.5 - 16) / 10) ** 2 + ((y + 0.5 - 17 - hurt) / 9.6) ** 2 <= 1 });
  // Crown
  p.rect(11, 6 + hurt, 20, 8 + hurt, accent);
  for (const sx of [11, 14, 17, 20]) p.poly([sx, 7 + hurt, sx + 0.5, 3 + hurt, sx + 1, 7 + hurt], accent);
  p.dots([13, 7 + hurt, 18, 7 + hurt], WHITE);
  bigEye(p, 16, 15 + hurt, 4.7, body, expr);
  // Mandibles + mouth
  if (expr === 'neutral' || expr === 'determined') {
    p.dots([13, 21 + hurt, 14, 22 + hurt, 18, 21 + hurt, 17, 22 + hurt], INK);
  } else mouth(p, 21 + hurt, expr);
  if (expr === 'shocked') sweat(p, 25, 13);
  if (expr === 'victorious') sparkle(p, 27, 22);
}

function paintOmega(p: Painter, body: number, accent: number, expr: Expression): void {
  const glow = 0x73eff7;
  const visor = 0xff3d5a;
  const hurt = expr === 'hurt' ? 1 : 0;
  // Pauldrons and chest
  p.poly([1, 24, 3, 17, 6, 24], WHITE);
  p.poly([31, 24, 29, 17, 26, 24], WHITE);
  p.ellipse(4, 28, 6, 5, accent);
  p.ellipse(28, 28, 6, 5, accent);
  p.rect(7, 25, 24, 31, body);
  p.rect(7, 25, 24, 25, accent, { shade: 'flat' });
  p.poly([13, 29, 16, 26, 19, 29, 16, 32], glow, { ink: true });
  p.dot(15, 28, WHITE);
  // Crown fan
  for (let k = -2; k <= 2; k++) {
    const x = 16 + k * 4;
    const tip = 1 + Math.abs(k) * 1.5;
    p.poly([x - 1.5, 9, x + k * 0.8, tip, x + 1.5, 9], accent);
  }
  // Head with chamfered corners
  const y0 = 8 + hurt;
  p.poly([10, y0, 22, y0, 25, y0 + 3, 25, y0 + 14, 22, y0 + 17, 10, y0 + 17, 7, y0 + 14, 7, y0 + 3], body);
  p.line(10, y0 + 1, 22, y0 + 1, mix(body, 0xfff6d0, 0.4));
  // Visor (the face)
  const vy = 13 + hurt;
  const angry = expr === 'determined' || expr === 'grinning';
  if (expr === 'shocked') {
    p.ellipse(12, vy + 1.5, 2.6, 2.6, visor, { ink: true, shade: 'flat' });
    p.ellipse(20, vy + 1.5, 2.6, 2.6, visor, { ink: true, shade: 'flat' });
    p.dots([12, vy + 1, 20, vy + 1], WHITE);
  } else {
    p.poly(angry ? [8, vy - 1, 16, vy + 2, 24, vy - 1, 24, vy + 3, 16, vy + 5, 8, vy + 3] : [8, vy, 24, vy, 24, vy + 3, 8, vy + 3], INK);
    p.poly(angry ? [9, vy, 16, vy + 3, 23, vy, 23, vy + 2, 16, vy + 4, 9, vy + 2] : [9, vy + 1, 23, vy + 1, 23, vy + 2, 9, vy + 2], visor, { shade: 'flat' });
    if (expr === 'victorious') p.dots([10, vy + 2, 11, vy + 1, 12, vy + 2, 19, vy + 2, 20, vy + 1, 21, vy + 2], WHITE);
    else if (expr === 'hurt') p.dots([10, vy + 1, 12, vy + 2, 14, vy + 1, 18, vy + 2, 20, vy + 1, 22, vy + 2], WHITE);
    else p.dots(angry ? [11, vy + 2, 12, vy + 2, 19, vy + 2, 20, vy + 2] : [11, vy + 1, 12, vy + 1, 19, vy + 1, 20, vy + 1], WHITE);
  }
  // Grille mouth
  const gy = 20 + hurt;
  const lit = expr === 'grinning' || expr === 'victorious';
  for (let x = 12; x <= 19; x++) {
    const curve = lit ? (x === 12 || x === 19 ? -1 : 0) : expr === 'shocked' && (x < 14 || x > 17) ? 9 : 0;
    if (curve > 5) continue;
    for (let y = gy + curve; y <= gy + 2 + (lit && x > 13 && x < 18 ? 1 : 0); y++) p.dot(x, y, x % 2 ? (lit ? glow : mix(body, 0x1a1c2c, 0.5)) : INK);
  }
  if (expr === 'hurt') p.dots([22, 10, 21, 11, 22, 12, 21, 13], WHITE); // crack
  if (expr === 'victorious') sparkle(p, 27, 9);
}

function paintBlob(p: Painter, body: number, accent: number, expr: Expression): void {
  p.ellipse(16, 20, 12.5, 11, body);
  p.rect(4, 24, 27, 25, accent, { clip: (x, y) => ((x + 0.5 - 16) / 12.5) ** 2 + ((y + 0.5 - 20) / 11) ** 2 <= 1 });
  p.line(16, 9, 16, 4, INK);
  p.ellipse(16, 3.5, 2, 2, accent);
  bigEye(p, 16, 15, 4.5, body, expr);
  mouth(p, 20, expr);
}

// ---------------------------------------------------------------- biome bosses (bosses3 lane)

const NEON_PINK = 0xff3df0;

/** Glitch DJ: square robot head, big headphones, a visor of pixel eyes, an equalizer for a mouth. */
function paintDj(p: Painter, body: number, accent: number, expr: Expression): void {
  const hurt = expr === 'hurt' ? 1 : 0;
  const band = mix(body, 0x1a1c2c, 0.55);
  // Shoulders, then the headphone band over the head.
  p.rect(3, 27, 28, 31, mix(body, 0x1a1c2c, 0.3));
  p.rect(13, 27, 18, 31, accent, { shade: 'flat' });
  p.rect(7, 2 + hurt, 24, 4 + hurt, band);
  p.rect(5, 4 + hurt, 7, 12 + hurt, band);
  p.rect(24, 4 + hurt, 26, 12 + hurt, band);
  // Antenna with a blinking tip.
  p.line(21, 5 + hurt, 23, 0 + hurt, INK);
  p.dot(23, 0 + hurt, accent);
  // Head.
  p.rect(8, 6 + hurt, 23, 26, body);
  p.line(9, 7 + hurt, 22, 7 + hurt, mix(body, 0xfff6d0, 0.4));
  // Ear cups.
  p.ellipse(5.5, 16 + hurt, 3.6, 5.2, NEON_PINK);
  p.ellipse(26.5, 16 + hurt, 3.6, 5.2, NEON_PINK);
  p.dots([5, 15 + hurt, 26, 15 + hurt], WHITE);
  // Visor.
  const vy = 11 + hurt;
  p.rect(10, vy, 21, vy + 6, INK, { shade: 'flat' });
  const E = accent;
  switch (expr) {
    case 'neutral':
      p.rect(12, vy + 2, 13, vy + 3, E, { shade: 'flat' });
      p.rect(18, vy + 2, 19, vy + 3, E, { shade: 'flat' });
      break;
    case 'determined':
      p.dots([11, vy + 2, 12, vy + 3, 13, vy + 3, 14, vy + 4, 20, vy + 2, 19, vy + 3, 18, vy + 3, 17, vy + 4], E);
      break;
    case 'hurt':
      p.dots([12, vy + 1, 14, vy + 1, 13, vy + 2, 12, vy + 3, 14, vy + 3, 17, vy + 1, 19, vy + 1, 18, vy + 2, 17, vy + 3, 19, vy + 3], E);
      break;
    case 'grinning':
    case 'victorious':
      p.dots([11, vy + 3, 12, vy + 2, 13, vy + 2, 14, vy + 3, 17, vy + 3, 18, vy + 2, 19, vy + 2, 20, vy + 3], E);
      break;
    case 'shocked':
      p.rect(11, vy + 1, 14, vy + 4, E, { shade: 'flat' });
      p.rect(17, vy + 1, 20, vy + 4, E, { shade: 'flat' });
      p.rect(12, vy + 2, 13, vy + 3, INK, { shade: 'flat' });
      p.rect(18, vy + 2, 19, vy + 3, INK, { shade: 'flat' });
      break;
  }
  // Glitch: a couple of stray pixels off the visor's edge.
  p.dots([22, vy + 1, 9, vy + 4, 21, vy + 5], NEON_PINK);
  // Equalizer mouth: bar heights follow the mood.
  const H: Record<Expression, number[]> = {
    neutral: [1, 2, 3, 2, 1],
    determined: [2, 1, 2, 1, 2],
    hurt: [0, 1, 0, 1, 0],
    grinning: [2, 3, 4, 3, 2],
    shocked: [4, 4, 4, 4, 4],
    victorious: [3, 4, 4, 4, 3],
  };
  const my = 24;
  p.rect(10, my - 5, 21, my, mix(body, 0x1a1c2c, 0.45), { shade: 'flat' });
  H[expr].forEach((h, i) => {
    const x = 11 + i * 2;
    if (h > 0) p.rect(x, my - h, x, my - 1, i === 2 ? NEON_PINK : accent, { shade: 'flat' });
  });
  if (expr === 'shocked') sweat(p, 28, 5);
  if (expr === 'victorious') sparkle(p, 28, 22);
}

/** Boxer Jack: clown face on a spring, striped hat, red nose, a frilled collar over the box. */
function paintJack(p: Painter, body: number, accent: number, expr: Expression): void {
  const hurt = expr === 'hurt' ? 1 : 0;
  const red = 0xff3d5a;
  // The box under the collar.
  p.rect(5, 28, 26, 31, body);
  p.rect(5, 28, 26, 28, accent, { shade: 'flat' });
  // Frilled collar.
  for (let k = 0; k < 6; k++) p.ellipse(6 + k * 4, 26.5, 2.6, 2.4, k % 2 ? accent : WHITE);
  // Face.
  p.ellipse(16, 16 + hurt, 9.6, 9.4, WHITE);
  // Hat: a striped cone, tilted when hurt, with a pom-pom.
  const t = hurt * 2;
  p.poly([8 + t, 9, 16 + t, -1, 24 + t, 9], NEON_PINK);
  p.poly([11 + t, 6, 16 + t, 2, 21 + t, 6, 20 + t, 7, 12 + t, 7], accent);
  p.rect(7 + t, 8, 25 + t, 9, accent, { shade: 'flat' });
  p.ellipse(16 + t, 0.5, 1.8, 1.6, accent);
  // Painted diamonds round the eyes.
  for (const cx of [12, 20]) p.poly([cx - 3, 15 + hurt, cx, 11 + hurt, cx + 3, 15 + hurt, cx, 19 + hurt], mix(body, WHITE, 0.25), { shade: 'flat' });
  eyes(p, 10, 18, 12 + hurt, 0x41a6f6, expr, false, INK);
  // Cheeks and the big red nose.
  p.dots([8, 20 + hurt, 9, 20 + hurt, 23, 20 + hurt, 22, 20 + hurt], 0xff7eb6);
  p.ellipse(16, 19 + hurt, 2.2, 2, red);
  p.dot(15, 18 + hurt, WHITE);
  mouth(p, 22 + hurt, expr);
  if (expr === 'shocked') sweat(p, 27, 8);
  if (expr === 'victorious') sparkle(p, 27, 4);
}

/** Admiral Gale: bicorne hat, grand white moustache, navy coat with gold epaulettes. */
function paintAdmiral(p: Painter, _body: number, accent: number, expr: Expression): void {
  const hurt = expr === 'hurt' ? 1 : 0;
  const navy = 0x29366f;
  // Coat and epaulettes.
  p.rect(5, 26, 26, 31, navy);
  p.line(16, 26, 16, 31, accent);
  p.dots([15, 28, 15, 30], accent);
  p.ellipse(5, 27, 4, 2.6, accent);
  p.ellipse(26, 27, 4, 2.6, accent);
  // Face.
  p.ellipse(16, 17 + hurt, 8.2, 8.8, SKIN, { tones: SKIN_TONES });
  // Bicorne hat with gold trim and a cockade.
  p.poly([1, 11 + hurt, 16, 1 + hurt, 31, 11 + hurt, 26, 13 + hurt, 6, 13 + hurt], INK);
  p.line(4, 11 + hurt, 27, 11 + hurt, accent);
  p.ellipse(16, 7 + hurt, 2, 2, 0xb13e53);
  p.dot(16, 7 + hurt, WHITE);
  eyes(p, 11, 17, 14 + hurt, 0x41a6f6, expr, false, WHITE);
  // Nose and the moustache curling out to both sides.
  p.dots([16, 19 + hurt, 15, 20 + hurt], mix(SKIN, MOUTH, 0.3));
  p.poly([7, 21 + hurt, 10, 20 + hurt, 15, 21 + hurt, 16, 22 + hurt, 17, 21 + hurt, 22, 20 + hurt, 25, 21 + hurt, 24, 23 + hurt, 20, 22.5 + hurt, 16, 23.5 + hurt, 12, 22.5 + hurt, 8, 23 + hurt], WHITE);
  p.dots([7, 20 + hurt, 25, 20 + hurt], WHITE);
  mouth(p, 24 + hurt, expr);
  if (expr === 'shocked') sweat(p, 26, 14);
  if (expr === 'victorious') sparkle(p, 28, 16);
}

// ---------------------------------------------------------------- announcer

function paintAnnouncer(p: Painter, expr: Expression, blink: boolean): void {
  const bezel = 0x94b0c2;
  const screen = 0x29366f;
  const face = 0x73eff7;
  const hurt = expr === 'hurt' ? 1 : 0;
  // Suit and bow tie
  p.ellipse(16, 34, 13, 7.5, 0x5d275d);
  p.poly([11, 26, 16, 28.5, 11, 31], 0xffcd75, { ink: true });
  p.poly([21, 26, 16, 28.5, 21, 31], 0xffcd75, { ink: true });
  p.rect(15, 27, 16, 29, 0xef7d57, { shade: 'flat' });
  // Antennae
  p.line(12, 6, 8, 1, 0x566c86);
  p.line(20, 6, 24, 1, 0x566c86);
  p.rect(7, 0, 8, 1, 0xb13e53, { shade: 'flat' });
  p.rect(23, 0, 24, 1, 0xb13e53, { shade: 'flat' });
  // TV head
  const y0 = 5 + hurt;
  p.rect(4, y0, 27, y0 + 19, bezel);
  p.rect(6, y0 + 2, 25, y0 + 15, screen, { shade: 'flat', ink: true });
  for (let y = y0 + 3; y < y0 + 15; y += 2) p.line(7, y, 24, y, mix(screen, 0x41a6f6, 0.18));
  p.dots([7, y0 + 3, 8, y0 + 3, 7, y0 + 4], mix(screen, 0xffffff, 0.45)); // glare
  // Knobs and speaker
  p.dots([8, y0 + 17, 9, y0 + 17, 11, y0 + 17, 12, y0 + 17], 0x566c86);
  p.rect(22, y0 + 17, 23, y0 + 18, 0xef7d57, { shade: 'flat' });
  // Headset: ear cup and mic boom
  p.ellipse(3.5, 14 + hurt, 2.6, 3.6, 0x333c57);
  p.line(4, 18 + hurt, 9, 23 + hurt, INK);
  p.rect(9, 22 + hurt, 11, 24 + hurt, 0x333c57, { shade: 'flat' });
  // Screen face
  const fy = y0 + 4;
  const hi = 0xf4f4f4;
  if (blink) {
    p.line(10, fy + 2, 12, fy + 2, face);
    p.line(19, fy + 2, 21, fy + 2, face);
  } else
    switch (expr) {
      case 'neutral':
      case 'grinning':
        p.rect(10, fy, 12, fy + 3, face, { shade: 'flat' });
        p.rect(19, fy, 21, fy + 3, face, { shade: 'flat' });
        p.dots([10, fy, 19, fy], hi);
        break;
      case 'determined':
        p.rect(10, fy + 1, 12, fy + 3, face, { shade: 'flat' });
        p.rect(19, fy + 1, 21, fy + 3, face, { shade: 'flat' });
        p.dots([9, fy - 1, 10, fy - 1, 11, fy, 12, fy, 22, fy - 1, 21, fy - 1, 20, fy, 19, fy], face);
        break;
      case 'hurt':
        for (const x of [10, 19]) p.dots([x, fy, x + 2, fy, x + 1, fy + 1, x, fy + 2, x + 2, fy + 2], face);
        break;
      case 'shocked':
        for (const x of [9, 19]) p.rect(x, fy - 1, x + 3, fy + 3, face, { shade: 'flat', clip: (xx, yy) => xx === x || xx === x + 3 || yy === fy - 1 || yy === fy + 3 });
        p.dots([10, fy + 1, 20, fy + 1], hi);
        break;
      case 'victorious':
        for (const x of [10, 19]) p.dots([x, fy + 2, x + 1, fy + 1, x + 2, fy + 2], face);
        break;
    }
  const my = fy + 6;
  switch (expr) {
    case 'neutral':
      p.dots([13, my, 14, my + 1, 15, my + 1, 16, my + 1, 17, my + 1, 18, my], face);
      break;
    case 'determined':
      p.line(13, my + 1, 18, my + 1, face);
      break;
    case 'hurt':
      p.dots([12, my + 1, 13, my, 14, my + 1, 15, my, 16, my + 1, 17, my, 18, my + 1, 19, my], face);
      break;
    case 'grinning':
    case 'victorious':
      p.rect(12, my - 1, 19, my + 1, face, { shade: 'flat', clip: (x, y) => y < my + 1 || (x > 12 && x < 19) });
      p.line(13, my - 1, 18, my - 1, hi);
      break;
    case 'shocked':
      p.rect(15, my - 1, 16, my + 1, face, { shade: 'flat' });
      break;
  }
  if (expr === 'victorious' || expr === 'grinning') {
    p.dot(24, y0 + 3, face);
    p.dot(7, y0 + 13, face);
  }
  if (expr === 'shocked') sweat(p, 29, 4);
  if (expr === 'victorious') sparkle(p, 29, 6);
}

// ---------------------------------------------------------------- entry points

/** RGBA pixels (PORTRAIT x PORTRAIT) for a look and expression. `blink` closes the eyes. */
export function paintPortrait(look: PortraitLook, expr: Expression, blink = false): Uint8ClampedArray {
  const p = new Painter();
  if (look.kind === 'hero') paintHero(p, look, expr, blink);
  else if (look.kind === 'announcer') paintAnnouncer(p, expr, blink);
  else {
    const body = hexInt(look.colors.body ?? '#ff5e8a');
    const accent = hexInt(look.colors.accent ?? '#ffd23f');
    if (paintBiome3Portrait(p, look.model, body, accent, expr)) { /* lane portrait */ }
    else if (look.model === 'pumpking') {
      p.ellipse(16, 19, 13, 11, body);
      for (const x of [9, 16, 23]) p.ellipse(x, 19, 4, 10, body);
      p.poly([5, 9, 5, 3, 10, 6, 16, 1, 22, 6, 27, 3, 27, 9], accent);
      const hurt = expr === 'hurt' || expr === 'shocked';
      p.poly([7, 17, 11, hurt ? 12 : 14, 14, 18], accent);
      p.poly([18, 18, 21, hurt ? 12 : 14, 25, 17], accent);
      p.rect(9, 22, 23, hurt ? 26 : 24, 0x1a1c2c);
      p.rect(12, 22, 14, 23, accent);
      p.rect(19, 24, 21, 25, accent);
    } else if (look.model === 'king') paintKing(p, body, accent, expr);
    else if (look.model === 'rex') paintRex(p, body, accent, expr);
    else if (look.model === 'queen') paintQueen(p, body, accent, expr);
    else if (look.model === 'omega') paintOmega(p, body, accent, expr);
    else if (look.model === 'dj') paintDj(p, body, accent, expr);
    else if (look.model === 'jack') paintJack(p, body, accent, expr);
    else if (look.model === 'airship') paintAdmiral(p, body, accent, expr);
    else paintBlob(p, body, accent, expr);
  }
  return p.finish();
}

const cache = new Map<string, HTMLCanvasElement>();
const CACHE_MAX = 240;

/** A cached 32x32 canvas of the portrait (draw it scaled with image smoothing off). */
export function portraitCanvas(look: PortraitLook, expr: Expression, blink = false): HTMLCanvasElement {
  const key = `${lookKey(look)}|${expr}|${blink ? 1 : 0}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = PORTRAIT;
  const ctx = c.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(PORTRAIT, PORTRAIT);
    img.data.set(paintPortrait(look, expr, blink));
    ctx.putImageData(img, 0, 0);
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, c);
  return c;
}
