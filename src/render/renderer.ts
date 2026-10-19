import * as THREE from 'three';
import { prepareShadows } from './shadows';
import { retroGlobals } from './retroMaterial';
import { renderQuality } from './quality';
import { setOutlines } from './outlines';
import { gfxPostUniforms } from './graphicsPost';
import { blurFrag, brightFrag, compositeFrag, fullscreenVert, postfx, postfxTuning } from './postfx';

/**
 * Renders the scene into a low-resolution target, then post-processes it to
 * the canvas: optional half-resolution bloom (bright pass + separable blur),
 * then one composite pass (shockwave / heat distortion, glow, per-area colour
 * grading, saturation, colour-depth reduction + ordered dither, CRT).
 * The canvas drawing buffer stays at the internal resolution and is scaled
 * up by CSS with `image-rendering: pixelated`.
 */
export const postSettings = {
  /** Internal vertical resolution; 0 = native window resolution. */
  resolution: 270,
  colorBits: 5,
  dither: 0.5,
  saturation: 1.15,
  /** Glow / bloom strength around bright pixels (0 = off). */
  glow: 0.4,
  /** CRT look: scanlines and a vignette (0 = off, 1 = full). */
  crt: 0,
};

function fullscreen(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: fullscreenVert,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
    uniforms,
  });
}

export class RetroRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly width = { value: 0 };
  readonly height = { value: 0 };
  private target: THREE.WebGLRenderTarget;
  private bloomA: THREE.WebGLRenderTarget;
  private bloomB: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private postMat: THREE.ShaderMaterial;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  /** Empty instanced pools hidden for this frame (three.js still binds their program and uniforms). */
  private idle: THREE.Object3D[] = [];

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
    // Read by the ink-edge pass (src/render/graphicsPost.ts).
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
    gfxPostUniforms.tDepth.value = this.target.depthTexture;
    const half = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, half);
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, half);

    this.postMat = fullscreen(compositeFrag, {
      tScene: { value: this.target.texture },
      tBloom: { value: this.bloomA.texture },
      uBits: { value: postSettings.colorBits },
      uDither: { value: postSettings.dither },
      uSaturation: { value: postSettings.saturation },
      uGlow: { value: postSettings.glow },
      uGlowMode: { value: 1 },
      uCrt: { value: postSettings.crt },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uAspect: { value: 16 / 9 },
      uTime: retroGlobals.uTime,
      uWaves: { value: postfx.waves },
      uWaveCount: { value: 0 },
      uHeat: { value: postfx.heat },
      uHeatCount: { value: 0 },
      uWaveWidth: { value: postfxTuning.waveWidth },
      uWavePx: { value: postfxTuning.wavePx },
      uHeatPx: { value: postfxTuning.heatPx },
      uLift: { value: postfx.lift },
      uGamma: { value: postfx.gamma },
      uGain: { value: postfx.gain },
      uNight: { value: 0 },
      ...gfxPostUniforms,
    });
    this.brightMat = fullscreen(brightFrag, {
      tScene: { value: this.target.texture },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uThreshold: { value: postfxTuning.bloomThreshold },
      uKnee: { value: postfxTuning.bloomKnee },
    });
    this.blurMat = fullscreen(blurFrag, {
      tSrc: { value: this.bloomA.texture },
      uDir: { value: new THREE.Vector2(1, 0) },
    });
    // Single full-screen triangle; its material is swapped per pass.
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri, this.postMat);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);

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
    const bw = Math.max(1, Math.ceil(w / 2));
    const bh = Math.max(1, Math.ceil(h / 2));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    this.postMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.postMat.uniforms.uAspect.value = w / h;
    this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    retroGlobals.uSnapRes.value.set(w, h);
  }

  get aspect(): number {
    return this.width.value / this.height.value;
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.gl.setRenderTarget(target);
    this.gl.render(this.postScene, this.postCam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.gl.info.reset();
    prepareShadows(this.gl, scene);
    setOutlines(renderQuality.outlines, this.height.value);
    const u = this.postMat.uniforms;
    const glowMode = postSettings.glow > 0 ? renderQuality.glow : 0;
    u.uBits.value = postSettings.colorBits;
    u.uDither.value = postSettings.dither;
    u.uSaturation.value = postSettings.saturation * postfx.saturation;
    u.uGlow.value = glowMode === 2 ? postSettings.glow * postfxTuning.bloomStrength : postSettings.glow;
    u.uGlowMode.value = glowMode;
    u.uCrt.value = postSettings.crt;
    const distort = renderQuality.distortion && postfx.distortion;
    u.uWaveCount.value = distort ? postfx.waveCount : 0;
    u.uHeatCount.value = distort ? postfx.heatCount : 0;
    u.uWaveWidth.value = postfxTuning.waveWidth;
    u.uWavePx.value = postfxTuning.wavePx * (this.height.value / 270);
    u.uHeatPx.value = postfxTuning.heatPx * (this.height.value / 270);
    u.uNight.value = postfx.night * postfxTuning.nightVignette;
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera) gfxPostUniforms.uNearFar.value.set(pc.near, pc.far);

    this.gl.setRenderTarget(this.target);
    this.gl.setClearAlpha(0); // alpha is the bloom mask: the background doesn't glow
    const kids = scene.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i] as THREE.InstancedMesh;
      if (o.visible && o.isInstancedMesh && o.count === 0) {
        o.visible = false;
        this.idle.push(o);
      }
    }
    this.gl.render(scene, camera);
    for (const o of this.idle) o.visible = true;
    this.idle.length = 0;
    if (glowMode === 2) {
      this.brightMat.uniforms.uThreshold.value = postfxTuning.bloomThreshold;
      this.brightMat.uniforms.uKnee.value = postfxTuning.bloomKnee;
      this.pass(this.brightMat, this.bloomA);
      const b = this.blurMat.uniforms;
      const bw = this.bloomA.width;
      const bh = this.bloomA.height;
      b.tSrc.value = this.bloomA.texture;
      b.uDir.value.set(1 / bw, 0);
      this.pass(this.blurMat, this.bloomB);
      b.tSrc.value = this.bloomB.texture;
      b.uDir.value.set(0, 1 / bh);
      this.pass(this.blurMat, this.bloomA);
    }
    this.pass(this.postMat, null);
  }
}
