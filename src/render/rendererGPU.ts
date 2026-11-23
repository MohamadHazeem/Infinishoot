import { depth, vec4, max, positionWorld, uniform } from 'three/tsl';
import { shadowUniforms, shadowTuning } from './shadows';
import {
  Color,
  Material,
  MeshBasicNodeMaterial,
  BackSide,
  HalfFloatType,
  NearestFilter,
  WebGPUCoordinateSystem,
  WebGLRenderTarget,
  WebGPURenderer,
  UnsignedByteType,
  type NodeMaterial,
} from 'three/webgpu';
import type {
  BufferGeometry,
  DirectionalLight,
  IUniform,
  Mesh,
  Object3D,
  Scene,
  ShaderMaterial,
  Vector4,
} from 'three';
import { translateMaterial } from './rendererNodes';

/** Keep the public ShaderMaterial and its shared uniform objects on the mesh.
 * Substitute its numerical TSL graph only at draw submission. */
export type GPURenderer = WebGPURenderer & { renderSun(scene: Scene): void };

export async function createGPU(
  canvas: HTMLCanvasElement,
  adapter: GPUAdapter,
): Promise<GPURenderer> {
  const features: GPUFeatureName[] = [
    'float32-filterable',
    'float32-blendable',
    'depth32float-stencil8',
  ];
  if (new URLSearchParams(location.search).has('bench')) features.push('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: features.filter((f) => adapter.features.has(f)),
  });
  const renderer = new WebGPURenderer({
    canvas,
    device,
    antialias: false,
    alpha: true,
    outputType: UnsignedByteType,
  });
  try {
    await renderer.init();
    if (renderer.coordinateSystem !== WebGPUCoordinateSystem) {
      renderer.dispose();
      throw Error('Three initialized its WebGL compatibility backend.');
    }
  } catch (error) {
    device.destroy();
    throw error;
  }
  const sunMaterial = new MeshBasicNodeMaterial({ side: BackSide });
  sunMaterial.fragmentNode = vec4(depth, depth, depth, 1);
  let renderingSun = false;
  const savedColor = new Color();
  const lightsByScene = new WeakMap<Scene, DirectionalLight>();
  const renderSun = (scene: Scene) => {
    let sun = lightsByScene.get(scene);
    if (!sun || !sun.parent) {
      sun = scene.children.find((child) => child.name === 'gfx3-sun') as
        DirectionalLight | undefined;
      if (sun) lightsByScene.set(scene, sun);
    }
    const u = shadowUniforms;
    u.uGfxShadow.value.x = 0;
    if (!sun?.visible) return;
    const shadow = sun.shadow,
      camera = shadow.camera;
    if (!shadow.map)
      shadow.map = new WebGLRenderTarget(shadow.mapSize.x, shadow.mapSize.y, {
        type: HalfFloatType,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
      });
    if (shadow.needsUpdate) {
      sun.updateWorldMatrix(true, false);
      sun.target.updateWorldMatrix(true, false);
      camera.coordinateSystem = WebGPUCoordinateSystem;
      camera.updateProjectionMatrix();
      shadow.updateMatrices(sun);
      const background = scene.background,
        alpha = renderer.getClearAlpha();
      renderer.getClearColor(savedColor);
      try {
        scene.background = null;
        renderingSun = true;
        renderer.setRenderTarget(shadow.map);
        renderer.setClearColor(0xffffff, 1);
        renderer.render(scene, camera);
        shadow.needsUpdate = false;
      } finally {
        renderingSun = false;
        scene.background = background;
        renderer.setClearColor(savedColor, alpha);
        renderer.setRenderTarget(null);
      }
    }
    u.uGfxShadowMap.value = shadow.map.texture;
    u.uGfxShadowMatrix.value = shadow.matrix;
    u.uGfxShadow.value.set(
      shadowTuning.strength,
      shadowTuning.bias,
      1 / shadow.mapSize.x,
      shadowTuning.normalBias,
    );
  };
  // Friendly additive effects use onBeforeCompile in WebGL. Read their
  // existing noise uniforms so danger markings stay clear around the hero.
  const fromMaterial = renderer.library.fromMaterial.bind(renderer.library);
  renderer.library.fromMaterial = (source) => {
    const result = fromMaterial(source);
    if (
      source.type === 'MeshBasicMaterial' &&
      source.onBeforeCompile !== Material.prototype.onBeforeCompile &&
      result
    ) {
      const shader = {
        uniforms: {} as Record<string, IUniform>,
        vertexShader: '',
        fragmentShader: '',
      };
      const customize = source.onBeforeCompile as (inputs: typeof shader) => void;
      customize(shader);
      if (shader.uniforms.uNoiseHero && shader.uniforms.uNoiseOpacity) {
        const hero = uniform(shader.uniforms.uNoiseHero.value as Vector4);
        const opacity = uniform(1).onObjectUpdate(
          () => source.opacity * shader.uniforms.uNoiseOpacity.value,
        );
        const delta = positionWorld.xz.sub(hero.xy);
        const near = max(0, delta.dot(delta).div(max(0.01, hero.z)).oneMinus());
        result.opacityNode = opacity.mul(near.mul(hero.w).oneMinus());
      }
    }
    return result;
  };
  const cache = new WeakMap<
    Material,
    WeakMap<Object3D, { version: number; geometry: BufferGeometry; material: NodeMaterial }>
  >();
  renderer.setRenderObjectFunction(
    (object, scene, camera, geometry, original, group, lights, clipping, pass) => {
      if (renderingSun) {
        if (object.castShadow)
          renderer.renderObject(
            object,
            scene,
            camera,
            geometry,
            sunMaterial,
            group,
            lights,
            clipping,
            pass,
          );
        return;
      }
      const shader = original as ShaderMaterial;
      let material = original;
      if (shader.isShaderMaterial) {
        let objects = cache.get(original);
        if (!objects) cache.set(original, (objects = new WeakMap()));
        let entry = objects.get(object);
        if (!entry || entry.version !== original.version || entry.geometry !== geometry) {
          entry?.material.dispose();
          const node = translateMaterial(shader, object as Mesh);
          node.side = original.side;
          node.depthTest = original.depthTest;
          node.depthWrite = original.depthWrite;
          node.depthFunc = original.depthFunc;
          node.transparent = original.transparent;
          node.blending = original.blending;
          node.blendSrc = original.blendSrc;
          node.blendDst = original.blendDst;
          node.blendEquation = original.blendEquation;
          node.blendSrcAlpha = original.blendSrcAlpha;
          node.blendDstAlpha = original.blendDstAlpha;
          node.blendEquationAlpha = original.blendEquationAlpha;
          node.polygonOffset = original.polygonOffset;
          node.polygonOffsetFactor = original.polygonOffsetFactor;
          node.polygonOffsetUnits = original.polygonOffsetUnits;
          node.forceSinglePass = original.forceSinglePass;
          entry = { version: original.version, geometry, material: node };
          objects.set(object, entry);
          const dispose = () => node.dispose();
          const release = () => {
            original.removeEventListener('dispose', dispose);
            geometry.removeEventListener('dispose', dispose);
            node.removeEventListener('dispose', release);
            objects.delete(object);
          };
          node.addEventListener('dispose', release);
          original.addEventListener('dispose', dispose);
          geometry.addEventListener('dispose', dispose);
        }
        material = entry.material;
      }
      renderer.renderObject(
        object,
        scene,
        camera,
        geometry,
        material,
        group,
        lights,
        clipping,
        pass,
      );
    },
  );
  return Object.assign(renderer, { renderSun });
}
