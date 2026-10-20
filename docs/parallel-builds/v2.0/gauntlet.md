LANE: gauntlet — endgame and new solo challenges

1. SURVIVAL GAUNTLET mode: no shops, no portals; one long stage that never ends, scaling every 30 s (new enemy waves, elites, mini-bosses every 3 min, a boss every 6), level-ups only; score = time survived x kills; its own local best table (and online board when VITE_LEADERBOARD_URL is set); vo_gauntlet announcer line.
2. BOSS RUSH 2.0: all bosses back to back (incl. new ones as they exist), with remixed attacks on the second lap, a short shop every 2 bosses, a timer and splits like a speedrun.
3. ASCENSION 1-20 (Slay the Spire/Hades style): after beating Omega on Hard, unlock Ascension levels; each adds a permanent modifier on top of the previous ones (enemy speed, elite modifiers x2, boss extra attacks, fewer chests, no healing between stages...), shows on the MODE screen and in run history; cosmetic reward per 5 levels; vo_ascension.
4. Endless loops: from loop 5, each loop adds a mutator (fast enemies, explosive deaths, mirror bosses, darkness...) shown on the stage card; NEW GAME+ after the first victory (keep cosmetics, stronger enemies, new remixes).
Owns: src/data/modes.ts (additive), new src/data/ascension.ts, src/game/systems/gauntlet.ts, runFlow hooks (small), mode screen hooks (small), tests/gauntlet.test.ts.
