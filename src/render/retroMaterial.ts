import * as THREE from 'three';
import { lightUniforms, MAX_LIGHTS } from './lights';

/**
 * Retro (late-90s console) material.
 *  - Per-vertex hemisphere + sun lighting (Gouraud), optional cel banding
 *  - Vertex snapping to the low-res pixel grid (PS1 wobble)
 *  - Blend between perspective-correct and affine texture mapping (uv*w trick;
 *    WebGL2 has no `noperspective`)
 *  - Nearest-filtered textures, vertex colours, instancing, sky-tinted fog
 *  - Up to MAX_LIGHTS dynamic point lights (src/render/lights.ts), evaluated per
 *    pixel at the low internal resolution and banded like the cel shading
 *  - Night eyes: on instance-flash meshes (enemies) pure-white vertex colours glow
 *
 * Global look settings live in `retroGlobals`; every retro material shares
 * those uniform objects, so changing a value updates the whole scene.
 */
export const retroGlobals = {
  uSnapRes: { value: new THREE.Vector2(480, 270) },
  uSnapPx: { value: 0.5 }, // snap grid size in internal pixels, 0 = off
  uAffine: { value: 0.5 }, // 0 = perspective correct, 1 = full affine
  uSunDir: { value: new THREE.Vector3(0.45, 0.8, 0.4).normalize() },
  uSunColor: { value: new THREE.Color(0.72, 0.66, 0.52) },
  uSkyColor: { value: new THREE.Color(0.5, 0.56, 0.78) },
  uGroundColor: { value: new THREE.Color(0.36, 0.3, 0.4) },
  uToonSteps: { value: 3 }, // 0 = smooth Gouraud
  uFogColor: { value: new THREE.Color('#9fd8ff') },
  uFogNear: { value: 28 },
  uFogFar: { value: 70 },
  uTime: { value: 0 },
  /** 0..1 night: enemy eyes (white vertex colours on instance-flash meshes) glow, faint self-glow dims. */
  uNight: { value: 0 },
  uEyeColor: { value: new THREE.Color('#fff2a8') },
  /** Night readability (instance-flash meshes: enemies, barrels): moonlit rim strength, rim colour, and a floor on how dark lit colours get. */
  uNightRim: { value: 0.55 },
  uNightRimColor: { value: new THREE.Color('#94b0c2') },
  uNightLift: { value: 0.5 },
  ...lightUniforms,
};

