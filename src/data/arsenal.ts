import { MODS } from './mods';
import { PASSIVES } from './passives';
import type { Rarity } from './rarity';
import { RELICS } from './relics';
import { SPECIALS } from './specials';
import type { Tag } from './tags';
import { WEAPON_COMBOS } from './weaponCombos';
import { WEAPONS } from './weapons';
import { modDesc } from '../game/modTypes';
import { POWERUPS } from './codex2';

/**
 * The Arsenal (EXTRAS > ARSENAL): every weapon, special, item, Mod, relic, weapon
 * combo, evolution and status, with what it does. Entries unlock ("discovered")
 * when you own, pick or are offered them; the keys below are what the save's
 * `discovered` list holds, so keep them stable.
 *   w:<weapon>  sp:<special>  p:<passive>  m:<mod>  r:<relic>  c:<combo>
 *   e:<item>:<evo index>  (loadout/special evolutions)  e:<weapon>:auto  (auto-weapon partner evolutions)
 *   s:<status>  x:<power-up>  (mech suit, crate super weapons, candy: tips2 lane)
 */
export type CodexTab = 'weapons' | 'specials' | 'items' | 'mods' | 'relics' | 'combos' | 'evolutions' | 'statuses' | 'powerups';

export const CODEX_TABS: { id: CodexTab; label: string }[] = [
  { id: 'weapons', label: 'WEAPONS' },
  { id: 'specials', label: 'SPECIALS' },
  { id: 'items', label: 'ITEMS' },
  { id: 'mods', label: 'MODS' },
  { id: 'relics', label: 'RELICS' },
  { id: 'combos', label: 'COMBOS' },
  { id: 'evolutions', label: 'EVOLUTIONS' },
  { id: 'statuses', label: 'STATUSES' },
  { id: 'powerups', label: 'POWER-UPS' },
];

export interface CodexEntry {
  key: string;
  tab: CodexTab;
  name: string;
  /** Pixel icon id (iconHtml) and its fallback glyph. */
  icon: string;
  glyph: string;
  color: string;
  rarity?: Rarity;
  tags?: readonly Tag[];
  desc: string;
  /** Small label: slot, kind or recipe ("LEFT CLICK", "AUTO WEAPON", "BURN + SHOCK"). */
  kind: string;
}

/** Statuses and their combos (numbers from statusTuning in game.ts). */
export const STATUSES: { id: string; name: string; glyph: string; color: string; kind: string; desc: string }[] = [
  { id: 'burn', name: 'Burn', glyph: '♨', color: '#ff7a2f', kind: 'STATUS', desc: 'Fire hits set enemies alight: damage over 3 seconds.' },
  { id: 'shock', name: 'Shock', glyph: 'ϟ', color: '#ffe14d', kind: 'STATUS', desc: 'Shock hits make an enemy take +20% damage for 2 seconds.' },
  { id: 'freeze', name: 'Freeze', glyph: '❄', color: '#9fe8ff', kind: 'STATUS', desc: 'Frost can freeze enemies in place. Frozen enemies stop moving and attacking.' },
  { id: 'expose', name: 'Exposed', glyph: '◎', color: '#c4b8ff', kind: 'RIGHT-CLICK STATUS', desc: 'Every right-click hit Exposes the enemy: +30% damage from everyone for 4 seconds.' },
  { id: 'overload', name: 'Overload', glyph: '✹', color: '#ffe14d', kind: 'COMBO: BURN + SHOCK', desc: 'Burn and Shock on the same enemy explode in an Overload blast that grows with your level.' },
  { id: 'shatter', name: 'Shatter', glyph: '✦', color: '#9fe8ff', kind: 'COMBO: KILL A FROZEN ENEMY', desc: 'A frozen enemy that dies bursts into ice shards that hit everything nearby.' },
  { id: 'napalm', name: 'Napalm', glyph: '♨', color: '#ff5e3a', kind: 'COMBO: BLAST A BURNING ENEMY', desc: 'An explosion that catches a burning enemy spreads fire to everything in the blast.' },
];

