import { loadJson, saveJson } from '../core/storage';
import { t, onLanguageChange } from '../i18n';
import type { Screens } from './screens';
import { injectMobileCss } from './mobileCss';

export const TOUCH_IDS = [
  'move',
  'aim',
  'dash',
  'charge',
  'bomb',
  'parry',
  'ult',
  'rewind',
  'team',
  'cash',
  'cashpick',
] as const;
export type TouchId = (typeof TOUCH_IDS)[number];
export interface TouchPosition {
  x: number;
  y: number;
  size: number;
}
export interface TouchLayout {
  version: 1;
  controls: Record<TouchId, TouchPosition>;
  portrait: Record<TouchId, TouchPosition>;
}
export const TOUCH_BUTTONS: Partial<Record<TouchId, number>> = {
  dash: 0,
  charge: 2,
  bomb: 5,
  parry: 1,
  ult: 10,
  rewind: 12,
  team: 13,
  cash: 15,
  cashpick: 14,
};
export const touchLabel = (id: TouchId): string => t(`mobile.${id}`);
const clamp = (n: unknown, fallback: number, lo: number, hi: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;

export function defaultTouchLayout(): TouchLayout {
  const controls = {} as TouchLayout['controls'];
  const positions = [
    [0.12, 0.77, 112],
    [0.88, 0.77, 112],
    [0.73, 0.85, 60],
    [0.73, 0.66, 60],
    [0.88, 0.50, 60],
    [0.64, 0.85, 60],
    [0.64, 0.66, 60],
    [0.35, 0.46, 60],
    [0.23, 0.85, 60],
    [0.32, 0.85, 60],
    [0.32, 0.66, 60],
  ];
  TOUCH_IDS.forEach((id, i) => {
    const [x, y, size] = positions[i];
    controls[id] = { x, y, size };
  });
  const portrait = {} as TouchLayout['controls'];
  const portraitPositions = [
    [0.19, 0.8, 112],
    [0.81, 0.8, 112],
    [0.8, 0.65, 60],
    [0.6, 0.65, 60],
    [0.8, 0.55, 60],
    [0.4, 0.65, 60],
    [0.6, 0.55, 60],
    [0.2, 0.55, 60],
    [0.2, 0.65, 60],
    [0.4, 0.55, 60],
    [0.4, 0.45, 60],
  ];
  TOUCH_IDS.forEach((id, i) => {
    const [x, y, size] = portraitPositions[i];
    portrait[id] = { x, y, size };
  });
  return { version: 1, controls, portrait };
}
/** Deep validation: old, partial, corrupt and future data always produce usable controls. */
export function normalizeTouchLayout(raw: unknown): TouchLayout {
  const out = defaultTouchLayout();
  if (!raw || typeof raw !== 'object' || (raw as TouchLayout).version !== 1) return out;
  for (const orientation of ['controls', 'portrait'] as const)
    for (const id of TOUCH_IDS) {
      const p = (raw as TouchLayout)[orientation]?.[id],
        d = out[orientation][id];
      if (p && typeof p === 'object')
        out[orientation][id] = {
          x: clamp(p.x, d.x, 0, 1),
          y: clamp(p.y, d.y, 0, 1),
          size: clamp(p.size, d.size, id === 'move' || id === 'aim' ? 80 : 48, 160),
        };
    }
  return out;
}
export function touchRect(
  p: TouchPosition,
  width: number,
  height: number,
): { left: number; top: number; size: number } {
  const size = Math.min(p.size, Math.max(1, width - 16), Math.max(1, height - 16));
  return {
    left: Math.max(8, Math.min(width - size - 8, p.x * width - size / 2)),
    top: Math.max(8, Math.min(height - size - 8, p.y * height - size / 2)),
    size,
  };
}
export function placeTouch(el: HTMLElement, p: TouchPosition, w: number, h: number): void {
  const r = touchRect(p, w, h);
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = el.style.height = `${r.size}px`;
}
export const touchLayout = normalizeTouchLayout(loadJson('touch.layout.v1', null));
export function touchControls(
  w = window.innerWidth,
  h = window.innerHeight,
): TouchLayout['controls'] {
  return w < h ? touchLayout.portrait : touchLayout.controls;
}
function persist(): void {
  saveJson('touch.layout.v1', touchLayout);
  window.dispatchEvent(new Event('touchlayoutchange'));
}

/** Registered menu: drag controls, drag their corner handle, or use labelled sliders. */
export function setupTouchEditor(screens: Screens): void {
  injectMobileCss();
  const el = document.createElement('div');
  el.id = 'scr-touchlayout';
  el.className = 'screen dim';
  let selected: TouchId = 'move';
  let drag: { id: number; x: number; y: number; start: TouchPosition; resize: boolean } | null =
    null;
  const paint = () => {
    const board = el.querySelector<HTMLElement>('.touch-board')!;
    board.style.aspectRatio = `${window.innerWidth}/${window.innerHeight}`;
    for (const id of TOUCH_IDS) {
      const b = board.querySelector<HTMLElement>(`[data-touch="${id}"]`)!;
      placeTouch(b, touchControls()[id], board.clientWidth, board.clientHeight);
      b.classList.toggle('selected', selected === id);
      b.setAttribute('aria-pressed', String(selected === id));
    }
    for (const key of ['x', 'y', 'size'] as const) {
      const inp = el.querySelector<HTMLInputElement>(`[data-position="${key}"]`)!;
      inp.value = String(touchControls()[selected][key] * (key === 'size' ? 1 : 100));
      if (key === 'size') inp.min = selected === 'move' || selected === 'aim' ? '80' : '48';
    }
    el.querySelector<HTMLElement>('[data-selected]')!.textContent = touchLabel(selected);
  };
  const render = () => {
    el.innerHTML = `<h1>${t('mobile.layout')}</h1><p class="touch-help">${t('mobile.help')}</p><div class="touch-board" dir="ltr">${TOUCH_IDS.map((id) => `<button data-nav data-touch="${id}" class="px touch-preview ${id}">${touchLabel(id)}<span class="touch-grip" aria-hidden="true">↘</span></button>`).join('')}</div><div class="touch-tools"><b data-selected></b>${(['x', 'y', 'size'] as const).map((key) => `<label>${t(`mobile.${key}`)}<input data-nav data-position="${key}" type="range" min="${key === 'size' ? 48 : 0}" max="${key === 'size' ? 160 : 100}" aria-label="${t(`mobile.${key}`)}"></label>`).join('')}<button data-nav data-reset-layout>${t('mobile.reset')}</button><button data-nav data-done>${t('mobile.done')}</button></div>`;
    paint();
  };
  screens.addScreen('touchlayout', el, { onBack: () => screens.show('settings') });
  render();
  onLanguageChange(render);
  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-done]')) screens.show('settings');
    if (target.closest('[data-reset-layout]')) {
      Object.assign(touchLayout, defaultTouchLayout());
      persist();
      paint();
    }
    const id = target.closest<HTMLElement>('[data-touch]')?.dataset.touch as TouchId | undefined;
    if (id) {
      selected = id;
      paint();
    }
  });
  el.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    const key = inp.dataset.position as keyof TouchPosition | undefined;
    if (!key) return;
    touchControls()[selected][key] = Number(inp.value) / (key === 'size' ? 1 : 100);
    persist();
    paint();
  });
  el.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-touch]');
    if (!b || drag) return;
    selected = b.dataset.touch as TouchId;
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      start: { ...touchControls()[selected] },
      resize: !!(e.target as HTMLElement).closest('.touch-grip'),
    };
    b.setPointerCapture(e.pointerId);
    paint();
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const board = el.querySelector<HTMLElement>('.touch-board')!;
    const p = touchControls()[selected];
    if (drag.resize)
      p.size = clamp(
        drag.start.size + Math.max(e.clientX - drag.x, e.clientY - drag.y),
        p.size,
        selected === 'move' || selected === 'aim' ? 80 : 48,
        160,
      );
    else {
      p.x = clamp(drag.start.x + (e.clientX - drag.x) / board.clientWidth, p.x, 0, 1);
      p.y = clamp(drag.start.y + (e.clientY - drag.y) / board.clientHeight, p.y, 0, 1);
    }
    paint();
  });
  const release = (e: PointerEvent) => {
    if (drag?.id === e.pointerId) {
      drag = null;
      persist();
    }
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
  new MutationObserver(() => {
    if (!el.hidden) paint();
  }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', () => {
    if (!el.hidden) paint();
  });
}
