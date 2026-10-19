import * as THREE from 'three';

/**
 * Graphics-lane additions to the final composite (src/render/postfx.ts calls
 * `gfxPost()` after grading, before the colour-depth reduction):
 *  - Ink edges (ANIME LOOK): outlines on everything from the depth buffer.
 *    1/depth is linear across any flat surface on screen, so its Laplacian is
 *    ~0 on floors and walls and large at silhouettes and creases.
 *  - Speed lines (ANIME LOOK): manga motion lines along the local hero's dash.
 *  - Impact frames (ANIME LOOK): 1-2 frames of stark black and white on big
 *    crits and heavy hits (never with REDUCE FLASHING).
 *  - Light shafts (dark stages): radial light scattering from up to two
 *    bright lights, so beams cut through the volumetric fog.
 * Values are written by src/game/systems/graphics.ts every frame; all of it
 * is off (and costs a uniform test) unless switched on.
 */
export const MAX_SHAFTS = 2;

export const gfxPostUniforms = {
  tDepth: { value: null as THREE.Texture | null },
  /** Camera near, far. */
  uNearFar: { value: new THREE.Vector2(0.5, 120) },
  /** Ink: strength 0..1, width (internal px), threshold, distance fade. */
  uInk: { value: new THREE.Vector4(0, 1, 0.06, 0) },
  uInkColor: { value: new THREE.Color('#1a1c2c') },
  /** Speed lines: strength 0..1, direction on screen (x, y), seed. */
  uSpeed: { value: new THREE.Vector4(0, 1, 0, 0) },
  /** Speed lines keep clear of this screen point (the hero): u, v, clear radius (screen heights). */
  uSpeedCenter: { value: new THREE.Vector3(0.5, 0.5, 0.18) },
  /** Impact frame: amount 0..1, inverted 0/1, threshold. */
  uImpact: { value: new THREE.Vector3(0, 0, 0.42) },
  /** Light shafts: (u, v, strength, length) per light. */
  uShafts: { value: new Float32Array(MAX_SHAFTS * 4) },
  uShaftCount: { value: 0 },
};

export const GFX_POST_GLSL = /* glsl */ `
#define MAX_SHAFTS ${MAX_SHAFTS}
uniform sampler2D tDepth;
uniform vec2 uNearFar;
uniform vec4 uInk;
uniform vec3 uInkColor;
uniform vec4 uSpeed;
uniform vec3 uSpeedCenter;
uniform vec3 uImpact;
uniform vec4 uShafts[MAX_SHAFTS];
uniform int uShaftCount;

float gfxInvDepth(vec2 uv) {
  float d = texture(tDepth, uv).r;
  float z = d * 2.0 - 1.0;
  float n = uNearFar.x;
  float f = uNearFar.y;
  // 1 / linear view depth (affine across planes on screen).
  return (f + n - z * (f - n)) / (2.0 * n * f);
}

float gfxHash(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 15731.743); }

vec3 gfxPost(vec3 col, vec2 uv, vec2 texel, float aspect) {
  // Light shafts: march toward each light, gathering bright pixels (occluders leave dark streaks).
  for (int i = 0; i < MAX_SHAFTS; i++) {
    if (i >= uShaftCount) break;
    vec4 s = uShafts[i];
    vec2 dir = (s.xy - uv);
    float dist = length(dir * vec2(aspect, 1.0));
    if (dist > s.w) continue;
    vec2 stepv = dir / 10.0;
    vec2 p = uv;
    float acc = 0.0;
    float w = 1.0;
    for (int k = 0; k < 10; k++) {
      p += stepv;
      vec3 c = texture(tScene, p).rgb;
      acc += max(max(c.r, max(c.g, c.b)) - 0.5, 0.0) * w;
      w *= 0.88;
    }
    float fall = 1.0 - smoothstep(0.0, s.w, dist);
    col += texture(tScene, s.xy).rgb * acc * fall * s.z * 0.12;
  }
  // Ink edges from the depth buffer.
  if (uInk.x > 0.0) {
    vec2 o = texel * uInk.y;
    float c = gfxInvDepth(uv);
    float l = gfxInvDepth(uv - vec2(o.x, 0.0));
    float r = gfxInvDepth(uv + vec2(o.x, 0.0));
    float d = gfxInvDepth(uv - vec2(0.0, o.y));
    float u = gfxInvDepth(uv + vec2(0.0, o.y));
    // Negative = this pixel is nearer than its neighbours: only the near side of a silhouette
    // draws, so lines don't double up. Thin things (rain streaks, motes: farther on both sides
    // along an axis) are left alone so weather doesn't turn into ink scratches.
    float lap = (l + r + d + u - 4.0 * c) / max(c, 1e-5);
    float tol = c * uInk.z * 0.5;
    float thin = max(step(l, c - tol) * step(r, c - tol), step(d, c - tol) * step(u, c - tol));
    float edge = smoothstep(uInk.z, uInk.z * 2.0, -lap) * (1.0 - thin);
    float far = 1.0 - smoothstep(0.0, 1.0, (1.0 / c) * uInk.w);
    col = mix(col, uInkColor, min(1.0, edge) * uInk.x * far);
  }
  // Speed lines: streaks along the dash, clear around the hero, re-rolled every few frames.
  if (uSpeed.x > 0.0) {
    vec2 sp = vec2(uv.x * aspect, uv.y);
    vec2 dir = normalize(uSpeed.yz);
    vec2 perp = vec2(-dir.y, dir.x);
    float across = dot(sp, perp) * 140.0;
    float along = dot(sp, dir);
    float id = floor(across);
    float on = step(0.9, gfxHash(vec2(id, uSpeed.w)));
    float seg = step(0.45, gfxHash(vec2(id, floor(along * 5.0 + gfxHash(vec2(id, 3.0)) * 5.0 + uSpeed.w))));
    vec2 dc = (uv - uSpeedCenter.xy) * vec2(aspect, 1.0);
    float clear = smoothstep(uSpeedCenter.z, uSpeedCenter.z * 2.2, length(dc));
    col = mix(col, vec3(0.96), on * seg * clear * uSpeed.x * 0.75);
  }
  // Impact frame: stark two-tone (inverted on alternate frames).
  if (uImpact.x > 0.0) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float bw = step(uImpact.z, lum);
    if (uImpact.y > 0.5) bw = 1.0 - bw;
    vec3 tone = mix(uInkColor, vec3(0.96, 0.96, 0.94), bw);
    col = mix(col, tone, uImpact.x);
  }
  return col;
}
`;
