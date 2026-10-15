import * as THREE from 'three';
import type { BiomeDef } from '../data/biomes';
import { retroGlobals } from './retroMaterial';

let current: BiomeDef | null = null;
const SUN_DAY = new THREE.Vector3(0.45, 0.8, 0.4).normalize();
const SUN_DUSK = new THREE.Vector3(0.85, 0.32, 0.42).normalize();
const DUSK_SUN = new THREE.Color(0.86, 0.5, 0.36);
const DUSK_SKY = new THREE.Color(0.44, 0.34, 0.62);
const DUSK_GROUND = new THREE.Color(0.3, 0.2, 0.34);
const DUSK_FOG = new THREE.Color('#d9788a');
const tmp = new THREE.Color();

/** Set the shared light and fog uniforms for a biome (every retro material follows). */
export function applyBiomeLook(b: BiomeDef): void {
  current = b;
  applyTimeOfDay(0);
}

/**
 * Day to dusk over a stage: `k` 0 = midday, 1 = sunset (the final minute and
 * the boss). The sun drops and warms, the sky purples and the fog turns pink.
 */
export function applyTimeOfDay(k: number): void {
  const b = current;
  if (!b) return;
  const t = Math.max(0, Math.min(1, k)) * 0.75;
  retroGlobals.uSunColor.value.setRGB(...b.light.sun).lerp(DUSK_SUN, t);
  retroGlobals.uSkyColor.value.setRGB(...b.light.sky).lerp(DUSK_SKY, t);
  retroGlobals.uGroundColor.value.setRGB(...b.light.ground).lerp(DUSK_GROUND, t);
  retroGlobals.uFogColor.value.copy(tmp.set(b.fog)).lerp(DUSK_FOG, t * 0.6);
  retroGlobals.uSunDir.value.copy(SUN_DAY).lerp(SUN_DUSK, t).normalize();
}
