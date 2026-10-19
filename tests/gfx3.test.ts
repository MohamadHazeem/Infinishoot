import * as THREE from 'three';
import { ok } from './check';
import { CinematicCamera } from '../src/render/cinematicCamera';
import { DynamicShadows, shadowTuning, shadowsEnabled, snapShadowCenter, prepareShadows, shadowUniforms } from '../src/render/shadows';
import { Fx, muzzleProfile, muzzleGeometry } from '../src/game/fx';
import { Particles, materialHit, type BurstOptions } from '../src/game/particles';
import { setRenderQuality } from '../src/render/quality';
import { noiseFor } from '../src/render/noiseGovernor';
import { FxEncoder, decodeFx } from '../src/net/fxCodec';
import type { VfxEvent } from '../src/game/vfx';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-5;
const camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 200);
camera.position.set(1, 2, 3); camera.lookAt(0, 0, 0);
const originalQ = camera.quaternion.clone();
const cine = new CinematicCamera(camera);
const track = [
  { time: 0, position: [0, 4, 8] as const, target: [0, 1, 0] as const, fov: 40 },
  { time: 4, position: [8, 6, 4] as const, target: [2, 1, 0] as const, fov: 60 },
];
cine.play(track); cine.seek(2);
ok(close(camera.position.x, 4) && close(camera.position.y, 5) && close(camera.fov, 50), 'camera eases position, target and FOV through midpoint');
cine.seek(-3); ok(camera.position.x === 0, 'negative seek clamps to start');
cine.seek(2, true); ok(camera.position.x === 0 && camera.fov === 40, 'reduced motion holds a static composition');
ok(cine.update(10, true) && camera.position.x === 8, 'reduced motion cuts to final keyframe without a pan');
cine.stop(); ok(camera.position.equals(new THREE.Vector3(1, 2, 3)) && close(camera.fov, 55) && camera.quaternion.angleTo(originalQ) < 1e-6, 'stop restores all saved camera state');
cine.play([track[0], { ...track[1], cut: true }]); cine.seek(3.99);
ok(camera.position.x === 0, 'hard cut does not interpolate'); cine.seek(4); ok(camera.position.x === 8, 'hard cut switches on its exact keyframe'); cine.stop(false);
ok(camera.position.x === 8 && !cine.active, 'caller can hand off the final pose');
for (const invalid of [[], [track[1]], [track[0], { ...track[1], time: 0 }], [{ ...track[0], fov: NaN }]]) {
  let threw = false; try { cine.play(invalid); } catch { threw = true; }
  ok(threw, 'invalid or unordered tracks are rejected before changing the camera');
}
cine.play(track); cine.update(NaN); ok(Number.isFinite(camera.position.x), 'nonfinite delta never poisons the camera'); cine.stop();

ok(shadowsEnabled(true, 4) && !shadowsEnabled(false, 4), 'shadows require opt-in on HIGH');
for (let level = 0; level < 4; level++) ok(!shadowsEnabled(true, level), `quality rung ${level} has no dynamic shadow pass`);
const texel = shadowTuning.span / shadowTuning.mapSize;
ok(close(snapShadowCenter(1), snapShadowCenter(1 + texel * 0.1)), 'small camera motion stays on the same shadow texel');
const shadowScene = new THREE.Scene(), shadows = new DynamicShadows(shadowScene);
shadows.update(true, 12, 9, new THREE.Vector3(0.45, 0.8, 0.4).normalize());
ok(shadows.light.shadow.mapSize.x === 512 && shadows.light.shadow.needsUpdate, 'one small map is updated when enabled');
const fakeRenderer = { shadowMap: { enabled: false, type: THREE.PCFShadowMap } } as unknown as THREE.WebGLRenderer;
prepareShadows(fakeRenderer, shadowScene); ok(fakeRenderer.shadowMap.enabled, 'renderer enables the shadow pass for opted-in scene');
shadows.update(false, 0, 0, new THREE.Vector3(0, 1, 0)); prepareShadows(fakeRenderer, shadowScene);
ok(!fakeRenderer.shadowMap.enabled && shadowUniforms.uGfxShadow.value.x === 0, 'turning off removes pass and receiving contribution immediately');
shadows.dispose(); ok(shadowScene.children.length === 0, 'shadow controller detaches its light and target');

ok(muzzleProfile('scatter', ['projectile']).family === 'spread', 'scatter has a broad muzzle silhouette');
ok(muzzleProfile('laser', ['projectile']).family === 'energy', 'laser has an elongated energy flash');
ok(muzzleProfile('grenade', ['explosive']).family === 'explosive', 'explosives have a warm compact flash');
ok(muzzleProfile('coil', ['shock']).family === 'arc', 'electric weapons have a cross spark');
ok(muzzleGeometry('spread') === muzzleGeometry('spread'), 'muzzle geometry is shared rather than rebuilt each shot');
const metal = materialHit('metal', '#566c86', 1, 0), slime = materialHit('slime', '#38b764'), stone = materialHit('stone', '#94b0c2');
ok(metal.sparks === 2 && metal.size[1] < slime.size[0], 'metal sparks are smaller and brighter than slime droplets');
ok(slime.gravity! > 0 && stone.gravity! > slime.gravity! && stone.life[1] > metal.life[1], 'stone chips fall harder and persist longer than sparks');
ok(metal.dir?.x === -1, 'material impact direction points back toward the incoming shot');
const reward: BurstOptions = { count: 8, color: '#ffcd75', speed: [1, 3], size: [0.1, 0.2], life: [0.4, 0.8], flourish: 'evolution' };
const wire: VfxEvent[] = [['b', 1, 0.5, 2, reward], ['b', 3, 1, 4, metal], ['b', 6, 1, 4, slime]];
const replay: VfxEvent[] = []; decodeFx(new FxEncoder().encode(wire), e => replay.push([...e] as VfxEvent));
ok(replay[0][0] === 'b' && replay[0][4].flourish === 'evolution', 'reward identity survives the binary effects bus');
ok(replay[2][0] === 'b' && replay[2][4].shape === 'splat', 'slime silhouette survives template replication');
ok(replay[1][0] === 'b' && replay[1][4].sparks === 2, 'frequent material hit uses the existing compact burst fields');

// Canvas is used only to create the shared sprite texture, never by the logic under test.
const noop: any = new Proxy(function () {}, { get: (_t, k) => k === 'data' ? new Uint8ClampedArray(4 * 64 * 64) : noop, apply: () => noop, set: () => true });
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
const scene = new THREE.Scene(), fx = new Fx(scene), particles = new Particles(scene);
setRenderQuality(4, false);
particles.burst(2, 0.2, 2, reward); fx.update(0.2); fx.render(camera);
const beams = scene.children.find(o => (o as THREE.Mesh).geometry?.type === 'CylinderGeometry') as THREE.InstancedMesh;
ok(beams.count === 1, 'replicated reward burst starts one pooled beam');
setRenderQuality(1, false); fx.render(camera); ok(beams.count === 0, 'LOW removes even an already-live reward beam');
setRenderQuality(4, false); noiseFor(scene).calm = true; fx.render(camera); ok(beams.count === 0, 'reduced motion hides active reward columns');
noiseFor(scene).calm = false; fx.clear();
for (let i = 0; i < 1000; i++) fx.flourish(i, 0, '#ffcd75', true);
fx.render(camera); ok(beams.count <= 160, 'reward spam stays inside a bounded instance pool');
fx.update(2); fx.render(camera); ok(beams.count === 0, 'reward pool releases all expired entries');
setRenderQuality(3, false);
