import { ok } from './check';
import * as THREE from 'three';
import { QualityGovernor } from '../src/render/quality';
import { RigOverlay } from '../src/render/rigOverlay';
import { hardware, matrix, missedSlots, stats } from '../scripts/benchRealScenes.mjs';
import { gate, loadFailures, sceneFailures } from '../scripts/benchRealBudget.mjs';

const governor = new QualityGovernor(3);
for (let i = 0; i < 160; i++) governor.sample(1 / 60, 14.8);
ok(governor.level === 2, 'AUTO sheds one rung under sustained deadline pressure at a steady 60 Hz');
for (let i = 0; i < 360; i++) governor.sample(1 / 60, 4);
ok(governor.level === 2, 'six calm seconds do not immediately undo the downgrade');
for (let i = 0; i < 300; i++) governor.sample(1 / 60, 4);
ok(governor.level === 3, 'AUTO retries the richer rung after sustained headroom');
const spike = new QualityGovernor(2);
for (let i = 0; i < 240; i++) spike.sample(1 / 60, i % 60 === 0 ? 15 : 5);
ok(spike.level === 2, 'isolated busy frames preserve the rung');

ok(
  stats([2, 7, 3, 1, 4]).median === 3 && stats([]) === null,
  'nearest-rank statistics handle unsorted and empty samples',
);
ok(missedSlots([16.6, 16.8, 33.3, 50]) === 3, 'missed slots count a two-refresh and a three-refresh gap');
ok(
  hardware('ANGLE Metal Renderer: Apple M5 Pro') && !hardware('ANGLE (SwiftShader Metal)') && !hardware('unknown'),
  'requires identified hardware',
);
ok(
  matrix().length === 60 && new Set(matrix().map((row) => JSON.stringify(row))).size === 60,
  'every preset, scene, viewport and low-end case appears once',
);
const row = {
  size: '1280x720',
  preset: 'low',
  scene: 'double',
  rate: 1,
  visible: true,
  fighting: true,
  errors: [],
  renderer: 'ANGLE Metal Renderer: Apple M5 Pro',
  viewport: [1280, 720],
  quality: 'LOW',
  shadows: false,
  frames: 300,
  elapsed: 5000,
  fps: 60,
  dropFraction: 0,
  interval: { n: 299, p95: 16.7, p99: 16.8 },
  simulation: { p95: 2 },
  render: { p95: 2 },
  submit: { p95: 1 },
  cpu: { p95: 5 },
  gpuExtension: true,
  gpu: { p95: 1 },
  calls: { p95: 125 },
  triangles: { p95: 210000 },
  heapBytes: { end: 75e6 },
  enemies: { median: 310 },
  bullets: { median: 1003, max: 1014 },
};
ok(!sceneFailures(row).length, 'representative healthy scene clears the gate');
ok(
  sceneFailures({ ...row, elapsed: 10000 }).includes('sustained fps'),
  'a long stall at the end of the sample cannot pass',
);
ok(sceneFailures({ ...row, gpu: null }).includes('GPU p95'), 'advertised GPU timing without a sample fails');
ok(sceneFailures({ ...row, preset: 'shadows' }).includes('preset/shadows'), 'a shadow run with the map off fails');
ok(
  sceneFailures({ ...row, enemies: { median: 149 } }).includes('enemy population'),
  'an empty fixture cannot pass by being fast',
);
ok(sceneFailures({ ...row, calls: { p95: 500 } }).includes('draw budget'), 'an over-budget scene fails even at 60 fps');
ok(gate({ rows: [], loads: [] }).length === 64, 'partial or empty reports fail coverage');
ok(
  loadFailures({
    network: 'broadband',
    target: 'title',
    readyMs: 3001,
    total: 5000000,
    renderer: row.renderer,
    errors: [],
  }).length === 2,
  'startup checks both bytes and readiness',
);

// Check the matrix array actually consumed by all three overlay materials.
(globalThis as any).document = {
  createElement: () => ({
    getContext: () => ({
      createImageData: () => ({ data: new Uint8ClampedArray(32 * 32 * 4) }),
      putImageData() {},
    }),
  }),
};
const root = new THREE.Group(),
  group = new THREE.Group(),
  part = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
root.add(group);
const second = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
group.add(part, second);
part.position.set(4, 5, 6);
root.updateMatrixWorld(true);
const overlay = new RigOverlay(root);
const xray = root.getObjectByName('heroXray') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
const matrices = xray.material.uniforms.uParts.value;
const draw = () => {
  overlay.update('#ffffff', true);
  (xray.onBeforeRender as () => void)();
};
draw();
ok(
  matrices instanceof Float32Array && matrices[12] === 4 && matrices[13] === 5 && matrices[14] === 6,
  'visible matrix reaches the WebGL uniform in column-major order',
);
group.visible = false;
draw();
ok(
  matrices[0] === 0 && matrices[5] === 0 && matrices[10] === 0 && matrices[15] === 1,
  'hidden ancestor collapses all overlay passes',
);
group.visible = true;
draw();
ok(
  matrices[12] === 4 && xray.material.uniforms.uParts.value === matrices,
  'restoring a rig part reuses the same uniform buffer',
);
part.castShadow = second.castShadow = true;
ok(
  overlay.batchShadow() && xray.castShadow && !part.castShadow && !second.castShadow,
  'two compatible armour parts cast once through the merged rig',
);
overlay.restoreShadow();
ok(part.castShadow && second.castShadow && !xray.castShadow, 'render completion restores original caster flags');
part.castShadow = false;
ok(!overlay.batchShadow() && second.castShadow && !xray.castShadow, 'an unmarked part keeps the original depth pass');
part.castShadow = true;
second.scale.x = -1;
ok(
  !overlay.batchShadow() && part.castShadow && second.castShadow,
  'independently mirrored winding uses ordinary depth draws',
);
second.scale.x = 1;
overlay.detail = false;
draw();
ok(!overlay.batchShadow() && part.castShadow, 'off-screen x-ray culling preserves native hero shadows');
overlay.dispose();
