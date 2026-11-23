# Gate 6 renderer and local lights

## What players get

Auto selects Three.js WebGPU when a device initializes. WebGL2 handles machines without a usable WebGPU device. Settings → Video → Advanced offers Auto, WebGPU and WebGL. Restarting applies the saved preference. Settings → Help reports the active backend, including after a fallback. The new labels and explanations support English and Arabic.

MEDIUM and HIGH light nearby surfaces from individual projectiles and explosions. LOW+ and LOW use the previous light picker. POTATO keeps its zero-light budget. Existing telegraphs, damage timing, hit detection and host authority come from the same simulation. The light inputs follow the existing local projectile pool and the explosion effects played on each peer.

## Decisions

- Build TSL nodes once per material/object from the shipped GLSL3 stages, including their final shader patches. Three's GLSL decoder provides the syntax tree. Both paths consume the same uniforms, textures, instancing data and post settings. This covers vertex snap, affine interpolation, per-area fog, color quantization, ordered dither, glow, distortion and CRT.
- Load Three's WebGPU renderer and TSL translator only after acquiring an adapter. Initialize on a candidate canvas so a failed device can still start the original WebGL2 pipeline. Settings use the existing normalized store.
- Rank lights in 32 × 32 world-space XZ tiles. The grid anchor advances in whole tiles. Each tile retains the four strongest local candidates. A 64 × 56 RGBA float texture stores tile indices and the position, radius and intensity-scaled RGB of up to 1,280 emitters. It reuses 56 KiB of upload data. Pixel lighting uses 3D distance, normals, day/night scaling and the existing hue-preserving brightness cap. Flashes enter the pool ahead of the projectile stream.
- Preserve the global selection for water, atmosphere and LOW. The existing quality ladder selects the path each frame. Cluster collection starts only once a renderer exists.
- A single production benchmark link sustains friendly, alternating cyan/gold projectiles. In the older benchmark links, `bench` also acquired a crafting-screen meaning after Gate 5. Combat links containing `circle` now preserve the fight. Standalone workbench links still open crafting. The original 60 WebGL2 runs keep their existing presets, thresholds and combat populations. Two further 1080p HIGH runs require the requested backend and median populations of at least 300 enemies, 1,000 friendly projectiles and 1,000 local lights.

## Performance and gameplay

Apple M5 Pro, managed headless Chromium, Metal, Vite production preview. Fresh browser contexts, 2 s warm-up, 5 s samples, one GPU timestamp every eighth frame. HIGH presents at 1920 × 1080 with the existing 360-line internal target. Before uses revision `e07d5d1` plus the same combat-link fix and population fixture.

| Version | Median enemies | Median player shots / all shots | Median local lights | FPS | Frame median / p95 / p99, ms | CPU p95, ms | GPU p95, ms | Missed refreshes |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| Original WebGL2 | 338 | 1020 / 1021 | Legacy picker | 60.0 | 16.7 / 16.8 / 16.8 | 4.40 | 2.05 | 0 |
| Updated WebGL2 | 334 | 1014 / 1021 | 1023 | 60.0 | 16.7 / 16.7 / 16.8 | 4.60 | 3.12 | 0 |
| WebGPU | 334 | 1019 / 1019 | 1022 | 60.0 | 16.7 / 16.7 / 16.8 | 8.20 | 5.77 | 0 |

**The full performance gate failed.** All 48 unthrottled legacy rows and both new lighting rows passed. Seven of twelve 4× CPU-throttled LOW rows passed. Five still breached the simulation budget when repeated. The same five configurations also failed on the original WebGL2 build. Both versions use the same combat links and thresholds. Frame delivery, CPU and GPU samples for all rows are recorded in the [managed benchmark](../../shots/g6-renderer-bench.json) and the original/retry pairs in the [comparison data](../../shots/g6-renderer-bench-comparison.json).

