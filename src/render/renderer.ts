import * as THREE from 'three';
import { retroGlobals } from './retroMaterial';

/**
 * Renders the scene into a low-resolution target, then runs a post pass
 * (colour-depth reduction + ordered dither + saturation) to the canvas.
 * The canvas drawing buffer stays at the internal resolution and is scaled
 * up by CSS with `image-rendering: pixelated`.
 */
export const postSettings = {
  /** Internal vertical resolution; 0 = native window resolution. */
  resolution: 270,
  colorBits: 5,
  dither: 0.5,
  saturation: 1.15,
  /** Soft glow around bright pixels (0 = off). */
  glow: 0.4,
  /** CRT look: scanlines and a vignette (0 = off, 1 = full). */
  crt: 0,
};

const postVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const postFrag = /* glsl */ `
uniform sampler2D tScene;
uniform float uBits;
uniform float uDither;
uniform float uSaturation;
uniform float uGlow;
uniform float uCrt;
uniform vec2 uTexel;
in vec2 vUv;
layout(location = 0) out vec4 outColor;

float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return m[i.x + i.y * 4] / 16.0 - 0.46875;
}

vec3 bright(vec2 o) {
  vec3 c = texture(tScene, vUv + o * uTexel).rgb;
  return max(c - 0.62, 0.0);
}

void main() {
  vec3 col = texture(tScene, vUv).rgb;
  // Cheap glow: bright neighbours at two radii bleed into this pixel.
  if (uGlow > 0.0) {
    vec3 g = bright(vec2(2.0, 0.0)) + bright(vec2(-2.0, 0.0)) + bright(vec2(0.0, 2.0)) + bright(vec2(0.0, -2.0));
    g += 0.6 * (bright(vec2(3.0, 3.0)) + bright(vec2(-3.0, 3.0)) + bright(vec2(3.0, -3.0)) + bright(vec2(-3.0, -3.0)));
    g += 0.4 * (bright(vec2(5.0, 0.0)) + bright(vec2(-5.0, 0.0)) + bright(vec2(0.0, 5.0)) + bright(vec2(0.0, -5.0)));
    col += g * uGlow * 0.45;
  }
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = clamp(mix(vec3(luma), col, uSaturation), 0.0, 1.0);
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

export class RetroRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly width = { value: 0 };
  readonly height = { value: 0 };
  private target: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat: THREE.ShaderMaterial;

  constructor(canvas: HTMLCanvasElement) {
    THREE.ColorManagement.enabled = false;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setPixelRatio(1);
    this.gl.info.autoReset = false;

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });

    this.postMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: postVert,
      fragmentShader: postFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uBits: { value: postSettings.colorBits },
        uDither: { value: postSettings.dither },
        uSaturation: { value: postSettings.saturation },
        uGlow: { value: postSettings.glow },
        uCrt: { value: postSettings.crt },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
    });
    // Single full-screen triangle.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(tri, this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    const h = postSettings.resolution > 0 ? Math.min(postSettings.resolution, ch) : ch;
    const w = Math.max(1, Math.round((h * cw) / ch));
    this.width.value = w;
    this.height.value = h;
    this.gl.setSize(w, h, false);
    this.target.setSize(w, h);
    this.postMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    retroGlobals.uSnapRes.value.set(w, h);
  }

  get aspect(): number {
    return this.width.value / this.height.value;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.gl.info.reset();
    const u = this.postMat.uniforms;
    u.uBits.value = postSettings.colorBits;
    u.uDither.value = postSettings.dither;
    u.uSaturation.value = postSettings.saturation;
    u.uGlow.value = postSettings.glow;
    u.uCrt.value = postSettings.crt;

    this.gl.setRenderTarget(this.target);
    this.gl.render(scene, camera);
    this.gl.setRenderTarget(null);
    this.gl.render(this.postScene, this.postCam);
  }
}
