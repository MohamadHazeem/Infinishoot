import * as THREE from 'three';
import { createRetroMaterial, retroGlobals } from './retroMaterial';
import { particleUpload } from './particlesUpload';
import type { NoiseGovernor } from './noiseGovernor';
import { renderQuality } from './quality';
import {
  PARTICLE_COPIES,
  PARTICLE_GROUPS,
  PARTICLE_STRIDE,
  ParticleKind,
  particleMotion,
  particlePaint,
} from './particlesShader';

function packetGeometry(records: THREE.InstancedInterleavedBuffer): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [],
    indices: number[] = [];
  for (let child = 0; child < PARTICLE_COPIES; child++) {
    // The third component selects the child. Draw range changes density without rebuilding buffers.
    vertices.push(-1, -1, child, 1, -1, child, -1, 1, child, 1, 1, child);
    const i = child * 4;
    indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
  }
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  for (const [i, name] of ['launch', 'flight', 'form', 'tint'].entries())
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(records, 4, i * 4));
  return geometry;
}

export class ParticleBatch {
  readonly clock = { value: 0 };
  readonly mesh: THREE.InstancedMesh;
  readonly records = new THREE.InstancedInterleavedBuffer(
    new Float32Array(PARTICLE_GROUPS * PARTICLE_STRIDE),
    PARTICLE_STRIDE,
  );
  private n = 0;
  private firstDirty = PARTICLE_GROUPS;
  private lastDirty = 0;
  private earliest = Infinity;
  private copies = 1;
  private compute?: (groups: number, copies: number, first: number, end: number) => void;

  admit(kind: 'particles' | 'smoke', requested: number): number {
    return this.noise.take(kind, Math.min(requested, PARTICLE_GROUPS - this.n));
  }

  get liveGroups(): number {
    return this.n;
  }

  get drawnCount(): number {
    return this.mesh.count * this.copies;
  }

  constructor(
    scene: THREE.Scene,
    private noise: NoiseGovernor,
  ) {
    this.records.setUsage(THREE.DynamicDrawUsage);
    const material = createRetroMaterial({ transparent: true, unlit: 1 });
    material.depthWrite = false;
    Object.assign(material.uniforms, {
      clock: this.clock,
      hero: noise.heroUniform,
      opacityScale: noise.opacityUniform,
    });
    material.vertexShader = `
      in vec4 launch, flight, form, tint;
      uniform float clock, opacityScale, uFogNear, uFogFar;
      uniform vec3 uFogColor;
      uniform vec4 hero;
      out vec2 vCorner;
      flat out vec4 vTint;
      flat out float vKind;
      ${particleMotion(false)}
      void main() {
        vec4 p = particleMotion(launch, flight, form, clock, position.z);
        float age = max(0.,clock-launch.w);
        float k = min(1.,age/max(0.001,flight.w));
        float puff = step(3.5,form.w);
        float angle = flight.y*0.31 + age*mix(5.,0.5,puff) + position.z;
        float flatness = form.w==1. ? clamp(p.y*1.4,.16,.85) : form.w==2. ? .48 : form.w==3. ? .28 : 1.;
        vec2 corner = position.xy*vec2(1.,flatness);
        vec2 offset = vec2(dot(corner,vec2(cos(angle),-sin(angle))),dot(corner,vec2(sin(angle),cos(angle))));
        if(form.w==1.) offset = corner;
        vec4 view = viewMatrix*vec4(p.xyz,1.);
        view.xy += offset*p.w;
        gl_Position = projectionMatrix*view;
        vec2 delta = p.xz-hero.xy;
        float fade = opacityScale*(1.-hero.w*max(0.,1.-dot(delta,delta)/max(.01,hero.z)));
        vTint = vec4(mix(tint.rgb,uFogColor,smoothstep(uFogNear,uFogFar,-view.z)),
          tint.a*fade*mix(1.,(1.-k)*smoothstep(0.,.09,k),puff));
        vKind = form.w;
        vCorner = position.xy;
      }`;
    material.fragmentShader = `
      in vec2 vCorner; flat in vec4 vTint; flat in float vKind;
      layout(location=0) out vec4 outColor;
      ${particlePaint(false)}
      void main(){outColor=particlePaint(vCorner,vTint,vKind); if(outColor.a < .015) discard;}`;
    this.mesh = new THREE.InstancedMesh(packetGeometry(this.records), material, PARTICLE_GROUPS);
    this.mesh.count = 0;
    this.mesh.name = 'combat-particles';
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // The renderer selects its canvas backend before Game is constructed. Keep
    // TSL out of the WebGL startup path and use the active renderer's own device.
    if (
      typeof document !== 'undefined' &&
      document.getElementById?.('game')?.dataset.backend === 'WebGPU'
    ) {
      this.mesh.visible = false;
      void import('./particlesCompute').then(({ attachCompute }) => {
        this.compute = attachCompute(this, noise, retroGlobals);
        this.firstDirty = 0;
        this.lastDirty = this.n;
        this.mesh.visible = true;
      });
    }
  }

