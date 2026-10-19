LANE: arena

Goal: the arena is something to play with.
Build:
1. Interactives on the procedural field (seeded, few per stage): automated turrets the player can activate (walk into a pad, it fights for 20 s), jump pads (launch the player in an arc over enemies with i-frames, landing shockwave), breakable cover (crates/walls take damage and break, debris), and existing explosive barrels that chain-react nicely.
2. Environmental kills: hazard zones per biome (magma: lava pools; peaks: ice patches where enemies slide; dunes: quicksand that slows; meadow: thorn bushes) — knocking enemies into lava kills them with bonus score; falling cover (tall pillars that can be shot down to crush enemies); barrels chain. Show "ENVIRONMENTAL KILL" bonus popups.
3. Stage objectives: each stage offers an optional objective (e.g. "Destroy 3 totems", "Defend the beacon for 30 s", "Collect 5 relic shards", "Kill 20 enemies with environment") with a small HUD tracker and a reward chest/gold on completion.
4. Everything seeded (same seed = same stage), host-authoritative and synced to clients in co-op.
Owns: src/world/fieldArena.ts, src/world/collision.ts, src/game/barrels.ts, new src/game/interactives.ts, src/game/objectives.ts, src/game/hazards.ts, a new system file, objective HUD widget in a new src/ui/objectiveHud.ts, tests/arena.test.ts.
