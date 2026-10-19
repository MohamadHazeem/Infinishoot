# perf2 — performance after the large merge

Starting revision: `309ab1e` on `lane/perf2`. No dependencies, gameplay tuning, save schema, protocol or quality defaults changed.

## What players get

Crowded scenes prepare the same picture with fewer buffer writes and less garbage. Enemy bullets retain their full magenta core and dark rim; evolved friendly shots, tails, colours and overflow fallback remain. Nearby sound-reactive enemies skip a noise search whose result could not change their decision. Inactive rhythm/pacifist/ghost presentation stops doing work after clearing its previous display. Score formatting reuses its locale formatter.

Highlights keep their existing 480×270, 20 fps, JPEG .65, 15-second window and memory budgets. A single asynchronous ImageBitmap snapshot defers the 2D readback/encoder submission until outside the animation callback; completion remains generation-guarded and every bitmap is closed. Browsers without OffscreenCanvas retain the HTML canvas path. **This moves some main-thread work; it does not eliminate encoding cost.** The benchmark now reports that callback cost separately.

## Method and results

Same heavy preset as `perf.md`, with `biome=meadow` explicitly selected because stage 5 is now Neon City: seed 42, stage 5, night, rain, explosions, four evolved weapons, at least 170 swarmers + 24 spinners + 12 bursters, 500 replenished enemy bullets. Production build, 1280×720, 20-second samples after four seconds of warm-up. Shared overnight Mac; populations and newly activated geometry vary slightly. HIGH has roughly 300–315 live enemies and 500–520 bullets. All benchmark runs reported no browser errors.

Commands:

```sh
npm run bench -- --gpu metal --quality high --json /tmp/perf2-high.json
npm run bench -- --gpu metal --quality low --json /tmp/perf2-low.json
npm run bench -- --quality high --json /tmp/perf2-high-swift.json
npm run bench -- --quality low --json /tmp/perf2-low-swift.json
npm run bench -- --dev --gpu metal --profile /tmp/perf2-profile.json
```

`--profile` writes a separate CDP CPU profile and sampled allocations, including collected objects. Use diagnostic profiles for attribution, not unbiased timing. `--skip-build` reuses an already-built `dist/` for repeated quality comparisons.

Native Metal (ms unless specified):

| Measurement | HIGH before | HIGH after | LOW before | LOW after |
|---|---:|---:|---:|---:|
| Simulation / step | .824 | .775 | .779 | .765 |
| Render preparation / frame | 1.874 | 1.016 | 1.533 | .838 |
| GL + synchronous clip submission | 2.189 | 1.039 | .930 | 1.007 |
| Measured animation callback | 4.887 | 2.830 | 3.242 | 2.610 |
| Async clip callback / frame | 0 | .841 | 0 | 0 |
| Callback + async clip work | **4.887** | **3.671** | **3.242** | **2.610** |
| Animation callback p95 | 7.905 | 3.580 | 4.190 | 3.395 |
| Estimated allocation MB/s | 45.1 | 30.0 | 37.8 | 24.3 |
| Frames in sample | 1236 | 1233 | 1235 | 1231 |
| Average triangles | 238,700 | 236,173 | 139,631 | 127,811 |

HIGH main callback plus asynchronous capture is about **25% cheaper**, render preparation **46% cheaper**, estimated allocation **34% lower**. LOW is about **20% cheaper** overall. Browser style/layout remains about .81 ms/frame and paint .23; those are outside the game timers. LOW already disables highlight recording. Allocation estimates count positive changes in sampled heap, so GC timing affects them; adjacent HIGH repeats measured 25–30 MB/s after versus 45 MB/s before.

The original `perf.md` result was .24 ms simulation / .63 render / .55 GL, 1.43 ms total, approximately 273 enemies and 11 MB/s allocation. This pass does **not** restore that simulation number: current AI/hearing/crowd rules, weapons, replay recording and other systems do more work, and the old SwiftShader run is not hardware/population-equivalent. Current simulation is approximately .77 ms, with the enemy phase still the largest cost.

SwiftShader was unusably GPU/readback bound on this shared machine, even before changes. Baseline HIGH/LOW produced only 8/7 frames in the nominal 20-second sample, with GL waits averaging 3,646/2,695 ms. These are diagnostic smoke samples, not credible 60 fps or matched-population comparisons. Final HIGH/LOW produced 21/22 frames, with GL submission averaging 654/686 ms and simulation per step .982/.853 ms. HIGH also spent 654 ms/frame in deferred clip readback; LOW recording remains off. The large run-to-run variation and sparse frames make a percentage speedup meaningless here.

