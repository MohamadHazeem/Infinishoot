/**
 * Relics: rare boss drops (one per hero per boss) that bend a rule for the
 * rest of the run. Behaviour lives in Game at the matching hook.
 */
export interface RelicDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
}

export const RELICS: RelicDef[] = [
  { id: 'r_dashbomb', name: 'Blast Boots', desc: 'Dashing sets off an explosion.', icon: '✷', color: '#ffb627' },
  { id: 'r_static', name: 'Static Charm', desc: 'Critical hits zap 2 nearby enemies.', icon: 'ϟ', color: '#fff35c' },
  { id: 'r_fang', name: 'Vampire Fang', desc: 'Every 20 kills heal 5 life.', icon: '▼', color: '#b13e53' },
  { id: 'r_phoenix', name: 'Phoenix Feather', desc: 'Once per stage, survive a lethal hit and freeze everything nearby.', icon: '♨', color: '#ff7a2f' },
  { id: 'r_thorns', name: 'Thorn Mail', desc: 'Enemies that hit you take 80 damage.', icon: '✦', color: '#38b764' },
  { id: 'r_midas', name: 'Midas Glove', desc: 'Your kills drop gold three times as often.', icon: '●', color: '#ffcd75' },
  { id: 'r_clover', name: 'Four-Leaf Clover', desc: '+1 level-up reroll every stage.', icon: '♣', color: '#a7f070' },
  { id: 'r_hourglass', name: 'Hourglass', desc: 'Team combo lasts 1 second longer.', icon: '⧗', color: '#73eff7' },
];

export const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r])) as Record<string, RelicDef>;
