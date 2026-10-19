import { ok } from './check';
import { FrameRing, ComboTrigger, HighlightRecorder, clipsAllowed, clipsTuning } from '../src/platform/clips';
const frame = (time: number, bytes = 2) => ({ time, blob: new Blob([new Uint8Array(bytes)]) });
const r = new FrameRing(4, 8, 15);
for (let i = 0; i < 8; i++) r.push(frame(i));
ok(r.count === 4 && r.bytes === 8 && r.snapshot().map(f => f.time).join() === '4,5,6,7', 'ring wraps in chronological order and bounds count/bytes');
const saved = r.snapshot(); r.push(frame(30));
ok(r.count === 1 && r.snapshot()[0].time === 30 && saved[0].time === 4, 'time eviction does not invalidate pinned highlights');
r.push(frame(31, 20)); ok(r.bytes === 2, 'oversized frames cannot defeat the memory bound');
r.clear(); ok(r.count === 0 && r.bytes === 0 && !r.snapshot().length, 'reset drops all references');
const b = new FrameRing(300, 5); b.push(frame(0, 3)); b.push(frame(1, 3)); ok(b.count === 1 && b.bytes === 3, 'byte cap also applies below the frame cap');
const combo = new ComboTrigger();
ok(!combo.check(499) && combo.check(500) && !combo.check(501) && !combo.check(999), '500 crossing emits once, including jumps above threshold');
ok(!combo.check(0) && combo.check(600), 'combo break rearms next 500 crossing'); combo.reset(); ok(combo.check(500), 'new run rearms');
ok(!clipsAllowed(true, 0, true) && !clipsAllowed(true, 1, true) && clipsAllowed(true, 2, true), 'Potato/Low disabled including automatic quality rungs');
ok(!clipsAllowed(false, 4, true) && !clipsAllowed(true, 4, false), 'setting and hidden-tab opt-outs');
const s = new HighlightRecorder();
ok(!s.mark('boss', 1, 1), 'no phantom highlights without a recording');
s.recording = true; s.addFrame(frame(0));
for (const kind of ['boss', 'combo', 'revive', 'legendary', 'team', 'flawless'] as const) {
  const h = s.mark(kind, 2, 30); ok(h?.kind === kind && h.stage === 2 && h.time === 30, `${kind} stores its stage and run timestamp`);
  ok(!s.mark(kind, 2, 30), `${kind} suppresses duplicate event delivery`);
}
s.addFrame(frame(clipsTuning.postroll + 0.1));
ok(s.highlights.every(h => h.ready && h.frames.length === 2), 'marks collect post-roll and become ready');
const h = s.highlights[0]; for (let i = 4; i < 40; i++) s.addFrame(frame(i));
ok(h.frames.length === 2 && h.frames[0].time === 0, 'completed clip survives rolling eviction');
s.stop(true); ok(!s.recording && !s.ring.count && s.highlights.length === 6, 'stopping releases live buffer but preserves marked clips');
s.reset(); ok(!s.highlights.length && !s.recording, 'new runs clear archive and recorder');
// Asynchronous JPEG callbacks from an old run must not leak into a new one.
let callback: ((blob: Blob | null) => void) | undefined;
const context = { fillRect() {}, drawImage() {}, fillStyle: '' };
const canvas = { width: 480, height: 270, getContext: () => context, toBlob: (cb: typeof callback) => { callback = cb; } };
Object.assign(globalThis, {
  MediaRecorder: class { static isTypeSupported() { return true; } },
  HTMLCanvasElement: class { captureStream() {} }, createImageBitmap() {},
  document: { createElement: () => canvas },
});
const live = new HighlightRecorder();
live.capture(canvas as any, 0.05); ok(live.recording && !!callback, 'capture starts without errors on supported browser');
live.reset(); callback!(new Blob(['old'])); ok(live.ring.count === 0, 'late callback from reset is discarded');
live.capture(canvas as any, 0.05); callback!(new Blob(['new'])); ok(live.ring.count === 1, 'new run can capture after reset');
live.mark('boss', 1, 0); live.stop(); ok(live.highlights[0].ready, 'pause/death flush pending post-roll');
const cap = new HighlightRecorder();
for (let j = 0; j < 10; j++) {
  for (let i = 0; i < 40; i++) { cap.capture(canvas as any, 0.1); callback!(new Blob(['x'])); }
  cap.mark('manual', 1, j * 4, true);
}
ok(cap.highlights.length === 8 && cap.highlights[0].time === 8, 'archive evicts oldest marks at eight clips');
const budget = clipsTuning.archiveBytes; clipsTuning.archiveBytes = 4;
const memory = new HighlightRecorder(); memory.recording = true; memory.addFrame(frame(0, 3));
memory.mark('boss', 1, 0, true); memory.mark('revive', 1, 0, true);
ok(memory.highlights.length === 1 && memory.highlights[0].kind === 'revive', 'archive bytes stay bounded even for shared snapshots');
clipsTuning.archiveBytes = budget;
const bad = new HighlightRecorder(); (canvas as any).getContext = () => { throw new Error('disabled'); };
bad.capture(canvas as any, 0.05); ok(bad.failed && !bad.recording, 'capture failures stay local and stop recording');
console.log('clips: ring, trigger, lifecycle, memory and async-generation checks passed');
