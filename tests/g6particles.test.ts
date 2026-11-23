import './jsdomEnv';
import * as THREE from 'three';
import { ok } from './check';
import { Particles, materialHit } from '../src/game/particles';
import { ParticleBatch } from '../src/render/particlesGpu';
import { ParticleKind } from '../src/render/particlesShader';
import { nearbyShots, noiseFor } from '../src/render/noiseGovernor';
import { setRenderQuality } from '../src/render/quality';
import { Shatter } from '../src/render/shatter';
import { Team, Bullets } from '../src/game/bullets';
import { Vfx } from '../src/game/vfx';
import { Fx } from '../src/game/fx';

const scene = new THREE.Scene();
const noise = noiseFor(scene);
const batch = new ParticleBatch(scene, noise);
setRenderQuality(4, false);
const white = new THREE.Color(1, 1, 1);
const add = (x: number, life: number) =>
  batch.add(x, 1, 0, 2, 4, 1, life, 0.14, 16, 1, ParticleKind.Flake, white);
add(1, 0.5);
add(2, 0.09);
add(3, 0.5);
batch.render();
ok(
  batch.drawnCount === 30 && batch.mesh.count === 3,
  'HIGH draws ten fragments for each uploaded launch',
);
const v = batch.records.version;
batch.update(0.05);
batch.render();
ok(batch.records.version === v, 'advancing ballistics changes only the clock uniform');
batch.update(0.05);
batch.render();
ok(
  batch.drawnCount === 20 && batch.records.array[16] === 3,
  'expiry compacts a launch with its full descriptor',
);
batch.update(0.5);
batch.render();
ok(batch.drawnCount === 0, 'a longer step releases every expired group');
batch.clear();
for (let i = 0; i < 2300; i++) add(i, 2);
batch.render();
ok(
  batch.drawnCount === 20480 && batch.records.updateRanges.length === 1,
  'hard pool bound and bounded pending upload without a GPU frame',
);

ok(batch.admit('particles', 1e9) === 0, 'a full launch buffer skips emission work before the first governor tick');

const shots = {
  count: 4,
  team: new Uint8Array([0, 1, 1, 1]),
  x: new Float32Array([0, 8, 9, 3]),
  z: new Float32Array([0, 0, 0, 1]),
};
ok(
  nearbyShots(shots, Team.Enemy, 0, 0) === 2,
  'nearby hostile shots include the radius boundary and exclude friendly/distant rounds',
);
noise.begin(0, 0, 0, 1, 0, 0, false, 16);
batch.render();
ok(
  batch.drawnCount <= noise.particleLimit(4) && batch.drawnCount < 3100,
  'nearby danger caps effects already in flight',
);
setRenderQuality(1, false);
batch.render();
ok(batch.drawnCount <= 72, 'lowering quality immediately limits the same live effects');
noise.begin(0, 0, 0, 1, 0, 0, true, 16);
batch.render();
ok(
  batch.mesh.geometry.drawRange.count === 6 && batch.drawnCount <= 26,
  'reduced flashing draws one subdued core per launch',
);
batch.clear();
setRenderQuality(4, false);

const source = new THREE.Scene(),
  target = new THREE.Scene();
const host = new Particles(source),
  client = new Particles(target);
const fx = new Fx(source);
const bus = new Vfx({ particles: host, fx } as any);
bus.recording = true;
const o = materialHit('slime', '#72e68a', 1, 0);
noiseFor(source).begin(0, 300, 800, 4, 0, 0, true, 16);
bus.burst(1, 0.5, 0, o);
host.render();
const events = bus.drain();
ok(
  events.length === 1 && events[0][0] === 'b' && events[0][4] === o,
  'one burst is recorded independent of local quality',
);
new Vfx({ particles: client } as any).apply(events[0]);
client.render();
ok(
  client.drawnCount === 10 * host.drawnCount && client.drawnCount === 40,
  'same replicated slime burst plays at the receiving machine’s density',
);
host.clear();
host.render();
ok(host.drawnCount === 0 && client.drawnCount === 40, 'stage reset releases only the owning scene');

const bullets = new Bullets(source, { colorblind: true, reduceFlash: true });
bullets.spawn({
  x: 0,
  z: 0,
  dirX: 1,
  dirZ: 0,
  speed: 6,
  life: 1,
  radius: 0.2,
  damage: 2,
  knockback: 0,
  team: Team.Enemy,
  color: '#fff',
  width: 1,
  length: 1,
});
bullets.render(1);
const core = source.children.find((o) => o.renderOrder === 111) as THREE.InstancedMesh;
const rim = source.children.find((o) => o.renderOrder === 110) as THREE.InstancedMesh;
ok(
  core.count === 1 &&
    rim.count === 1 &&
    rim.renderOrder > client.mesh.renderOrder &&
    !(core.material as THREE.Material).depthTest &&
    (core.material as THREE.ShaderMaterial).uniforms.uColor.value.getHex() === 0xffffff,
  'white accessibility core and ink rim clear every fragment',
);
for (let i = 0; i < 200; i++) {
  fx.star(0, 1, 0, 2);
  fx.ring(0, 0, 1, 4, '#ff3df0');
}
fx.render(new THREE.PerspectiveCamera());
const warning = source.children.find((o) => o.renderOrder === 100) as THREE.InstancedMesh;
ok(warning.count === 160, 'danger-coloured expanding rings have reserved slots under pressure');

const rubbleScene = new THREE.Scene(),
  rubble = new Shatter(rubbleScene, true);
const box = { x: 0, z: 0, w: 1.2, h: 1.2, d: 1.2, color: '#94b0c2', pieces: 8 };
rubble.burst(box);
for (let i = 0; i < 360; i++) {
  rubble.update(1 / 60);
  rubble.render();
}
const mesh = rubbleScene.children[0] as THREE.InstancedMesh;
const before = mesh.instanceMatrix.version,
  pieces = rubble.live;
for (let i = 0; i < 360; i++) {
  rubble.update(0.25);
  rubble.render();
}
ok(
  pieces > 0 &&
    rubble.live === pieces &&
    rubble.pile.size > 0 &&
    mesh.instanceMatrix.version === before,
  'settled cover persists without matrix uploads',
);
for (let i = 0; i < 80; i++) rubble.burst({ ...box, x: i });
rubble.update(0.016);
rubble.render();
ok(
  rubble.live === 260 && mesh.instanceMatrix.updateRanges.length === 1,
  'old rubble is recycled with one bounded pending upload',
);
rubble.clear();
rubble.render();
ok(
  rubble.live === 0 && rubble.pile.size === 0 && mesh.count === 0,
  'stage change clears both rubble and its pile heights',
);
