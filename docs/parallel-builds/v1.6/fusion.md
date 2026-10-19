LANE: fusion

Goal: weapon fusion — combine two maxed weapons into a hybrid.
1. When the hero holds two compatible weapons at max level (including evolved), a FUSION offer can appear in level-ups/chests (or a fusion altar spawns): fusing removes both and grants a hybrid weapon with combined behaviour, e.g. Drones + Lightning = Storm Drones (drones that chain lightning), Missiles + Fire = Napalm Rockets, Discs + Frost = Ice Saws, Aura + Nova = Supernova Field, Mines + Lightning = Tesla Traps, Laser + Drones = Prism Satellites, Scatter + Fire = Dragon Cannon... design ~10 fusions covering all weapons at least once, each with unique visuals and sound (sample 'fusion' for the event).
2. Data-driven (new src/data/fusions.ts), weapons implemented as classes under src/game/weapons/ (reuse existing weapon behaviours where possible), tags for Mods synergy, icons (src/data/iconArt.ts / ui/pixelIcons.ts), a FUSION section in the codex/bestiary-style list if easy, a big fusion moment (flash, both icons merging, banner).
3. Co-op sync and test links (`&weapons=drones:6,lightning:6&fuse`), balance: a fusion is stronger than the two parts but frees a weapon slot.
Owns: src/data/fusions.ts, new weapon files, src/data/weapons.ts (additive), level-up offer hooks (systems/levelUps.ts, small), icons, tests/fusion.test.ts.
