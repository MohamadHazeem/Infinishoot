# Gate 6 · Combat particles and breakage

Hits shed material-coloured fragments. Metal and shields throw narrow sparks, stone throws flat chips and slime drops spread at ground contact. Explosions send out shavings, then expanding dust and rising smoke. Broken cover, barrels, crates, toppled pillars and totems leave pieces of their own geometry and colour on the ground.

## Renderer and gameplay boundary

- One instanced indexed draw handles the transient cloud. Each 64-byte launch record supplies position/birth time, velocity/lifetime, size/acceleration/drag/silhouette and tint/opacity. HIGH draws ten quads from each record. One is larger and nine have distinct launch velocities. WebGL2 evaluates the trajectory in the vertex shader. WebGPU dispatches 64-thread workgroups on the active Three renderer’s device and reads the resulting centres and radii directly in the vertex stage. Both paths use the same generated equations for drag, gravity, two diminishing bounces and ground contact. CPU work consists of admissions, expiry and moving a surviving launch into a vacated slot. An advance without a spawn or expiry uploads zero launch bytes.
- The renderer lane selects the backend before constructing Game and marks its canvas with `data-backend="WebGPU"`. That marker loads the compute material and storage buffers lazily. The default renderer in this isolated checkout is WebGL2. A separate, real Three WebGPURenderer probe exercised the same particle entry point and captured the rendered output on Metal. Full-game WebGPU performance depends on integration with the renderer lane.
- The scene governor counts hostile bullets within 8 m of the local hero, stopping at 16. Pressure rises immediately and decays over time. Concurrent transient limits for POTATO / LOW / LOW+ / MEDIUM / HIGH are 96 / 480 / 3,600 / 10,080 / 20,480. A full nearby volley cuts the ceiling by 85%. At REDUCE FLASHING or OS reduced motion, a launch draws one core, the limit drops by another 65% and opacity is multiplied by 0.55. Friendly impact stars, rings and beams also share a live cap (8–56 across quality rungs). Shrinking warnings and danger-coloured rings keep reserved slots. Enemy core, rim and pattern passes retain orders 110–112 above the particle draw at 3. High-contrast cores stay white with dark ink. The final colour-vision palette covers the entire scene.
- Breaks still use the host's existing cover event and synced prop transitions. The local presentation keeps at most 260 ordinary pieces and 130 textured crate pieces. Each pool reuses its oldest slot. Sleeping stage pieces keep their last matrix and stop both physics and uploads. Stage replacement and disabling decorative world effects clear the piles. These meshes have no colliders. Existing VFX burst templates carry material, colour and direction once per event. No per-fragment network records or save fields were added.
- The perf fixture shares `&bench` with the crafting workbench. In the original checkout every `bench:real` stress link opened the shop before its first combat sample. The small additive guard at the end of `src/dev/testLinks.ts` keeps orbiting benchmark links in combat. The documented `craft=…&bench` link still opens the workbench. Both visual/performance builds include the guard.

## Reproduction and captures

Start a production preview. The six-second visual links share `?test&bench&circle&god&boom&seed=42&season=off&quality=high`. Append one of the suffixes below and `&lang=en` or `&lang=ar`. Each capture also triggered the same nearby gold chip/spark/puff burst through `game.vfx` 120 ms before the screenshot. The live bot, browser timing and random cosmetic samples give each capture a slightly different animation frame.

| Scene | Link suffix | Before/after pairs in `shots/g6-particles/` |
|---|---|---|
| Meadow with broken cover | `&day&stage=1&biome=meadow&smash=2&shatter=2` | `{before,after}-meadow-{1280,1920}-{en,ar}.png` |
| Rainy Neon City | `&night&biome=neon&stage=5&rain` | `{before,after}-night-{1280,1920}-{en,ar}.png` |
| Omega fight | `&stage=4&bossnow&nointro` | `{before,after}-boss-{1280,1920}-{en,ar}.png` |

Inspected all 24 PNGs at 1280×720 and 1920×1080. Fragments collect behind the hero marker in the meadow. Magenta shots remain outlined around the yellow bursts in the night scene. Omega’s red tell keeps its boundary through the effects. `compute.png` shows the standalone WebGPU draw of 20 chips and puffs from two records. The player-facing interface has no new strings.

## Files

- GPU implementation in `src/render/particlesGpu.ts`, `particlesShader.ts`, `particlesCompute.ts` and `particlesUpload.ts`. Emitters in `src/game/particles.ts` and `debris.ts`.
- Readability in `src/render/noiseGovernor.ts`, `src/game/systems/readability2.ts` and the effect pools in `src/game/fx.ts`. Persistent shatter in `src/render/shatter.ts` with a constructor option in `src/game/systems/graphics.ts`.
- Shared file edit in `src/dev/testLinks.ts` as described above. Tests in `tests/g6particles.test.ts`. This note records lane decisions. Screenshots and benchmark artifacts are ignored working files.

## Real GPU measurements

Managed headless Chromium 158, ANGLE Metal on Apple M5 Pro, production Vite preview. All frame costs are milliseconds. The production `bench:real` scene driver warmed each scene for two seconds and sampled five seconds. An additional 8 Hz census recorded submitted transient fragments. The original census adds live primary particles, puffs and sparks. The new census uses `particles.drawnCount`. Both exclude solid debris meshes and settled rubble.

The first original-build run at 1080p HIGH gave median counts of 87 / 85 / 68 in heavy / double / boss, each at 60.0 fps. The table uses a second original-build control on the same machine as the final matrix. The control loaded the original lane code from `84f42cc` with the benchmark-link fix.

