import assert from 'node:assert/strict';
import { fps, shots } from '../scripts/capture/shots.mjs';

assert.equal(fps, 60);
assert.equal(shots.length, 20);
assert.equal(new Set(shots.map(s => s.id)).size, 20);
const press = new Set<string>();
let cursor = 0;
for (const shot of shots) {
  const q = new URLSearchParams(shot.link);
  assert.ok(q.has('test') && q.has('seed') && q.has('bench') && q.has('circle'));
  assert.equal(q.get('lang'), 'en');
  assert.match(shot.id, /^\d\d-[a-z0-9-]+$/);
  assert.equal(shot.start, cursor);
  assert.ok(Number.isInteger(shot.frames) && shot.frames > 0);
  for (const frame of shot.selects) {
    assert.ok(Number.isInteger(frame) && frame >= 0 && frame < shot.frames);
    assert.ok(!press.has(shot.id + '/' + frame));
    press.add(shot.id + '/' + frame);
  }
  cursor += shot.frames;
}
assert.equal(cursor, 90 * fps);
assert.equal(press.size, 30);

// Run the browser init script in its own realm, as Playwright does. A slow
// screenshot between two calls must never advance the next cue or frame.
import { runInNewContext } from 'node:vm';
import { installClock } from '../scripts/capture/driver.mjs';
const clock = runInNewContext(`
  const window = globalThis;
  const document = { getAnimations: () => [] };
  const performance = { now: () => 0 };
  const localStorage = { setItem() {} };
  window.requestAnimationFrame = () => 42;
  window.cancelAnimationFrame = () => {};
  (${installClock.toString()})(42);
  const beforeEngine = requestAnimationFrame(() => {});
  window.__game = {};
  const events = [];
  setTimeout(label => events.push(label), 50, '50ms');
  const cancelled = requestAnimationFrame(() => events.push('cancelled'));
  cancelAnimationFrame(cancelled);
  requestAnimationFrame(() => {
    events.push('a');
    requestAnimationFrame(() => events.push('b'));
  });
  for (let n = 0; n < 60; n++) captureTick();
  ({ events: events.join(','), beforeEngine, now: performance.now() });
`);
assert.equal(clock.beforeEngine, 42);
assert.equal(clock.events, 'a,b,50ms');
assert.ok(Math.abs(clock.now - 1000) < 1e-9);
