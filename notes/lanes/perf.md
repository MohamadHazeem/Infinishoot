# Lane: perf (benchmark and performance pass after the big update)

## What players get
- Big fights stay smooth: the simulation of 270 enemies costs a tenth of what it did (0.08 ms per step instead of 0.64 ms), and the game makes about a fifth of the garbage, so the garbage collector runs 6 times in 20 s instead of about 100.
- Fewer triangles on screen for the same picture: off-screen enemies and grass are no longer drawn (-30% triangles in a heavy meadow fight at HIGH).
- LOW quality is really lighter now: no outlines and half the grass (-60% triangles, -35% draw calls against the old LOW). HIGH looks the same as before.
- No more hitches from the HUD forcing a page layout mid-frame on gold pickups, toasts, banners and style-rank changes.

## The benchmark
`npm run bench` builds the game, opens a heavy test link in headless Chromium for 20 s (after a 4 s warm-up) and prints:
- ms per frame (avg / p95 / worst) for the simulation (all fixed steps in the frame), `game.render`, `renderer.render` (GL submit), total CPU, and the frame interval; plus "CPU at 1 step/frame" (a 60 fps frame: sim per step + render + GL);
- DOM style+layout and paint time on the browser main thread (from a Chrome trace);
- draw calls and triangles (renderer.info), enemy / bullet / particle counts;
- JS heap (start, end, peak), allocation rate, minor/major GC count, time and worst pause (Chrome trace);
- per-phase timers: `sim.*` per simulation step, `ren.*` per rendered frame.

Options: `--quality low|medium|high|auto` (default high), `--scene heavy|magma|light`, `--link "?test&..."`, `--seconds 20`, `--warmup 4`, `--size 1280x720`, `--dev` (Vite dev server instead of the production build), `--json out.json`.

Scenes (all `seed=42&god&circle&aim=0.7,0.7&weapons=drones:6,missiles:6,lightning:6,fire:6`):
- heavy: `stage=5&night&rain&boom&swarm=200&hold=170,24:spinner,12:burster&bullets=500` (meadow with grass, night lights, rain, an explosion every 0.7 s, ~270 enemies, ~500 bullets)
- magma: the same on stage 4 (lava lights and heat, no rain)
- light: stage 1, day, dry, default horde.

New test-link options (src/dev/testLinks.ts): `&bench` turns on the phase timers (src/core/prof.ts; off by default, one boolean test per call) and blocks level-up menus so the load stays steady; `&hold=170,24:spinner` tops each enemy type back up to its count every 0.5 s; `&bullets=500` keeps 500 enemy bullets in flight around the hero.

Headless Chromium renders with SwiftShader (software GL), so frame intervals there are GPU-bound and pessimistic (8-14 fps). Compare the CPU columns, triangles, draw calls and GC; treat frame interval as a relative signal only. Timers are 5 us (the bench serves the page cross-origin isolated).

## Before / after (MacBook, headless Chromium, production build, 1280x720)
Before = 7b77395 (benchmark only, game code as merged), after = this lane's head. Same scene and seed; enemy and particle counts vary a little run to run.

Heavy scene, HIGH:
| | before | after |
|---|---|---|
| simulation per step | 0.83 ms | 0.24 ms |
| `sim.enemies` per step | 0.644 ms | 0.085 ms |
| simulation per frame avg / p95 / worst (several steps per SwiftShader frame) | 5.96 / 8.57 / 14.32 ms | 1.44 / 2.44 / 4.75 ms |
| game.render avg / p95 | 0.80 / 1.37 ms | 0.63 / 0.83 ms |
| renderer.render (GL submit) avg | 0.67 ms | 0.55 ms |
| CPU at 1 step/frame (a 60 fps frame) | 2.30 ms | 1.43 ms |
| DOM style+layout / paint | 0.58 / 0.44 ms | 0.50 / 0.39 ms |
| `ren.skill` (style meter) | 0.101 ms | 0.008 ms |
| draw calls avg | 173 | 164 |
| triangles avg / max | 302k / 327k | 210k / 243k |
| allocation | ~58 MB/s | ~11 MB/s |
| GC in 20 s | 102 minor (28 ms) + 6 major | 6 minor (3 ms) + 6 major |
| frame interval (SwiftShader) | 120 ms | 98 ms |
| entities | 263 enemies, 500 bullets, 916 particles | 273 enemies, 499 bullets, 864 particles |

Heavy scene, LOW:
| | before | after |
|---|---|---|
| CPU at 1 step/frame | 2.27 ms | 1.33 ms |
| draw calls avg | 167 | 112 |
| triangles avg | 292k | 121k |
| allocation / minor GCs | ~63 MB/s / 115 | ~11 MB/s / 6 |
| frame interval (SwiftShader) | 102 ms | 74 ms |

Magma scene, HIGH:
| | before | after |
|---|---|---|
| CPU at 1 step/frame | 2.07 ms | 1.33 ms |
| triangles avg | 225k | 173k |
| draw calls avg | 158 | 152 |
| allocation / minor GCs | ~64 MB/s / 93 | ~10 MB/s / 6 |
| frame interval (SwiftShader) | 93 ms | 86 ms |

AUTO in SwiftShader steps down to LOW (216p, 4 lights, outlines off) as expected.

