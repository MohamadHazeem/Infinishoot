# Lane: postfx (lighting and post-processing look pass)

## What players get
- **Dynamic light.** Explosions, sparks, muzzle flashes, bullets, burning and shocked enemies, lava pools, closed chests, the portal and modded elites light the ground and nearby enemies. Up to 16 lights per frame (by quality), banded like the cel shading so the light pools look PS1-ish, with a hue-keeping cap so piles of lights don't blow out to white.
- **Night stages.** Every 3rd arena stage (3, 6, 9, ...) is at night: a moonlit, biome-tinted dark ambient, dark fog, a warm lantern around every hero, glowing yellow enemy eyes, a cooler grade and a soft vignette. Shots and explosions light the dark, enemy bullets glow on the ground as they come in. Toggle: SETTINGS > NIGHT STAGES.
- **Outlines.** A crisp 1-pixel dark outline on enemies, barrels and heroes (thickness in internal pixels, so it stays one pixel at any distance and resolution). Elites get a thicker outline in their glow colour (gold, or their modifier colour; red while winding up).
- **Shockwaves and heat.** Big blasts (explosions, bombs, Nuke, boss slams, portal) push a ripple across the screen; lava shimmers. Toggle: SETTINGS > SHOCKWAVES (also off when SCREEN SHAKE is 0; halved with REDUCE FLASHING).
- **Bloom and grading.** Real half-resolution bloom, but only on self-lit things (bullets, lava, sparks, flashes, night eyes) via an emissive mask, so bright sand and snow stay crisp. Each biome has a gentle lift/gamma/gain grade (meadow fresh, dunes warm shadows, peaks cool, magma hot), eased between areas.
- **AUTO quality** (new default): measures frame times while playing and steps quality down/up to hold 60 fps. SETTINGS > QUALITY now reads LOW / MEDIUM / HIGH / AUTO.

## Key numbers / tuning (all live in the debug panel, folder "Lights & post")
- Quality ladder (`QUALITY_LEVELS`, src/render/quality.ts): LOW 216p, 4 lights, no glow/distortion, particles x0.5 | LOW+ 240p, 6 lights, cheap glow | MEDIUM 270p, 10 lights, bloom | HIGH 360p, 16 lights. Manual LOW/MEDIUM/HIGH = rungs 0/2/3 (same resolutions as before). AUTO starts on MEDIUM.
- Governor (`governorTuning`): 0.5 s windows; down after 3 bad windows (avg > 19 ms or > 20% frames over 26 ms); up after 8 s of windows under 17.6 ms; 3 s warm-up and 2 s cooldown after every change; frames > 200 ms ignored; a rung that fails within 10 s of stepping up is blocked 20 s, doubling to 240 s. Only samples while playing (not paused, no menu, tab visible).
- Lights (`lightTuning`, `lookTuning`): day scale 0.55, night 1.15, light cap 0.9; lantern r 10 m, 0.75; muzzle r 4.5 m; bullets merge per 5 m grid cell; flashes from rings >= 1.2 m final radius, shockwaves from rings >= 3 m.
- Post (`postfxTuning`): shockwave 5 px push (scaled with resolution), heat 0.9 px, bloom threshold 0.35 on the emissive mask, strength x1.1 of the GLOW setting; night vignette 0.45.
- Measured in headless Chromium (SwiftShader, software GL, 1280x720): ~56 fps on AUTO/MEDIUM with ~110 draw calls; AUTO held MEDIUM there. Outlines cost one draw per enemy type and ~26 per hero (one hull per rig part).

