import { binds, keyLabel, type Action } from '../core/keybinds';
import type { Input } from '../core/input';

/**
 * Button prompts that follow the last used device. Keyboard prompts show the
 * current rebinds (src/core/keybinds.ts); with a gamepad they become pixel-art
 * Xbox or PlayStation glyphs, picked from the Gamepad id. Touch hides them
 * (the on-screen buttons are labelled already).
 *
 * Markup: anything with `data-prompt="<id>"` is re-rendered when the device,
 * the pad family or the binds change. Build it with `prompt(id)` (an inline
 * <kbd>) or put `data-prompt` on your own element and fill it with
 * `promptHtml(id)`. Text-only places (tooltips, labels) use `promptText(id)`.
 */

export type PadFamily = 'xbox' | 'ps';
export type PromptMode = 'kbm' | PadFamily | 'touch';

/** Live prompt state. `force` pins a mode (test links `pad=xbox|ps|kbm`). */
export const promptState: { mode: PromptMode; family: PadFamily; force: PromptMode | null } = { mode: 'kbm', family: 'xbox', force: null };

/** Xbox is the default; Sony pads (DualShock, DualSense, vendor 054c) get PlayStation glyphs. */
export function padFamily(id: string): PadFamily {
  return /054c|sony|playstation|dualshock|dualsense|\bps[345]\b/i.test(id) ? 'ps' : 'xbox';
}

/** Which prompts to show: keyboard/mouse, a pad family, or touch (no real pad but the touch sticks drive input). */
export function promptModeFor(device: 'kbm' | 'pad', padId: string | null): PromptMode {
  if (device === 'kbm') return 'kbm';
  return padId === null ? 'touch' : padFamily(padId);
}

// ---------------------------------------------------------------- glyphs

/** Standard-mapping button index -> glyph name. */
type PadBtn = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 14 | 'ls' | 'rs';

const FACE: Record<PadFamily, { body: string[]; mark: string[]; shapes: string[][] }> = {
  // A, B, X, Y: coloured buttons with a letter.
  xbox: {
    body: ['#38b764', '#b13e53', '#3b5dc9', '#ffcd75'],
    mark: ['#f4f4f4', '#f4f4f4', '#f4f4f4', '#1a1c2c'],
    shapes: [
      ['.#.', '#.#', '###', '#.#', '#.#'],
      ['##.', '#.#', '##.', '#.#', '##.'],
      ['#.#', '#.#', '.#.', '#.#', '#.#'],
      ['#.#', '#.#', '.#.', '.#.', '.#.'],
    ],
  },
  // Cross, circle, square, triangle: light buttons with coloured symbols.
  ps: {
    body: ['#f4f4f4', '#f4f4f4', '#f4f4f4', '#f4f4f4'],
    mark: ['#3b5dc9', '#b13e53', '#5d275d', '#38b764'],
    shapes: [
      ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
      ['.###.', '#...#', '#...#', '#...#', '.###.'],
      ['#####', '#...#', '#...#', '#...#', '#####'],
      ['..#..', '.#.#.', '.#.#.', '#...#', '#####'],
    ],
  },
};

const ROUND = ['..#####..', '.#ooooo#.', '#ooooooo#', '#ooooooo#', '#ooooooo#', '#ooooooo#', '#ooooooo#', '.#ooooo#.', '..#####..'];
const DPAD = ['...###...', '...#o#...', '...#o#...', '####o####', '#ooooooo#', '####o####', '...#o#...', '...#o#...', '...###...'];
const MOUSE = ['.#####.', '#..#..#', '#..#..#', '#######', '#.....#', '#.....#', '#.....#', '.#####.'];

const NAMES: Record<PadFamily, Record<string, string>> = {
  xbox: { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 8: 'VIEW', 9: 'MENU', 10: 'LS', 11: 'RS', 12: 'D-UP', 14: 'D-LEFT', ls: 'L-STICK', rs: 'R-STICK' },
  ps: { 0: 'CROSS', 1: 'CIRCLE', 2: 'SQUARE', 3: 'TRIANGLE', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'SHARE', 9: 'OPTIONS', 10: 'L3', 11: 'R3', 12: 'D-UP', 14: 'D-LEFT', ls: 'L-STICK', rs: 'R-STICK' },
};

const rect = (x: number, y: number, c: string) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;

function svg(rows: string[], paint: (ch: string, x: number, y: number) => string | null, extra = ''): string {
  let r = '';
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = paint(ch, x, y);
    if (c) r += rect(x, y, c);
  }));
  return `<svg class="pg" viewBox="0 0 ${rows[0].length} ${rows.length}" width="${rows[0].length * 2}" height="${rows.length * 2}" shape-rendering="crispEdges" aria-hidden="true">${r}${extra}</svg>`;
}

