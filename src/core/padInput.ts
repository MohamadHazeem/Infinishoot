import type { Action } from './keybinds';
import { applyDeadzone, type Device, type Input, type Vec2, type VirtualPad } from './input';

/**
 * One gamepad's state for shared-screen local co-op (src/game/systems/localCoop.ts).
 * It has the same public surface as Input, so a pad player's hero runs through
 * the normal hero update (movement, aim, dash, fire, charge, special, parry...)
 * with this in place of the keyboard/mouse Input. Keys and the mouse always
 * read as idle: only player 1 uses the keyboard.
 */
const STICK_DEADZONE = 0.2;
const AIM_DEADZONE = 0.35;

export type PadSource = () => ArrayLike<Gamepad | null>;

export const browserPads: PadSource = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []);

export class PadInput {
  private accessiblePresses = new Set<Action>();
  pressAction(a: Action): void { this.accessiblePresses.add(a); }
  readonly device: Device = 'pad';
  readonly mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, inside: false };
  readonly move: Vec2 = { x: 0, y: 0 };
  readonly padAim: Vec2 = { x: 0, y: 0 };
  readonly virtual: VirtualPad = { active: false, move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, buttons: [] };
  rumbleOn = true;
  /** Was the pad there on the last poll? */
  connected = false;
  private buttons: boolean[] = [];
  private pressed = new Set<number>();
  private tmp: Vec2 = { x: 0, y: 0 };

  constructor(
    /** The browser's gamepad index (Gamepad.index). */
    readonly index: number,
    private source: PadSource = browserPads,
  ) {}

  /** Read the pad (once per simulation step). Presses are edges since the last poll. */
  poll(): void {
    this.accessiblePresses.clear();
    this.pressed.clear();
    const pad = this.source()[this.index];
    this.connected = !!pad && pad.connected !== false;
    if (!pad || !this.connected) {
      this.move.x = this.move.y = this.padAim.x = this.padAim.y = 0;
      this.buttons.length = 0;
      return;
    }
    const m = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEADZONE, this.tmp);
    this.move.x = m.x;
    this.move.y = m.y;
    // D-pad moves too when the stick is idle (menus and touchy sticks).
    if (m.x === 0 && m.y === 0) {
      const dx = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
      const dy = (pad.buttons[13]?.pressed ? 1 : 0) - (pad.buttons[12]?.pressed ? 1 : 0);
      const l = Math.hypot(dx, dy);
      if (l) {
        this.move.x = dx / l;
        this.move.y = dy / l;
      }
    }
    const a = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, AIM_DEADZONE, this.tmp);
    const al = Math.hypot(a.x, a.y);
    this.padAim.x = al ? a.x / al : 0;
    this.padAim.y = al ? a.y / al : 0;
    for (let i = 0; i < pad.buttons.length; i++) {
      const down = !!pad.buttons[i]?.pressed;
      if (down && !this.buttons[i]) this.pressed.add(i);
      this.buttons[i] = down;
    }
  }

  key(): boolean {
    return false;
  }
  keyPressed(): boolean {
    return false;
  }
  actionPressed(a: Action): boolean {
    return this.accessiblePresses.has(a);
  }
  consumeAction(a: Action): void { this.accessiblePresses.delete(a); }
  consumePad(i: number): void { this.pressed.delete(i); }
  actionDown(): boolean {
    return false;
  }
  mouseDown(): boolean {
    return false;
  }
  mousePressed(): boolean {
    return false;
  }
  padButton(i: number): boolean {
    return !!this.buttons[i];
  }
  padButtonPressed(i: number): boolean {
    return this.pressed.has(i);
  }

  rumble(strong: number, weak: number, ms: number): void {
    if (!this.rumbleOn) return;
    const pad = this.source()[this.index] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null;
    void pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch?.(() => {});
  }

  endStep(): void {
    this.accessiblePresses.clear();
    this.pressed.clear();
  }

  /** Stand in for the shared Input (same public members; keys and mouse read idle). */
  asInput(): Input {
    return this as unknown as Input;
  }
}

/** Indices of connected pads whose button `b` went down since `prev` (join screens). */
export function padEdges(source: PadSource, prev: Map<number, boolean[]>): { index: number; pressed: number[]; move: Vec2 }[] {
  const out: { index: number; pressed: number[]; move: Vec2 }[] = [];
  const pads = source();
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (!p || p.connected === false) continue;
    const was = prev.get(p.index ?? i) ?? [];
    const now = Array.from(p.buttons, (b) => !!b?.pressed);
    const pressed: number[] = [];
    now.forEach((d, k) => d && !was[k] && pressed.push(k));
    prev.set(p.index ?? i, now);
    const mv = applyDeadzone(p.axes[0] ?? 0, p.axes[1] ?? 0, 0.5, { x: 0, y: 0 });
    out.push({ index: p.index ?? i, pressed, move: { x: mv.x, y: mv.y } });
  }
  return out;
}
