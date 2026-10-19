import { binds, type Action } from './keybinds';

/**
 * Unified input for keyboard+mouse and gamepad (twin-stick).
 * Tracks which device was used last so the game can switch aim modes.
 */
export type Device = 'kbm' | 'pad';

/** On-screen touch controls feed this; it is merged into the gamepad state each poll. */
export interface VirtualPad {
  active: boolean;
  move: Vec2;
  aim: Vec2;
  /** Held virtual buttons by standard gamepad index (0 = A/dash, 2 = X/charge, 5 = RB/bomb). */
  buttons: boolean[];
}

export interface Vec2 {
  x: number;
  y: number;
}

const STICK_DEADZONE = 0.2;
const AIM_DEADZONE = 0.35;

export function applyDeadzone(x: number, y: number, dz: number, out: Vec2): Vec2 {
  const len = Math.hypot(x, y);
  if (len < dz) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  // Rescale so movement starts from 0 just outside the deadzone.
  const scaled = Math.min(1, (len - dz) / (1 - dz)) / len;
  out.x = x * scaled;
  out.y = y * scaled;
  return out;
}

export class Input {
  device: Device = 'kbm';

  /** Mouse position in canvas pixels (CSS px) and normalized device coords. */
  readonly mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, inside: false };
  readonly move: Vec2 = { x: 0, y: 0 };
  /** Right-stick aim direction (screen space, y down). Zero when stick is idle. */
  readonly padAim: Vec2 = { x: 0, y: 0 };

  private accessiblePresses = new Set<Action>();
  pressAction(a: Action): void { this.accessiblePresses.add(a); }

  private keys = new Set<string>();
  private pressed = new Set<string>();
  private mouseButtons = 0;
  private mousePressedBits = 0;
  private padButtons: boolean[] = [];
  private padPressed = new Set<number>();
  private tmp: Vec2 = { x: 0, y: 0 };
  readonly virtual: VirtualPad = { active: false, move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, buttons: [] };
  /** Controller vibration on/off (settings). */
  rumbleOn = true;
  /** Which gamepad this Input reads: -1 = the first connected, -2 = none, n = Gamepad.index n (local co-op, src/core/padInput.ts). */
  padIndex = -1;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      // Let text fields (save import) receive typing without moving the game.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text'))) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.device = 'kbm';
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    window.addEventListener('mousemove', (e) => {
      this.setMouse(e.clientX, e.clientY);
      this.device = 'kbm';
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseButtons |= 1 << e.button;
      this.mousePressedBits |= 1 << e.button;
      this.device = 'kbm';
    });
    window.addEventListener('mouseup', (e) => (this.mouseButtons &= ~(1 << e.button)));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mouseleave', () => (this.mouse.inside = false));
    canvas.addEventListener('mouseenter', () => (this.mouse.inside = true));
  }

  private setMouse(cx: number, cy: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = cx - r.left;
    this.mouse.y = cy - r.top;
    this.mouse.ndcX = (this.mouse.x / r.width) * 2 - 1;
    this.mouse.ndcY = -(this.mouse.y / r.height) * 2 + 1;
    this.mouse.inside = true;
  }

  key(code: string): boolean {
    return this.keys.has(code);
  }

  /** True only on the update the key went down. */
  keyPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** A rebindable action went down this step. */
  actionPressed(a: Action): boolean {
    return this.accessiblePresses.has(a) || binds[a].some((c) => c && this.pressed.has(c));
  }

  actionDown(a: Action): boolean {
    return binds[a].some((c) => c && this.keys.has(c));
  }

  /** Buzz the gamepad, if it can. `strong`/`weak` 0..1. */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.rumbleOn || this.device !== 'pad') return;
    const pads = navigator.getGamepads?.() ?? [];
    const pad = this.pickPad(pads) as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | undefined;
    void pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch?.(() => {});
  }

  /** Switch which pad this Input reads (see padIndex). Buttons already held on it don't count as new presses. */
  usePad(index: number): void {
    if (index === this.padIndex) return;
    this.padIndex = index;
    const pad = this.pickPad(navigator.getGamepads?.() ?? []);
    this.padButtons = pad ? Array.from(pad.buttons, (b) => b.pressed) : [];
  }

  private pickPad(pads: ArrayLike<Gamepad | null>): Gamepad | null | undefined {
    if (this.padIndex === -2) return null;
    if (this.padIndex >= 0) return Array.from(pads).find((p) => p && p.connected && p.index === this.padIndex);
    return Array.from(pads).find((p) => p && p.connected);
  }

  mouseDown(button = 0): boolean {
    return (this.mouseButtons & (1 << button)) !== 0;
  }

  /** True only on the update the mouse button went down. */
  mousePressed(button = 0): boolean {
    return (this.mousePressedBits & (1 << button)) !== 0;
  }

  padButton(i: number): boolean {
    return !!this.padButtons[i];
  }

  padButtonPressed(i: number): boolean {
    return this.padPressed.has(i);
  }

  /** Swallow this step's press of an action (a wheel or prompt used it, so the game doesn't). */
  consumeAction(a: Action): void {
    this.accessiblePresses.delete(a);
    for (const c of binds[a]) if (c) this.pressed.delete(c);
  }

  /** Swallow this step's press of a gamepad button. */
  consumePad(i: number): void {
    this.padPressed.delete(i);
  }

  /** Call once per simulation step, before game logic. */
  poll(): void {
    // Keyboard move
    let kx = 0;
    let ky = 0;
    if (this.actionDown('up')) ky -= 1;
    if (this.actionDown('down')) ky += 1;
    if (this.actionDown('left')) kx -= 1;
    if (this.actionDown('right')) kx += 1;
    const kl = Math.hypot(kx, ky);
    this.move.x = kl > 0 ? kx / kl : 0;
    this.move.y = kl > 0 ? ky / kl : 0;
    this.padAim.x = 0;
    this.padAim.y = 0;
    this.padPressed.clear();

    // Gamepad (first connected, or the one padIndex names; standard mapping)
    const pads = navigator.getGamepads?.() ?? [];
    const pad = this.pickPad(pads);
    if (!pad) this.padButtons.fill(false); // Release virtual buttons and disconnected controllers.
    if (pad) {
      const m = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEADZONE, this.tmp);
      if (m.x !== 0 || m.y !== 0) {
        this.device = 'pad';
        if (kl === 0) {
          this.move.x = m.x;
          this.move.y = m.y;
        }
      }
      const a = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, AIM_DEADZONE, this.tmp);
      if (a.x !== 0 || a.y !== 0) {
        this.device = 'pad';
        const al = Math.hypot(a.x, a.y);
        this.padAim.x = a.x / al;
        this.padAim.y = a.y / al;
      }
      pad.buttons.forEach((b, i) => {
        if (b.pressed && !this.padButtons[i]) {
          this.padPressed.add(i);
          this.device = 'pad';
        }
        this.padButtons[i] = b.pressed;
      });
    }

    // Touch controls behave like a gamepad.
    const v = this.virtual;
    if (v.active) {
      if (v.move.x !== 0 || v.move.y !== 0) {
        this.device = 'pad';
        if (kl === 0) {
          this.move.x = v.move.x;
          this.move.y = v.move.y;
        }
      }
      if (v.aim.x !== 0 || v.aim.y !== 0) {
        this.device = 'pad';
        this.padAim.x = v.aim.x;
        this.padAim.y = v.aim.y;
      }
      v.buttons.forEach((down, i) => {
        if (down && !this.vPrev[i]) this.padPressed.add(i);
        if (down) {
          this.padButtons[i] = true;
          this.device = 'pad';
        }
        this.vPrev[i] = down;
      });
    }
  }

  private vPrev: boolean[] = [];

  /** Call at the end of each simulation step. */
  endStep(): void {
    this.accessiblePresses.clear();
    this.pressed.clear();
    this.mousePressedBits = 0;
  }
}