/** Pixel glyph for one pad button in a family (face buttons and the D-pad are sprites, the rest are labelled caps). */
export function padGlyph(fam: PadFamily, b: PadBtn): string {
  if (typeof b === 'number' && b <= 3) {
    const f = FACE[fam];
    const shape = f.shapes[b];
    const ox = Math.floor((9 - shape[0].length) / 2);
    const marks = shape.flatMap((row, y) => [...row].map((ch, x) => (ch === '#' ? rect(ox + x, 2 + y, f.mark[b]) : ''))).join('');
    return `<span class="pad-face" title="${NAMES[fam][b]}">${svg(ROUND, (ch) => (ch === '#' ? '#1a1c2c' : ch === 'o' ? f.body[b] : null), marks)}</span>`;
  }
  if (b === 12) return svg(DPAD, (ch, x, y) => (ch === '#' ? '#1a1c2c' : ch === 'o' ? (y < 4 && x === 4 ? '#ffcd75' : '#566c86') : null));
  if (b === 14) return svg(DPAD, (ch, x, y) => (ch === '#' ? '#1a1c2c' : ch === 'o' ? (x < 4 && y === 4 ? '#ffcd75' : '#566c86') : null));
  return `<span class="kc pad">${NAMES[fam][b]}</span>`;
}

const mouseGlyph = (button: 'l' | 'r') =>
  `<span class="kc mouse">${svg(MOUSE, (ch, x, y) => (ch === '#' ? '#1a1c2c' : y < 3 && ((button === 'l' && x > 0 && x < 3) || (button === 'r' && x > 3 && x < 6)) ? '#ef7d57' : ch === '.' && y > 0 && y < 7 && x > 0 && x < 6 ? '#f4f4f4' : null))}</span>`;

const cap = (label: string) => `<span class="kc">${label}</span>`;

// ---------------------------------------------------------------- prompts

/** Things a prompt can point at: rebindable actions plus fixed mouse/menu inputs. */
export type PromptId = Action | 'move' | 'aim' | 'fire' | 'charge' | 'confirm' | 'back' | 'switch';

/** Gamepad button shown for each prompt (matches the fixed pad layout in game.ts / skill.ts / menu.ts). */
const PAD_OF: Partial<Record<PromptId, PadBtn>> = {
  dash: 4,
  bomb: 5,
  parry: 1,
  ult: 11,
  rewind: 14,
  pause: 9,
  reroll: 3,
  ping: 8,
  charge: 2,
  fire: 7,
  confirm: 0,
  back: 1,
  switch: 0,
  move: 'ls',
  aim: 'rs',
  up: 12,
};

function keys(a: Action): string[] {
  return binds[a].filter(Boolean).map(keyLabel);
}

/** Keyboard/mouse prompt pieces for an id (labels, already following the rebinds). */
function kbmLabels(id: PromptId): string[] {
  switch (id) {
    case 'move': {
      const k = (['up', 'left', 'down', 'right'] as const).map((a) => keyLabel(binds[a][0] || binds[a][1]));
      return k.every((x) => x.length === 1) ? [k.join('')] : k;
    }
    case 'aim':
      return ['MOUSE'];
    case 'fire':
      return ['LMB'];
    case 'charge':
      return ['RMB'];
    case 'confirm':
      return ['ENTER'];
    case 'back':
      return ['ESC'];
    case 'switch':
      return ['CLICK'];
    case 'pause':
      return ['ESC'];
    default:
      return keys(id).slice(0, 1);
  }
}

/** Plain-text prompt for tooltips and labels ("Q/E", "RB", "R1"). */
export function promptText(id: PromptId, mode: PromptMode = promptState.mode): string {
  if (mode === 'xbox' || mode === 'ps') {
    const b = PAD_OF[id];
    return b === undefined ? '' : NAMES[mode][b];
  }
  if (id === 'bomb') return keys('bomb').join('/') || '—';
  return kbmLabels(id).join('/') || '—';
}

/** The control lines shown on the title screen, per device. */
function controlsLine(mode: PromptMode): string {
  const rows: [PromptId, string][] = [
    ['move', 'move'],
    ['aim', 'aim'],
    ['fire', 'shoot'],
    ['charge', 'right-click weapon'],
    ['dash', 'dash'],
    ['bomb', 'special'],
    ['parry', 'parry'],
    ['ult', 'ultimate'],
    ['rewind', 'rewind'],
    ['ping', 'ping'],
    ['pause', 'pause'],
  ];
  return rows.map(([id, what]) => `<span class="ctl">${promptHtml(id, mode)} ${what}</span>`).join(' ');
}

