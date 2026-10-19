import { BIOME_BY_ID, biomeForStage } from '../data/biomes';
import { laneCuePriority } from './featureCues';
/** Pure mix policy shared by samples and synth voices. */
export const soundTuning = {
  voices: 32,
  sampleGain: 0.5,
  synthLayer: 0.42,
  crossfade: 1.6,
  stepStride: 3.2,
};
export const weaponSamples: Readonly<Record<string, string>> = {
  shoot: 'w_buster',
  buster: 'w_buster',
  scatter: 'w_scatter',
  pellets: 'w_scatter',
  zap: 'w_lightning',
  lightning: 'w_lightning',
  laser: 'w_laser',
  sweeper: 'w_laser',
  disc: 'w_disc',
  drone: 'w_drone',
  bouncer: 'w_drone',
  missile: 'w_missile',
  mine: 'w_mine',
  freeze: 'w_freeze',
  nova: 'w_nova',
  aura: 'w_nova',
  flame: 'w_flame',
  chargeFull: 'w_charge_full',
  chargeShot: 'w_charge_shot',
  orb: 'w_charge_shot',
  lob: 'w_grenade',
  vortex: 'w_vortex',
  blackhole: 'w_blackhole',
  shieldUp: 'w_shield_up',
  block: 'hit_metal',
  uplink: 'w_orbital',
  beam: 'w_orbital',
  rail: 'w_rail',
  meteor: 'w_meteor',
  storm: 'w_storm',
  swordSlash: 'sword_slash',
  swordCombo: 'sword_combo',
  swordDash: 'sword_dash',
  summon: 'summon',
  minionZap: 'minion_zap',
  explode: 'explode_small',
};
export const cueSamples: Readonly<Record<string, string>> = {
  shoot: 'w_buster',
  hit: 'hit_flesh',
  hitMetal: 'hit_metal',
  crit: 'crit',
  die: 'enemy_die',
  eliteDie: 'elite_die',
  shieldBreak: 'shield_break',
  explode: 'explode_small',
  bomb: 'explode_big',
  chest: 'chest_open',
  lvl: 'level_up',
  evolve: 'evolve',
  fusion: 'fusion',
  dash: 'dash',
  cwind: 'charger_windup',
  boss: 'boss_roar',
  bossRoar: 'boss_roar',
  bossSlam: 'boss_slam',
  bossPhase: 'boss_phase',
  portal: 'spawn_portal',
  eshoot: 'turret',
  perfectDash: 'perfect_dash',
  parry: 'parry',
  jumpPad: 'jump_pad',
  coverBreak: 'cover_break',
  goldenLaugh: 'golden_laugh',
  burrow: 'burrow',
  mirrorCopy: 'mirror_copy',
  swarmScreech: 'swarm_screech',
  petLevel: 'pet_level',
  teamCharge: 'team_charge',
  highFive: 'high_five',
  swordSlash: 'sword_slash',
  swordCombo: 'sword_combo',
  swordDash: 'sword_dash',
  summon: 'summon',
  minionZap: 'minion_zap',
};
/**
 * 0 swarm noise .. 4 big moments, then the sound lane's bands: 6 = off-screen
 * threat telegraphs (outrank everything but the announcer, which plays at 10+),
 * 5 = hero voice, 1 = enemy family calls (just above swarm hits and deaths).
 */
export function cuePriority(name: string): number {
  if (/^(threat|cwind|bwind)/.test(name)) return 6;
  if (name.startsWith('s2:')) return laneCuePriority(name); // the sound lane's cues (featureCues.ts)
  if (name.startsWith('voice:')) return 5;
  if (name.startsWith('call:')) return 1;
  if (name.startsWith('evo:')) return 3;
  if (/^(boss|bomb|elite|chest|lvl|evolve|legendary|clear|pdie|hurt|parry|perfect)/.test(name))
    return 4;
  if (name.startsWith('w:') || /^(dash|gem|coin|gear|menu)/.test(name)) return 3;
  if (/^(die|hit|step|eshoot|spawn)/.test(name)) return 0;
  return 2;
}
export function swarmGap(enemies: number): number {
  return 0.07 + Math.min(1, Math.max(0, enemies) / 150) * 0.17;
}
export function distanceCutoff(gain: number): number {
  return 2800 + 17200 * Math.max(0, Math.min(1, gain)) ** 2;
}
/** The area id for a stage (ambience 'amb_<id>', room reverb): the stage's biome's ambience bed. */
export function biomeAudio(stage: number): string {
  return biomeForStage(stage).ambience;
}
/** Footstep surface for a biome id (from its data). */
export function groundAudio(biome: string): string {
  return BIOME_BY_ID[biome]?.footstep ?? 'grass';
}
export function comboLine(combo: number): string | null {
  return combo >= 150 ? 'unstoppable' : combo >= 100 ? 'awesome' : combo >= 50 ? 'great' : null;
}

interface Voice {
  id: string;
  priority: number;
  stop(): void;
}
/** Lower-priority voices can be stolen; equal priorities never churn at the cap. */
export class VoiceBudget {
  private voices: Voice[] = [];
  constructor(readonly limit = soundTuning.voices) {}
  get count(): number {
    return this.voices.length;
  }
  acquire(id: string, priority: number, perSound: number, stop: () => void): (() => void) | null {
    let matching = 0;
    let weakest = -1;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.id === id) matching++;
      if (v.priority < priority && (weakest < 0 || v.priority < this.voices[weakest].priority))
        weakest = i;
    }
    if (matching >= perSound) return null;
    if (this.voices.length >= this.limit) {
      if (weakest < 0) return null;
      const [old] = this.voices.splice(weakest, 1);
      old.stop();
    }
    const voice = { id, priority, stop };
    this.voices.push(voice);
    return () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
    };
  }
}

/** Snap a requested bed re-entry to a nearby beat, never delaying it by more than 80 ms. */
export function silenceDuration(seconds: number, now: number, lastBeat: number, period: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const duration = Math.min(0.6, seconds);
  if (!(period > 0) || !Number.isFinite(period) || lastBeat < 0 || !Number.isFinite(now)) return duration;
  const beat = lastBeat + Math.round((now + duration - lastBeat) / period) * period;
  const candidate = beat - now;
  return candidate >= 0.3 && candidate <= 0.6 && Math.abs(candidate - duration) <= 0.08 ? candidate : duration;
}
