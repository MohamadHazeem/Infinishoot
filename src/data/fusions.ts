import type { Tag } from './tags';
import type { WeaponDef, WeaponFeel } from './weapons';

/**
 * Weapon fusions: two auto weapons at max level (evolved or not) fuse into a
 * hybrid that takes one auto-weapon slot. The hybrid runs both parts at their
 * evolved strength (`children`, with tweaks) under one name, colour and tag
 * set, plus a rider that makes the parts feed each other (drone hits chain
 * lightning, missile blasts leave napalm...). It is always stronger than the
 * two parts and frees a slot. Behaviour: src/game/weapons/fusion.ts.
 * Loadout weapons never fuse: they are kept all run.
 */
export interface FusionChild {
  /** Part weapon id; it runs with its evolved params (`evolution.p`), else its last level's. */
  weapon: string;
  /** Multiply params (dmg: 1.15 = +15%). */
  mul?: Record<string, number>;
  /** Add to params after `mul`. */
  add?: Record<string, number>;
}

export interface FusionRider {
  /** Hits from `on` (a part id) chain lightning: chance per hit, hops, base damage, min seconds between zaps. */
  zap?: { on: string; chance: number; hops: number; dmg: number; gap: number };
  /** Blasts from `on` chain lightning from an enemy caught in them. */
  blastZap?: { on: string; hops: number; dmg: number };
  /** Hits from `on` freeze (bosses x0.15) and set a shatter bonus. */
  freeze?: { on: string; time: number; shatter: number };
  /** Hits from `on` pop in a small blast: chance, radius, fraction of the hit's base damage, min gap. */
  pop?: { on: string; chance: number; radius: number; mul: number; gap: number };
  /** Blasts from `on` leave a burning patch (needs a 'fire' child): seconds, radius. */
  napalm?: { on: string; life: number; radius: number };
  /** Cycle the colour through a rainbow (Prism Satellites). */
  prism?: boolean;
}

export interface FusionDef {
  id: string;
  name: string;
  /** The two auto weapons that fuse (order doesn't matter). */
  parts: [string, string];
  children: FusionChild[];
  color: string;
  /** Accent colour (sparks, second half of the merge animation). */
  color2: string;
  tags: Tag[];
  /** Card / tooltip text. */
  desc: string;
  /** Bullet kind for bullet-firing children (game.ts BULLET_KINDS), so hits credit the fusion. */
  bulletKind?: number;
  rider: FusionRider;
  feel?: Partial<WeaponFeel>;
}

