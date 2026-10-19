/**
 * Dynamic point lights for the retro material.
 *
 * Every frame the look system (src/game/systems/look.ts) offers candidate
 * lights: big ones (explosion flashes, muzzle flashes, lava, hero lanterns)
 * one by one, and swarms of small ones (bullets, burning enemies) through a
 * coarse grid that merges each cell into one light. `pick()` keeps the
 * brightest few near the view (`renderQuality.lights`, at most MAX_LIGHTS)
 * and packs them into shared uniforms that every retro material reads.
 *
 * All storage is preallocated: no per-frame allocations.
 */

export const MAX_LIGHTS = 16;
const CAP = 192; // candidate lights per frame
const GRID = 10; // small-light grid is GRID x GRID cells around the view focus
const FLASH_CAP = 64;

export const lightTuning = {
  /** Light strength by day and at night (lights matter much more in the dark). */
  dayScale: 0.55,
  nightScale: 1.15,
  /** Small-light grid cell size (m): bullets in one cell share one light. */
  cell: 5,
  /** Lights further than this from the view focus are ignored (m, scaled by zoom). */
  viewRadius: 30,
  /** Each flash's peak lands this fraction into its life (fast attack, slow fall). */
  attack: 0.12,
};

/** Shared light uniforms (merged into every retro material through retroGlobals). */
export const lightUniforms = {
  uLightPos: { value: new Float32Array(MAX_LIGHTS * 4) }, // xyz, radius
  uLightCol: { value: new Float32Array(MAX_LIGHTS * 4) }, // rgb * intensity, unused
  uLightCount: { value: 0 },
  /** Cap on the summed light at one point (a hue-keeping clamp). */
  uLightMax: { value: 0.9 },
};

export class LightPicker {
  private x = new Float32Array(CAP);
  private y = new Float32Array(CAP);
  private z = new Float32Array(CAP);
  private rad = new Float32Array(CAP);
  private r = new Float32Array(CAP);
  private g = new Float32Array(CAP);
  private b = new Float32Array(CAP);
  private score = new Float32Array(CAP);
  private used = new Uint8Array(CAP);
  n = 0;

  // Small-light grid: intensity-weighted sums per cell.
  private gw = new Float32Array(GRID * GRID);
  private gx = new Float32Array(GRID * GRID);
  private gy = new Float32Array(GRID * GRID);
  private gz = new Float32Array(GRID * GRID);
  private gr = new Float32Array(GRID * GRID);
  private gg = new Float32Array(GRID * GRID);
  private gb = new Float32Array(GRID * GRID);
  private gRad = new Float32Array(GRID * GRID);

  // Timed flashes (explosions, sparks), aged every frame.
  private fx = new Float32Array(FLASH_CAP);
  private fy = new Float32Array(FLASH_CAP);
  private fz = new Float32Array(FLASH_CAP);
  private fRad = new Float32Array(FLASH_CAP);
  private fr = new Float32Array(FLASH_CAP);
  private fg = new Float32Array(FLASH_CAP);
  private fb = new Float32Array(FLASH_CAP);
  private fT = new Float32Array(FLASH_CAP);
  private fLife = new Float32Array(FLASH_CAP);
  flashCount = 0;

  private cx = 0;
  private cz = 0;
  private view = 30;
  private ox = 0;
  private oz = 0;
  private cell = 5;

  /** Start a frame: rank lights by distance to (cx, cz). */
  begin(cx: number, cz: number, view = lightTuning.viewRadius, cell = lightTuning.cell): void {
    this.n = 0;
    this.cx = cx;
    this.cz = cz;
    this.view = view;
    this.cell = cell;
    this.ox = cx - (GRID * cell) / 2;
    this.oz = cz - (GRID * cell) / 2;
    this.gw.fill(0);
  }

  /**
   * Offer one light. `intensity` multiplies the colour; `priority` is added to
   * the score so must-have lights (hero lanterns) always win a slot.
   */
  add(x: number, y: number, z: number, radius: number, r: number, g: number, b: number, intensity: number, priority = 0): void {
    if (intensity <= 0.001 || radius <= 0) return;
    const dx = x - this.cx;
    const dz = z - this.cz;
    const d2 = dx * dx + dz * dz;
    const reach = this.view + radius;
    if (d2 > reach * reach) return;
    let i = this.n;
    const s = intensity * radius * (1 / (1 + d2 / (this.view * this.view * 0.35))) + priority;
    if (i >= CAP) {
      // Full: replace the weakest if this one is stronger.
      let w = 0;
      for (let k = 1; k < CAP; k++) if (this.score[k] < this.score[w]) w = k;
      if (this.score[w] >= s) return;
      i = w;
    } else this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.rad[i] = radius;
    this.r[i] = r * intensity;
    this.g[i] = g * intensity;
    this.b[i] = b * intensity;
    this.score[i] = s;
  }

