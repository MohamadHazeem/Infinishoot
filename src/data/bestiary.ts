/** Enemy guide tips, by enemy id (shown once you've met the enemy). */
export const ENEMY_TIPS: Record<string, string> = {
  cake: "Dash through frosting waves. Sidestep candle fireballs; each broken layer speeds up the next attack.",
  kraken: "Leave the marked tentacle circles. Keep moving through ink, and dash against the whirlpool.",
  cupcake: "Two sweet layers, two angry phases. Dash through the frosting rings.",
  princeling: "Watch for tentacle rings and keep moving when the ink arrives.",
  gummy: "A slow brute that splits into three little gummies. Save some area damage for the pieces.",
  gumlet: "Fast little leftovers. Keep your distance and sweep them up together.",
  jellyfish: "Drifts sideways, then glows before sending a ring of zaps. Walk between the shots.",

  bastion: 'Its tall green gate shields a wider crowd than a Shield Bot. It turns slowly; circle behind the gate.',
  blinksniper: 'A cyan ring marks its next perch. It blinks, then aims a fresh red line. Strafe after it lands.',
  bombcourier: 'The orange courier carries twin bomb canisters. Its long fuse gives you time to dash clear or shoot the fragile pack.',
  burrower: 'Follow the moving dirt mound. Only explosions reach it underground. Step out of the red ring, then punish it above ground.',
  v_burrower: 'An armoured Dirt Digger. Explosions still reach it underground; wait outside the ring for its punish window.',
  v_mirror: 'An armoured Mirror Bot with the same readable scan. Break its copy attack to claim the bonus coins.',
  burrower_big: 'A big digger with a wider eruption. Its longer ring warning gives you time to move; explosives hit through the dirt.',
  mirror: 'Scans your left-click weapon, then copies a weaker purple version. Kill it while it copies for bonus coins.',
  mirror_prism: 'Copies for longer and keeps farther away. The scan line locks before its attack; move sideways.',
  swarmqueen: 'Screeches before a wall of swarmers splits the arena. Cut a gap, break the green eggs before they hatch, and chase her one retreat.',
  swarm_egg: 'A fragile cluster that hatches four swarmers after six seconds. Destroy it first!',
  swarm_wall: 'Holds the Queen’s wall for twelve seconds, then joins the chase. Shoot a gap through the line.',
  swarmer: 'Comes in clouds and rings. Keep moving and let area weapons do the work.',
  bopper: 'Flashes red, then lunges. Sidestep the lunge and it is open.',
  zippy: 'Fast and fragile. Pierce and chain weapons clean up packs.',
  shooter: 'Keeps its distance and fires a fan. Strafe across the fan, not away from it.',
  spinner: 'Spins out a double spiral. Walk with the gaps as they turn.',
  burster: 'Three quick fans in a row. Dash through after the third.',
  sniper: 'Its red line shows the shot. Step off the line before it locks.',
  charger: 'Lines up a charge you can see on the ground. Step aside, then punish.',
  chonk: 'Big, slow and tough. Kite it while you deal with the rest.',
  exploder: 'Its fuse ticks faster before it blows. Back off or kill it fast.',
  splitter: 'Splits into Jellets when it pops. Area damage handles the leftovers.',
  jellet: 'Small Jelly pieces. Weak on their own.',
  shielder: 'Its shield soaks hits from the front and covers whoever hides behind it. It turns slowly: get round the side.',
  medic: 'Hangs back and heals everything near it in a green pulse. Kill it first.',
  leaper: 'Crouches, then hops over cover onto the ring it marks. Step out of the ring.',
  mortar: 'Lobs shells from far away. Each one marks a red circle before it lands.',
  golden: 'Rare and shiny. Runs away and vanishes after a few seconds. Catch it for a jackpot!',
  spawner: 'A pylon that keeps hatching Swarmers. Take it out early.',
  king: 'Rings of bullets, summons and a jump slam you can see coming. Stay out of the red circle.',
  rex: 'Charges three times in a row, then spirals. Watch the charge lines.',
  queen: 'Flies at range, fires fans and marks ground strikes. Keep moving between the red zones.',
  glitch: 'Every attack lands on the beat. The red lines show where the laser grid steps next: stand between them. Bass drops send rings you dash through.',
  boxer: 'The crank winds before every move. Step off the red punch line, dodge the spring landing, and in the last phase watch the pinball path.',
  gale: 'Gusts shove you and bend every bullet, yours too. Cannon fans, walking barrages and, in the storm, lightning wherever you stand.',
  mc_static: "The DJ's opening act: pulse rings, a smaller laser grid and backup dancers.",
  jack_jr: 'A pocket Boxer Jack: one punch, one spring, a few toy soldiers.',
  squall: "Gale's first mate: cannon fans, gusts and a small boarding party.",
  dancer: 'Dances in on the beat. Weak, but it crowds the floor.',
  deckhand: 'Drops in on a rope from the airship. Lunges like a Bopper.',
  bee: 'Circles you, then dives along the orange line, and its friends follow in a column. Step off the line.',
  shark: 'Swims under the sand where nothing can hit it: watch for the fin. It bursts out of the red ring, then lies exposed.',
  roller: 'Rolls in wide arcs and grows as it rolls. It can barely turn, so sidestep; big ones shatter on walls and on you.',
  slug: 'Leaves burning puddles behind it and swells up to spill a big one. Kill it before it paints the floor.',
  soldier: 'Rewinds (its path lights up), then marches straight in rank with its squad. Winding down, it takes extra damage.',
  kite: 'Keeps its distance and blows a cone of wind that shoves you around. Get out of the pale cone or dash through.',
};

/** Fallback names for biomes this build might not define yet. */
const BIOME_NAMES: Record<string, string> = { candy: 'Candy Kingdom', ruins: 'Sunken Ruins', meadow: 'Bright Meadow', dunes: 'Sunset Dunes', peaks: 'Frosty Peaks', magma: 'Magma Isle', neon: 'Neon City', factory: 'Toy Factory', sky: 'Sky Fortress' };

/** Where a biome-native enemy lives, for the Enemy Guide ('' for everyone else). */
export function enemyHome(biomes: string[] | undefined, name: (id: string) => string | undefined = () => undefined): string {
  if (!biomes?.length) return '';
  return biomes.map((b) => (name(b) ?? BIOME_NAMES[b] ?? b).toUpperCase()).join(' / ') + ' ONLY';
}
