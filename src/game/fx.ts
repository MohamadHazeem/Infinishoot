import * as THREE from 'three';
import { commit } from '../render/instancing';
import { retroGlobals } from '../render/retroMaterial';

/**
 * Comic impact effects drawn with additive blending:
 *  - stars: camera-facing "POW" bursts at hit points
 *  - rings: flat shockwaves on the ground (kills, explosions, bomb)
 * Each kind is one InstancedMesh. Fading = scaling colour toward black,
 * which is invisible under additive blending.
 */
const MAX = 160;

interface FxPool {
  mesh: THREE.InstancedMesh;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  t: Float32Array;
  life: Float32Array;
  size: Float32Array;
  grow: Float32Array; // ring: end size multiplier
  rot: Float32Array;
  colors: THREE.Color[];
  count: number;
}

function starGeometry(points: number, inner: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.5 * inner;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(shape);
}

function makePool(scene: THREE.Scene, geo: THREE.BufferGeometry): FxPool {
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const colors: THREE.Color[] = [];
  for (let i = 0; i < MAX; i++) {
    colors.push(new THREE.Color());
    mesh.setColorAt(i, colors[i]);
  }
  mesh.count = 0;
  scene.add(mesh);
  const f = () => new Float32Array(MAX);
  return { mesh, x: f(), y: f(), z: f(), t: f(), life: f(), size: f(), grow: f(), rot: f(), colors, count: 0 };
}

export class Fx {
  private stars: FxPool;
  private rings: FxPool;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qz = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private zAxis = new THREE.Vector3(0, 0, 1);
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.stars = makePool(scene, starGeometry(5, 0.42));
    this.rings = makePool(scene, new THREE.RingGeometry(0.42, 0.5, 24).rotateX(-Math.PI / 2));
  }

  private add(p: FxPool, x: number, y: number, z: number, size: number, life: number, color: THREE.ColorRepresentation, grow = 1) {
    if (p.count >= MAX) return;
    const i = p.count++;
    p.x[i] = x;
    p.y[i] = y;
    p.z[i] = z;
    p.t[i] = 0;
    p.life[i] = life;
    p.size[i] = size;
    p.grow[i] = grow;
    p.rot[i] = Math.random() * Math.PI;
    p.colors[i].set(color);
  }

  /** Camera-facing comic star burst. */
  star(x: number, y: number, z: number, size: number, color: THREE.ColorRepresentation = '#ffffff', life = 0.12) {
    this.add(this.stars, x, y, z, size, life, color);
  }

  /** Expanding ground shockwave from `size` to `size * grow`. */
  ring(x: number, z: number, size: number, grow: number, color: THREE.ColorRepresentation, life = 0.3) {
    this.add(this.rings, x, 0.06, z, size, life, color, grow);
  }

  clear(): void {
    this.stars.count = this.rings.count = 0;
  }

  update(dt: number): void {
    for (const p of [this.stars, this.rings]) {
      for (let i = 0; i < p.count; i++) {
        p.t[i] += dt;
        if (p.t[i] < p.life[i]) continue;
        const j = --p.count;
        p.x[i] = p.x[j];
        p.y[i] = p.y[j];
        p.z[i] = p.z[j];
        p.t[i] = p.t[j];
        p.life[i] = p.life[j];
        p.size[i] = p.size[j];
        p.grow[i] = p.grow[j];
        p.rot[i] = p.rot[j];
        p.colors[i].copy(p.colors[j]);
        i--;
      }
    }
  }

  render(camera: THREE.Camera): void {
    // Stars: pop to full size fast, then shrink while fading.
    const st = this.stars;
    for (let i = 0; i < st.count; i++) {
      const k = st.t[i] / st.life[i];
      const sc = st.size[i] * (k < 0.25 ? 0.5 + k * 3 : 1.25 - (k - 0.25) * 0.6);
      this.qz.setFromAxisAngle(this.zAxis, st.rot[i] + k * 0.6);
      this.q.copy(camera.quaternion).multiply(this.qz);
      this.m4.compose(this.v.set(st.x[i], st.y[i], st.z[i]), this.q, this.s.set(sc, sc, sc));
      st.mesh.setMatrixAt(i, this.m4);
      st.mesh.setColorAt(i, this.c.copy(st.colors[i]).multiplyScalar(1 - k * k));
    }
    // Rings: ease-out expansion.
    const rg = this.rings;
    for (let i = 0; i < rg.count; i++) {
      const k = rg.t[i] / rg.life[i];
      const e = 1 - (1 - k) * (1 - k);
      const sc = rg.size[i] * (1 + (rg.grow[i] - 1) * e);
      this.m4.makeScale(sc, 1, sc).setPosition(rg.x[i], rg.y[i], rg.z[i]);
      rg.mesh.setMatrixAt(i, this.m4);
      rg.mesh.setColorAt(i, this.c.copy(rg.colors[i]).multiplyScalar(1 - k));
    }
    for (const p of [st, rg]) {
      p.mesh.count = p.count;
      commit(p.mesh.instanceMatrix, p.mesh.count);
      if (p.mesh.instanceColor) commit(p.mesh.instanceColor, p.mesh.count);
    }
  }
}

