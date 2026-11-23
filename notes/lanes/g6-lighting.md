# Gate 6 lighting and living arenas

WebGL2 gives heroes and enemies a painted edge highlight, soft contact shadows under nearby geometry, and biome-coloured mist. Rain and night bring the mist closer. Sunlight filters through the same clouds that shade the playfield. Broken ground, grass and water respond to the fight.

## Rendering decisions

- LOW+ enables a material rim on hero rigs and instanced enemies, including new enemy types and co-op heroes as they appear. The camera-facing edge and sun direction pick out armour facets. The shader applies the highlight before damage flashes and emissive eyes. Strength is 0.43 by day and 0.28 at full night.
- MEDIUM adds four opposing depth taps for contact AO, a one-pixel directional edge, and a world-space fog wash. Pairs of taps cancel a flat depth slope. Contact shading falls off within two metres and caps at 21%. The opaque bloom mask protects lit projectiles. Transparent telegraphs, hostile glyphs, particles and the HUD draw over this pass.
- HIGH samples two points along the view ray for soft shafts. Both samples project into the existing cloud map using the live cloud height and sun direction. Shaft strength caps at 0.12 and falls with rain, night and combat pressure. The nine base palettes blend with the current biome fog, including remix and sunset colours.
- The clear radius around the viewed hero is 11 m by day, 6.5 m at full night and 5 m in full night rain. Existing shot and lantern lights still illuminate terrain. The existing water renderer supplies rain puddles and reflected light. Combat weather, sight rules, damage, and collisions still use the host simulation.
- The WebGL2 effect uses the existing opaque depth and colour, one reusable internal-resolution RGBA target and two fullscreen triangles. LOW and POTATO skip the new draws and actor rim. LOW+ uses the material rim alone. The exported `StylisedLightPass.render(renderer, camera, target)` returns the shaded texture and restores the previous target. Renderer-owned files have no edits. The opt-in WebGPU path keeps its existing lighting.

## Arena presentation

- Meadow tufts follow the nearest walker inside 1.2 m. Two stored bend components keep the release in the original world direction even after the walker leaves. Attack and release use exponential rates of 20/s and 4/s. The existing 1,100-tuft pool and view culling still apply.
- Moving heroes retain their wading rings. LOW+ and above sample up to 48 projectile paths per 0.09 s at full density, round-robin, and emit at most three 0.4 s rings per sample. A swept intersection covers fast shots. Tests reject stationary shots and snapshot jumps over 8 m. Wakes use free slots in the existing 220-ring pool and follow the locally mirrored bullet pool on clients.
- Craters and scorch of radius 0.8 m or greater can leave two stage-long marks. Repeated impacts merge, radii cap at 3 m, and new sites recycle the oldest of 48 slots. They share one instanced draw with temporary splats. Expired splats drop out of the draw. The existing scar texture still supplies crater relief, heat and frost. Existing host cover breaks remove the collider and send the crater effect to peers. A fresh arena clears the marks. Late joiners receive the host’s broken cover list, while cosmetic marks accumulate from effects observed on each machine.

## Visual verification

Managed headless Chromium visited a production Vite preview for six seconds per capture. All twelve pairs were inspected. The meadow keeps distinct armour and grass, the neon rain keeps gunfire visible over puddles, and Omega’s rings draw across the lit floor. The same seed and camera settings still allow different combat animation frames. These are local visual checks. A blind player preference percentage was not measured.

Use `?test&bench&circle&seed=42&god&aim=0.7,0.7&season=off&quality=high&renderer=webgl`, then add the scene suffix, `&lang=en` or `&lang=ar`, and the indicated viewport. The original meadow capture included the inert `&clear` parameter. The explicit dry-weather override is `&dry`.