export const FUSIONS: FusionDef[] = [
  {
    id: 'storm_drones',
    name: 'Storm Drones',
    parts: ['drones', 'lightning'],
    children: [{ weapon: 'drones', mul: { dmg: 1.15 } }, { weapon: 'lightning', mul: { dmg: 1.1 }, add: { chains: 2 } }],
    color: '#7df9ff',
    color2: '#fff35c',
    tags: ['orbit', 'chain', 'shock'],
    desc: 'Crackling drones chain lightning off every enemy they bonk, and the storm bolts jump 2 more times.',
    rider: { zap: { on: 'drones', chance: 0.4, hops: 3, dmg: 45, gap: 0.07 } },
    feel: { knock: 0.8, critFlash: 1.3, critPitch: 2.3 },
  },
  {
    id: 'napalm_rockets',
    name: 'Napalm Rockets',
    parts: ['missiles', 'fire'],
    children: [{ weapon: 'missiles', mul: { dmg: 1.15 } }, { weapon: 'fire', mul: { dps: 1.1 } }],
    color: '#ff5e3a',
    color2: '#ffcd75',
    tags: ['projectile', 'explosive', 'fire', 'trail'],
    desc: 'Rockets set everything ablaze and splash burning napalm pools where they land. Your trail still burns.',
    rider: { napalm: { on: 'missiles', life: 3, radius: 1.5 } },
    feel: { knock: 1.3, critFlash: 1.5, critPitch: 1.25 },
  },
  {
    id: 'ice_saws',
    name: 'Ice Saws',
    parts: ['discs', 'nova'],
    children: [{ weapon: 'discs', mul: { dmg: 1.15 } }, { weapon: 'nova', mul: { dmg: 1.1 } }],
    color: '#9fe8ff',
    color2: '#41a6f6',
    tags: ['projectile', 'orbit', 'area', 'frost'],
    desc: 'Frozen saw blades freeze what they slice; shattering novas still pulse around you.',
    rider: { freeze: { on: 'discs', time: 0.8, shatter: 0.6 } },
    feel: { knock: 1.1, critFlash: 1.3, critPitch: 2 },
  },
  {
    id: 'supernova_field',
    name: 'Supernova Field',
    parts: ['aura', 'nova'],
    children: [{ weapon: 'aura', mul: { dmg: 1.15, radius: 1.1 } }, { weapon: 'nova', mul: { dmg: 1.2 } }],
    color: '#fff35c',
    color2: '#b48cff',
    tags: ['area', 'shock', 'frost', 'explosive'],
    desc: 'A blazing storm field. Its novas freeze, Shock and blow frozen enemies apart in small blasts.',
    rider: { pop: { on: 'nova', chance: 0.35, radius: 2.2, mul: 0.6, gap: 0.03 } },
    feel: { knock: 0.7, critFlash: 1.4, critPitch: 2.1 },
  },
  {
    id: 'tesla_traps',
    name: 'Tesla Traps',
    parts: ['mines', 'lightning'],
    children: [{ weapon: 'mines', mul: { dmg: 1.15 } }, { weapon: 'lightning', mul: { dmg: 1.1 } }],
    color: '#73eff7',
    color2: '#fff35c',
    tags: ['explosive', 'trail', 'chain', 'shock'],
    desc: 'Mines that burst into chain lightning, jumping through the crowd around each blast.',
    rider: { blastZap: { on: 'mines', hops: 5, dmg: 50 } },
    feel: { knock: 1.4, critFlash: 1.4, critPitch: 1.6 },
  },
  {
    id: 'prism_satellites',
    name: 'Prism Satellites',
    parts: ['sweeper', 'drones'],
    children: [{ weapon: 'drones', mul: { dmg: 1.15, spin: 0.8 } }, { weapon: 'sweeper', mul: { dmg: 1.15 }, add: { beams: 1 } }],
    color: '#ff7eb6',
    color2: '#73eff7',
    tags: ['area', 'orbit'],
    desc: 'Rainbow satellites orbit you, flashing light bursts on hit, while four prism beams spin a full circle.',
    rider: { pop: { on: 'drones', chance: 0.3, radius: 1.6, mul: 0.5, gap: 0.05 }, prism: true },
    feel: { knock: 0.7, critFlash: 1.2, critPitch: 2.3 },
  },
  {
    id: 'dragon_cannon',
    name: 'Dragon Cannon',
    parts: ['pellets', 'fire'],
    children: [{ weapon: 'pellets', mul: { dmg: 1.15 }, add: { pellets: 4, pierce: 1 } }, { weapon: 'fire', mul: { dps: 1.1 } }],
    color: '#ff5e3a',
    color2: '#ffe14d',
    tags: ['projectile', 'fire', 'trail'],
    desc: 'A turret that breathes 18 piercing fireballs at the crowd, and a blazing trail behind you.',
    bulletKind: 15,
    rider: {},
    feel: { knock: 1, critFlash: 1.3, critPitch: 1.7 },
  },
  {
    id: 'comet_swarm',
    name: 'Comet Swarm',
    parts: ['bouncer', 'starfall'],
    children: [{ weapon: 'bouncer', mul: { dmg: 1.15 } }, { weapon: 'starfall', mul: { dmg: 1.1 }, add: { count: 1 } }],
    color: '#ffcd75',
    color2: '#ef7d57',
    tags: ['orbit', 'projectile', 'explosive', 'area'],
    desc: 'Bouncing comets explode on every ricochet, and 6 stars rain on the crowds.',
    rider: { pop: { on: 'bouncer', chance: 0.45, radius: 1.8, mul: 0.7, gap: 0.03 } },
    feel: { knock: 1.3, critFlash: 1.5, critPitch: 1.3, critStop: 0.015 },
  },
  {
    id: 'meteor_barrage',
    name: 'Meteor Barrage',
    parts: ['missiles', 'starfall'],
    children: [{ weapon: 'missiles', mul: { dmg: 1.15, radius: 1.25 } }, { weapon: 'starfall', mul: { dmg: 1.15 } }],
    color: '#ff7a2f',
    color2: '#b13e53',
    tags: ['projectile', 'explosive', 'area', 'fire'],
    desc: 'Burning meteor rockets with bigger blasts that set the crowd on fire, plus a heavier starfall.',
    rider: {},
    feel: { knock: 1.5, critFlash: 1.6, critPitch: 1.1, critStop: 0.02 },
  },
  {
    id: 'volt_ricochet',
    name: 'Volt Ricochet',
    parts: ['bouncer', 'lightning'],
    children: [{ weapon: 'bouncer', mul: { dmg: 1.15 }, add: { bounces: 2 } }, { weapon: 'lightning', mul: { dmg: 1.1 } }],
    color: '#a7f070',
    color2: '#73eff7',
    tags: ['orbit', 'projectile', 'chain', 'shock'],
    desc: 'Electric drones bounce 2 more times and arc lightning from every enemy they hit.',
    rider: { zap: { on: 'bouncer', chance: 0.55, hops: 3, dmg: 40, gap: 0.05 } },
    feel: { knock: 1, critFlash: 1.3, critPitch: 2.2 },
  },
];

