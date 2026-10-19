import { loadJson, saveJson } from './storage';

/**
 * Rebindable keyboard controls: each action has two key slots. Mouse buttons
 * and the gamepad keep their fixed layout. Escape always pauses and backs out
 * of menus, whatever is bound.
 */
export type Action = 'up' | 'down' | 'left' | 'right' | 'dash' | 'bomb' | 'pause' | 'autofire' | 'reroll' | 'ping' | 'parry' | 'ult';

export const ACTIONS: { id: Action; name: string }[] = [
  { id: 'up', name: 'Move up' },
  { id: 'down', name: 'Move down' },
  { id: 'left', name: 'Move left' },
  { id: 'right', name: 'Move right' },
  { id: 'dash', name: 'Dash' },
  { id: 'bomb', name: 'Special' },
  { id: 'parry', name: 'Parry' },
  { id: 'ult', name: 'Ultimate' },
  { id: 'pause', name: 'Pause' },
  { id: 'autofire', name: 'Auto-fire' },
  { id: 'reroll', name: 'Reroll cards' },
  { id: 'ping', name: 'Ping (co-op)' },
];

const DEFAULTS: Record<Action, [string, string]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  dash: ['Space', 'ShiftLeft'],
  bomb: ['KeyQ', 'KeyE'],
  parry: ['KeyC', ''],
  ult: ['KeyV', ''],
  pause: ['KeyP', ''],
  autofire: ['KeyF', ''],
  reroll: ['KeyR', ''],
  ping: ['KeyG', ''],
};

/** Gamepad buttons (standard mapping) for the skill actions: B parries; L3, R3 or D-pad up fires the ultimate. */
export const PAD_PARRY = [1];
export const PAD_ULT = [10, 11, 12];

const KEY = 'keys.v1';

export const binds: Record<Action, [string, string]> = { ...DEFAULTS, ...loadJson<Partial<Record<Action, [string, string]>>>(KEY, {}) };

export function rebind(a: Action, slot: 0 | 1, code: string): void {
  // A key belongs to one action: clear it anywhere else first.
  for (const k of Object.keys(binds) as Action[]) {
    binds[k] = binds[k].map((c) => (c === code ? '' : c)) as [string, string];
  }
  binds[a][slot] = code;
  saveJson(KEY, binds);
}

export function resetBinds(): void {
  for (const k of Object.keys(DEFAULTS) as Action[]) binds[k] = [...DEFAULTS[k]];
  saveJson(KEY, binds);
}

/** "KeyQ" -> "Q", "ArrowUp" -> "UP", "ShiftLeft" -> "L-SHIFT". */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  const map: Record<string, string> = { ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT', Space: 'SPACE', Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP' };
  return map[code] ?? code.toUpperCase();
}
