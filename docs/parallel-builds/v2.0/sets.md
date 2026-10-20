LANE: sets — item set bonuses

Build depth: items, weapons, relics and Mods belong to SETS (e.g. INFERNO: fire items; STORMCALLER: shock items; GLACIER; BULWARK: armour/shield items; SPEEDSTER: dash/move items; BOOMSMITH: explosives; MACHINIST: turrets/drones/bots; DUELIST: crits/parries). Holding 2 / 4 / 6 pieces of a set grants escalating bonuses that change how the build plays (not just +%), e.g. INFERNO 4: burning enemies explode on death; STORMCALLER 6: every 10th hit calls a lightning storm.
1. Data: set membership on existing items (src/data/sets.ts mapping ids → sets, so item files barely change), set bonus effects through the existing stats/Mod hook machinery.
2. UI: set chips on level-up/shop cards ("INFERNO 2/4"), a SETS panel in the pause/build screen, a flourish when a set tier activates (sound + banner).
3. Balance with the bot (sets should be attractive but not mandatory), co-op (each hero's own sets), English + Arabic strings, tests and screenshots.
Owns: new src/data/sets.ts, src/game/systems/sets.ts, card/pause UI hooks (small), tests/sets.test.ts.
