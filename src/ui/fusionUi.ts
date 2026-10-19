import { FUSIONS } from '../data/fusions';
import { WEAPONS } from '../data/weapons';
import { iconHtml } from './pixelIcons';

/** Fusion card strip: both weapons' icons with a plus, styled like the evolution strip. */
export function fuseStrip(parts: [string, string]): string {
  const part = (id: string) => {
    const w = WEAPONS[id];
    return w ? `<span class="pt have">${iconHtml(id, w.color, w.icon)}<span class="nm">${w.name.toUpperCase()}</span></span>` : '';
  };
  return `<div class="partner fuse"><div class="pair">${part(parts[0])}<i>+</i>${part(parts[1])}</div><b>BOTH FUSE INTO ONE SLOT</b></div>`;
}

let mergeEl: HTMLElement | null = null;

/**
 * The fusion moment on screen: both part icons slide in from the sides, crash
 * together in a white flash, and the fused weapon's icon pops out with its
 * name. Cosmetic and local (the host tells the fusing client to play it).
 */
export function showFusionMerge(parts: readonly [string, string], fusionId: string): void {
  if (typeof document === 'undefined') return;
  const f = WEAPONS[fusionId];
  const [a, b] = parts.map((id) => WEAPONS[id]);
  if (!f || !a || !b) return;
  mergeEl?.remove();
  const el = document.createElement('div');
  el.className = 'fusion-merge';
  el.style.setProperty('--c', f.color);
  el.innerHTML = `<div class="fm-a">${iconHtml(a.id, a.color, a.icon)}</div><div class="fm-b">${iconHtml(b.id, b.color, b.icon)}</div><i class="fm-flash"></i><div class="fm-c">${iconHtml(f.id, f.color, f.icon)}</div>`;
  document.body.appendChild(el);
  mergeEl = el;
  setTimeout(() => {
    el.remove();
    if (mergeEl === el) mergeEl = null;
  }, 1900);
}

/** FUSIONS section for the guide screen (EXTRAS > ENEMY GUIDE): every recipe, A + B = hybrid. */
export function fusionGuide(): string {
  const rows = FUSIONS.map((f) => {
    const [a, b] = f.parts.map((id) => WEAPONS[id]);
    return `<div class="bst fusion-row" style="--c:${f.color}">${iconHtml(f.id, f.color, '✦')}<b>${f.name.toUpperCase()}</b>
      <span class="st">${a.name.toUpperCase()} + ${b.name.toUpperCase()} (BOTH MAXED)</span>
      <small>${f.desc}</small></div>`;
  }).join('');
  return `<h2 class="bst-head">WEAPON FUSIONS</h2>${rows}`;
}
