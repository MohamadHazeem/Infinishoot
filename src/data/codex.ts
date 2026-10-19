import { ENEMIES } from './enemies';
import { ENEMY_TIPS } from './bestiary';
import { BIOMES } from './biomes';
import { HEROES } from './heroes';
import type { Loadout } from './loadout';

const ENEMY_LORE: Record<string, string> = {
  pumpking: 'Every October, the harvest clock crowns its largest pumpkin. Dodge the seed fans, leave the marked vines, and keep outside the carving knives. At two-thirds and one-third life the royal recipe gets faster.',
  pumpkin: 'A festival decoration with seeds of rebellion. Its last surprise is a burst of seeds.',
  ghost: 'A shy spirit that slips through walls and fades on a four-second cycle.',
  bat: 'A candy courier travelling with its entire extended family.',
  witch: 'The cauldron is bubbling. Leave the marked circles before the brew lands.',
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
};

export const CODEX = [
  ...Object.values(ENEMIES)
    .filter((e) => !e.hidden)
    .map((e) => ({
      id: `enemy:${e.id}`,
      kind: e.boss || e.miniboss ? 'BOSS' : 'ENEMY',
      name: e.name,
      text: `${ENEMY_LORE[e.id] ?? 'A veteran of the old island network, patched up and sent back out on patrol.'} ${ENEMY_TIPS[e.id] ?? 'Keep moving and watch its wind-up.'}`,
    })),
  ...BIOMES.map((b) => ({
    id: `biome:${b.id}`,
    kind: 'BIOME',
    name: b.name,
    text:
      (
        {
          meadow:
            'The repair crews left flowers growing between the circuit boards. Every adventure begins somewhere bright.',
          dunes:
            'Buried relay towers still hum beneath the sunset sand. The wind remembers their song.',
          peaks:
            'The mountain antennae catch signals from stars nobody has named. Ice preserves the old machines.',
          magma:
            'Deep under the islands, the planet keeps its own furnace running. The machines here learned to love the heat.',
        } as Record<string, string>
      )[b.id] ?? 'Another island on the old relay route, waiting to be rediscovered.',
  })),
  ...HEROES.map((h) => ({
    id: `hero:${h.id}`,
    kind: 'HERO',
    name: h.name,
    text: `${HERO_LORE[h.id]} ${h.desc}`,
  })),
];
export const META_REWARDS = [
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
  if (id === 'mint') return p.achievements.length > 0;
  if (id === 'sunset' || id === 'heat_skin' || id === 'heat_kit')
    return Object.values(p.bestHeat).some((n) => n >= 4);
  if (id === 'weekly' || id === 'weekly_skin' || id === 'weekly_kit')
    return p.weekly.some((r) => r.score >= 5000);
  return false;
}

/** These colour sets travel through the existing skin id in co-op start messages. */
export const META_SKINS = [
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
