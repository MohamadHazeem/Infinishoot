import * as THREE from 'three';
import { createRetroMaterial } from './retroMaterial';

/** Local presentation budget. Never use admission decisions for gameplay or the effects wire. */
export const noiseTuning = {
  crowdStart: 70, crowdFull: 260, bulletWeight: 0.28, heroWeight: 18,
  particles: 900, crowdedParticles: 180,
  smoke: 90, crowdedSmoke: 18,
  debris: 100, crowdedDebris: 24,
  impacts: 100, crowdedImpacts: 24,
  lights: 30, crowdedLights: 6,
  numbers: 70, crowdedNumbers: 14,
  burstSeconds: 0.2, heroRadius: 3.2, nearAlpha: 0.18,
  clusterRadius: 1.8, clusterWindow: 0.24, bigHitRatio: 1.5,
  numberDensity: 0.75, shakeMax: 0.32, crowdedShakeMax: 0.14,
  flashMax: 0.2, crowdedFlashMax: 0.08, flashGap: 0.55,
};
export type NoiseKind = 'particles' | 'smoke' | 'debris' | 'impacts' | 'numbers' | 'lights';
const kinds: NoiseKind[] = ['particles', 'smoke', 'debris', 'impacts', 'numbers', 'lights'];
const crowded = ['crowdedParticles', 'crowdedSmoke', 'crowdedDebris', 'crowdedImpacts', 'crowdedNumbers', 'crowdedLights'] as const;

export function crowdPressure(enemies: number, bullets: number, heroes: number): number {
  const t = noiseTuning;
  return Math.max(0, Math.min(1, (enemies + bullets * t.bulletWeight + Math.max(0, heroes - 1) * t.heroWeight - t.crowdStart) / (t.crowdFull - t.crowdStart)));
}

export class NoiseGovernor {
  active = false;
  pressure = 0;
  x = 0;
  z = 0;
  calm = false;
  readonly heroUniform = { value: new THREE.Vector4(0, 0, 1, 0) };
  readonly opacityUniform = { value: 1 };
  private credits = new Float64Array(kinds.length);
  private clock = 0;
  private lastFlash = -Infinity;
  private averageHit = 0;

  begin(dt: number, enemies: number, bullets: number, heroes: number, x: number, z: number, calm = false): void {
    const first = !this.active;
    this.active = true;
    this.x = x;
    this.z = z;
    this.calm = calm;
    // Attack immediately; release slowly so budgets cannot refill by flickering across a threshold.
    const want = crowdPressure(enemies, bullets, heroes);
    const step = Math.max(0, Math.min(0.1, dt));
    this.pressure = Math.max(want, this.pressure - step * 0.4);
    this.clock += step;
    this.heroUniform.value.set(x, z, noiseTuning.heroRadius ** 2, 1 - noiseTuning.nearAlpha);
    this.opacityUniform.value = 1 - this.pressure * 0.45;
    for (let i = 0; i < kinds.length; i++) {
      const rate = noiseTuning[kinds[i]] + (noiseTuning[crowded[i]] - noiseTuning[kinds[i]]) * this.pressure;
      const cap = Math.max(1, rate * noiseTuning.burstSeconds);
      this.credits[i] = first ? cap : Math.min(cap, this.credits[i] + rate * step);
    }
  }

  take(kind: NoiseKind, requested = 1): number {
    const n = Math.max(0, Math.floor(requested));
    if (!this.active) return n;
    const i = kinds.indexOf(kind);
    const admitted = Math.min(n, Math.floor(this.credits[i]));
    this.credits[i] -= admitted;
    return admitted;
  }

  /** Apply at draw time too: effects already alive fade as the hero approaches. */
  alpha(x: number, z: number): number {
    if (!this.active) return 1;
    const d2 = (x - this.x) ** 2 + (z - this.z) ** 2;
    const near = Math.max(0, 1 - d2 / noiseTuning.heroRadius ** 2);
    return (1 - this.pressure * 0.45) * (1 - near * (1 - noiseTuning.nearAlpha));
  }

