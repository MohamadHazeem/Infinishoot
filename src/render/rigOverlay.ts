import * as THREE from 'three';
import { retroGlobals, createRetroMaterial, type RetroMaterial } from './retroMaterial';
import { outlineState, outlineTuning, outlineUniforms } from './outlines';
import { makeTexture } from './textures';

/**
 * Hero readability overlay (readability lane), one per hero rig:
 *
 *  - Outline: every solid rig part merged into ONE inverted-hull mesh. A part
 *    index per vertex picks that part's world matrix from a uniform array that
 *    is refreshed right before the draw, so the merged hull follows the
 *    procedural animation. 1 draw call instead of one hull per part (~26).
 *  - X-ray: the same merged geometry drawn twice more with the depth test
 *    inverted (GreaterDepth) right before the hero itself, so it only shows
 *    where something (enemies, cover) stands in front of the hero: a dark rim
 *    pushed out 2 pixels, then the body as a two-tone pixel checker in the
 *    player colour. Works for every hero on every machine (pure presentation).
 *  - Ground ring: an unlit pixel-art ring in the player colour with a dark
 *    border and a notch toward the aim, readable on every biome and at night.
 *
 * Draw order (opaque pass): scene (renderOrder 0) -> x-ray rim (49) -> x-ray
 * fill (50) -> hero parts (51) -> outline hull (52). 4 draws per hero in all. The x-ray must run after everything that can hide
 * the hero and before the hero writes its own depth.
 */
export const heroMarkerTuning = {
  /** Show the hero through enemies and cover. */
  xray: true,
  /** X-ray fill push and its dark rim push (internal pixels at 270p, like outlines). */
  xrayPx: 0,
  xrayRimPx: 2,
  /** X-ray rim colour (drawn only where the hero is hidden). */
  xrayRim: '#1a1c2c',
  /** How far (m, toward the camera) something must stand in front before the x-ray shows (no flicker on the ground). */
  xrayBias: 0.25,
  /** Bright checker tone: player colour mixed toward white. */
  xrayLight: 0.55,
  /** Dark checker tone: player colour scaled down. */
  xrayDark: 0.35,
  ring: true,
  /** Ground ring radius (m). */
  ringRadius: 0.95,
  /** 0..1 how much the ring ignores light (1 = always full colour, also at night). */
  ringUnlit: 0.9,
  /** Solo hero marker colour (co-op uses each player's colour). */
  soloColor: '#73eff7',
};

/** Max rig parts in one merged mesh (mat4 uniforms: 4 vectors each, WebGL2 guarantees 256). */
export const MAX_RIG_PARTS = 48; // Ronin and Tinker carry their mechanic plus wardrobe (44 parts)

const vert = /* glsl */ `
#define MAX_PARTS ${MAX_RIG_PARTS}
uniform mat4 uParts[MAX_PARTS];
uniform vec2 uSnapRes;
uniform float uSnapPx;
uniform float uFogNear;
uniform float uFogFar;
uniform float uPx;
uniform float uBias;
uniform vec3 uOutlineColor;
uniform vec3 uNightColor;
uniform float uNight;
uniform float uNightMix;
in float partIndex;
out vec3 vCol;
out float vFog;

void main() {
  mat4 m = uParts[int(partIndex + 0.5)];
  vec3 n0 = mat3(m) * normal;
  float nl = length(n0);
  if (nl < 1e-6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // hidden part
  vec4 wp = m * vec4(position, 1.0);
  vec3 n = n0 / nl;
  vec4 mv = viewMatrix * wp;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  vCol = mix(uOutlineColor, uNightColor, uNight * uNightMix);
  mv.z += uBias;
  vec4 clip = projectionMatrix * mv;
  if (uSnapPx > 0.0 && clip.w > 0.0) {
    vec2 grid = uSnapRes * 0.5 / uSnapPx;
    clip.xy = round(clip.xy / clip.w * grid) / grid * clip.w;
  }
  vec2 cn = (projectionMatrix * viewMatrix * vec4(n, 0.0)).xy;
  float l = length(cn);
  if (l > 1e-5) clip.xy += cn / l * uPx * 2.0 / uSnapRes * clip.w;
  gl_Position = clip;
}
`;

const hullFrag = /* glsl */ `
uniform vec3 uFogColor;
in vec3 vCol;
in float vFog;
layout(location = 0) out vec4 outColor;
void main() {
  outColor = vec4(mix(vCol, uFogColor, vFog), 1.0);
}
`;