export const FUSION_BY_ID: Record<string, FusionDef> = Object.fromEntries(FUSIONS.map((f) => [f.id, f]));

/** The fusion two weapon ids make, if any. */
export function fusionFor(a: string, b: string): FusionDef | undefined {
  return FUSIONS.find((f) => (f.parts[0] === a && f.parts[1] === b) || (f.parts[0] === b && f.parts[1] === a));
}

/** Owned weapons as fusions need them. */
export interface FusionCandidate {
  id: string;
  maxed: boolean;
}

/** Fusions ready for this weapon list: both parts owned and maxed (fusions themselves never fuse again). */
export function readyFusions(owned: readonly FusionCandidate[]): FusionDef[] {
  const maxed = new Set(owned.filter((w) => w.maxed && !FUSION_BY_ID[w.id]).map((w) => w.id));
  return FUSIONS.filter((f) => maxed.has(f.parts[0]) && maxed.has(f.parts[1]));
}

/** A part's params inside a fusion: its evolved (else top-level) params with the child's mul/add. */
export function childParams(part: WeaponDef, c: FusionChild): Record<string, number> {
  const base = part.evolution?.p ?? part.levels[part.levels.length - 1].p;
  const p = { ...base };
  for (const [k, v] of Object.entries(c.mul ?? {})) if (k in p) p[k] *= v;
  for (const [k, v] of Object.entries(c.add ?? {})) if (k in p) p[k] += v;
  return p;
}

/** Weapon defs for the fusions (merged into WEAPONS; never offered as NEW, never in the unlock pool). */
export function fusionWeaponDefs(weapons: Record<string, WeaponDef>): Record<string, WeaponDef> {
  const out: Record<string, WeaponDef> = {};
  for (const f of FUSIONS) {
    const [a, b] = f.parts.map((id) => weapons[id]);
    out[f.id] = {
      id: f.id,
      rarity: 'legendary',
      fusion: f.parts,
      tags: f.tags,
      name: f.name,
      icon: a && b ? `${a.icon}${b.icon}` : '✦',
      color: f.color,
      desc: `FUSION of ${a?.name ?? f.parts[0]} + ${b?.name ?? f.parts[1]}. ${f.desc}`,
      starter: false,
      levels: [{ text: f.desc, p: {} }],
    };
  }
  return out;
}

/** Feel for the fusion ids (WEAPON_FEEL format). */
export const FUSION_FEEL: Record<string, Partial<WeaponFeel>> = Object.fromEntries(FUSIONS.map((f) => [f.id, f.feel ?? {}]));
