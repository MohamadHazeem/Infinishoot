import { isRtl, localize } from '../i18n';
import { PALETTE, pixelIconUrl } from './pixelIcons';
import type { LoadoutItem } from './hud';

/**
 * BUILD CARD: the run's build drawn as a pixel-art PNG (game-over screen).
 * Laid out on a 640x360 grid of UI pixels and scaled 2x with no smoothing,
 * on the Sweetie 16 palette, with the same 24px item sprites as the menus.
 * Saved through a normal download, which the desktop app turns into a Save
 * dialog (electron/main.cjs, `will-download`).
 */
export interface BuildCardData {
  hero: string;
  /** "ENDLESS · HARD", or "STANDARD". */
  label: string;
  stage: number;
  score: number;
  level: number;
  kills: number;
  time: number;
  /** Hero.loadout(): special, weapons (loadout and auto), passives. */
  items: LoadoutItem[];
  mods: { id: string; name: string; color: string; glyph: string; level: number }[];
  relics: { id: string; name: string; color: string; glyph: string }[];
  date: string;
  version: string;
}

const W = 640;
const H = 360;
const S = 2; // output scale
const [INK, PLUM, , ORANGE, YELLOW, LIME, , , NAVY, , SKY, CYAN, WHITE, MIST, SLATE, NIGHT] = PALETTE;
const SLOT_COLOR: Record<string, string> = { left: SKY, right: ORANGE, special: PLUM, auto: LIME, item: SLATE };
/** Slot labels on dark: plum is too dark to read, so the special's label is white. */
const SLOT_TEXT: Record<string, string> = { ...SLOT_COLOR, special: WHITE };

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    if (!url) return res(null);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

/** A notched pixel frame: ink ring, light top-left bevel, dark bottom-right bevel. */
function frame(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bg: string, hi: string, lo: string): void {
  c.fillStyle = INK;
  c.fillRect(x + 1, y, w - 2, h);
  c.fillRect(x, y + 1, w, h - 2);
  c.fillStyle = bg;
  c.fillRect(x + 1, y + 1, w - 2, h - 2);
  c.fillStyle = hi;
  c.fillRect(x + 1, y + 1, w - 2, 1);
  c.fillRect(x + 1, y + 1, 1, h - 2);
  c.fillStyle = lo;
  c.fillRect(x + 1, y + h - 2, w - 2, 1);
  c.fillRect(x + w - 2, y + 1, 1, h - 2);
}

function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, font = 'Jersey 15', align: CanvasTextAlign = 'left'): void {
  s = localize(s);
  if (isRtl()) font = 'Infini Arabic';
  c.font = `${size}px "${font}", monospace`;
  c.textAlign = align;
  c.textBaseline = 'top';
  // One-pixel ink outline (drop below), like the menu text.
  c.fillStyle = INK;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 2]]) c.fillText(s, x + dx, y + dy);
  c.fillStyle = color;
  c.fillText(s, x, y);
}

/** Shorten a name to fit a width. */
function fit(c: CanvasRenderingContext2D, s: string, w: number, size: number, font = 'Jersey 15'): string {
  s = localize(s);
  if (isRtl()) font = 'Infini Arabic';
  c.font = `${size}px "${font}", monospace`;
  if (c.measureText(s).width <= w) return s;
  while (s.length > 2 && c.measureText(s + '.').width > w) s = s.slice(0, -1);
  return s + '.';
}

async function icon(c: CanvasRenderingContext2D, id: string, color: string, glyph: string, x: number, y: number, size: 24 | 48): Promise<void> {
  const img = await loadImage(pixelIconUrl(id, color));
  if (img) c.drawImage(img, x, y, size, size);
  else text(c, glyph || '?', x + size / 2, y + size * 0.15, size * 0.7, color, 'Jersey 15', 'center');
}

