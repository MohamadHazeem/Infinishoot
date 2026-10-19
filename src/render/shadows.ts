import * as THREE from 'three';

/** One optional sun map. Ordinary enemies continue to use their blob decals. */
export const shadowTuning = { mapSize: 512, span: 42, distance: 45, strength: 0.72, bias: 0.0012, normalBias: 0.035, hz: 30, propBatches: 12 };
export const shadowUniforms = {
  uGfxShadowMap: { value: null as THREE.Texture | null },
  uGfxShadowMatrix: { value: new THREE.Matrix4() },
  uGfxShadow: { value: new THREE.Vector4(0, shadowTuning.bias, 1 / shadowTuning.mapSize, shadowTuning.normalBias) },
};
export const shadowFragment = /* glsl */ `
uniform sampler2D uGfxShadowMap;
uniform mat4 uGfxShadowMatrix;
uniform vec4 uGfxShadow;
float gfxSunShadow(vec3 world, vec3 normal) {
  if (uGfxShadow.x <= 0.0) return 1.0;
  vec4 p = uGfxShadowMatrix * vec4(world + normal * uGfxShadow.w, 1.0);
  vec3 q = p.xyz / p.w;
  if (q.z <= 0.0 || q.z >= 1.0 || any(lessThan(q.xy, vec2(0.0))) || any(greaterThan(q.xy, vec2(1.0)))) return 1.0;
  float depth = q.z - uGfxShadow.y;
  vec2 t = vec2(uGfxShadow.z * 0.5);
  float lit = step(depth, texture(uGfxShadowMap, q.xy + t).r)
    + step(depth, texture(uGfxShadowMap, q.xy - t).r)
    + step(depth, texture(uGfxShadowMap, q.xy + vec2(t.x, -t.y)).r)
    + step(depth, texture(uGfxShadowMap, q.xy + vec2(-t.x, t.y)).r);
  float edge = smoothstep(0.0, 0.07, min(min(q.x, q.y), min(1.0 - q.x, 1.0 - q.y)));
  return 1.0 - (1.0 - lit * 0.25) * uGfxShadow.x * edge;
}
`;

export function shadowsEnabled(requested: boolean, qualityLevel: number): boolean { return requested && qualityLevel === 4; }
export function snapShadowCenter(value: number): number {
  const texel = shadowTuning.span / shadowTuning.mapSize;
  return Math.round(value / texel) * texel;
}

const states = new WeakMap<THREE.Scene, DynamicShadows>();
export class DynamicShadows {
  readonly light = new THREE.DirectionalLight(0xffffff, 0);
  enabled = false;
  private last = -Infinity;
  constructor(readonly scene: THREE.Scene) {
    const t = shadowTuning, l = this.light;
    l.name = 'gfx3-sun';
    l.castShadow = true;
    l.shadow.mapSize.set(t.mapSize, t.mapSize);
    l.shadow.camera.left = l.shadow.camera.bottom = -t.span / 2;
    l.shadow.camera.right = l.shadow.camera.top = t.span / 2;
    l.shadow.camera.near = 1; l.shadow.camera.far = 100;
    l.shadow.camera.updateProjectionMatrix();
    l.shadow.autoUpdate = false;
    l.visible = false;
    scene.add(l, l.target);
    states.set(scene, this);
  }
  update(enabled: boolean, x: number, z: number, sun: THREE.Vector3): void {
    this.enabled = this.light.visible = enabled;
    if (!enabled) { this.last = -Infinity; return; }
    // Keep the light transform and the last map together between 30 Hz updates.
    const now = performance.now();
    if (now - this.last < 1000 / shadowTuning.hz) return;
    this.last = now;
    const cx = snapShadowCenter(x), cz = snapShadowCenter(z);
    this.light.target.position.set(cx, 0, cz);
    this.light.position.copy(sun).multiplyScalar(shadowTuning.distance).add(this.light.target.position);
    this.light.shadow.needsUpdate = true;
  }
  dispose(): void {
    this.light.shadow.dispose();
    this.light.removeFromParent(); this.light.target.removeFromParent();
    states.delete(this.scene);
  }
}

/** Renderer bridge: disabled presets spend no shadow draw calls. */
export function prepareShadows(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const s = states.get(scene);
  renderer.shadowMap.enabled = !!s?.enabled;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  shadowUniforms.uGfxShadow.value.x = 0;
  if (!s?.enabled) return;
  const shadow = s.light.shadow;
  shadowUniforms.uGfxShadowMap.value = shadow.map?.depthTexture ?? null;
  shadowUniforms.uGfxShadowMatrix.value = shadow.matrix;
  shadowUniforms.uGfxShadow.value.set(shadow.map ? shadowTuning.strength : 0, shadowTuning.bias, 1 / shadowTuning.mapSize, shadowTuning.normalBias);
}
