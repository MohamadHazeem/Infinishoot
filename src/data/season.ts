/**
 * SEASON track (seasonpass lane): a free, cosmetic-only monthly track.
 *
 * - A season is a calendar month (local time, like RANKED: 'YYYY-MM'). Its
 *   theme comes from a seeded shuffle of THEMES per year, so every year has
 *   all twelve themes in a different order.
 * - 50 tiers, earned with season XP: the profile XP a run banks (time, kills,
 *   bosses, stages, quests; co-op runs get `coopBonus` more) plus weekly
 *   season challenges (three per ISO week).
 * - Tiers hold the theme's cosmetics at fixed tiers (TIER_SLOTS: stickers,
 *   banner, titles, HUD theme, trail, skin, colour set, pet hat, emote) and
 *   profile XP everywhere else. A cosmetic you already own (the theme came
 *   round again a year later) pays `dupXp` profile XP instead.
 * - Nothing here changes a run: every run still starts equal.
 *
 * Profile-kind items (title, banner, hud, trail, hat) are registered into
 * REWARD_BY_ID at load so equips and lobby cards resolve them, and into
 * PROFILE_REWARDS once owned so the PROFILE picker offers them.
 */
import { Rng } from '../core/rng';
import { PROFILE_REWARDS, REWARD_BY_ID, type ProfileReward } from './profile';
import { isoWeek } from './weekly';
import { dailySeed } from './modes';
import type { SkinDef } from './skins';

// ---------------------------------------------------------------- themes

export type HatShape = 'sunhat' | 'headphones' | 'earmuffs' | 'pith' | 'propeller' | 'antenna' | 'cupcake' | 'tricorn' | 'robo' | 'flower' | 'viking' | 'wizard';

type SkinColors = Omit<SkinDef, 'id' | 'name' | 'unlock' | 'season'>;

export interface SeasonTheme {
  id: string;
  name: string;
  /** One-line flavour on the SEASON screen. */
  tagline: string;
  /** Main colour (banner, HUD theme, screen accents). Sweetie 16. */
  color: string;
  /** HUD theme colour, when it differs from the banner. */
  hud?: string;
  /** Trail colours (cycled per puff). */
  trail: string[];
  title: string;
  champion: string;
  hat: { name: string; shape: HatShape; color: string; trim: string };
  skin: { name: string } & SkinColors;
  set: { name: string } & SkinColors;
  emote: { label: string; say: string; color: string; rec: 'start' | 'win' | 'revive' | 'bigkill' | 'lowhp' | 'level'; synth: 'levelUp' | 'victory' | 'revive' | 'dodge' | 'hurt' | 'lowLife'; glyph: string[] };
  /** Two word stickers for photo mode: [text, colour, burst colour or ''] . */
  stickers: [[string, string, string], [string, string, string]];
}

const C = {
  ink: '#1a1c2c', plum: '#5d275d', red: '#b13e53', orange: '#ef7d57', yellow: '#ffcd75', lime: '#a7f070', green: '#38b764', teal: '#257179',
  navy: '#29366f', blue: '#3b5dc9', sky: '#41a6f6', cyan: '#73eff7', white: '#f4f4f4', mist: '#94b0c2', slate: '#566c86', night: '#333c57',
};

