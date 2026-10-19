/**
 * Weapon fusion offers and the fuse itself (data in src/data/fusions.ts).
 * A hero holding two compatible auto weapons at max level gets a FUSION card
 * on level-ups (like an evolution, it is always on offer until taken, and it
 * never comes from a chest). Picking it swaps both weapons for the hybrid in
 * one auto-weapon slot.
 */
import type * as THREE from 'three';
import { FUSION_BY_ID, readyFusions, type FusionDef } from '../data/fusions';
import { WEAPONS } from '../data/weapons';
import type { Offer } from '../ui/screens';
import { createWeapon, type Weapon } from './weapons';

/** The level-up card for a fusion. */
export function fusionCard(f: FusionDef): Offer {
  return {
    kind: 'fusion',
    id: f.id,
    name: f.name,
    icon: WEAPONS[f.id]?.icon ?? '✦',
    color: f.color,
    tag: 'FUSION!',
    text: f.desc,
    tags: f.tags,
    rarity: 'legendary',
    label: 'AUTO WEAPON FUSION',
    slot: 'auto',
    fuses: [f.parts[0], f.parts[1]],
  };
}

/** A ready fusion's card for these weapons (random pick when several are ready), or null. */
export function fusionOfferFor(weapons: readonly Weapon[], roll: () => number): Offer | null {
  const ready = readyFusions(weapons.filter((w) => !w.def.slot).map((w) => ({ id: w.def.id, maxed: w.maxed })));
  return ready.length ? fusionCard(ready[Math.floor(roll() * ready.length) % ready.length]) : null;
}

/**
 * Put a fusion card into a hand of level-up cards: it takes the last ordinary
 * card's place (evolution forks and ready evolutions are never pushed out)
 * and sits right after them.
 */
export function placeFusion(out: Offer[], card: Offer | null, size = 3): Offer[] {
  if (!card || out.some((o) => o.kind === 'fusion')) return out;
  const special = (o: Offer) => o.kind === 'evo' || o.kind === 'evolve';
  const hand = out.slice();
  if (hand.length >= size) {
    let i = hand.length - 1;
    while (i >= 0 && special(hand[i])) i--;
    if (i < 0) return out;
    hand.splice(i, 1);
  }
  let at = 0;
  while (at < hand.length && special(hand[at])) at++;
  hand.splice(at, 0, card);
  return hand;
}

/**
 * Fuse: both parts (owned auto weapons, maxed) leave and the hybrid takes the
 * first part's slot. Returns the new weapon, or null when it can't fuse.
 */
export function fuseWeapons(weapons: Weapon[], fusionId: string, scene: THREE.Scene): Weapon | null {
  const f = FUSION_BY_ID[fusionId];
  if (!f || weapons.some((w) => w.def.id === fusionId)) return null;
  const idx = f.parts.map((id) => weapons.findIndex((w) => w.def.id === id && !w.def.slot));
  if (idx.some((i) => i < 0 || !weapons[i].maxed)) return null;
  const fused = createWeapon(fusionId, scene);
  const [first, second] = idx[0] < idx[1] ? idx : [idx[1], idx[0]];
  weapons[first].dispose();
  weapons[second].dispose();
  weapons[first] = fused;
  weapons.splice(second, 1);
  return fused;
}