| CPU-throttled LOW case | Original simulation p95, ms | Updated simulation p95, ms on retry | Budget, ms |
| --- | ---: | ---: | ---: |
| 1280x720, double | 13.0 | 13.9 | 12 |
| 1280x720, team | 18.8 | 21.4 | 12 |
| 1920x1080, heavy | 12.9 | 12.6 | 12 |
| 1920x1080, double | 20.3 | 15.2 | 12 |
| 1920x1080, team | 22.9 | 23.6 | 12 |

The four-hero team case also missed frame delivery and total CPU limits on retry. Its largest measured simulation sections were enemies and weapons/specials on both revisions. A later repeat of all twelve throttled cases also failed, with seven exceeding the 12 ms simulation limit. The precise set varied with machine load. [Later throttled measurements](../../shots/g6-renderer-throttled-repeat.json) Cold startup passed all four broadband/slow-4G title/fight samples. Broadband title readiness was 1.66 s with 1.77 MB transferred.

The mortal Gate 2 bot ran Normal with Rookie, seeds 1 and 2, on both versions. Seed 1 died to Rex on stage 2 at 517.93 s. Seed 2 cleared the loop at 1,100.65 s. Both runs yielded 50% loop clears, median stage 3 and 809.3 s mean game time. All deterministic result fields matched. Two seeds check reproducibility and give limited confidence in the population-wide clear rate.

## Visual verification

Before and after use the same seed, HIGH, 6 s of live play and the same viewport. Captures and raw benchmark reports are local artifacts in the ignored `shots/` directory. Each row links the original, the new WebGL2 backend and WebGPU. The gameplay and HUD remained legible in the meadow, the neon night stage and the boss fight, including the red attack rings. The live captures can show different animation phases.

| Scene | Language | Viewport | Original WebGL2 | Updated WebGL2 | WebGPU |
| --- | --- | --- | --- | --- | --- |
| meadow | en | 1280 × 720 | [PNG](../../shots/g6-renderer-before-meadow-en-720.png) | [PNG](../../shots/g6-renderer-after-gl-meadow-en-720.png) | [PNG](../../shots/g6-renderer-after-gpu-meadow-en-720.png) |
| meadow | en | 1920 × 1080 | [PNG](../../shots/g6-renderer-before-meadow-en-1080.png) | [PNG](../../shots/g6-renderer-after-gl-meadow-en-1080.png) | [PNG](../../shots/g6-renderer-after-gpu-meadow-en-1080.png) |
| meadow | ar | 1280 × 720 | [PNG](../../shots/g6-renderer-before-meadow-ar-720.png) | [PNG](../../shots/g6-renderer-after-gl-meadow-ar-720.png) | [PNG](../../shots/g6-renderer-after-gpu-meadow-ar-720.png) |
| meadow | ar | 1920 × 1080 | [PNG](../../shots/g6-renderer-before-meadow-ar-1080.png) | [PNG](../../shots/g6-renderer-after-gl-meadow-ar-1080.png) | [PNG](../../shots/g6-renderer-after-gpu-meadow-ar-1080.png) |
| night | en | 1280 × 720 | [PNG](../../shots/g6-renderer-before-night-en-720.png) | [PNG](../../shots/g6-renderer-after-gl-night-en-720.png) | [PNG](../../shots/g6-renderer-after-gpu-night-en-720.png) |
| night | en | 1920 × 1080 | [PNG](../../shots/g6-renderer-before-night-en-1080.png) | [PNG](../../shots/g6-renderer-after-gl-night-en-1080.png) | [PNG](../../shots/g6-renderer-after-gpu-night-en-1080.png) |
| night | ar | 1280 × 720 | [PNG](../../shots/g6-renderer-before-night-ar-720.png) | [PNG](../../shots/g6-renderer-after-gl-night-ar-720.png) | [PNG](../../shots/g6-renderer-after-gpu-night-ar-720.png) |
| night | ar | 1920 × 1080 | [PNG](../../shots/g6-renderer-before-night-ar-1080.png) | [PNG](../../shots/g6-renderer-after-gl-night-ar-1080.png) | [PNG](../../shots/g6-renderer-after-gpu-night-ar-1080.png) |
| boss | en | 1280 × 720 | [PNG](../../shots/g6-renderer-before-boss-en-720.png) | [PNG](../../shots/g6-renderer-after-gl-boss-en-720.png) | [PNG](../../shots/g6-renderer-after-gpu-boss-en-720.png) |
| boss | en | 1920 × 1080 | [PNG](../../shots/g6-renderer-before-boss-en-1080.png) | [PNG](../../shots/g6-renderer-after-gl-boss-en-1080.png) | [PNG](../../shots/g6-renderer-after-gpu-boss-en-1080.png) |
| boss | ar | 1280 × 720 | [PNG](../../shots/g6-renderer-before-boss-ar-720.png) | [PNG](../../shots/g6-renderer-after-gl-boss-ar-720.png) | [PNG](../../shots/g6-renderer-after-gpu-boss-ar-720.png) |
| boss | ar | 1920 × 1080 | [PNG](../../shots/g6-renderer-before-boss-ar-1080.png) | [PNG](../../shots/g6-renderer-after-gl-boss-ar-1080.png) | [PNG](../../shots/g6-renderer-after-gpu-boss-ar-1080.png) |