export const THEMES: readonly SeasonTheme[] = [
  {
    id: 'sunburst', name: 'Sunburst Summer', tagline: 'Sun, sand and a lot of robots.', color: C.orange, hud: C.yellow, trail: [C.yellow, C.orange, C.white],
    title: 'Sun Chaser', champion: 'Summer Champion',
    hat: { name: 'Sun Hat', shape: 'sunhat', color: C.yellow, trim: C.red },
    skin: { name: 'Beach Day', armor: C.yellow, accent: C.orange, suit: C.teal, hair: C.red, gem: C.cyan, iris: C.sky },
    set: { name: 'Lifeguard', armor: C.red, accent: C.white, suit: C.yellow, hair: C.orange, gem: C.cyan, iris: C.teal },
    emote: { label: 'SUNNY', say: "SUN'S OUT!", color: C.yellow, rec: 'win', synth: 'victory', glyph: ['...oo...', '.o.oo.o.', '..oooo..', 'oooooooo', 'oooooooo', '..oooo..', '.o.oo.o.', '...oo...'] },
    stickers: [['SPLASH!', C.cyan, C.blue], ['SUMMER!', C.yellow, C.orange]],
  },
  {
    id: 'neon', name: 'Neon Nights', tagline: 'The city never sleeps, and neither do the bots.', color: C.plum, hud: C.cyan, trail: [C.cyan, C.sky, C.plum],
    title: 'Night Owl', champion: 'Neon Champion',
    hat: { name: 'Headphones', shape: 'headphones', color: C.night, trim: C.cyan },
    skin: { name: 'Synthwave', armor: C.plum, accent: C.cyan, suit: C.ink, hair: C.sky, gem: C.yellow, iris: C.cyan },
    set: { name: 'Glowstick', armor: C.lime, accent: C.sky, suit: C.night, hair: C.cyan, gem: C.orange, iris: C.green },
    emote: { label: 'DANCE', say: 'DROP THE BEAT!', color: C.cyan, rec: 'bigkill', synth: 'dodge', glyph: ['..oooooo', '..o....o', '..o....o', '..o....o', 'ooo..ooo', 'ooo..ooo', '........', '........'] },
    stickers: [['BEEP!', C.cyan, C.plum], ['RAD!', C.lime, '']],
  },
  {
    id: 'frost', name: 'Frostbite Fest', tagline: 'Snowball fights with a lot more lasers.', color: C.sky, hud: C.cyan, trail: [C.white, C.cyan, C.sky],
    title: 'Snow Day', champion: 'Frost Champion',
    hat: { name: 'Earmuffs', shape: 'earmuffs', color: C.white, trim: C.sky },
    skin: { name: 'Snowdrift', armor: C.white, accent: C.sky, suit: C.navy, hair: C.mist, gem: C.cyan, iris: C.blue },
    set: { name: 'Icicle', armor: C.cyan, accent: C.white, suit: C.blue, hair: C.white, gem: C.sky, iris: C.cyan },
    emote: { label: 'BRRR', say: 'BRRR, COLD!', color: C.cyan, rec: 'lowhp', synth: 'hurt', glyph: ['o..o..o.', '.o.o.o..', '..ooo...', 'ooo#ooo.', '..ooo...', '.o.o.o..', 'o..o..o.', '........'] },
    stickers: [['BRRR!', C.cyan, C.navy], ['CHILL!', C.white, '']],
  },
  {
    id: 'jungle', name: 'Jungle Rumble', tagline: 'Vines, ruins and something big in the trees.', color: C.green, hud: C.lime, trail: [C.green, C.lime, C.yellow],
    title: 'Vine Swinger', champion: 'Jungle Champion',
    hat: { name: 'Explorer Hat', shape: 'pith', color: C.yellow, trim: C.green },
    skin: { name: 'Canopy', armor: C.green, accent: C.yellow, suit: C.teal, hair: C.orange, gem: C.lime, iris: C.green },
    set: { name: 'Tree Frog', armor: C.lime, accent: C.red, suit: C.green, hair: C.teal, gem: C.orange, iris: C.red },
    emote: { label: 'ROAR', say: 'ROOOAR!', color: C.orange, rec: 'bigkill', synth: 'victory', glyph: ['.o..o...', 'o.oo.o..', '........', '.oooo...', 'oooooo..', 'oooooo..', '.o..o...', '........'] },
    stickers: [['ROAR!', C.orange, C.green], ['WILD!', C.lime, '']],
  },
  {
    id: 'arcade', name: 'Arcade Fever', tagline: 'Insert coin. Beat the high score.', color: C.red, hud: C.yellow, trail: [C.red, C.yellow, C.sky],
    title: 'High Scorer', champion: 'Arcade Champion',
    hat: { name: 'Propeller Cap', shape: 'propeller', color: C.red, trim: C.yellow },
    skin: { name: 'Cabinet', armor: C.red, accent: C.yellow, suit: C.ink, hair: C.sky, gem: C.lime, iris: C.red },
    set: { name: 'Joystick', armor: C.ink, accent: C.red, suit: C.night, hair: C.yellow, gem: C.red, iris: C.sky },
    emote: { label: 'COIN', say: 'INSERT COIN!', color: C.yellow, rec: 'level', synth: 'levelUp', glyph: ['..oooo..', '.oo##oo.', 'ooo#oooo', 'ooo##ooo', 'oooo#ooo', '.oo##oo.', '..oooo..', '........'] },
    stickers: [['COMBO!', C.yellow, C.red], ['K.O.!', C.red, C.yellow]],
  },
  {
    id: 'cosmic', name: 'Cosmic Drift', tagline: 'Stars overhead and saucers on the horizon.', color: C.blue, hud: C.cyan, trail: [C.blue, C.white, C.cyan],
    title: 'Star Pilot', champion: 'Cosmic Champion',
    hat: { name: 'Antenna Bobbles', shape: 'antenna', color: C.mist, trim: C.lime },
    skin: { name: 'Nebula', armor: C.blue, accent: C.cyan, suit: C.ink, hair: C.plum, gem: C.white, iris: C.sky },
    set: { name: 'Moonwalker', armor: C.white, accent: C.mist, suit: C.night, hair: C.yellow, gem: C.sky, iris: C.navy },
    emote: { label: 'UFO', say: 'BEAM ME UP!', color: C.lime, rec: 'start', synth: 'levelUp', glyph: ['...oo...', '..oooo..', '.oooooo.', 'oo#oo#oo', 'oooooooo', '.o.oo.o.', 'o..oo..o', '........'] },
    stickers: [['ZAP!', C.lime, C.blue], ['COSMIC!', C.cyan, '']],
  },
  {
    id: 'sugar', name: 'Sugar Rush', tagline: 'Everything is sweet. Even the explosions.', color: C.red, hud: C.lime, trail: [C.red, C.white, C.lime],
    title: 'Sweet Tooth', champion: 'Sugar Champion',
    hat: { name: 'Cupcake Hat', shape: 'cupcake', color: C.white, trim: C.red },
    skin: { name: 'Gumdrop', armor: C.orange, accent: C.lime, suit: C.plum, hair: C.yellow, gem: C.cyan, iris: C.red },
    set: { name: 'Peppermint', armor: C.white, accent: C.red, suit: C.red, hair: C.white, gem: C.lime, iris: C.green },
    emote: { label: 'YUM', say: 'YUM YUM!', color: C.red, rec: 'level', synth: 'levelUp', glyph: ['.oooo...', 'oo##oo..', 'o#oo#o..', 'oo##oo..', '.oooo...', '....o...', '.....o..', '......o.'] },
    stickers: [['YUM!', C.red, C.white], ['SWEET!', C.lime, '']],
  },
  {
    id: 'pirate', name: 'Pirate Tide', tagline: 'Hoist the colours and find the treasure.', color: C.teal, hud: C.yellow, trail: [C.teal, C.yellow, C.white],
    title: 'Sea Dog', champion: 'Pirate Champion',
    hat: { name: 'Tricorn', shape: 'tricorn', color: C.ink, trim: C.yellow },
    skin: { name: 'Buccaneer', armor: C.teal, accent: C.yellow, suit: C.ink, hair: C.red, gem: C.yellow, iris: C.teal },
    set: { name: 'Deckhand', armor: C.white, accent: C.navy, suit: C.blue, hair: C.orange, gem: C.red, iris: C.navy },
    emote: { label: 'AHOY', say: 'AHOY THERE!', color: C.yellow, rec: 'start', synth: 'victory', glyph: ['...o....', '..o.o...', '...o....', 'ooooooo.', '...o....', 'o..o..o.', '.ooooo..', '........'] },
    stickers: [['AHOY!', C.yellow, C.teal], ['ARRR!', C.white, '']],
  },
  {
    id: 'robo', name: 'Robo Rally', tagline: 'Bolts, gears and a very big wrench.', color: C.slate, hud: C.orange, trail: [C.mist, C.orange, C.slate],
    title: 'Gearhead', champion: 'Robo Champion',
    hat: { name: 'Robo Visor', shape: 'robo', color: C.mist, trim: C.orange },
    skin: { name: 'Chrome', armor: C.mist, accent: C.white, suit: C.slate, hair: C.night, gem: C.orange, iris: C.sky },
    set: { name: 'Rust Bucket', armor: C.orange, accent: C.yellow, suit: C.night, hair: C.red, gem: C.cyan, iris: C.orange },
    emote: { label: 'BEEP', say: 'BEEP BOOP!', color: C.mist, rec: 'revive', synth: 'revive', glyph: ['...oo...', '...oo...', 'oooooooo', 'o##oo##o', 'oooooooo', 'oo####oo', 'oooooooo', '........'] },
    stickers: [['CLANK!', C.orange, C.slate], ['BZZT!', C.cyan, '']],
  },
  {
    id: 'blossom', name: 'Blossom Breeze', tagline: 'Petals in the wind and bees on patrol.', color: C.green, hud: C.lime, trail: [C.lime, C.red, C.white],
    title: 'Petal Dancer', champion: 'Blossom Champion',
    hat: { name: 'Flower Crown', shape: 'flower', color: C.red, trim: C.lime },
    skin: { name: 'Spring', armor: C.lime, accent: C.white, suit: C.green, hair: C.yellow, gem: C.red, iris: C.green },
    set: { name: 'Cherry', armor: C.red, accent: C.lime, suit: C.white, hair: C.plum, gem: C.green, iris: C.red },
    emote: { label: 'LOVE', say: 'SO PRETTY!', color: C.red, rec: 'revive', synth: 'revive', glyph: ['.oo..oo.', 'oooooooo', 'oooooooo', 'oooooooo', '.oooooo.', '..oooo..', '...oo...', '........'] },
    stickers: [['BLOOM!', C.lime, C.red], ['LOVE!', C.red, '']],
  },
  {
    id: 'volcano', name: 'Volcano Party', tagline: 'Bring snacks. Leave before the lava.', color: C.red, hud: C.orange, trail: [C.orange, C.red, C.yellow],
    title: 'Lava Surfer', champion: 'Volcano Champion',
    hat: { name: 'Viking Helm', shape: 'viking', color: C.mist, trim: C.white },
    skin: { name: 'Obsidian', armor: C.ink, accent: C.orange, suit: C.night, hair: C.red, gem: C.yellow, iris: C.orange },
    set: { name: 'Hot Rock', armor: C.orange, accent: C.yellow, suit: C.red, hair: C.ink, gem: C.white, iris: C.red },
    emote: { label: 'HOT', say: 'TOO HOT!', color: C.orange, rec: 'lowhp', synth: 'lowLife', glyph: ['...o....', '...oo...', '..ooo.o.', '.oooooo.', '.oo##oo.', 'oo####oo', '.o####o.', '..oooo..'] },
    stickers: [['KABOOM!', C.yellow, C.red], ['HOT!', C.orange, '']],
  },
  {
    id: 'storm', name: 'Thunder Parade', tagline: 'Drums of thunder and a sky full of sparks.', color: C.navy, hud: C.sky, trail: [C.sky, C.yellow, C.white],
    title: 'Storm Rider', champion: 'Thunder Champion',
    hat: { name: 'Wizard Hat', shape: 'wizard', color: C.blue, trim: C.yellow },
    skin: { name: 'Stormcloud', armor: C.slate, accent: C.yellow, suit: C.navy, hair: C.white, gem: C.sky, iris: C.yellow },
    set: { name: 'Lightning', armor: C.yellow, accent: C.sky, suit: C.ink, hair: C.yellow, gem: C.white, iris: C.sky },
    emote: { label: 'ZAP', say: 'SHOCKING!', color: C.yellow, rec: 'bigkill', synth: 'dodge', glyph: ['....ooo.', '...ooo..', '..ooo...', '.oooooo.', '...ooo..', '..ooo...', '.oo.....', 'o.......'] },
    stickers: [['KRAK!', C.yellow, C.navy], ['BOOM!', C.sky, '']],
  },
];

