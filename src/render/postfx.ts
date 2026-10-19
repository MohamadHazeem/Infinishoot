import * as THREE from 'three';

/**
 * Post-processing state shared between the look system (which fills it from
 * the game every frame) and the renderer (which draws it):
 *  - shockwaves: expanding screen-space distortion rings (explosions, boss slams)
 *  - heat: shimmer spots above lava
 *  - grade: per-area colour grading (lift / gamma / gain / saturation), eased
 *  - night: 0..1, darkens the screen edges a little on night stages
 */
export const MAX_WAVES = 6;
export const MAX_HEAT = 4;

export const postfxTuning = {
  /** Shockwave ring thickness as a fraction of its radius, and peak push in internal pixels. */
  waveWidth: 0.35,
  wavePx: 5,
  /** Heat shimmer amplitude in internal pixels. */
  heatPx: 0.9,
  /** Bloom: brightness threshold, soft knee and strength multiplier (times the GLOW setting). */
  bloomThreshold: 0.35,
  bloomKnee: 0.2,
  bloomStrength: 1.1,
  /** Night vignette strength. */
  nightVignette: 0.45,
  /** How fast the grade eases to a new area (per second). */
  gradeSpeed: 1.5,
};

export interface Grade {
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  saturation: number;
}

export const NEUTRAL_GRADE: Grade = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1 };

export const postfx = {
  /** Screen-space waves: (u, v, radius in screen heights, strength 0..1). */
  waves: new Float32Array(MAX_WAVES * 4),
  waveCount: 0,
  /** Heat spots: (u, v, radius in screen heights, strength 0..1). */
  heat: new Float32Array(MAX_HEAT * 4),
  heatCount: 0,
  /** Live grade (eased toward `target`). */
  lift: new THREE.Vector3(0, 0, 0),
  gamma: new THREE.Vector3(1, 1, 1),
  gain: new THREE.Vector3(1, 1, 1),
  saturation: 1,
  target: { ...NEUTRAL_GRADE } as Grade,
  night: 0,
  /** Distortion allowed (quality + the SHOCKWAVES setting). */
  distortion: true,
};

export function setGradeTarget(g: Grade): void {
  postfx.target = g;
}

/** Ease the live grade toward the target; `snap` jumps straight there. */
export function easeGrade(dt: number, snap = false): void {
  const t = postfx.target;
  const k = snap ? 1 : 1 - Math.exp(-postfxTuning.gradeSpeed * dt);
  postfx.lift.x += (t.lift[0] - postfx.lift.x) * k;
  postfx.lift.y += (t.lift[1] - postfx.lift.y) * k;
  postfx.lift.z += (t.lift[2] - postfx.lift.z) * k;
  postfx.gamma.x += (t.gamma[0] - postfx.gamma.x) * k;
  postfx.gamma.y += (t.gamma[1] - postfx.gamma.y) * k;
  postfx.gamma.z += (t.gamma[2] - postfx.gamma.z) * k;
  postfx.gain.x += (t.gain[0] - postfx.gain.x) * k;
  postfx.gain.y += (t.gain[1] - postfx.gain.y) * k;
  postfx.gain.z += (t.gain[2] - postfx.gain.z) * k;
  postfx.saturation += (t.saturation - postfx.saturation) * k;
}

/** Blend two grades (for night over the area grade). Writes into `out`. */
export function mixGrade(a: Grade, b: Grade, k: number, out: Grade): Grade {
  for (let i = 0; i < 3; i++) {
    out.lift[i] = a.lift[i] + (b.lift[i] - a.lift[i]) * k;
    out.gamma[i] = a.gamma[i] + (b.gamma[i] - a.gamma[i]) * k;
    out.gain[i] = a.gain[i] + (b.gain[i] - a.gain[i]) * k;
  }
  out.saturation = a.saturation + (b.saturation - a.saturation) * k;
  return out;
}

/** Apply a grade to one colour channel value (same maths as the shader; for tests). */
export function gradeChannel(c: number, lift: number, gamma: number, gain: number): number {
  const v = Math.max(0, gain * (c + lift * (1 - c)));
  return Math.pow(v, 1 / gamma);
}

// ------------------------------------------------------------------ shaders

export const fullscreenVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Bright pass + 2x2 box downsample into the half-resolution bloom target. */
export const brightFrag = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uTexel; // scene texel
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
vec3 pick(vec2 o) {
  // Alpha is the glow mask (src/render/retroMaterial.ts): only self-lit pixels bloom,
  // so bright sand and snow stay crisp while bullets, lava, flashes and eyes glow.
  vec4 t = texture(tScene, vUv + o * uTexel);
  vec3 c = t.rgb * clamp(t.a, 0.0, 1.0);
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, b - uThreshold) / max(b, 1e-4);
  return c * w;
}
void main() {
  vec3 c = pick(vec2(-0.5, -0.5)) + pick(vec2(0.5, -0.5)) + pick(vec2(-0.5, 0.5)) + pick(vec2(0.5, 0.5));
  outColor = vec4(c * 0.25, 1.0);
}
`;

/** 9-tap Gaussian along one axis using 5 linear fetches. */
export const blurFrag = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir; // texel step along the blur axis
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 c = texture(tSrc, vUv).rgb * 0.227027;
  c += (texture(tSrc, vUv + uDir * 1.384615).rgb + texture(tSrc, vUv - uDir * 1.384615).rgb) * 0.316216;
  c += (texture(tSrc, vUv + uDir * 3.230769).rgb + texture(tSrc, vUv - uDir * 3.230769).rgb) * 0.070270;
  outColor = vec4(c, 1.0);
}
`;

