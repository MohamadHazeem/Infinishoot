# Gate 6 performance

The baseline is `7b8b4f1`, immediately before the paused lane commit `3380fbd`. Measurements use the production game and the stock scene links, warm-up, census, quality levels, throttle and budget. Raw samples, tapes and screenshots are local under `shots/g6-perf/`. The regression test belongs to this lane. The pre-existing change to `.lane-brief.md` is outside its patch.

**Release hardware result.** All 62 workloads and four cold loads passed the existing budget in one production run. Four-hero LOW at 4× CPU throttle held 59.0 fps at 1280×720 and 58.6 fps at 1920×1080, with simulation p95 of 7.4 and 8.1 ms against the 12 ms limit. At 1080p HIGH the double horde sustained 60.00 fps with a median 338 enemies and 1,009 projectiles. Its frame interval was 16.8 ms p95 and the entire game callback was 4.0 ms p95. Both friendly-lights backends sustained 60.00 fps with a median 1,021 projectiles. [Full matrix](../../shots/g6-perf/complete.md) · [Raw samples](../../shots/g6-perf/complete.json)

## Measured frame times

Consecutive production sweeps on the same headless Chrome 156 and Metal M5 Pro at 1920×1080. The complete candidate matrix ran first, then the archived parent ran these five cases using the identical measurement protocol. Intervals and callback costs below are p95 milliseconds. Each pair is parent → candidate.

| Preset, throttle, scene | FPS | Frame interval | Simulation | Render preparation | GL submission | Total callback |
|---|---:|---:|---:|---:|---:|---:|
| LOW 4× team | 37.08 → 58.60 | 33.40 → 16.80 | 13.90 → 8.10 | 6.60 → 4.90 | 5.90 → 4.70 | 25.40 → 16.20 |
| LOW 4× double | 54.02 → 59.80 | 33.30 → 16.80 | 11.10 → 7.10 | 5.30 → 4.10 | 3.50 → 3.40 | 17.80 → 13.50 |
| LOW 4× heavy | 56.81 → 59.60 | 33.30 → 16.80 | 7.80 → 7.40 | 4.70 → 4.50 | 3.90 → 4.20 | 15.80 → 14.40 |
| LOW 4× night | 53.00 → 60.00 | 33.30 → 16.70 | 8.70 → 7.80 | 5.20 → 4.40 | 4.00 → 4.10 | 17.00 → 15.30 |
| HIGH 1× double | 60.00 → 60.00 | 16.70 → 16.80 | 2.00 → 2.10 | 1.30 → 1.20 | 0.90 → 0.90 | 4.10 → 4.00 |


Four-hero CPU phase ranking, LOW 4×, 1920×1080. Times are mean milliseconds per rendered frame, including all fixed simulation steps in that frame. Browser layout and style are separate CDP counters.

| Phase | Before | After |
|---|---:|---:|
| sim.enemies | 2.034 | 1.096 |
| sim.weapons+specials | 1.144 | 0.610 |
| ren.barrels+arena+chests | 0.956 | 0.471 |
| ren.enemies | 0.886 | 0.836 |
| sim.director+rest | 0.690 | 0.359 |
| sim.hazards+arena | 0.661 | 0.366 |
| sim.bullets | 0.624 | 0.279 |
| ren.pickups+weapons+fx | 0.545 | 0.334 |
| ren.heroes+audio | 0.539 | 0.363 |
| ren.hudbits | 0.472 | 0.338 |
| sim.heroes+skill | 0.371 | 0.313 |
| ren.camera+reticle | 0.344 | 0.295 |
| ren.hud | 0.318 | 0.190 |
| sim.hash | 0.273 | 0.149 |
| ren.bullets | 0.235 | 0.113 |
| ren.look | 0.215 | 0.137 |
| sim.pickups+chests | 0.173 | 0.148 |
| sim.statuses | 0.125 | 0.070 |
| ren.music+sky | 0.104 | 0.051 |
| ren.dmgnums | 0.098 | 0.128 |
| sim.boss+recycle | 0.096 | 0.075 |
| ren.graphics | 0.080 | 0.078 |
| LayoutDuration | 1.009 | 0.669 |
| RecalcStyleDuration | 4.761 | 1.295 |

## Investigation

