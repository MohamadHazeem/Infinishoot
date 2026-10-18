import type * as THREE from 'three';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import type { Loadout } from '../data/loadout';
import { MOD_BY_ID } from '../data/mods';
import { WEAPONS } from '../data/weapons';
import { buildKey } from '../data/tracks';
import type { Hero } from './hero';
import { createWeapon } from './weapons';

/**
 * PvP: every player plays the same seeded stage on their own machine (a plain
 * solo run), then the host rebuilds everyone's hero from their HeroBuild and
 * runs a host-authoritative duel in one arena over the co-op netcode. Each hero
 * gets an invisible stand-in enemy (`pvpOwner` = its index) that the other
 * heroes' weapons hit like any enemy; Game.damage turns those hits into
 * scaled hero damage. Last hero standing wins.
 */
export const pvpTuning = {
  damageScale: 0.03, // hero damage per point of weapon damage (weapons are tuned for 10k-HP bosses); a still target lasts ~30 s
  zoneStart: 42, // safe ring radius when the duel starts (the field is 110 m across)
  zoneDelay: 25, // seconds before the ring starts closing
  zoneSpeed: 0.55, // metres per second it closes
  zoneMin: 7,
  zoneDps: 0.08, // share of max life per second outside the ring
  spawnRadius: 16, // heroes start on a circle this far from the centre
};

/** Everything needed to rebuild a hero's run on another machine. */
export interface HeroBuild {
  loadout: Loadout;
  weapons: { id: string; level: number; key: string }[];
  special: { id: string; level: number; key: string };
  passives: Record<string, number>;
  mods: { id: string; level: number }[];
  relics: string[];
  revives: number;
  /** Stage summary for the waiting screen. */
  level: number;
  dead: boolean;
}

export function exportBuild(h: Hero, level: number): HeroBuild {
  return {
    loadout: { ...h.loadoutPick },
    weapons: h.weapons.map((w) => ({ id: w.def.id, level: w.level, key: w.buildKey })),
    special: { id: h.special.id, level: h.special.level, key: h.specialBuild ? buildKey(h.specialBuild) : '' },
    passives: { ...h.passives },
    mods: h.synergy.slots.map((s) => ({ id: s.def.id, level: s.level })),
    relics: [...h.relics],
    revives: h.revivesLeft,
    level,
    dead: h.player.dead,
  };
}

/** Rebuild a hero from a HeroBuild (host side), at full life. */
export function applyBuild(h: Hero, b: HeroBuild, scene: THREE.Scene): void {
  h.loadoutPick = { ...b.loadout };
  h.startRun();
  for (const wb of b.weapons) {
    if (!WEAPONS[wb.id]) continue;
    let w = h.weapons.find((x) => x.def.id === wb.id);
    if (!w) {
      w = createWeapon(wb.id, scene);
      h.weapons.push(w);
    }
    if (w.build) w.setBuildKey(wb.key);
    else w.level = Math.max(1, Math.min(wb.level, w.def.levels.length + (w.def.evolution ? 1 : 0)));
  }
  h.special.level = b.special.level;
  if (b.special.key) h.setSpecialBuild(b.special.key);
  h.passives = { ...b.passives };
  for (const m of b.mods) {
    const def = MOD_BY_ID[m.id];
    if (!def || h.synergy.full) continue;
    h.synergy.add(def, 0);
    for (let k = 1; k < m.level; k++) h.synergy.upgrade(h.synergy.slots.length - 1);
  }
  h.relics = [...b.relics];
  h.recomputeStats();
  h.revivesLeft = b.revives;
  h.player.reset(h.stats);
  h.loadoutDirty = true;
}

/** The invisible stand-in that opponents' weapons hit (never moves on its own, never hurts, never dies). */
export const PVP_TARGET: EnemyDef = {
  ...ENEMIES.swarmer,
  id: 'pvp_target',
  name: 'Opponent',
  hp: 1e9,
  speed: 0,
  radius: 0.55,
  contactDamage: 0,
  xp: 0,
  score: 0,
  knockbackResist: 1,
  hidden: true,
};
