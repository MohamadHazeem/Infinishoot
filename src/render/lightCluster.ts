import { DataTexture, FloatType, NearestFilter, RGBAFormat, Vector4 } from 'three';

/** World-space XZ tiles suit the game's low camera and shallow playfield. A tile
 * stores four local light indices. The shader still tests distance and normal in 3D. */
export const clusterGrid = 32;
export const clusterCapacity = 1280;
const width = 64;
export const firstLight = clusterGrid * clusterGrid;
const height = (firstLight + clusterCapacity * 2) / width;

export class LightCluster {
  readonly data = new Float32Array(width * height * 4);
  readonly transform = new Vector4();
  readonly scores = new Float32Array(firstLight * 4);
  count = 0;
  begin(cx: number, cz: number, radius: number): void {
    const cell = Math.max(1, Math.ceil((2 * radius) / clusterGrid));
    this.transform.set(
      (Math.floor(cx / cell) - clusterGrid / 2) * cell,
      (Math.floor(cz / cell) - clusterGrid / 2) * cell,
      1 / cell,
      0,
    );
    this.count = 0;
    this.scores.fill(0);
    this.data.fill(0, 0, firstLight * 4);
  }

  offer(
    x: number,
    y: number,
    z: number,
    radius: number,
    r: number,
    g: number,
    b: number,
    intensity: number,
    priority = 0,
  ): void {
    if (this.count >= clusterCapacity || radius <= 0 || intensity <= 0.001) return;
    const t = this.transform,
      px = (x - t.x) * t.z,
      pz = (z - t.y) * t.z,
      reach = radius * t.z;
    const x0 = Math.max(0, Math.floor(px - reach)),
      x1 = Math.min(clusterGrid - 1, Math.floor(px + reach));
    const z0 = Math.max(0, Math.floor(pz - reach)),
      z1 = Math.min(clusterGrid - 1, Math.floor(pz + reach));
    if (x0 > x1 || z0 > z1) return;
    const i = this.count++,
      data = this.data,
      offset = (firstLight + i * 2) * 4;
    data[offset] = x;
    data[offset + 1] = y;
    data[offset + 2] = z;
    data[offset + 3] = radius;
    data[offset + 4] = r * intensity;
    data[offset + 5] = g * intensity;
    data[offset + 6] = b * intensity;
    const power = Math.max(r, g, b) * intensity + priority;
    const invR2 = 1 / (reach * reach);
    for (let iz = z0; iz <= z1; iz++) {
      const dz = Math.max(0, Math.abs(iz + 0.5 - pz) - 0.5);
      for (let ix = x0; ix <= x1; ix++) {
        const dx = Math.max(0, Math.abs(ix + 0.5 - px) - 0.5);
        const falloff = 1 - (dx * dx + dz * dz) * invR2;
        if (falloff <= 0) continue;
        const score = power * falloff * falloff,
          base = (iz * clusterGrid + ix) * 4;
        let weakest = base;
        for (let k = 1; k < 4; k++)
          if (this.scores[base + k] < this.scores[weakest]) weakest = base + k;
        if (score <= this.scores[weakest]) continue;
        this.scores[weakest] = score;
        data[weakest] = i + 1;
      }
    }
  }
}

export const cluster = new LightCluster();
let atlas: DataTexture | null = null;
export const clusterUniforms = {
  uClusterAtlas: { value: null as DataTexture | null },
  uCluster: { value: cluster.transform },
};

export function clusterAvailable(): boolean {
  return atlas !== null;
}

export function initializeCluster(): void {
  if (!atlas) {
    atlas = new DataTexture(cluster.data, width, height, RGBAFormat, FloatType);
    atlas.minFilter = atlas.magFilter = NearestFilter;
    atlas.generateMipmaps = false;
    clusterUniforms.uClusterAtlas.value = atlas;
  }
}

export function publishCluster(scale: number): void {
  cluster.transform.w = scale;
  if (atlas) atlas.needsUpdate = true;
}

// Used unchanged by the GLSL program and the WebGPU TSL translation.
export const clusterShader = /* glsl */ `
uniform sampler2D uClusterAtlas;
uniform vec4 uCluster;
vec4 clusterTexel(int index) {
  return texelFetch(uClusterAtlas, ivec2(index % ${width}, index / ${width}), 0);
}
vec4 clusterIds(vec2 world) {
  ivec2 tile = ivec2(floor((world - uCluster.xy) * uCluster.z));
  if (any(lessThan(tile, ivec2(0))) || any(greaterThanEqual(tile, ivec2(${clusterGrid})))) return vec4(0.0);
  return clusterTexel(tile.y * ${clusterGrid} + tile.x);
}
`;