The CPU and sampled allocation trace of four heroes on LOW at 4× ranked enemy simulation first among named game systems. Sampled self time included 94 ms in enemy update, 80 ms in Three.js uniform upload, 59 ms preparing enemies, 53 ms writing pickup matrices, 51 ms deciding autopilot moves, 44 ms updating loot and 39 ms updating projectiles. Sampled allocations attributed 30.3 MiB to enemy update, 24.8 MiB to bullet update, 18.5 MiB to autopilot, 13.7 MiB to enemy posing, 13.1 MiB to enemy render and 12 MiB to pickup update. Profiled timings include profiler overhead. Frame tables use unprofiled samples.

A separate DOM invalidation trace linked changes in a HUD counter to ancestor selectors. The first trial of explicit HUD state reduced style recalculation in the 1080p four-hero scene from 7.8 to 2.0 ms/frame in consecutive diagnostic builds. The GL submission trace counted 120 hero draws per frame in that scene. On a fixed four-hero frame the LOW paint batches cut total draws from 194 to 118. Reading back the same pose with and without batching found zero differing RGB pixels out of 82,944 on the 384×216 render surface.

## Decisions

- Keep the WIP's spatial-hash column addressing, ordered bucket traversal, hearing distance reuse, autopilot component rejection, cached gem colours and live-range buffer uploads.
- Preserve every simulation tick and the ordering of attacks, RNG, area hits and co-op lag compensation. An area-query stamp rejects duplicate cell entries. A two-metre tile mask can rule out static wall contact for circles up to one metre. Exact tests still handle occupied tiles, large radii and custom coordinates.
- Check projectile overlap before piercing history and deck height. The rewind recorder reads a numeric colour cached on spawn, recolour and pool swaps. Network snapshots retain their existing string palette. A missile volley shares its launch-position query and draws a separate random target for each missile. Solo effects only allocate a network tuple when recording is active. Distant unattended loot takes the same drag and integration path without searching past the team's largest magnet. Pulled and vacuumed items keep their unlimited search.
- Reuse stealth sight ranges for each hero within a tick. Newly alerted enemies still spread on the following tick. Enemy posing shares frame-dependent smoothing coefficients and crowd movement reads the live hash buckets in their original order without copying their items. A weaker sound blob cannot win after attenuation and is skipped. The autopilot finds its first active boss in its existing target pass and writes movement directly into its reusable intent. Host and client use the pool’s active ooze count to skip searching for slugs when none are present. Existing puddles still age, and custom and veteran slug definitions count.
- LOW WebGL paints plates that share a material in one draw using the existing joint matrices. Textured face decals and custom materials retain their original draw path. HUD selectors use explicit menu, event, cinematic and desktop state. Identical hidden attributes no longer invalidate layout, and the Night Raid hunting count can update its text node.
- Normal balance already exceeds the Gate 2 target on this branch. The parent cleared 17/20 (85%), with seeds 4, 5 and 7 dying to lava. The final 20-seed run reproduced every deterministic field, with the same three deaths. Both cohorts averaged 1,020.6 seconds. Retuning the director would break the requested seed equality.

## Files

Paths below include the paused commit and its follow-up.

- `src/audio/` — `loudness.ts`.
- `src/core/` — `spatialHash.ts`.
- `src/game/` — `autopilot.ts`, `bullets.ts`, `cutscene.ts`, `enemies.ts`, `enemyAnim.ts`, `interactives.ts`, `pickups.ts`, `soundLaneView.ts`, `timeline.ts`, `vfx.ts`, `worldEvents.ts`.
- `src/game/weapons/` — `missiles.ts`.
- `src/game/systems/` — `aimAssist.ts`, `biomeFoes.ts`, `combat.ts`, `coopplay.ts`, `gauntlet.ts`, `halloween.ts`, `render.ts`, `sound2.ts`, `statuses.ts`, `stealth.ts`, `worldEvents.ts`.
- `src/platform/` — `help.ts`, `clips.ts`, `clipEncoder.worker.ts`.
- `src/render/` — `biomeFx.ts`, `instancing.ts`, `renderer.ts`, `retroMaterial.ts`, `rigOverlay.ts`, `worldEventView.ts`.
- `src/ui/` — `companionHud.ts`, `hud.ts`, `hudFit.ts`, `hudLayout.ts`, `localCoopUi.ts`, `menuFit.ts`, `mobileCss.ts`, `objectiveHud.ts`, `screens.ts`, `sound2Hud.ts`, `storyScreen.ts`, `timeHud.ts`, `toastQueue.ts`, `trialsScreen.ts`, `versusUi.ts`, `worldEventHud.ts`.
- `tests/g6-perf.test.ts` covers spatial wrap, query order, collision boundaries, pickup reach/vacuum, projectile colour reuse, missile-volley RNG and lookup count, LOW paint batching, the minimap redraw boundary, toast eligibility, and the single in-flight highlight capture across a reset.
- Shared edits: `src/ui/screens.ts` publishes the active screen on the HUD root. `src/ui/hud.ts` preserves existing text nodes, avoids redundant hidden writes and exposes the existing minimap redraw check. It also supplies a stable title-card predicate when advancing the toast queue.