## Attribution and changes

- **Profiling itself (ci2 interaction):** replay temporarily replaces `performance.now()` with fixed simulation time. Every phase timer incorrectly returned zero. `prof.ts` now retains the native monotonic clock; a test freezes the replay clock and checks that laps still advance.
- **Instance writes (shared rendering; readability2 danger layer, weapon shapes, weather and scars):** the baseline CPU profile attributed 458 ms to `setMatrixAt` and 298 ms to `Matrix4.toArray` over 20 seconds; allocation sampling attributed about 129 MiB to `setMatrixAt`. A dedicated Float32 instance-buffer copy avoids the shared JS-array/typed-array polymorphic path. Only measured hot sites in bullets, enemies, ambience and scars changed. Sampled `setMatrixAt` allocation fell to about 25.5 MiB.
- **Bullets (readability2 + evolved-shot integration):** enemy cores/rims were drawn alongside zero-scale old gems/halos and transparent tails. Render-only packing now excludes those invisible instances; plain, shaped and tail pools have independent counts/colours. Simulation slots and snapshot order are untouched. `ren.bullets` fell from .450 to about .030 ms/frame.
- **Enemies and sound (sound2, readability crowd rules):** the corrected baseline enemy phase was .305 ms in the profiled dev run; final production is about .26. Hearing now rejects by squared range before sqrt, and skips noise scans inside the existing engage radius. Sampled hearing allocation fell from 78.5 to 13.2 MiB. No hearing thresholds, pacing or crowd behavior changed.
- **Projectile collision (shared statuses/netcode hook):** the first-hit callback allocated a captured context for every friendly projectile. A per-Game scratch list uses the existing spatial hash query order and stops at the first valid hit. Piercing history, friendly/PvP filtering and lag compensation are preserved. Sampled allocation in `updateBullets` fell from 47.8 to 11.3 MiB.
- **Clips lane:** baseline `toBlob` alone accounted for 785 ms sampled CPU over 20 seconds. Async capture drops synchronous capture from about .89 to .014 ms/frame, but about .84 ms/frame remains in the async callback. Both are explicitly measured; encoder work is not claimed to have vanished.
- **HUD / inactive modes:** baseline score formatting accounted for 42 ms sampled CPU. Cache `Intl.NumberFormat`; avoid constructing/updating the modes floor/ghost/HUD when all their modes are off. Clear once on deactivation and resume immediately on reactivation. Other mode guards, quality-disabled lights/shadows and overlay throttles were inspected; no blanket disabling of active seasonal, story, raid or multiplayer features.

Remaining large phases are enemies (~.26 ms simulation, ~.17 render), weapons/specials (~.13), particles/scars (~.11), pickup/weapon effects (~.11), and heroes/audio (~.10). No new enemy×enemy or projectile×enemy full scans were introduced.

## Memory soak

```sh
node scripts/soak.mjs --gpu metal --seconds 600 --json shots/perf2-soak-final.json
```

The new harness runs real rendered bot play after 60 seconds of warm-up, requests GC and samples JS heap, ArrayBuffer backing storage, DOM/listeners and GPU resource counts every 30 seconds. It fails on browser exceptions or insufficient simulation progress. It blocks external requests and disables profiling sample accumulation. Replay history intentionally retains typed chunks for the whole run; `replay.status().tapeBytes` now exposes that separately. Completed all 21 samples (600 seconds after 60 seconds warm-up), no page errors, 39,667 recorded steps and 577.43 seconds of in-game time. A real stage transition occurred halfway through; maximum sampled population was 485 enemies and 547 bullets. Post-GC JS heap was 52.68 → 57.54 MiB, with late stage-6 samples between 56.75 and 57.55 MiB. Document count stayed at 5; stage-6 listeners remained 420–423 and textures 41. Geometry/program increases coincide with new enemy/boss/stage resources; counts also fall when temporary geometry is disposed.

| Elapsed sampling time | Stage | JS heap MiB | ArrayBuffer backing MiB | Replay tape MiB | GPU geometries / textures / programs |
|---|---:|---:|---:|---:|---|
| 0 s | 5 | 52.68 | 45.73 | 1.75 | 175 / 40 / 54 |
| 180 s | 5 | 55.07 | 53.68 | 7.00 | 233 / 41 / 58 |
| 300 s | 6 | 56.35 | 58.98 | 10.50 | 235 / 41 / 60 |
| 420 s | 6 | 56.99 | 62.62 | 13.88 | 237 / 41 / 61 |
| 600 s | 6 | 57.54 | 68.33 | 19.13 | 251 / 41 / 62 |

