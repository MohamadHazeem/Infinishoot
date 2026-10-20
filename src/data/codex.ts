import { SECRET_BOSSES, SECRET_LORE } from './secrets';
import { ENEMIES } from './enemies';
import { ENEMY_TIPS } from './bestiary';
import { BIOMES } from './biomes';
import { HEROES } from './heroes';
import type { Loadout } from './loadout';
import { heroes4Lore } from '../i18n/heroes4';
import { BIOME_LORE2, ENEMY_LORE2, ENEMY_TIPS2, EXTRA_CODEX, VETERAN_LORE } from './codex2';

const ENEMY_LORE: Record<string, string> = {
  architect: 'The first machine drew a perfect world and forgot to leave room for choice. Its three orbiting cores hold the instructions that made Omega.',
  cake: "The royal bakery never stopped baking. Its proudest cake crowned itself and declared every day a birthday.",
  kraken: "The keeper of the flooded archive guards a crown made from the last lighthouse bell.",
  cupcake: "The royal taster decided that a smaller crown leaves more room for frosting.",
  princeling: "Eight eager arms practise ruling one very small tide pool.",
  gummy: "A kitchen helper filled with jelly instead of batteries. It always brings three friends.",
  gumlet: "A brave crumb with a very sticky sense of purpose.",
  jellyfish: "Old archive lamps learned to swim when the sea came through the windows.",

  golden_king: 'SECRET: Three missing Goldbugs woke their king. His crown remembers every stolen coin. Watch the golden landing rings.',
  shadow_hero: 'SECRET: A flawless night leaves a reflection behind. It cycles through your weapon patterns; its borrowed power has safe limits.',
  pumpking: 'Every October, the harvest clock crowns its largest pumpkin. Dodge the seed fans, leave the marked vines, and keep outside the carving knives. At two-thirds and one-third life the royal recipe gets faster.',
  pumpkin: 'A festival decoration with seeds of rebellion. Its last surprise is a burst of seeds.',
  ghost: 'A shy spirit that slips through walls and fades on a four-second cycle.',
  bat: 'A candy courier travelling with its entire extended family.',
  witch: 'The cauldron is bubbling. Leave the marked circles before the brew lands.',
  bastion: 'A portable shelter that still takes workplace safety very seriously.',
  blinksniper: 'The relay technician learned to travel by signal. Its rifle is considerably less subtle.',
  bombcourier: 'Express delivery: two canisters, one destination, no return address.',
  swarmer: 'Once tiny garden helpers, these machines now mistake every boot for a weed.',
  bopper: "The islands' oldest delivery bot still insists that every parcel arrive personally.",
  zippy: 'A courier with no address left to deliver to. Its route ends wherever you are standing.',
  shooter: 'A retired fireworks launcher, still rehearsing for a festival that never came.',
  spinner: 'Its compass broke years ago. It has been checking every direction ever since.',
  burster: "Three short knocks were once the repair crew's secret greeting. This bot remembers.",
  sniper: 'The watchtower sentry can count the scratches on your helmet from across the island.',
  charger: 'A quarry hauler with excellent acceleration and absolutely no brakes.',
  chonk: 'Under that heavy shell is a remarkably small battery and an enormous sense of duty.',
  exploder: 'The warning sticker fell off. The warning noise, fortunately, still works.',
  splitter: 'The recycling plant called this self-repair. The field crew calls it extra paperwork.',
  jellet: 'A little piece of a much bigger problem, determined to make its own way.',
  spawner: 'The factory foreman never received the shutdown order. Production continues.',
  shielder: 'Built to shelter workers from falling rock; it still puts everyone else first.',
  medic:
    'Its medical license expired with the old network. Its bedside manner remains enthusiastic.',
  leaper:
    'The island drains needed a maintenance robot that could jump. Nobody specified a landing spot.',
  mortar: 'An irrigation system that found the wrong kind of canister in the supply shed.',
  golden: "Every loose Bolt on the islands eventually ends up in this collector's pockets.",
  king: 'The first Bopper promoted itself when the human supervisors left. Its crown is an antenna.',
  rex: 'The excavation project stopped at bedrock. Rex took that personally.',
  queen: 'From her aerial command post, she conducts the factory swarm like a brass band.',
  omega:
    'The central relay has waited through a thousand quiet sunsets. Now every island is calling at once.',
  glitch: 'The city\'s last radio tower kept spinning records after the crowds went home. It still takes requests, but only for bass drops.',
  boxer: 'The toy factory\'s mascot was built to surprise children. Nobody expected it to keep the gloves on.',
  gale: 'The sky fortress admiral never got the order to dock. Every passing cloud is now a rival fleet.',
  mc_static: 'An opening act convinced the headliner will never show up.',
  jack_jr: 'A prototype from the bargain bin, wound a little too tight.',
  squall: 'Promoted to commodore after the rest of the crew blew overboard.',
  dancer: 'Hired for one night only. The night has not ended.',
  deckhand: 'Swabs the deck between boarding actions. Mostly boarding actions.',
  prince: 'A junior supervisor practising a royal entrance before the real promotion.',
  rexling: 'A prototype digger that already dreams of moving mountains.',
  princess: 'Her first command assignment is this island. She intends to make a good impression.',
  hive: 'A portable workshop. Unfortunately, its only repair plan is to build more trouble.',
  reaper: 'The network sends this collector when an overdue work order becomes a legend.',
};
const HERO_LORE: Record<string, string> = {
  rookie:
    'The newest member of the recovery crew brought a borrowed helmet and a map drawn in crayon. Both have proved surprisingly reliable.',
  bulwark:
    "A rescue worker who once held a collapsing bridge together until the last courier crossed. The heavy armour is mostly for everyone else's peace of mind.",
  dash: 'The old island racing champion traded prize money for a pair of experimental boots. The scorch marks are now a registered signature.',
  ace: 'A radio operator who can hear the rhythm hiding in machine chatter. Every shot is timed to the next beat.',
  duelist:
    'A fencing champion from the floating arenas who never learned to dodge. Why would you, when every blow can be turned aside?',
  furnace:
    'A boiler-room giant who keeps the island lighthouses warm. Standing still is not laziness; it is stoking.',
  twin:
    'Nobody is sure which one is the original. They split the snacks evenly and argue about it anyway.',
  ronin:
    'A wandering sword-saint who left the old dojo when its training bots went rogue. The arm blade was forged from the dojo bell, and it still rings on every cut.',
  tinker:
    'The islands\' youngest mechanic builds friends out of whatever the robots leave behind. Every bot gets a name, a number and a tiny hand-painted smile.',
  ...heroes4Lore, // Medic and Brawler (heroes4 lane)
};

