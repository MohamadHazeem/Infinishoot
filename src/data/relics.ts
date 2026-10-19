import type { Stats } from '../game/stats';
import { rarityWeight, type Rarity } from './rarity';

/**
 * Relics: rare boss drops (one per hero per boss) and secret-shop buys that
 * bend a rule for the rest of the run. Rule relics' behaviour lives in Game at
 * the matching hook; stat relics just `add` to the hero's stats (like a
 * passive at level 1). Rarer relics drop less often; Luck lifts them.
 */
export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  rarity: Rarity;
  /** Stat bonus while owned (applied in Hero.recomputeStats). */
  add?: Partial<Stats>;
}

export const RELICS: RelicDef[] = [
  { id: 'r_backbeat', name: 'Backbeat Battery', desc: 'Every third dash restores 12% special charge.', icon: 'ϟ', color: '#73eff7', rarity: 'common' },
  { id: 'r_relay', name: 'Rescue Relay', desc: 'Dashing heals nearby teammates for 8 life (yourself for 4 in solo). Once every 6 s.', icon: '✚', color: '#38b764', rarity: 'rare' },
  { id: 'r_capacitor', name: 'Pain Capacitor', desc: 'Taking a hit restores 15% special charge.', icon: '↯', color: '#ef7d57', rarity: 'uncommon' },
  { id: 'r_mercy', name: 'Mercy Coin', desc: 'Every 12 kills: heal 8 below half life, otherwise gain 2 gold. 6 s cooldown.', icon: '◐', color: '#ffcd75', rarity: 'uncommon' },
  { id: 'r_anchor', name: 'Anchor Badge', desc: 'Stand still for 1 s: gain 4 armor and fire 15% faster until you move.', icon: '⚓', color: '#94b0c2', rarity: 'rare' },
  { id: 'r_glassclock', name: 'Glass Clock', desc: 'At full life fire 20% faster. While hurt deal 10% less damage.', icon: '◇', color: '#73eff7', rarity: 'rare' },
  { id: 'r_salvage', name: 'Salvage Permit', desc: 'Your elite kills drop a reroll gear.', icon: '⚙', color: '#a7f070', rarity: 'common' },
  { id: 'r_coldsnap', name: 'Cold Snap Soles', desc: 'Dashing freezes regular enemies within 3 m for 1 s. Once every 4 s.', icon: '❄', color: '#41a6f6', rarity: 'rare' },
  { id: 'r_reserve', name: 'Reserve Dynamo', desc: 'Hold a full special meter: double pickup range and +15% damage.', icon: '◎', color: '#ffcd75', rarity: 'legendary' },
  { id: 'r_jackpot', name: 'Forty Winks', desc: 'Every 40 kills completely refills your special meter.', icon: '★', color: '#a7f070', rarity: 'legendary' },
  { id: 'r_cinder', name: 'Cinder Receipt', desc: 'Every second dash leaves a blast that hits enemies after 0.8 s.', icon: '✹', color: '#ef7d57', rarity: 'uncommon' },
  { id: 'r_pacemaker', name: 'Pacemaker', desc: 'After 10 s without a hit, the next hit clears enemy bullets within 4 m.', icon: '♥', color: '#b13e53', rarity: 'rare' },
  { id: 'r_dashbomb', name: 'Blast Boots', desc: 'Dashing sets off an explosion.', icon: '✷', color: '#ffb627', rarity: 'uncommon' },
  { id: 'r_static', name: 'Static Charm', desc: 'Critical hits zap 2 nearby enemies.', icon: 'ϟ', color: '#fff35c', rarity: 'rare' },
  { id: 'r_fang', name: 'Blood Charm', desc: 'Every 20 kills heal 5 life.', icon: '▼', color: '#b13e53', rarity: 'common' },
  { id: 'r_phoenix', name: 'Frost Totem', desc: 'Once per stage, survive a lethal hit and freeze everything nearby.', icon: '♨', color: '#9fe8ff', rarity: 'legendary' },
  { id: 'r_thorns', name: 'Thorn Mail', desc: 'Enemies that hit you take 80 damage.', icon: '✦', color: '#38b764', rarity: 'uncommon' },
  { id: 'r_midas', name: 'Golden Glove', desc: 'Your kills drop gold three times as often.', icon: '●', color: '#ffcd75', rarity: 'rare' },
  { id: 'r_clover', name: 'Gear Box', desc: '+1 gear (level-up reroll) every stage.', icon: '⚙', color: '#a7f070', rarity: 'common' },
  { id: 'r_hourglass', name: 'Hourglass', desc: 'Team combo lasts 1 second longer.', icon: '⧗', color: '#73eff7', rarity: 'common' },
  // Stat relics.
  { id: 'r_lodestone', name: 'Lodestone', desc: 'Pickups fly to you from 60% further.', icon: '◆', color: '#94b0c2', rarity: 'common', add: { magnet: 0.6 } },
  { id: 'r_ironheart', name: 'Iron Heart', desc: '+30 max life.', icon: '♥', color: '#b13e53', rarity: 'common', add: { maxHp: 30 } },
  { id: 'r_feather', name: 'Swift Feather', desc: 'Move 12% faster.', icon: '»', color: '#73eff7', rarity: 'common', add: { moveSpeedMul: 0.12 } },
  { id: 'r_drum', name: 'War Drum', desc: '+15% damage.', icon: '◎', color: '#ef7d57', rarity: 'uncommon', add: { damageMul: 0.15 } },
  { id: 'r_horseshoe', name: 'Lucky Horseshoe', desc: '+1 Luck: rarer cards, Mods and drops show up more.', icon: '∩', color: '#a7f070', rarity: 'uncommon', add: { luck: 1 } },
  { id: 'r_holster', name: 'Quick Holster', desc: 'Weapons recharge 10% faster.', icon: '»', color: '#ffcd75', rarity: 'uncommon', add: { cooldownMul: -0.1 } },
  { id: 'r_crown', name: 'Critical Crown', desc: '+10% crit chance and +25% crit damage.', icon: '♛', color: '#fff35c', rarity: 'rare', add: { critChance: 0.1, critMult: 0.25 } },
  { id: 'r_coil', name: 'Overcharged Coil', desc: 'Your Q/E special recharges 25% faster.', icon: '⚡', color: '#41a6f6', rarity: 'rare', add: { specialCooldownMul: -0.25 } },
  { id: 'r_scale', name: 'Dragon Scale', desc: '+3 armor, and getting hit bursts spikes around you.', icon: '◈', color: '#38b764', rarity: 'legendary', add: { armor: 3, thorns: 40 } },
  { id: 'r_halo', name: 'Angel Halo', desc: '+20 max life and regenerate 1 life per second.', icon: '○', color: '#ffcd75', rarity: 'legendary', add: { maxHp: 20, regen: 1 } },
  // Build-defining rule relics (gameplay lane: hooks in src/game/systems/gameplay.ts, numbers in relicTuning).
  { id: 'r_dashfire', name: 'Trigger Dash', desc: 'Dashing fires a ring of 10 rounds, and your weapons fire 40% faster for 1.2 s after.', icon: '✺', color: '#fff35c', rarity: 'rare' },
  { id: 'r_orbit', name: 'Satellite Rounds', desc: 'While you fire, rounds gather in orbit around you (up to 6), then launch at the nearest enemy.', icon: '◌', color: '#73eff7', rarity: 'legendary' },
  { id: 'r_nova', name: 'Nova Heart', desc: 'Every 10th kill sets off a frost nova around you that freezes what it hits.', icon: '❄', color: '#9fe8ff', rarity: 'rare' },
  { id: 'r_adrenal', name: 'Adrenal Gland', desc: 'Below half life: weapons fire 35% faster and hit 15% harder.', icon: '♣', color: '#b13e53', rarity: 'rare' },
  { id: 'r_keg', name: 'Powder Keg', desc: 'Enemies you kill have a 20% chance to explode, and the blast can chain.', icon: '✹', color: '#ef7d57', rarity: 'rare' },
  { id: 'r_combo', name: 'Combo Engine', desc: 'Your damage grows with the team combo: +4% per multiplier step (x8 = +28%).', icon: '∞', color: '#a7f070', rarity: 'legendary' },
];

export const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r])) as Record<string, RelicDef>;

/** A random relic not yet owned, weighted by rarity (Luck lifts the rare ones); null when they're all owned. */
export function rollRelic(owned: readonly string[], luck: number, roll: () => number): RelicDef | null {
  const pool = RELICS.filter((r) => !owned.includes(r.id));
  if (!pool.length) return null;
  const w = (r: RelicDef) => rarityWeight(r.rarity, luck);
  let x = roll() * pool.reduce((a, r) => a + w(r), 0);
  for (const r of pool) if ((x -= w(r)) <= 0) return r;
  return pool[pool.length - 1];
}
