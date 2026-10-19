import type { DamageEvent, ModApi, ModDef, ModState, ModEvent } from '../game/modTypes';
import type { Enemy } from '../game/enemies';
import { isRightClick } from './weapons';
import { bossLike } from '../game/bossRules';

/**
 * Mods: bought in the shop between stages, held in ordered slots. They key
 * off weapon tags, triggers, statuses and the economy, so the best Mod is
 * the one that fits what you already have.
 *
 * Damage pipeline per hit, left to right: amount = (amount + add) * mult.
 * A level-N Mod applies (amount + add * N) * (1 + (mult - 1) * N); its other
 * hooks run N times (see Synergy).
 */

/**
 * Lets at most one hit per `gap` seconds proc (fast multi-hit sources would
 * spam it otherwise), but every copy of the Mod (levels, Echo) procs on that hit.
 */
function limiter(gap: number): (ev: DamageEvent, api: ModApi, st: ModState) => boolean {
  let last: DamageEvent | null = null;
  return (ev, api, st) => {
    if (ev !== last && api.time < st.t) return false;
    last = ev;
    st.t = api.time + gap;
    return true;
  };
}
const thunderGate = limiter(0.05);

/** Short number for level descriptions: 1.5, 2, 0.12. */
const f = (x: number): string => String(+x.toFixed(2));
const cascadeGate = limiter(0.05);
let wildfireLast: Enemy | null = null;

/** Absolute timers: levels/Echo never shorten a window or multiply its duration. */
const windowOn =
  (event: ModEvent, seconds: number): ModDef['onEvent'] =>
  (kind, api, st) => {
    if (kind === event) st.t = api.time + seconds;
  };
const windowRead: ModDef['readout'] = (api, st) =>
  st.t > api.time ? `${(st.t - api.time).toFixed(1)}s` : 'READY';

export const mods2Tuning = { allyRadius: 10, reloadCap: 0.3, burnCritCap: 0.3, wallRadius: 2 };