The gameplay/object heap settles within each stage; this is not a claim that total process memory is constant. Backing storage grows with the intentional full-run replay (1.75 → 19.13 MiB), plus stage/pool/capture warm-up. No runaway DOM, bitmap or texture retention appeared in this ten-minute run. Longer full-run replays still consume more memory by design; bounding or streaming replay history is a separate feature decision. The raw 21-sample JSON is the ignored local artifact `shots/perf2-soak-final.json`.

## Validation and handoff

**The integration gate remains red because of the unit/co-op failures below.** Performance changes and their new regression tests are complete; those unrelated content/network issues remain for integration.

- Typecheck and production Vite build pass (existing large-chunk advisory).
- `tests/perf2.test.ts` covers exact instance-buffer copying; replay-safe phase time; hearing equivalence; 500 enemy shots; mixed colours/shapes/tails; swap removal; overflow; clearing; collision first-hit and piercing order; async capture reset/rejection/bitmap release; inactive-mode clearing/reactivation.
- Real Chromium clip capture/export test passes: 286 retained frames across 15 seconds, all six automatic marks, decoded 480×270 WebM with 3,571 unique colours, no live export tracks afterward. Inspected gallery PNG.
- Record/playback matches all 1,800 steps of a 30-second bot run.
- Inspected HIGH drones, LOW 500-projectile scene, and mixed evolved-projectile screenshots. Existing UI, danger rims and projectile silhouettes remain visible.
- Final `npm test` completed all 93 files: 87 passed, six failed. Five failures are independently reproduced on unchanged `309ab1e`; the sixth (`worldGame` factory arena equality) passed on a targeted retry on both revisions and remains intermittent. All 15 new perf2 assertions and sound/hearing integration checks passed. `npm run smoke` passed on the final-source retry, including all heroes/modes, local co-op, race/challenge, mortal death, MVP/history and runtime checks. An earlier smoke run also passed; the first final-source run terminated after the challenge scenario without an assertion/exception. The runner now reports failed file names and exit status/signals instead of silently counting terminated children.
- Browser co-op did **not** pass: the final LOW/Metal offline run failed carry and BACK TO LOBBY. An isolated archive of unchanged `309ab1e`, using the same command, reproduced both failures. The first HIGH/Metal run failed carry only. No new page errors or persistent desync were observed. Five in-process failures also reproduce on the unchanged archive: `coopplayCoop` bomb pickup/plant/fuse assertions; `meta2` duplicate "Better Together" names and co-op achievements appended after medal/category defaults; `pvp2` null PvP state after eight-player startup is rejected by existing four-player guards in `online.ts` / `race.ts`; `raceCoop` obsolete fixture missing `pvp.rules`; `tradingCoop` missing guest title in its lobby card. This lane does not change their unrelated gameplay/content to hide the gate.

Visual commands (local ignored artifacts):

```sh
npm run shot -- '?test&stage=2&weapons=drones:5&seed=42&god&quality=high' shots/perf2-high.png --wait 4
npm run shot -- '?test&stage=5&biome=meadow&night&rain&god&quality=low&weapons=drones:5&swarm=180&bullets=500' shots/perf2-low.png --wait 4
npm run shot -- '?test&stage=2&weapons=drones:6,missiles:6,fire:6&god&swarm=180&bullets=500&season=off&quality=high&nocine' shots/perf2-mixed.png --wait 8
```

On this machine `SHOT_CHROME` selected a local Chromium launcher adding `--use-angle=metal` to avoid software-GL stalls. The launcher is not committed.

Files: `scripts/bench.mjs`, new `scripts/soak.mjs`, `scripts/run-tests.mjs` (failure diagnostics); `src/core/prof.ts`; `src/render/instancing.ts`; `src/audio/loudness.ts`; `src/game/{bullets,enemies,ambience,scars}.ts`; `src/game/systems/{sound2,statuses,modes,ci2}.ts`, new `systems/perf2.ts`; `src/platform/clips.ts`; two small timing lines in `src/main.ts`, cached formatter in `src/ui/hud.ts`; new `tests/perf2.test.ts`; this note and the PLAN decision paragraph.
