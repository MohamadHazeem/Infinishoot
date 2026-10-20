/**
 * Item sets: weapons, loadout items, passives, relics and Mods belong to themed SETS.
 * Holding 2 / 4 / 6 pieces of one set turns on escalating bonuses (src/game/systems/sets.ts).
 * Membership lives here, keyed by id, so the item files don't change. Names and bonus text
 * are i18n keys (src/i18n/sets.ts): `sets.<id>` and `sets.<id>.<tier>`.
 *
 * Piece ids: auto and loadout weapon ids, `sp_<special id>` for the Q/E special, passive ids,
 * relic ids (`r_*`) and Mod ids. A fused weapon counts as both of its parts.
 */
export type SetId = 'inferno' | 'storm' | 'glacier' | 'bulwark' | 'speedster' | 'boomsmith' | 'machinist' | 'duelist';

export interface SetDef {
  id: SetId;
  /** Sweetie 16 colour for chips, banners and rings. */
  color: string;
  /** Pixel glyph for the chip. */
  glyph: string;
}

/** Order is the display order (and the index into per-hero count arrays). */
export const SETS: readonly SetDef[] = [
  { id: 'inferno', color: '#ef7d57', glyph: '♨' },
  { id: 'storm', color: '#ffcd75', glyph: 'ϟ' },
  { id: 'glacier', color: '#73eff7', glyph: '❄' },
  { id: 'bulwark', color: '#94b0c2', glyph: '◈' },
  { id: 'speedster', color: '#a7f070', glyph: '»' },
  { id: 'boomsmith', color: '#b13e53', glyph: '✹' },
  { id: 'machinist', color: '#41a6f6', glyph: '⚙' },
  { id: 'duelist', color: '#f4f4f4', glyph: '⚔' },
];
export const SET_COUNT = SETS.length;
export const SET_INDEX: Record<SetId, number> = Object.fromEntries(SETS.map((s, i) => [s.id, i])) as Record<SetId, number>;
export const SET_BY_ID: Record<SetId, SetDef> = Object.fromEntries(SETS.map((s) => [s.id, s])) as Record<SetId, SetDef>;

/** Pieces needed for each tier. */
export const SET_TIERS = [2, 4, 6] as const;

/** Tier reached with n pieces: 0 (none) .. 3. */
export function setTier(n: number): number {
  return n >= SET_TIERS[2] ? 3 : n >= SET_TIERS[1] ? 2 : n >= SET_TIERS[0] ? 1 : 0;
}

/** The next tier's piece count above n (6 once maxed). */
export function nextTierAt(n: number): number {
  for (const t of SET_TIERS) if (n < t) return t;
  return SET_TIERS[2];
}

const MEMBERS: Record<SetId, readonly string[]> = {
  // Fire: Blaze Boots, Meteor Shower, Burn Mods.
  inferno: ['fire', 'sp_meteor', 'pyromaniac', 'kindling', 'wildfire', 'trailblazer', 'hearth', 'afterburner', 'phoenix', 'supernova', 'signal_flare', 'r_cinder'],
  // Shock and chains.
  storm: ['aura', 'lightning', 'tesla', 'sp_storm', 'tesla_boots', 'static_cling', 'lightning_rod', 'conductor', 'overloader', 'storm_crown', 'thunder_shot', 'crit_cascade', 'r_static', 'r_coil'],
  // Frost and shatter.
  glacier: ['nova', 'sp_blizzard', 'cryo_rounds', 'cold_snap', 'shatterpoint', 'flash_freeze', 'cold_front', 'r_coldsnap', 'r_phoenix', 'r_nova'],
  // Armour, life and shields.
  bulwark: ['shield', 'drones', 'armor', 'heart', 'spiked_shell', 'nanobots', 'bond_of_steel', 'guardian_angel', 'medic_link', 'wallflower', 'r_ironheart', 'r_scale', 'r_thorns', 'r_halo', 'r_anchor', 'r_pacemaker'],
  // Dash and movement.
  speedster: ['fire', 'crosswind', 'sneakers', 'thrusters', 'dash_cells', 'tesla_boots', 'afterburner', 'runners_high', 'phase_step', 'slipstream', 'wing_guard', 'r_feather', 'r_dashbomb', 'r_dashfire', 'r_backbeat', 'r_relay', 'r_coldsnap'],
  // Explosives.
  boomsmith: ['missiles', 'mines', 'swarm', 'starfall', 'grenade', 'orbital', 'sp_bomb', 'big_bang', 'demolition', 'chain_reaction', 'wide_load', 'jack_in_box', 'r_keg', 'r_dashbomb', 'r_cinder'],
  // Turrets, drones and bots.
  machinist: ['drones', 'pellets', 'bouncer', 'tesla', 'sentry', 'rapid_coil', 'battery_pack', 'capacitor', 'hive_mind', 'turret_mode', 'overclock', 'pit_crew', 'r_orbit', 'r_salvage', 'r_holster'],
  // Crits and parries.
  duelist: ['rail', 'whip', 'lucky_star', 'focus_lens', 'boxing_glove', 'sniper', 'brawler', 'overkill', 'riposte_cell', 'counterchorus', 'crit_cascade', 'supernova', 'r_crown', 'r_static', 'r_glassclock', 'r_pacemaker'],
};