With a frozen identical game state, pixels differing by more than 24 RGB levels were 0.390% in the HIGH meadow, 0.105% in the HIGH night stage, 0.366% in the HIGH boss fight and 0.585% in the LOW meadow. All four backend comparisons meet the repository's 1% tolerance. These comparisons measure backend parity on Metal. The checked-in reference PNGs were recorded on SwiftShader. [Meadow](../../shots/g6-renderer-parity-meadow.png) · [Night](../../shots/g6-renderer-parity-night.png) · [Boss](../../shots/g6-renderer-parity-boss.png) · [LOW](../../shots/g6-renderer-parity.png)

Fixed-step full-window PNG comparisons at the requested HIGH resolutions also meet 1% on Metal. The table gives the percentage of pixels differing between independently launched backends.

| Viewport | Meadow | Neon night | Boss |
| --- | ---: | ---: | ---: |
| 1280 × 720 | 0.263% | 0.040% | 0.336% |
| 1920 × 1080 | 0.267% | 0.076% | 0.410% |

At 960 × 540 LOW, the 216-line drawing buffer scales by 2.5×. Native canvas origins can choose opposite source rows when a display pixel falls exactly halfway. A 1/1,024-device-pixel presentation bias resolves these ties consistently and leaves integer presentation sizes alone. It uses the separate CSS translate property so finisher shake still works. On the fixed-step LOW fixtures, updated WebGPU and WebGL2 differed by 0.481% in meadow, 0.089% in neon and 0.788% in boss, all within 1%.

The original Metal renderer already differed from the checked-in SwiftShader meadow, neon and boss PNGs by 5.06%, 1.20% and 5.32%. The updated WebGL2 figures were 6.25%, 1.55% and 6.21%. WebGPU measured 6.52%, 1.62% and 6.50%. The shared fractional-sampling decision changes 1.50%, 0.39% and 1.23% of pixels on WebGL2 relative to the original Metal renderer at this specific size. The checked-in PNGs remain intact. [LOW meadow, original](../../shots/g6-renderer-ref-original-meadow.png) · [updated WebGL2](../../shots/g6-renderer-ref-gl-meadow.png) · [WebGPU](../../shots/g6-renderer-ref-gpu-meadow.png)

### Test links

- Meadow, night, boss captures share `?test&bench&circle&seed=42&season=off&god&aim=0.7,0.7&quality=high`. Append `&stage=1&biome=meadow`, `&stage=5&biome=neon&night` or `&stage=4&bossnow&nointro`, then `&renderer=webgl` or `&renderer=webgpu` and `&lang=en` or `&lang=ar`.
- Stress fight uses `?test&bench&seed=42&god&circle&aim=0.7,0.7&stage=5&biome=meadow&night&rain&boom&swarm=320&hold=355&bullets=1024&litshots&quality=high&shadows=0&renderer=webgpu`. Use `renderer=webgl` for the fallback.
- Settings uses `?test&screen=settings`. Open Video → Advanced to select the preference. Help displays the active backend.

