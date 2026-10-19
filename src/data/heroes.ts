import type { Stats } from '../game/stats';

/**
 * Playable heroes: a starting kit and stat quirks. Picked on the MODE screen;
 * all but the Rookie unlock with achievements.
 */
export interface HeroDef {
  id: string;
  name: string;
  desc: string;
  /** Auto weapons the run starts with, on top of the loadout (left click, right click, special). */
  start: string[];
  add: Partial<Stats>;
  /** Body proportions: [width, height] scale. */
  build: [number, number];
  unlock?: string;
  /** Ultimate id (src/game/ultimates.ts ULTS). */
  ult: string;
}

export const HEROES: HeroDef[] = [
  { id: 'rookie', name: 'Rookie', desc: 'Balanced. No extra weapon. ULTIMATE: Mega Barrage.', start: [], add: {}, build: [1, 1], ult: 'barrage' },
  {
    id: 'bulwark',
    name: 'Bulwark',
    desc: '+40 life, +1 armor, 10% slower. Starts with a Zap Field. ULTIMATE: Titan Stomp.',
    start: ['aura'],
    add: { maxHp: 40, armor: 1, moveSpeedMul: -0.1 },
    build: [1.18, 1.02],
    unlock: 'boss_slayer',
    ult: 'stomp',
  },
  {
    id: 'dash',
    name: 'Dash',
    desc: '15% faster, dash recharges 25% sooner, -20 life. Starts with Blaze Boots. ULTIMATE: Sonic Blitz.',
    start: ['fire'],
    add: { moveSpeedMul: 0.15, dashCooldownMul: -0.25, maxHp: -20 },
    build: [0.9, 0.98],
    unlock: 'speedster',
    ult: 'blitz',
  },
  {
    id: 'ace',
    name: 'Ace',
    desc: '+20% damage, +10% crit chance, slower right click. Starts with Chain Zap. ULTIMATE: Lock-On Storm.',
    start: ['lightning'],
    add: { damageMul: 0.2, critChance: 0.1, chargeSpeed: -0.2 },
    build: [0.96, 1.06],
    unlock: 'elite_hunter',
    ult: 'storm',
  },
];

export const HERO_BY_ID = Object.fromEntries(HEROES.map((h) => [h.id, h])) as Record<string, HeroDef>;

export function heroOf(id: string | undefined): HeroDef {
  return HERO_BY_ID[id ?? ''] ?? HEROES[0];
}
