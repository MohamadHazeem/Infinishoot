import * as THREE from 'three';
import type { Game } from '../game/game';
import { getLanguage, t } from '../i18n';

export const PETS2_CSS = `
#petpanel .h { gap: calc(2 * var(--p)); }
#petpanel .lv { flex-shrink: 0; }
#petpanel .n { overflow-wrap: anywhere; }
#petpanel .pets2-scan { color: var(--cyan); font: 13px var(--font); margin-top: calc(2 * var(--p)); line-height: 1.25; }
#petpanel .pets2-scan div { overflow-wrap: anywhere; }
#scr-wardrobe.menu-consistent { justify-content: safe center; gap: calc(3 * var(--p)); padding-block: calc(4 * var(--p)); }
#scr-wardrobe.menu-consistent > .skin-grid { flex-shrink: 1; min-height: calc(24 * var(--p)); overflow-y: auto; padding: calc(2 * var(--p)); align-content: start; grid-auto-rows: max-content; }
#scr-wardrobe > .skin-grid:not(.pet-grid) { max-height: 14vh; }
#scr-wardrobe > .pet-grid { max-height: 42vh; }
#scr-wardrobe .skin { min-height: calc(30 * var(--p)); }
#scr-wardrobe .pet-grid .skin { min-height: calc(38 * var(--p)); }
@media (max-width: 850px) { #scr-wardrobe .pet-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); width: 90%; } }
.reduce-flash #petpanel.pop { animation: none; }
@media (prefers-reduced-motion: reduce) { #petpanel.pop { animation: none; } }
`;
interface ScoutHud {
  el: HTMLElement | null;
  clock: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
}
const states = new WeakMap<Game, ScoutHud>();
const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
export function renderPetScout(g: Game, dt: number): void {
  let s = states.get(g);
  if (!s) {
    s = { el: null, clock: 0, a: new THREE.Vector3(), b: new THREE.Vector3() };
    states.set(g, s);
  }
  const h = g.hero,
    on = g.mode !== 'title' && h && !h.left && !h.player.dead && h.petState.ranks.scout > 0;
  if (!on) {
    if (s.el) s.el.hidden = true;
    return;
  }
  s.clock -= dt;
  const panel = document.getElementById('petpanel');
  if (!panel) return;
  if (!s.el || s.el.parentElement !== panel) {
    s.el = document.createElement('div');
    s.el.className = 'pets2-scan';
    panel.append(s.el);
    s.clock = 0;
  }
  if (s.clock > 0) return;
  s.clock = 0.2;
  const p = h.player,
    ex = h.petState.extra;
  const line = (x: number, z: number, label: string) => {
    s!.a.set(x, 0, z).project(g.cam.camera);
    s!.b.set(p.x, 0, p.z).project(g.cam.camera);
    const angle = Math.atan2(-(s!.a.y - s!.b.y), s!.a.x - s!.b.x);
    const arrow = ARROWS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
    const unit = getLanguage() === 'ar' ? 'م' : 'm';
    return `${arrow} ${label} · ${Math.round(Math.hypot(x - p.x, z - p.z))} ${unit}`;
  };
  const lines: string[] = [];
  if (ex.scoutKind)
    lines.push(line(ex.scoutX, ex.scoutZ, t(ex.scoutKind === 2 ? 'pets2.elite' : 'pets2.threat')));
  if (ex.secret) lines.push(line(ex.secretX, ex.secretZ, t('pets2.secret')));
  s.el.textContent = lines.length ? lines.join(' / ') : t('pets2.scan');
  s.el.hidden = false;
}