| Scene and suffix | 720p English | 720p Arabic | 1080p English | 1080p Arabic |
| --- | --- | --- | --- | --- |
| Meadow · `&stage=1&biome=meadow&day&clear` | [before](../../shots/g6-lighting/before-meadow-1280-en.png) / [after](../../shots/g6-lighting/after-meadow-1280-en.png) | [before](../../shots/g6-lighting/before-meadow-1280-ar.png) / [after](../../shots/g6-lighting/after-meadow-1280-ar.png) | [before](../../shots/g6-lighting/before-meadow-1920-en.png) / [after](../../shots/g6-lighting/after-meadow-1920-en.png) | [before](../../shots/g6-lighting/before-meadow-1920-ar.png) / [after](../../shots/g6-lighting/after-meadow-1920-ar.png) |
| Neon rain · `&stage=5&biome=neon&night&rain` | [before](../../shots/g6-lighting/before-night-1280-en.png) / [after](../../shots/g6-lighting/after-night-1280-en.png) | [before](../../shots/g6-lighting/before-night-1280-ar.png) / [after](../../shots/g6-lighting/after-night-1280-ar.png) | [before](../../shots/g6-lighting/before-night-1920-en.png) / [after](../../shots/g6-lighting/after-night-1920-en.png) | [before](../../shots/g6-lighting/before-night-1920-ar.png) / [after](../../shots/g6-lighting/after-night-1920-ar.png) |
| Omega · `&stage=4&bossnow&nointro` | [before](../../shots/g6-lighting/before-boss-1280-en.png) / [after](../../shots/g6-lighting/after-boss-1280-en.png) | [before](../../shots/g6-lighting/before-boss-1280-ar.png) / [after](../../shots/g6-lighting/after-boss-1280-ar.png) | [before](../../shots/g6-lighting/before-boss-1920-en.png) / [after](../../shots/g6-lighting/after-boss-1920-en.png) | [before](../../shots/g6-lighting/before-boss-1920-ar.png) / [after](../../shots/g6-lighting/after-boss-1920-ar.png) |

A frozen frame with the material rim toggled brightened 119 pixels near the hero and 113 near a nearby enemy in 23 × 23 internal-pixel samples, with zero GL errors. A live LOW → LOW+ → MEDIUM → HIGH switch across a viewport resize gave the expected draw and rim states. A pond check found seven projectile rings among nine live rings, plus seven persistent damage sites. Reproduce with `?test&seed=42&quality=high&stage=1&day&dry&at=water&aim=0,-1&scars=9&god&cam=0.8&renderer=webgl&season=off`. [Pond capture](../../shots/g6-lighting/pond-shots-scars.png)

## Mortal bot

Normal Rookie, seeds 1–10, starter kit, no pet, season off, 180 ms reaction, 4° aim error, 2,100 s cap. The stock skillbot ran against a frozen original source tree and the final code. Scratch output kept the tracked historical cohort intact.

| Build | Stage clear percentages (1–4) | Loop clears | Median stage | Mean game seconds | Capped |
| --- | --- | --- | --- | --- | --- |
| Before | 100 / 90 / 70 / 60 | 6/10 | 4 | 1027.3 | 1 |
| After | 100 / 90 / 70 / 60 | 6/10 | 4 | 1027.3 | 1 |

Every seeded result matched across builds after excluding CPU profiling times. A runtime capability check avoids importing the full WebGL renderer into headless simulation, which would consume 44 extra seeded RNG draws during module initialization. Each clear represents ten percentage points in this sample. [Original data](../../shots/g6-lighting/skill-before.json) · [Final data](../../shots/g6-lighting/skill-after.json)

## Performance

Apple M5 Pro, Metal, managed headless Chromium 158.0.4370.33. Both builds used the stock 60 WebGL2 configurations, both 1080p light stress rows, and the four cold loads. Each scene used a fresh context, two seconds of warm-up and five seconds of sampling. A timing failure received one isolated retry. The stock budgets and population checks were used throughout.

| HIGH scene | Before → after fps | Frame p95, ms | CPU p95, ms | GPU p95, ms |
| --- | ---: | ---: | ---: | ---: |
| 1280x720 heavy WebGL2 | 60.00 → 60.00 | 16.70 → 16.70 | 4.10 → 5.40 | 3.62 → 2.31 |
| 1280x720 double WebGL2 | 60.00 → 60.00 | 16.70 → 16.70 | 4.30 → 4.60 | 4.23 → 2.29 |
| 1920x1080 heavy WebGL2 | 60.00 → 60.00 | 16.70 → 16.80 | 4.50 → 5.00 | 2.44 → 2.19 |
| 1920x1080 double WebGL2 | 60.00 → 60.00 | 16.80 → 16.80 | 4.50 → 4.90 | 2.45 → 3.05 |
| 1920x1080 boss WebGL2 | 60.00 → 60.00 | 16.70 → 16.70 | 3.40 → 3.30 | 1.61 → 1.23 |
| 1920x1080 night WebGL2 | 60.00 → 60.00 | 16.70 → 16.70 | 4.90 → 4.50 | 3.10 → 1.95 |
| 1920x1080 lights webgl | 60.00 → 60.00 | 16.70 → 16.70 | 5.60 → 4.70 | 2.36 → 1.94 |
| 1920x1080 lights webgpu | 55.65 → 59.40 | 16.70 → 16.80 | 6.70 → 6.20 | 5.18 → 6.09 |