## Visual checks and links

Each pair uses headless Metal, seed 42, LOW, a fresh browser context, 480 fixed game ticks, one render per three ticks and six seconds for the HUD to settle. The circle input and meadow teammate pilots normally run on 16 ms browser timers. The screenshot driver steps these inputs with the simulation so that both builds receive identical commands. The parent and candidate replay hashes matched in all twelve pairs: meadow 1015361123, night 1795406713 and boss 4006169973. Seven pairs were pixel-identical, including every night capture. In the other five, at least 99.97% of RGB pixels matched, with differences confined to small HUD regions. Visual inspection confirmed matching avatar poses, projectile silhouettes, boss core and telegraphs. [Capture driver](../../shots/g6-perf/visual-fixed.mjs) · [State checks](../../shots/g6-perf/visual-fixed.log)

Append `&lang=ar` for the Arabic version of each link. The separate performance scenes below use the benchmark’s normal game loop.

- Four heroes on LOW: `?test&bench&seed=42&god&circle&aim=0.7,0.7&weapons=drones:6,missiles:6,lightning:6,fire:6&stage=5&heroes=4&matebots&boom&hold=180&bullets=500&renderer=webgl&quality=low&shadows=0`
- Double horde on HIGH: `?test&bench&seed=42&god&circle&aim=0.7,0.7&weapons=drones:6,missiles:6,lightning:6,fire:6&stage=5&biome=meadow&night&rain&boom&swarm=360&hold=390,24:spinner,12:burster&bullets=1010&renderer=webgl&quality=high&shadows=0`
- WebGPU lights: `?test&bench&seed=42&god&circle&aim=0.7,0.7&stage=5&biome=meadow&night&rain&boom&swarm=320&hold=355&bullets=1024&litshots&renderer=webgpu&quality=high&shadows=0`

- Meadow: `?test&ci2&bench&circle&seed=42&god&season=off&stage=4&quality=low&biome=meadow&day&heroes=4&matebots`
- Night: `?test&ci2&bench&circle&seed=42&god&season=off&stage=4&quality=low&biome=neon&night&rain`
- Boss: `?test&ci2&bench&circle&seed=42&god&season=off&stage=4&quality=low&bossnow&nointro`

| Scene | Viewport | Language | Original | Candidate |
|---|---|---|---|---|
| meadow | 1280×720 | en | [PNG](../../shots/g6-perf/visual-final/before-meadow-1280-en.png) | [PNG](../../shots/g6-perf/visual-final/after-meadow-1280-en.png) |
| meadow | 1280×720 | ar | [PNG](../../shots/g6-perf/visual-final/before-meadow-1280-ar.png) | [PNG](../../shots/g6-perf/visual-final/after-meadow-1280-ar.png) |
| meadow | 1920×1080 | en | [PNG](../../shots/g6-perf/visual-final/before-meadow-1920-en.png) | [PNG](../../shots/g6-perf/visual-final/after-meadow-1920-en.png) |
| meadow | 1920×1080 | ar | [PNG](../../shots/g6-perf/visual-final/before-meadow-1920-ar.png) | [PNG](../../shots/g6-perf/visual-final/after-meadow-1920-ar.png) |
| night | 1280×720 | en | [PNG](../../shots/g6-perf/visual-final/before-night-1280-en.png) | [PNG](../../shots/g6-perf/visual-final/after-night-1280-en.png) |
| night | 1280×720 | ar | [PNG](../../shots/g6-perf/visual-final/before-night-1280-ar.png) | [PNG](../../shots/g6-perf/visual-final/after-night-1280-ar.png) |
| night | 1920×1080 | en | [PNG](../../shots/g6-perf/visual-final/before-night-1920-en.png) | [PNG](../../shots/g6-perf/visual-final/after-night-1920-en.png) |
| night | 1920×1080 | ar | [PNG](../../shots/g6-perf/visual-final/before-night-1920-ar.png) | [PNG](../../shots/g6-perf/visual-final/after-night-1920-ar.png) |
| boss | 1280×720 | en | [PNG](../../shots/g6-perf/visual-final/before-boss-1280-en.png) | [PNG](../../shots/g6-perf/visual-final/after-boss-1280-en.png) |
| boss | 1280×720 | ar | [PNG](../../shots/g6-perf/visual-final/before-boss-1280-ar.png) | [PNG](../../shots/g6-perf/visual-final/after-boss-1280-ar.png) |
| boss | 1920×1080 | en | [PNG](../../shots/g6-perf/visual-final/before-boss-1920-en.png) | [PNG](../../shots/g6-perf/visual-final/after-boss-1920-en.png) |
| boss | 1920×1080 | ar | [PNG](../../shots/g6-perf/visual-final/before-boss-1920-ar.png) | [PNG](../../shots/g6-perf/visual-final/after-boss-1920-ar.png) |

