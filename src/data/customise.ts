/**
 * Hero customisation (graphics lane): colours for armour, body suit and
 * accent snapped to the Sweetie 16 palette, an accessory (hat, antenna,
 * scarf, crown) and a weapon skin that recolours your projectiles and their
 * trails. Pure data and the compact code that travels to co-op teammates in
 * `hello` / `start` (`look`), so every machine dresses every hero the same.
 *
 * Code: 5 characters, `[armour][body][accent][accessory][weapon skin]`.
 * Colours are a hex digit (palette index) or `-` (keep the skin's colour);
 * accessory and weapon skin are a digit. `---00` = the plain skin.
 */
export const SWEETIE16 = [
  '#1a1c2c',
  '#5d275d',
  '#b13e53',
  '#ef7d57',
  '#ffcd75',
  '#a7f070',
  '#38b764',
  '#257179',
  '#29366f',
  '#3b5dc9',
  '#41a6f6',
  '#73eff7',
  '#f4f4f4',
  '#94b0c2',
  '#566c86',
  '#333c57',
] as const;

/** The enemy-bullet colour: no weapon skin may use it (or anything close). */
export const ENEMY_MAGENTA = '#ff3df0';

export interface AccessoryDef {
  id: string;
  name: string;
}

export const ACCESSORIES: readonly AccessoryDef[] = [
  { id: 'none', name: 'None' },
  { id: 'antenna', name: 'Antenna' },
  { id: 'cap', name: 'Cap' },
  { id: 'scarf', name: 'Scarf' },
  { id: 'crown', name: 'Crown' },
];

export interface WeaponSkinDef {
  id: string;
  name: string;
  /** Main shot colour, bright core (for pale/white shots) and trail tint. Empty = stock colours. */
  main: string;
  hot: string;
  /** Rainbow: cycles the palette per shot. */
  cycle?: boolean;
}

export const WEAPON_SKINS: readonly WeaponSkinDef[] = [
  { id: 'stock', name: 'Stock', main: '', hot: '' },
  { id: 'aqua', name: 'Aqua Pulse', main: '#73eff7', hot: '#f4f4f4' },
  { id: 'toxic', name: 'Toxic', main: '#a7f070', hot: '#f4f4f4' },
  { id: 'ember', name: 'Ember', main: '#ef7d57', hot: '#ffcd75' },
  { id: 'royal', name: 'Royal Gold', main: '#ffcd75', hot: '#f4f4f4' },
  { id: 'rainbow', name: 'Prism', main: '#41a6f6', hot: '#f4f4f4', cycle: true },
];

/** Colours the Prism skin cycles through (bright Sweetie 16 colours, no dark ones). */
export const PRISM_CYCLE = ['#73eff7', '#a7f070', '#ffcd75', '#ef7d57', '#41a6f6', '#f4f4f4'] as const;

export interface HeroCustom {
  /** Palette index, or -1 = the skin's own colour. */
  armor: number;
  body: number;
  accent: number;
  /** Index into ACCESSORIES. */
  accessory: number;
  /** Index into WEAPON_SKINS. */
  weapon: number;
}

export const DEFAULT_CUSTOM: HeroCustom = { armor: -1, body: -1, accent: -1, accessory: 0, weapon: 0 };
export const DEFAULT_LOOK_CODE = '---00';

const colorChar = (i: number) => (i >= 0 && i < 16 ? i.toString(16) : '-');
const digit = (i: number, max: number) => String(Math.max(0, Math.min(max - 1, Math.floor(i) || 0)));

/** Encode a customisation into its 5-character code. */
export function encodeLook(c: HeroCustom): string {
  return colorChar(c.armor) + colorChar(c.body) + colorChar(c.accent) + digit(c.accessory, ACCESSORIES.length) + digit(c.weapon, WEAPON_SKINS.length);
}

/** Decode a code from anywhere (settings, the network): anything malformed falls back to the defaults per field. */
export function decodeLook(code: unknown): HeroCustom {
  const s = typeof code === 'string' ? code.toLowerCase() : '';
  const col = (ch: string | undefined) => (ch && /^[0-9a-f]$/.test(ch) ? parseInt(ch, 16) : -1);
  const num = (ch: string | undefined, max: number) => {
    const n = ch && /^[0-9]$/.test(ch) ? Number(ch) : 0;
    return n < max ? n : 0;
  };
  return { armor: col(s[0]), body: col(s[1]), accent: col(s[2]), accessory: num(s[3], ACCESSORIES.length), weapon: num(s[4], WEAPON_SKINS.length) };
}

/** A safe code for anything received (always 5 valid characters). */
export function cleanLook(code: unknown): string {
  return encodeLook(decodeLook(code));
}

/** Snap any colour to the nearest Sweetie 16 entry (the colour editor only offers these, imports go through it). */
export function snapToPalette(hex: string): number {
  const c = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < SWEETIE16.length; i++) {
    const p = parseInt(SWEETIE16[i].slice(1), 16);
    const d = (((c >> 16) & 255) - ((p >> 16) & 255)) ** 2 + (((c >> 8) & 255) - ((p >> 8) & 255)) ** 2 + ((c & 255) - (p & 255)) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** The colours a skin + customisation dresses the hero in (palette picks override the skin). */
export function lookColors<S extends { armor: string; accent: string; suit: string }>(skin: S, c: HeroCustom): S {
  return {
    ...skin,
    armor: c.armor >= 0 ? SWEETIE16[c.armor] : skin.armor,
    suit: c.body >= 0 ? SWEETIE16[c.body] : skin.suit,
    accent: c.accent >= 0 ? SWEETIE16[c.accent] : skin.accent,
  };
}

/** Squared RGB distance between two hex colours. */
export function colorDistance2(a: string, b: string): number {
  const x = parseInt(a.slice(1, 7), 16);
  const y = parseInt(b.slice(1, 7), 16);
  return (((x >> 16) & 255) - ((y >> 16) & 255)) ** 2 + (((x >> 8) & 255) - ((y >> 8) & 255)) ** 2 + ((x & 255) - (y & 255)) ** 2;
}

/**
 * The colour a friendly shot is drawn in for a weapon skin: near-white shots
 * take the skin's bright core, everything else its main colour (Prism cycles
 * per shot). Returns '' for the stock skin (keep the shot's own colour).
 * The shot keeps its real colour for gameplay looks and the network.
 */
export function skinShotColor(skin: WeaponSkinDef, r: number, g: number, b: number, salt: number): string {
  if (!skin.main) return '';
  // Near-white shots (cores, sparks) take the bright colour; every coloured shot takes the skin's own.
  if (Math.min(r, g, b) > 0.8) return skin.hot;
  if (skin.cycle) return PRISM_CYCLE[(salt >>> 0) % PRISM_CYCLE.length];
  return skin.main;
}