The backend selector and active-backend line were inspected in both languages. Auto selected native WebGPU. Absent adapters and failed device requests fell back to WebGL2. Forced WebGL skipped adapter probing. [English settings](../../shots/g6-renderer-settings-en.png) · [Arabic settings](../../shots/g6-renderer-settings-ar.png) · [English Help](../../shots/g6-renderer-help-en.png) · [Arabic Help](../../shots/g6-renderer-help-ar.png)

## Files and integration

- Renderer code in `src/render/renderer.ts`, `rendererBackend.ts`, `rendererGPU.ts`, `rendererNodes.ts`, `retroMaterial.ts`, `lightCluster.ts` and `lights.ts`. The light picker forwards pre-merge candidates to the tile grid.
- Small integration edits in `src/main.ts` initialize the renderer asynchronously, give input and capture the selected canvas, expose the renderer to the performance fixture and read draw counts for either backend.
- Shared settings and UI edits are in `src/game/settings.ts` (default, type and normalization), `src/ui/settingsScreen.ts` (one video row), `src/platform/help.ts` (active-backend line), `src/i18n/arabic2.ts` and `src/i18n/ar.ts` (five catalog entries each).
- Shared `src/dev/testLinks.ts` adds the friendly-projectile fixture and resolves the combat/workbench query collision. Performance scripts are `scripts/benchReal.mjs`, `benchRealScenes.mjs`, `benchRealBudget.mjs`, `benchRealLoad.mjs` and `benchRealReport.mjs`.
- `tests/g6renderer.test.ts` covers normalization, tile culling, temporal stability, overflow, strongest-four selection, atlas reuse, a 1,001-emitter stress case, LOW switching and shared uniforms. It also verifies that biome geometry replacement and disposal recreate GPU matrix bindings. This lane note records the decisions.

## Checks and limitations

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npx vite build` | Pass |
| `npm test` | Pass, 141 test files. The geometry-lifetime regression also passed in the focused renderer suite. |
| `npm run smoke` | Pass, whole-game smoke and mortal death path |
| `npm run skillbot -- --runs 2 --seed 1` | Pass before and after |
| `npm run coop -- --offline` | Shell Chromium startup blocked. The offline harness passed in managed headless Chromium with a WebGPU host and a WebGL2 client. It covered boss effects, stage transitions, reconnect, restart, lobby return and kick. |
| `npm run balance` | Shell Chromium startup blocked. In managed Chromium all four invincible kits cleared two stages. One historical budget failed. Rail/shield/storm recorded 11,185 stage-two kills against 15,298 in the checked-in baseline. Every kit and stage result matched exactly on the original source, updated WebGL2 and WebGPU. |
| `npm run shot` | Shell Chromium startup blocked. All 36 live before/after captures were taken and inspected in managed headless Chromium. |
| `npm run bench:real -- --check` | Shell Chromium startup blocked. The managed run completed 62 scenes and four cold loads. The budget checker returned failure on the five throttled legacy cases listed above. |

macOS denied the shell Chromium launches. The managed runs use the same Playwright measurement and game assertions on native Metal. The packaged Electron application and Windows/Linux GPU drivers remain unmeasured. Local lights share the existing projectile-color feed, which can assign a different shot’s tint when several projectile geometry batches are mixed. Timing results apply to this shared machine.

A mixed-backend co-op run exposed a destroyed-buffer error when biome changes replaced enemy geometry while retaining the CPU instance pool. The matrix binding now follows the geometry lifetime, and body/outline draws share it within that lifetime. Repeated biome swaps produced zero writes to released buffers and the subsequent two-peer run passed.
