import type { Input } from '../core/input';
import type { Game } from '../game/game';
import { settings } from '../game/settings';
import { timeState } from '../game/systems/time';
import { timeTuning } from '../game/timeRules';
import { mobileDevice } from '../core/mobile';
import { onLanguageChange } from '../i18n';
import {
  TOUCH_IDS,
  TOUCH_BUTTONS,
  touchControls,
  touchLabel,
  placeTouch,
  type TouchId,
} from './touchEditor';

/** Read by the local presentation only; actions still use the ordinary authoritative input path. */
export const touchHud = { ult01: 0, ultReady: false };

export function setupTouch(
  root: HTMLElement,
  input: Input,
  inGame: () => boolean,
  game?: Game,
): void {
  const v = input.virtual;
  let layer: HTMLElement | null = null;
  const elements = {} as Record<TouchId, HTMLElement>;
  const sticks = {
    move: { id: -1, x: 0, y: 0, radius: 56, knob: null as HTMLElement | null },
    aim: { id: -1, x: 0, y: 0, radius: 56, knob: null as HTMLElement | null },
  };
  const held = new Map<number, TouchId>();
  let shownK = -1,
    shownReady = false;
  const reset = () => {
    for (const id of ['move', 'aim'] as const) {
      sticks[id].id = -1;
      sticks[id].knob?.style.removeProperty('transform');
      v[id].x = v[id].y = 0;
    }
    for (const id of TOUCH_IDS) {
      const button = TOUCH_BUTTONS[id];
      if (button !== undefined) v.buttons[button] = false;
      elements[id]?.classList.remove('on');
    }
    held.clear();
  };
  const layout = () => {
    if (!layer) return;
    reset();
    for (const id of TOUCH_IDS)
      placeTouch(elements[id], touchControls()[id], layer.clientWidth, layer.clientHeight);
  };
  const build = () => {
    if (layer) return;
    layer = document.createElement('div');
    layer.id = 'touch';
    layer.hidden = true;
    for (const id of TOUCH_IDS) {
      const stick = id === 'move' || id === 'aim';
      const b = document.createElement(stick ? 'div' : 'button');
      b.className = `${stick ? 'tstick' : 'tbtn'} ${id}`;
      b.dataset.touch = id;
      b.setAttribute('aria-label', touchLabel(id));
      if (stick) {
        const knob = document.createElement('i');
        b.append(knob);
        sticks[id].knob = knob;
      } else b.textContent = touchLabel(id);
      elements[id] = b;
      layer.append(b);
    }
    root.append(layer);
    layer.addEventListener('pointerdown', (e) => {
      if (!inGame() || e.pointerType !== 'touch') return;
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-touch]');
      if (!b) return;
      const id = b.dataset.touch as TouchId;
      v.active = true;
      if (id === 'move' || id === 'aim') {
        const s = sticks[id];
        if (s.id !== -1) return;
        const r = b.getBoundingClientRect();
        s.id = e.pointerId;
        s.x = r.left + r.width / 2;
        s.y = r.top + r.height / 2;
        s.radius = r.width / 2;
      } else {
        if ([...held.values()].includes(id)) return;
        held.set(e.pointerId, id);
        v.buttons[TOUCH_BUTTONS[id]!] = true;
      }
      b.classList.add('on');
      b.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    onLanguageChange(() => {
      for (const id of TOUCH_IDS) {
        elements[id].setAttribute('aria-label', touchLabel(id));
        if (id !== 'move' && id !== 'aim') elements[id].textContent = touchLabel(id);
      }
    });
  };
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      build();
      v.active = true;
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      for (const id of ['move', 'aim'] as const) {
        const s = sticks[id];
        if (s.id !== e.pointerId) continue;
        const dx = e.clientX - s.x,
          dy = e.clientY - s.y,
          l = Math.hypot(dx, dy),
          n = Math.min(1, l / s.radius),
          scale = Math.min(1, s.radius / (l || 1));
        s.knob!.style.transform = `translate(${dx * scale}px,${dy * scale}px)`;
        const out = v[id];
        out.x = n < 0.18 ? 0 : (dx / (l || 1)) * (id === 'move' ? n : 1);
        out.y = n < 0.18 ? 0 : (dy / (l || 1)) * (id === 'move' ? n : 1);
      }
    },
    { passive: true },
  );
  const release = (e: PointerEvent) => {
    for (const id of ['move', 'aim'] as const)
      if (sticks[id].id === e.pointerId) {
        sticks[id].id = -1;
        sticks[id].knob!.style.transform = '';
        v[id].x = v[id].y = 0;
        elements[id].classList.remove('on');
      }
    const id = held.get(e.pointerId);
    if (id) {
      held.delete(e.pointerId);
      v.buttons[TOUCH_BUTTONS[id]!] = false;
      elements[id].classList.remove('on');
    }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  });
  window.addEventListener('resize', layout);
  window.addEventListener('touchlayoutchange', layout);
  const forced =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).has('test') &&
    new URLSearchParams(location.search).has('touch');
  if (mobileDevice() || forced) {
    build();
    v.active = true;
  }
  // Low-frequency HUD refresh, no extra animation loop or per-frame DOM queries.
  const refresh = () => {
    if (!layer) return;
    const hide = !inGame() || document.hidden;
    if (layer.hidden !== hide) {
      layer.hidden = hide;
      reset();
      if (!hide) layout();
    }
    if (hide) return;
    layer.style.opacity = String(settings.touchOpacity / 100);
    for (const id of TOUCH_IDS) {
      let unused = false;
      if (game) {
        const dead = game.hero.player.dead;
        unused = dead && id !== 'team';
        if (id === 'team') unused = !game.coop || !!game.pvp;
        if (id === 'rewind') {
          const s = timeState(game);
          unused =
            dead ||
            !!game.pvp ||
            (game.role === 'client' ? s.net.used : s.rewindsUsed >= timeTuning.rewindPerStage);
        }
        if (id === 'charge')
          unused = dead || !game.hero.weapons.some((w) => w.def.slot === 'secondary');
        if (id === 'bomb') unused = dead || !game.hero.special;
        if (id === 'cash' || id === 'cashpick') unused = dead || !!game.pvp || game.combo <= 0;
      }
      const hidden = settings.touchAutoHide && unused;
      if (elements[id].hidden !== hidden) {
        elements[id].hidden = hidden;
        const button = TOUCH_BUTTONS[id];
        if (hidden && button !== undefined) v.buttons[button] = false;
      }
    }
    if (touchHud.ult01 !== shownK)
      elements.ult.style.setProperty('--k', String((shownK = touchHud.ult01)));
    if (touchHud.ultReady !== shownReady)
      elements.ult.classList.toggle('ready', (shownReady = touchHud.ultReady));
  };
  // Menu transitions must clear held input immediately, even between timer ticks.
  new MutationObserver(() => {
    if (!inGame()) {
      reset();
      if (layer) layer.hidden = true;
    }
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
  setInterval(refresh, 100);
  refresh();
}
