import type { WeaponDef, WeaponFeel } from './weapons';

/**
 * Hero-only click weapons (heroes3 lane): the Ronin's sword combo and
 * dash-strike, the Tinker's turret beacon. A hero with `clicks`
 * (src/data/heroes.ts) gets these instead of its loadout's clicks; they never
 * show on the LOADOUT screen (`heroOnly`). They grow through upgrade tracks
 * and evolve like every other loadout item. Merged into WEAPONS in weapons.ts.
 */
export const HERO_WEAPONS: Record<string, WeaponDef> = {
  katana: {
    id: 'katana',
    rarity: 'common',
    slot: 'primary',
    heroOnly: 'ronin',
    tags: ['area'],
    name: 'Katana',
    icon: '/',
    color: '#f4f4f4',
    desc: 'LEFT CLICK: a 3-hit sword combo in front of you; the third hit is a heavy cleave. Swings cut enemy bullets.',
    starter: false,
    // reach (m), arc (deg), rate (swings/s), cleave (3rd hit x), wave (0 none, 1 third hit, 2 every hit), waveDmg (x dmg), waveSize, knock
    levels: [{ text: 'A 3-hit sword combo; the third hit cleaves.', p: { dmg: 24, reach: 2.6, arc: 130, rate: 2.9, cleave: 2.2, wave: 0, waveDmg: 0.55, waveSize: 1, knock: 7 } }],
    tracks: [
      {
        id: 'edge',
        name: 'Keen Edge',
        ranks: [
          { text: '+4 damage.', p: { dmg: 4 } },
          { text: '+4 damage, longer reach.', p: { dmg: 4, reach: 0.2 } },
          { text: '+5 damage.', p: { dmg: 5 } },
          { text: '+6 damage, heavier cleave.', p: { dmg: 6, cleave: 0.4 } },
        ],
      },
      {
        id: 'flurry',
        name: 'Flurry',
        ranks: [
          { text: 'Swings faster.', p: { rate: 0.35 } },
          { text: 'Swings faster, wider arcs.', p: { rate: 0.35, arc: 15 } },
          { text: 'Swings faster.', p: { rate: 0.4 } },
          { text: 'Swings much faster, wider arcs.', p: { rate: 0.5, arc: 15 } },
        ],
      },
      {
        id: 'wave',
        name: 'Sword Waves',
        ranks: [
          { text: 'The cleave throws a sword wave.', p: { wave: 1 } },
          { text: 'Stronger, bigger waves.', p: { waveDmg: 0.2, waveSize: 0.2 } },
          { text: 'Every swing throws a wave.', p: { wave: 1 } },
          { text: 'Stronger, bigger waves.', p: { waveDmg: 0.25, waveSize: 0.25 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'tempest', name: 'Tempest Blade', color: '#73eff7', text: 'Every swing throws a big, fast wave that flies twice as far (Projectile).', tags: ['projectile'], p: { wave: 2, waveSize: 0.4, waveDmg: 0.25 } },
      { id: 'crimson', name: 'Crimson Edge', color: '#ff5e3a', text: 'Longer, wider swings that set enemies on fire (Fire); the cleave goes all the way round. x1.25 damage.', tags: ['fire'], p: { reach: 0.8, arc: 40 }, mul: { dmg: 1.25 } },
    ],
  },
  iaido: {
    id: 'iaido',
    rarity: 'common',
    slot: 'secondary',
    heroOnly: 'ronin',
    tags: ['area'],
    name: 'Iaido Dash',
    icon: '»',
    color: '#ffcd75',
    desc: 'RIGHT CLICK: hold to focus, release to dash through enemies; everything you pass is cut again a beat later.',
    starter: false,
    // dmg per cut, dist (m at full focus), width (m), time (s to full focus), cd (s)
    levels: [{ text: 'Hold to focus, release to dash-strike through enemies.', p: { dmg: 30, dist: 8, width: 1.3, time: 0.6, cd: 1.6 } }],
    tracks: [
      {
        id: 'edge',
        name: 'Deep Cut',
        ranks: [
          { text: '+6 damage.', p: { dmg: 6 } },
          { text: '+6 damage.', p: { dmg: 6 } },
          { text: '+8 damage.', p: { dmg: 8 } },
          { text: '+10 damage.', p: { dmg: 10 } },
        ],
      },
      {
        id: 'reach',
        name: 'Long Step',
        ranks: [
          { text: 'Dashes 1 m further.', p: { dist: 1 } },
          { text: 'Dashes 1 m further, wider cut.', p: { dist: 1, width: 0.2 } },
          { text: 'Dashes 1 m further.', p: { dist: 1 } },
          { text: 'Dashes 1.5 m further, wider cut.', p: { dist: 1.5, width: 0.3 } },
        ],
      },
      {
        id: 'focus',
        name: 'Calm Mind',
        ranks: [
          { text: 'Focuses faster, recharges faster.', p: { time: -0.06, cd: -0.15 } },
          { text: 'Focuses faster, recharges faster.', p: { time: -0.06, cd: -0.15 } },
          { text: 'Focuses faster, recharges faster.', p: { time: -0.06, cd: -0.15 } },
          { text: 'Focuses much faster, recharges faster.', p: { time: -0.08, cd: -0.2 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'phantom', name: 'Phantom Step', color: '#c4b8ff', text: 'Your afterimage cuts the path again, and every kill gives back part of the recharge.', p: { phantom: 1 } },
      { id: 'raijin', name: 'Raijin Strike', color: '#fff35c', text: 'The delayed cut calls down lightning that chains from everything you cut (Shock).', tags: ['shock'], p: { raijin: 1 }, mul: { dmg: 1.15 } },
    ],
  },
  beacon: {
    id: 'beacon',
    rarity: 'common',
    slot: 'secondary',
    heroOnly: 'tinker',
    tags: ['chain'],
    name: 'Turret Beacon',
    icon: '⌂',
    color: '#a7f070',
    desc: 'RIGHT CLICK: drop a beacon at your aim. It zaps nearby enemies, repairs heroes standing in its field and speeds up your bots.',
    starter: false,
    // dmg per zap, rate (zaps/s), range (m), heal (life/s), radius (m), life (s), cd (s), volley (zaps per shot), boost (bot zap speed in field)
    levels: [{ text: 'Press to drop a turret beacon that zaps and repairs.', p: { dmg: 18, rate: 2.5, range: 7, heal: 4, radius: 3.5, life: 10, cd: 12, volley: 1, boost: 0.4 } }],
    tracks: [
      {
        id: 'turret',
        name: 'Turret',
        ranks: [
          { text: '+4 zap damage.', p: { dmg: 4 } },
          { text: 'Zaps faster.', p: { rate: 0.5 } },
          { text: '+5 zap damage, longer range.', p: { dmg: 5, range: 1 } },
          { text: 'Zaps much faster.', p: { rate: 0.8 } },
        ],
      },
      {
        id: 'repair',
        name: 'Repair Field',
        ranks: [
          { text: 'Repairs 1.5 more life/s.', p: { heal: 1.5 } },
          { text: 'Bigger field.', p: { radius: 0.6 } },
          { text: 'Repairs 2 more life/s.', p: { heal: 2 } },
          { text: 'Bigger field; bots in it zap even faster.', p: { radius: 0.8, boost: 0.3 } },
        ],
      },
      {
        id: 'battery',
        name: 'Battery',
        ranks: [
          { text: 'Lasts 2 s longer.', p: { life: 2 } },
          { text: 'Recharges 1.5 s sooner.', p: { cd: -1.5 } },
          { text: 'Lasts 2 s longer.', p: { life: 2 } },
          { text: 'Recharges 2 s sooner.', p: { cd: -2 } },
        ],
      },
    ],
    evoAt: 8,
    evos: [
      { id: 'fortress', name: 'Fortress Beacon', color: '#ffcd75', text: 'Twin coils: two zaps per shot, longer range, and they Shock (Shock).', tags: ['shock'], p: { volley: 1, range: 3 } },
      { id: 'medbay', name: 'Med Bay', color: '#38b764', text: 'A big field that repairs 2.5x as fast and makes your bots zap much faster.', p: { radius: 1.5, boost: 0.4 }, mul: { heal: 2.5 } },
    ],
  },
};

export const HERO_WEAPON_FEEL: Record<string, Partial<WeaponFeel>> = {
  katana: { kick: 2.5, recoil: 0, flash: 0.6, hitStop: 0.03, knock: 1.3, critFlash: 1.5, critPitch: 1.6, critStop: 0.045 },
  iaido: { kick: 7, recoil: 0, flash: 0.8, hitStop: 0.06, knock: 1.4, critFlash: 1.8, critPitch: 1.2, critStop: 0.07 },
  beacon: { kick: 2, recoil: 1, flash: 0.8, knock: 0.6, critFlash: 1.1, critPitch: 2.2 },
};
