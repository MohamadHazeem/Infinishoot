/**
 * Route map content (src/game/route.ts, src/game/systems/route.ts): the node kinds a player can
 * pick between stages and the Event node's choices. A node only changes the stage it leads into
 * (spawns, rewards, an event); the biome and boss order stay as they are.
 */

export type NodeKind = 'start' | 'elite' | 'shop' | 'treasure' | 'event' | 'rest' | 'hard' | 'stealth' | 'rhythm' | 'arcade' | 'pacifist' | 'secret';

export interface RouteNodeDef {
  id: NodeKind;
  name: string;
  /** One-line summary under the name. */
  short: string;
  /** Effect lines on the choice card. */
  lines: string[];
  /** Icon id (scripts/icons.mjs) and fallback glyph. */
  icon: string;
  glyph: string;
  /** Sweetie 16 colour. */
  color: string;
  /** Weight when rolling a map layer (0 = never rolled). */
  weight: number;
}

export const routeTuning = {
  /** Co-op: seconds before the host's pick (or the most votes) decides. */
  voteTime: 10,
  /** Layers drawn ahead of the choice on the map. */
  ahead: 2,
  /** Layers of the path behind shown on the map. */
  behind: 3,
  // Elite Hunt
  eliteOffset: 24, // an extra elite between each pair of the director's (every 48 s), so one every 24 s
  eliteHp: 0.1, // +10% enemy life
  // Treasure Trove
  treasureChests: 3, // chests waiting at the start
  treasureChestT: 18, // the first timed chest comes this much sooner
  treasureCount: -0.3, // 30% fewer enemies
  treasureGears: 1,
  // Merchant Road
  shopGold: 20, // bonus gold at the stage clear, on top of the secret merchant
  // Campfire
  restGears: 1,
  // Danger Zone
  hardHp: 0.35,
  hardDmg: 0.25,
  hardCount: 0.2,
  hardScore: 1, // +100% score for the stage
  hardGold: 15, // bonus gold, plus the stage-clear gold and interest paid twice
};

const T = routeTuning;

export const ROUTE_NODES: Record<NodeKind, RouteNodeDef> = {
  start: { id: 'start', name: 'Start', short: 'Where the run began', lines: [], icon: 'route_start', glyph: '⚑', color: '#94b0c2', weight: 0 },
  elite: {
    id: 'elite',
    name: 'Elite Hunt',
    short: 'Twice the elites, better loot',
    lines: [`An elite every ${T.eliteOffset} s (more chests)`, `Enemies +${T.eliteHp * 100}% life`, 'Clear it: a bonus relic for everyone'],
    icon: 'route_elite',
    glyph: '☠',
    color: '#b13e53',
    weight: 3,
  },
  shop: {
    id: 'shop',
    name: 'Merchant Road',
    short: 'The secret merchant waits at the end',
    lines: ['The shop after this stage is the secret merchant', 'Rare Mods at 25% off and a free relic', `+${T.shopGold} gold at the stage clear`],
    icon: 'route_shop',
    glyph: '$',
    color: '#ffcd75',
    weight: 2,
  },
  treasure: {
    id: 'treasure',
    name: 'Treasure Trove',
    short: 'Chests galore, a quieter field',
    lines: [`${T.treasureChests} chests waiting at the start`, `${Math.round(-T.treasureCount * 100)}% fewer enemies`, `+${T.treasureGears} reroll gear`],
    icon: 'route_treasure',
    glyph: '▣',
    color: '#ef7d57',
    weight: 3,
  },
  event: {
    id: 'event',
    name: 'Mystery',
    short: 'Something strange on the road',
    lines: ['A random encounter with a choice', 'Your team decides before the stage'],
    icon: 'route_event',
    glyph: '?',
    color: '#41a6f6',
    weight: 3,
  },
  rest: {
    id: 'rest',
    name: 'Campfire',
    short: 'Catch your breath',
    lines: ['Full heal for everyone, downed heroes stand up', `+${T.restGears} free reroll gear`],
    icon: 'route_rest',
    glyph: '♨',
    color: '#38b764',
    weight: 2,
  },
  hard: {
    id: 'hard',
    name: 'Danger Zone',
    short: 'Harder stage, double rewards',
    lines: [`Enemies +${T.hardHp * 100}% life, +${T.hardDmg * 100}% damage, +${T.hardCount * 100}% count`, 'Double score all stage', `Stage-clear gold twice, +${T.hardGold} gold`],
    icon: 'route_hard',
    glyph: '!',
    color: '#5d275d',
    weight: 2,
  },
  // World-events lane: a stealth stage (src/game/systems/worldEvents.ts). Glyph fallback: no icon art yet.
  stealth: {
    id: 'stealth',
    name: 'Night Raid',
    short: 'Sneak through a dark stage',
    lines: ['Enemies only see you in light or hear you when you go loud', 'Grab 3 intel caches: gold and score, double if unseen', 'All 3: a treasure chest for everyone'],
    icon: 'route_stealth',
    glyph: '◐',
    color: '#3b5dc9',
    weight: 2,
  },
  // Modes lane (src/game/systems/modes.ts). Glyph fallbacks: no icon art yet.
  rhythm: {
    id: 'rhythm',
    name: 'Rhythm Stage',
    short: 'The whole field moves to the music',
    lines: ['Enemies step, lunge, shoot and slam on the beat', 'Kills on the beat: x3 score and extra combo', 'Watch the floor and the crosshair for the beat'],
    icon: 'route_rhythm',
    glyph: '♪',
    color: '#73eff7',
    weight: 2,
  },
  arcade: {
    id: 'arcade',
    name: 'Bonus Arcade',
    short: 'A 20-second game for gold first',
    lines: ['Shooting Gallery, Coin Dash or Whack-a-Bot', 'Everyone plays at once, everyone keeps their gold', 'Then a normal stage'],
    icon: 'route_arcade',
    glyph: '★',
    color: '#ffcd75',
    weight: 2.5,
  },
  // Hidden: drawn as ??? (the `secret` look below) until it is picked.
  pacifist: {
    id: 'pacifist',
    name: 'Pacifist Road',
    short: 'Survive without a single kill',
    lines: ['Weapons holstered: dash and parry', 'No boss: survive 2:00', 'No kills: a relic, gold and a legendary card'],
    icon: 'route_pacifist',
    glyph: '☮',
    color: '#a7f070',
    weight: 0.6,
  },
  secret: {
    id: 'secret',
    name: '???',
    short: 'A hidden road. Nobody knows where it goes',
    lines: ['It rarely shows up', 'Pick it to find out'],
    icon: 'route_secret',
    glyph: '??',
    color: '#566c86',
    weight: 0,
  },
};

