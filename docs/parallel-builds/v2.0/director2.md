LANE: director2 — a smarter run

1. Adaptive director: watches how the team is doing (HP, damage taken per minute, kill speed, deaths, near-deaths) and adjusts pacing within limits: a short breather after a near-death, more pressure when cruising, never touching boss HP; respects difficulty; visible only through feel (debug panel shows the pressure value). Bot runs before/after to prove it smooths difficulty spikes without making the game easier overall.
2. More events: 6 new stage events (e.g. Meteor Garden, Robot Rebellion where enemies fight each other, Gravity Storm, Treasure Goblin Parade, Blackout, Turret Party), each with a banner, sound and rewards; co-op synced.
3. More relics: 12 new rule-bending relics (rarity, icons, pause/shop display).
4. Three new regular enemy types filling gaps (e.g. a shield-carrier that protects others, a teleporting sniper, a bomb-carrying kamikaze runner) with models, telegraphs, materials, gaits, codex.
Owns: src/game/director.ts (careful), new src/game/systems/director2.ts, src/data/stageEvents.ts + relics.ts + enemies.ts (additive), tests/director2.test.ts.