/** Lore + field tip (tips2 lane fills the gaps; veterans reuse their base enemy's text). */
function enemyText(id: string): string {
  const base = id.startsWith('v_') ? id.slice(2) : id;
  const lore = ENEMY_LORE[id] ?? ENEMY_LORE2[id] ?? (base !== id ? `${VETERAN_LORE} ${ENEMY_LORE[base] ?? ENEMY_LORE2[base] ?? ''}`.trim() : 'A veteran of the old island network, patched up and sent back out on patrol.');
  return `${lore} ${ENEMY_TIPS[id] ?? ENEMY_TIPS2[id] ?? ENEMY_TIPS[base] ?? ENEMY_TIPS2[base] ?? 'Keep moving and watch its wind-up.'}`;
}

export const CODEX = [
  ...SECRET_LORE,
  ...Object.values(ENEMIES)
    .filter((e) => !e.hidden || e.id === 'architect')
    .map((e) => ({
      id: `enemy:${e.id}`,
      kind: SECRET_BOSSES.some(id => id === e.id) ? 'SECRET' : e.boss || e.miniboss ? 'BOSS' : 'ENEMY',
      name: e.name,
      text: enemyText(e.id),
    })),
  ...BIOMES.map((b) => ({
    id: `biome:${b.id}`,
    kind: 'BIOME',
    name: b.name,
    text:
      (
        {
          candy: "Sugar towers shelter the old royal bakery. Chocolate streams wind between the lollipop orchards.",
          ruins: "Below the tide, the archive still glows. Currents carry its forgotten messages through gardens of coral.",
          meadow:
            'The repair crews left flowers growing between the circuit boards. Every adventure begins somewhere bright.',
          dunes:
            'Buried relay towers still hum beneath the sunset sand. The wind remembers their song.',
          peaks:
            'The mountain antennae catch signals from stars nobody has named. Ice preserves the old machines.',
          magma:
            'Deep under the islands, the planet keeps its own furnace running. The machines here learned to love the heat.',
        } as Record<string, string>
      )[b.id] ?? BIOME_LORE2[b.id] ?? 'Another island on the old relay route, waiting to be rediscovered.',
  })),
  ...HEROES.map((h) => ({
    id: `hero:${h.id}`,
    kind: 'HERO',
    name: h.name,
    text: `${HERO_LORE[h.id] ?? ''} ${h.desc}`.trim(),
  })),
  ...EXTRA_CODEX,
];
export const META_REWARDS = [
  { id: 'architect_skin', name: 'Blueprint Armour', kind: 'skin', cost: 0, color: '#73eff7', condition: 'Defeat the Architect.' },
  { id: 'secret_skin', name: 'Pixel Relay Armour', kind: 'skin', cost: 0, color: '#a7f070', condition: 'Solve a secret room or discover the old directional code.' },
  { id: 'raid_skin', name: 'Hydra Armour', kind: 'skin', cost: 0, color: '#73eff7', condition: 'Complete the Hydra Engine raid.' },
  { id: 'raid_ember', name: 'Hydra Ember Armour', kind: 'skin', cost: 0, color: '#ef7d57', condition: 'Complete the Hydra Engine raid.' },
  {
    id: 'heat_skin',
    name: 'Relay Gold Armour',
    kind: 'skin',
    cost: 80,
    color: '#ffcd75',
    condition: 'Clear a loop with 4+ heat.',
  },
  {
    id: 'weekly_skin',
    name: 'Signal Runner Armour',
    kind: 'skin',
    cost: 80,
    color: '#73eff7',
    condition: 'Score 5,000 in a weekly run.',
  },
  {
    id: 'mint',
    name: 'Mint Monitor',
    kind: 'theme',
    cost: 30,
    color: '#a7f070',
    condition: 'Earn any achievement.',
  },
  {
    id: 'sunset',
    name: 'Sunset Monitor',
    kind: 'theme',
    cost: 60,
    color: '#ef7d57',
    condition: 'Clear a loop with 4+ heat.',
  },
  {
    id: 'weekly',
    name: 'Weekly Monitor',
    kind: 'theme',
    cost: 60,
    color: '#73eff7',
    condition: 'Score 5,000 in a weekly run.',
  },
  {
    id: 'heat_kit',
    name: 'Heat Runner Kit',
    kind: 'loadout',
    cost: 0,
    color: '#ffcd75',
    condition: 'Clear a loop with 4+ heat.',
  },
  {
    id: 'weekly_kit',
    name: 'Weekly Explorer Kit',
    kind: 'loadout',
    cost: 0,
    color: '#73eff7',
    condition: 'Score 5,000 in a weekly run.',
  },
] as const;
export const META_KITS: Record<string, Loadout> = {
  heat_kit: { primary: 'scatter', secondary: 'grenade', special: 'storm' },
  weekly_kit: { primary: 'laser', secondary: 'well', special: 'meteor' },
};
export interface MetaProgress {
  achievements: readonly string[];
  bestHeat: Record<string, number>;
  weekly: { score: number }[];
}
export function rewardAvailable(id: string, p: MetaProgress): boolean {
  if (id === 'architect_skin') return p.achievements.includes('true_ending');
  if (id === 'secret_skin') return p.achievements.includes('secret_room') || p.achievements.includes('secret_code');
  if (id === 'raid_skin' || id === 'raid_ember') return p.achievements.includes('hydra_engine');
  if (id === 'mint') return p.achievements.length > 0;
  if (id === 'sunset' || id === 'heat_skin' || id === 'heat_kit')
    return Object.values(p.bestHeat).some((n) => n >= 4);
  if (id === 'weekly' || id === 'weekly_skin' || id === 'weekly_kit')
    return p.weekly.some((r) => r.score >= 5000);
  return false;
}

