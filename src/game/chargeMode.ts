import type { Input } from '../core/input';
import { settings } from './settings';

/**
 * SETTINGS > CHARGE MODE (accessibility): the right click (pad X, the touch
 * R-CLICK button) is either held, or pressed once to start and again to let
 * go. Right-click weapons only ever see "held or not" (`ctx.charging`), so
 * every weapon, the netcode and the dev bot work unchanged in both modes.
 */
export class ChargeLatch {
  private latched = false;
  private wasDown = false;

  /**
   * One simulation step. `down`: the button is held now; `pressed`: it went
   * down this step (catches clicks shorter than a step). Returns whether the
   * right click counts as held.
   */
  update(mode: 'hold' | 'toggle', down: boolean, pressed: boolean, control: boolean): boolean {
    const edge = pressed || (down && !this.wasDown);
    this.wasDown = down;
    if (!control || mode !== 'toggle') {
      this.latched = false;
      return control && down;
    }
    if (edge) this.latched = !this.latched;
    return this.latched;
  }

  reset(): void {
    this.latched = this.wasDown = false;
  }
}

/** Each local controller has its own latch (including shared-screen co-op). */
const chargeLatches = new WeakMap<Input, ChargeLatch>();

/** Right click held for this step, honouring CHARGE MODE. Call once per step for the local hero. */
export function rightClickHeld(input: Input, control: boolean): boolean {
  let latch = chargeLatches.get(input);
  if (!latch) { latch = new ChargeLatch(); chargeLatches.set(input, latch); }
  return latch.update(settings.chargeMode, input.mouseDown(2) || input.padButton(2), input.mousePressed(2) || input.padButtonPressed(2), control);
}
