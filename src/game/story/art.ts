import { portraitCanvas, heroLook, bossLook } from '../../ui/portraitArt';
import { skinOf } from '../../data/skins';
import { ENEMIES } from '../../data/enemies';
import type { StoryEntry } from '../../data/story';

export function storyPortrait(entry: Pick<StoryEntry, 'kind' | 'id'>): HTMLCanvasElement {
  const look =
    entry.kind === 'hero'
      ? heroLook(entry.id, skinOf('default'))
      : bossLook(ENEMIES[entry.id] ?? ENEMIES.omega);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  canvas.getContext('2d')?.drawImage(portraitCanvas(look, 'determined'), 0, 0);
  return canvas;
}
/** Original pixel comic panels, drawn once per page; no asset fetches. */
export function comicPanel(
  canvas: HTMLCanvasElement,
  frame: number,
  hero: string,
  ending = false,
): void {
  canvas.width = 480;
  canvas.height = 190;
  const c = canvas.getContext('2d');
  if (!c) return;
  c.imageSmoothingEnabled = false;
  c.fillStyle = frame === 1 && !ending ? '#29366f' : '#41a6f6';
  c.fillRect(0, 0, 480, 190);
  c.fillStyle = '#ffcd75';
  c.fillRect(350, 16, 40, 40);
  c.fillStyle = '#73eff7';
  for (let i = 0; i < 9; i++) c.fillRect((i * 73) % 480, 18 + (i % 3) * 17, 40, 5);
  c.fillStyle = '#3b5dc9';
  c.fillRect(0, 118, 480, 72);
  c.fillStyle = '#73eff7';
  for (let i = 0; i < 36; i++) c.fillRect((i * 53) % 480, 125 + (i % 9) * 7, 13, 2);
  for (let i = 0; i < 5; i++) {
    const x = 12 + i * 102,
      y = 96 + (i % 2) * 25;
    c.fillStyle = '#5d275d';
    c.fillRect(x + 5, y + 9, 58, 18);
    c.fillRect(x + 13, y + 27, 38, 6);
    c.fillStyle = '#38b764';
    c.fillRect(x, y, 70, 12);
    c.fillStyle = '#a7f070';
    c.fillRect(x + 4, y, 62, 4);
    c.fillStyle = '#ffcd75';
    c.fillRect(x + 18, y - 15, 19, 15);
    c.fillStyle = '#b13e53';
    c.fillRect(x + 14, y - 19, 27, 5);
  }
  if (frame === 1 && !ending) {
    const boss = storyPortrait({ kind: 'boss', id: 'omega' });
    c.drawImage(boss, 185, 20, 112, 112);
    for (let i = 0; i < 20; i++) {
      c.fillStyle = '#b13e53';
      c.fillRect(18 + i * 23, 140 - (i % 4) * 12, 13, 13);
      c.fillStyle = '#ffcd75';
      c.fillRect(21 + i * 23, 144 - (i % 4) * 12, 7, 3);
    }
  } else if (frame === 2 || ending) {
    c.fillStyle = '#1a1c2c';
    c.fillRect(48, 52, 90, 109);
    c.fillStyle = '#ffcd75';
    c.fillRect(52, 56, 82, 101);
    c.drawImage(storyPortrait({ kind: 'hero', id: hero }), 45, 56, 96, 96);
    c.fillStyle = '#f4f4f4';
    for (let i = 0; i < 7; i++) c.fillRect(153 + i * 22, 56 + (i % 3) * 16, 10, 4);
  }
  c.fillStyle = '#1a1c2c';
  c.fillRect(0, 0, 480, 3);
  c.fillRect(0, 187, 480, 3);
}
