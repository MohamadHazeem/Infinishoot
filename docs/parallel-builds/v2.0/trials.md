LANE: trials — handcrafted challenges

A TRIALS mode (MODE screen): ~24 short handcrafted challenge scenarios, each 1-3 minutes, with BRONZE/SILVER/GOLD medal targets (time, kills, damage taken, combo) and a local best per trial. Mix of: survive 90 s with only the Buster; kill King Bopper in under 40 s with a fixed kit; no-hit a Rex phase; parry 20 shots; perfect-dash 10 Rhino charges; clear a swarm with only environmental kills; escort a core; collect 30 gems in a gravity storm; Ronin-only sword trial; Tinker bot army trial; mech suit rampage; rhythm-stage perfect beats; a puzzle-room speedrun; boss rush mini (3 bosses); night stealth; co-op trial pairs (2 players) for a few.
1. Data-driven trial definitions (src/data/trials.ts): setup (biome, enemies/boss, hero, kit, modifiers, timer), goal, medal thresholds; built on test-link-like setup code and existing systems.
2. TRIALS screen with categories, medals, best times, locked/unlocked (unlock in tiers by medals), a trial intro card and a results card with medal animation (sounds: achievement/trophy samples), RETRY quickly.
3. Medals feed profile XP/cosmetics (meta2 profile, if present) and achievements (e.g. 10 gold medals).
4. English + Arabic strings (src/i18n), tests, screenshots.
Owns: new src/data/trials.ts, src/game/systems/trials.ts, src/ui/trialsScreen.ts, small hooks in modes/runFlow, tests/trials.test.ts.