export const THEME_BY_ID: Record<string, SeasonTheme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

// ---------------------------------------------------------------- items

export type SeasonItemKind = 'title' | 'banner' | 'hud' | 'trail' | 'hat' | 'emote' | 'sticker' | 'skin';

/** Where a theme's cosmetic sits on the track. */
export type SeasonSlot = 'sticker1' | 'banner' | 'title' | 'sticker2' | 'hud' | 'trail' | 'skin' | 'hat' | 'emote' | 'set' | 'champion';

export interface SeasonItem {
  /** `sp_<theme>_<slot>`. */
  id: string;
  kind: SeasonItemKind;
  slot: SeasonSlot;
  theme: string;
  name: string;
  /** Swatch colours (first = main). */
  colors: string[];
}

/** Tier -> the theme cosmetic it holds (every other tier pays profile XP). */
export const TIER_SLOTS: Record<number, SeasonSlot> = { 1: 'sticker1', 4: 'banner', 8: 'title', 12: 'sticker2', 16: 'hud', 20: 'trail', 25: 'skin', 30: 'hat', 35: 'emote', 40: 'set', 50: 'champion' };

const SLOT_KIND: Record<SeasonSlot, SeasonItemKind> = { sticker1: 'sticker', banner: 'banner', title: 'title', sticker2: 'sticker', hud: 'hud', trail: 'trail', skin: 'skin', hat: 'hat', emote: 'emote', set: 'skin', champion: 'title' };