/** These colour sets travel through the existing skin id in co-op start messages. */
export const META_SKINS = [
  { id: 'architect_skin', name: 'Blueprint Armour', armor: '#41a6f6', accent: '#73eff7', suit: '#29366f', hair: '#f4f4f4', gem: '#ffcd75', iris: '#a7f070' },
  { id: 'secret_skin', name: 'Pixel Relay', armor: '#a7f070', accent: '#ffcd75', suit: '#29366f', hair: '#f4f4f4', gem: '#73eff7', iris: '#5d275d' },
  { id: 'raid_skin', name: 'Hydra Armour', armor: '#3b5dc9', accent: '#73eff7', suit: '#29366f', hair: '#f4f4f4', gem: '#ffcd75', iris: '#a7f070' },
  { id: 'raid_ember', name: 'Hydra Ember Armour', armor: '#b13e53', accent: '#ef7d57', suit: '#1a1c2c', hair: '#ffcd75', gem: '#a7f070', iris: '#73eff7' },
  {
    id: 'heat_skin',
    name: 'Relay Gold',
    armor: '#ffcd75',
    accent: '#ef7d57',
    suit: '#5d275d',
    hair: '#f4f4f4',
    gem: '#a7f070',
    iris: '#b13e53',
  },
  {
    id: 'weekly_skin',
    name: 'Signal Runner',
    armor: '#73eff7',
    accent: '#a7f070',
    suit: '#29366f',
    hair: '#f4f4f4',
    gem: '#ef7d57',
    iris: '#3b5dc9',
  },
];
export const metaSkin = (id: string) => META_SKINS.find((s) => s.id === id);