The stock gate passed 55/62 scene configurations before and 57/62 after. Both builds passed all 48 native-speed WebGL2 matrix scenes, the additional WebGL2 light stress and all four cold loads. Each remaining failing configuration also missed at least one budget on the original build. At 1080p the final WebGL2 light stress held 60.00 fps with medians of 335 enemies, 1020 projectiles and 1021 local lights.

| Final miss after retry | Simulation p95, ms (before → after) | Frame p95, ms (before → after) | Final fps | Budgets missed |
| --- | ---: | ---: | ---: | --- |
| 1280x720 WebGL2 low 4× double | 14.30 → 13.60 | 33.40 → 33.40 | 38.47 | simulation p95 |
| 1280x720 WebGL2 low 4× team | 19.50 → 19.40 | 50.00 → 50.00 | 27.80 | sustained fps, frame interval p95, frame interval p99, simulation p95, main callback CPU p95 |
| 1280x720 WebGL2 low 4× night | 12.90 → 14.20 | 33.40 → 33.40 | 36.48 | simulation p95 |
| 1920x1080 WebGL2 low 4× team | 19.00 → 20.30 | 50.00 → 50.00 | 29.30 | sustained fps, frame interval p95, frame interval p99, simulation p95, main callback CPU p95 |
| 1920x1080 WebGL2 low 4× night | 12.40 → 13.90 | 33.40 → 33.40 | 35.88 | simulation p95 |

The 4× CPU-throttled 1080p four-hero retry spent 2.54 ms/frame on enemy simulation and 1.57 ms/frame on weapons and specials. Ambience took 0.07 ms/frame and particles plus scars took 0.08 ms/frame. LOW skips the new lighting draws and projectile wakes. The overall performance gate remains open.

[Original full matrix](../../shots/g6-lighting/bench-before.md) · [Final full matrix](../../shots/g6-lighting/bench-after.md) · [Original timings](../../shots/g6-lighting/bench-before.json) · [Final timings](../../shots/g6-lighting/bench-after.json)

## Changed files and checks

- New renderer module `src/render/stylisedLight.ts`. Arena and water presentation live in `src/game/ambience.ts`, `src/game/scars.ts` and `src/render/surfaces.ts`. New tests live in `tests/g6lighting.test.ts`. This lane note records the handoff.
- Shared edit in `src/game/game.ts` adds one constructor line connecting the existing bullet pool to surface presentation. The lane introduces no UI strings, storage keys, snapshots or effect packet types.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npx vite build` | Passed. |
| `TEST_JOBS=4 npm test` | Passed all 145 test files. |
| `npm run smoke` | Passed all modes. |
| `npm run coop -- --offline` | Shell Chromium launch blocked. The stock offline two-peer scenario passed in managed headless Chromium, including HIGH on both peers, reconnect, restart and lobby kick. [Co-op log](../../shots/g6-lighting/coop-high.log) |
| `npm run balance` | Shell Chromium launch blocked. All four invincible kits passed the stock tolerance in managed Chromium. [Balance log](../../shots/g6-lighting/balance-managed-final.log) |
| `npm run skillbot -- --runs 10 --seed 1 --difficulty normal` | Passed. Both mortal cohorts cleared 60% of loops. |
| `npm run shot` | Shell Chromium launch blocked. Captured and inspected 24 images at matching settings through managed headless Playwright. |
| `npm run bench:real -- --check` | Failed before and after. Shell Chromium launch blocked. The stock scene and load measurements ran on managed Chromium, and the CLI evaluated both full reports with `--from-report`. |

The shell browser failed at local Chromium startup under the macOS sandbox. Managed runs used hardware Metal and loopback Vite previews. Local images, logs and timing data are under `shots/g6-lighting/`. All work is uncommitted.
