// Loaded only for the WebGPU renderer. The compute pass writes directly to the
// vertex stage's storage buffer on that renderer's device. No CPU readback.
import { MeshBasicNodeMaterial, StorageBufferAttribute, type WebGPURenderer } from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  float,
  instanceIndex,
  max,
  min,
  mix,
  select,
  sin,
  smoothstep,
  step,
  storage,
  uniform,
  uint,
  varying,
  vec2,
  vec4,
  wgslFn,
} from 'three/tsl';
import { particleUpload } from './particlesUpload';
import type { ParticleBatch } from './particlesGpu';
import type { NoiseGovernor } from './noiseGovernor';
import type { retroGlobals } from './retroMaterial';
import {
  PARTICLE_COPIES,
  PARTICLE_GROUPS,
  PARTICLE_STRIDE,
  particleMotion,
  particlePaint,
} from './particlesShader';

export function attachCompute(
  batch: ParticleBatch,
  noise: NoiseGovernor,
  world: typeof retroGlobals,
) {
  const launches = new StorageBufferAttribute(batch.records.array, 4);
  const input = storage(launches, 'vec4', PARTICLE_GROUPS * 4).toReadOnly();
  const motion = new StorageBufferAttribute(PARTICLE_GROUPS * PARTICLE_COPIES, 4);
  const output = storage(motion, 'vec4', motion.count);
  const result = storage(motion, 'vec4', motion.count).toReadOnly();
  const copies = uniform(1, 'uint'),
    clock = uniform(0);
  const solve = wgslFn(particleMotion(true));
  const kernel = Fn(() => {
    const base = instanceIndex.div(copies).mul(uint(4));
    output
      .element(instanceIndex)
      .assign(
        solve(
          input.element(base),
          input.element(base.add(1)),
          input.element(base.add(2)),
          clock,
          float(instanceIndex.mod(copies)),
        ) as ReturnType<typeof vec4>,
      );
  })().compute(1, [64]);

  const base = instanceIndex.mul(uint(4));
  const launch = input.element(base),
    flight = input.element(base.add(1));
  const form = input.element(base.add(2)),
    tint = input.element(base.add(3));
  const corner = attribute('position', 'vec3');
  const p = result.element(instanceIndex.mul(copies).add(uint(corner.z)));
  const age = max(0, clock.sub(launch.w));
  const k = min(1, age.div(max(0.001, flight.w)));
  const puff = step(3.5, form.w);
  const angle = flight.y
    .mul(0.31)
    .add(age.mul(mix(5, 0.5, puff)))
    .add(corner.z);
  const flat = select(
    form.w.equal(1),
    clamp(p.y.mul(1.4), 0.16, 0.85),
    select(form.w.equal(2), 0.48, select(form.w.equal(3), 0.28, 1)),
  );
  const xy = corner.xy.mul(vec2(1, flat));
  const rotated = vec2(
    xy.x.mul(cos(angle)).sub(xy.y.mul(sin(angle))),
    xy.x.mul(sin(angle)).add(xy.y.mul(cos(angle))),
  );
  const offset = select(form.w.equal(1), xy, rotated).mul(p.w);
  const view = cameraViewMatrix.mul(vec4(p.xyz, 1));
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  mat.vertexNode = cameraProjectionMatrix.mul(view.add(vec4(offset, 0, 0)));
  const hero = uniform(noise.heroUniform.value),
    opacity = uniform(1);
  const fogNear = uniform(28),
    fogFar = uniform(70),
    fogColor = uniform(world.uFogColor.value);
  const delta = p.xz.sub(hero.xy);
  const fade = opacity.mul(
    max(0, delta.dot(delta).div(max(0.01, hero.z)).oneMinus())
      .mul(hero.w)
      .oneMinus(),
  );
  const rgb = mix(tint.rgb, fogColor, smoothstep(fogNear, fogFar, view.z.negate()));
  const alpha = tint.a.mul(fade).mul(mix(1, k.oneMinus().mul(smoothstep(0, 0.09, k)), puff));
  mat.fragmentNode = wgslFn(particlePaint(true))(
    varying(corner.xy),
    varying(vec4(rgb, alpha)),
    varying(form.w),
  );
  const mesh = batch.mesh;
  mesh.material = mat;
  let pending = false;
  mesh.onBeforeRender = (renderer) => {
    if (!pending) return;
    (renderer as unknown as WebGPURenderer).compute(kernel);
    pending = false;
  };
  return (groups: number, detail: number, first: number, end: number): void => {
    particleUpload(launches, first * PARTICLE_STRIDE, end * PARTICLE_STRIDE);
    clock.value = batch.clock.value;
    copies.value = detail;
    opacity.value = noise.opacityUniform.value;
    fogNear.value = world.uFogNear.value;
    fogFar.value = world.uFogFar.value;
    kernel.count = groups * detail;
    pending = groups > 0;
  };
}
