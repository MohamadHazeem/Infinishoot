import { TRIAL_ACHIEVEMENTS } from './trials';
import { SECRET_ACHIEVEMENTS } from './secrets';
import { COOP_ACHIEVEMENTS } from './coopAchievements';
/**
 * Achievements: lifetime goals that unlock auto weapons for the level-up pool
 * and loadout items (clicks and specials) for the LOADOUT screen. This is the
 * only progression that carries between runs.
 */
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Auto weapon added to the level-up pool, if any. */
  unlockWeapon?: string;
  /** Loadout item (left/right-click weapon id or special id) made pickable, if any. */
  unlockLoadout?: string;
  /** Can be earned from lifetime stats alone (old saves get it on load). */
  lifetime?: (l: { kills: number; elites: number; bosses: number; bestStage: number; runs: number }) => boolean;
  /** Medal (meta2): bronze, silver or gold. Older achievements are bronze. */
  tier?: AchievementTier;
  /** ACHIEVEMENTS screen group (meta2). */
  cat?: AchievementCat;
  /** Shown as ??? until earned. */
  hidden?: boolean;
  /**
   * Measured goal (meta2 achievements, checked by src/game/systems/meta2.ts):
   * `life` = lifetime total of a profile stat (src/data/profile.ts keys),
   * `run` = best single run, `set` = distinct things seen, `has` = `member`
   * seen in that set, `plevel` = profile level.
   */
  track?: AchievementTrack;
}

export type AchievementTier = 'bronze' | 'silver' | 'gold';
export type AchievementCat = 'combat' | 'bosses' | 'modes' | 'ascension' | 'coop' | 'skill' | 'builds' | 'world' | 'secrets' | 'profile' | 'classic';
export const ACH_CATS: { id: AchievementCat; name: string }[] = [
  { id: 'classic', name: 'ITEM UNLOCKS' },
  { id: 'combat', name: 'COMBAT' },
  { id: 'bosses', name: 'BOSSES' },
  { id: 'skill', name: 'SKILL' },
  { id: 'builds', name: 'BUILDS' },
  { id: 'modes', name: 'MODES' },
  { id: 'ascension', name: 'ASCENSION' },
  { id: 'coop', name: 'CO-OP & PVP' },
  { id: 'world', name: 'HEROES & WORLD' },
  { id: 'profile', name: 'PROFILE' },
  { id: 'secrets', name: 'SECRETS' },
];
export interface AchievementTrack {
  stat: string;
  goal: number;
  scope: 'life' | 'run' | 'set' | 'has' | 'plevel';
  member?: string;
}