/** Route kinds the map hides as ??? until they are on the road taken (src/game/systems/route.ts). */
export const HIDDEN_NODES: readonly NodeKind[] = ['pacifist'];

/** Kinds a map layer can roll. */
export const ROLLABLE: readonly NodeKind[] = (Object.keys(ROUTE_NODES) as NodeKind[]).filter((k) => ROUTE_NODES[k].weight > 0);

// ---------------------------------------------------------------- events

export type EventEffect =
  | 'bloodRelic' // lose 30% of current life, gain a relic
  | 'gamble' // pay 15 gold, 50%: win 40
  | 'idolCurse' // the team takes a random curse, everyone gets gold
  | 'springHeal' // full heal
  | 'springGear' // +2 gears
  | 'sparXp' // +1 team level
  | 'restHalf' // heal 50%
  | 'tithe' // pay 10 gold, +2 gears
  | 'nothing';

export interface RouteEventOption {
  label: string;
  desc: string;
  effect: EventEffect;
  color: string;
}

export interface RouteEventDef {
  id: string;
  name: string;
  text: string;
  icon: string;
  color: string;
  options: RouteEventOption[];
}

export const eventTuning = {
  bloodCost: 0.3, // share of current life
  gambleCost: 15,
  gambleWin: 40,
  idolGold: 25,
  springGears: 2,
  titheCost: 10,
  titheGears: 2,
};

const E = eventTuning;
const LEAVE: RouteEventOption = { label: 'WALK AWAY', desc: 'Nothing happens.', effect: 'nothing', color: '#94b0c2' };

export const ROUTE_EVENTS: RouteEventDef[] = [
  {
    id: 'altar',
    name: 'Blood Altar',
    text: 'A humming altar asks for a little of your life.',
    icon: 'route_event',
    color: '#b13e53',
    options: [{ label: 'OFFER BLOOD', desc: `Everyone loses ${E.bloodCost * 100}% of their life and gets a relic.`, effect: 'bloodRelic', color: '#b13e53' }, LEAVE],
  },
  {
    id: 'gambler',
    name: 'Wandering Gambler',
    text: 'A robot with dice for eyes wants a game.',
    icon: 'route_event',
    color: '#ffcd75',
    options: [{ label: 'ROLL THE DICE', desc: `Everyone with ${E.gambleCost} gold bets it: 50% to win ${E.gambleWin}.`, effect: 'gamble', color: '#ffcd75' }, LEAVE],
  },
  {
    id: 'idol',
    name: 'Cursed Idol',
    text: 'Gold spills from a grinning idol. It looks hungry.',
    icon: 'route_event',
    color: '#5d275d',
    options: [{ label: 'TAKE THE GOLD', desc: `Everyone gets ${E.idolGold} gold; the team takes a random curse for the run.`, effect: 'idolCurse', color: '#5d275d' }, LEAVE],
  },
  {
    id: 'spring',
    name: 'Healing Spring',
    text: 'Clear water bubbles up between the rocks.',
    icon: 'route_event',
    color: '#41a6f6',
    options: [
      { label: 'DRINK', desc: 'Everyone heals to full.', effect: 'springHeal', color: '#38b764' },
      { label: 'BOTTLE IT', desc: `Everyone gets ${E.springGears} reroll gears.`, effect: 'springGear', color: '#41a6f6' },
    ],
  },
  {
    id: 'dojo',
    name: 'Training Dummy',
    text: 'An old sparring robot creaks to life.',
    icon: 'route_event',
    color: '#ef7d57',
    options: [
      { label: 'SPAR', desc: 'The team gains a level right away.', effect: 'sparXp', color: '#ef7d57' },
      { label: 'SIT IT OUT', desc: 'Everyone heals 50% of their life.', effect: 'restHalf', color: '#38b764' },
    ],
  },
  {
    id: 'shrine',
    name: 'Gear Shrine',
    text: 'A shrine of cogs and coins. A slot says TITHE.',
    icon: 'route_event',
    color: '#94b0c2',
    options: [{ label: 'PAY THE TITHE', desc: `Everyone with ${E.titheCost} gold pays it for ${E.titheGears} reroll gears.`, effect: 'tithe', color: '#94b0c2' }, LEAVE],
  },
];

export const EVENT_BY_ID: Record<string, RouteEventDef> = Object.fromEntries(ROUTE_EVENTS.map((e) => [e.id, e]));