export const itemId = (theme: string, slot: SeasonSlot) => `sp_${theme}_${slot}`;

function makeItem(t: SeasonTheme, slot: SeasonSlot): SeasonItem {
  const kind = SLOT_KIND[slot];
  const base = { id: itemId(t.id, slot), kind, slot, theme: t.id };
  switch (slot) {
    case 'sticker1':
    case 'sticker2': {
      const s = t.stickers[slot === 'sticker1' ? 0 : 1];
      return { ...base, name: s[0], colors: [s[1], ...(s[2] ? [s[2]] : [])] };
    }
    case 'banner':
      return { ...base, name: t.name, colors: [t.color] };
    case 'hud':
      return { ...base, name: t.name, colors: [t.hud ?? t.color] };
    case 'trail':
      return { ...base, name: t.name, colors: [...t.trail] };
    case 'title':
      return { ...base, name: t.title, colors: [t.color] };
    case 'champion':
      return { ...base, name: t.champion, colors: [C.yellow, t.color] };
    case 'hat':
      return { ...base, name: t.hat.name, colors: [t.hat.color, t.hat.trim] };
    case 'emote':
      return { ...base, name: t.emote.label, colors: [t.emote.color] };
    case 'skin':
      return { ...base, name: t.skin.name, colors: [t.skin.armor, t.skin.accent, t.skin.suit, t.skin.hair] };
    case 'set':
      return { ...base, name: t.set.name, colors: [t.set.armor, t.set.accent, t.set.suit, t.set.hair] };
  }
}

