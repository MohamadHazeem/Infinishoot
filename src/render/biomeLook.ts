import * as THREE from 'three';
import { biomeForStage, type BiomeDef } from '../data/biomes';
import { retroGlobals } from './retroMaterial';
import { mixGrade, NEUTRAL_GRADE, postfx, setGradeTarget, type Grade } from './postfx';
import { SUNSET_GRADE, sunsetWeights, timeOfDay } from './sky';

let current: BiomeDef | null = null;
let dayK = 0;
const SUN_DAY = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
const SUN_DUSK = new THREE.Vector3(0.85, 0.32, 0.42).normalize();
const tmp2 = new THREE.Color();
const todOut = { sun: retroGlobals.uSunColor.value, sky: retroGlobals.uSkyColor.value, ground: retroGlobals.uGroundColor.value, fog: retroGlobals.uFogColor.value };

/**
 * Night stages: a cool moon, a dark tinted ambient and a dark fog. The
 * biome's own colours still tint the night a little so each area keeps its
 * identity. Light comes from hero lanterns, shots and explosions
 * (src/render/lights.ts) and enemy eyes glow.
 */
export const nightTuning = {
  /** Every Nth arena stage is a night stage (0 = never). */
  every: 3,
  moon: new THREE.Color(0.13, 0.16, 0.32),
  sky: new THREE.Color(0.09, 0.11, 0.23),
  ground: new THREE.Color(0.05, 0.04, 0.1),
  fog: new THREE.Color('#141833'),
  /** How much of the biome's own day colours mixes into the night. */
  biomeTint: 0.12,
  moonDir: new THREE.Vector3(-0.35, 0.85, 0.4).normalize(),
};

/**
 * Is this arena stage a night stage? Derived from the stage number, so every
 * co-op machine agrees: every Nth stage, unless its biome says otherwise
 * (Night Dunes is always night).
 */
export function isNightStage(arenaStage: number): boolean {
  if (arenaStage <= 0) return false;
  // A biome that is always fully dark (Night Dunes) counts as a night stage; partly dark ones
  // (Neon City) only darken the look (src/game/systems/look.ts) on their non-night stages.
  if ((biomeForStage(arenaStage).night ?? 0) >= 1) return true;
  return nightTuning.every > 0 && arenaStage % nightTuning.every === 0;
}

/** Colour grade per area: cheerful, a touch of contrast and an identity tint. */
export const BIOME_GRADES: Record<string, Grade> = {
  candy: { lift: [0.015, 0, 0.015], gamma: [1, 1, 1], gain: [1.02, 0.98, 1], saturation: 1.1 },
  ruins: { lift: [0, 0.02, 0.035], gamma: [1, 1, 1], gain: [0.94, 1.03, 1.05], saturation: 1.08 },
  meadow: { lift: [0.0, 0.0, 0.025], gamma: [1, 1, 1], gain: [1.02, 1.03, 0.99], saturation: 1.04 },
  dunes: { lift: [0.03, 0.0, 0.045], gamma: [0.97, 0.97, 0.98], gain: [1.0, 0.99, 0.96], saturation: 1.02 },
  peaks: { lift: [0.0, 0.015, 0.05], gamma: [1, 1, 1.02], gain: [0.96, 1.0, 1.04], saturation: 1.06 },
  magma: { lift: [0.03, 0.0, 0.03], gamma: [1, 0.98, 1], gain: [1.06, 0.99, 0.95], saturation: 1.1 },
  factory: { lift: [0.02, 0.01, 0.03], gamma: [1, 1, 1], gain: [1.03, 1.01, 0.99], saturation: 1.08 },
  neon: { lift: [0.025, 0.0, 0.06], gamma: [1, 1.02, 0.97], gain: [1.06, 0.98, 1.08], saturation: 1.12 },
  sky: { lift: [0.0, 0.012, 0.035], gamma: [0.98, 0.98, 0.97], gain: [1.03, 1.03, 1.05], saturation: 1.08 },
};
const DEFAULT_EYES = new THREE.Color('#fff2a8');
export const NIGHT_GRADE: Grade = { lift: [0.0, 0.012, 0.045], gamma: [1, 1, 1.03], gain: [1.0, 1.0, 1.06], saturation: 1.08 };
const graded: Grade = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1 };
const sunsetGraded: Grade = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1 };

/** Set the shared light and fog uniforms for a biome (every retro material follows). */
export function applyBiomeLook(b: BiomeDef): void {
  current = b;
  if (b.eyeColor) retroGlobals.uEyeColor.value.set(b.eyeColor);
  else retroGlobals.uEyeColor.value.copy(DEFAULT_EYES);
  applyTimeOfDay(0);
}

/** The biome whose look is applied (null before the first arena). */
export function currentBiome(): BiomeDef | null {
  return current;
}

/**
 * Day to dusk over a stage: `k` 0 = midday, 1 = sunset (the final minute and
 * the boss). The sun drops and warms, the sky purples and the fog turns pink.
 * Night (`postfx.night`, set by the look system) is blended over the result.
 */
export function applyTimeOfDay(k: number): void {
  const b = current;
  if (!b) return;
  dayK = k;
  // Twilight remixes (Ashen Magma) never get brighter than their dusk; `dusk` scales how far the shift goes.
  const t = Math.max(b.duskFrom ?? 0, Math.min(1, k)) * 0.75 * (b.dusk ?? 1);
  const n = postfx.night;
  // Midday -> golden hour -> sunset, per biome (src/render/sky.ts).
  timeOfDay(b.id, b.light, b.fog, k, todOut);
  retroGlobals.uSunDir.value.copy(SUN_DAY).lerp(SUN_DUSK, t).normalize();
  if (n > 0) {
    const N = nightTuning;
    const bt = N.biomeTint;
    tmp2.setRGB(...b.light.sun).multiplyScalar(bt).add(N.moon);
    retroGlobals.uSunColor.value.lerp(tmp2, n);
    tmp2.setRGB(...b.light.sky).multiplyScalar(bt).add(N.sky);
    retroGlobals.uSkyColor.value.lerp(tmp2, n);
    tmp2.setRGB(...b.light.ground).multiplyScalar(bt).add(N.ground);
    retroGlobals.uGroundColor.value.lerp(tmp2, n);
    tmp2.set(b.fog).multiplyScalar(bt * 0.5).add(N.fog);
    retroGlobals.uFogColor.value.lerp(tmp2, n);
    retroGlobals.uSunDir.value.lerp(N.moonDir, n).normalize();
  }
  retroGlobals.uNight.value = n;
  mixGrade(b.grade ?? BIOME_GRADES[b.id] ?? NEUTRAL_GRADE, SUNSET_GRADE, sunsetWeights(k).dusk * 0.85, sunsetGraded);
  setGradeTarget(mixGrade(sunsetGraded, NIGHT_GRADE, n, graded));
}

/** Re-apply the current time of day (after the night factor changed). */
export function refreshLook(): void {
  applyTimeOfDay(dayK);
}