const SLOT_KIND: Record<string, string> = { primary: 'LEFT CLICK', secondary: 'RIGHT CLICK' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Icon id of an evolved loadout item or special (matches Weapon.iconId / Hero.specialView). */
export function evoIcon(base: string, k: number): string {
  return k === 0 ? `${base}_evo` : `${base}_evo${k + 1}`;
}

let cache: CodexEntry[] | null = null;

/** Every codex entry, in tab order. */
export function codexEntries(): CodexEntry[] {
  if (cache) return cache;
  const out: CodexEntry[] = [];
  const weapons = Object.values(WEAPONS);
  // Loadout weapons first (left, then right click), then auto weapons.
  const order = (w: (typeof weapons)[number]) => (w.slot === 'primary' ? 0 : w.slot === 'secondary' ? 1 : 2);
  for (const w of [...weapons].sort((a, b) => order(a) - order(b))) {
    out.push({ key: `w:${w.id}`, tab: 'weapons', name: w.name, icon: w.id, glyph: w.icon, color: w.color, rarity: w.slot ? undefined : w.rarity, tags: w.tags, desc: cap(w.desc.replace(/^(LEFT|RIGHT) CLICK: /, '')), kind: w.slot ? SLOT_KIND[w.slot] : 'AUTO WEAPON' });
  }
  for (const s of Object.values(SPECIALS)) {
    out.push({ key: `sp:${s.id}`, tab: 'specials', name: s.name, icon: 'sp_' + s.id, glyph: s.icon, color: s.color, desc: s.desc, kind: 'SPECIAL Q/E' });
  }
  for (const p of Object.values(PASSIVES)) {
    out.push({ key: `p:${p.id}`, tab: 'items', name: p.name, icon: p.id, glyph: p.icon, color: p.color, rarity: p.rarity, desc: p.desc, kind: p.coop ? 'CO-OP ITEM' : `ITEM · MAX LV ${p.maxLevel}` });
  }
  for (const m of MODS) {
    out.push({ key: `m:${m.id}`, tab: 'mods', name: m.name, icon: m.id, glyph: m.icon, color: m.color, rarity: m.rarity, tags: m.synergy, desc: modDesc(m, 1), kind: m.cursed ? 'CURSED MOD' : m.echo ? 'MOD · COPIES THE NEXT SLOT' : 'MOD' });
  }
  for (const r of RELICS) {
    out.push({ key: `r:${r.id}`, tab: 'relics', name: r.name, icon: r.id, glyph: r.icon, color: r.color, rarity: r.rarity, desc: r.desc, kind: 'RELIC' });
  }
  for (const c of WEAPON_COMBOS) {
    const [a, b] = c.weapons.map((id) => WEAPONS[id]?.name ?? id);
    out.push({ key: `c:${c.id}`, tab: 'combos', name: c.name, icon: c.weapons[0], glyph: '+', color: c.color, desc: c.desc, kind: `${a} + ${b}`.toUpperCase() });
  }
  for (const w of weapons) {
    (w.evos ?? []).forEach((e, k) => out.push({ key: `e:${w.id}:${k}`, tab: 'evolutions', name: e.name, icon: evoIcon(w.id, k), glyph: w.icon, color: e.color, tags: e.tags, desc: e.text, kind: `${w.name} EVOLUTION`.toUpperCase() }));
    if (w.evolution) {
      const partner = PASSIVES[w.evolution.passive]?.name ?? w.evolution.passive;
      out.push({ key: `e:${w.id}:auto`, tab: 'evolutions', name: w.evolution.name, icon: w.id, glyph: w.icon, color: w.evolution.color, desc: w.evolution.text, kind: `MAX ${w.name} + ${partner}`.toUpperCase() });
    }
  }
  for (const s of Object.values(SPECIALS)) {
    (s.evos ?? []).forEach((e, k) => out.push({ key: `e:${s.id}:${k}`, tab: 'evolutions', name: e.name, icon: evoIcon('sp_' + s.id, k), glyph: s.icon, color: e.color, tags: e.tags, desc: e.text, kind: `${s.name} EVOLUTION`.toUpperCase() }));
  }
  for (const s of STATUSES) out.push({ key: `s:${s.id}`, tab: 'statuses', name: s.name, icon: 's_' + s.id, glyph: s.glyph, color: s.color, desc: s.desc, kind: s.kind });
  for (const x of POWERUPS) out.push({ key: `x:${x.id}`, tab: 'powerups', name: x.name, icon: 'x_' + x.id, glyph: x.glyph, color: x.color, desc: x.desc, kind: x.kind });
  cache = out;
  return out;
}

/** Entries on one tab. */
export function codexTab(tab: CodexTab): CodexEntry[] {
  return codexEntries().filter((e) => e.tab === tab);
}

/** "x / y" discovered on a tab. */
export function codexCount(tab: CodexTab, discovered: readonly string[]): { have: number; total: number } {
  const list = codexTab(tab);
  const set = new Set(discovered);
  return { have: list.filter((e) => set.has(e.key)).length, total: list.length };
}

/** Is this key a real codex entry (filters typos and removed content out of saves)? */
export function isCodexKey(key: string): boolean {
  keys ??= new Set(codexEntries().map((e) => e.key));
  return keys.has(key);
}
let keys: Set<string> | null = null;