// ---------------------------------------------------------------------------
// Sprite pools: soft camera-facing or ground-flat quads with per-instance
// colour and alpha (smoke, dust, sparks, ripples, glints, decals). One draw
// call per pool; callers rebuild the live list every frame (begin/push/end).

export interface SpritePoolOptions {
  max: number;
  map: THREE.Texture;
  /** 'billboard' faces the camera, 'flat' lies on the ground (XZ plane). */
  mode: 'billboard' | 'flat';
  additive?: boolean;
  /** Texture atlas cells laid out left to right. */
  frames?: number;
  renderOrder?: number;
}

const spriteVert = /* glsl */ `
uniform float uFogNear;
uniform float uFogFar;
uniform float uFrames;
uniform float uFlat;
in vec4 iPos;  // x, y, z, size
in vec4 iCol;  // r, g, b, alpha
in vec3 iExt;  // rotation, atlas frame, stretch (local y scale)
out vec2 vUv;
out vec4 vCol;
out float vFog;
void main() {
  float c = cos(iExt.x);
  float s = sin(iExt.x);
  vec2 p = position.xy * vec2(1.0, iExt.z);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * iPos.w;
  vec4 mv;
  if (uFlat > 0.5) mv = viewMatrix * vec4(iPos.x + p.x, iPos.y, iPos.z - p.y, 1.0);
  else {
    mv = viewMatrix * vec4(iPos.xyz, 1.0);
    mv.xy += p;
  }
  vUv = vec2((uv.x + iExt.y) / uFrames, uv.y);
  vCol = iCol;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const spriteFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uAdd;
in vec2 vUv;
in vec4 vCol;
in float vFog;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 t = texture(uMap, vUv);
  float a = t.a * vCol.a;
  if (a < 0.02) discard;
  vec3 col = t.rgb * vCol.rgb;
  if (uAdd > 0.5) col *= 1.0 - vFog;
  else col = mix(col, uFogColor, vFog);
  outColor = vec4(col, a);
}
`;

export class SpritePool {
  readonly mesh: THREE.Mesh;
  readonly max: number;
  count = 0;
  private geo: THREE.InstancedBufferGeometry;
  private pos: THREE.InstancedBufferAttribute;
  private col: THREE.InstancedBufferAttribute;
  private ext: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, o: SpritePoolOptions) {
    this.max = o.max;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    const attr = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(o.max * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.pos = attr(4);
    this.col = attr(4);
    this.ext = attr(3);
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iCol', this.col);
    this.geo.setAttribute('iExt', this.ext);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uMap: { value: o.map },
        uFrames: { value: o.frames ?? 1 },
        uFlat: { value: o.mode === 'flat' ? 1 : 0 },
        uAdd: { value: o.additive ? 1 : 0 },
        // Shared by reference with every retro material, so sprites fog like the world.
        uFogColor: retroGlobals.uFogColor,
        uFogNear: retroGlobals.uFogNear,
        uFogFar: retroGlobals.uFogFar,
      },
    });
    if (o.mode === 'flat') {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = -2;
      mat.polygonOffsetUnits = -2;
    }
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder ?? 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  begin(): void {
    this.count = 0;
  }

  /** Add one sprite for this frame. Colour is 0..1 floats. */
  push(x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number, rot = 0, frame = 0, stretch = 1): void {
    if (this.count >= this.max || a <= 0.01 || size <= 0) return;
    const i = this.count++;
    const p = this.pos.array as Float32Array;
    const c = this.col.array as Float32Array;
    const e = this.ext.array as Float32Array;
    p[i * 4] = x;
    p[i * 4 + 1] = y;
    p[i * 4 + 2] = z;
    p[i * 4 + 3] = size;
    c[i * 4] = r;
    c[i * 4 + 1] = g;
    c[i * 4 + 2] = b;
    c[i * 4 + 3] = a;
    e[i * 3] = rot;
    e[i * 3 + 1] = frame;
    e[i * 3 + 2] = stretch;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    commit(this.pos, this.count);
    commit(this.col, this.count);
    commit(this.ext, this.count);
  }
}

