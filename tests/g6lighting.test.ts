import './jsdomEnv';
import * as THREE from 'three';
import { ok } from './check';
import { biomeByKey } from '../src/data/biomes';
import { Ambience } from '../src/game/ambience';
import { Scars, SCAR_COLORS, StageImprints } from '../src/game/scars';
import { createRetroMaterial } from '../src/render/retroMaterial';
import { setRenderQuality } from '../src/render/quality';
import { clearRadius, StylisedLight, StylisedLightPass } from '../src/render/stylisedLight';
import { Surfaces, surfaceTuning, waterCrossing } from '../src/render/surfaces';

ok(
  clearRadius(0, 0) > clearRadius(1, 0) &&
    clearRadius(1, 0) > clearRadius(1, 1) &&
    clearRadius(1, 1) >= 5,
  'night and rain bring mist closer with a clear combat centre',
);

const scene = new THREE.Scene();
const lighting = new StylisedLight(scene);
const cam = new THREE.PerspectiveCamera();
const renderer = { isWebGLRenderer: true } as unknown as THREE.WebGLRenderer;
const target = new THREE.WebGLRenderTarget(10, 10, {
  depthTexture: new THREE.DepthTexture(10, 10),
});
renderer.getRenderTarget = () => target;
const prepare = () =>
  scene.onBeforeRender(
    renderer,
    scene,
    cam,
    new THREE.BufferGeometry(),
    new THREE.Material(),
    new THREE.Group(),
  );
setRenderQuality(1, false);
prepare();
ok(scene.children.length === 0, 'LOW never allocates the opaque lighting pass');
setRenderQuality(4, false);
prepare();
const quad = scene.getObjectByName('stylised-opaque-light') as THREE.Mesh;
ok(
  quad.visible &&
    quad.renderOrder < 0 &&
    !Array.isArray(quad.material) &&
    !quad.material.depthWrite,
  'HIGH inserts lighting ahead of transparent warnings and preserves opaque depth',
);
setRenderQuality(1, false);
prepare();
ok(!quad.visible, 'stepping down removes both lighting draws');
setRenderQuality(3, false);

// A lazily created enemy batch and a dressed hero share the live rim uniform.
const armor = createRetroMaterial(),
  enemyMat = createRetroMaterial({ instanceFlash: true });
