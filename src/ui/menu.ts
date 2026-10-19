import type { Input } from '../core/input';
import { sfx } from '../audio/sfx';
import { navLock } from '../game/titlePlay';

/**
 * Keyboard / gamepad / mouse navigation for one menu. Navigable elements are
 * those with a `data-nav` attribute inside `root`. Range inputs are adjusted
 * with left/right; everything else is activated with Enter / Space / (A).
 */
export class MenuNav {
  focus = 0;
  private items: HTMLElement[] = [];
  private repeat = 0;

  constructor(
    private root: HTMLElement,
    private opts: { horizontal?: boolean; columns?: number; onBack?: () => void } = {},
  ) {
    // One UI kit for mouse, keyboard and gamepad: all activate via click() (src/audio/uiKit.ts).
    this.root.addEventListener('click', (event) => {
      const el = (event.target as HTMLElement).closest<HTMLElement>('[data-nav]');
      if (!el || el.matches('.rolling, input')) return;
      if (el.matches(':disabled, .cant, .locked')) return sfx.deny();
      // Toggles run their own handler first, so the label already shows the new state.
      if (el.dataset.toggle !== undefined) return sfx.ui('toggle', el.querySelector('b')?.textContent === 'ON' ? 1 : 0);
      sfx.menuSelect();
    });
    // Sliders tick up the scale with their value (mouse drags and keys alike).
    this.root.addEventListener('input', (event) => {
      const el = event.target as HTMLInputElement;
      if (el.type !== 'range') return;
      const min = Number(el.min || 0);
      const max = Number(el.max || 1);
      sfx.ui('tick', max > min ? (Number(el.value) - min) / (max - min) : 0);
    });
  }

  /** Re-scan items (call after the menu's content changes). */
  refresh(focus = 0): void {
    this.items = Array.from(this.root.querySelectorAll<HTMLElement>('[data-nav]'));
    this.items.forEach((el, i) => {
      el.onmouseenter = () => this.setFocus(i, true, false);
    });
    this.setFocus(Math.min(focus, this.items.length - 1), false);
  }

  private setFocus(i: number, sound = true, scroll = true): void {
    if (i < 0 || i >= this.items.length) return;
    if (sound && i !== this.focus) {
      const el = this.items[i];
      if (el.closest('.card, .mod-card')) sfx.ui('hover');
      else if (el.matches('[role=tab], [data-tab]')) sfx.ui('tab');
      else sfx.menuMove();
    }
    this.focus = i;
    this.items.forEach((el, j) => el.classList.toggle('focused', j === i));
    if (sound && scroll) this.items[i].scrollIntoView({ block: 'nearest' });
  }

  /** Index of the closest item above (-1) or below (1) the focused one, or the focus itself. */
  private nearestVertical(dir: -1 | 1): number {
    const cur = this.items[this.focus]?.getBoundingClientRect();
    if (!cur) return this.focus;
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;
    let best = this.focus;
    let bd = Infinity;
    this.items.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const dy = (r.top + r.height / 2 - cy) * dir;
      if (dy < 8) return;
      const d = dy + Math.abs(r.left + r.width / 2 - cx) * 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  update(input: Input, dt: number): void {
    if (this.items.length === 0) return;
    // Playable title: WASD, Space and the left stick drive the demo hero, not the menu (src/game/titlePlay.ts).
    const lock = navLock.move;
    const k = (c: string) => input.keyPressed(c) && !(lock && (c === 'Space' || c === 'KeyW' || c === 'KeyA' || c === 'KeyS' || c === 'KeyD'));
    const pad = (b: number) => input.padButtonPressed(b);

    // Analog stick with auto-repeat.
    let stick = 0;
    const axis = this.opts.horizontal ? input.move.x : input.move.y;
    const cross = this.opts.horizontal ? input.move.y : input.move.x;
    this.repeat -= dt;
    if (input.device === 'pad' && Math.abs(axis) > 0.6 && !lock) {
      if (this.repeat <= 0) {
        stick = Math.sign(axis);
        this.repeat = 0.22;
      }
    } else if (Math.abs(axis) < 0.3) this.repeat = 0;

    const prevKeys = this.opts.horizontal ? ['ArrowLeft', 'KeyA'] : ['ArrowUp', 'KeyW'];
    const nextKeys = this.opts.horizontal ? ['ArrowRight', 'KeyD'] : ['ArrowDown', 'KeyS'];
    const prevPad = this.opts.horizontal ? 14 : 12;
    const nextPad = this.opts.horizontal ? 15 : 13;
    const cols = this.opts.columns ?? 1;
    if (cols > 1) {
      // Grids: up/down go to the nearest item on screen in that direction, so rows of any length work.
      if (prevKeys.some(k) || pad(prevPad) || stick < 0) this.setFocus(this.nearestVertical(-1));
      if (nextKeys.some(k) || pad(nextPad) || stick > 0) this.setFocus(this.nearestVertical(1));
    } else {
      if (prevKeys.some(k) || pad(prevPad) || stick < 0) this.setFocus(Math.max(0, this.focus - cols));
      if (nextKeys.some(k) || pad(nextPad) || stick > 0) this.setFocus(Math.min(this.items.length - 1, this.focus + cols));
    }
    if (cols > 1) {
      // Grid: left/right step one item.
      if (k('ArrowLeft') || k('KeyA') || pad(14)) this.setFocus(this.focus - 1);
      if (k('ArrowRight') || k('KeyD') || pad(15)) this.setFocus(this.focus + 1);
    }

    const el = this.items[this.focus];
    // Sliders: adjust with the cross axis (left/right in a vertical menu).
    if (el instanceof HTMLInputElement && el.type === 'range' && !this.opts.horizontal && cols === 1) {
      let d = 0;
      if (k('ArrowLeft') || k('KeyA') || pad(14)) d = -1;
      if (k('ArrowRight') || k('KeyD') || pad(15)) d = 1;
      if (input.device === 'pad' && Math.abs(cross) > 0.6 && this.repeat <= 0) {
        d = Math.sign(cross);
        this.repeat = 0.12;
      }
      if (d !== 0) {
        el.value = String(Number(el.value) + d * Number(el.step || 1));
        el.dispatchEvent(new Event('input', { bubbles: true })); // ticks via the input listener
      }
    } else if (k('Enter') || k('Space') || pad(0)) {
      el.click();
    }
    if ((k('Escape') || k('Backspace') || pad(1)) && this.opts.onBack) {
      sfx.menuBack();
      this.opts.onBack();
    }
  }
}