/** A small nearest-filtered RGBA texture drawn pixel by pixel: `f(x, y)` returns [r, g, b, a] in 0..1. */
export function pixelTexture(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, gg, b, a] = f(x, y);
      const o = (y * w + x) * 4;
      img.data[o] = Math.round(r * 255);
      img.data[o + 1] = Math.round(gg * 255);
      img.data[o + 2] = Math.round(b * 255);
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Shared sprite art (built once, on first use). */
let spriteArt: { puff: THREE.Texture; glint: THREE.Texture; ring: THREE.Texture; marks: THREE.Texture } | null = null;

export function spriteTextures(): NonNullable<typeof spriteArt> {
  if (spriteArt) return spriteArt;
  // Puff: a round cartoon cloud with a lit upper-left and a dithered rim.
  const puff = pixelTexture(16, 16, (x, y) => {
    const dx = (x + 0.5 - 8) / 8;
    const dy = (y + 0.5 - 8) / 8;
    const d = Math.hypot(dx, dy);
    const shade = d < 0.62 && dx + dy < -0.35 ? 1 : dx + dy > 0.55 ? 0.72 : 0.86;
    let a = d < 0.62 ? 1 : d < 0.82 ? 0.8 : d < 1 ? ((x + y) % 2 === 0 ? 0.5 : 0) : 0;
    if (d >= 0.62 && d < 0.82 && (x + y) % 2 === 0) a = 0.6;
    return [shade, shade, shade, a];
  });
  // Glint: a four-point twinkle with a white core and a blue outline, so it reads on snow too.
  const glint = pixelTexture(11, 11, (x, y) => {
    const dx = Math.abs(x - 5);
    const dy = Math.abs(y - 5);
    const arm = (dx === 0 && dy <= 4) || (dy === 0 && dx <= 4) || (dx === 1 && dy === 1);
    if (arm) return [1, 1, 1, 1];
    const edge = (dx <= 1 && dy <= 5) || (dy <= 1 && dx <= 5) || (dx <= 2 && dy <= 2);
    return edge ? [0.25, 0.65, 0.96, 1] : [0, 0, 0, 0];
  });
  // Ring: a thin outline circle for ripples and splashes.
  const ring = pixelTexture(16, 16, (x, y) => {
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
    return [1, 1, 1, d > 6 && d < 7.6 ? 1 : d > 5.2 && d <= 6 ? 0.35 : 0];
  });
  // Ground marks atlas: [0] boot print, [1] scorch blob.
  const marks = pixelTexture(32, 16, (x, y) => {
    if (x < 16) {
      // Boot print: oval sole with a gap before the heel.
      const sole = ((x + 0.5 - 8) / 3.2) ** 2 + ((y + 0.5 - 6) / 4.4) ** 2 < 1;
      const heel = ((x + 0.5 - 8) / 2.8) ** 2 + ((y + 0.5 - 12.5) / 2) ** 2 < 1;
      return [1, 1, 1, sole || heel ? 1 : 0];
    }
    const dx = x - 16 + 0.5 - 8;
    const dy = y + 0.5 - 8;
    const d = Math.hypot(dx, dy) / 8;
    const wob = 0.82 + 0.1 * Math.cos(Math.atan2(dy, dx) * 5);
    const a = d < wob * 0.6 ? 1 : d < wob ? ((x + y) % 2 === 0 ? 0.75 : 0.45) : 0;
    return [1, 1, 1, a];
  });
  spriteArt = { puff, glint, ring, marks };
  return spriteArt;
}