export const SEASON_ITEMS: readonly SeasonItem[] = THEMES.flatMap((t) => (Object.values(TIER_SLOTS) as SeasonSlot[]).map((slot) => makeItem(t, slot)));
export const SEASON_ITEM_BY_ID: Record<string, SeasonItem> = Object.fromEntries(SEASON_ITEMS.map((i) => [i.id, i]));

/** Wardrobe skins (both colour sets of every theme), worn like any skin; owned through the track. */
export const SEASON_SKINS: SkinDef[] = THEMES.flatMap((t) =>
  (['skin', 'set'] as const).map((slot) => {
    const { name, ...cols } = t[slot];
    return { id: itemId(t.id, slot), name, season: t.id, ...cols };
  }),
);

/** Ping-wheel emotes: the 7th EMOTES slice is the one equipped on the SEASON screen. */
export const SEASON_EMOTES = THEMES.map((t) => ({ id: itemId(t.id, 'emote'), ...t.emote }));
export const SEASON_EMOTE_BY_ID: Record<string, (typeof SEASON_EMOTES)[number]> = Object.fromEntries(SEASON_EMOTES.map((e) => [e.id, e]));

/** Photo-mode word stickers by item id: [text, colour, burst]. */
export const SEASON_STICKERS: Record<string, [string, string, string]> = Object.fromEntries(
  THEMES.flatMap((t) => [
    [itemId(t.id, 'sticker1'), t.stickers[0]],
    [itemId(t.id, 'sticker2'), t.stickers[1]],
  ]),
);

/** Pet hat looks by item id. */
export const SEASON_HATS: Record<string, SeasonTheme['hat']> = Object.fromEntries(THEMES.map((t) => [itemId(t.id, 'hat'), t.hat]));

// ---------------------------------------------------------------- profile registration

/** Profile-kind season items as profile rewards (level 0, owned through the track). */
export const SEASON_PROFILE_REWARDS: ProfileReward[] = SEASON_ITEMS.filter((i) => ['title', 'banner', 'hud', 'trail', 'hat'].includes(i.kind)).map((i) => ({
  id: i.id,
  kind: i.kind as ProfileReward['kind'],
  name: i.name,
  level: 0,
  season: i.theme,
  color: i.colors[0],
  ...(i.kind === 'trail' ? { colors: i.colors } : {}),
}));

for (const r of SEASON_PROFILE_REWARDS) REWARD_BY_ID[r.id] ??= r;

/** Put owned season items into PROFILE_REWARDS (the PROFILE picker lists owned ones only). Idempotent. */
export function syncOwnedRewards(owned: readonly string[]): void {
  for (const id of owned) {
    const r = REWARD_BY_ID[id];
    if (r?.season && !PROFILE_REWARDS.includes(r)) PROFILE_REWARDS.push(r);
  }
}

// ---------------------------------------------------------------- calendar and track

export const seasonTuning = {
  /** Tiers per season. */
  tiers: 50,
  /** Season XP per tier: the first few are quick. */
  earlyTiers: 5,
  earlyXp: 250,
  tierXp: 400,
  /** Co-op runs (2+ heroes, online or local) earn this much more season XP (on top of profile XP's own co-op bonus). */
  coopBonus: 1.1,
  /** Profile XP paid by a filler tier: base + perTier * tier (rounded to 10). */
  fillerBase: 100,
  fillerPerTier: 4,
  /** Profile XP instead of a cosmetic you already own. */
  dupXp: 250,
  /** Past seasons kept on the SEASON screen. */
  pastKept: 24,
};

/** The calendar the track follows (test links move it: `spmonth=2027-03`). */
export const seasonClock = { now: (): Date => new Date() };

/** 'YYYY-MM' in local time (the same calendar as RANKED seasons). */
export function seasonKey(d: Date = seasonClock.now()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Year and month (1-12) of a season key. */
export function seasonParts(key: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? { year: Number(m[1]), month: Math.max(1, Math.min(12, Number(m[2]))) } : { year: 2026, month: 1 };
}

/** The theme of a season: a seeded shuffle of all twelve themes per year. */
export function themeFor(key: string): SeasonTheme {
  const { year, month } = seasonParts(key);
  const rng = new Rng(dailySeed(`infinishoot-season-v1-${year}`));
  const order = THEMES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return THEMES[order[(month - 1) % order.length]];
}

/** Milliseconds until the season ends (local midnight on the 1st of next month). */
export function seasonMsLeft(now: Date = seasonClock.now()): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.max(0, end.getTime() - now.getTime());
}

/** Milliseconds until the weekly challenges reset (Monday 00:00 UTC, like ISO weeks). */
export function weekMsLeft(now: Date = seasonClock.now()): number {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (8 - dow));
  return Math.max(0, d.getTime() - now.getTime());
}

