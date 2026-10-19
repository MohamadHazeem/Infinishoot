import * as THREE from 'three';
import { ACCESSORIES, decodeLook, lookColors, skinShotColor, SWEETIE16, WEAPON_SKINS, type WeaponSkinDef } from '../data/customise';
import type { SkinDef } from '../data/skins';
import { paintAccessories, wearAccessory, type AccessoryId } from '../render/accessories';
import type { HeroRig } from './heroModel';

/**
 * Applies a hero's customisation (src/data/customise.ts) on every machine:
 * rig colours and accessory (`dressHero`, called from Player.setSkin, so
 * every re-skin keeps it), portrait colours (`customSkin`) and the weapon
 * skin that recolours that hero's shots when they are drawn (`shotColor`,
 * by bullet owner; the bullet keeps its real colour for gameplay and the
 * network). Purely presentation.
 */

/** Recolour the rig and put the accessory on. `ownArmor`: the armour isn't the co-op player colour, so a custom armour colour may replace it. */
export function dressHero(rig: HeroRig, code: string, ownArmor: boolean): void {
  const c = decodeLook(code);
  const m = rig.mats;
  if (ownArmor && c.armor >= 0) {
    m.armor.uniforms.uColor.value.set(SWEETIE16[c.armor]);
    m.armorDark.uniforms.uColor.value.set(SWEETIE16[c.armor]).multiplyScalar(0.68);
  }
  if (c.body >= 0) m.suit.uniforms.uColor.value.set(SWEETIE16[c.body]);
  if (c.accent >= 0) m.accent.uniforms.uColor.value.set(SWEETIE16[c.accent]);
  wearAccessory(rig, ACCESSORIES[c.accessory].id as AccessoryId | 'none');
  paintAccessories(rig);
}

/** The skin as this hero wears it (portraits and the HUD face). */
export function customSkin(skin: SkinDef, code: string): SkinDef {
  return lookColors(skin, decodeLook(code));
}

// ---------------------------------------------------------------- weapon skins

/** Weapon skin per hero index (set every frame by systems/graphics.ts from each hero's look). */
const ownerSkins: (WeaponSkinDef | null)[] = [];
const cache = new Map<string, THREE.Color>();

export function setOwnerSkin(owner: number, code: string): void {
  const s = WEAPON_SKINS[decodeLook(code).weapon];
  ownerSkins[owner] = s && s.main ? s : null;
}

export function clearOwnerSkins(): void {
  ownerSkins.length = 0;
}

/** The colour a friendly shot from `owner` is drawn in (returns `base` itself when that hero has no weapon skin). */
export function shotColor(owner: number, base: THREE.Color, salt: number): THREE.Color {
  const s = ownerSkins[owner];
  if (!s) return base;
  const hex = skinShotColor(s, base.r, base.g, base.b, salt);
  if (!hex) return base;
  let c = cache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    cache.set(hex, c);
  }
  return c;
}
