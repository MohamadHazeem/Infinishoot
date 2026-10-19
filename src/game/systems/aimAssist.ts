import type { Game } from '../game';
import type { Hero } from '../hero';
import type { Input } from '../../core/input';
import { PAD_REWIND, PAD_TEAM, type Action } from '../../core/keybinds';
import { settings } from '../settings';
import { rightClickHeld } from '../chargeMode';
import { segmentHitsBox } from '../enemies';

export const aimAssistTuning = { range: 12, coneDegrees: 25, strength: 0.28, holdSeconds: 0.35 };

/** Allocation-free soft snap. Mouse retains its ground targeting distance. Host receives the
 * resulting ordinary aim input; no settings, targets or new messages cross the network. */
export function assistAim(this: Game, h: Hero, input: Input): void {
  if (input.device === 'pad' ? !settings.aimAssist : !settings.mouseAimAssist) return;
  // Only help deliberate aiming, not movement-stick steering or an idle mouse.
  if (input.device === 'pad' && input.padAim.x === 0 && input.padAim.y === 0 && !input.padButton(7) && !input.padButton(2)) return;
  const p = h.player;
  let best = aimAssistTuning.range ** 2;
  let tx = 0, tz = 0;
  let found = false;
  const cone = Math.cos(aimAssistTuning.coneDegrees * Math.PI / 180);
  for (const e of this.enemies.list) {
    if (!e.alive || e.def.hidden) continue;
    const dx = e.x - p.x, dz = e.z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.0001 || d2 > best) continue;
    const distance = Math.sqrt(d2), nx = dx / distance, nz = dz / distance;
    if (nx * p.aim.x + nz * p.aim.z < cone) continue;
    let blocked = false;
    for (const box of this.arena.colliders) {
      if (segmentHitsBox(p.x, p.z, nx, nz, distance, 0, box)) { blocked = true; break; }
    }
    if (blocked) continue;
    best = d2; tx = nx; tz = nz; found = true;
  }
  if (!found) return;
  const k = aimAssistTuning.strength;
  p.setAimDir(p.aim.x * (1 - k) + tx * k, p.aim.z * (1 - k) + tz * k, p.aimDist);
}

/** Hold confirmation fires once until released. Toggle for one-shot actions means a
 * single press. Dash uses a true on/off latch because it can repeat while running. */
export class AccessibleAction {
  private held = 0;
  private fired = false;
  private latched = false;
  private wasDown = false;
  private mode = '';
  update(mode: 'hold' | 'toggle', down: boolean, pressed: boolean, enabled: boolean, dt: number, repeat = false): boolean {
    const edge = pressed || (down && !this.wasDown);
    this.wasDown = down;
    if (!enabled || this.mode !== mode) { this.held = 0; this.fired = false; this.latched = false; }
    this.mode = mode;
    if (!enabled) return false;
    if (!down) { this.held = 0; this.fired = false; }
    if (repeat) {
      if (mode === 'hold') return down || pressed;
      if (edge) this.latched = !this.latched;
      return this.latched;
    }
    if (mode === 'toggle') return edge;
    if (!down || this.fired) return false;
    this.held += Math.max(0, dt);
    if (this.held + 1e-8 < aimAssistTuning.holdSeconds) return false;
    this.fired = true;
    return true;
  }
}
const states = new WeakMap<Input, { dash: AccessibleAction; rewind: AccessibleAction; team: AccessibleAction; stage: number }>();
const DASH_BUTTONS = [4, 6, 0];
const ACTIONS = ['dash', 'rewind', 'team'] as const;
const BUTTONS = { dash: DASH_BUTTONS, rewind: PAD_REWIND, team: PAD_TEAM };

/** Called before all local action consumers, on solo, host and client. Menus retain raw
 * pad presses. Input edges are rewritten, never gameplay state or another hero's input. */
export function accessibilityInput(input: Input, enabled: boolean, dt: number, stage: number, dead = false): void {
  let s = states.get(input);
  if (!s) { s = { dash: new AccessibleAction(), rewind: new AccessibleAction(), team: new AccessibleAction(), stage }; states.set(input, s); }
  const sameStage = s.stage === stage;
  s.stage = stage;
  if (!enabled || dead || !sameStage) rightClickHeld(input, false);
  for (const action of ACTIONS) {
    let down = input.actionDown(action), pressed = input.actionPressed(action);
    for (const b of BUTTONS[action]) { down ||= input.padButton(b); pressed ||= input.padButtonPressed(b); }
    const mode = action === 'dash' ? settings.dashRunMode : action === 'rewind' ? settings.rewindMode : settings.teamMoveMode;
    const fire = s[action].update(mode, down, pressed, enabled && sameStage && (action === 'team' || !dead), dt, action === 'dash');
    if (!enabled || (dead && action !== 'team')) continue;
    input.consumeAction(action);
    for (const b of BUTTONS[action]) input.consumePad(b);
    if (fire) input.pressAction(action as Action);
  }
}
