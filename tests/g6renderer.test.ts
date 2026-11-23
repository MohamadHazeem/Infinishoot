import { ok } from './check';
import { BoxGeometry, InstancedMesh } from 'three';
import { instanceMatrixNode } from '../src/render/rendererNodes';
import {
  cluster,
  clusterCapacity,
  clusterGrid,
  firstLight,
  initializeCluster,
  LightCluster,
} from '../src/render/lightCluster';
import { LightPicker } from '../src/render/lights';
import { setRenderQuality } from '../src/render/quality';
import { createRetroMaterial, retroGlobals } from '../src/render/retroMaterial';
import { hasRowSamplingTies, rendererPreference } from '../src/render/rendererBackend';

ok(
  rendererPreference(undefined) === 'auto' && rendererPreference('invalid') === 'auto',
  'missing and damaged preferences select automatic detection',
);
ok(
  rendererPreference('webgl') === 'webgl' && rendererPreference('webgpu') === 'webgpu',
  'explicit backends survive normalization',
);

const grid = new LightCluster();
ok(hasRowSamplingTies(216, 540), '2.5x presentation needs a consistent nearest-neighbor tie break');
ok(
  !hasRowSamplingTies(360, 1080) && !hasRowSamplingTies(216, 720),
  'integer and third-pixel scales have no exact row ties',
);
grid.begin(-0.1, 0.1, 32);
const origin = grid.transform.x;
grid.begin(-0.2, 0.2, 32);
ok(
  grid.transform.x === origin,
  'the lighting grid stays on the same world tiles during sub-cell motion',
);
grid.offer(100, 1, 100, 1, 1, 0, 0, 1);
grid.offer(0, 1, 0, 3, 0, 1, 0, 0);
ok(grid.count === 0, 'culled and dark emitters spend no slots');
for (let i = 0; i < 5; i++) grid.offer(0, 1, 0, 3, 1, 0.5, 0.25, i + 1);
const tx = Math.floor(-grid.transform.x * grid.transform.z),
  tz = Math.floor(-grid.transform.y * grid.transform.z);
const offset = (tz * clusterGrid + tx) * 4;
const ids = Array.from(grid.data.subarray(offset, offset + 4));
ok(
  ids.includes(5) && !ids.includes(1),
  'bright explosion replaces the weakest overlapping tile light',
);
ok(
  grid.data[(firstLight + 8) * 4 + 4] === 5,
  'one-based index points to matching light position and intensity-scaled RGB',
);
const data = grid.data;
grid.begin(0, 0, 32);
ok(
  grid.data === data && grid.data[offset] === 0 && grid.count === 0,
  'new frames clear stale coverage and reuse the atlas',
);
for (let i = 0; i < clusterCapacity + 2; i++) grid.offer(0, 1, 0, 1, 1, 1, 1, 1);
ok(grid.count === clusterCapacity, 'capacity bounds every pooled write');

initializeCluster();
const picker = new LightPicker();
const pos = new Float32Array(64),
  col = new Float32Array(64);
setRenderQuality(4, false);
picker.flash(0, 1, 0, 5, 1, 0.8, 0.4, 1, 1);
picker.begin(0, 0);
picker.tickFlashes(0.12);
for (let i = 0; i < 1000; i++)
  picker.addSmall((i % 30) - 15, 1, Math.floor(i / 30) - 15, 2, 0, 1, 1, 0.3);
const legacy = picker.pick(16, pos, col, 0.55);
ok(
  cluster.count === 1001 && cluster.transform.w === 0.55 && legacy === 16,
  'one thousand bullet lights and an explosion reach HIGH while reflections retain their legacy list',
);
setRenderQuality(1, false);
picker.begin(0, 0);
picker.tickFlashes(0.1);
ok(
  picker.pick(2, pos, col) === 1 && cluster.transform.w === 0,
  'LOW restores the original light picker immediately',
);
const m = createRetroMaterial();
ok(
  m.uniforms.uCluster === retroGlobals.uCluster && m.uniforms.uTime === retroGlobals.uTime,
  'material factory retains shared uniforms',
);

const batch = new InstancedMesh(new BoxGeometry(), m, 3);
const original = instanceMatrixNode(batch);
ok(instanceMatrixNode(batch) === original, 'body and outline share one matrix upload');
batch.geometry.dispose();
ok(instanceMatrixNode(batch) !== original, 'disposed geometry releases its matrix binding');
const reused = instanceMatrixNode(batch);
batch.geometry = new BoxGeometry();
ok(
  instanceMatrixNode(batch) !== reused,
  'biome replacement gets a live GPU binding for the same instance pool',
);
