/** The glyph is both the silhouette on the ground and the cue used in the first-visit tip. */
export const TERRAIN = {
  roots: { ink: '#a7f070', glyph: ['101', '111', '010'], tip: 'g7.roots' },
  prism: { ink: '#b8a8ff', glyph: ['010', '101', '010'], tip: 'g7.prism' },
  spring: { ink: '#ffcd75', glyph: ['011', '110', '010'], tip: 'g7.spring' },
  shelter: { ink: '#73eff7', glyph: ['111', '101', '010'], tip: 'g7.shelter' },
  tide: { ink: '#41a6f6', glyph: ['010', '101', '101'], tip: 'g7.tide' },
  magnet: { ink: '#ef7d57', glyph: ['101', '101', '111'], tip: 'g7.magnet' },
  ice: { ink: '#d4f4ff', glyph: ['110', '011', '001'], tip: 'g7.ice' },
} as const;
export type TerrainKind = keyof typeof TERRAIN;

export interface BiomeRulesDef {
  terrain: readonly [TerrainKind, TerrainKind, TerrainKind];
  stone: string;
  guardian: string;
  relic: string;
}

export const ISLAND_RULES: Record<string, BiomeRulesDef> = {
  meadow: {
    terrain: ['roots', 'spring', 'magnet'],
    stone: '#465e53',
    guardian: 'prince',
    relic: 'r_relay',
  },
  dunes: {
    terrain: ['shelter', 'prism', 'tide'],
    stone: '#cd966e',
    guardian: 'rexling',
    relic: 'r_midas',
  },
  peaks: {
    terrain: ['ice', 'prism', 'spring'],
    stone: '#91bacf',
    guardian: 'princess',
    relic: 'r_coldsnap',
  },
  magma: {
    terrain: ['spring', 'shelter', 'tide'],
    stone: '#73598c',
    guardian: 'rexling',
    relic: 'r_cinder',
  },
  neon: {
    terrain: ['prism', 'magnet', 'shelter'],
    stone: '#5e5992',
    guardian: 'mc_static',
    relic: 'r_static',
  },
  factory: {
    terrain: ['magnet', 'spring', 'roots'],
    stone: '#cf795a',
    guardian: 'jack_jr',
    relic: 'r_salvage',
  },
  sky: {
    terrain: ['tide', 'spring', 'prism'],
    stone: '#8daec8',
    guardian: 'squall',
    relic: 'r_feather',
  },
  candy: {
    terrain: ['roots', 'tide', 'spring'],
    stone: '#d488ad',
    guardian: 'cupcake',
    relic: 'r_jackpot',
  },
  ruins: {
    terrain: ['tide', 'shelter', 'magnet'],
    stone: '#599f99',
    guardian: 'princeling',
    relic: 'r_lodestone',
  },
};