/** Non-economy choices, including six co-op-only Mods. */
export const MODS2: ModDef[] = [
  {
    id: 'riposte_cell',
    name: 'Riposte Cell',
    icon: '↗',
    color: '#73eff7',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `Parry: hits gain +${3 * n} damage for 2s. Put before multipliers.`,
    onEvent: windowOn('parry', 2),
    readout: windowRead,
    preview: { label: 'AFTER PARRY', event: 'parry' },
    dmg: (_ev, api, st) => (api.time < st.t ? { add: 3 } : undefined),
  },
  {
    id: 'slipstream',
    name: 'Slipstream',
    icon: '»',
    color: '#b13e53',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `Perfect dash: Orbit and Trail hits deal +${20 * n}% damage for 3s.`,
    synergy: ['orbit', 'trail'],
    onEvent: windowOn('perfectDash', 3),
    readout: windowRead,
    preview: { label: 'DASH: ORBIT / TRAIL', event: 'perfectDash', tags: ['trail'] },
    dmg: (ev, api, st) =>
      api.time < st.t && (ev.tags.includes('trail') || ev.tags.includes('orbit'))
        ? { mult: 1.2 }
        : undefined,
  },
  {
    id: 'encore',
    name: 'Encore',
    icon: '★',
    color: '#ffcd75',
    rarity: 'rare',
    price: 8,
    maxLevel: 2,
    desc: (n) => `Use your ultimate: +${15 * n}% damage for 6s.`,
    onEvent: windowOn('ultimate', 6),
    readout: windowRead,
    preview: { label: 'AFTER ULTIMATE', event: 'ultimate' },
    dmg: (_ev, api, st) => (api.time < st.t ? { mult: 1.15 } : undefined),
  },
  {
    id: 'cash_capacitor',
    name: 'Cash Capacitor',
    icon: 'Σ',
    color: '#a7f070',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `Cash in a combo: hits gain +${3 * n} damage for 6s. No gold bonus.`,
    onEvent: windowOn('cashIn', 6),
    readout: windowRead,
    preview: { label: 'AFTER CASH-IN', event: 'cashIn' },
    dmg: (_ev, api, st) => (api.time < st.t ? { add: 3 } : undefined),
  },
  {
    id: 'second_hand',
    name: 'Second Hand',
    icon: '◀',
    color: '#b13e53',
    rarity: 'rare',
    price: 7,
    maxLevel: 2,
    desc: (n) => `After a rewind finishes: +${20 * n}% damage for 8s.`,
    onEvent: windowOn('rewind', 8),
    readout: windowRead,
    preview: { label: 'AFTER REWIND', event: 'rewind' },
    dmg: (_ev, api, st) => (api.time < st.t ? { mult: 1.2 } : undefined),
  },
  {
    id: 'ejection_seat',
    name: 'Ejection Seat',
    icon: '↑',
    color: '#ef7d57',
    rarity: 'rare',
    price: 7,
    maxLevel: 2,
    desc: (n) => `Survive a mech exit: +${25 * n}% damage for 8s, including the eject blast.`,
    onEvent: windowOn('mechExit', 8),
    readout: windowRead,
    preview: { label: 'AFTER MECH EXIT', event: 'mechExit' },
    dmg: (_ev, api, st) => (api.time < st.t ? { mult: 1.25 } : undefined),
  },
  {
    id: 'jack_in_box',
    name: 'Jack in the Box',
    icon: '✷',
    color: '#ffcd75',
    rarity: 'common',
    price: 4,
    maxLevel: 2,
    desc: (n) => `Open a chest: a 4m Shock nova deals ${35 * n} damage.`,
    synergy: ['area', 'shock'],
    onEvent: (kind, api, _st, n) => {
      if (kind === 'chest')
        api.blast(api.player.x, api.player.z, 4, 35 * n, '#ffcd75', 'jack_in_box', [
          'area',
          'shock',
        ]);
    },
  },
  {
    id: 'hearth',
    name: 'Hearth',
    icon: '♨',
    color: '#ef7d57',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `Inside your Blaze Boots fire: Fire and Trail hits deal +${20 * n}% damage.`,
    synergy: ['fire', 'trail'],
    preview: { label: 'OWN FIRE: FIRE / TRAIL', ownFire: true, tags: ['trail', 'fire'] },
    dmg: (ev, api) =>
      api.ownFire && (ev.tags.includes('fire') || ev.tags.includes('trail'))
        ? { mult: 1.2 }
        : undefined,
  },
  {
    id: 'wallflower',
    name: 'Wallflower',
    icon: '▥',
    color: '#38b764',
    rarity: 'common',
    price: 4,
    maxLevel: 2,
    desc: (n) => `Within 2m of cover: Orbit and Area hits deal +${20 * n}% damage.`,
    synergy: ['orbit', 'area'],
    preview: { label: 'COVER: ORBIT / AREA', nearWall: true, tags: ['orbit', 'area'] },
    dmg: (ev, api) =>
      api.nearWall && (ev.tags.includes('orbit') || ev.tags.includes('area'))
        ? { mult: 1.2 }
        : undefined,
  },
  {
    id: 'cold_front',
    name: 'Cold Front',
    icon: '❄',
    color: '#73eff7',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `At 8m or farther: Frost and Chain hits deal +${25 * n}% damage.`,
    synergy: ['frost', 'chain'],
    preview: { label: '8M+: FROST / CHAIN', dist: 10, tags: ['frost', 'chain'] },
    dmg: (ev) =>
      ev.dist >= 8 && (ev.tags.includes('frost') || ev.tags.includes('chain'))
        ? { mult: 1.25 }
        : undefined,
  },
  {
    id: 'blood_primer',
    name: 'Blood Primer',
    icon: '+',
    color: '#b13e53',
    rarity: 'uncommon',
    price: 5,
    maxLevel: 2,
    cursed: true,
    desc: (n) => `Every hit +${3 * n} damage. Max life x${f(0.85 ** n)}. Put before multipliers.`,
    stat: (s) => {
      s.maxHp *= 0.85;
    },
    dmg: () => ({ add: 3 }),
  },
  {
    id: 'last_word',
    name: 'Last Word',
    icon: '!',
    color: '#ef7d57',
    rarity: 'rare',
    price: 7,
    maxLevel: 2,
    cursed: true,
    desc: (n) =>
      `Each hit loses ${2 * n} damage, then x${f(1 + 0.25 * n)}. Strong hits win; order matters.`,
    dmg: () => ({ add: -2, mult: 1.25 }),
  },
  {
    id: 'signal_flare',
    name: 'Signal Flare',
    icon: '♦',
    color: '#ef7d57',
    rarity: 'rare',
    price: 8,
    maxLevel: 2,
    coop: true,
    desc: (n) =>
      `Your Burns give allies +${15 * n}% crit chance against that enemy (team cap +30%).`,
    synergy: ['fire'],
    flags: { allyBurnCrit: 0.15 },
  },
  {
    id: 'pit_crew',
    name: 'Pit Crew',
    icon: '⚒',
    color: '#41a6f6',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    coop: true,
    desc: (n) =>
      `Other allies within 10m reload all weapons ${12 * n}% faster (team cap +30% speed).`,
    flags: { allyReload: 0.12 },
  },
  {
    id: 'counterchorus',
    name: 'Counterchorus',
    icon: '✦',
    color: '#73eff7',
    rarity: 'rare',
    price: 8,
    maxLevel: 2,
    coop: true,
    desc: (n) =>
      `An ally parries within 10m: you fire a 3m Shock nova for ${20 * n} damage. 1s cooldown.`,
    synergy: ['area', 'shock'],
    onEvent: (kind, api, st, n) => {
      if (kind !== 'allyParry' || api.time < st.n) return;
      st.n = api.time + 1;
      api.blast(api.player.x, api.player.z, 3, 20 * n, '#73eff7', 'counterchorus', [
        'area',
        'shock',
      ]);
    },
  },
  {
    id: 'blood_bond',
    name: 'Blood Bond',
    icon: '♥',
    color: '#b13e53',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    coop: true,
    desc: (n) =>
      `Share ${10 * n}% of life actually recovered by your kill-heal with each ally within 10m (cap 20%).`,
    flags: { allySiphon: 0.1 },
  },
  {
    id: 'wing_guard',
    name: 'Wing Guard',
    icon: '◇',
    color: '#a7f070',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    coop: true,
    desc: (n) =>
      `An ally perfect-dashes within 10m: gain ${(0.15 * n).toFixed(2)}s invulnerability (cap 0.3s). 2s cooldown.`,
    onEvent: (kind, api, st, n) => {
      if (kind !== 'allyDash' || api.time < st.n) return;
      st.n = api.time + 2;
      api.player.invuln = Math.max(api.player.invuln, Math.min(0.3, 0.15 * n));
    },
  },
  {
    id: 'standing_ovation',
    name: 'Standing Ovation',
    icon: '♛',
    color: '#ffcd75',
    rarity: 'rare',
    price: 8,
    maxLevel: 2,
    coop: true,
    desc: (n) => `An ally uses an ultimate within 10m: your hits deal +${10 * n}% damage for 6s.`,
    onEvent: windowOn('allyUltimate', 6),
    readout: windowRead,
    preview: { label: 'AFTER ALLY ULT', event: 'allyUltimate' },
    dmg: (_ev, api, st) => (api.time < st.t ? { mult: 1.1 } : undefined),
  },
];