const vertexShader = /* glsl */ `
uniform vec2 uSnapRes;
uniform float uSnapPx;
uniform vec3 uSunDir;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform vec2 uUvScroll;

out vec3 vColor;
out vec3 vAmbient;
out float vDiffuse;
out float vFog;
out vec2 vUvP;
out vec3 vUvW; // uv * w, w  -> dividing per-fragment yields affine (screen-linear) UVs
out vec3 vWorld;
out vec3 vNormal;
#ifdef RETRO_INSTANCE_FLASH
  in vec4 instanceFlash; // per-instance hit flash (rgb, amount)
  out vec4 vFlash;
#endif

void main() {
  #ifdef RETRO_INSTANCE_FLASH
    vFlash = instanceFlash;
  #endif
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = m * instanceMatrix;
  #endif

  vec4 wp = m * vec4(position, 1.0);
  vec3 n = normalize(mat3(m) * normal);
  vWorld = wp.xyz;
  vNormal = n;

  vAmbient = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);
  vDiffuse = max(dot(n, uSunDir), 0.0);

  vColor = vec3(1.0);
  #ifdef USE_COLOR
    vColor = color.rgb;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vColor *= instanceColor;
  #endif

  vec2 tuv = uv + uUvScroll * uTime;
  vUvP = tuv;

  vec4 mv = viewMatrix * wp;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);

  vec4 clip = projectionMatrix * mv;
  if (uSnapPx > 0.0 && clip.w > 0.0) {
    vec2 grid = uSnapRes * 0.5 / uSnapPx;
    clip.xy = round(clip.xy / clip.w * grid) / grid * clip.w;
  }
  vUvW = vec3(tuv * clip.w, clip.w);
  gl_Position = clip;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uAffine;
uniform float uAlphaTest;
uniform vec4 uFlash;
uniform float uUnlit;
uniform vec3 uSunColor;
uniform float uToonSteps;
uniform vec3 uFogColor;
uniform vec4 uLightPos[MAX_LIGHTS];
uniform vec4 uLightCol[MAX_LIGHTS];
uniform int uLightCount;
uniform float uLightMax;
uniform float uNight;
uniform vec3 uEyeColor;
uniform float uNightRim;
uniform vec3 uNightRimColor;
uniform float uNightLift;
#ifdef RETRO_MAP
  uniform sampler2D uMap;
#endif

in vec3 vColor;
in vec3 vAmbient;
in float vDiffuse;
in float vFog;
in vec2 vUvP;
in vec3 vUvW;
in vec3 vWorld;
in vec3 vNormal;
#ifdef RETRO_INSTANCE_FLASH
  in vec4 vFlash;
#endif
layout(location = 0) out vec4 outColor;

void main() {
  vec4 base = vec4(uColor * vColor, 1.0);
  #ifdef RETRO_MAP
    base *= texture(uMap, mix(vUvP, vUvW.xy / vUvW.z, uAffine));
  #endif
  if (base.a < uAlphaTest) discard;

  float d = vDiffuse;
  if (uToonSteps > 0.5) {
    // Soft-edged cel bands: chunky anime shading that still reads as lit.
    float s = d * uToonSteps;
    d = (floor(s) + smoothstep(0.35, 0.65, fract(s))) / uToonSteps;
  }
  vec3 lit = base.rgb * (vAmbient + uSunColor * d);
  // Dynamic point lights: smooth falloff, half-wrapped Lambert, banded with the cel steps.
  if (uLightCount > 0 && uUnlit < 0.99) {
    vec3 nrm = normalize(vNormal);
    vec3 dyn = vec3(0.0);
    for (int i = 0; i < MAX_LIGHTS; i++) {
      if (i >= uLightCount) break;
      vec4 lp = uLightPos[i];
      vec3 dv = lp.xyz - vWorld;
      float dd = dot(dv, dv);
      float r2 = lp.w * lp.w;
      if (dd >= r2) continue;
      float a = 1.0 - dd / r2;
      a *= a;
      float ndl = dot(nrm, dv) * inversesqrt(max(dd, 1e-4));
      a *= 0.4 + 0.6 * max(ndl, 0.0);
      if (uToonSteps > 0.5) a = (floor(a * 4.0) + smoothstep(0.3, 0.7, fract(a * 4.0))) * 0.25;
      dyn += uLightCol[i].rgb * a;
    }
    // Many overlapping lights saturate instead of blowing out to white (keeps the hue).
    float peak = max(dyn.r, max(dyn.g, dyn.b));
    dyn *= min(1.0, uLightMax / max(peak, 1e-4));
    // Mostly albedo-tinted, plus a little straight light so dark ground (ash, obsidian) still shows the pool.
    lit += dyn * (base.rgb * 0.85 + 0.12);
  }
  // At night faint self-glow (water, ice, belts) dims; real glow (>= 0.5: lava, bullets, sparks) stays.
  float unlit = uUnlit < 0.5 ? uUnlit * (1.0 - 0.75 * uNight) : uUnlit;
  vec3 col = mix(lit, base.rgb, unlit);
  #ifdef RETRO_INSTANCE_FLASH
    // Night: enemies keep a floor of their own colour and a hard moonlit rim, so dark
    // (veteran) bodies still read against dark ground.
    if (uNight > 0.0 && uUnlit < 0.5) {
      col = max(col, base.rgb * (uNightLift * uNight));
      float rim = 1.0 - max(dot(normalize(vNormal), normalize(cameraPosition - vWorld)), 0.0);
      col += uNightRimColor * (step(0.6, rim) * uNightRim * uNight);
    }
  #endif
  col = mix(col, uFlash.rgb, uFlash.a);
  #ifdef RETRO_INSTANCE_FLASH
    col = mix(col, vFlash.rgb, vFlash.a);
  #endif
  col = mix(col, uFogColor, vFog);
  #ifdef RETRO_INSTANCE_FLASH
    // Night: white eyes glow through the dark (and most of the fog).
    if (uNight > 0.0) {
      float eye = step(2.9, vColor.r + vColor.g + vColor.b);
      col = mix(col, uEyeColor, eye * uNight * (1.0 - 0.4 * vFog) * (1.0 - vFlash.a * 0.5));
    }
  #endif
  #ifdef RETRO_EMISSIVE_ALPHA
    // Opaque materials write a glow mask into alpha for the bloom pass: self-lit
    // things (bullets, lava, sparks), hit flashes and night eyes glow; lit surfaces don't.
    float glow = clamp((uUnlit - 0.45) * 1.8, 0.0, 1.0);
    #ifdef RETRO_INSTANCE_FLASH
      glow = max(glow, vFlash.a * 0.6);
      glow = max(glow, step(2.9, vColor.r + vColor.g + vColor.b) * uNight);
    #endif
    outColor = vec4(col, glow * (1.0 - vFog));
  #else
    outColor = vec4(col, base.a);
  #endif
}
`;

export interface RetroMaterialOptions {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  alphaTest?: number;
  /** 0 = fully lit, 1 = ignores lighting (glowing things). */
  unlit?: number;
  side?: THREE.Side;
  transparent?: boolean;
  /** UV scroll speed in UV units per second (water, conveyors). */
  uvScroll?: [number, number];
  /** Read a per-instance `instanceFlash` vec4 attribute (InstancedMesh only). */
  instanceFlash?: boolean;
}

export type RetroMaterial = THREE.ShaderMaterial & {
  uniforms: { uFlash: { value: THREE.Vector4 }; uColor: { value: THREE.Color } };
};

export function createRetroMaterial(opts: RetroMaterialOptions = {}): RetroMaterial {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    vertexColors: opts.vertexColors ?? false,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    defines: {
      MAX_LIGHTS,
      ...(opts.transparent ? {} : { RETRO_EMISSIVE_ALPHA: '' }),
      ...(opts.map ? { RETRO_MAP: '' } : {}),
      ...(opts.instanceFlash ? { RETRO_INSTANCE_FLASH: '' } : {}),
    },
    uniforms: {
      ...retroGlobals,
      uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
      uMap: { value: opts.map ?? null },
      uAlphaTest: { value: opts.alphaTest ?? 0 },
      uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
      uUnlit: { value: opts.unlit ?? 0 },
      uUvScroll: { value: new THREE.Vector2(...(opts.uvScroll ?? [0, 0])) },
    },
  });
  return mat as RetroMaterial;
}
