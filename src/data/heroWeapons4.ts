import type { WeaponDef, WeaponFeel } from './weapons';

/**
 * Hero-only click weapons (heroes4 lane): the Medic's mending beam and revive
 * drone, the Brawler's fists and grab. A hero with `clicks`
 * (src/data/heroes.ts) gets these instead of its loadout's clicks; they never
 * show on the LOADOUT screen (`heroOnly`). They grow through upgrade tracks
 * and evolve like every other loadout item. Merged into WEAPONS in weapons.ts.
 */
export const HERO_WEAPONS4: Record<string, WeaponDef> = {
  medbeam: {
    id: 'medbeam',
    rarity: 'common',
    slot: 'primary',
    heroOnly: 'medic',
    tags: ['projectile'],
    name: 'Mending Beam',
    icon: '+',
    color: '#a7f070',
    desc: 'LEFT CLICK: a beam that burns through enemies and heals every teammate it passes through. Every hit mends you a little.',
    starter: false,
    // dmg per tick, rate (ticks/s), range (m), width (half, m), pierce (enemies per tick), heal (ally life per tick), leech (share of damage back to you)
    levels: [{ text: 'A beam that hurts enemies and heals teammates.', p: { dmg: 16, rate: 10, range: 12, width: 0.55, pierce: 3, heal: 1.4, leech: 0.05 } }],
    tracks: [
      {
        id: 'power',
        name: 'Intensity',
        ranks: [
          { text: '+3 damage per tick.', p: { dmg: 3 } },
          { text: '+3 damage per tick.', p: { dmg: 3 } },
          { text: '+3 damage per tick, ticks faster.', p: { dmg: 3, rate: 1 } },
          { text: '+4 damage per tick.', p: { dmg: 4 } },
        ],
      },
      {
        id: 'lens',
        name: 'Wide Lens',
        ranks: [
          { text: 'Longer beam.', p: { range: 1.5 } },
          { text: 'Wider beam, burns through 1 more enemy.', p: { width: 0.15, pierce: 1 } },
          { text: 'Longer beam.', p: { range: 1.5 } },
          { text: 'Wider beam, burns through 2 more enemies.', p: { width: 0.2, pierce: 2 } },
        ],
      },
      {
        id: 'care',
        name: 'Bedside Manner',
        ranks: [
          { text: 'Heals teammates more.', p: { heal: 0.5 } },
          { text: 'Mends you more with every hit.', p: { leech: 0.02 } },
          { text: 'Heals teammates more.', p: { heal: 0.6 } },
          { text: 'Mends you much more with every hit.', p: { leech: 0.03 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'surge', name: 'Surge Beam', color: '#73eff7', text: 'A crackling beam: burns through 2 more enemies and every 6th tick chains lightning from the last one hit (Shock). x1.3 damage.', tags: ['shock'], p: { pierce: 2 }, mul: { dmg: 1.3 } },
      { id: 'lifeline', name: 'Lifeline', color: '#38b764', text: 'A broad, soothing beam: heals and mends twice as much and chills what it touches (Frost).', tags: ['frost'], p: { width: 0.3 }, mul: { heal: 2, leech: 2 } },
    ],
  },
  revdrone: {
    id: 'revdrone',
    rarity: 'common',
    slot: 'secondary',
    heroOnly: 'medic',
    tags: ['orbit'],
    name: 'Revive Drone',
    icon: '✚',
    color: '#f4f4f4',
    desc: 'RIGHT CLICK: send a drone to pick up a downed teammate from range. With nobody down, it shields you (or the teammate at your aim) from the next hits.',
    starter: false,
    // range (m), cd (s after a revive), shieldCd (s after a shield), reviveTime (s hovering), reviveHp (share of max life), hits (blocked by a shield), shieldTime (s), patch (life healed on arrival)
    levels: [{ text: 'Revives a downed teammate from range, or shields you.', p: { range: 16, cd: 20, shieldCd: 9, reviveTime: 1.2, reviveHp: 0.4, hits: 2, shieldTime: 6, patch: 10 } }],
    tracks: [
      {
        id: 'rapid',
        name: 'Rapid Response',
        ranks: [
          { text: 'Recharges sooner.', p: { cd: -2, shieldCd: -1 } },
          { text: 'Revives faster and from further away.', p: { reviveTime: -0.25, range: 3 } },
          { text: 'Recharges sooner.', p: { cd: -2, shieldCd: -1 } },
          { text: 'Revives much faster.', p: { reviveTime: -0.3 } },
        ],
      },
      {
        id: 'shield',
        name: 'Nanoshield',
        ranks: [
          { text: 'The shield blocks 1 more hit.', p: { hits: 1 } },
          { text: 'The shield lasts longer.', p: { shieldTime: 2 } },
          { text: 'The shield blocks 1 more hit.', p: { hits: 1 } },
          { text: 'The shield blocks 1 more hit and lasts longer.', p: { hits: 1, shieldTime: 2 } },
        ],
      },
      {
        id: 'patch',
        name: 'Patch Kit',
        ranks: [
          { text: 'The drone patches up who it reaches (+8 life).', p: { patch: 8 } },
          { text: 'Revived teammates get up with more life.', p: { reviveHp: 0.15 } },
          { text: 'The drone patches up more (+10 life).', p: { patch: 10 } },
          { text: 'Revived teammates get up with much more life.', p: { reviveHp: 0.2 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'guardian', name: 'Guardian Drone', color: '#ffcd75', text: 'Every blocked hit zaps the attacker and its neighbours for heavy damage (Shock).', tags: ['shock', 'chain'], p: { hits: 1, zap: 1 } },
      { id: 'phoenix', name: 'Phoenix Drone', color: '#ef7d57', text: 'Revives get up at full life, untouchable for 3 s, and the drone bursts with healing fire that heals the team and burns enemies around (Fire).', tags: ['fire'], p: { reviveHp: 1, burst: 1 }, mul: { patch: 2 } },
    ],
  },
  fists: {
    id: 'fists',
    rarity: 'common',
    slot: 'primary',
    heroOnly: 'brawler',
    tags: ['area'],
    name: 'Iron Fists',
    icon: '✊',
    color: '#ef7d57',
    desc: 'LEFT CLICK: a fast 3-punch combo in front of you; the third punch is a haymaker that sends enemies flying (into lava, thorns, walls and each other).',
    starter: false,
    // reach (m), arc (deg), rate (punches/s), finisher (3rd punch x), knock (m/s), launch (x knock on the haymaker), quake (haymaker shockwave radius, 0 = none)
    levels: [{ text: 'A 3-punch combo; the haymaker sends enemies flying.', p: { dmg: 30, reach: 2, arc: 95, rate: 4, finisher: 2.6, knock: 9, launch: 3, quake: 0 } }],
    tracks: [
      {
        id: 'knuckles',
        name: 'Iron Knuckles',
        ranks: [
          { text: '+4 damage.', p: { dmg: 4 } },
          { text: '+4 damage.', p: { dmg: 4 } },
          { text: '+5 damage, heavier haymaker.', p: { dmg: 5, finisher: 0.3 } },
          { text: '+6 damage.', p: { dmg: 6 } },
        ],
      },
      {
        id: 'speedbag',
        name: 'Speed Bag',
        ranks: [
          { text: 'Punches faster.', p: { rate: 0.4 } },
          { text: 'Punches faster, wider swings.', p: { rate: 0.4, arc: 15 } },
          { text: 'Punches faster, longer reach.', p: { rate: 0.4, reach: 0.25 } },
          { text: 'Punches much faster.', p: { rate: 0.6 } },
        ],
      },
      {
        id: 'haymaker',
        name: 'Haymaker',
        ranks: [
          { text: 'The haymaker launches enemies further.', p: { launch: 0.6 } },
          { text: 'The haymaker cracks the ground: a small shockwave.', p: { quake: 2.2 } },
          { text: 'The haymaker launches enemies further.', p: { launch: 0.6 } },
          { text: 'A bigger, harder shockwave.', p: { quake: 0.8, finisher: 0.3 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'thunder', name: 'Thunder Fists', color: '#73eff7', text: 'Every punch Shocks, and the haymaker calls down lightning that chains through the crowd (Shock).', tags: ['shock'], p: { thunder: 1 }, mul: { dmg: 1.1 } },
      { id: 'meteor', name: 'Meteor Fist', color: '#ffcd75', text: 'The haymaker becomes a ground slam: a burning blast that launches everything around (Explosive, Fire). x1.3 damage.', tags: ['explosive', 'fire'], p: { quake: 1.2, slam: 1 }, mul: { dmg: 1.3 } },
    ],
  },
  grab: {
    id: 'grab',
    rarity: 'common',
    slot: 'secondary',
    heroOnly: 'brawler',
    tags: ['area'],
    name: 'Grapple',
    icon: '✋',
    color: '#ffcd75',
    desc: 'RIGHT CLICK: grab the enemy in front of you, hold to carry it, release to throw it through the crowd. Bosses get a heavy uppercut instead.',
    starter: false,
    // dmg (thrown impact / uppercut base), speed (throw m/s), flight (s), splash (m around the thrown enemy), cd (s), hold (max s), upper (uppercut x dmg), reach (m)
    levels: [{ text: 'Grab, carry and throw enemies; uppercut bosses.', p: { dmg: 40, speed: 24, flight: 0.5, splash: 1.1, cd: 1.3, hold: 1.6, upper: 6.5, reach: 2.4 } }],
    tracks: [
      {
        id: 'impact',
        name: 'Body Slam',
        ranks: [
          { text: '+8 throw damage.', p: { dmg: 8 } },
          { text: '+8 throw damage, bigger splash.', p: { dmg: 8, splash: 0.3 } },
          { text: '+10 throw damage.', p: { dmg: 10 } },
          { text: '+12 throw damage, heavier uppercut.', p: { dmg: 12, upper: 1 } },
        ],
      },
      {
        id: 'arm',
        name: 'Strong Arm',
        ranks: [
          { text: 'Throws further.', p: { flight: 0.1 } },
          { text: 'Throws faster and grabs from further away.', p: { speed: 4, reach: 0.4 } },
          { text: 'Throws further.', p: { flight: 0.1 } },
          { text: 'Throws much faster.', p: { speed: 6 } },
        ],
      },
      {
        id: 'grip',
        name: 'Quick Grip',
        ranks: [
          { text: 'Grabs again sooner.', p: { cd: -0.15 } },
          { text: 'Grabs again sooner.', p: { cd: -0.15 } },
          { text: 'Grabs again sooner, carries longer.', p: { cd: -0.15, hold: 0.6 } },
          { text: 'Grabs again much sooner.', p: { cd: -0.2 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'suplex', name: 'Piledriver', color: '#b13e53', text: 'Thrown enemies explode on landing, launching everything around (Explosive). x1.25 damage.', tags: ['explosive'], p: { boom: 1, splash: 0.6 }, mul: { dmg: 1.25 } },
      { id: 'cyclone', name: 'Giant Swing', color: '#a7f070', text: 'Hold to spin the grabbed enemy round you like a club, smashing everything it touches, then let go to hurl it.', tags: ['orbit'], p: { swing: 1, hold: 1 } },
    ],
  },
};

export const HERO_WEAPON_FEEL4: Record<string, Partial<WeaponFeel>> = {
  medbeam: { kick: 0.3, recoil: 0.3, flash: 0.4, knock: 0.4, critFlash: 1.1, critPitch: 2 },
  revdrone: { kick: 1, recoil: 0.5, flash: 0.6, knock: 0.4, critFlash: 1.1, critPitch: 1.8 },
  fists: { kick: 2.2, recoil: 0, flash: 0.5, hitStop: 0.035, knock: 1.4, critFlash: 1.5, critPitch: 1.3, critStop: 0.05 },
  grab: { kick: 5, recoil: 0, flash: 0.7, hitStop: 0.06, knock: 1.5, critFlash: 1.7, critPitch: 1.1, critStop: 0.07 },
};
