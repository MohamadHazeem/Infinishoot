LANE: halloween — seasonal events (first one: Halloween)

1. A seasonal event system (src/data/seasons.ts): date windows (Halloween: Oct 15 - Nov 7), forced on with &season=halloween; while active the title gets a themed look and a banner, and runs get the seasonal content; easy to add Christmas/summer later.
2. Halloween content:
   - "Haunted" remix of a biome (night, fog, jack-o'-lantern props, candles, cobwebs, purple-orange grade) used for one stage per loop while the event is on.
   - Enemies: pumpkin heads (burst into seeds), ghosts (phase through walls, fade in/out), bats swarm, witch elite (cauldron AoE).
   - Boss PUMPKING: a giant pumpkin king; seed volleys, vine grabs, summons pumpkins, carving-knife spin, 3 phases; portrait, finisher, codex entry.
   - Candy currency picked up during the event: spend in a TRICK-OR-TREAT stand for limited cosmetics (pumpkin helmet, bat pet, ghost trail) kept forever.
   - Halloween music variant (spooky organ/theremin flavour in the composition data) and ambience.
3. Recorded audio ready: roar_pumpking, boss_pumpking_intro/phase/defeat, pumpkin_squish, witch_cackle, ghost_wail, spooky_sting, bats, amb_halloween, vo_halloween.
4. Co-op sync, tests, screenshots of everything.
Owns: new src/data/seasons.ts, src/game/systems/halloween.ts, new enemy entries (additive), biome remix entry (additive), cosmetics data (additive), tests/halloween.test.ts.