/** Draw the card; returns the canvas (2x scale). */
export async function drawBuildCard(d: BuildCardData): Promise<HTMLCanvasElement> {
  try {
    await Promise.all(['18px "Infini Arabic"', '24px "Jersey 15"', '24px "Jersey 10"', '8px "Silkscreen"'].map((f) => document.fonts?.load(f)));
  } catch {
    // Fonts are bundled; if loading fails the fallback still draws.
  }
  const cv = document.createElement('canvas');
  cv.width = W * S;
  cv.height = H * S;
  const c = cv.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.scale(S, S);

  // Backdrop: navy with an ink dither, then the card frame.
  c.fillStyle = NAVY;
  c.fillRect(0, 0, W, H);
  c.fillStyle = INK;
  for (let y = 0; y < H; y += 2) for (let x = (y / 2) % 2 ? 1 : 0; x < W; x += 4) c.fillRect(x, y, 1, 1);
  frame(c, 6, 6, W - 12, H - 12, NIGHT, SLATE, INK);

  // Header.
  text(c, 'INFINISHOOT', 18, 12, 40, YELLOW, 'Jersey 10');
  text(c, 'BUILD CARD', W - 18, 14, 10, CYAN, 'Silkscreen', 'right');
  text(c, `${d.hero.toUpperCase()} · ${d.label}`, W - 18, 28, 20, WHITE, 'Jersey 15', 'right');
  text(c, d.date, W - 18, 46, 10, MIST, 'Silkscreen', 'right');

  // Score and run stats.
  frame(c, 16, 60, W - 32, 46, INK, NIGHT, INK);
  text(c, Math.floor(d.score).toLocaleString('en-US'), 28, 64, 40, YELLOW, 'Jersey 10');
  const stats: [string, string][] = [
    ['STAGE', String(d.stage)],
    ['LEVEL', String(d.level)],
    ['KILLS', d.kills.toLocaleString('en-US')],
    ['TIME', fmtTime(d.time)],
  ];
  stats.forEach(([k, v], i) => {
    const x = 300 + i * 82;
    text(c, k, x, 68, 8, CYAN, 'Silkscreen');
    text(c, v, x, 78, 24, WHITE);
  });

  const section = (label: string, x: number, y: number) => text(c, label, x, y, 8, CYAN, 'Silkscreen');
  const jobs: Promise<void>[] = [];

  // Loadout: left click, right click, special.
  section('LOADOUT', 18, 114);
  const bySlot = (s: string) => d.items.filter((i) => i.slot === s);
  const kit = [...bySlot('left'), ...bySlot('right'), ...bySlot('special')].slice(0, 3);
  kit.forEach((it, i) => {
    const x = 16 + i * 204;
    const y = 126;
    frame(c, x, y, 198, 60, INK, NIGHT, INK);
    c.fillStyle = SLOT_COLOR[it.slot ?? 'item'];
    c.fillRect(x + 2, y + 2, 3, 56);
    jobs.push(icon(c, it.id, it.color, it.icon, x + 10, y + 6, 48));
    text(c, fit(c, it.name, 128, 20), x + 64, y + 8, 20, WHITE);
    text(c, it.evo ? 'EVOLVED' : it.max ? 'MAX' : `RANK ${it.level}`, x + 64, y + 30, 8, it.evo ? YELLOW : MIST, 'Silkscreen');
    text(c, it.slot === 'left' ? 'LEFT CLICK' : it.slot === 'right' ? 'RIGHT CLICK' : 'SPECIAL Q/E', x + 64, y + 42, 8, SLOT_TEXT[it.slot ?? 'item'], 'Silkscreen');
  });

  // Auto weapons and items: icon tiles with a level.
  const tiles = (label: string, list: LoadoutItem[], x0: number, y0: number, cols: number, max: number) => {
    section(label, x0 + 2, y0);
    if (!list.length) text(c, '-', x0 + 4, y0 + 14, 20, SLATE);
    list.slice(0, max).forEach((it, i) => {
      const x = x0 + (i % cols) * 34;
      const y = y0 + 12 + Math.floor(i / cols) * 34;
      frame(c, x, y, 32, 32, INK, NIGHT, INK);
      jobs.push(icon(c, it.id, it.color, it.icon, x + 4, y + 4, 24));
      text(c, it.evo ? 'E' : String(it.level), x + 30, y + 21, 8, it.evo ? YELLOW : WHITE, 'Silkscreen', 'right');
    });
  };
  tiles('AUTO WEAPONS', bySlot('auto'), 16, 194, 4, 4);
  tiles('ITEMS', bySlot('item'), 162, 194, 8, 16);

  // Mods in slot order, and relics.
  section('MODS (LEFT TO RIGHT)', 450, 194);
  if (!d.mods.length) text(c, '-', 452, 208, 20, SLATE);
  d.mods.slice(0, 5).forEach((m, i) => {
    const y = 206 + i * 22;
    jobs.push(icon(c, m.id, m.color, m.glyph, 450, y, 24));
    text(c, `${i + 1}`, 448, y + 14, 8, YELLOW, 'Silkscreen');
    text(c, fit(c, m.name + (m.level > 1 ? ` LV${m.level}` : ''), 150, 18), 478, y + 3, 18, WHITE);
  });
  section('RELICS', 18, 278);
  if (!d.relics.length) text(c, '-', 20, 290, 20, SLATE);
  d.relics.slice(0, 16).forEach((r, i) => jobs.push(icon(c, r.id, r.color, r.glyph, 16 + i * 26, 290, 24)));

  // Footer.
  c.fillStyle = INK;
  c.fillRect(16, 330, W - 32, 1);
  text(c, `INFINISHOOT v${d.version}`, 18, 336, 8, SLATE, 'Silkscreen');
  text(c, 'TWIN-STICK ARCADE ROGUELIKE', W - 18, 336, 8, SLATE, 'Silkscreen', 'right');
  await Promise.all(jobs);
  return cv;
}

/** Save the card as a PNG download (a Save dialog in the desktop app). */
export async function saveBuildCard(d: BuildCardData): Promise<boolean> {
  const cv = await drawBuildCard(d);
  const blob = await new Promise<Blob | null>((res) => (cv.toBlob ? cv.toBlob(res, 'image/png') : res(null)));
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `InfiniShoot-build-${d.date}-stage${d.stage}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