const geometry = new THREE.BoxGeometry();
geometry.setAttribute('instanceFlash', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
const batch = new THREE.InstancedMesh(geometry, enemyMat, 1);
scene.add(batch);
const rig = { materials: [armor] };
lighting.watchRig(rig);
const hook = armor.onBeforeCompile;
lighting.watchRig(rig);
const compile = (mat: THREE.ShaderMaterial) => {
  const shader = {
    uniforms: { ...mat.uniforms },
    fragmentShader: mat.fragmentShader,
  } as Parameters<typeof mat.onBeforeCompile>[0];
  mat.onBeforeCompile(shader, renderer);
  return shader;
};
const heroShader = compile(armor),
  enemyShader = compile(enemyMat);
ok(
  hook === armor.onBeforeCompile &&
    !!heroShader.uniforms.uActorRim &&
    heroShader.uniforms.uActorRim === enemyShader.uniforms.uActorRim &&
    heroShader.fragmentShader.includes('float grazing') &&
    heroShader.fragmentShader.indexOf('float grazing') <
      heroShader.fragmentShader.indexOf('col = mix(col, uFlash'),
  'hero and enemy material rims share the uniform, apply once and preserve hit-flash priority',
);

const pass = new StylisedLightPass({ biome: 'peaks', x: 0, z: 0, rain: 0, pressure: 0 });
let bound: THREE.WebGLRenderTarget | null = target;
renderer.getRenderTarget = () => bound;
renderer.setRenderTarget = (rt) => {
  bound = rt;
};
let sampled = false;
renderer.render = (layer) => {
  const shade = ((layer as THREE.Scene).children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
  sampled =
    bound !== target &&
    shade.uniforms.uDepth.value === target.depthTexture &&
    shade.uniforms.uScene.value === target.texture;
};
const texture = pass.render(renderer, cam, target);
ok(
  sampled && bound === target && texture !== target.texture,
  'standalone pass samples detached scene inputs and restores the caller target',
);
target.setSize(20, 12);
ok(
  pass.render(renderer, cam, target) === texture &&
    texture.image.width === 20 &&
    texture.image.height === 12,
  'quality/viewport resize reuses the scratch texture',
);
const p = { kind: 'water' as const, x: 0, z: 0, r: 2 };
ok(waterCrossing(-3, 0, 3, 0, p) === 0.5, 'a fast shot can cross a pond between samples');
ok(
  waterCrossing(-3, 2, 3, 2, p) < 0 &&
    waterCrossing(-9, 0, 3, 0, p) < 0 &&
    waterCrossing(0, 0, 0, 0, p) < 0,
  'shoreline misses, teleport corrections and still shots leave no wake',
);
const sf = new Surfaces(new THREE.Scene());
sf.load(biomeByKey('magma'), 42, { halfSize: 40, hazards: [p] }, () => false, null);
const n = 1000;
sf.shots = {
  count: n,
  x: new Float32Array(n).fill(1),
  z: new Float32Array(n),
  px: new Float32Array(n).fill(-1),
  pz: new Float32Array(n),
  radius: new Float32Array(n).fill(0.15),
};
let wakes = 0;
sf.ripple = (_x, _z, _size, _life, _a, y) => {
  if (y === 0.065) wakes++;
};
sf.render(0.01, 0, 0, 0, []);
ok(wakes === surfaceTuning.wakeLimit, 'one thousand shots share one three-ring emission budget');
sf.render(0, 0, 0, 0, []);
sf.render(0.01, 0, 0, 0, []);
ok(wakes === surfaceTuning.wakeLimit, 'pause and intervening frames emit no extra shot rings');
sf.load(biomeByKey('magma'), 42, { halfSize: 40, hazards: [] }, () => false, null);
sf.render(0.5, 0, 0, 0, []);
ok(wakes === surfaceTuning.wakeLimit, 'water from the previous arena cannot emit rings');

const marks = new StageImprints();
ok(
  !marks.add(0, 0, 0.2, false) && marks.add(0, 0, 1, false) && !marks.add(0.2, 0, 1, false),
  'small impacts and repeated scorch do not take up new slots',
);
ok(
  marks.add(0.1, 0, 2, true) && marks.count === 1 && marks.crater[0] === 1,
  'a larger crater upgrades the local scorch',
);
for (let i = 1; i <= 48; i++) marks.add(i * 4, 0, 10, true);
ok(
  marks.count === 48 && marks.x[0] === 48 * 4 && marks.radius[0] === 3,
  'bounded marks replace the oldest and clamp their size',
);
const scarScene = new THREE.Scene(),
  scars = new Scars(scarScene);
const splats = scarScene.children.find(
  (o) => o instanceof THREE.InstancedMesh,
) as THREE.InstancedMesh;
scars.add(1, 2, 1.5, SCAR_COLORS.crater);
scars.add(4, 3, 1.5, '#ff0000', 1);
scars.render(0.1);
ok(splats.count === 3, 'two persistent chips and one temporary splat share a draw');
scars.render(600);
ok(splats.count === 2, 'only the cold chips survive after the temporary splat expires');
scars.clear();
scars.render(1);
ok(splats.count === 0, 'a fresh arena starts clean');

const grassScene = new THREE.Scene(),
  ambience = new Ambience(grassScene);
ambience.load(biomeByKey('meadow'), 42, 20, () => false);
ambience.render(0, 0, 0, []);
const grass = grassScene.children.find(
  (o) => o instanceof THREE.InstancedMesh && o.instanceMatrix.count === 1100,
) as THREE.InstancedMesh;
const m = new THREE.Matrix4();
grass.getMatrixAt(0, m);
const gx = m.elements[12],
  gz = m.elements[14];
ambience.render(0.15, 0, 0, [
  { x: gx - 0.2, z: gz },
  { x: gx + 0.9, z: gz },
]);
grass.getMatrixAt(0, m);
const pushed = m.elements[4];
ambience.render(0.15, 0, 0, []);
grass.getMatrixAt(0, m);
ok(
  pushed > 0.4 && m.elements[4] > 0 && m.elements[4] < pushed,
  'nearest walker bends grass away and the same bend relaxes on release',
);
