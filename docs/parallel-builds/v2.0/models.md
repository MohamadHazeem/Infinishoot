LANE: models — characters that look the part

1. Hero models upgrade (src/game/heroModel.ts): more detail within the chunky low-poly Mega Man Legends style: better proportions, layered armour plates, visor/eyes, boots and gloves shapes, per-hero silhouettes (Bulwark broad, Dash slim with scarf, Ace with antenna, Duelist cape, Furnace backpack furnace, Twin mirrored colours, and the new Ronin/Tinker if present in data) while keeping skins/customisation/animation working.
2. Enemy variety: per-biome skins for regular enemies (tints + small accessories per biome: snow caps on peaks, neon trims in Neon City, toy paint in Toy Factory...), keep instancing (one draw call per type, use instance colours/attributes).
3. Boss models upgrade for King Bopper, Rex, Queen and Omega to match the finisher portraits (more parts, glowing cores, phase damage states: cracks/sparks as HP drops).
4. Screenshots before/after of every hero, boss and biome skin; bench numbers must stay in range.
Owns: src/game/heroModel.ts, enemy/boss mesh builders in src/game/enemies.ts (mesh parts only, careful), new src/render/biomeSkins.ts, tests/models.test.ts.
