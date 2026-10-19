/** Animation lane pure logic (src/game/animMath.ts): camera auto zoom, co-op framing, kill-cam, gaits, death fall. */
import { ok } from './check';
import { autoZoom, camDirTuning as T, deathFall, easeZoom, gaitOf, GAIT_FREQ, killCamWeight, teamFrame, toLocal, viewBand, wrapAngle } from '../src/game/animMath';
import { ENEMIES } from '../src/data/enemies';

// Auto zoom: calm pushes in, swarms and crowded edges push out, always bounded.
ok(autoZoom(2, 0, false) < 1, 'calm moments zoom in slightly');
ok(autoZoom(2, 0, false) >= T.autoMin, 'calm zoom stays above the minimum');
ok(autoZoom(20, 2, false) === 1, 'a normal fight keeps the default zoom');
ok(autoZoom(100, 0, false) > autoZoom(50, 0, false) && autoZoom(50, 0, false) > 1, 'zoom grows with the swarm');
ok(autoZoom(20, 25, false) > autoZoom(20, 2, false), 'enemies crowding the edge zoom out');
ok(autoZoom(2, 0, true) > 1, 'a boss is never framed as calm');
let maxZ = 0;
let minZ = 9;
for (let n = 0; n < 800; n += 7) for (let e = 0; e < 300; e += 11) for (const b of [false, true]) {
  const z = autoZoom(n, e, b);
  maxZ = Math.max(maxZ, z);
  minZ = Math.min(minZ, z);
}
ok(maxZ <= T.autoMax && minZ >= T.autoMin, `auto zoom bounded (${minZ.toFixed(2)}..${maxZ.toFixed(2)})`);
let monotone = true;
for (let n = T.calmBelow; n < 600; n++) if (autoZoom(n + 1, 0, false) < autoZoom(n, 0, false) - 1e-9) monotone = false;
ok(monotone, 'auto zoom never shrinks as the swarm grows');

// Easing: out faster than in, converges.
const out = easeZoom(1, 1.3, 0.1) - 1;
const back = 1.3 - easeZoom(1.3, 1, 0.1);
ok(out > back && out > 0 && back > 0, 'zooms out faster than it drifts back in');
let z = 1;
for (let i = 0; i < 600; i++) z = easeZoom(z, 1.2, 1 / 60);
ok(Math.abs(z - 1.2) < 0.01, 'easing converges in 10 s');

// View bands.
ok(viewBand(0, 0, 1) === 1, 'focus is in view');
ok(viewBand(T.viewHalfX * 0.95, 0, 1) === 2, 'near the side edge is the edge band');
ok(viewBand(T.viewHalfX * 1.1, 0, 1) === 2, 'just outside the edge counts as crowding');
ok(viewBand(T.viewHalfX * 2, 0, 1) === 0, 'far away is ignored');
ok(viewBand(T.viewHalfX * 0.95, 0, 1.5) === 1, 'zooming out widens the view');

// Co-op framing.
const f = { x: 0, z: 0, zoom: 1 };
teamFrame(0, 0, [], 0, f);
ok(f.x === 0 && f.z === 0 && f.zoom === 1, 'solo: no framing');
teamFrame(0, 0, [4, 0], 1, f);
ok(f.x > 0 && f.x <= 4 && f.zoom === 1, 'a close teammate shifts the view toward them without zooming');
teamFrame(0, 0, [30, 0], 1, f);
ok(f.zoom > 1 && f.zoom <= T.coopMax, `a far teammate zooms out, bounded (${f.zoom.toFixed(2)})`);
ok(Math.abs(f.x) <= T.viewHalfX * 0.6 + 1e-9, 'the local hero stays in the middle of the screen');
teamFrame(0, 0, [200, 200], 1, f);
ok(f.zoom === T.coopMax, 'a teammate across the map caps the zoom');
teamFrame(10, 5, [6, 5, 14, 5], 2, f);
ok(Math.abs(f.x) < 1e-9 && Math.abs(f.z) < 1e-9, 'a team centred on you leaves the focus alone');
{
  // Everyone within the margin at the resulting zoom.
  const mates = [9, -6, -8, 5];
  teamFrame(0, 0, mates, 2, f);
  let fits = true;
  for (let i = 0; i < 2; i++) {
    const dx = Math.abs(mates[i * 2] - f.x) / (T.viewHalfX * f.zoom);
    const dz = Math.abs(mates[i * 2 + 1] - f.z) / (T.viewHalfZ * f.zoom);
    if (dx > 1 || dz > 1) fits = false;
  }
  ok(fits, 'teammates in range fit on screen');
}

// Kill-cam curve.
const D = T.killCamTime;
ok(killCamWeight(-0.1, D) === 0 && killCamWeight(D, D) === 0, 'kill-cam off outside its life');
ok(killCamWeight(D * 0.4, D) === 1, 'kill-cam holds on the boss');
ok(killCamWeight(D * 0.05, D) > 0 && killCamWeight(D * 0.05, D) < 1, 'kill-cam eases in');
let smoothCurve = true;
for (let t = 0; t < D; t += 1 / 120) if (Math.abs(killCamWeight(t + 1 / 120, D) - killCamWeight(t, D)) > 0.12) smoothCurve = false;
ok(smoothCurve, 'kill-cam has no jumps');

// Gaits: every enemy model has one with a sane frequency.
let gaitsOk = true;
for (const def of Object.values(ENEMIES)) {
  const g = gaitOf(def.model);
  if (!g || !(GAIT_FREQ[g] > 0 && GAIT_FREQ[g] < 10)) gaitsOk = false;
}
ok(gaitsOk, 'every enemy model has a gait');
ok(gaitOf('bopper') === 'hop' && gaitOf('exploder') === 'waddle' && gaitOf('charger') === 'stomp', 'gaits per model');

// Local frame: facing +Z, moving +Z is forward; facing +X, moving -Z is to the right.
const l = { f: 0, s: 0 };
toLocal(0, 1, 0, l);
ok(Math.abs(l.f - 1) < 1e-9 && Math.abs(l.s) < 1e-9, 'forward when moving the way you face');
toLocal(1, 0, Math.PI / 2, l);
ok(Math.abs(l.f - 1) < 1e-9, 'forward follows the facing');
toLocal(0, -1, 0, l);
ok(l.f < -0.99, 'backpedal is negative forward');
ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9 && Math.abs(wrapAngle(-Math.PI * 0.5) + Math.PI * 0.5) < 1e-9, 'wrapAngle');

// Death fall: leaves the ground, lands flat, stays down.
const d = { y: 0, back: 0, tilt: 0 };
deathFall(0.25, d);
ok(d.y > 0.5 && d.tilt > 0 && d.tilt < 1, 'mid-air during the fall');
deathFall(3, d);
ok(d.y === 0 && d.tilt === 1 && d.back > 1, 'lying flat after the fall');
let prev = -1;
let backOk = true;
for (let t = 0; t < 2; t += 0.01) {
  deathFall(t, d);
  if (d.back < prev) backOk = false;
  prev = d.back;
}
ok(backOk, 'the body never slides back toward where it stood');
