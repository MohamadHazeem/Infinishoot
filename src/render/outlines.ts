import * as THREE from 'three';
import { retroGlobals } from './retroMaterial';

/**
 * Character outlines: an inverted hull (back faces pushed out along the
 * normal) drawn behind each character. The push is done in clip space by a
 * fixed number of internal pixels, so the line stays one or two crisp pixels
 * wide at any distance and any internal resolution.
 *
 *  - Instanced meshes with an `instanceFlash` attribute (enemies, barrels) get
 *    a second material through geometry groups, so the hull reuses the same
 *    instance buffers and costs one extra draw call per enemy type.
 *    Elites (instance scale >= 1.3) get a thicker line in their glow colour.
 *  - Other meshes (hero rigs) get a hull child mesh per part.
 */
export const outlineTuning = {
  /** Line width in internal pixels at 270p (scaled with the resolution). */
  px: 1,
  elitePx: 1.75,
  color: new THREE.Color('#1a1c2c'),
  eliteColor: new THREE.Color('#ffcd75'),
  /** Instance scale from which an enemy counts as an elite (elites are 1.6x). */
  eliteScale: 1.3,
  /** Rig parts smaller than this (bounding radius, m) get no outline. */
  minPartRadius: 0.12,
};

const uniforms = {
  uOutlinePx: { value: 1 },
  uElitePx: { value: 1.75 },
  uOutlineColor: { value: outlineTuning.color },
  uEliteColor: { value: outlineTuning.eliteColor },
  uEliteScale: { value: outlineTuning.eliteScale },
};

const vert = /* glsl */ `
uniform vec2 uSnapRes;
uniform float uSnapPx;
uniform float uFogNear;
uniform float uFogFar;
uniform float uOutlinePx;
uniform float uElitePx;
uniform vec3 uOutlineColor;
uniform vec3 uEliteColor;
uniform float uEliteScale;
out vec3 vCol;
out float vFog;
#ifdef RETRO_INSTANCE_FLASH
  in vec4 instanceFlash;
#endif

void main() {
  mat4 m = modelMatrix;
  float px = uOutlinePx;
  vCol = uOutlineColor;
  #ifdef USE_INSTANCING
    m = m * instanceMatrix;
    #ifdef RETRO_INSTANCE_FLASH
      // Elites are drawn 1.6x bigger: outline them thicker, in the colour they glow.
      if (length(instanceMatrix[0].xyz) >= uEliteScale) {
        px = uElitePx;
        vCol = instanceFlash.a > 0.05 ? min(instanceFlash.rgb * 1.15, vec3(1.0)) : uEliteColor;
      }
    #endif
  #endif
  vec4 wp = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  vec4 mv = viewMatrix * wp;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  vec4 clip = projectionMatrix * mv;
  if (uSnapPx > 0.0 && clip.w > 0.0) {
    vec2 grid = uSnapRes * 0.5 / uSnapPx;
    clip.xy = round(clip.xy / clip.w * grid) / grid * clip.w;
  }
  vec2 cn = (projectionMatrix * viewMatrix * vec4(n, 0.0)).xy;
  float l = length(cn);
  if (l > 1e-5) clip.xy += cn / l * px * 2.0 / uSnapRes * clip.w;
  gl_Position = clip;
}
`;

const frag = /* glsl */ `
uniform vec3 uFogColor;
in vec3 vCol;
in float vFog;
layout(location = 0) out vec4 outColor;
void main() {
  outColor = vec4(mix(vCol, uFogColor, vFog), 1.0);
}
`;

function hullMaterial(instanced: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    defines: instanced ? { RETRO_INSTANCE_FLASH: '' } : {},
    uniforms: {
      uSnapRes: retroGlobals.uSnapRes,
      uSnapPx: retroGlobals.uSnapPx,
      uFogNear: retroGlobals.uFogNear,
      uFogFar: retroGlobals.uFogFar,
      uFogColor: retroGlobals.uFogColor,
      ...uniforms,
    },
  });
}

const instancedHull = hullMaterial(true);
const meshHull = hullMaterial(false);
const done = new WeakSet<object>();

/** Turn outlines on or off and size them for the internal resolution. */
export function setOutlines(on: boolean, internalHeight: number): void {
  instancedHull.visible = meshHull.visible = on;
  const k = Math.max(1, internalHeight / 270);
  uniforms.uOutlinePx.value = outlineTuning.px * k;
  uniforms.uElitePx.value = outlineTuning.elitePx * k;
  uniforms.uEliteScale.value = outlineTuning.eliteScale;
}

/** Outline an instanced mesh that carries an `instanceFlash` attribute (enemies, barrels). Idempotent. */
export function outlineInstanced(mesh: THREE.InstancedMesh): boolean {
  if (done.has(mesh)) return false;
  done.add(mesh);
  const geo = mesh.geometry;
  const mat = mesh.material;
  if (Array.isArray(mat) || geo.groups.length > 0 || !geo.attributes.instanceFlash || !geo.attributes.normal) return false;
  geo.addGroup(0, Infinity, 0);
  geo.addGroup(0, Infinity, 1);
  mesh.material = [mat, instancedHull];
  return true;
}

/** Outline every solid part of a character rig (skips decals with textures and transparent parts). Idempotent. */
export function outlineRig(root: THREE.Object3D): void {
  if (done.has(root)) return;
  done.add(root);
  const parts: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || done.has(m)) return;
    const mat = m.material as THREE.ShaderMaterial;
    if (Array.isArray(mat) || mat.transparent || !m.geometry.attributes.normal) return;
    if (mat.uniforms?.uMap?.value) return; // painted face decal and other textured planes
    // Tiny bits (fins, gems, antenna tips) would only add noise and draw calls.
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if ((g.boundingSphere?.radius ?? 1) < outlineTuning.minPartRadius) return;
    parts.push(m);
  });
  for (const m of parts) {
    const hull = new THREE.Mesh(m.geometry, meshHull);
    hull.name = 'outline';
    hull.frustumCulled = m.frustumCulled;
    hull.raycast = () => {};
    done.add(hull);
    m.add(hull);
  }
}