## How it works (for maintainers)
- `src/game/systems/look.ts` (`Game.updateLook`, called at the end of `render()`) gathers lights, shockwaves, heat spots and night/grade every frame. It is purely cosmetic and local: lights come from state every machine already has (bullets, enemies, arena hazards, `Fx.ring/star`, which the effects bus replays on clients). `Fx.ring` / `Fx.star` are wrapped at runtime (no edit to fx.ts) so every ring/star can also flash a light or start a shockwave.
- `src/render/lights.ts`: allocation-free `LightPicker` (candidates, grid-merged small emitters, timed flashes, top-N with a soft fade at the budget cut) writing packed uniforms that every retro material shares via `retroGlobals`.
- `src/render/retroMaterial.ts`: per-pixel light loop (world pos/normal varyings), night eyes (pure-white vertex colours on instance-flash meshes glow when `uNight` > 0), faint self-glow (unlit < 0.5: water, ice, belts) dims at night, and opaque materials write a glow mask into alpha for the bloom pass.
- `src/render/outlines.ts`: inverted hull pushed out in clip space. Instanced meshes with `instanceFlash` get a second material through two full-range geometry groups (shares the instance buffers); hero rigs get a hull child per part. Elites are detected by instance scale >= 1.3 (elites are drawn 1.6x).
- `src/render/postfx.ts` + `renderer.ts`: scene -> (bright pass + separable 9-tap blur at half res) -> composite (distortion, glow, grade, saturation, dither, CRT).
- `src/render/biomeLook.ts`: night blended over day/dusk; per-biome grades; `isNightStage(arenaStage)`.
- Settings: `graphics` (0..3, 3 = AUTO; replaces the old `quality` field, which is kept for old saves), `distortion`, `nightStages`. Old saves default to AUTO.

## Files touched
- New: src/render/quality.ts, lights.ts, outlines.ts, postfx.ts; src/game/systems/look.ts; src/ui/debugLook.ts; tests/postfx.test.ts; notes/lanes/postfx.md.
- Owned, rewritten/extended: src/render/renderer.ts, retroMaterial.ts, biomeLook.ts.
- Small additive edits in shared files: src/game/game.ts (import + `updateLook` install, 2 lines), src/game/systems/render.ts (one call), src/game/settings.ts (quality ladder, auto, 3 fields), src/game/particles.ts (density multiplier, 2 lines), src/main.ts (auto-quality tick, FPS overlay line), src/ui/screens.ts (QUALITY slider 0..3 with a value label, two toggles, `rangeLabel` helper), src/style.css (value label colour), src/ui/debugPanel.ts (one folder call), src/dev/testLinks.ts.

## New test-link options
- `&night` / `&day`: force a night or day stage.
- `&quality=low|medium|high|auto`: pin quality (use `&quality=high` for screenshots; headless SwiftShader is slow enough that AUTO may step down).
- `&boom`: an explosion near the hero every 0.7 s (checks lights, bloom, shockwaves).
- `&fps`: FPS overlay, which now also shows the live quality rung and internal resolution.
- `&screen=<name>`: open a menu screen on top (e.g. `&screen=settings`).

## Decision-log paragraph for PLAN.md
- 2026-10-19: Look pass (postfx lane). Dynamic point lights (max 16, per pixel at the internal resolution, banded, hue-keeping cap), night stages every 3rd arena stage (lanterns, glowing eyes, night grade), screen-pixel inverted-hull outlines (elites coloured), shockwave/heat distortion, emissive-mask bloom and per-biome grading. Everything is derived locally from synced state and the effects bus, so co-op needs no new messages. Quality got an AUTO mode (default) with a frame-time governor and back-off hysteresis over a 4-rung ladder (216p/4 lights to 360p/16 lights). Lights are per pixel rather than per vertex because the ground is 2 m tiles (vertex lighting made blocky pools); at 270p that is cheap.

## Unfinished / risks
- Lights are per-pixel, not per-vertex as the brief suggested (ground tiles are 2 m quads, so vertex light pools looked blocky). Cost is bounded by the light budget and the low internal resolution; AUTO drops lights and resolution on weak GPUs. Not profiled on a real low-end iGPU.
- `Fx.ring` / `Fx.star` are monkey-patched at runtime from look.ts. If another lane renames or changes their signatures, flashes/shockwaves silently stop (typecheck will catch signature changes).
- Elite outline detection relies on elites being drawn at instance scale >= 1.3 (`e.scale` 1.6). If elite scaling changes, adjust `outlineTuning.eliteScale`.
- Night eyes glow on any pure-white vertex colour of instance-flash meshes (enemy eyes, the Blaster Bot visor, barrel white trim if any).
- Hero outlines add ~26 draw calls per hero (one per rig part); 4-player co-op adds ~100 draws. Fine on desktop GPUs; could merge or drop if needed.
- Light swaps at the budget cut are softened (half intensity at the cut) but can still pop slightly in huge fights on LOW (4 lights).
- AUTO on a 30 Hz-capped browser (battery saver) will settle on LOW.
