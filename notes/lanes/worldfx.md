# Lane: worldfx (the world feels alive and physical)

All of it is cosmetic and local: every machine computes it from what it already has (the stage seed, the synced heroes and enemies, effects-bus bursts). No new netcode, no codec change.

## What players see
- **Water.** Meadow stages get 4 ponds and dunes stages 3 oasis ponds, as decoration only (you can walk through them). The water scrolls, foam laps at the edge, ripples appear on the surface, the meadow ponds have lily pads, and heroes wading through leave ripples. The island shoreline gets foam where it meets a water sea.
- **Lava.** Magma pools get bright flowing veins over the existing lava, a warm glow on the ground around them, dark crust bubbles that swell and pop into sparks, and a spurt every 2.5-6 s (lava blobs, sparks, a puff of smoke, a ring). The lava sea has a glowing rim at the island's edge.
- **Ice.** Frozen ponds glint with blue-outlined twinkles, and the snow on Frosty Peaks sparkles here and there.
- **Rain.** About 35% of meadow stages and 30% of peaks stages are rainy, rolled from the stage seed so co-op machines agree. Rain fades in over 4 s and swells and eases over the stage. It brings slanted streaks, small splash rings where drops land, extra ripples on ponds and a darker sky (sun -60%, bluer sky and fog). In heavy rain, lightning flashes the world every 7-18 s.
- **Smoke.** Explosions (blasts, barrels, Ka-Boomers, boss death chains, meteor strikes) leave soft round cartoon puffs that drift out, rise, swell and fade over 1.4-2.4 s. Small blasts that don't already leave a long scar get a short scorch mark (5 s).
- **Dust.** Puffs of dust come from a dash starting (plus a trail behind it), landings (King Bopper and Omega slams, any hop), charging Rhinos and Rex/Omega charges (trail), boss footsteps, slams (`dust` on the slam burst) and some hero steps on dunes. The dust is tinted per biome: sand, snow powder or ash.
- **Sparks.** Glowing dots that arc, bounce and burn out, from blasts, Ka-Boomers, boss explosions and lava.
- **Debris.** Every kill throws chunky pieces in the enemy's own colours: 1 for swarm enemies, 3 for heavier ones (xp >= 3), 12 for elites and bosses, 14 for the final boss blast. Barrels throw 7 red and yellow pieces. Pieces tumble, bounce (42% of their fall speed), slide, tip onto a flat face, rest for 2.6-4 s, then sink and shrink away.
- **Footprints.** On dunes and peaks, heroes leave alternating boot prints every 0.85 m (none while dashing) and bosses leave big prints with every stride. Prints fade after 6 s (8 s for bosses).

## Settings respected
- QUALITY: on Low (ambience 0.35), smoke, dust, sparks and debris counts are halved and surface animation slows. Rain density follows the existing ambience scale.
- REDUCE FLASHING: lightning becomes one faint, smooth glow (10% instead of 80%, no flicker).
- prefers-reduced-motion: no lightning at all.
- Nothing here touches shake, hit-stop or sound.