type T = AchievementTier;
/** Short builder for meta2's measured achievements. */
function m(id: string, name: string, desc: string, tier: T, cat: AchievementCat, stat: string, goal: number, scope: AchievementTrack['scope'] = 'life', extra: Partial<AchievementDef> = {}): AchievementDef {
  return { id, name, desc, tier, cat, track: { stat, goal, scope }, ...extra };
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'true_ending', name: 'Unwritten Future', desc: 'Defeat the Architect after the third loop.', tier: 'gold', cat: 'bosses', hidden: true },
  ...TRIAL_ACHIEVEMENTS,
  ...SECRET_ACHIEVEMENTS,
  { id: 'hydra_engine', name: 'Engine Breakers', desc: 'Defeat the Hydra Engine raid.' },
  { id: 'light_tamer', name: 'Light Tamer', desc: 'Defeat 1,500 enemies in total', unlockLoadout: 'whip', lifetime: (l) => l.kills >= 1500 },
  { id: 'field_engineer', name: 'Field Engineer', desc: 'Defeat 12 elites in total', unlockLoadout: 'sentry', lifetime: (l) => l.elites >= 12 },
  { id: 'first_steps', name: 'First Steps', desc: 'Defeat 300 enemies in total', unlockLoadout: 'shield', unlockWeapon: 'pellets', lifetime: (l) => l.kills >= 300 },
  { id: 'boss_slayer', name: 'Boss Slayer', desc: 'Defeat a boss', unlockWeapon: 'missiles', lifetime: (l) => l.bosses >= 1 },
  { id: 'stage_2', name: 'Onward', desc: 'Reach stage 2', unlockLoadout: 'blizzard', lifetime: (l) => l.bestStage >= 2 },
  { id: 'elite_hunter', name: 'Elite Hunter', desc: 'Defeat 5 elites in total', unlockWeapon: 'nova', lifetime: (l) => l.elites >= 5 },
  { id: 'evolved', name: 'Evolution', desc: 'Evolve a weapon or special', unlockLoadout: 'well', unlockWeapon: 'bouncer', lifetime: (l) => l.bestStage >= 3 },
  { id: 'arsenal', name: 'Full Arsenal', desc: 'Hold 6 weapons at once', unlockLoadout: 'orb' },
  { id: 'exterminator', name: 'Exterminator', desc: 'Defeat 3,000 enemies in total', unlockWeapon: 'mines', lifetime: (l) => l.kills >= 3000 },
  { id: 'speedster', name: 'Speedster', desc: 'Dash 60 times in one run', unlockWeapon: 'fire' },
  { id: 'stage_3', name: 'Deep Diver', desc: 'Reach stage 3', unlockLoadout: 'meteor', lifetime: (l) => l.bestStage >= 3 },
  { id: 'maxed', name: 'Maxed Out', desc: 'Max out a weapon', unlockLoadout: 'laser', unlockWeapon: 'sweeper' },
  { id: 'boss_rush', name: 'Boss Rush', desc: 'Defeat 5 bosses in total', unlockLoadout: 'orbital', lifetime: (l) => l.bosses >= 5 },
  { id: 'elite_slayer', name: 'Elite Slayer', desc: 'Defeat 25 elites in total', unlockLoadout: 'rail', lifetime: (l) => l.elites >= 25 },
  { id: 'victory', name: 'The End?', desc: 'Defeat the final boss on stage 4', unlockLoadout: 'blackhole', lifetime: (l) => l.bestStage > 4 },
  { id: 'hard_stage3', name: 'Hard Boiled', desc: 'Reach stage 3 on Hard or Nightmare' },
  { id: 'endless_5', name: 'Marathon', desc: 'Reach wave 5 in Endless' },
  { id: 'rush_3', name: 'Boss Buster', desc: 'Beat 3 bosses in the Boss Rush mode' },
  // Hero unlocks (src/data/heroes.ts; checked in src/game/systems/heroMechs.ts).
  { id: 'riposte', name: 'Riposte', desc: 'Parry 25 times in one run' },
  { id: 'immovable', name: 'Immovable', desc: 'Stand still for 20 seconds straight during a stage' },
  { id: 'double_trouble', name: 'Double Trouble', desc: 'Evolve both your left and right click in one run' },
  // FIRST STEPS checklist on the title (src/game/firstten.ts): unlocks the Star Cadet skin.
  { id: 'graduate', name: 'Graduate', desc: 'Finish every FIRST STEPS goal on the title screen' },
  // heroes3 lane: Ronin and Tinker (checked in src/game/systems/heroes3.ts).
  { id: 'point_blank', name: 'Point Blank', desc: 'Defeat 150 enemies within 2.5 m of you in one run' },
  { id: 'workshop', name: 'Workshop', desc: 'Hold 4 auto weapons at level 5 or higher in one run' },
  // heroes4 lane: Medic and Brawler (checked in src/game/systems/heroes4.ts).
  { id: 'lifesaver', name: 'Lifesaver', desc: 'Clear a stage after dropping below 20% life in it' },
  { id: 'wrecking_crew', name: 'Wrecking Crew', desc: 'Defeat 20 enemies with the arena (lava, thorns, pillars, barrels, ice, crushers) in one run' },
  // ---------------------------------------------------------------- meta2: long-term goals (cosmetic only)
  // Combat
  m('m2_kills_10k', 'Crowd Control', 'Defeat 10,000 enemies yourself', 'bronze', 'combat', 'kills', 10000),
  m('m2_kills_50k', 'Scrap Merchant', 'Defeat 50,000 enemies yourself', 'silver', 'combat', 'kills', 50000),
  m('m2_fire', 'Pyromaniac', 'Defeat 2,000 enemies with fire', 'bronze', 'combat', 'k_fire', 2000),
  m('m2_frost', 'Cold Front', 'Defeat 2,000 enemies with frost', 'bronze', 'combat', 'k_frost', 2000),
  m('m2_shock', 'Live Wire', 'Defeat 2,000 enemies with shock', 'bronze', 'combat', 'k_shock', 2000),
  m('m2_boom', 'Demolition Crew', 'Defeat 3,000 enemies with explosions', 'bronze', 'combat', 'k_explosive', 3000),
  m('m2_orbit', 'Satellite Dish', 'Defeat 2,000 enemies with orbit weapons', 'bronze', 'combat', 'k_orbit', 2000),
  m('m2_chain', 'Chain Gang', 'Defeat 2,000 enemies with chain weapons', 'bronze', 'combat', 'k_chain', 2000),
  m('m2_elite100', 'Elite Breaker', 'Defeat 100 elites yourself', 'silver', 'combat', 'k_elite', 100),
  m('m2_goldbug', 'Bug Squasher', 'Pop 10 Goldbugs', 'bronze', 'combat', 'k_goldbug', 10),
  m('m2_reaper', 'Death Defied', 'Defeat a Reaper', 'gold', 'combat', 'k_reaper', 1),
  m('m2_runkills', 'Wrecking Ball', 'Defeat 3,000 enemies in one run', 'silver', 'combat', 'runKills', 3000, 'run'),
  m('m2_runkills2', 'Apocalypse Now', 'Defeat 8,000 enemies in one run', 'gold', 'combat', 'runKills', 8000, 'run'),
  m('m2_combo300', 'Combo Machine', 'Reach a 300 combo', 'silver', 'combat', 'combo', 300, 'run'),
  m('m2_combo1000', 'Combo Legend', 'Reach a 1,000 combo', 'gold', 'combat', 'combo', 1000, 'run'),
  // Bosses
  m('m2_king', "King's Ransom", 'Defeat King Bopper 10 times', 'bronze', 'bosses', 'b_king', 10),
  m('m2_rex', 'Extinction Event', 'Defeat Rampage Rex 10 times', 'bronze', 'bosses', 'b_rex', 10),
  m('m2_queen', 'Hive Mind', 'Defeat the Hive Queen 10 times', 'bronze', 'bosses', 'b_queen', 10),
  m('m2_omega', 'Overlord Down', 'Defeat Omega Overlord', 'silver', 'bosses', 'b_omega', 1),
  m('m2_titan', 'Giant Slayer', 'Topple the Titan Goliath', 'silver', 'bosses', 'b_titan', 1),
  m('m2_remix', 'Rematch Won', 'Beat a remixed boss in its rematch', 'silver', 'bosses', 'b_remix', 1),
  m('m2_mini10', 'Small Fry', 'Defeat 10 mini-bosses', 'bronze', 'bosses', 'k_mini', 10),
  m('m2_boss50', 'Boss Collector', 'Defeat 50 bosses', 'silver', 'bosses', 'bosses', 50),
  m('m2_gallery', "Rogues' Gallery", 'Beat 10 different bosses (mini-bosses and rematches count)', 'gold', 'bosses', 'bossKinds', 10, 'set'),
  // Skill
  m('m2_parry100', 'Deflector', 'Parry 100 times', 'silver', 'skill', 'parries', 100),
  m('m2_pdash100', 'Untouchable', 'Land 100 perfect dashes', 'bronze', 'skill', 'perfectDashes', 100),
  m('m2_ult50', 'Ultimate Power', 'Fire 50 ultimates', 'silver', 'skill', 'ultimates', 50),
  m('m2_rank_s', 'Stylish', 'Reach style rank S', 'silver', 'skill', 'style', 4, 'run'),
  m('m2_rank_ss', 'Smokin\' Sexy Style', 'Reach style rank SS', 'gold', 'skill', 'style', 5, 'run'),
  m('m2_cash25', 'Cash Money', 'Cash in your combo 25 times', 'silver', 'skill', 'cashIns', 25),
  m('m2_rewind10', 'Rewind Time', 'Rewind 10 times', 'bronze', 'skill', 'rewinds', 10),
  m('m2_stand', 'Not Today', 'Win a last stand', 'silver', 'skill', 'lastStands', 1),
  m('m2_flawless', 'Flawless', 'Clear a stage without getting hit', 'silver', 'skill', 'flawless', 1),
  m('m2_comeback', 'Comeback Kid', 'Pull off a comeback', 'bronze', 'skill', 'comebacks', 1),
  // Builds
  m('m2_evo10', 'Evolver', 'Evolve 10 items', 'bronze', 'builds', 'evolutions', 10),
  m('m2_fusion', 'Fused', 'Fuse two weapons', 'silver', 'builds', 'fusions', 1),
  m('m2_mech', 'Mech Pilot', 'Ride a mech suit', 'bronze', 'builds', 'mechs', 1),
  m('m2_crates', 'Supply Run', 'Wield 10 super weapons from supply crates', 'bronze', 'builds', 'crates', 10),
  m('m2_gold300', 'Fat Wallet', 'Hold 300 gold at once', 'silver', 'builds', 'gold', 300, 'run'),
  m('m2_lv50', 'Power Spike', 'Reach level 50 in a run', 'silver', 'builds', 'level', 50, 'run'),
  m('m2_lv100', 'Level 100 Hero', 'Reach level 100 in a run', 'gold', 'builds', 'level', 100, 'run'),
  m('m2_chest100', 'Treasure Hunter', 'Open 100 chests', 'bronze', 'builds', 'chests', 100),
  // Modes
  m('m2_endless', 'Endless Begins', 'Play an Endless run', 'bronze', 'modes', 'endlessRuns', 1),
  m('m2_wave10', 'Ultramarathon', 'Reach wave 10 in Endless', 'silver', 'modes', 'wave', 10, 'run'),
  m('m2_rush6', 'Rush Hour', 'Beat 6 bosses in one Boss Rush', 'silver', 'modes', 'rushBosses', 6, 'run'),
  m('m2_daily', 'Daily Driver', 'Play a Daily Challenge', 'bronze', 'modes', 'dailyRuns', 1),
  m('m2_weekly', 'Week One', 'Play a Weekly Challenge', 'bronze', 'modes', 'weeklyRuns', 1),
  m('m2_rhythm', 'On the Beat', 'Play a rhythm stage', 'bronze', 'modes', 'rhythm', 1),
  m('m2_pacifist', 'Pacifist Road', 'Walk the Pacifist road', 'silver', 'modes', 'pacifist', 1),
  m('m2_minigames', 'Arcade Rat', 'Play 5 bonus mini-games', 'bronze', 'modes', 'minigames', 5),
  m('m2_modes', 'Mode Tourist', 'Play all 5 run modes', 'silver', 'modes', 'modes', 5, 'set'),
  m('m2_stage8', 'Second Loop', 'Reach stage 8', 'silver', 'modes', 'stage', 8, 'run'),
  m('m2_loops5', 'Loop Champion', 'Clear 5 loops in total', 'gold', 'modes', 'victories', 5),
  // Ascension challenge clears (existing earned medals remain unlocked).
  m('m2_asc1', 'Ascension I', 'Clear Ascension 2 or higher', 'bronze', 'ascension', 'ascension', 2, 'run'),
  m('m2_asc2', 'Ascension II', 'Clear Ascension 6 or higher', 'silver', 'ascension', 'ascension', 6, 'run'),
  m('m2_asc3', 'Ascension III', 'Clear Ascension 10 or higher', 'gold', 'ascension', 'ascension', 10, 'run'),
  // Co-op and PvP
  m('m2_coop', 'Better Together', 'Play a co-op run', 'bronze', 'coop', 'coopRuns', 1),
  m('m2_coopst20', 'Team Players', 'Clear 20 stages in co-op', 'silver', 'coop', 'coopStages', 20),
  m('m2_revive10', 'Field Medic', 'Revive teammates 10 times', 'bronze', 'coop', 'revives', 10),
  m('m2_revive100', 'Lifeline', 'Revive teammates 100 times', 'gold', 'coop', 'revives', 100),
  m('m2_local', 'Couch Co-op', 'Play local co-op on one screen', 'bronze', 'coop', 'localRuns', 1),
  m('m2_pvp', 'First Duel', 'Fight a PvP duel', 'bronze', 'coop', 'pvpDuels', 1),
  m('m2_pvpwin', 'Last One Standing', 'Win a PvP duel', 'silver', 'coop', 'pvpWins', 1),
  m('m2_versus', 'Swarm Tactics', 'Play a Versus Swarm match', 'bronze', 'coop', 'versusRuns', 1),
  m('m2_versus5', 'Versus Victor', 'Win 5 Versus Swarm matches', 'silver', 'coop', 'versusWins', 5),
  // Heroes and world
  m('m2_heroes7', 'Full Roster', 'Play all 7 heroes', 'gold', 'world', 'heroes', 7, 'set'),
  m('m2_biomes4', 'Island Hopper', 'Visit 4 different islands', 'bronze', 'world', 'biomes', 4, 'set'),
  m('m2_biomes11', 'Cartographer', 'Visit all 11 islands (remixes count)', 'gold', 'world', 'biomes', 11, 'set'),
  m('m2_events4', 'Weatherproof', 'Live through 4 kinds of world event', 'silver', 'world', 'events', 4, 'set'),
  m('m2_events8', 'Act of God', 'Live through all 8 kinds of world event', 'gold', 'world', 'events', 8, 'set'),
  m('m2_runs100', 'Regular', 'Finish 100 runs', 'silver', 'world', 'runs', 100),
  m('m2_hours10', 'Ten Hours In', 'Play for 10 hours', 'silver', 'world', 'time', 36000),
  // Profile and quests
  m('m2_quest1', 'Quest Starter', 'Finish a daily quest', 'bronze', 'profile', 'quests', 1),
  m('m2_quest30', 'Questing', 'Finish 30 daily quests', 'silver', 'profile', 'quests', 30),
  m('m2_plv10', 'Getting Started', 'Reach profile level 10', 'bronze', 'profile', 'plevel', 10, 'plevel'),
  m('m2_plv50', 'Halfway There', 'Reach profile level 50', 'gold', 'profile', 'plevel', 50, 'plevel'),
  m('m2_plv100', 'Infinite', 'Reach profile level 100', 'gold', 'profile', 'plevel', 100, 'plevel', { hidden: true }),
  // Secrets
  m('m2_photo', 'Say Cheese', 'Open photo mode', 'bronze', 'secrets', 'photos', 1, 'life', { hidden: true }),
  m('m2_alley', 'Back Alley Deal', 'Meet the secret merchant', 'bronze', 'secrets', 'secretShops', 1, 'life', { hidden: true }),
  m('m2_jackpot', 'Jackpot!', 'Win a jackpot chest', 'silver', 'secrets', 'jackpots', 1, 'life', { hidden: true }),
  m('m2_golden', 'Golden Road', 'Ride a golden route after a flawless stage', 'silver', 'secrets', 'golden', 1, 'life', { hidden: true }),
  m('m2_raid', 'Night Raider', 'Live through a Night Raid', 'silver', 'secrets', 'events', 1, 'has', { hidden: true, track: { stat: 'events', goal: 1, scope: 'has', member: 'stealth' } }),
  m('m2_browser', 'Window Shopper', 'Open 6 different EXTRAS pages', 'bronze', 'secrets', 'screens', 6, 'set', { hidden: true }),
];

/** Medals for the achievements that predate tiers (everything else in that group is bronze). */
const CLASSIC_TIERS: Record<string, AchievementTier> = {
  exterminator: 'silver',
  boss_rush: 'silver',
  elite_slayer: 'silver',
  stage_3: 'silver',
  maxed: 'silver',
  arsenal: 'silver',
  endless_5: 'silver',
  rush_3: 'silver',
  riposte: 'silver',
  immovable: 'silver',
  hard_stage3: 'gold',
  victory: 'gold',
  double_trouble: 'gold',
};
for (const a of ACHIEVEMENTS) {
  a.tier ??= CLASSIC_TIERS[a.id] ?? 'bronze';
  a.cat ??= 'classic';
}
export const ACH_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
// Co-op achievements and their titles (trading lane, src/data/coopAchievements.ts).
ACHIEVEMENTS.push(...COOP_ACHIEVEMENTS);