## Verification

| Command | Final result |
| --- | --- |
| `npm run bench:real -- --check` | Passed, 60 legacy scenes, two lighting scenes and four cold loads on the dedicated headless Metal browser (`--cdp`) |
| `npm run typecheck` | Passed |
| `npx vite build` | Passed, including the bundled clip worker |
| `npm test` | [All 153 test files passed](../../shots/g6-perf/tests-complete.log) with four runner jobs |
| `npm run smoke` | [Passed](../../shots/g6-perf/smoke-complete.log), including the mortal death path and game-over record |
| `npm run coop -- --offline` | Passed, two live headless peers and the local broker |
| `npm run replay -- shots/g6-perf/before.isr` | Passed on the final build against the original tape |
| `npm run skillbot -- --difficulty normal --runs 20` | 20/20 deterministic records matched |
| `npm run balance` | One pre-existing fixture failure reproduced on both revisions |

- Parent 30-second replay against the final simulation: 1,800 steps, 1,983 events, checksum 4262088949. Tape: `shots/g6-perf/before.isr`.
- `npm run coop -- --offline` passed with the local broker and two headless pages. The final run covered the intro, finisher, portrait ping, vault, revive, reconnect, restart and lobby return. It exchanged 1,942 snapshots, mean 1,123 bytes and maximum 9,517 bytes. None exceeded 16 KiB. An earlier loaded run missed the intro and portrait timing windows, then the same harness passed with the unchanged transport and assertions.
- All four invincible-bot kits produced identical result records, including the Buster’s 11,254 cumulative kills at stage 2. The fixture expects 15,414 with a 25% tolerance and fails on both builds. The other 31 fixture checks pass. [Parent balance output](../../shots/g6-perf/balance-before-retry.log) · [Final balance output](../../shots/g6-perf/balance-complete.log)
- The first full hardware matrix at host load averages of 76–165 finished six rows and timed out at the driver's 90-second wait for a running scene on the seventh. The four-hero row recorded zero frames. The gate did not produce a complete report on that attempt.
- A diagnostic of the title-demo test under load found that its 10.73 ms step missed the 4 ms threshold. The only storage difference came from `infinishoot.errors.v1` recording the assertion's console error. The save object was identical.

## Hardware gate progression

A separate pair of five-scene sweeps ran while the one-minute host load exceeded 97. The archived parent’s 1080p LOW team scene ran at 10.9 fps and an intermediate candidate at 13.4 fps. A different pair at that load measured 16.1 → 27.7 fps for the LOW double horde. Both runs are retained under `shots/g6-perf/parent-*.json` and `candidate-*.json`. The matched release timings above use the final build after the other validation jobs exited.

A full Chrome 156 run after the slug and autopilot work passed 56/62 scenes and all four load checks. The 1080p HIGH double scene held 60.00 fps, with median 342 enemies and 1,009 projectiles. Frame interval p95 was 16.8 ms, simulation 2.6 ms, render preparation 1.7 ms, GL submission 1.5 ms and total callback 5.2 ms. The original parent sample on Chrome 158 had 16.7, 2.1, 1.5, 1.0 and 4.4 ms respectively, also at 60 fps.