export interface TierReward {
  tier: number;
  item: SeasonItem | null;
  /** Profile XP (filler tiers). */
  xp: number;
}

/** The 50 tiers of a season. */
export function seasonTrack(key: string): TierReward[] {
  const t = themeFor(key);
  const T = seasonTuning;
  const out: TierReward[] = [];
  for (let tier = 1; tier <= T.tiers; tier++) {
    const slot = TIER_SLOTS[tier];
    out.push(slot ? { tier, item: SEASON_ITEM_BY_ID[itemId(t.id, slot)], xp: 0 } : { tier, item: null, xp: Math.round((T.fillerBase + T.fillerPerTier * tier) / 10) * 10 });
  }
  return out;
}

/** Season XP needed for one tier (1-based). */
export function tierNeed(tier: number): number {
  return tier <= seasonTuning.earlyTiers ? seasonTuning.earlyXp : seasonTuning.tierXp;
}

/** Season XP to reach a tier (tier 0 = 0). */
export function xpForTier(tier: number): number {
  const T = seasonTuning;
  const n = Math.max(0, Math.min(T.tiers, Math.floor(tier)));
  const early = Math.min(n, T.earlyTiers);
  return early * T.earlyXp + (n - early) * T.tierXp;
}

/** Tier reached for an amount of season XP, with progress into the next one (frac 1 at the top). */
export function tierOf(xp: number): { tier: number; into: number; need: number; frac: number } {
  const T = seasonTuning;
  let tier = 0;
  while (tier < T.tiers && xp >= xpForTier(tier + 1)) tier++;
  if (tier >= T.tiers) return { tier, into: 0, need: 0, frac: 1 };
  const into = xp - xpForTier(tier);
  const need = tierNeed(tier + 1);
  return { tier, into, need, frac: Math.max(0, Math.min(1, into / need)) };
}

/** Season XP a run is worth: the profile XP it banked (quests included), with the co-op bonus. */
export function seasonRunXp(profileXp: number, coop: boolean): number {
  const x = Math.max(0, Math.floor(profileXp));
  return coop ? Math.round(x * seasonTuning.coopBonus) : x;
}

// ---------------------------------------------------------------- weekly challenges

export type ChallengeGroup = 'feature' | 'medium' | 'hard';

export interface ChallengeDef {
  id: string;
  /** Text with `#` for the goal. */
  text: string;
  /** Run-tally key (src/data/profile.ts), or a season counter fed straight away (raidClears, raceWins, trialGolds). */
  stat: string;
  goal: number;
  /** 'sum' adds every run; 'peak' keeps the best run. */
  kind: 'sum' | 'peak';
  group: ChallengeGroup;
  /** Only offered once a lane feeds this counter (see `seasonFeeds`). */
  needs?: string;
}

/** Season XP per completed challenge. */
export const CHALLENGE_XP: Record<ChallengeGroup, number> = { feature: 800, medium: 500, hard: 700 };

/** Counters other lanes feed through `seasonCount(g, key)` (src/game/systems/season.ts). */
export const INSTANT_STATS = ['raidClears', 'raceWins', 'trialGolds'];

export const CHALLENGES: ChallengeDef[] = [
  { id: 'c_raid', text: 'Clear a raid', stat: 'raidClears', goal: 1, kind: 'sum', group: 'feature' },
  { id: 'c_race', text: 'Win a race', stat: 'raceWins', goal: 1, kind: 'sum', group: 'feature' },
  { id: 'c_style', text: 'Reach SS style rank', stat: 'style', goal: 5, kind: 'peak', group: 'feature' },
  { id: 'c_trials', text: 'Win a gold medal in # trials', stat: 'trialGolds', goal: 3, kind: 'sum', group: 'feature', needs: 'trialGolds' },
  { id: 'c_kill1500', text: 'Defeat # enemies', stat: 'kills', goal: 1500, kind: 'sum', group: 'medium' },
  { id: 'c_boss3', text: 'Defeat # bosses', stat: 'bosses', goal: 3, kind: 'sum', group: 'medium' },
  { id: 'c_elite15', text: 'Defeat # elites', stat: 'k_elite', goal: 15, kind: 'sum', group: 'medium' },
  { id: 'c_chest15', text: 'Open # chests', stat: 'chests', goal: 15, kind: 'sum', group: 'medium' },
  { id: 'c_parry25', text: 'Parry # shots', stat: 'parries', goal: 25, kind: 'sum', group: 'medium' },
  { id: 'c_coop2', text: 'Clear # stages in co-op', stat: 'coopStages', goal: 2, kind: 'sum', group: 'medium' },
  { id: 'c_combo200', text: 'Reach a # combo', stat: 'combo', goal: 200, kind: 'peak', group: 'medium' },
  { id: 'c_evo2', text: 'Evolve # items in one run', stat: 'evolutions', goal: 2, kind: 'peak', group: 'medium' },
  { id: 'c_kill5000', text: 'Defeat # enemies', stat: 'kills', goal: 5000, kind: 'sum', group: 'hard' },
  { id: 'c_stage10', text: 'Clear # stages', stat: 'stages', goal: 10, kind: 'sum', group: 'hard' },
  { id: 'c_flawless2', text: 'Clear # stages without getting hit', stat: 'flawless', goal: 2, kind: 'sum', group: 'hard' },
  { id: 'c_mini4', text: 'Defeat # mini-bosses', stat: 'k_mini', goal: 4, kind: 'sum', group: 'hard' },
  { id: 'c_loop', text: 'Clear a loop', stat: 'victories', goal: 1, kind: 'sum', group: 'hard' },
  { id: 'c_wave6', text: 'Reach wave # in Endless', stat: 'wave', goal: 6, kind: 'peak', group: 'hard' },
  { id: 'c_pdash40', text: 'Land # perfect dashes', stat: 'perfectDashes', goal: 40, kind: 'sum', group: 'hard' },
];

