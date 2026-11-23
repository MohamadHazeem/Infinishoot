import * as THREE from 'three';
import { fullscreenVert } from './postfx';
import { renderQuality } from './quality';
import { retroGlobals } from './retroMaterial';

// The clear radius is measured on the playfield, so zoom and screen aspect do
// not move a bank of mist across the hero. Night and rain bring the bank closer.
export const lightTuning = {
  contact: 0.21,
  rim: 0.18,
  actorRim: 0.43,
  shafts: 0.12,
  dayClear: 11,
  nightClear: 6.5,
  rainReach: 1.5,
};

interface Air {
  rim: number;
  mist: number;
  density: number;
}

const air: Record<string, Air> = {
  meadow: { rim: 0xffe6a7, mist: 0xbbe8cf, density: 0.23 },
  dunes: { rim: 0xffedbb, mist: 0xefbb94, density: 0.33 },
  peaks: { rim: 0xcefbff, mist: 0xc1dcf5, density: 0.3 },
  magma: { rim: 0xffb182, mist: 0xad7793, density: 0.24 },
  neon: { rim: 0xbeccff, mist: 0x777fa9, density: 0.21 },
  factory: { rim: 0xffe6af, mist: 0xd9bed5, density: 0.18 },
  sky: { rim: 0xfff4cf, mist: 0xc3eafa, density: 0.25 },
  candy: { rim: 0xffe0d6, mist: 0xe8bddc, density: 0.2 },
  ruins: { rim: 0xacf2e8, mist: 0x8ec7c6, density: 0.31 },
};

export function clearRadius(night: number, rain: number): number {
  return (
    lightTuning.dayClear +
    (lightTuning.nightClear - lightTuning.dayClear) * night -
    rain * lightTuning.rainReach
  );
}

// Reusable with a renderer-owned composite. Read the opaque scene before
// transparencies: warnings, hostile outlines and HUD never enter this filter.
export const stylisedLightGLSL = /* glsl */ `
uniform sampler2D uScene, uDepth, uCloudMap;
uniform mat4 uClipToWorld;
uniform vec2 uClip, uPixel, uFocus, uLightSide;
uniform vec3 uRim, uMist;
uniform vec4 uStyle; // contact, edge light, haze density, shaft brightness
uniform vec4 uCloud;
uniform vec3 uSunDir, uCloudCut;
uniform float uClear;
in vec2 vUv;
out vec4 result;
float depthM(vec2 uv) {
  float d = texture(uDepth, uv).r;
  return uClip.x * uClip.y / (uClip.y - d * (uClip.y - uClip.x));
}
float contact(float d) {
  // Occluders farther than two metres from the receiver cannot shadow it.
  return smoothstep(.06, .45, d) * (1. - smoothstep(.85, 2., d));
}
void main() {
  vec4 src = texture(uScene, vUv);
  float depth = texture(uDepth, vUv).r;
  if (depth >= 1. || src.a >= .99) { result = src; return; }
  vec4 wp = uClipToWorld * vec4(vUv * 2. - 1., depth * 2. - 1., 1.);
  vec3 world = wp.xyz / wp.w;
  float z = uClip.x * uClip.y / (uClip.y - depth * (uClip.y - uClip.x));
  vec2 x = vec2(uPixel.x, 0.) * 2.;
  vec2 y = vec2(0., uPixel.y) * 2.;
  float l = depthM(vUv - x), r = depthM(vUv + x);
  float b = depthM(vUv - y), t = depthM(vUv + y);
  // Opposing taps cancel the depth slope of a flat floor or wall.
  float ao = contact(z - .5 * (l + r)) + contact(z - .5 * (b + t));
  vec3 col = src.rgb * (1. - min(1., ao) * uStyle.x);
  float lip = depthM(vUv + uPixel * uLightSide) - z;
  col += uRim * (smoothstep(.30, 1.2, lip) * uStyle.y) * (1. - col);
  float dist = length(world.xz - uFocus);
  float bank = smoothstep(uClear, uClear + 19., dist);
  // Broad, stepped strokes follow the ground instead of the viewport.
  vec2 field = world.xz * vec2(.024, .095) + uCloud.xy;
  float brush = texture(uCloudMap, field).r;
  float wash = (.5 + .16 * floor(brush * 4.)) * uStyle.z * bank;
  col = mix(col, uMist, wash);
  if (uStyle.w > 0.) {
    // Two slices through the sunlit air on the sightline. Project both to
    // the same moving cloud layer that casts the shadows on the playfield.
    vec3 ray = normalize(cameraPosition - world);
    vec3 p = world + ray * 1.5;
    vec2 slope = uSunDir.xz / max(.25, uSunDir.y);
    vec2 cloud = (p.xz + (uCloudCut.z - p.y) * slope) * uCloud.z + uCloud.xy;
    vec2 stride = (ray.xz - ray.y * slope) * 4. * uCloud.z;
    float openSky = 1. - .5 * (texture(uCloudMap, cloud).r + texture(uCloudMap, cloud + stride).r);
    float shaft = smoothstep(.48, .70, openSky) * smoothstep(2., 14., dist);
    col += (1. - col) * uRim * (shaft * uStyle.w);
  }
  result = vec4(mix(col, src.rgb, clamp(src.a, 0., 1.)), src.a);
}`;

function screenMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: fullscreenVert,
    fragmentShader,
    uniforms,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NoBlending,
  });
}

export class StylisedLight {
  biome = 'meadow';
  rain = 0;
  x = 0;
  z = 0;
  pressure = 0;
  private pass?: StylisedLightPass;
  private rigs = new WeakSet<object>();
  private materials = new WeakSet<THREE.ShaderMaterial>();
  private rim = { value: new THREE.Vector4() };
  private tint = new THREE.Color();

  /** Hero skins retain their named retro materials through pose and colour changes. */
  watchRig(rig: { materials: THREE.ShaderMaterial[] }): void {
    if (this.rigs.has(rig)) return;
    this.rigs.add(rig);
    for (const material of rig.materials) this.rimMaterial(material);
  }

  private rimMaterial(material: THREE.ShaderMaterial): void {
    if (this.materials.has(material)) return;
    this.materials.add(material);
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.uActorRim = this.rim;
      const flash = 'col = mix(col, uFlash.rgb, uFlash.a);';
      shader.fragmentShader =
        'uniform vec4 uActorRim;\n' +
        shader.fragmentShader.replace(
          flash,
          `
        if (uActorRim.w > 0. && uUnlit < .5) {
          vec3 n = normalize(vNormal);
          float grazing = 1. - max(0., dot(n, normalize(cameraPosition - vWorld)));
          float side = .45 + .55 * smoothstep(-.45, .55, dot(n, uSunDir));
          col += (1. - clamp(col, 0., 1.)) * uActorRim.rgb *
                 (smoothstep(.26, .80, grazing) * side * uActorRim.w);
        }
        ${flash}`,
        );
    };
    material.needsUpdate = true;
  }

  constructor(scene: THREE.Scene) {
    // Enemy batches are created lazily as enemy types first enter the arena.
    const watchBatch = (object: THREE.Object3D) => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isInstancedMesh || !mesh.geometry.hasAttribute('instanceFlash')) return;
      const mat = mesh.material as THREE.ShaderMaterial;
      if (mat.isShaderMaterial && mat.uniforms.uUnlit) this.rimMaterial(mat);
    };
    for (const object of scene.children) watchBatch(object);
    scene.addEventListener('childadded', (e) => watchBatch(e.child));
    const previous = scene.onBeforeRender;
    scene.onBeforeRender = (renderer, world, camera, geometry, material, group) => {
      previous.call(scene, renderer, world, camera, geometry, material, group);
      const active =
        'isWebGLRenderer' in renderer &&
        renderer.isWebGLRenderer === true &&
        (camera as THREE.PerspectiveCamera).isPerspectiveCamera &&
        renderQuality.level >= 3 &&
        !!renderer.getRenderTarget()?.depthTexture;
      const night = retroGlobals.uNight.value;
      const p = air[this.biome] ?? air.meadow;
      this.tint.setHex(p.rim).lerp(retroGlobals.uNightRimColor.value, night);
      this.rim.value.set(
        this.tint.r,
        this.tint.g,
        this.tint.b,
        renderQuality.level >= 2 ? lightTuning.actorRim * (1 - 0.35 * night) : 0,
      );
      if (active && !this.pass) {
        this.pass = new StylisedLightPass(this);
        scene.add(this.pass.mesh);
      }
      if (this.pass) this.pass.mesh.visible = active;
    };
  }
}

