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
 *  - Hero rigs get one merged hull per hero (src/render/rigOverlay.ts).
 *  - At night the plain outline lifts toward a moonlit colour so dark enemies
 *    keep a readable edge on dark ground (readability lane).
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
  /** Night outline colour and how far plain outlines move toward it at full night (0 = stay dark). */
  nightColor: new THREE.Color('#94b0c2'),
  night: 0.75,
};

const uniforms = {
  uOutlinePx: { value: 1 },
  uNightOutlineColor: { value: outlineTuning.nightColor },
  uNightOutline: { value: outlineTuning.night },
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
uniform vec3 uNightOutlineColor;
uniform float uNightOutline;
uniform float uNight;
out vec3 vCol;
out float vFog;
#ifdef RETRO_INSTANCE_FLASH
  in vec4 instanceFlash;
#endif

void main() {
  mat4 m = modelMatrix;
  float px = uOutlinePx;
  vCol = mix(uOutlineColor, uNightOutlineColor, uNight * uNightOutline);
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
      uNight: retroGlobals.uNight,
      ...uniforms,
    },
  });
}

/** Shared outline uniforms (the merged hero hulls in rigOverlay.ts use them too). */
export const outlineUniforms = uniforms;
/** Line width multiplier on top of `outlineTuning` (ANIME LOOK thickens the ink; graphics lane). */
export const outlineStyle = { scale: 1 };
/** Whether outlines are on this frame (quality). */
export const outlineState = { on: true };

const instancedHull = hullMaterial(true);
/**
 * Same hull for instanced meshes that carry instance colours. three.js keys the
 * program on instanceColor, so one shared material flip-flopped its program
 * (a full getProgram() lookup) between the two kinds of mesh every frame.
 */
const instancedHullColor = hullMaterial(true);
const done = new WeakSet<object>();

/** Turn outlines on or off and size them for the internal resolution. */
export function setOutlines(on: boolean, internalHeight: number): void {
  instancedHull.visible = instancedHullColor.visible = on;
  outlineState.on = on;
  const k = Math.max(1, internalHeight / 270) * outlineStyle.scale;
  uniforms.uOutlinePx.value = outlineTuning.px * k;
  uniforms.uElitePx.value = outlineTuning.elitePx * k;
  uniforms.uEliteScale.value = outlineTuning.eliteScale;
  uniforms.uNightOutline.value = outlineTuning.night;
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
  mesh.material = [mat, mesh.instanceColor ? instancedHullColor : instancedHull];
  return true;
}
