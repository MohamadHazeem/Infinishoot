import type { StageEventDef } from './stageEvents';

export type WeatherKind = 'sandstorm' | 'blizzard' | 'lightning' | 'heatwave';
export const weather2Tuning = {
  seconds: 45, sight: 9, silhouette: 13, gust: 5, gustPeriod: 7,
  tick: 0.25, chillSeconds: 5, thawSeconds: 2, heroSlow: 0.35,
  freezeSeconds: 7, freezeSpeed: 1.8, freezeHold: 2.5, warmthRadius: 4, warmthSeconds: 14,
  strikeEvery: 2.8, strikeWarning: 1.6, strikeRadius: 2.2, strikeDamage: 18, strikeFoe: 65,
  rodCharges: 3, rodRange: 22, heatSeconds: 10, coolSeconds: 3, heatDamage: 4,
  spreadEvery: 0.75, spreadRadius: 3, spreadMax: 12, tile: 3,
};
export const WEATHER_EVENTS: Record<WeatherKind, StageEventDef> = {
  sandstorm: { id: 'sandstorm', name: 'SANDSTORM!', sub: 'SHORT SIGHT • GUSTS BEND BULLETS', seconds: weather2Tuning.seconds, good: false },
  blizzard: { id: 'blizzard', name: 'BLIZZARD!', sub: 'KEEP MOVING • COLLECT BRAZIERS FOR WARMTH', seconds: weather2Tuning.seconds, good: false },
  lightning: { id: 'lightning', name: 'LIGHTNING STORM!', sub: 'DODGE THE RINGS • SHOOT RODS TO REDIRECT STRIKES', seconds: weather2Tuning.seconds, good: false },
  heatwave: { id: 'heatwave', name: 'HEAT WAVE!', sub: 'DARK TILES HEAT UP • WATER AND SHADE COOL DOWN', seconds: weather2Tuning.seconds, good: false },
};
export function isWeatherKind(id: string | undefined): id is WeatherKind {
  return id === 'sandstorm' || id === 'blizzard' || id === 'lightning' || id === 'heatwave';
}
export function weatherForBiome(biome: string): WeatherKind | null {
  switch (biome.split(':')[0]) {
    case 'dunes': return 'sandstorm';
    case 'peaks': return 'blizzard';
    case 'meadow': case 'neon': return 'lightning';
    case 'magma': return 'heatwave';
    default: return null;
  }
}
export function weatherEligible(id: string, biome: string, enabled: boolean): boolean {
  return !isWeatherKind(id) || enabled && weatherForBiome(biome) === id;
}
/** Bounded exposure meters; explicit seconds make all fixed-step rates agree. */
export function exposure(value: number, exposed: boolean, dt: number, fill: number, drain: number): number {
  return Math.max(0, Math.min(1, value + dt * (exposed ? 1 / fill : -1 / drain)));
}
export function weatherGust(t: number): number {
  return weather2Tuning.gust * Math.sin(t * Math.PI * 2 / weather2Tuning.gustPeriod);
}
/** These same dark tiles are drawn by the event view; the start plaza stays cool. */
export function hotTile(x: number, z: number): boolean {
  return x * x + z * z > 25 && ((Math.floor(x / weather2Tuning.tile) + Math.floor(z / weather2Tuning.tile)) & 1) === 0;
}
/** Swept projectile/rod test: fast shots must not skip a narrow pickup. */
export function segmentDistance2(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return (x - ax - dx * k) ** 2 + (z - az - dz * k) ** 2;
}