## What was slow and what changed
1. **Enemies vs walls** (the top CPU and allocation site): `resolveCircleVsBoxes` looped over every arena collider for every enemy every step and allocated about 1.8 GB (sampled) in 12 s. Enemies now use the wall grid: `StaticBoxGrid.resolveCircle` checks only the boxes in the cells the circle touches (same push-out maths, `pushCircleOut` in src/world/collision.ts). `EnemyCtx.walls` is a getter for `game.walls`, which is rebuilt whenever colliders change. The hero still uses the brute-force version (one call per step).
2. **Crowd separation** used `hash.query(..., closure)` per enemy per step; the closure captured and mutated two sums, which boxed a heap number on every add. Now `SpatialHash.queryInto` fills a scratch array and a plain loop sums.
3. **Enemies.update** was one huge function; the behaviour switch moved to `Enemies.behave()` so both halves stay optimizable (allocation in update fell from 71 MB to 26 MB sampled).
4. **SpatialHash**: the cell key `((cx + 32768) << 16) | ...` overflowed 31 bits, so every key was a heap number (an allocation per lookup); keys are now `cellKey()` (15 bits per axis, always a small integer). Buckets are emptied lazily by a generation counter; `length = 0` dropped their storage every step.
5. **Off-screen culling** (src/render/viewCull.ts): enemies (body, shadow, auras) and grass tufts outside the camera frustum (2.5 m margin, last frame's camera) are not written to their instanced meshes. Grass used to park off-screen tufts at zero scale but still drew all 1,100 every frame; visible tufts are now packed to the front with their colours. Telegraph decals still draw for off-screen enemies (sniper lines are long).
6. **Empty instanced pools** are hidden for the frame in `RetroRenderer.render` (three.js still bound their program and uniforms with count 0).
7. **Enemy geometry is indexed** (`mergeVertices`): a face's two triangles share corners, about a third fewer vertex shader runs per enemy and per outline pass on real GPUs (SwiftShader doesn't show it).
8. **Outline material**: one hull material served instanced meshes with and without instance colours, so three.js switched its program back and forth every frame (a full `getProgram` lookup each time). Instance-coloured meshes now get their own hull material.
9. **LOW quality**: outlines off (they are a second pass over every enemy and hero part, about a third of the scene's triangles) and grass follows the ambience multiplier (LOW 50%, LOW+ 60%, MEDIUM/HIGH 100%).
10. **HUD forced reflows**: `void el.offsetWidth` to restart CSS animations (gold bump, toasts, banners, hurt, level-up, style rank) forced a synchronous layout of the whole HUD mid-frame. `restartClass()` (src/ui/hud.ts) removes the class and re-adds it next frame instead. The rain's `prefers-reduced-motion` query is cached (it built a new MediaQueryList every frame).

Not changed (measured, not worth it now): enemy AI staggering (the whole enemy step is 0.085 ms for 270 enemies), dynamic lights (already bounded by the quality budget and an early-out loop), bloom/distortion (no measurable CPU cost; GPU cost at 360p is small), shader warm-up (stage 1 compiles 22 programs at start and 3 more in the first seconds).

## Files touched
- New: scripts/bench.mjs, src/core/prof.ts, src/render/viewCull.ts, notes/lanes/perf.md.
- Owned edits: src/core/spatialHash.ts, src/world/collision.ts, src/game/enemies.ts (wall push-out, separation, behave() split, culling, indexed geometry), src/render/renderer.ts (empty pools), src/render/outlines.ts, src/render/quality.ts (LOW outlines), src/game/ambience.ts (grass culling and thinning, cached media query).
- Small edits in shared files: src/main.ts (bench frame timers), src/game/game.ts (phase laps, `walls` getter on the enemy ctx), src/game/systems/render.ts (phase laps, `viewCull.update`), src/dev/testLinks.ts (`bench`, `hold`, `bullets`), src/ui/hud.ts and src/ui/styleMeter.ts (`restartClass`), tests/enemies.test.ts and tests/bosses.test.ts (`walls` in the test ctx), package.json (`bench` script).

## Unfinished / risks
- Numbers are from headless Chromium on a Mac with SwiftShader; not measured on a real mid-range laptop iGPU. The CPU side (1.4 ms per 60 fps frame plus ~0.9 ms of browser style/layout/paint) has plenty of headroom; GPU cost on a real iGPU is unverified.
- Culling uses last frame's camera with a 2.5 m margin. A hard camera cut could hide an enemy at the screen edge for one frame.
- Grass beyond the old fixed 30 x 24 m box around the camera is still hidden when zoomed out (unchanged behaviour); the new frustum test only removes more.
- HUD animation restarts now start one frame (16 ms) later than before.
- Hero outlines still cost ~26 draw calls per hero (one hull per rig part); merging the rig would save ~100 draws in 4-player co-op.
- DOM HUD: ~0.5 ms style+layout per frame in big fights (damage numbers change text every frame). Fine now; a canvas or sprite version would be the next step if it grows.
- One unit-test run (of ~10) reported "1 test file failed" without a reproducible FAIL line; all later runs passed. Possibly a timing-sensitive test under load.

## Decision-log paragraph for PLAN.md
- 2026-10-19: Performance pass (perf lane, notes/lanes/perf.md). New `npm run bench` (headless Chromium, heavy test link with ~270 enemies, 500 bullets, rain, night lights and explosions; reports sim/render/GL frame times, draw calls, triangles, heap, GC and per-phase timers). The merged update's biggest cost was CPU and garbage, not shaders: enemies pushed themselves out of every arena collider each step and the crowd-separation closure boxed numbers, so a big fight made ~60 MB/s of garbage and 100 minor GCs per 20 s. Enemies now use the wall grid and a closure-free neighbour query, spatial-hash keys stay small integers: the enemy step went from 0.64 to 0.085 ms and garbage to ~11 MB/s (6 minor GCs per 20 s). Off-screen enemies and grass are culled from their instanced meshes (-30% triangles at HIGH), LOW drops outlines and half the grass (-60% triangles, -35% draw calls), and HUD animation restarts no longer force a layout. HIGH looks unchanged; a 60 fps frame's CPU went from 2.3 to 1.4 ms on the dev Mac.
