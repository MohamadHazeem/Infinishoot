LANE: weapons3 — new weapons

1. Four new AUTO weapons, each with a partner-item evolution and visible levels, distinct visuals and sound, tags that open new Mod synergies: e.g. BOOMERANG BLADES (return path hits twice), TESLA COIL turret you drop (chains between coils), SWARM MISSILES (tiny homing missiles in a wave), PRISM SHARDS (bouncing crystals that split). Your call on exact designs; make them fun and different from the existing 15+.
2. Two new LOADOUT items with full upgrade trees (3 tracks x 4 ranks, a two-way evolution fork, Overdrive), per CLAUDE.md: one left click (e.g. a FLAK BURST or a beam-whip) and one right click (e.g. a deployable SENTRY or a grappling HOOK that yanks you to enemies). Unlocks through achievements.
3. Icons (scripts/icons.mjs, bold silhouettes, no reused icons), stems for the music (src/audio/stems.ts), material/feel data (WEAPON_FEEL), fusion recipes where sensible (src/data/fusions.ts), arsenal entries, co-op net()/setNet(), bullet colours in codec BULLET_COLORS, bullet kinds appended at the end of BULLET_KINDS.
4. Balance with the bot: in the same DPS band as comparable weapons (record numbers).
Owns: new weapon classes in src/game/weapons/, src/data/weapons.ts + tracks.ts (additive), icons, tests/weapons3.test.ts.