const xrayFrag = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uDark;
in vec3 vCol;
in float vFog;
layout(location = 0) out vec4 outColor;
void main() {
  // Pixel checker in two tones: reads on light and dark backgrounds alike.
  float c = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0);
  outColor = vec4(c < 0.5 ? uLight : uDark, 0.25);
}
`;

const ringTexture = (() => {
  let tex: THREE.Texture | null = null;
  return () =>
    (tex ??= makeTexture(32, (ctx, s) => {
      const img = ctx.createImageData(s, s);
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const dx = x + 0.5 - s / 2;
          const dy = y + 0.5 - s / 2;
          const d = Math.hypot(dx, dy);
          // Notch toward the aim: the hero faces +Z, which is the bottom of the canvas.
          const notch = dy > 9 && Math.abs(dx) < 16.5 - dy && d < 16;
          let v = -1; // -1 = empty
          if ((d >= 11 && d < 13.5) || (notch && Math.abs(dx) < 15.5 - dy)) v = 255;
          else if ((d >= 10 && d < 14.5) || notch) v = 34;
          const o = (y * s + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, v);
          img.data[o + 3] = v < 0 ? 0 : 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }));
})();

/** Is this object and every ancestor up to the rig root visible? */
function shown(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
}

function solid(m: THREE.Mesh): boolean {
  const mat = m.material as THREE.ShaderMaterial;
  if (Array.isArray(mat) || mat.transparent || !m.geometry.attributes.normal) return false;
  return !mat.uniforms?.uMap?.value; // painted face decal and other textured planes
}

/** Merge parts (each in its own local space) into one geometry with a per-vertex part index. */
export function mergeRigParts(parts: { geometry: THREE.BufferGeometry; index: number }[]): THREE.BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.geometry.attributes.position.count;
    ni += p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const part = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0;
  let i = 0;
  for (const p of parts) {
    const g = p.geometry;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    for (let k = 0; k < P.count; k++) {
      pos[(v + k) * 3] = P.getX(k);
      pos[(v + k) * 3 + 1] = P.getY(k);
      pos[(v + k) * 3 + 2] = P.getZ(k);
      nrm[(v + k) * 3] = N.getX(k);
      nrm[(v + k) * 3 + 1] = N.getY(k);
      nrm[(v + k) * 3 + 2] = N.getZ(k);
      part[v + k] = p.index;
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[i++] = v + g.index.getX(k);
    else for (let k = 0; k < P.count; k++) idx[i++] = v + k;
    v += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('partIndex', new THREE.BufferAttribute(part, 1));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const WHITE = new THREE.Color(1, 1, 1);

export class RigOverlay {
  private parts: THREE.Mesh[] = [];
  private modelRevision = -1;
  private mats: THREE.Matrix4[] = [];
  private hull: THREE.Mesh | null = null;
  private xray: THREE.Mesh | null = null;
  private xrayRim: THREE.Mesh | null = null;
  readonly ring: THREE.Mesh;
  private ringMat: RetroMaterial;
  private hullMat: THREE.ShaderMaterial;
  private xrayMat: THREE.ShaderMaterial;
  private xrayRimMat: THREE.ShaderMaterial;
  private meshCount = 0;
  private syncedFrame = -1;
  private frame = 0;
  private color = new THREE.Color();

  constructor(private root: THREE.Object3D) {
    for (let i = 0; i < MAX_RIG_PARTS; i++) this.mats.push(new THREE.Matrix4().copy(ZERO));
    const shared = {
      uParts: { value: this.mats },
      uSnapRes: retroGlobals.uSnapRes,
      uSnapPx: retroGlobals.uSnapPx,
      uFogNear: retroGlobals.uFogNear,
      uFogFar: retroGlobals.uFogFar,
      uFogColor: retroGlobals.uFogColor,
      uNight: retroGlobals.uNight,
      uOutlineColor: outlineUniforms.uOutlineColor,
      uNightColor: outlineUniforms.uNightOutlineColor,
      uNightMix: outlineUniforms.uNightOutline,
    };
    this.hullMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: hullFrag,
      side: THREE.BackSide,
      uniforms: { ...shared, uPx: outlineUniforms.uOutlinePx, uBias: { value: 0 } },
    });
    this.xrayMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vert,
      fragmentShader: xrayFrag,
      side: THREE.BackSide,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      uniforms: { ...shared, uPx: { value: 1 }, uBias: { value: 0.25 }, uLight: { value: new THREE.Color() }, uDark: { value: new THREE.Color() } },
    });
    this.xrayRimMat = this.xrayMat.clone();
    this.xrayRimMat.uniforms = { ...shared, uPx: { value: 2 }, uBias: this.xrayMat.uniforms.uBias, uLight: { value: new THREE.Color() }, uDark: { value: new THREE.Color() } };
    this.ringMat = createRetroMaterial({ map: ringTexture(), alphaTest: 0.5, unlit: heroMarkerTuning.ringUnlit });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.name = 'heroRing';
    this.ring.position.y = 0.03;
    this.ring.userData.rigOverlay = true;
    this.ring.raycast = () => {};
    root.add(this.ring);
    this.build();
  }

  /** (Re)build the merged meshes from the rig's current parts. */
  private build(): void {
    this.modelRevision = this.root.userData.modelRevision ?? 0;
    this.parts = [];
    let count = 0;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.rigOverlay) return;
      count++;
      if (solid(m) && this.parts.length < MAX_RIG_PARTS) this.parts.push(m);
      m.renderOrder = 51; // after the x-ray
    });
    this.meshCount = count;
    for (const m of [this.hull, this.xray, this.xrayRim]) {
      if (!m) continue;
      m.removeFromParent();
      m.geometry.dispose();
    }
    const all = this.parts.map((m, index) => ({ geometry: m.geometry, index }));
    const big = all.filter(({ geometry: g }) => {
      if (!g.boundingSphere) g.computeBoundingSphere();
      return (g.boundingSphere?.radius ?? 1) >= outlineTuning.minPartRadius; // tiny bits only add noise
    });
    const sync = () => this.sync();
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number, name: string) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.frustumCulled = false; // vertices are placed in world space by the shader
      m.renderOrder = order;
      m.userData.rigOverlay = true;
      m.raycast = () => {};
      m.onBeforeRender = sync;
      this.root.add(m);
      return m;
    };
    const xgeo = mergeRigParts(all);
    this.xrayRim = make(xgeo, this.xrayRimMat, 49, 'heroXrayRim');
    this.xray = make(xgeo, this.xrayMat, 50, 'heroXray');
    this.hull = make(mergeRigParts(big), this.hullMat, 52, 'heroOutline');
  }

  /** Copy every part's world matrix into the uniform array (once per frame, right before the first draw). */
  private sync(): void {
    if (this.syncedFrame === this.frame) return;
    this.syncedFrame = this.frame;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      this.mats[i].copy(shown(p, this.root) ? p.matrixWorld : ZERO);
    }
  }

  /** Per rendered frame, before the scene renders. */
  update(color: THREE.ColorRepresentation, ringVisible: boolean): void {
    this.frame++;
    if (this.modelRevision !== (this.root.userData.modelRevision ?? 0)) this.build();
    // A rig that grows or loses parts (new hero bodies, gear) gets re-merged.
    if ((this.frame & 31) === 0) {
      let n = 0;
      this.root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !o.userData.rigOverlay) n++;
      });
      if (n !== this.meshCount) this.build();
    }
    const T = heroMarkerTuning;
    const c = this.color.set(color);
    const u = this.xrayMat.uniforms;
    u.uLight.value.copy(c).lerp(WHITE, T.xrayLight);
    u.uDark.value.copy(c).multiplyScalar(T.xrayDark);
    u.uBias.value = T.xrayBias;
    const k = Math.max(1, retroGlobals.uSnapRes.value.y / 270); // pixels scale with the internal resolution, like outlines
    u.uPx.value = k * T.xrayPx;
    const r = this.xrayRimMat.uniforms;
    r.uPx.value = k * T.xrayRimPx;
    r.uLight.value.set(T.xrayRim);
    r.uDark.value.set(T.xrayRim);
    this.xrayMat.visible = this.xrayRimMat.visible = T.xray;
    this.hullMat.visible = outlineState.on;
    this.ringMat.uniforms.uColor.value.copy(c);
    this.ringMat.uniforms.uUnlit.value = T.ringUnlit;
    this.ring.visible = T.ring && ringVisible;
    this.ring.scale.setScalar(T.ringRadius); // the ring is a child of the rig root, so its notch turns with the aim
  }

  dispose(): void {
    for (const m of [this.hull, this.xray, this.xrayRim, this.ring]) {
      if (!m) continue;
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.hullMat.dispose();
    this.xrayMat.dispose();
    this.xrayRimMat.dispose();
    this.ringMat.dispose();
  }
}
