import type { Expression } from './portraitArt';
interface Pixels {
  rect(x0: number, y0: number, x1: number, y1: number, c: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, c: number): void;
  poly(points: number[], c: number): void;
}
/** Same 32px painter as the existing portraits and comic finishers. */
export function paintBiome3Portrait(
  p: Pixels,
  model: string,
  body: number,
  accent: number,
  expr: Expression,
): boolean {
  if (model !== 'cake' && model !== 'kraken') return false;
  const ink = 0x1a1c2c,
    white = 0xf4f4f4,
    gold = 0xffcd75;
  if (model === 'cake') {
    p.rect(3, 19, 28, 29, body);
    p.rect(6, 11, 25, 19, accent);
    p.rect(10, 5, 21, 11, body);
    for (const [x, y, w] of [
      [3, 19, 26],
      [6, 11, 20],
      [10, 5, 12],
    ]) {
      p.rect(x, y, x + w - 1, y + 2, white);
      for (let i = x + 1; i < x + w; i += 5) p.rect(i, y + 1, i + 1, y + 4, white);
    }
    p.rect(15, 1, 16, 5, 0x73eff7);
    p.ellipse(16, 1, 2, 2, gold);
  } else {
    for (const x of [5, 12, 20, 27]) {
      p.ellipse(x, 26, 4, 5, body);
      p.rect(x - 1, 27, x + 1, 29, accent);
    }
    p.ellipse(16, 17, 11, 12, body);
    p.poly([7, 9, 6, 2, 11, 5, 16, 0, 21, 5, 26, 2, 25, 9], gold);
    p.rect(8, 8, 24, 10, gold);
  }
  const y = model === 'cake' ? 24 : 17;
  if (expr === 'hurt') {
    p.poly([7, y - 2, 13, y, 7, y + 2], ink);
    p.poly([25, y - 2, 19, y, 25, y + 2], ink);
  } else {
    const h = expr === 'shocked' ? 3 : expr === 'determined' ? 1.5 : 2;
    p.ellipse(11, y, 3, h, white);
    p.ellipse(21, y, 3, h, white);
    p.rect(11, y - 1, 12, y + 1, ink);
    p.rect(20, y - 1, 21, y + 1, ink);
  }
  const my = y + 4;
  if (expr === 'shocked') p.ellipse(16, my, 2, 2, ink);
  else p.rect(13, my, 19, my + (expr === 'grinning' || expr === 'victorious' ? 1 : 0), ink);
  if (expr === 'victorious')
    p.poly([28, 10, 29, 12, 31, 13, 29, 14, 28, 16, 27, 14, 25, 13, 27, 12], gold);
  return true;
}
