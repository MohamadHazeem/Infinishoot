import type { Input } from '../core/input';

/**
 * On-screen twin-stick controls for touch screens. They appear on the first
 * touch: the left half of the screen is a floating move stick, the right half
 * an aim stick that also fires, plus DASH, CHARGE and BOMB buttons. Everything
 * feeds Input.virtual, which behaves like a gamepad, so the game needs no
 * special cases. Menus are normal buttons and work with taps.
 */
const RADIUS = 56;

export function setupTouch(root: HTMLElement, input: Input, inGame: () => boolean): void {
  let built = false;
  const v = input.virtual;
  let layer: HTMLElement;
  const sticks: Record<'move' | 'aim', { id: number; ox: number; oy: number; base: HTMLElement; knob: HTMLElement }> = {} as never;

  const build = () => {
    built = true;
    v.active = true;
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="touch">
        <div class="tstick move"><i></i></div>
        <div class="tstick aim"><i></i></div>
        <button class="tbtn dash" data-b="0">DASH</button>
        <button class="tbtn charge" data-b="2">CHARGE</button>
        <button class="tbtn bomb" data-b="5">BOMB</button>
      </div>`,
    );
    layer = root.querySelector('#touch')!;
    for (const k of ['move', 'aim'] as const) {
      const base = layer.querySelector<HTMLElement>(`.tstick.${k}`)!;
      sticks[k] = { id: -1, ox: 0, oy: 0, base, knob: base.querySelector('i')! };
    }
    layer.querySelectorAll<HTMLElement>('.tbtn').forEach((b) => {
      const i = Number(b.dataset.b);
      const set = (on: boolean) => (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        v.buttons[i] = on;
        b.classList.toggle('on', on);
      };
      b.addEventListener('pointerdown', set(true));
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('pointerleave', set(false));
    });
  };

  const stickFor = (x: number) => (x < window.innerWidth / 2 ? 'move' : 'aim');

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      if (!built) build();
      layer.hidden = !inGame();
      if (!inGame() || (e.target as HTMLElement).closest('button, .screen')) return;
      const k = stickFor(e.clientX);
      const s = sticks[k];
      if (s.id >= 0) return;
      s.id = e.pointerId;
      s.ox = e.clientX;
      s.oy = e.clientY;
      s.base.style.transform = `translate(${e.clientX - RADIUS}px, ${e.clientY - RADIUS}px)`;
      s.base.classList.add('on');
    },
    { passive: true },
  );

  window.addEventListener(
    'pointermove',
    (e) => {
      if (!built) return;
      for (const k of ['move', 'aim'] as const) {
        const s = sticks[k];
        if (s.id !== e.pointerId) continue;
        let dx = e.clientX - s.ox;
        let dy = e.clientY - s.oy;
        const l = Math.hypot(dx, dy);
        if (l > RADIUS) {
          dx = (dx / l) * RADIUS;
          dy = (dy / l) * RADIUS;
        }
        s.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const out = k === 'move' ? v.move : v.aim;
        const n = Math.min(1, l / RADIUS);
        if (n < 0.18) out.x = out.y = 0;
        else {
          out.x = (dx / (Math.hypot(dx, dy) || 1)) * (k === 'move' ? n : 1);
          out.y = (dy / (Math.hypot(dx, dy) || 1)) * (k === 'move' ? n : 1);
        }
      }
    },
    { passive: true },
  );

  const release = (e: PointerEvent) => {
    if (!built) return;
    for (const k of ['move', 'aim'] as const) {
      const s = sticks[k];
      if (s.id !== e.pointerId) continue;
      s.id = -1;
      s.base.classList.remove('on');
      s.knob.style.transform = '';
      const out = k === 'move' ? v.move : v.aim;
      out.x = out.y = 0;
    }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // Hide the controls behind menus.
  const tick = () => {
    if (built) layer.hidden = !inGame();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
