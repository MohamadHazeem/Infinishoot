import { binds, keyLabel, type Action } from '../core/keybinds';
import { TIPS2, TIP2_PRIORITY, type Tip2Id } from '../data/tips2';

/**
 * First-time tips: a small pixel panel the first time something happens in a
 * run (first level-up, elite, status combo, boss...). Each shows once per save
 * (`save.tips`), never pauses the game, and SETTINGS > TIPS turns them off.
 * Detection lives in src/game/onboarding.ts; this file is the text and the rules.
 */
export type TipId =
  | 'levelup'
  | 'evofork'
  | 'shop'
  | 'modorder'
  | 'elite'
  | 'exposed'
  | 'status'
  | 'combo'
  | 'boss'
  | 'bosssoon'
  | 'chest'
  | 'special'
  | 'ult'
  | 'style'
  | 'gear'
  | 'portal'
  | 'down'
  | 'matedown'
  | Tip2Id;

/** "Q / E" for an action's bound keys. */
export function keysOf(a: Action): string {
  return binds[a]
    .filter(Boolean)
    .map(keyLabel)
    .join(' / ');
}

export interface TipDef {
  title: string;
  text: () => string;
  /** Seconds on screen (longer text stays longer). */
  time?: number;
}

export const TIPS: Record<TipId, TipDef> = {
  levelup: { title: 'LEVEL UP!', text: () => 'Pick 1 of 3 cards (click, or keys 1-3). The ribbon at the bottom says what it upgrades: LEFT CLICK, RIGHT CLICK, SPECIAL, AUTO WEAPON or ITEM.' },
  evofork: { title: 'EVOLUTION FORK', text: () => 'Enough ranks to evolve! Pick ONE of the two forms. Each changes how the item works and adds a tag that new Mods can key off.', time: 9 },
  shop: { title: 'THE SHOP', text: () => 'Mods sit in 5 slots and change how your damage works. Gold you keep earns interest at each stage clear, so saving can pay off.' },
  modorder: { title: 'MOD ORDER MATTERS', text: () => 'Damage flows through your Mods LEFT to RIGHT: (damage + adds) x mults. Move flat "+damage" Mods before "x damage" ones with the arrows. Echo copies the Mod to its right.', time: 10 },
  elite: { title: 'ELITE!', text: () => 'A big, tough enemy with a modifier (shield, fast, splitting...). Its skull bar shows its life. Beat it for a treasure chest.' },
  exposed: { title: 'EXPOSED', text: () => 'Right-click hits Expose enemies: +30% damage from everyone for 4 s. Open with the right click, finish with the left.' },
  status: { title: 'STATUSES', text: () => 'Burn ticks damage, Shock makes enemies take +20%, Freeze stops them. Put two on the same enemy for a combo.' },
  combo: { title: 'STATUS COMBO!', text: () => 'Burn + Shock = OVERLOAD blast. Kill a Frozen enemy = SHATTER. An explosion on a Burning enemy = NAPALM. Mods can make each one stronger.', time: 9 },
  boss: { title: 'BOSS!', text: () => `It changes its attacks at 66% and 33% life. Red zones and lines are telegraphs: dash through them (${keysOf('dash')}) or parry shots (${keysOf('parry')}).`, time: 9 },
  bosssoon: { title: 'BOSS INCOMING', text: () => `The boss lands when the timer hits 0:00. Grab the XP gems and chests now. Red zones and lines are its attacks: dash (${keysOf('dash')}) out of them.`, time: 8 },
  chest: { title: 'TREASURE CHEST', text: () => 'Walk into it for a free item on the spot. The arrow at the screen edge points to the nearest one.' },
  special: { title: 'SPECIAL READY', text: () => `Press ${keysOf('bomb')} (or middle click) for your special. It recharges over time.` },
  ult: { title: 'ULTIMATE READY', text: () => `Press ${keysOf('ult')}! Perfect dodges, parries and kills charge your hero's ultimate.` },
  style: { title: 'STYLE METER', text: () => 'Fast kills, perfect dodges and parries raise your style from D to SS. Higher style gives more score and XP. Getting hit drops it.' },
  gear: { title: 'GEAR', text: () => `Each gear rerolls one set of level-up cards (${keysOf('reroll')} on the level-up screen).` },
  portal: { title: 'STAGE CLEAR', text: () => 'Walk into the portal for the next stage. Every stage hits harder, and every 4th ends with the final boss.' },
  down: { title: "YOU'RE DOWN", text: () => 'A teammate revives you by standing next to you for 3 s. Click to watch another teammate meanwhile.' },
  matedown: { title: 'TEAMMATE DOWN', text: () => 'Stand next to them for 3 s to revive them. You both get a moment of invincibility.' },
  // tips2 lane: the newer mechanics (src/data/tips2.ts, detection in src/game/systems/tips2.ts)
  ...TIPS2,
};

/** In-fight tips that jump the queue (lower first): telegraphs beat trivia. Menu tips always go first. */
export const TIP_PRIORITY: Partial<Record<TipId, number>> = { boss: 0, bosssoon: 1, elite: 2, special: 3, chest: 4, down: 0, matedown: 1, ...TIP2_PRIORITY };

/** Where a new in-fight tip goes in the queue: after every tip of the same or higher priority. */
export function tipInsertAt(id: TipId, queue: readonly TipId[]): number {
  const p = TIP_PRIORITY[id] ?? 9;
  const i = queue.findIndex((q) => (TIP_PRIORITY[q] ?? 9) > p);
  return i < 0 ? queue.length : i;
}

/** Should a tip show now? Off in settings, already seen, or queued already: no. */
export function tipWanted(id: TipId, enabled: boolean, seen: readonly string[], queued: readonly string[]): boolean {
  return enabled && !seen.includes(id) && !queued.includes(id);
}

/** Seconds a tip stays up: its own time, else by text length (5-9 s). */
export function tipTime(def: TipDef): number {
  return def.time ?? Math.max(5, Math.min(9, def.text().length / 18));
}
