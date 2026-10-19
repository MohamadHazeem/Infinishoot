/**
 * Playable title screen (cinematics lane). The attract demo behind the title
 * (src/game/systems/attract.ts) hands its hero to the player the moment they
 * move or aim it, and takes it back after `titlePlayTuning.idle` seconds
 * without input. Nothing is saved or counted: the demo's profile lock and
 * muted hooks stay on.
 *
 * Input sharing on the title screen:
 * - the hero: move keys (WASD, minus any arrow keys bound to moving) and the
 *   left stick; aim with the mouse or the right stick; fire with a click on
 *   the backdrop (not on a menu button), the right stick or RT; right click / X
 *   charges; dash on Space / Shift / LB / LT; special, parry and ultimate on
 *   their usual keys and buttons.
 * - the menu: arrow keys, D-pad, Enter and A (and the mouse on the buttons).
 *   While the demo listens, MenuNav ignores W/A/S/D, Space and the left stick
 *   (`navLock`), and the hero ignores the arrows, D-pad, A, B and Start.
 */
import type { Input } from '../core/input';
import { binds, type Action } from '../core/keybinds';
import { titlePlayTuning } from './cinematics';

/** Read by MenuNav: true while the title demo takes WASD, Space and the left stick. */
export const navLock = { move: false };

/** Menu-only pad buttons the hero never sees on the title: A, B, View, Start, the D-pad. */
const MENU_PAD = new Set([0, 1, 8, 9, 12, 13, 14, 15]);
const MENU_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace', 'Tab']);
/** Actions the title hero may use (no pause, rewind, reroll, ping, cash-ins). */
const HERO_ACTIONS = new Set<Action>(['dash', 'bomb', 'parry', 'ult']);

const mouse = { down: 0, pressed: 0 };
let wired = false;

/** Clicks on the title backdrop (not its buttons) fire; listened for once. */
function wire(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  const onMenu = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('button, [data-nav], input, select, a, label, .hiscores, #cine .cn-skip');
  window.addEventListener('mousedown', (e) => {
    if (!navLock.move || onMenu(e.target)) return;
    mouse.down |= 1 << e.button;
    mouse.pressed |= 1 << e.button;
  });
  window.addEventListener('mouseup', (e) => (mouse.down &= ~(1 << e.button)));
  window.addEventListener('blur', () => (mouse.down = 0));
}

/** Move keys held, without the arrow keys (they belong to the menu here). */
function heroMove(real: Input, out: { x: number; y: number }): void {
  const held = (a: Action) => binds[a].some((c) => c && !MENU_KEYS.has(c) && real.key(c));
  let x = 0;
  let y = 0;
  if (held('up')) y -= 1;
  if (held('down')) y += 1;
  if (held('left')) x -= 1;
  if (held('right')) x += 1;
  const l = Math.hypot(x, y);
  if (l > 0) {
    out.x = x / l;
    out.y = y / l;
  } else if (real.device === 'pad') {
    // The left stick (Input.move holds it when no key is down).
    out.x = real.move.x;
    out.y = real.move.y;
  } else out.x = out.y = 0;
}

/** The real input seen through the title's sharing rules (same shape as Input for the hero code). */
export class TitleInput {
  readonly move = { x: 0, y: 0 };
  constructor(private real: Input) {}
  get device() { return this.real.device; }
  get mouse() { return this.real.mouse; }
  get padAim() { return this.real.padAim; }
  get virtual() { return this.real.virtual; }
  rumbleOn = false;
  refresh(): void {
    heroMove(this.real, this.move);
  }
  key(c: string): boolean { return !MENU_KEYS.has(c) && this.real.key(c); }
  keyPressed(c: string): boolean { return !MENU_KEYS.has(c) && this.real.keyPressed(c); }
  actionPressed(a: Action): boolean { return HERO_ACTIONS.has(a) && this.real.actionPressed(a); }
  actionDown(a: Action): boolean { return HERO_ACTIONS.has(a) && this.real.actionDown(a); }
  rumble(): void {}
  mouseDown(b = 0): boolean { return (mouse.down & (1 << b)) !== 0; }
  mousePressed(b = 0): boolean { return (mouse.pressed & (1 << b)) !== 0; }
  padButton(i: number): boolean { return !MENU_PAD.has(i) && this.real.padButton(i); }
  padButtonPressed(i: number): boolean { return !MENU_PAD.has(i) && this.real.padButtonPressed(i); }
  poll(): void {}
  endStep(): void { mouse.pressed = 0; }
}

export interface TitlePlay {
  /** The player holds the hero right now. */
  controlled: boolean;
  /** Seconds since their last input. */
  idle: number;
  input: TitleInput | null;
}

const states = new WeakMap<object, TitlePlay>();

export function titlePlayState(owner: object): TitlePlay {
  let s = states.get(owner);
  if (!s) states.set(owner, (s = { controlled: false, idle: 0, input: null }));
  return s;
}

/** Any hero input this step (taking or keeping control)? */
export function heroInputActive(ti: TitleInput, real: Input): boolean {
  ti.refresh();
  if (Math.hypot(ti.move.x, ti.move.y) > titlePlayTuning.stick) return true;
  if (real.padAim.x !== 0 || real.padAim.y !== 0) return true;
  if (ti.mouseDown(0) || ti.mouseDown(2)) return true;
  for (const b of [2, 3, 4, 5, 6, 7, 10, 11]) if (ti.padButton(b)) return true;
  for (const a of HERO_ACTIONS) if (ti.actionDown(a)) return true;
  return false;
}

/**
 * One title step: decide who drives the demo hero. Returns the player's input when they do
 * (the demo steps the simulation with it), else null (the autoplay bot drives). `listening`:
 * the demo is allowed to run right now (title showing, solo, nothing else open).
 */
export function titlePlayTick(owner: object, real: Input, dt: number, listening: boolean): TitleInput | null {
  wire();
  const s = titlePlayState(owner);
  navLock.move = listening && titlePlayTuning.enabled;
  if (!navLock.move) {
    s.controlled = false;
    s.idle = 0;
    mouse.down = mouse.pressed = 0;
    return null;
  }
  s.input ??= new TitleInput(real);
  const active = heroInputActive(s.input, real);
  if (active) {
    s.controlled = true;
    s.idle = 0;
  } else if (s.controlled && (s.idle += dt) >= titlePlayTuning.idle) s.controlled = false;
  return s.controlled ? s.input : null;
}

/** Tests: press or release the title's mouse fire. */
export function titleMouse(down: boolean, button = 0): void {
  if (down) {
    mouse.down |= 1 << button;
    mouse.pressed |= 1 << button;
  } else mouse.down &= ~(1 << button);
}