The six misses on that build were 720p LOW native team, 720p LOW 4× team, 1080p LOW 4× heavy, team and night, plus the 1080p WebGPU friendly-lights stress scene. The LOW 4× team simulation p95 was 16.9 ms at 720p and 17.2 ms at 1080p against a 12 ms limit. These misses prompted the direct crowd-bucket traversal and missile changes. Raw full report: `shots/g6-perf/final.json`.

The next full hardware run passed all 60 legacy scenes, the WebGL lights case and all four cold loads. WebGPU lights ran at 54.18 fps. With the shader cache held constant, a timing trace attributed long frames to synchronous GPU readback inside `OffscreenCanvas.convertToBlob()` on the game thread. Calls measured 63.7 and 165.7 ms. The recorder now transfers one ImageBitmap at a time to a local worker that letterboxes and encodes it. It falls back to the existing local canvas path when a worker is unavailable. Pause/reset terminates the worker and discards stale frames. The frame rate, image dimensions, quality and ring limits are unchanged. An independent stock WebGPU lights sample with recording active produced 300 frames at 60.00 fps, zero missed refreshes and 16.8 ms p99. The worker delivered 131 JPEGs through warm-up and measurement. A decoded 480×270 frame contained 6,035 distinct sampled colours. Raw diagnostics: `locked.json`, `gpu-stalls.json`, `lights-worker.json` and `lights-worker.log` under `shots/g6-perf/`.

The host-migration unit fixture under load could spend its entire 300 ms reconnect delay presenting a level-up screen, then accidentally use real PeerJS in Node. Its CPU trace attributed 231 ms to computing overflow style for a menu with no vertical overflow. The scroll cue now checks whether the menu overflows before reading computed style, as it already did for descendants. The unchanged host-migration test then passed, including the split-healing case.

With the worker, the full matrix passed both lights cases at 60 fps. With the skilled-bot cohort running alongside the browser, LOW four-hero simulation p95 measured 12.1 ms at 720p and 13.1 ms at 1080p. The other 60 scenes and all cold loads passed (`shots/g6-perf/verified.json`).

The isolated matrix retry passed 61/62. The four-hero 720p row still missed at 12.6 ms simulation p95. A fresh 12-second CPU profile of that row recorded 252 ms self in enemy update, 153 ms in crowd movement, 107 ms in hash insertion, 73 ms in Night Raid awareness and 55 ms in behaviour dispatch. Presenting queued notices spent 107 ms in a document-wide title-card selector. Ordinary chase now has a short path after evaluating the existing ramp rules, and an active lure avoids a discarded four-hero target scan. Night Raid snapshots each living hero’s position and both visibility ranges once per tick. The toast queue checks card visibility only when a message can actually show, using ID and class lookups. The next isolated four-hero samples recorded 7.4 ms simulation p95 at 720p and 6.9 ms at 1080p, both above 59 fps.

## Normal skilled bot

Seeds 1–20, solo Rookie, season off, no pet. All outcome and event fields matched the parent exactly, including build, stage logs, damage history, dashes and parries. Only wall-clock CPU measurements were excluded. Raw candidate cohort: [20 runs](../../shots/g6-perf/seeds-complete.json).

| Seed | Result on both revisions | Seconds | Kills |
|---:|---|---:|---:|
| 1 | Loop clear | 1080 | 44,321 |
| 2 | Loop clear | 1053.98 | 43,217 |
| 3 | Loop clear | 1040.64 | 44,454 |
| 4 | lava | 840.52 | 27,529 |
| 5 | lava | 874.79 | 35,972 |
| 6 | Loop clear | 1035.71 | 42,712 |
| 7 | lava | 930.47 | 36,681 |
| 8 | Loop clear | 1022.68 | 45,321 |
| 9 | Loop clear | 1057.19 | 42,353 |
| 10 | Loop clear | 1055.18 | 45,229 |
| 11 | Loop clear | 1054.71 | 40,294 |
| 12 | Loop clear | 1042.11 | 47,216 |
| 13 | Loop clear | 1036.92 | 45,673 |
| 14 | Loop clear | 1025.55 | 39,246 |
| 15 | Loop clear | 1044.57 | 40,473 |
| 16 | Loop clear | 1054.56 | 44,738 |
| 17 | Loop clear | 1042.12 | 40,356 |
| 18 | Loop clear | 1041.89 | 44,808 |
| 19 | Loop clear | 1025.73 | 49,984 |
| 20 | Loop clear | 1053.48 | 45,115 |
