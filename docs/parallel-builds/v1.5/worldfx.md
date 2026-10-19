LANE: worldfx

Goal: the world feels alive and physical.
Build:
1. Animated surfaces: water (ripples, shoreline foam), lava (flowing, glowing, bubbling with occasional spurts), ice (glints/sparkle) where the biomes have them; add a few such patches to biomes that lack them only as decoration (another lane adds gameplay hazards; coordinate by keeping your patches purely visual and data-driven so hazards can reuse them).
2. Weather: rain (streaks + ground splashes + darker sky) as a weather type that can happen on meadow/peaks stages, with lightning flashes occasionally; plug into the existing weather in src/game/ambience.ts. Expose a rain intensity so the sound lane's ambienceAudio can follow (e.g. `ambience.rain` 0..1).
3. Soft smoke and dust: billowy smoke puffs after explosions (soft round sprites with fade), dust kicked up by dashes, landings, chargers and boss steps, sparks with gravity.
4. Debris: enemy deaths and broken things throw chunky debris pieces that bounce on the ground and settle, then fade (pooled InstancedMesh, cheap physics, no collisions with walls needed).
5. Footprints/scorch decals: short-lived scorch marks for explosions, footprints in sand/snow (pooled).
All cosmetic and local (computed per machine, no netcode), respecting quality and reduce-motion settings.
Owns: src/game/ambience.ts, src/game/particles.ts, src/game/fx.ts, new src/render/surfaces.ts, src/game/debris.ts, src/game/decals.ts, tests/worldfx.test.ts if logic.