## Key numbers (tunable)
- `rainTuning` (ambience.ts): chance meadow 0.35 / peaks 0.3, fadeIn 4 s, dark 0.6, bolt 7-18 s, flash 0.8, flashReduced 0.1.
- `worldFxTuning` (particles.ts): smokeLife 1.4-2.4 s, smokeRise 1.1, dustLife 0.45-0.85 s, sparkGravity 24, amount (quality multiplier).
- `debrisTuning` (debris.ts): max 300 (ring buffer), gravity 26, bounce 0.42, friction 7, life 2.6 + 0-1.4 s, sink 0.6 s.
- `decalTuning` (decals.ts): max 260, footprints 6 s at alpha 0.5, scorch 5 s at alpha 0.4.
- `surfaceTuning` (render/surfaces.ts): ponds per biome, rippleEvery 0.5 s, bubbleEvery 0.35 s, spurtEvery 2.5-6 s, glintsPerM2 0.22, near 34 m (patches farther from the camera aren't animated).
- `worldDustTuning` (systems/worldFx.ts): stride 0.85 m, trailEvery 0.045 s, footSize 0.6 m.
- All of these are in the debug panel under **World FX**. The panel also has a rain toggle and the weather force for the next stages.
- Pools: puffs 420, sparks 320, ripples 220, glints 120, lava bubbles 48, lava glows 64. Each pool is one draw call: 8 new draw calls in all, plus up to 6 merged surface meshes per stage.
- Measured in headless Chromium with every pool full (300 debris, 420 puffs, 320 sparks, rain on): Ambience.render 0.10 ms/frame, Particles.render 0.09 ms/frame, Particles.update 0.11 ms per step, worldFx 0.003 ms. Nothing allocates per frame.

## How it hooks in (files touched)
- New: `src/render/surfaces.ts`, `src/game/debris.ts`, `src/game/decals.ts`, `src/game/systems/worldFx.ts`, `tests/worldfx.test.ts`.
- Owned and changed: `src/game/fx.ts` (`SpritePool`, `pixelTexture`, `spriteTextures`), `src/game/particles.ts` (`SoftFx`, the new BurstOptions fields, owns debris and decals), `src/game/ambience.ts` (rain, lightning, sky tint, owns `Surfaces`).
- Shared files, small edits:
  - `game.ts`: one import and `worldFx = WorldFxSys.worldFx`.
  - `systems/render.ts`: `this.worldFx(frameDt)` right after `updateSky`, because the sky tint has to come after the time-of-day light.
  - `systems/statuses.ts` and `systems/combat.ts`: extra fields on existing burst literals (`debris`, `smoke`, `sparks`, `dust`, `scorch`).
  - `dev/testLinks.ts`: the new options.
  - `ui/debugPanel.ts`: the World FX folder.
- **Effects bus:** the new fields ride on existing `'b'` burst events (JSON), so clients replay smoke, debris and sparks with no protocol change. A kill's event grows by about 10 bytes; no new events were added.
- **Derived locally:** dust, footprints, rain, lightning and surfaces come from synced state on each machine (`this.enemies.list` is mirrored on clients, and the rain roll comes from the stage seed).

## For other lanes
- **Hazards lane:** surfaces are data. `ambience.surfaces.patches` lists every `SurfacePatch {x, z, r, kind: 'water'|'lava'|'ice', decor?}` on the stage: the arena's hazards plus the decorative ponds. `decorPatches(biomeId, seed, halfSize, blocked, avoid)` is pure and deterministic, and `inPatch(patches, x, z, kind)` finds the patch under a point. Any `arena.hazards` entry of kind lava, ice or water gets the animated look automatically. A new lava hazard outside Magma Isle still needs a base pool mesh in fieldArena; Surfaces only adds the overlay, glow and bubbles.
- **Sound lane:** read `game.ambience.rain` (0..1) for the rain loop volume. `game.ambience.strikes` goes up by one per lightning strike, and `game.ambience.strikeDist` (0 = overhead, 1 = far) is for thunder delay and volume. `game.ambience.raining` says whether this stage rains at all.

## Test links
- `&rain`: force rain (meadow and peaks; never on magma). `&dry`: never rain.
- `&at=water`, `&at=lava`, `&at=ice`: start next to the first patch of that kind. `&at=x,z`: start at a position.
- Examples: `?test&stage=1&god&rain&at=water`, `?test&stage=4&god&at=lava`, `?test&stage=3&god&dry&at=ice`, `?test&stage=1&god&at=0,52` (shoreline).

## Unfinished or risky
- **Scars look heavy.** The long-lived scorch scars from blasts of radius 1.2 or more (scars.ts, not this lane) stay 10 s at 0.8 opacity. With maxed mines and missiles they cover a lot of ground. I didn't change them; my short scorch marks only cover the smaller blasts.
- **Rain ignores co-op host time.** Rain intensity and lightning timing are per machine (only whether a stage rains is shared). Lightning won't flash at the same moment for every player, which is fine for something cosmetic.
- **Pond placement.** Ponds avoid walls, hazards and the start area, but a timed chest or a conveyor (stage 2+) can still land in a pond. It only looks odd, nothing breaks.
- **Debris on swarm kills.** Each swarm kill throws one debris piece. With 300+ kills a minute the 300-piece ring buffer recycles quickly, so the oldest pieces vanish early. That's harmless, but the cap can be lowered or raised in `debrisTuning.max`.
- **No new settings toggle.** Lightning follows the existing REDUCE FLASHING setting. If players find rain too busy, a WEATHER on/off setting would be a small follow-up in settings.ts/screens.ts (not done, to keep those shared files untouched).

## PLAN.md decision-log paragraph (for the lead to paste)
- 2026-10-19: World FX lane. The world reacts more: decorative ponds (meadow, dunes) with foam, ripples and lily pads; churning, glowing, bubbling and spurting lava; glinting ice and snow; seeded rain on about a third of meadow and peaks stages (streaks, splashes, darker sky, lightning that respects REDUCE FLASHING); soft smoke after explosions; dust from dashes, slams, charges and boss steps; bright sparks; chunky debris from every kill and barrel that bounces and settles; footprints in sand and snow; short scorch marks under small blasts. Everything is cosmetic and per machine. Burst events gained optional `smoke`/`debris`/`sparks`/`dust`/`scorch` fields, so clients replay them with no protocol change; the rest is derived from synced state (systems/worldFx.ts). Surfaces are plain `SurfacePatch` data so hazards can reuse them. CPU cost with every pool full is about 0.3 ms a frame, and the change adds 8 instanced draw calls.