export const MODS: ModDef[] = [
  ...MODS2,
  // ---------------------------------------------------------------- tag synergies
  {
    id: 'demolition',
    name: 'Demolition Crew',
    icon: '✷',
    color: '#ff7a2f',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `Explosive hits x(1 + ${f(0.2 * n)} per Explosive weapon). Blasts +${12 * n}% size per Explosive weapon.`,
    synergy: ['explosive'],
    flags: { explosiveArea: 0.12 },
    dmg: (ev, api) => (ev.tags.includes('explosive') ? { mult: 1 + 0.2 * api.tagCount('explosive') } : undefined),
  },
  {
    id: 'hive_mind',
    name: 'Hive Mind',
    icon: '✦',
    color: '#4fc3ff',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 3,
    desc: (n) => `Orbit hits x${1 + n}.`,
    synergy: ['orbit'],
    dmg: (ev) => (ev.tags.includes('orbit') ? { mult: 2 } : undefined),
  },
  {
    id: 'static_cling',
    name: 'Static Cling',
    icon: 'ϟ',
    color: '#ffe14d',
    rarity: 'common',
    price: 5,
    maxLevel: 3,
    desc: (n) => `Shocked enemies take x${f(1.2 + 0.3 * n)} damage instead of x1.2. Shock lasts ${n}s longer.`,
    synergy: ['shock'],
    flags: { shockMult: 0.3, shockTime: 1 },
  },
  {
    id: 'pyromaniac',
    name: 'Pyromaniac',
    icon: '♨',
    color: '#ff5e3a',
    rarity: 'common',
    price: 5,
    maxLevel: 1,
    desc: 'Projectile hits set enemies on fire.',
    synergy: ['projectile', 'fire'],
    onHit: (ev, api) => {
      if (ev.tags.includes('projectile')) api.ignite(ev.e, 4 + api.level);
    },
  },
  {
    id: 'kindling',
    name: 'Kindling',
    icon: '☄',
    color: '#ff9f3d',
    rarity: 'common',
    price: 4,
    maxLevel: 3,
    desc: (n) => `Burning enemies take x${f(1 + 0.4 * n)} damage.`,
    synergy: ['fire'],
    dmg: (ev) => (ev.e.burnT > 0 ? { mult: 1.4 } : undefined),
  },
  {
    id: 'cold_snap',
    name: 'Cold Snap',
    icon: '❄',
    color: '#9fe8ff',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `Hits on Frozen enemies x${1 + n}.`,
    synergy: ['frost'],
    dmg: (ev) => (ev.e.frozen > 0 ? { mult: 2 } : undefined),
  },
  {
    id: 'lightning_rod',
    name: 'Lightning Rod',
    icon: '↯',
    color: '#fff35c',
    rarity: 'uncommon',
    price: 7,
    maxLevel: 3,
    desc: (n) => `Chain weapons jump +${2 * n} more times. Chain hits x${f(1 + 0.3 * n)}.`,
    synergy: ['chain', 'shock'],
    flags: { chainBonus: 2 },
    dmg: (ev) => (ev.tags.includes('chain') ? { mult: 1.3 } : undefined),
  },
  {
    id: 'conductor',
    name: 'Conductor',
    icon: '☇',
    color: '#ffb627',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 1,
    desc: 'Fire hits have a 25% chance to Shock and Shock hits a 25% chance to Burn. (Burn + Shock = Overload blast.)',
    synergy: ['fire', 'shock'],
    onHit: (ev, api) => {
      if (!api.chance(0.25)) return;
      if (ev.tags.includes('fire')) api.shock(ev.e);
      else if (ev.tags.includes('shock')) api.ignite(ev.e, 5);
    },
  },
  {
    id: 'shatterpoint',
    name: 'Shatterpoint',
    icon: '✦',
    color: '#c8f4ff',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 3,
    desc: (n) => `Frozen enemies shatter into shards for x${1 + 2 * n} damage when killed.`,
    synergy: ['frost'],
    flags: { shatterMult: 2 },
  },
  {
    id: 'overloader',
    name: 'Overloader',
    icon: '☢',
    color: '#ffe14d',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `Overload blasts deal x${1 + 2 * n} damage and are bigger.`,
    synergy: ['fire', 'shock'],
    flags: { overloadMult: 2 },
  },
  {
    id: 'specialist',
    name: 'Specialist',
    icon: '◎',
    color: '#ff3df0',
    rarity: 'rare',
    price: 9,
    maxLevel: 2,
    desc: (n) => `Weapons with your most common tag deal x${f(1 + 0.75 * n)}.`,
    dmg: (ev, api) => {
      const t = api.topTag();
      return t && ev.tags.includes(t) ? { mult: 1.75 } : undefined;
    },
    readout: (api) => (api.topTag() ? api.topTag()!.toUpperCase() : '-'),
  },
  {
    id: 'generalist',
    name: 'Generalist',
    icon: '✱',
    color: '#7dffb0',
    rarity: 'common',
    price: 4,
    maxLevel: 3,
    desc: (n) => `Every hit x(1 + ${f(0.06 * n)} for each different tag you own).`,
    dmg: (_ev, api) => ({ mult: 1 + 0.06 * api.distinctTags() }),
    readout: (api, _st, lv) => `x${(1 + 0.06 * api.distinctTags() * lv).toFixed(2)}`,
  },
  {
    id: 'wildfire',
    name: 'Wildfire',
    icon: '☀',
    color: '#ff7a2f',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 3,
    desc: (n) => `Burning enemies burst into flames when they die, setting the enemies around them on fire (Fire)${n > 1 ? `. Burst damage x${n}` : ''}.`,
    synergy: ['fire'],
    onKill: (e, source, api, st) => {
      if (e.burnT <= 0 && source !== 'burn') return;
      // Fire builds kill fast: at most ~7 kills burst a second, but every level bursts on that kill.
      if (st.t > 0 && e !== wildfireLast) return;
      wildfireLast = e;
      st.t = 0.15;
      api.blast(e.x, e.z, 2.2, 12 + 2 * api.level, '#ff7a2f', 'wildfire', ['fire']);
    },
    tick: (dt, _api, st) => {
      st.t -= dt;
    },
  },
  {
    id: 'flash_freeze',
    name: 'Flash Freeze',
    icon: '❆',
    color: '#41a6f6',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 1,
    desc: 'Explosive hits Freeze enemies for 0.4s (not bosses), setting up Cold Snap and Shatter.',
    synergy: ['explosive', 'frost'],
    onHit: (ev) => {
      // Survivors only, like Cryo Rounds: freezing the killing blow would make every explosive kill a Shatter.
      if (ev.tags.includes('explosive') && !bossLike(ev.e) && ev.e.hp > 0) ev.e.frozen = Math.max(ev.e.frozen, 0.4);
    },
  },
  {
    id: 'trailblazer',
    name: 'Trailblazer',
    icon: '≋',
    color: '#ef7d57',
    rarity: 'uncommon',
    price: 5,
    maxLevel: 3,
    desc: (n) => `Trail hits x${f(1 + 0.6 * n)}.`,
    synergy: ['trail'],
    dmg: (ev) => (ev.tags.includes('trail') ? { mult: 1.6 } : undefined),
  },
  {
    id: 'wide_load',
    name: 'Wide Load',
    icon: '◯',
    color: '#a7f070',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 3,
    desc: (n) => `Area hits x${f(1 + 0.4 * n)}.`,
    synergy: ['area'],
    dmg: (ev) => (ev.tags.includes('area') ? { mult: 1.4 } : undefined),
  },

  // ---------------------------------------------------------------- triggers
  {
    id: 'hair_trigger',
    name: 'Hair Trigger',
    icon: '☢',
    color: '#ffd23f',
    rarity: 'common',
    price: 5,
    maxLevel: 3,
    desc: (n) => `Every ${8 - 2 * (n - 1)}th left-click shot is a MEGA shot: x4 damage, huge, pierces 5.`,
    synergy: ['projectile'],
    flags: { busterMegaEvery: 8 },
  },
  {
    id: 'afterburner',
    name: 'Afterburner',
    icon: '☄',
    color: '#ff7a2f',
    rarity: 'common',
    price: 5,
    maxLevel: 3,
    desc: (n) => `Dashing leaves a fiery explosion behind you${n > 1 ? ` (x${n} damage)` : ''}.`,
    synergy: ['explosive', 'fire'],
    onDash: (api) => api.blast(api.player.x, api.player.z, 2.8, 30 + 4 * api.level, '#ff7a2f', 'afterburner', ['explosive', 'fire']),
  },
  {
    id: 'adrenaline',
    name: 'Adrenaline',
    icon: '!',
    color: '#ff3d5a',
    rarity: 'common',
    price: 4,
    maxLevel: 1,
    desc: 'After you get hit, weapons recharge twice as fast for 4s.',
    onHurt: (_api, st) => {
      st.t = 4;
    },
    tick: (dt, _api, st) => {
      st.t = Math.max(0, st.t - dt);
    },
    live: (s, _api, st) => {
      if (st.t > 0) s.cooldownMul *= 0.5;
    },
    readout: (_api, st) => (st.t > 0 ? 'ACTIVE' : ''),
  },
  {
    id: 'bloodlust',
    name: 'Bloodlust',
    icon: '☠',
    color: '#b5384a',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `Each kill: +${2 * n * n}% damage (max x${1 + 0.5 * n}). Stacks drain when you stop killing.`,
    onKill: (_e, _s, _api, st) => {
      st.n = Math.min(25, st.n + 1);
      st.t = 1.2;
    },
    tick: (dt, _api, st) => {
      st.t -= dt;
      if (st.t <= 0) st.n = Math.max(0, st.n - 25 * dt);
    },
    dmg: (_ev, _api, st) => ({ mult: 1 + 0.02 * Math.floor(st.n) }),
    readout: (_api, st, lv) => `x${(1 + 0.02 * Math.floor(st.n) * lv).toFixed(2)}`,
  },
  {
    id: 'sniper',
    name: 'Sniper Scope',
    icon: '⌖',
    color: '#ffd23f',
    rarity: 'common',
    price: 5,
    maxLevel: 3,
    desc: (n) => `Projectile hits on enemies more than 8m away x${1 + n}.`,
    synergy: ['projectile'],
    dmg: (ev) => (ev.tags.includes('projectile') && ev.dist > 8 ? { mult: 2 } : undefined),
  },
  {
    id: 'brawler',
    name: 'Brawler',
    icon: '✊',
    color: '#ff9f3d',
    rarity: 'common',
    price: 5,
    maxLevel: 3,
    desc: (n) => `Hits on enemies within 3.5m x${f(1 + 0.6 * n)}.`,
    synergy: ['orbit', 'area'],
    dmg: (ev) => (ev.dist < 3.5 ? { mult: 1.6 } : undefined),
  },
  {
    id: 'turret_mode',
    name: 'Turret Mode',
    icon: '■',
    color: '#8a90c8',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 3,
    desc: (n) => `While standing still, and for 1s after you start moving, everything deals x${f(1 + 0.8 * n)}.`,
    // st.t = when you last stood still (api.time, so the grace is the same at every level).
    tick: (_dt, api, st) => {
      if (!api.moving) st.t = api.time;
    },
    dmg: (_ev, api, st) => (api.time - st.t <= 1 ? { mult: 1.8 } : undefined),
    readout: (api, st) => (api.time - st.t <= 1 ? 'ACTIVE' : ''),
  },
  {
    id: 'runners_high',
    name: "Runner's High",
    icon: '→',
    color: '#3de0c8',
    rarity: 'common',
    price: 4,
    maxLevel: 2,
    desc: (n) => `While moving, weapons recharge ${Math.round((1 - 0.85 ** n) * 100)}% faster.`,
    synergy: ['trail'],
    live: (s, api) => {
      if (api.moving) s.cooldownMul *= 0.85;
    },
  },
  {
    id: 'chain_reaction',
    name: 'Chain Reaction',
    icon: '✵',
    color: '#ff7a2f',
    rarity: 'uncommon',
    price: 7,
    maxLevel: 2,
    desc: (n) => `Kills have a 15% chance to explode (Explosive), which can kill more${n > 1 ? `. Rolled ${n} times per kill` : ''}.`,
    synergy: ['explosive'],
    onKill: (e, _s, api) => {
      if (api.chance(0.15)) api.blast(e.x, e.z, 2.4, 20 + 3 * api.level, '#ffb627', 'chain_reaction', ['explosive']);
    },
  },
  {
    id: 'crit_cascade',
    name: 'Crit Cascade',
    icon: '★',
    color: '#fff35c',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 3,
    desc: (n) => `Critical hits arc lightning to 2 nearby enemies${n > 1 ? `, ${n} arcs per crit` : ''} (Chain, Shock).`,
    synergy: ['chain', 'shock'],
    onCrit: (ev, api, st) => {
      if (cascadeGate(ev, api, st)) api.zap(ev.e, 2, 12 + 2 * api.level);
    },
  },
  {
    id: 'overkill',
    name: 'Overkill',
    icon: '↯',
    color: '#ffe14d',
    rarity: 'rare',
    price: 8,
    maxLevel: 2,
    desc: (n) => `Big kills carry on: ${50 * n}% of the damage past a kill arcs to the nearest enemy (Chain, Shock).`,
    synergy: ['chain', 'shock'],
    onKill: (e, source, api, st) => {
      if (source === 'nuke') return;
      const extra = Math.min(-e.hp, e.maxHp) * 0.5;
      // st.t blocks re-entry, so the arc's own kills don't arc again.
      if (extra < 10 || st.t) return;
      st.t = 1;
      api.zap(e, 1, extra);
      st.t = 0;
    },
  },
  {
    id: 'phase_step',
    name: 'Phase Step',
    icon: '≈',
    color: '#c4b8ff',
    rarity: 'common',
    price: 4,
    maxLevel: 1,
    desc: 'Every dash keeps you invulnerable for 0.4s (about 0.25s past the dash).',
    onDash: (api) => {
      const p = api.player;
      // Dash 0.16s + ~0.25s. 0.7s matched the late dash cooldown: never hittable.
      p.invuln = Math.max(p.invuln, 0.4);
    },
  },

  // ---------------------------------------------------------------- scaling
  {
    id: 'hoarder',
    name: 'Hoarder',
    icon: '◆',
    color: '#4fc3ff',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 1,
    desc: 'Every hit +1 per 40 XP collected since you bought this. Resets when you get hit.',
    onGem: (v, _api, st) => {
      st.n += v;
    },
    onHurt: (_api, st) => {
      st.n = 0;
    },
    dmg: (_ev, _api, st) => ({ add: Math.floor(st.n / 40) }),
    readout: (_api, st, lv) => `+${Math.floor(st.n / 40) * lv}`,
  },
  {
    id: 'momentum',
    name: 'Momentum',
    icon: '↑',
    color: '#7dffb0',
    rarity: 'rare',
    price: 8,
    maxLevel: 3,
    desc: (n) => `x${f(0.05 * n)} more damage for each level gained after buying this (max x${1 + n}, 20 levels).`,
    // Once per level however many copies run (st.t = last level counted).
    onLevelUp: (api, st) => {
      if (st.t === api.level) return;
      st.t = api.level;
      // Capped: uncapped it kept multiplying all run and made late stages trivial (user).
      st.n = Math.min(20, st.n + 1);
    },
    dmg: (_ev, _api, st) => ({ mult: 1 + 0.05 * st.n }),
    readout: (_api, st, lv) => `x${(1 + 0.05 * st.n * lv).toFixed(2)}`,
  },
  {
    id: 'collector',
    name: 'Collector',
    icon: '●',
    color: '#ffd23f',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `x${f(0.02 * n)} more damage per gold you are holding (max x${1 + n} at 50 gold).`,
    dmg: (_ev, api) => ({ mult: 1 + 0.02 * Math.min(50, api.gold) }),
    readout: (api, _st, lv) => `x${(1 + 0.02 * Math.min(50, api.gold) * lv).toFixed(2)}`,
  },
  {
    id: 'echo',
    name: 'Echo',
    icon: '⇉',
    color: '#ff3df0',
    rarity: 'legendary',
    price: 10,
    maxLevel: 1,
    desc: 'Copies the Mod in the slot to its right.',
    echo: true,
  },

  // ---------------------------------------------------------------- charge shot (hold right mouse / X)
  {
    id: 'quick_draw',
    name: 'Quick Draw',
    icon: '⚡',
    color: '#7df9ff',
    rarity: 'common',
    price: 4,
    maxLevel: 3,
    desc: (n) => `Right click charges ${50 * n}% faster (right-click weapons reload ${50 * n}% faster).`,
    synergy: ['projectile'],
    flags: { chargeSpeed: 0.5 },
  },
  {
    id: 'patience',
    name: 'Patience',
    icon: '⌛',
    color: '#3dffb0',
    rarity: 'common',
    price: 5,
    maxLevel: 3,
    desc: (n) => `Right-click attacks deal x${f(1 + 0.8 * n)}.`,
    synergy: ['projectile'],
    dmg: (ev) => (isRightClick(ev.source) ? { mult: 1.8 } : undefined),
  },
  {
    id: 'thunder_shot',
    name: 'Thunder Shot',
    icon: '↯',
    color: '#ffe14d',
    rarity: 'uncommon',
    price: 6,
    maxLevel: 2,
    desc: (n) => `Right-click hits Shock and arc lightning to 3 nearby enemies${n > 1 ? `, ${n} arcs per hit` : ''}.`,
    synergy: ['projectile', 'shock', 'chain'],
    onHit: (ev, api, st) => {
      if (!isRightClick(ev.source) || !thunderGate(ev, api, st)) return;
      api.shock(ev.e);
      api.zap(ev.e, 3, 15 + 2 * api.level);
    },
  },
  {
    id: 'mega_buster',
    name: 'Mega Buster',
    icon: '⁂',
    color: '#3dffb0',
    rarity: 'rare',
    price: 9,
    maxLevel: 2,
    desc: (n) => `Full-charge shots fire ${1 + 2 * n} at once. Grenades, vortexes and Orbital Strikes come in ${1 + 2 * n}s; the shield gets ${120 * n}° wider.`,
    synergy: ['projectile'],
    flags: { chargeSplit: 2 },
  },
  {
    id: 'overcharge',
    name: 'Overcharge',
    icon: '✺',
    color: '#ff3df0',
    rarity: 'rare',
    price: 8,
    maxLevel: 1,
    desc: 'Keep holding past full for a second charge level: x2 damage, huge pierce and a bigger blast. Grenades, vortexes and Orbital Strikes get bigger; the shield reflects bullets.',
    synergy: ['projectile', 'explosive'],
    flags: { overcharge: true },
  },

  // ---------------------------------------------------------------- legendary: build-defining, with a catch
  {
    id: 'phoenix',
    name: 'Phoenix Plume',
    icon: '♆',
    color: '#ef7d57',
    rarity: 'legendary',
    price: 12,
    maxLevel: 1,
    desc: 'Once per stage, lethal damage instead brings you back at full life in a huge fire nova (Fire, Explosive).',
    synergy: ['fire', 'explosive'],
    // Runs before the game checks for death, so the hero never goes down.
    onHurt: (api, st) => {
      const p = api.player;
      if (!p.dead || st.n) return;
      st.n = 1;
      p.dead = false;
      p.hp = p.maxHp;
      p.invuln = 2;
      p.rig.root.visible = true;
      api.blast(p.x, p.z, 7, 120 + 8 * api.level, '#ef7d57', 'phoenix', ['fire', 'explosive']);
    },
    onStageClear: (_api, st) => {
      st.n = 0;
    },
    readout: (_api, st) => (st.n ? 'SPENT' : 'READY'),
  },
  {
    id: 'storm_crown',
    name: 'Storm Crown',
    icon: '♛',
    color: '#73eff7',
    rarity: 'legendary',
    price: 12,
    maxLevel: 3,
    desc: (n) => `Every ${Math.round(20 / n)}th kill calls a storm: lightning chains through 10 enemies (+3 per Chain weapon) and a thunderclap Shocks everything near the kill.`,
    synergy: ['chain', 'shock'],
    onKill: (e, _s, api, st) => {
      if (++st.n < 20) return;
      st.n = 0;
      const dmg = 40 + 3 * api.level;
      api.zap(e, 10 + 3 * api.tagCount('chain'), dmg);
      api.blast(e.x, e.z, 3.5, dmg, '#73eff7', 'storm_crown', ['shock', 'chain']);
    },
    readout: (_api, st) => `${st.n}/20`,
  },
  {
    id: 'supernova',
    name: 'Supernova',
    icon: '✹',
    color: '#f4f4f4',
    rarity: 'legendary',
    price: 13,
    maxLevel: 1,
    desc: '+10% crit chance. Critical hits explode in a fiery blast (Explosive, Fire). Non-crit hits deal x0.8.',
    synergy: ['explosive', 'fire'],
    stat: (s) => {
      s.critChance += 0.1;
    },
    dmg: (ev) => (ev.crit || ev.source === 'supernova' ? undefined : { mult: 0.8 }),
    onCrit: (ev, api, st) => {
      // Fast multi-hit weapons crit many times a second: at most ~8 blasts/s.
      // Its own blasts never chain into more blasts.
      if (ev.source === 'supernova' || st.t > 0) return;
      st.t = 0.12;
      api.blast(ev.e.x, ev.e.z, 2.4, 25 + 3 * api.level, '#ffcd75', 'supernova', ['explosive', 'fire']);
    },
    tick: (dt, _api, st) => {
      st.t -= dt;
    },
  },
  {
    id: 'midas',
    name: 'Midas Touch',
    icon: '♔',
    color: '#ffcd75',
    rarity: 'legendary',
    price: 11,
    maxLevel: 1,
    desc: 'Every hit x(1 + 0.04 per gold you hold, max x3 at 50 gold). Kills have a 1% chance to pay 1 gold. Shop prices +50%.',
    flags: { shopDiscount: -0.5 },
    dmg: (_ev, api) => ({ mult: 1 + 0.04 * Math.min(50, api.gold) }),
    onKill: (_e, _s, api) => {
      if (api.chance(0.01)) api.addGold(1);
    },
    readout: (api) => `x${(1 + 0.04 * Math.min(50, api.gold)).toFixed(2)}`,
  },

  // ---------------------------------------------------------------- cursed: big upside, real cost
  {
    id: 'glass_cannon',
    name: 'Glass Cannon',
    icon: '◇',
    color: '#c8f4ff',
    rarity: 'uncommon',
    price: 5,
    maxLevel: 1,
    cursed: true,
    desc: 'x2 damage. Max life x0.4.',
    stat: (s) => {
      s.damageMul *= 2;
      s.maxHp *= 0.4;
    },
  },
  {
    id: 'pacifist',
    name: 'Pacifist Core',
    icon: '☮',
    color: '#9b6bff',
    rarity: 'uncommon',
    price: 5,
    maxLevel: 1,
    cursed: true,
    desc: 'Your arm cannon stops firing (left and right click). Every other weapon x1.6 and recharges 20% faster.',
    flags: { busterDisabled: true },
    stat: (s) => {
      s.cooldownMul *= 0.8;
    },
    dmg: (ev) => (ev.source !== 'buster' ? { mult: 1.6 } : undefined),
  },
  {
    id: 'overclock',
    name: 'Overclocked Heart',
    icon: '♥',
    color: '#ff3d5a',
    rarity: 'legendary',
    price: 7,
    maxLevel: 1,
    cursed: true,
    desc: 'Weapons recharge 40% faster. You lose 1.5 life per second.',
    stat: (s) => {
      s.cooldownMul *= 0.6;
    },
    tick: (dt, api) => {
      const p = api.player;
      if (!p.dead && p.hp > 1) p.hp = Math.max(1, p.hp - 1.5 * dt);
    },
  },
  {
    id: 'gremlin',
    name: 'Greedy Gremlin',
    icon: '$',
    color: '#ffb627',
    rarity: 'common',
    price: 3,
    maxLevel: 1,
    cursed: true,
    desc: '+75% gold from gold pickups. Enemies have +30% life.',
    flags: { goldMul: 0.75, enemyHp: 0.3 },
  },
];

export const MOD_BY_ID: Record<string, ModDef> = Object.fromEntries(MODS.map((m) => [m.id, m]));

export const MOD_RARITY_WEIGHT = { common: 50, uncommon: 30, rare: 16, legendary: 5 };
