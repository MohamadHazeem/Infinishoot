import type { Input } from '../core/input';

/**
 * On-screen twin-stick controls for touch screens. They appear on the first
 * touch: the left half of the screen is a floating move stick, the right half
 * an aim stick that also fires, plus DASH, RIGHT CLICK, SPECIAL, PARRY and ULT buttons. Everything
 * feeds Input.virtual, which behaves like a gamepad, so the game needs no
 * special cases. Menus are normal buttons and work with taps.
 */
const RADIUS = 56;

/** HUD state the touch buttons show (written by the skill HUD every frame): the ULT button fills and glows when ready. */
export const touchHud = { ult01: 0, ultReady: false };

const TOUCH_CSS = `
#touch .parry { --bg: var(--teal); --hi: var(--green); }
#touch .ult {
  --c: var(--yellow);
  --bg: var(--plum);
  --hi: var(--red);
  background: linear-gradient(to top, var(--orange) calc(var(--k, 0) * 100%), var(--bg) 0);
}
#touch .ult.ready { --ring: var(--yellow); color: var(--yellow); animation: hop 0.5s steps(2) infinite; }
.reduce-flash #touch .ult.ready { animation: none; }
`;

export function setupTouch(root: HTMLElement, input: Input, inGame: () => boolean): void {
  let built = false;
  const v = input.virtual;
  let layer: HTMLElement;
  const sticks: Record<'move' | 'aim', { id: number; ox: number; oy: number; base: HTMLElement; knob: HTMLElement }> = {} as never;

  let ultBtn: HTMLElement | null = null;
  let shownK = -1;
  let shownReady = false;

  const build = () => {
    built = true;
    v.active = true;
    if (!document.getElementById('touch-css')) {
      const st = document.createElement('style');
      st.id = 'touch-css';
      st.textContent = TOUCH_CSS;
      document.head.appendChild(st);
    }
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="touch">
        <div class="tstick move"><i></i></div>
        <div class="tstick aim"><i></i></div>
        <button class="tbtn dash" data-b="0">DASH</button>
        <button class="tbtn charge" data-b="2">R-CLICK</button>
        <button class="tbtn bomb" data-b="5">SPECIAL</button>
        <button class="tbtn parry" data-b="1">PARRY</button>
        <button class="tbtn ult" data-b="10">ULT</button>
        <button class="tbtn rewind" data-b="14">REWIND</button>
      </div>`,
    );
    layer = root.querySelector('#touch')!;
    ultBtn = layer.querySelector<HTMLElement>('.ult');
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
    if (ultBtn && !layer.hidden) {
      if (touchHud.ult01 !== shownK) ultBtn.style.setProperty('--k', String((shownK = touchHud.ult01)));
      if (touchHud.ultReady !== shownReady) ultBtn.classList.toggle('ready', (shownReady = touchHud.ultReady));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
