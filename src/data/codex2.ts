import { MODES } from './modes';

/**
 * tips2 lane: Codex & Lore entries for content that arrived without one, and
 * the Arsenal's POWER-UPS tab (mech suit, crate super weapons, candy).
 * Plain data, merged into src/data/codex.ts and src/data/arsenal.ts. All copy
 * is canonical English; src/i18n/tips2.ts holds the Arabic.
 */

/** Lore for enemies and bosses that had none (codex.ts falls back to these). */
export const ENEMY_LORE2: Record<string, string> = {
  burrower: 'A tunnelling bot from the old pipe crews. It still thinks the surface is just a very large ceiling.',
  burrower_big: 'The foreman of the digging crew. Every tunnel it leaves is wide enough for a parade.',
  mirror: 'A training dummy that learned too well. It studies your favourite weapon and borrows it, badly.',
  mirror_prism: 'A polished Mirror Bot with a longer memory and a stronger sense of personal space.',
  swarmqueen: 'The hive network crowned its loudest signal. Her screech is a marching order for every swarmer in range.',
  swarm_egg: 'A warm cluster of spare parts, minutes away from becoming four more problems.',
  swarm_wall: 'A swarmer on guard duty. It holds the line until the Queen says otherwise.',
  bee: 'A pollination drone that took its flight drills far too seriously.',
  shark: 'A sand dredger that learned to swim. Only its fin gives it away.',
  roller: 'A snow-clearing bot that never learned to stop rolling, or to stop growing.',
  slug: 'A magma sampler that leaks more than it collects. Its trail stays hot for a long time.',
  soldier: 'A clockwork guard from the toy line. It marches in perfect step and never asks why.',
  kite: 'A weather kite that slipped its string and kept the wind for itself.',
  king_ex: 'King Bopper came back with a bigger crown and a grudge. The bounce is louder this time.',
  rex_inferno: 'Rex found the island furnace and decided to keep it. Everything it touches catches fire.',
  queen_night: 'The Hive Queen returns after dark with a quieter, meaner swarm.',
};

/** Field tips for enemies and bosses that had none (bestiary.ts covers the rest). */
export const ENEMY_TIPS2: Record<string, string> = {
  pumpkin: 'It bursts into seeds when it dies: step back after the kill.',
  ghost: 'Drifts through walls and fades in and out, but your shots always hit it.',
  bat: 'Bats come in swarms of eight. Area weapons clear them fast.',
  witch: 'A witch elite lobs brews onto marked circles. Leave the circle before it lands.',
  pumpking: 'Dodge the seed fans, step out of the marked vines, and stay between the carving blades in the last phase.',
  omega: 'Mixes every boss attack, turns to bullet hell below 60% life and gets relentless below 25%. Keep moving and save your special.',
  prince: 'A smaller King Bopper: ring bursts and jump slams. Beat it for its own chest.',
  rexling: 'A smaller Rex: short charges and a spiral. Sidestep the charge line.',
  princess: 'A smaller Hive Queen: aimed fans and strike zones. Watch the red discs.',
  hive: "The Queen's hives hatch swarmers and heal her while they stand. Break them first.",
  reaper: 'Faster than you and through walls. Kite it in wide circles, or burst it down with a strong build for a chest.',
  golden_king: 'Golden landing rings show where he slams. Keep out of the gold and punish the recovery.',
  shadow_hero: 'It copies your weapon patterns with safe limits. Dash through its volleys and hit it while it changes weapons.',
  king_ex: 'King Bopper with extra shockwaves. Dash through the ring walls.',
  rex_inferno: 'Rex with fire breath and burning charges. Keep cover between you, and keep it moving.',
  queen_night: 'The Queen with a tougher swarm. Break the hives fast and cut gaps in the swarm walls.',
};

/** Prefix for veteran entries (their base enemy's lore and tip follow). */
export const VETERAN_LORE = 'Veteran armour: x2.6 life and x1.6 damage, from stage 3.';