/** Final composite: distortion, glow/bloom, grading, saturation, colour depth + dither, CRT. */
export const compositeFrag = /* glsl */ `
#define MAX_WAVES ${MAX_WAVES}
#define MAX_HEAT ${MAX_HEAT}
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBits;
uniform float uDither;
uniform float uSaturation;
uniform float uGlow;
uniform int uGlowMode; // 0 off, 1 cheap taps, 2 bloom
uniform float uCrt;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uTime;
uniform vec4 uWaves[MAX_WAVES];
uniform int uWaveCount;
uniform vec4 uHeat[MAX_HEAT];
uniform int uHeatCount;
uniform float uWaveWidth;
uniform float uWavePx;
uniform float uHeatPx;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uNight;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return m[i.x + i.y * 4] / 16.0 - 0.46875;
}

vec3 bright(vec2 uv, vec2 o) {
  vec3 c = texture(tScene, uv + o * uTexel).rgb;
  return max(c - 0.62, 0.0);
}

void main() {
  vec2 uv = vUv;
  // Shockwaves: a ring that pushes pixels outward as it expands.
  vec2 off = vec2(0.0);
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uWaveCount) break;
    vec4 w = uWaves[i];
    vec2 d = (uv - w.xy) * vec2(uAspect, 1.0);
    float dist = length(d);
    float band = w.z * uWaveWidth + 0.004;
    float x = (dist - w.z) / band;
    if (abs(x) < 1.0 && dist > 1e-4) {
      float k = (1.0 - x * x);
      off -= d / dist * k * k * w.w;
    }
  }
  off *= uWavePx * uTexel.y;
  // Heat shimmer: wobbly sideways offsets rising over hot spots.
  for (int i = 0; i < MAX_HEAT; i++) {
    if (i >= uHeatCount) break;
    vec4 h = uHeat[i];
    vec2 d = (uv - h.xy) * vec2(uAspect, 1.0);
    float f = 1.0 - smoothstep(0.0, h.z, length(d));
    if (f <= 0.0) continue;
    float s = sin(uv.y / uTexel.y * 0.55 - uTime * 7.0 + h.x * 40.0) + 0.5 * sin(uv.y / uTexel.y * 1.3 + uTime * 11.0);
    off.x += s * f * h.w * uHeatPx * uTexel.x;
    off.y += cos(uv.x / uTexel.x * 0.4 + uTime * 5.0) * f * h.w * uHeatPx * 0.5 * uTexel.y;
  }
  uv += off;

  vec3 col = texture(tScene, uv).rgb;
  if (uGlowMode == 2) {
    col += texture(tBloom, uv).rgb * uGlow;
  } else if (uGlowMode == 1) {
    // Cheap glow: bright neighbours at three radii bleed into this pixel.
    vec3 g = bright(uv, vec2(2.0, 0.0)) + bright(uv, vec2(-2.0, 0.0)) + bright(uv, vec2(0.0, 2.0)) + bright(uv, vec2(0.0, -2.0));
    g += 0.6 * (bright(uv, vec2(3.0, 3.0)) + bright(uv, vec2(-3.0, 3.0)) + bright(uv, vec2(3.0, -3.0)) + bright(uv, vec2(-3.0, -3.0)));
    g += 0.4 * (bright(uv, vec2(5.0, 0.0)) + bright(uv, vec2(-5.0, 0.0)) + bright(uv, vec2(0.0, 5.0)) + bright(uv, vec2(0.0, -5.0)));
    col += g * uGlow * 0.45;
  }
  // Grade: lift / gamma / gain per area.
  col = max(uGain * (col + uLift * (1.0 - col)), 0.0);
  col = pow(col, 1.0 / uGamma);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(mix(vec3(luma), col, uSaturation), 0.0, 1.0);
  if (uNight > 0.0) {
    vec2 d = vUv - 0.5;
    col *= 1.0 - uNight * pow(clamp(dot(d * vec2(uAspect * 0.75, 1.0), d * vec2(uAspect * 0.75, 1.0)) * 2.6, 0.0, 1.0), 1.5);
  }
  float levels = exp2(uBits) - 1.0;
  col += bayer4(gl_FragCoord.xy) * uDither / levels;
  col = floor(col * levels + 0.5) / levels;
  if (uCrt > 0.0) {
    // Every other line a little darker, plus a soft vignette.
    col *= 1.0 - uCrt * 0.22 * step(1.0, mod(gl_FragCoord.y, 2.0));
    vec2 d = vUv - 0.5;
    col *= 1.0 - uCrt * 0.5 * pow(dot(d, d) * 2.2, 1.6);
  }
  outColor = vec4(col, 1.0);
}
`;