  /** Offer a small emitter; small emitters in one grid cell merge into one light. */
  addSmall(x: number, y: number, z: number, radius: number, r: number, g: number, b: number, intensity: number): void {
    const gx = Math.floor((x - this.ox) / this.cell);
    const gz = Math.floor((z - this.oz) / this.cell);
    if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID || intensity <= 0) return;
    const c = gz * GRID + gx;
    if (this.gw[c] === 0) {
      this.gx[c] = this.gy[c] = this.gz[c] = this.gr[c] = this.gg[c] = this.gb[c] = this.gRad[c] = 0;
    }
    this.gw[c] += intensity;
    this.gx[c] += x * intensity;
    this.gy[c] += y * intensity;
    this.gz[c] += z * intensity;
    this.gr[c] += r * intensity;
    this.gg[c] += g * intensity;
    this.gb[c] += b * intensity;
    this.gRad[c] = Math.max(this.gRad[c], radius);
  }

  /** A timed light that peaks fast and fades over `life` seconds. */
  flash(x: number, y: number, z: number, radius: number, r: number, g: number, b: number, intensity: number, life: number): void {
    let i = this.flashCount;
    if (i >= FLASH_CAP) {
      // Full: replace the one closest to its end.
      let w = 0;
      for (let k = 1; k < FLASH_CAP; k++) if (this.fT[k] / this.fLife[k] > this.fT[w] / this.fLife[w]) w = k;
      i = w;
    } else this.flashCount++;
    this.fx[i] = x;
    this.fy[i] = y;
    this.fz[i] = z;
    this.fRad[i] = radius;
    this.fr[i] = r * intensity;
    this.fg[i] = g * intensity;
    this.fb[i] = b * intensity;
    this.fT[i] = 0;
    this.fLife[i] = Math.max(0.05, life);
  }

  /** Age the flashes by `dt` and offer the live ones as candidates. */
  tickFlashes(dt: number, soft = false): void {
    const att = lightTuning.attack;
    for (let i = 0; i < this.flashCount; i++) {
      this.fT[i] += dt;
      const k = this.fT[i] / this.fLife[i];
      if (k >= 1) {
        const j = --this.flashCount;
        this.fx[i] = this.fx[j];
        this.fy[i] = this.fy[j];
        this.fz[i] = this.fz[j];
        this.fRad[i] = this.fRad[j];
        this.fr[i] = this.fr[j];
        this.fg[i] = this.fg[j];
        this.fb[i] = this.fb[j];
        this.fT[i] = this.fT[j];
        this.fLife[i] = this.fLife[j];
        i--;
        continue;
      }
      // Reduce flashing: a slow swell and a lower peak instead of a pop.
      const env = soft ? 0.45 * Math.sin(k * Math.PI) : k < att ? k / att : (1 - k) * (1 - k) / ((1 - att) * (1 - att));
      this.add(this.fx[i], this.fy[i], this.fz[i], this.fRad[i] * (0.75 + 0.25 * Math.min(1, k / att)), this.fr[i], this.fg[i], this.fb[i], env);
    }
  }

  clearFlashes(): void {
    this.flashCount = 0;
  }

  /**
   * Keep the `max` strongest candidates and write them (scaled by `scale`)
   * into the packed uniform arrays. Returns how many were written.
   */
  pick(max: number, pos: Float32Array, col: Float32Array, scale = 1): number {
    // Grid cells become candidates first.
    for (let c = 0; c < GRID * GRID; c++) {
      const w = this.gw[c];
      if (w <= 0) continue;
      const inv = 1 / w;
      // More emitters in a cell = a bigger, brighter (but not linearly brighter) pool.
      const k = Math.min(2.2, Math.sqrt(w)) * inv;
      this.add(this.gx[c] * inv, this.gy[c] * inv, this.gz[c] * inv, this.gRad[c] * (1 + Math.min(0.8, w * 0.08)), this.gr[c] * k, this.gg[c] * k, this.gb[c] * k, 1);
    }
    const n = this.n;
    const want = Math.min(max, MAX_LIGHTS, n);
    this.used.fill(0, 0, n);
    for (let o = 0; o < want; o++) {
      let best = -1;
      for (let i = 0; i < n; i++) if (!this.used[i] && (best < 0 || this.score[i] > this.score[best])) best = i;
      this.used[best] = 1;
      const p = o * 4;
      pos[p] = this.x[best];
      pos[p + 1] = this.y[best];
      pos[p + 2] = this.z[best];
      pos[p + 3] = this.rad[best];
      col[p] = this.r[best] * scale;
      col[p + 1] = this.g[best] * scale;
      col[p + 2] = this.b[best] * scale;
      col[p + 3] = 0;
    }
    return want;
  }
}