export const CHALLENGE_BY_ID: Record<string, ChallengeDef> = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));

/** Instant counters some lane feeds (gates challenges with `needs`). Raids and races are fed by this lane itself. */
export const seasonFeeds = new Set<string>(['raidClears', 'raceWins']);

export function challengeText(c: ChallengeDef): string {
  return c.text.replace('#', c.goal.toLocaleString('en-US'));
}

/** The week's three challenges: one feature (raid, race, style, trials), one medium, one hard, never two on one stat. */
export function weeklyChallenges(week: string, feeds: ReadonlySet<string> = seasonFeeds): ChallengeDef[] {
  const rng = new Rng(dailySeed(`infinishoot-season-week-v1-${week}`));
  const out: ChallengeDef[] = [];
  for (const group of ['feature', 'medium', 'hard'] as ChallengeGroup[]) {
    const pool = CHALLENGES.filter((c) => c.group === group && (!c.needs || feeds.has(c.needs)) && !out.some((o) => o.stat === c.stat));
    out.push(pool[Math.floor(rng.next() * pool.length) % pool.length]);
  }
  return out;
}

// ---------------------------------------------------------------- save

export interface PastSeason {
  season: string;
  theme: string;
  tier: number;
}

export interface SeasonPassSave {
  /** Current season key ('' = not started yet). */
  season: string;
  /** Season XP this season. */
  xp: number;
  /** Tiers claimed (claims go in order). */
  claimed: number;
  /** Season cosmetics owned forever (item ids). */
  owned: string[];
  /** Season emote on the ping wheel's EMOTES page ('' = none). */
  emote: string;
  /** ISO week of the challenges, their ids, progress and done flags. */
  week: string;
  ch: string[];
  prog: number[];
  done: boolean[];
  /** Season XP over all seasons. */
  total: number;
  /** Finished seasons, newest first. */
  past: PastSeason[];
}

export function freshSeasonPass(): SeasonPassSave {
  return { season: '', xp: 0, claimed: 0, owned: [], emote: '', week: '', ch: [], prog: [], done: [], total: 0, past: [] };
}

const KEY = /^\d{4}-\d{2}$/;
const WEEK = /^\d{4}-W\d{2}$/;
const nn = (v: unknown, max = 1e9) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(max, Math.floor(Number(v))) : 0);

/** Clean a stored season pass (anything missing or junk falls back). Also lists owned items in the PROFILE picker. */
export function normalizeSeasonPass(raw: unknown): SeasonPassSave {
  const d = freshSeasonPass();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SeasonPassSave>;
  if (KEY.test(String(r.season))) d.season = String(r.season);
  if (d.season) {
    d.xp = nn(r.xp, xpForTier(seasonTuning.tiers) * 4);
    d.claimed = Math.min(nn(r.claimed, seasonTuning.tiers), tierOf(d.xp).tier);
  }
  if (Array.isArray(r.owned)) d.owned = [...new Set(r.owned.filter((id): id is string => typeof id === 'string' && !!SEASON_ITEM_BY_ID[id]))];
  if (typeof r.emote === 'string' && d.owned.includes(r.emote) && SEASON_EMOTE_BY_ID[r.emote]) d.emote = r.emote;
  if (WEEK.test(String(r.week)) && Array.isArray(r.ch) && r.ch.length === 3 && r.ch.every((id) => typeof id === 'string' && CHALLENGE_BY_ID[id])) {
    d.week = String(r.week);
    d.ch = [...r.ch];
    d.prog = d.ch.map((id, i) => Math.min(CHALLENGE_BY_ID[id].goal, nn(Array.isArray(r.prog) ? r.prog[i] : 0)));
    d.done = d.ch.map((id, i) => !!(Array.isArray(r.done) && r.done[i]) || d.prog[i] >= CHALLENGE_BY_ID[id].goal);
  }
  d.total = Math.max(nn(r.total), d.xp);
  if (Array.isArray(r.past))
    d.past = r.past
      .filter((p) => p && typeof p === 'object' && KEY.test(String(p.season)) && THEME_BY_ID[String(p.theme)])
      .map((p) => ({ season: String(p.season), theme: String(p.theme), tier: Math.min(seasonTuning.tiers, nn(p.tier)) }))
      .slice(0, seasonTuning.pastKept);
  syncOwnedRewards(d.owned);
  return d;
}

