/** Hot-path equivalence: buffers, collision order, hearing and replay-safe timers. */
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { ok } from './check';
import { instanceMatrix } from '../src/render/instancing';
import { prof, lapStart, lap, profReset } from '../src/core/prof';
import { NoiseField } from '../src/audio/loudness';
import { SpatialHash, StaticBoxGrid } from '../src/core/spatialHash';

const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3);
const matrix = new THREE.Matrix4().compose(new THREE.Vector3(2.3, -1, 8), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, 1.2, -0.1)), new THREE.Vector3(2, 3, 4));
mesh.setMatrixAt(0, matrix); instanceMatrix(mesh, 1, matrix);
ok(Array.from(mesh.instanceMatrix.array.slice(0, 16)).every((x, i) => x === mesh.instanceMatrix.array[16 + i]), 'typed instance copy exactly matches three.js, including offset and float rounding');
const originalNow = performance.now;
const wall = performance.now.bind(performance);
prof.on = true; profReset(); performance.now = () => 100;
try { lapStart(); const start = wall(); while (wall() - start < 1) {} lap('sim.test'); }
finally { performance.now = originalNow; prof.on = false; }
ok(prof.phase['sim.test'] > 0, 'phase timers measure wall time inside a frozen replay clock');

const noise = new NoiseField();
for (let i = 0; i < noise.size; i++) { noise.x[i] = i * 4 - 30; noise.z[i] = i % 3 * 7; noise.level[i] = i / 8; }
const actual = { x: 0, z: 0 };
let same = true;
for (let x = -40; x < 40; x += 1.5) {
  let expected = 0, ex = 0, ez = 0;
  for (let i = 0; i < noise.size; i++) {
    const d = Math.hypot(noise.x[i] - x, noise.z[i] - 3);
    const value = noise.level[i] * (1 - d / 24);
    if (d < 24 && value > expected) { expected = value; ex = noise.x[i]; ez = noise.z[i]; }
  }
  const value = noise.loudest(x, 3, 24, actual);
  same &&= Math.abs(value - expected) < 1e-12 && (!value || actual.x === ex && actual.z === ez);
}
ok(same, 'squared hearing rejection preserves loudest source, falloff and range boundaries');

const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Event']) Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
(globalThis as any).matchMedia = () => ({ matches: false });
const noop: any = new Proxy(function () {}, { get: (_t, k) => k === 'data' ? new Uint8ClampedArray(4 * 96 * 96) : noop, apply: () => noop, set: () => true });
(dom.window.HTMLCanvasElement.prototype as any).getContext = () => noop;
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
(globalThis as any).Path2D = class {};
(globalThis as any).__APP_VERSION__ = 'test';
const { Bullets, Team } = await import('../src/game/bullets');
const { BulletShape } = await import('../src/game/bulletShapes');
const { updateBullets } = await import('../src/game/systems/statuses');
const scene = new THREE.Scene(), b = new Bullets(scene), view = b as any;
const shot = { x: 1, z: 2, dirX: 1, dirZ: 0, speed: 5, life: 3, radius: 0.2, damage: 9, knockback: 0, team: Team.Enemy, color: '#ffffff', width: 0.5, length: 0.5 };
for (let i = 0; i < 500; i++) b.spawn(shot);
b.render(1);
ok(view.enemyCore.count === 500 && view.enemyRim.count === 500 && b.mesh.count === 0 && view.tail.count === 0, '500 danger shots use only the visible core/rim pools');
b.spawn({ ...shot, team: Team.Player, color: '#ffcd75', shape: 0 });
b.spawn({ ...shot, team: Team.Player, color: '#73eff7', shape: BulletShape.Star });
b.render(1);
const color = new THREE.Color(); view.tail.getColorAt(1, color);
ok(b.mesh.count === 1 && view.tail.count === 2 && view.shapeMeshes[BulletShape.Star - 1].core.count === 1 && color.getHex() === 0x73eff7, 'mixed shots pack plain cores and shaped tails independently, preserving colors');
b.kill(0); b.render(1);
ok(view.enemyCore.count === 499 && view.tail.count === 2 && b.damage[0] === 9, 'swap-removal preserves packed rendering and simulation records');
b.clear();
for (let i = 0; i < 257; i++) b.spawn({ ...shot, team: Team.Player, shape: BulletShape.Star });
b.render(1);
ok(view.shapeMeshes[BulletShape.Star - 1].core.count === 256 && b.mesh.count === 1 && view.tail.count === 257, 'shape overflow retains the existing plain-core fallback');
b.clear(); b.render(1);
ok(!b.mesh.count && !view.tail.count && !view.enemyCore.count && !view.shapeMeshes[0].core.count, 'clearing hides every packed pool');

