/** Ordered, cumulative rules. Names stay canonical in saves, QA reports and the effects bus. */
export const ASCENSIONS = [
  {
    name: 'Loose Pockets',
    desc: 'Gears left over at the end of a stage cannot travel with you.',
    badge: 'Brass Cog',
  },
  {
    name: 'Relay Team',
    desc: 'Thirty seconds into each stage, two runners join the chase.',
    badge: 'Relay Ribbon',
  },
  { name: 'Last Catalogue', desc: 'Each shop allows one stock reroll.', badge: 'Paper Crown' },
  {
    name: 'Night Ferry',
    desc: 'On even stages the edges of the arena go dark.',
    badge: 'Moon Lantern',
  },
  {
    name: 'Double Stamp',
    desc: 'The first random elite each stage is Shielded. Elite modifier effects double.',
    badge: 'Twin Comets',
  },
  {
    name: 'Relief Convoy',
    desc: 'Map chests arrive every 60 seconds. The first elite you defeat each stage drops a heart.',
    badge: 'Cargo Kite',
  },
  {
    name: 'Curtain Call',
    desc: 'Bosses wind up for an extra ring of eight shots every eight seconds.',
    badge: 'Encore Bell',
  },
  { name: 'No Breather', desc: 'Stage clears no longer restore life.', badge: 'Glass Heart' },
  {
    name: 'Rear Guard',
    desc: 'The first defeated elite each stage calls in a shield bearer.',
    badge: 'Tin Shield',
  },
  {
    name: 'Last Quarter',
    desc: 'At quarter life, bosses wind up a bonus ring every five seconds. Outside duels, two runners join them.',
    badge: 'Quarter Moon',
  },
  {
    name: 'Customs Gate',
    desc: 'You can bring at most ten gold into the next stage.',
    badge: 'Copper Key',
  },
  { name: 'Closed Clinic', desc: 'Shopkeepers cannot heal you.', badge: 'Medic Star' },
  {
    name: 'Salvage Rights',
    desc: 'Map chests arrive every 90 seconds. Salvaging a stage pays for the next shop’s one reroll.',
    badge: 'Salvage Hook',
  },
  {
    name: 'Pinwheel',
    desc: 'Boss rings grow to sixteen shots. Every other volley rotates half a gap.',
    badge: 'Ruby Pinwheel',
  },
  { name: 'Empty Vault', desc: 'Gold kept between stages earns no interest.', badge: 'Vault Seal' },
  {
    name: 'Hot Scrap',
    desc: 'Defeated elites mark their last position. Leave the circle before it bursts.',
    badge: 'Ember Pin',
  },
  {
    name: 'Blockade',
    desc: 'The map chest clock stops while a stage boss is alive.',
    badge: 'Harbour Flag',
  },
  {
    name: 'Closing Bell',
    desc: 'Between stages the shop closes after twenty seconds of unpaused shopping.',
    badge: 'Clockwork Finch',
  },
  {
    name: 'Royal Escort',
    desc: 'Map chests arrive every 150 seconds. Each boss calls a medic at half life.',
    badge: 'Royal Crest',
  },
  {
    name: 'Summit Parade',
    desc: 'Bosses with a rematch fight in that form. Bonus rings have twenty-four shots.',
    badge: 'Summit Sun',
  },
] as const;