// A renderer can consume the fragment pass directly. For the current WebGL2
// path the first transparent draw reads the opaque target into a reusable
// colour buffer and copies it back. Original depth and bloom alpha survive.
export class StylisedLightPass {
  private readonly scratch = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });
  private readonly layer = new THREE.Scene();
  private readonly side = new THREE.Vector3();
  private readonly uniforms = {
    uScene: { value: null as THREE.Texture | null },
    uDepth: { value: null as THREE.DepthTexture | null },
    uClipToWorld: { value: new THREE.Matrix4() },
    uClip: { value: new THREE.Vector2() },
    uPixel: { value: new THREE.Vector2() },
    uFocus: { value: new THREE.Vector2() },
    uLightSide: { value: new THREE.Vector2() },
    uRim: { value: new THREE.Color() },
    uMist: { value: new THREE.Color() },
    uStyle: { value: new THREE.Vector4() },
    uClear: { value: 0 },
    uSunDir: retroGlobals.uSunDir,
    uCloudMap: retroGlobals.uCloudMap,
    uCloud: retroGlobals.uCloud,
    uCloudCut: retroGlobals.uCloudCut,
  };
  readonly mesh: THREE.Mesh;

  constructor(
    private readonly style: Pick<StylisedLight, 'biome' | 'x' | 'z' | 'rain' | 'pressure'>,
  ) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    const shade = new THREE.Mesh(geo, screenMaterial(stylisedLightGLSL, this.uniforms));
    shade.frustumCulled = false;
    this.layer.add(shade);
    const copy = screenMaterial(
      'uniform sampler2D uImage; in vec2 vUv; out vec4 result; void main() { result = texture(uImage, vUv); }',
      { uImage: { value: this.scratch.texture } },
    );
    copy.transparent = true;
    this.mesh = new THREE.Mesh(geo, copy);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10000;
    this.mesh.name = 'stylised-opaque-light';
    this.mesh.onBeforeRender = (renderer, _scene, camera) => {
      this.render(renderer, camera as THREE.PerspectiveCamera, renderer.getRenderTarget()!);
    };
  }

  /** Shade an opaque colour/depth target. The result is borrowed until the next call. */
  render(
    renderer: THREE.WebGLRenderer,
    cam: THREE.PerspectiveCamera,
    target: THREE.WebGLRenderTarget,
  ): THREE.Texture {
    const previous = renderer.getRenderTarget();
    const style = this.style;
    const u = this.uniforms;
    this.scratch.setSize(target.width, target.height);
    u.uScene.value = target.texture;
    u.uDepth.value = target.depthTexture;
    u.uClip.value.set(cam.near, cam.far);
    u.uClipToWorld.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
    u.uPixel.value.set(1 / target.width, 1 / target.height);
    u.uFocus.value.set(style.x, style.z);
    const sun = this.side
      .copy(retroGlobals.uSunDir.value)
      .transformDirection(cam.matrixWorldInverse);
    u.uLightSide.value.set(sun.x, sun.y).normalize().multiplyScalar(1.3);
    const p = air[style.biome] ?? air.meadow;
    const night = retroGlobals.uNight.value;
    u.uClear.value = clearRadius(night, style.rain);
    u.uRim.value.setHex(p.rim).lerp(retroGlobals.uNightRimColor.value, night);
    u.uMist.value.setHex(p.mist).lerp(retroGlobals.uFogColor.value, 0.55 + 0.38 * night);
    const shafts =
      renderQuality.level === 4
        ? lightTuning.shafts * (1 - 0.7 * style.rain) * (1 - 0.6 * night)
        : 0;
    u.uStyle.value.set(
      lightTuning.contact,
      lightTuning.rim,
      p.density * (1 + night + 0.35 * style.rain),
      shafts * (1 - 0.6 * style.pressure) * Math.min(1, retroGlobals.uCloud.value.w * 4),
    );
    renderer.setRenderTarget(this.scratch);
    try {
      renderer.render(this.layer, cam);
    } finally {
      renderer.setRenderTarget(previous);
    }
    return this.scratch.texture;
  }
}