// Same spatial query order, filtering and piercing history as the callback path.
const hash = new SpatialHash<any>();
const target = (uid: number, owner = -1) => ({ uid, x: 1, z: 2, radius: 1, hp: 100, targetable: true, pvpOwner: owner });
const friend = target(1, 0), first = target(2), second = target(3);
for (const e of [friend, first, second]) hash.insert(e, e.x, e.z, e.radius);
const hits: number[] = [];
const hero = { player: { dead: false, invuln: 1 }, remote: null };
const game: any = { role: 'solo', bullets: b, hash, walls: new StaticBoxGrid([]), barrels: { hitTest: () => -1 }, heroes: [hero], hero,
  pvp: null, damage: (e: any) => hits.push(e.uid), bulletBlast() {} };
b.spawn({ ...shot, team: Team.Player, owner: 0, pierce: 2 });
updateBullets.call(game, 0); updateBullets.call(game, 0);
ok(hits.join() === '2,3', 'bullet query skips own stand-in and prior hits, retaining first-hit order');

// Offscreen encoder completion keeps the same reset / failure guarantees as toBlob.
const { HighlightRecorder } = await import('../src/platform/clips');
let resolveBlob: (b: Blob) => void = () => {};
let rejectBlob: (e: Error) => void = () => {};
const context = { fillRect() {}, drawImage() {}, fillStyle: '' };
let closed = 0;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
Object.assign(globalThis, { MediaRecorder: class { static isTypeSupported() { return true; } }, HTMLCanvasElement: class { captureStream() {} }, createImageBitmap: async () => ({ close() { closed++; } }),
  OffscreenCanvas: class { width = 480; height = 270; getContext() { return context; } convertToBlob() { return new Promise<Blob>((resolve, reject) => { resolveBlob = resolve; rejectBlob = reject; }); } } });
const recorder = new HighlightRecorder(), source = { width: 1280, height: 720 } as HTMLCanvasElement;
recorder.capture(source, 0.05); await flush(); recorder.reset(); resolveBlob(new Blob(['old'])); await flush();
ok(recorder.ring.count === 0, 'late offscreen encoding cannot enter a new run');
recorder.capture(source, 0.05); await flush(); resolveBlob(new Blob(['new'])); await flush();
ok(recorder.ring.count === 1 && !recorder.failed, 'offscreen encoding retains the captured frame');
recorder.capture(source, 0.05); await flush(); rejectBlob(new Error('encoder failed')); await flush();
ok(recorder.failed && !recorder.recording && recorder.ring.count === 0, 'offscreen rejection stops and clears capture without an unhandled promise');
ok(closed === 3, 'every asynchronous snapshot releases its ImageBitmap');

const { renderModes } = await import('../src/game/systems/modes');
let draws = 0, hudUpdates = 0;
const modesGame: any = { isCombatMode: true, mode: 'fight', hero: { player: { rig: { root: { position: { x: 0, z: 0 } } } } },
  modes: { screen: {}, view: { renderFloor() { draws++; }, renderMini() {}, renderGhost() {} }, hud: { update() { hudUpdates++; } }, beat: 0, clock: { bpm: 120 }, pacifist: true } };
renderModes.call(modesGame, 1 / 60); modesGame.modes.pacifist = false;
renderModes.call(modesGame, 1 / 60); renderModes.call(modesGame, 1 / 60);
ok(draws === 2 && hudUpdates === 2, 'inactive modes clear the previous presentation once, then skip idle work');
modesGame.modes.pacifist = true; renderModes.call(modesGame, 1 / 60);
ok(draws === 3 && hudUpdates === 3, 'reactivating a mode resumes presentation immediately');
dom.window.close();