  add(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    gravity: number,
    drag: number,
    kind: ParticleKind,
    color: THREE.Color,
    alpha = 1,
  ): void {
    if (this.n === PARTICLE_GROUPS || !(life > 0)) return;
    const i = this.n++,
      a = this.records.array,
      j = i * PARTICLE_STRIDE;
    a[j] = x;
    a[j + 1] = y;
    a[j + 2] = z;
    a[j + 3] = this.clock.value;
    a[j + 4] = vx;
    a[j + 5] = vy;
    a[j + 6] = vz;
    a[j + 7] = life;
    a[j + 8] = size;
    a[j + 9] = gravity;
    a[j + 10] = drag;
    a[j + 11] = kind;
    a[j + 12] = color.r;
    a[j + 13] = color.g;
    // Keep hot danger-magenta exclusive to enemy rounds, including custom weapon skins.
    const dangerTint = color.r > 0.72 && color.b > 0.70 && color.g < 0.45;
    a[j + 14] = dangerTint ? 0.25 : color.b;
    a[j + 15] = alpha;
    this.earliest = Math.min(this.earliest, a[j + 3] + a[j + 7]);
    this.firstDirty = Math.min(this.firstDirty, i);
    this.lastDirty = this.n;
  }

  clear(): void {
    this.n = this.mesh.count = this.clock.value = this.lastDirty = 0;
    this.earliest = Infinity;
    this.firstDirty = PARTICLE_GROUPS;
  }

  update(dt: number): void {
    const now = (this.clock.value += dt);
    if (now < this.earliest) return;
    this.earliest = Infinity;
    const a = this.records.array;
    for (let i = 0; i < this.n;) {
      const j = i * PARTICLE_STRIDE,
        end = a[j + 3] + a[j + 7];
      if (now < end) {
        this.earliest = Math.min(this.earliest, end);
        i++;
      } else {
        const last = --this.n * PARTICLE_STRIDE;
        if (last !== j) {
          a.copyWithin(j, last, last + PARTICLE_STRIDE);
          this.firstDirty = Math.min(this.firstDirty, i);
          this.lastDirty = Math.max(this.lastDirty, i + 1);
        }
      }
    }
  }

  render(): void {
    this.copies = this.noise.detailCopies(renderQuality.level);
    const limit = this.noise.particleLimit(renderQuality.level);
    this.mesh.count = Math.min(this.n, Math.floor(limit / this.copies));
    this.mesh.geometry.setDrawRange(0, this.copies * 6);
    const end = Math.min(this.n, this.lastDirty);
    if (this.compute) this.compute(this.mesh.count, this.copies, this.firstDirty, end);
    else if (end > this.firstDirty) {
      particleUpload(this.records, this.firstDirty * PARTICLE_STRIDE, end * PARTICLE_STRIDE);
    }
    this.firstDirty = PARTICLE_GROUPS;
    this.lastDirty = 0;
  }
}
