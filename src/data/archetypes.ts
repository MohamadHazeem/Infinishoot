import type { Tag } from './tags';

export type PathTrigger = 'strafe' | 'release' | 'dash' | 'parry' | 'brace' | 'ultimate' | 'melee';
export type PathEffect = 'mark' | 'blast' | 'ward' | 'pull' | 'push' | 'frost' | 'arc';

export interface BuildPath {
  id: string;
  tag: Tag;
  items: readonly [string, string, string]; // two passives and a shop Mod
  trigger: PathTrigger;
  effect: PathEffect;
}

function path(id: string, tag: Tag, a: string, b: string, mod: string, trigger: PathTrigger, effect: PathEffect): BuildPath {
  return { id, tag, items: [a, b, mod], trigger, effect };
}

export const HERO_PATHS = {
  rookie: [
    path('gunslinger', 'projectile', 'rapid_coil', 'focus_lens', 'quick_draw', 'strafe', 'mark'),
    path('demolitionist', 'explosive', 'big_bang', 'power_cell', 'demolition', 'release', 'blast'),
  ],
  bulwark: [
    path('bastion', 'area', 'armor', 'heart', 'wallflower', 'brace', 'ward'),
    path('siegebreaker', 'explosive', 'spiked_shell', 'big_bang', 'overkill', 'melee', 'push'),
  ],
  dash: [
    path('sliprunner', 'trail', 'sneakers', 'dash_cells', 'slipstream', 'dash', 'frost'),
    path('outrider', 'projectile', 'rapid_coil', 'thrusters', 'runners_high', 'strafe', 'arc'),
  ],
  ace: [
    path('spotter', 'chain', 'focus_lens', 'capacitor', 'sniper', 'release', 'mark'),
    path('stormcaller', 'shock', 'battery_pack', 'tesla_boots', 'conductor', 'ultimate', 'arc'),
  ],
  duelist: [
    path('riposte', 'area', 'boxing_glove', 'armor', 'riposte_cell', 'parry', 'blast'),
    path('deadeye', 'projectile', 'focus_lens', 'rapid_coil', 'patience', 'brace', 'mark'),
  ],
  furnace: [
    path('crucible', 'fire', 'power_cell', 'big_bang', 'kindling', 'brace', 'pull'),
    path('vent', 'area', 'armor', 'thrusters', 'afterburner', 'dash', 'blast'),
  ],
  twin: [
    path('crossfire', 'projectile', 'rapid_coil', 'capacitor', 'hair_trigger', 'release', 'arc'),
    path('binary', 'orbit', 'magnet', 'plasma_core', 'hive_mind', 'strafe', 'pull'),
  ],
  ronin: [
    path('iai', 'area', 'dash_cells', 'focus_lens', 'phase_step', 'dash', 'mark'),
    path('winterblade', 'frost', 'cryo_rounds', 'armor', 'cold_snap', 'parry', 'frost'),
  ],
  tinker: [
    path('scrapper', 'shock', 'tesla_boots', 'magnet', 'static_cling', 'brace', 'arc'),
    path('satellite', 'orbit', 'plasma_core', 'rapid_coil', 'hive_mind', 'strafe', 'ward'),
  ],
  medic: [
    path('triage', 'area', 'heart', 'nanobots', 'pit_crew', 'ultimate', 'ward'),
    path('quarantine', 'frost', 'cryo_rounds', 'battery_pack', 'cold_front', 'release', 'frost'),
  ],
  brawler: [
    path('clinch', 'area', 'boxing_glove', 'magnet', 'brawler', 'melee', 'pull'),
    path('haymaker', 'explosive', 'big_bang', 'spiked_shell', 'overkill', 'dash', 'push'),
  ],
} satisfies Record<string, [BuildPath, BuildPath]>;

export const archetypeTuning = { weaponRanks: 3, supportRanks: 2, cooldown: 8, radius: 2.8, targets: 4 };