// ---------------------------------------------------------------- pure progress (unit-tested)

export interface ClaimResult {
  tier: number;
  item: SeasonItem | null;
  /** Profile XP paid (filler tier, or a cosmetic already owned). */
  xp: number;
  dup: boolean;
}

/** Claim the next earned tier, if any. */
export function claimNext(sp: SeasonPassSave): ClaimResult | null {
  if (!sp.season || sp.claimed >= tierOf(sp.xp).tier) return null;
  const tr = seasonTrack(sp.season)[sp.claimed];
  sp.claimed++;
  if (!tr.item) return { tier: tr.tier, item: null, xp: tr.xp, dup: false };
  if (sp.owned.includes(tr.item.id)) return { tier: tr.tier, item: tr.item, xp: seasonTuning.dupXp, dup: true };
  sp.owned.push(tr.item.id);
  syncOwnedRewards([tr.item.id]);
  return { tier: tr.tier, item: tr.item, xp: 0, dup: false };
}

/** Claim every earned tier. */
export function claimAll(sp: SeasonPassSave): ClaimResult[] {
  const out: ClaimResult[] = [];
  for (let c = claimNext(sp); c; c = claimNext(sp)) out.push(c);
  return out;
}

/** Earned but not yet claimed. */
export function unclaimed(sp: SeasonPassSave): number {
  return sp.season ? Math.max(0, tierOf(sp.xp).tier - sp.claimed) : 0;
}

/** Add season XP; returns tiers before and after. */
export function addSeasonXp(sp: SeasonPassSave, xp: number): { from: number; to: number } {
  const from = tierOf(sp.xp).tier;
  const n = Math.max(0, Math.floor(xp));
  sp.xp += n;
  sp.total += n;
  return { from, to: tierOf(sp.xp).tier };
}

export interface RollResult {
  /** A season ended: what it reached and what was claimed for you. */
  ended: { season: string; theme: string; tier: number; claims: ClaimResult[] } | null;
  newWeek: boolean;
}

/** Start the season and the week if the calendar moved on. A finished season's earned tiers are claimed for you. */
export function rollSeasonPass(sp: SeasonPassSave, now: Date = seasonClock.now(), feeds: ReadonlySet<string> = seasonFeeds): RollResult {
  const key = seasonKey(now);
  let ended: RollResult['ended'] = null;
  if (sp.season !== key) {
    if (sp.season) {
      const claims = claimAll(sp);
      const tier = tierOf(sp.xp).tier;
      const theme = themeFor(sp.season).id;
      sp.past.unshift({ season: sp.season, theme, tier });
      sp.past.length = Math.min(sp.past.length, seasonTuning.pastKept);
      ended = { season: sp.season, theme, tier, claims };
    }
    sp.season = key;
    sp.xp = 0;
    sp.claimed = 0;
  }
  const week = isoWeek(now);
  let newWeek = false;
  if (sp.week !== week || sp.ch.length !== 3) {
    sp.week = week;
    sp.ch = weeklyChallenges(week, feeds).map((c) => c.id);
    sp.prog = [0, 0, 0];
    sp.done = [false, false, false];
    newWeek = true;
  }
  return { ended, newWeek };
}

/** Fold counters into the week's challenges. Returns the challenges finished and the season XP they pay (not yet added). */
export function applyChallenges(sp: SeasonPassSave, tally: Record<string, number>): { done: ChallengeDef[]; xp: number } {
  const done: ChallengeDef[] = [];
  let xp = 0;
  sp.ch.forEach((id, i) => {
    const c = CHALLENGE_BY_ID[id];
    if (!c || sp.done[i]) return;
    const v = Math.max(0, Number(tally[c.stat]) || 0);
    if (!v) return;
    sp.prog[i] = Math.min(c.goal, c.kind === 'peak' ? Math.max(sp.prog[i] ?? 0, v) : (sp.prog[i] ?? 0) + v);
    if (sp.prog[i] >= c.goal) {
      sp.done[i] = true;
      done.push(c);
      xp += CHALLENGE_XP[c.group];
    }
  });
  return { done, xp };
}
