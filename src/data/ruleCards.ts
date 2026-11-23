// Card IDs travel on the wire. Names and descriptions here are canonical English;
// the display boundary localizes them for the player who actually receives the hand.
export const RULE_CARDS = [
  {
    id: 'longshot',
    icon: '◎',
    name: 'Far Sight',
    text: 'Hits beyond 9 m deal 40% more damage. Closer hits deal 20% less.',
  },
  {
    id: 'infield',
    icon: '⊙',
    name: 'Inside Job',
    text: 'Hits within 4 m deal 45% more damage. Farther hits deal 15% less.',
  },
  {
    id: 'quarry',
    icon: '♜',
    name: 'Big Game',
    text: 'Deal 30% more damage to elites and bosses. Deal 15% less to ordinary enemies.',
  },
  {
    id: 'opener',
    icon: '◇',
    name: 'First Impression',
    text: 'Deal double damage to full-life enemies. Wounded enemies take 15% less.',
  },
  {
    id: 'finish',
    icon: '▼',
    name: 'Closing Argument',
    text: 'Deal 60% more damage below one-third enemy life. Earlier hits deal 10% less.',
  },
  {
    id: 'relay',
    icon: '⇄',
    name: 'Crossfire Relay',
    text: 'Switching damage sources gives the next hit +40% damage. Repeating a source costs 15%.',
  },
  {
    id: 'lockon',
    icon: '⊕',
    name: 'Tunnel Vision',
    text: 'Consecutive hits on the same enemy deal 30% more. Your first hit on each target deals 20% less.',
  },
  {
    id: 'exposed',
    icon: '◈',
    name: 'Marked Deck',
    text: 'Exposed targets take 45% more damage from you. Unmarked targets take 12% less.',
  },
  {
    id: 'anchor',
    icon: '▣',
    name: 'Anchor Bolt',
    text: 'Stand still to fire weapons 30% more frequently. Moving lengthens weapon cooldowns by 15%.',
  },
  {
    id: 'redline',
    icon: '♥',
    name: 'Redline Engine',
    text: 'Below half life your weapons recharge 35% faster. At half life or more they recharge 10% slower.',
  },
  {
    id: 'steady',
    icon: '═',
    name: 'Even Odds',
    text: 'Trade all base critical chance for steady damage. Each 1% traded adds 2% damage, up to 40%.',
  },
  {
    id: 'kiln',
    icon: '♨',
    name: 'Walking Furnace',
    text: 'Moving converts armor into damage, 5% per point up to 30%. Stop to regain the armor.',
  },
  {
    id: 'tithe',
    icon: '✚',
    name: 'Tenth Offering',
    text: 'Every tenth personal kill heals up to 3 life. All other healing is sealed.',
  },
  {
    id: 'reserve',
    icon: '◆',
    name: 'Bounty Ledger',
    text: 'Every personal elite or boss kill pays 4 gold. Your savings earn no interest.',
  },
  {
    id: 'capacitor',
    icon: 'ϟ',
    name: 'Stolen Charge',
    text: 'Personal elite and boss kills refill your special. Its normal recharge takes twice as long.',
  },
  {
    id: 'salvage',
    icon: '⚙',
    name: 'Scrap Merchant',
    text: 'Personal elite and boss kills grant a reroll gear. Base Mod prices rise by 2 gold, including the base for upgrades.',
  },
  {
    id: 'fieldkit',
    icon: '✛',
    name: 'Field Dressing',
    text: 'Skipping a level-up heals 18 life instead of awarding gold.',
  },
  {
    id: 'loaded',
    icon: '⚄',
    name: 'Loaded Dice',
    text: 'Card rerolls cost 1 gold and use no gear. Skipping cards pays no gold.',
  },
  {
    id: 'pawn',
    icon: '♟',
    name: 'Pawn Ticket',
    text: 'Sell Mods for their full paid price. Your savings earn no interest.',
  },
  {
    id: 'warrant',
    icon: '✕',
    name: 'Banish Warrant',
    text: 'A successful banish refunds its charge. Each banish costs 3 extra gold.',
  },
] as const;
export type RuleId = (typeof RULE_CARDS)[number]['id'];
export const RULE_BY_ID = new Map<string, (typeof RULE_CARDS)[number]>(
  RULE_CARDS.map((card) => [card.id, card]),
);

/** Conditional hit multipliers use the same base hit and defensive pipeline as weapons. */
export const ruleTuning = {
  longshot: { range: 9, far: 1.4, close: 0.8 },
  infield: { range: 4, close: 1.45, far: 0.85 },
  quarry: { big: 1.3, ordinary: 0.85 },
  opener: { fresh: 2, wounded: 0.85 },
  finish: { threshold: 1 / 3, low: 1.6, high: 0.9 },
  relay: { switched: 1.4, repeated: 0.85 },
  lockon: { repeated: 1.3, first: 0.8 },
  exposed: { marked: 1.45, unmarked: 0.88 },
  tithe: { every: 10, heal: 3 },
  reserveGold: 4,
  salvageMarkup: 2,
  fieldkitHeal: 18,
  warrantSurcharge: 3,
};
