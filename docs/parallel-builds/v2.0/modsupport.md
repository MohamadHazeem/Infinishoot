LANE: modsupport — player-made content

1. JSON mods: a mods folder (desktop: next to the save in the user data dir; web: import a .json/.zip from SETTINGS > MODS) whose files can add or override weapons (built from existing weapon behaviours with new params/colours), enemies (existing behaviours/models with new stats/colours), relics, Mods (from existing hook templates), biomes (palette/props) and stage events; strict schema validation with clear error messages; mods are disabled in online play unless every player has the same mod set (hash check in the lobby).
2. A MODS screen to enable/disable, with load order and errors shown; an example mod in docs/mods/ and a guide docs/MODDING.md.
3. Tests for validation and loading.
Owns: new src/mods/*.ts, src/ui/modsScreen.ts, docs/MODDING.md, docs/mods/example.json, small hooks where data is registered, tests/modsupport.test.ts.