/** Gamepad layout legend (CONTROLS screen): every fixed pad button and what it does, in the last seen family. */
function padLegend(fam: PadFamily): string {
  const rows: [PadBtn[], string][] = [
    [['ls'], 'Move'],
    [['rs', 7], 'Aim and shoot'],
    [[2], 'Right-click weapon (hold)'],
    [[4, 6, 0], 'Dash'],
    [[5, 3], 'Special'],
    [[1], 'Parry'],
    [[11, 10, 12], 'Ultimate'],
    [[14], 'Rewind time'],
    [[8], 'Ping'],
    [[9], 'Pause'],
  ];
  return rows.map(([bs, what]) => `<div class="pl-row"><span class="pl-btn">${bs.map((b) => padGlyph(fam, b)).join('')}</span><span>${what}</span></div>`).join('');
}

/** Prompt markup for an id in a mode. Ids with arguments: "pick:<n>" (level-up card key). */
export function promptHtml(id: string, mode: PromptMode = promptState.mode): string {
  if (id === 'controls') return controlsLine(mode);
  if (id === 'padlegend') return padLegend(mode === 'ps' || mode === 'xbox' ? mode : promptState.family);
  if (id.startsWith('pick:')) return mode === 'xbox' || mode === 'ps' ? padGlyph(mode, 0) : id.slice(5);
  const pid = id as PromptId;
  if (mode === 'touch') return '';
  if (mode === 'xbox' || mode === 'ps') {
    const b = PAD_OF[pid];
    return b === undefined ? '' : padGlyph(mode, b);
  }
  if (pid === 'fire') return mouseGlyph('l');
  if (pid === 'charge') return mouseGlyph('r');
  return kbmLabels(pid).map(cap).join('');
}

/** An inline prompt element that keeps itself up to date. */
export function prompt(id: string, cls = ''): string {
  return `<kbd class="prompt ${cls}" data-prompt="${id}">${promptHtml(id)}</kbd>`;
}

// ---------------------------------------------------------------- live switching

let lastKey = '';
let checkT = 0;
let bindsKey = '';
let padId: string | null = null;

const bindsSig = () => (Object.keys(binds) as Action[]).map((a) => binds[a].join('+')).join(',');

/** Re-render every `[data-prompt]` element under `root`. */
export function refreshPrompts(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-prompt]').forEach((el) => {
    el.innerHTML = promptHtml(el.dataset.prompt!);
  });
}

/** Mark the body with the prompt mode so CSS can switch layouts (`input-kbm`, `input-pad`, `pad-xbox`, `pad-ps`, `input-touch`). */
function applyBodyClass(mode: PromptMode): void {
  const b = document.body.classList;
  b.toggle('input-kbm', mode === 'kbm');
  b.toggle('input-pad', mode === 'xbox' || mode === 'ps');
  b.toggle('pad-xbox', mode === 'xbox');
  b.toggle('pad-ps', mode === 'ps');
  b.toggle('input-touch', mode === 'touch');
}

/** First connected real gamepad's id (touch fills Input.virtual, not navigator.getGamepads). */
function connectedPadId(): string | null {
  const pads = typeof navigator !== 'undefined' ? (navigator.getGamepads?.() ?? []) : [];
  for (const p of Array.from(pads)) if (p && p.connected) return p.id;
  return null;
}

/** Call once per rendered frame: follows the last used device and re-renders prompts when anything changed. */
export function syncPrompts(input: Input, frameDt: number): void {
  checkT -= frameDt;
  // Binds only change on the CONTROLS screen and pads rarely come and go: look a few times a second.
  if (checkT <= 0) {
    checkT = 0.25;
    bindsKey = bindsSig();
    padId = connectedPadId();
  }
  if (input.device === 'pad' && padId === null) padId = connectedPadId(); // a pad's first press: don't wait for the next look
  let mode: PromptMode;
  if (promptState.force) mode = promptState.force;
  // Once the touch controls are up (and no real pad is connected) stay on touch: taps also fire mouse events.
  else if (input.virtual.active && padId === null) mode = 'touch';
  else mode = promptModeFor(input.device, padId);
  if (mode === 'xbox' || mode === 'ps') promptState.family = mode;
  const key = mode + '|' + bindsKey;
  if (key === lastKey) return;
  lastKey = key;
  promptState.mode = mode;
  applyBodyClass(mode);
  refreshPrompts();
}