/** Piece id -> set indices (an item may sit in up to two sets). */
export const SET_PIECES: Readonly<Record<string, readonly number[]>> = (() => {
  const out: Record<string, number[]> = {};
  for (const s of SETS) for (const id of MEMBERS[s.id]) (out[id] ??= []).push(SET_INDEX[s.id]);
  return out;
})();

export function setMembers(id: SetId): readonly string[] {
  return MEMBERS[id];
}

/** Sets an item belongs to (empty for most loadout upgrades and bonus cards). */
export function setsOf(pieceId: string): readonly number[] {
  return SET_PIECES[pieceId] ?? EMPTY;
}
const EMPTY: readonly number[] = [];

/** Knobs for every set bonus (debug panel: Sets). Damage values grow per stage: base + perStage * stage. */
export const setsTuning = {
  // INFERNO
  infernoBurnMul: 0.2, // 2: hits on Burning enemies
  infernoBoomR: 2.4, // 4: burning enemies explode on death
  infernoBoom: 18,
  infernoBoomPerStage: 8,
  infernoIgnite: 0.12, // 6: every hit ignites, Burn dps = this x hit (min 3)
  // STORMCALLER
  stormShockMul: 0.2, // 2: hits on Shocked enemies
  stormArcChance: 0.12, // 4: hits on Shocked enemies arc to 2 more
  stormArcHops: 2,
  stormArcFrac: 0.35,
  stormEvery: 40, // 6: every Nth hit calls a lightning storm
  stormCooldown: 2,
  stormBolts: 5,
  stormRange: 10,
  stormBolt: 30,
  stormBoltPerStage: 12,
  // GLACIER
  glacierFrozenMul: 0.25, // 2: hits on Frozen enemies
  glacierFreeze: 0.06, // 4: freeze chance on hits
  glacierNovaR: 3, // 6: frozen kills burst into a freezing nova
  glacierNova: 16,
  glacierNovaPerStage: 7,
  glacierNovaFreeze: 1.2,
  // BULWARK
  bulwarkArmor: 2, // 2
  bulwarkWaveR: 4, // 4: getting hit sends out a shockwave
  bulwarkWave: 30,
  bulwarkWavePerStage: 10,
  bulwarkWaveCd: 1.5,
  bulwarkBarrierCd: 12, // 6: a barrier that blocks one hit
  // SPEEDSTER
  speedMove: 0.1, // 2
  speedDash: 0.1,
  speedSlipR: 2.6, // 4: +1 dash, and every dash leaves a slipstream burst
  speedSlip: 20,
  speedSlipPerStage: 8,
  speedBuffTime: 2, // 6: after a dash, weapons fire faster and hit harder
  speedBuffRate: 0.35,
  speedBuffDmg: 0.2,
  // BOOMSMITH
  boomArea: 0.2, // 2: explosions bigger
  boomChance: 0.25, // 4: enemies your explosions kill can explode again
  boomR: 2,
  boomDmg: 16,
  boomDmgPerStage: 8,
  carpetEvery: 12, // 6: carpet bomb on the crowd
  carpetBlasts: 5,
  carpetRange: 12,
  carpetR: 2.8,
  carpetDmg: 40,
  carpetDmgPerStage: 15,
  // MACHINIST
  machCooldown: 0.08, // 2
  botEvery: 1, // 4: support bot zaps the nearest enemy
  botRange: 9,
  botDmg: 20,
  botDmgPerStage: 8,
  botEvery6: 0.5, // 6: faster, chains, and more recharge speed
  botHops6: 2,
  machCooldown6: 0.1,
  // DUELIST
  duelCrit: 0.08, // 2
  duelCritMult: 0.2, // 4: crits can Expose
  duelExpose: 0.25,
  duelGuaranteed: 2, // 6: parry / perfect dodge -> guaranteed crits for this long
  duelCooldown: 8, // ...at most once per this many seconds
  /** Set-made explosions per hero per second (chain reactions stay bounded). */
  boomBudget: 8,
};