| 1080p HIGH | Median fragments, before → after | CPU p95 | GPU p95 | Mean particle + scar render CPU | After FPS / frame p95 |
|---|---:|---:|---:|---:|---:|
| Heavy | 92 → 1,030 | 4.20 → 4.60 | 2.00 → 2.00 | 0.084 → 0.061 | 60.0 / 16.7 |
| Double horde | 87 → 1,080 | 4.20 → 4.40 | 2.27 → 2.37 | 0.078 → 0.057 | 60.0 / 16.8 |
| Omega | 64 → 730 | 3.30 → 3.20 | 1.05 → 1.32 | 0.053 → 0.026 | 60.0 / 16.7 |

The final double-horde sample had median populations of 337 enemies and 1,010 projectiles. HIGH produces exactly ten children per admitted launch. Differences in live emissions, expiry, the extra debris shavings and the original smoke pool explain why the measured whole-scene ratios are 11.2–12.4×. The frame GPU query covers the entire scene. The particle + scar phase is a CPU presentation timer.

## Gate 2 and compatibility

Fixed cohort of ten Normal Rookie starts, seeds 1–10, starter kit, no pet, season off, 180 ms reaction time, 4° aim error and 2,100 simulated seconds maximum. The original used a frozen bundle of the stock skillbot `--sample` entry point. The final build used `npm run skillbot -- --runs 10 --difficulty normal --seed 1 --jsdom` with its report redirected to a scratch working directory to preserve the historical Gate 2 data.

| Mortal skillbot | Stage 1 / 2 / 3 / 4 clears | Loop clear | Median stage | Mean game seconds | Incomplete |
|---|---|---:|---:|---:|---:|
| Original | 10 / 10 / 10 / 2 | 20% | 4 | 943.6 | 0 |
| Final | 10 / 9 / 7 / 6 | 60% | 4 | 1,027.3 | 1 |

Final clears were seeds 2, 3, 4, 6, 7 and 8. Seed 9 hit the simulation cap in the stage-2 portal and counts as a non-clear. The final sample reaches the top of the 40–60% target band. Each seed moves this result by ten percentage points. The jsdom harness seeds global Math.random, which visual construction and effects also consume. Individual fixed-seed trajectories changed. Gameplay tuning, hit timing, damage, save schema and effect packet types have no lane edits.

The managed offline two-player regression completed its lobby, combat, cover/prop, revive, reconnect, restart and kick checks. The client replayed 7,620 burst events on the final verification run. All four original invincible balance kits also cleared two stages within the existing 25% bounds. Stage-two cumulative kills were 11,933 / 14,146 / 13,237 / 12,670 for Buster / Laser / Scatter / Rail.

## Verification and remaining performance gate

| Check | Result |
|---|---|
| `npm run typecheck`, `npx vite build` | Both passed. |
| `npm test` | One full run passed all 143 files with four jobs. On the final repeat, 142/143 passed. The title-demo profile test failed its automatic retry. The lane tests passed, including pre-draw emissions, saturation, pressure, accessibility, threat ordering, sleeping rubble and co-op replay. |
| `npm run smoke` | Passed the whole-game smoke test, including local co-op, boss rush, tournament and mortal runs. |
| `npm run coop -- --offline`, `npm run balance` | The standalone Chromium process aborted at macOS Mach-port registration. Both stock test drivers passed using the managed headless browser. |
| `npm run skillbot` | Six of ten mortal Normal loops cleared on the final cohort. Full before/after data are in `shots/g6-particles/skillbot-{before,after}.json`. |
| `npm run bench:real -- --check` | The standalone launcher hit the same Mach-port restriction. The managed browser ran the 60 stock configurations and four cold loads. The official `--check --from-report shots/g6-particles/bench-after.json` exited 1. All 48 native-speed cases and all four loads passed. Seven of twelve LOW 4× CPU-throttled cases passed. |

The five LOW failures recurred in the original-code controls and on the final-build retry. The stock simulation p95 ceiling at 4× slowdown is 12 ms.

| LOW 4× scene | Control simulation p95, ms | Final retry simulation p95, ms | Retry fps |
|---|---:|---:|---:|
| 720p four players | 17.4 | 19.6 | 29.3 |
| 720p night | 12.7 | 12.1 | 38.3 |
| 1080p double horde | 12.8 | 13.0 | 42.1 |
| 1080p four players | 17.7 | 17.8 | 30.9 |
| 1080p night | 12.5 | 12.4 | 40.0 |

The four-player retries also missed frame-interval and callback CPU targets. The 720p retry fell below 30 fps. In the 1080p four-player retry, mean CPU cost per rendered frame was 0.030 ms in particle and effect simulation, 0.044 ms in particle and scar rendering, 2.59 ms in enemy simulation and 1.48 ms in weapons and specials. CDP separately measured 5.83 ms of style recalculation per frame. The full performance gate remains open. Raw scene timings, populations and load data are in `shots/g6-particles/bench-after.json`. `bench-controls.json` holds the original-renderer controls and the initial five misses before retry.

The intermittent `worldGame.test.ts` failure also reproduced in a bundle loaded from the original lane sources at `84f42cc`. A field-level comparison showed the title demo adding `hands-movement` and `perfectdash` to `save.tips`. The existing `teachMovement` in `src/game/systems/skill.ts` writes the tip marker directly during demo simulation. That gameplay/onboarding code is outside the particle lane. The same diagnostic subsequently passed on the final renderer. A standalone stock `npm test -- worldGame` recheck reproduced the failure.

The three lane-local verification servers were still listening on loopback ports 8067–8069 at the last check. The sandbox denied individual termination signals to those three processes.
