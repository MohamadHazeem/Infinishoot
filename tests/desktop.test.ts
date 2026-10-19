import { ok } from './check';
import { availableRelease, LogRing, LOG_LIMIT, cleanText, displayOptions } from '../electron/logic.mjs';
import { FramePacer } from '../src/platform/display';

const release = (tag_name: string, flags = {}) => ({ tag_name, ...flags });
ok(availableRelease('1.6.0', release('v1.6.1'))?.url === 'https://github.com/MohamadHazeem/Infinishoot/releases/tag/v1.6.1', 'patch update links only to the trusted repository');
ok(availableRelease('1.9.9', release('v1.10.0'))?.version === '1.10.0', 'compares numeric versions rather than lexical order');
ok(availableRelease('1.99.99', release('2.0.0'))?.version === '2.0.0', 'major release');
for (const tag of ['v1.6.0', 'v1.5.99', 'v0.99.99', 'v1.6.1-beta.1', 'v01.6.1', 'v1.7', 'https://evil.test', 'v1.7.0?token=x', 'v1.7.0/../../evil']) ok(!availableRelease('1.6.0', release(tag)), `rejects stale or invalid release: ${tag}`);
for (const data of [null, {}, [], release('v2.0.0', { draft: true }), release('v2.0.0', { prerelease: true })]) ok(!availableRelease('1.6.0', data), 'rejects incomplete, draft or prerelease responses');
ok(!availableRelease('not-a-version', release('v2.0.0')), 'unknown running version never prompts an upgrade');
ok(availableRelease('1.6.0', release('v1.7.0', { html_url: 'https://evil.test' }))?.url.endsWith('/v1.7.0'), 'ignores untrusted response URLs');
const ring = new LogRing();
for (let i = 0; i < 240; i++) ring.add('error', `entry ${i}`, `time ${i}`);
ok(ring.entries.length === LOG_LIMIT && ring.entries[0].message === 'entry 40' && ring.entries[199].message === 'entry 239', 'retains exactly the newest 200 entries in order');
const restored = new LogRing(JSON.parse(JSON.stringify(ring.entries)));
ok(restored.text({ version: '1.6.0', os: 'test', settings: { vsync: true } }).includes('entry 239'), 'ring survives persistence and exports readable context');
ok(new LogRing([null, {}, { time: 'x', kind: 'error', message: 'valid' }]).entries.length === 1, 'malformed persisted entries ignored');
ok(new LogRing({ broken: true }).entries.length === 0, 'non-array persisted log ignored');
ring.add('error', 'x'.repeat(10000)); ok(ring.entries.at(-1)!.message.length === 8000, 'bounds individual entry size');
const circular: any = {}; circular.self = circular; ring.add('error', circular); ok(ring.entries.at(-1)!.message.length > 0, 'circular errors cannot crash logging');
ok(!cleanText('https://x.test/file?token=secret#room password: secret').includes('secret'), 'redacts URL queries and credentials');
ok(cleanText(new Error('boom')).includes('boom'), 'captures error stacks');
ok(displayOptions({ frameCap: 'bad', resolutionScale: NaN, windowMode: null } as any).frameCap === '60', 'corrupt display preferences use safe defaults');
ok(displayOptions({ autoUpdate: false, vsync: false, resolutionScale: 175 }).resolutionScale === 175 && !displayOptions({ autoUpdate: false }).autoUpdate, 'valid scales and opt-outs preserved');
for (const cap of [30, 60, 120, 0]) {
  const pacer = new FramePacer(); let frames = 0, elapsed = 0;
  for (let i = 0; i < 240; i++) if (pacer.ready(i * 1000 / 240, cap)) { frames++; elapsed += pacer.dt; }
  ok(Math.abs(frames - (cap || 240)) <= 1, `cap ${cap} schedules correct frame count`);
  ok(elapsed > 0.95 && elapsed < 1.01, `cap ${cap} preserves elapsed render time`);
}
const pacer = new FramePacer(); pacer.ready(0, 30);
ok(!pacer.ready(8, 30) && pacer.ready(10, 60) && pacer.ready(2000, 60), 'cap changes and resume reset pacing without catch-up bursts');

// Controller text entry uses the existing screen/navigation contract without network state.
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<body><div class="screen" id="scr-online"><input maxlength="5" value="AB"></div></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
const { promptState } = await import('../src/ui/prompts');
const { installControllerKeyboard } = await import('../src/platform/keyboard');
let selected = -1;
const screens: any = { current: 'online', addScreen: (_name: string, el: HTMLElement) => document.body.append(el), show(name: string) { this.current = name; this.onShow?.(name); }, nav: () => ({ refresh: (i: number) => { selected = i; } }) };
installControllerKeyboard(screens);
screens.show('online');
const field = document.querySelector('input')!;
ok(field.hasAttribute('data-nav'), 'legacy name/code fields become reachable by controller on screen entry');
promptState.mode = 'kbm'; field.click(); ok(screens.current === 'online', 'keyboard/mouse retain normal text entry');
promptState.mode = 'xbox'; field.click(); ok(screens.current === 'desktopKeyboard', 'controller activation opens text entry');
const keys = [...document.querySelectorAll<HTMLButtonElement>('.desktop-keys button')];
const actions = [...document.querySelectorAll<HTMLButtonElement>('.desktop-keyboard-actions button')];
keys[0].click(); keys[1].click(); keys[2].click(); keys[3].click();
let changed = 0; field.addEventListener('input', () => changed++);
actions[4].click();
ok(field.value === 'AB123' && changed === 1 && screens.current === 'online' && selected === 0, 'done honors max length, dispatches input and restores original controller focus');
field.click(); actions[2].click(); actions[3].click(); ok(field.value === 'AB123', 'cancel leaves the original field intact');
field.click(); actions[2].click(); actions[4].click(); ok(field.value === 'AB12', 'delete removes one character');

const { GameLoop } = await import('../src/core/loop');
(globalThis as any).requestAnimationFrame = () => 1;
for (const cap of [30, 60, 120, 0]) {
  let steps = 0, rendered = 0;
  const loop = new GameLoop({ update: () => { steps++; }, render: () => { rendered++; }, runHidden: () => true, frameCap: () => cap });
  // Deterministic 120 Hz display input, without starting browser workers/timers.
  (loop as any).running = true;
  for (let i = 1; i <= 120; i++) (loop as any).frame(i * 1000 / 120);
  ok(steps >= 59 && steps <= 60, `render cap ${cap} keeps simulation at 60 Hz`);
  ok(Math.abs(rendered - (cap || 120)) <= 1, `game loop applies presentation cap ${cap}`);
}
