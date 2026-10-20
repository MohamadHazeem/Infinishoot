LANE: eightp — 8-player co-op

Raise the co-op cap from 4 to 8 players.
1. Netcode and lobby: up to 8 peers on the host (connection limits, invite/lobby list, colours/names for 8 players, ping/emote/pointers for 8), snapshot interest and size budget so 8 clients stay smooth (measure host CPU and bytes per client with 8 headless players; scripts/coop8.mjs `npm run coop8`).
2. Scaling: enemy count/HP/boss HP/loot/revive rules tuned for 5-8 players (bot runs), owned boss chests for 8, team meter and team moves for 8, revive pool for 8.
3. HUD for 8: compact teammate list, minimap markers, name tags that don't clutter; co-op framing camera that handles 8 spread out players (or a "follow me" mode).
4. Performance with 8 heroes: hero outlines/draw calls, particle LOD that scales with the number of heroes and effects, co-op aware audio mixing (8 players' weapons don't turn into noise: per-player weapon sounds thinned by distance and priority, your own weapons always clear).
5. Must still work for 2-4. npm run coop must pass and the new coop8 must pass.
Owns: player-cap constants and lobby limits (small edits), new src/game/systems/eightp.ts, HUD teammate list (small), particle LOD in a new src/render/lod.ts, mixing in src/audio/mix.ts (additive), scripts/coop8.mjs, tests/eightp.test.ts.