  bigHit(amount: number, crit: boolean): boolean {
    const previous = this.averageHit || amount;
    this.averageHit = previous + (amount - previous) * 0.04;
    return crit || amount >= previous * noiseTuning.bigHitRatio;
  }

  flash(amount: number): number {
    if (!this.active) return Math.min(noiseTuning.flashMax, Math.max(0, amount));
    if (amount <= 0 || this.clock - this.lastFlash < noiseTuning.flashGap) return 0;
    this.lastFlash = this.clock;
    return Math.min(amount, this.flashCap);
  }

  get flashCap(): number {
    return (noiseTuning.flashMax + (noiseTuning.crowdedFlashMax - noiseTuning.flashMax) * this.pressure) * (this.calm ? 0.15 : 1);
  }
  get shakeCap(): number {
    return noiseTuning.shakeMax + (noiseTuning.crowdedShakeMax - noiseTuning.shakeMax) * this.pressure;
  }
}

// One global budget per scene, including host replays on clients and direct cosmetic emitters.
const governors = new WeakMap<object, NoiseGovernor>();
export function noiseFor(scene: object): NoiseGovernor {
  let g = governors.get(scene);
  if (!g) { g = new NoiseGovernor(); governors.set(scene, g); }
  return g;
}

/** Transparent queue, after weather/fog (6), before danger (100+) and enemy bullets (110+). */
export function readableMaterial(color: THREE.ColorRepresentation): THREE.ShaderMaterial {
  const m = createRetroMaterial({ color, unlit: 1, transparent: true, side: THREE.DoubleSide });
  m.depthTest = m.depthWrite = false;
  m.uniforms.uFogNear = { value: 1e6 };
  m.uniforms.uFogFar = { value: 2e6 };
  return m;
}

/** Ground warnings are never fogged, depth-occluded or covered by friendly particles. */
export function dangerLayer(mesh: THREE.Mesh, order = 100): void {
  mesh.renderOrder = order;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of materials) {
    m.transparent = true;
    m.depthTest = m.depthWrite = false;
    if ('fog' in m) m.fog = false;
    if (m instanceof THREE.ShaderMaterial && m.uniforms.uFogNear) {
      m.uniforms.uFogNear = { value: 1e6 };
      m.uniforms.uFogFar = { value: 2e6 };
      delete m.defines.RETRO_EMISSIVE_ALPHA;
    }
  }
}


/** Spatial alpha for large friendly rings/stars: their edge must also clear the hero. */
export function fadeFriendlyMaterial(material: THREE.MeshBasicMaterial, noise: NoiseGovernor): void {
  material.onBeforeCompile = shader => {
    shader.uniforms.uNoiseHero = noise.heroUniform;
    shader.uniforms.uNoiseOpacity = noise.opacityUniform;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vNoiseWorld;').replace('#include <project_vertex>', `
      vec4 noiseWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        noiseWorld = instanceMatrix * noiseWorld;
      #endif
      vNoiseWorld = (modelMatrix * noiseWorld).xz;
      #include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vNoiseWorld;\nuniform vec4 uNoiseHero;\nuniform float uNoiseOpacity;').replace('#include <opaque_fragment>', `
      vec2 noiseDelta = vNoiseWorld - uNoiseHero.xy;
      float noiseNear = max(0.0, 1.0 - dot(noiseDelta, noiseDelta) / max(0.01, uNoiseHero.z));
      diffuseColor.a *= uNoiseOpacity * (1.0 - noiseNear * uNoiseHero.w);
      #include <opaque_fragment>`);
  };
}

/** Wide charge lanes keep a crisp boundary without painting over heroes at intersections. */
export function dangerLineMaterial(): THREE.ShaderMaterial {
  const material = readableMaterial('#ff2d4a');
  material.fragmentShader = material.fragmentShader.replace('outColor = vec4(col, base.a);', `
    float edge = step(0.42, abs(vUvP.x - 0.5));
    outColor = vec4(col, mix(0.12, 0.9, edge));`);
  return material;
}
