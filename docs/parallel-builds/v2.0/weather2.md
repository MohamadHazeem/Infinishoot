LANE: weather2 — weather that changes the fight

Weather is cosmetic today (rain, snow motes, lightning flashes; WEATHER setting). Make some weather events gameplay (host-authoritative, synced, telegraphed, fair):
1. SANDSTORM (dunes): visibility shrinks to a radius around each hero; enemies outside it appear as silhouettes only when close; gusts push bullets sideways; lasts ~45 s.
2. BLIZZARD (peaks): enemies slow down over time and slow ones freeze solid (shatter on hit); heroes standing still get chilled (slower) unless near a fire source (fire weapons, lava, a brazier pickup).
3. LIGHTNING STORM (meadow/neon): lightning strikes random spots with a ground warning; strikes hit everyone (heroes and enemies); shooting a lightning rod pickup redirects the next strikes onto the nearest enemies.
4. HEAT WAVE (magma): the ground shimmers, heroes slowly overheat when on dark tiles, cooling in water/shade; enemies on fire spread it faster.
5. Each is a stage event (src/data/stageEvents.ts style) with a banner, sound (existing ambience/samples or synthesized), HUD indicator, test links (&weather=sandstorm...), a WEATHER EFFECTS setting (gameplay weather on/off; the cosmetic WEATHER setting stays), English + Arabic strings, tests and screenshots.
Owns: new src/game/systems/weather2.ts, src/data/weather2.ts, event registration (additive), tests/weather2.test.ts.