/** Lore for the biomes that had none. */
export const BIOME_LORE2: Record<string, string> = {
  factory: 'The toy factory still runs its night shift. Watch the crusher presses, and mind the wind-up soldiers.',
  neon: 'A city that never switched its signs off. The music never stopped either.',
  sky: 'A fortress tied to the clouds with old cables. The wind up here pushes bullets as well as heroes.',
};

/** Bosses that live outside the normal enemy list (hidden parts), and the game modes. */
export const EXTRA_CODEX: { id: string; kind: string; name: string; text: string }[] = [
  { id: 'boss:titan', kind: 'BOSS', name: 'Titan Goliath', text: 'A mountain that woke up and stood. Its body is the arena: shoot its glowing weak points one by one; each broken one opens the next.' },
  { id: 'boss:hydra', kind: 'BOSS', name: 'The Hydra Engine', text: 'A three-headed drydock engine. Bait the Furnace head, hold the plate against the Aegis head, parry the Interceptor head, burn every stump, then feed the cannons.' },
  ...MODES.map((m) => ({ id: `mode:${m.id}`, kind: 'MODE', name: m.name, text: m.desc })),
  { id: 'mode:coop', kind: 'MODE', name: 'Online Co-op', text: 'Up to 4 heroes share XP and the stage, each with their own build and shop. Revive downed friends by standing next to them.' },
  { id: 'mode:pvp', kind: 'MODE', name: 'PvP', text: 'Everyone grows a build on the same stage, then the heroes duel. Free-for-all or two teams, one round or best of 3.' },
  { id: 'mode:race', kind: 'MODE', name: 'Race', text: 'Everyone plays the same stage in their own world. First to beat the stage boss wins.' },
  { id: 'mode:versus', kind: 'MODE', name: 'Versus Swarm', text: 'One player is the Overlord and sends the swarm; everyone else survives it.' },
];

/** Codex ids for this run's mode (marked when a fight runs). */
export function modeCodexId(runMode: string, opts: { pvp: boolean; race: boolean; versus: boolean; coop: boolean }): string {
  if (opts.pvp) return 'mode:pvp';
  if (opts.race) return 'mode:race';
  if (opts.versus) return 'mode:versus';
  if (opts.coop && runMode === 'standard') return 'mode:coop';
  return `mode:${runMode}`;
}

/** Arsenal POWER-UPS tab: things you pick up in the field rather than own. Keys `x:<id>`. */
export const POWERUPS: { id: string; name: string; glyph: string; color: string; kind: string; desc: string }[] = [
  { id: 'mech', name: 'Mech Suit', glyph: '▣', color: '#ffcd75', kind: 'RARE DROP', desc: 'Pilot a giant mech for 30 seconds: arm cannons on your clicks, missile salvos, stomps and heavy armour. Ejecting sets off a big blast.' },
  { id: 'minigun', name: 'Minigun', glyph: '≡', color: '#ffd23f', kind: 'SUPPLY CRATE', desc: 'Takes over your left click: spins up to 30 shots a second. 420 rounds or 15 seconds.' },
  { id: 'railgun', name: 'Railgun', glyph: '─', color: '#7df9ff', kind: 'SUPPLY CRATE', desc: 'Takes over your left click: a line of lightning that pierces everything. 14 shots or 15 seconds.' },
  { id: 'flamer', name: 'Flamethrower', glyph: '♨', color: '#ff7a2f', kind: 'SUPPLY CRATE', desc: 'Takes over your left click: a cone of fire that burns what it touches. 12 seconds of fuel.' },
  { id: 'candy', name: 'Halloween Candy', glyph: '●', color: '#ef7d57', kind: 'SEASONAL PICKUP', desc: 'Drops during the Halloween season. Every teammate gets it; spend it at the TRICK-OR-TREAT booth on costumes.' },
];
