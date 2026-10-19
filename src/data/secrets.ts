/** Secrets are deliberately absent from director pools and ordinary boss rotation. */
import type { EnemyDef } from './enemies';
import { Rng } from '../core/rng';

export const secretsTuning = { roomChance: 0.38, goldbugs: 3, reach: 10, plateRadius: 1, beatSeconds: 0.75, beatWindow: 0.19, shotCooldown: 0.3, chargeSeconds: 1.5, iceSeconds: 10, bossHp: 1.15 };
export const SECRET_PUZZLES = ['plates', 'runes', 'braziers', 'ice'] as const;
export type SecretPuzzle = typeof SECRET_PUZZLES[number];
export const SECRET_ORDER = [0, 2, 1] as const;
export const SECRET_BOSSES = ['golden_king', 'shadow_hero'] as const;
export type SecretBoss = typeof SECRET_BOSSES[number];
export const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'] as const;
export function konamiStep(progress: number, key: string): number { return key === KONAMI[progress] ? progress + 1 : key === KONAMI[0] ? 1 : 0; }
export function secretPlan(seed: number, stage: number): SecretPuzzle | null {
  const rng = new Rng((seed ^ Math.imul(stage, 0x51ed270b)) >>> 0);
  return rng.next() < secretsTuning.roomChance ? SECRET_PUZZLES[rng.int(0, 3)] : null;
}
/** One rising edge per plate/rune; a wrong input resets without a penalty. */
export function secretSequence(progress: number, index: number): number { return index === SECRET_ORDER[progress] ? progress + 1 : index === SECRET_ORDER[0] ? 1 : 0; }
export function secretBeat(time: number): boolean {
  const p = ((time % secretsTuning.beatSeconds) + secretsTuning.beatSeconds) % secretsTuning.beatSeconds;
  return Math.min(p, secretsTuning.beatSeconds - p) <= secretsTuning.beatWindow;
}
export function secretBossDefs(base: Record<string, EnemyDef>): Record<SecretBoss, EnemyDef> {
  return {
    golden_king: { ...base.king, id: 'golden_king', secret: true, name: 'Golden King', title: 'SECRET · THE COLLECTOR OF COLLECTORS', hp: 3300, bodyColor: '#ffcd75', accentColor: '#ef7d57', minMinute: -1, weight: 0, material: 'metal', remix: { landRing: 12, shockFrom: 1 } },
    shadow_hero: { ...base.mirror, id: 'shadow_hero', secret: true, name: 'Shadow Hero', title: 'SECRET · YOUR REFLECTION REMEMBERS', boss: true, special: false, hp: 2900, radius: 1, speed: 3.8, contactDamage: 18, knockbackResist: 0.95, xp: 160, score: 18000, bodyColor: '#5d275d', accentColor: '#73eff7', phases: [0.66, 0.33], minMinute: -1, weight: 0, mirror: { scan: 1.15, copy: 4, cooldown: 1, keepDistance: 8 } },
  };
}
export const SECRET_LORE = [
  { id: 'secret:relay', kind: 'SECRET', name: 'The Forgotten Relay', text: 'The maintenance crew hid a workshop behind a false wall. Three lamps remember the order: left, right, middle. Every solved relay still sends a thank-you.' },
  { id: 'secret:developers', kind: 'SECRET', name: 'The Night Shift', text: 'A tiny room for everyone who kept the islands running. The robot dances because somebody finally came back. Thank you for playing.' },
];
export const SECRET_ACHIEVEMENTS = [
  { id: 'secret_room', name: 'Off the Map', desc: 'Solve a secret relay room.' },
  { id: 'secret_golden', name: 'Royal Audit', desc: 'SECRET: catch three Goldbugs in one run, awaken the golden statue, and defeat the Golden King.' },
  { id: 'secret_shadow', name: 'Better Than My Shadow', desc: 'SECRET: defeat your reflection after a flawless night stage.' },
  { id: 'secret_code', name: 'Old School', desc: 'Discover the old directional code on the title screen.' },
];
