LANE: editor — build your own arena

An ARENA EDITOR (EXTRAS > ARENA EDITOR): players build a custom arena and play it or share it.
1. Editor: top-down view of a blank field in any biome look; a palette of pieces from the existing arena generator (cover blocks, rocks, trees, walls, crates, pillars, barrels, lava/ice/quicksand/thorn hazards, turrets, jump pads, conveyor belts, water ponds, spawn markers, a boss marker, chests), place/rotate/erase with mouse, keyboard or gamepad cursor, undo/redo, grid snap, size presets, a validity check (heroes can reach the boss marker; no blocked spawn).
2. Rules: pick the biome, enemy waves (preset mixes or custom list from the bestiary), stage time, boss (any boss incl. new ones), difficulty, modifiers (night, rain, wind, heat rules).
3. Play it solo or host it online (clients receive the arena data in the start message; keep the size small), with its own local best score.
4. Share: export as a short text code (compressed JSON + checksum, base64url) to paste to friends; import from a code; up to 20 saved arenas locally; validation rejects bad codes safely.
5. English + Arabic strings, tests (round-trip codes, validation, building colliders from the data), screenshots of the editor and a played custom arena.
Owns: new src/editor/*.ts, src/ui/editorScreen.ts, arena-from-data builder (new, reusing src/world/fieldArena.ts pieces), small hooks in extras/online start, tests/editor.test.ts.
