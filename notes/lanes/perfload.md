# perfload — fast start, light on old laptops

## Players get

- Photo mode and the debug panel (including lil-gui and sound designer) download when opened. Test-link helpers download only for `?test`. Opening the tools still works with mouse/keyboard/gamepad menu activation; failed imports show a retryable toast. The normal title no longer downloads the debug sound manifest.
- Audio starts with 12 common cues (61,323 bytes of MP3s). Two workers fetch/decode that core, then one background worker starts after 1.5 s and yields 120 ms between clips. Missing/offline clips retain the existing synthesis fallback. Requested cues move ahead of unrelated clips; the current ambience bed and its footsteps are promoted together. Gameplay never waits for audio. The entire optional pack is still available eventually.
- A POTATO setting below LOW: 216p, zero dynamic lights, 12% burst particles, no grass/weather or decorative surface particles. Core bullets, hit cues, hazard markings, terrain, hero x-ray/ring, and the normal color/dither composite remain readable.
- LOW is 216p, two lights (prioritizing hero lanterns), 30% burst particles and 20% grass/weather. Both LOW and POTATO disable outlines, bloom, distortion, anime ink/speed/impact post effects, fog/shafts, puddle/sky reflections, cloud shadows, smoke/dust/debris, footprints/persistent ground scars, shatter pieces, trails and crowd camera tilt. Colored gameplay splats and the base water/lava/ice surfaces remain.
- AUTO starts at LOW to reduce startup shader work. After its 1 s warm-up, sustained >=33 ms frames step down after one 0.5 s window, with 0.25 s cooldown; ordinary slow frames retain the three-window/2 s cooldown policy. It climbs after 8 s of good frames, with the existing failed-rung backoff. Individual >200 ms loading/tab hitches are ignored.

Saved graphics values remain LOW=0, MEDIUM=1, HIGH=2, AUTO=3; POTATO is appended as 4. The slider uses an explicit display order (4,0,1,2,3), so old saves do not change presets. Invalid saved values normalize to AUTO. No profile/save schema or protocol changes.

## Measurements and reproduction

Baseline: `bed4e15` (startup instrumentation only, original game behavior). After: this lane, following `6cab74f`. Sizes below are decimal bytes/MB. `npm run loadtime` builds production and opens separate cold browser contexts for title and `?test&stage=1&seed=42&god`, at 1280x720, 20 Mbps and 40 ms latency. It records a mark immediately after the first WebGL submission, then separately waits for fonts and two animation frames. It clicks the backdrop to unlock audio and records the following 10 seconds. External service requests are blocked. It reports full dist/audio sizes, raw/gzip JS sizes, actual encoded resource bytes, startup milestones, GPU identity and audio request timing/order. HTML/HTTP headers are not included in the resource-byte sum.

```
npm run loadtime -- --json shots/perfload-load.json
npm run loadtime -- --gpu metal --json shots/perfload-load-metal.json
npm run loadtime -- --skip-build --mbps 20 --latency 40
npm run bench -- --quality potato --seconds 10 --json shots/perfload-potato.json
npm run bench -- --gpu metal --quality low --seconds 10
```

Both tools default to portable SwiftShader. `--gpu metal` explicitly selects the native Apple GPU; it is not an old-laptop simulation. Bench now records GPU mode and the ending quality in JSON. The readiness timeout is 90 s for heavily contended software rendering.

### Production loading

Cold browser-cache headless Chromium, **Apple M5 Pro / ANGLE Metal**, measured during the parallel build:

| Metric | Before | After |
|---|---:|---:|
| Whole dist | 4,355,377 B | 4,327,098 B |
| All JS (including optional chunks) | 2,608,366 B | 2,619,047 B |
| JS required for title, raw | 2,608,366 B | 2,485,843 B |
| Title resources, actual gzip/font bytes | 923,217 B | 878,093 B |
| Stage 1 test-link resources | 923,217 B | 890,510 B |
| First title WebGL submission | 2,702 ms | 832 ms |
| Title fonts + next paint opportunity | 3,207 ms | 916 ms |
| First stage 1 WebGL submission | 834 ms | 852 ms |
| Stage 1 fonts + next paint opportunity | 926 ms | 942 ms |
| Audio requests before first frame | 1 manifest | 0 |
| Audio bytes in 10 s after title gesture | 1,576,885 B | 434,321 B |
| Audio bytes in 10 s after stage 1 gesture | 1,576,885 B | 496,518 B |

The initial transfer is below 5 MB even without gzip; both first frames are below 3 s on the native-GPU measurement. Stage startup is effectively unchanged within measurement noise. Total JS grows slightly from chunk boundaries/export glue; the initial graph is smaller. Browser cache is cold, **OS/driver shader caches are not reset**, and other builders share the CPU: do not treat these individual timings as a controlled speedup percentage or an old-PC guarantee.

After chunk sizes (raw / gzip estimate from `loadtime`):

| Chunk | Raw B | Gzip B | Loaded |
|---|---:|---:|---|
| entry | 5,137 | 2,300 | startup |
| game | 1,709,525 | 611,525 | startup |
| settings/shared renderer | 771,181 | 212,031 | startup |
| debugPanel + lil-gui | 74,720 | 22,989 | backquote |
| photoMode + filters | 26,774 | 9,925 | PHOTO MODE |
| testLinks | 30,146 | 11,587 | `?test` |
| modesLinks | 1,564 | 830 | test/debug helpers |

Audio on disk is unchanged at 1,577,771 B (manifest plus MP3s). The old hidden debug panel fetched a manifest before any gesture, then the engine fetched it again and downloaded all 137 clips. After this change there are no title audio requests until a gesture. The first 12 clips are the 61 KB core; all remaining clips are paced and reprioritized rather than competing in three eager workers. Biomes reuse the existing recorded ambience/footstep families, including remixes.

### Heavy fight benchmark

Native **ANGLE Metal / M5 Pro** (CPU ms per normalized frame; draw calls and triangles are averages):

| Preset | CPU before → after | Draw calls before → after | Triangles before → after |
|---|---:|---:|---:|
| POTATO | — → 2.40 | — → 106 | — → 110,382 |
| LOW | 2.81 → 2.47 | 124 → 111 | 126,344 → 114,553 |
| MEDIUM | 2.84 → 3.06 | 160 → 183 | 210,346 → 212,183 |
| HIGH | 2.97 → 2.94 | 199 → 193 | 212,124 → 224,622 |
| AUTO | 2.67 → 2.67 | 156 → 141 | 204,770 → 159,173 |

AUTO ended at HIGH before and LOW+ after: its averages intentionally cover different starting/rising rungs. MEDIUM/HIGH use the same effect budgets as before; small CPU and draw-count variation follows the active fight. LOW reduces normalized CPU by about 12% in this pair; native timings still include shared-machine scheduling noise.

The scene is the existing seeded heavy benchmark: stage 5 forced to meadow, night/rain, explosions, drones/missiles/lightning/fire, about 260–300 enemies and 500 projectiles. Each quality gets 4 s warm-up and 10 s collection. CPU is sim-per-step + game.render + GL submission, normalized to one 60 Hz simulation step. Runs are interleaved baseline/after for each preset. Entity counts and particles vary with frame cadence.

SwiftShader was also measured. Early baseline CPU/frame was LOW 2.18, MEDIUM 5.27, HIGH 2.38, AUTO 2.77 ms. During the most contended interval, after LOW/POTATO rendered only 8–9 frames in 10 s and cost 4.59/4.16 ms CPU; MEDIUM/HIGH hit the old 30 s readiness timeout. These are explicitly **not comparable performance claims**. Native Metal avoids the software-GPU CPU bottleneck; the portable option remains available for repeatable reruns on a quiet machine.

## Validation

Passed: `npm run typecheck`, `npx vite build`, `npm test` (all 57 files), `npm run smoke` (all heroes/modes, Versus, local co-op, mortal run and menu history), all five native quality benchmarks, and production startup/audio measurements. Build retains the existing >1 MB core-game chunk warning.

The first full unit run hit the existing randomized `meta.test.ts` lost-cargo assertion: a 7% golden jackpot chest replaces the normal chest, while that test counts only normal chests. The isolated retry and the full final rerun passed. No unrelated test/gameplay files were changed to hide it.

No online transport or snapshot behavior was changed; the full suite includes host/client state round-trip tests. The public-broker `npm run coop` was not invoked for these local rendering/loading changes.

Visual links (all inspected):

```
npm run shot -- '?test&stage=2&weapons=drones:5&quality=potato&seed=42&god' shots/perfload-potato.png --wait 4
npm run shot -- '?test&stage=5&biome=neon&rain&night&anime&quality=low&god&seed=42&swarm=170&bullets=500' shots/perfload-low.png --wait 4
```

Also inspected `shots/perfload-potato-night.png` (`?test&stage=5&biome=neon&night&rain&quality=potato&god&seed=42&swarm=150`, wait 8 s): enemies, Night Raid light cones and objectives remain visible with zero dynamic lights.

Additional production-browser checks inspected `shots/perfload-title.png`, `shots/perfload-photo.png`, and `shots/perfload-settings.png`: no optional chunks/audio on title; first and repeated photo opening; first debug opening and subsequent toggle; Potato/HIGH slider mapping. Screenshots are ignored, not committed.

## Files touched and integration

- Startup/measurement: `src/main.ts`, `vite.config.ts`, `package.json`, `scripts/loadtime.mjs`, small GPU/timeout/report additions to `scripts/bench.mjs`.
- Audio: `src/audio/samples.ts` only.
- Quality: `src/render/quality.ts`; small guarded hooks in `render/{groundScars,lights,shatter,sky,surfaces}.ts`, `game/{ambience,particles}.ts`, and `game/systems/{graphics,look,sky,worldFx}.ts`.
- Shared edits: the graphics setting mapping in `src/game/settings.ts`, one slider plus value mapping in `src/ui/screens.ts`, one `potato` test-link option in `src/dev/testLinks.ts`. No game.ts, hero.ts, netcode, CSS, or gameplay edits.
- `tests/perfload.test.ts`: saved preset compatibility, invalid values, cheap budgets, governor descent/hitch handling, sample order, real asynchronous core-first loading, biome promotion, concurrency and duplicate-fetch bounds.

## Limits / decisions

- PvP/Versus, mini-games, ghosts and cinematics currently participate directly in synchronous game updates, title play, rewards and snapshots. Their gameplay/state-machine imports stay in the main graph to preserve those hot paths and host/client behavior. Further UI-only extraction needs boundaries in their owning lanes; this lane does not add asynchronous gameplay stubs. Electron-only code already lives outside the browser entry graph.
- LOW suppresses ANIME LOOK's expensive effects while retaining the saved toggle; moving back to a higher quality restores them. AUTO can therefore visibly add effects as it climbs. Existing quality-independent hazard cues remain enabled.
- Dropped cosmetic ground scars are not reconstructed when quality rises. Some decorative pools are still allocated at construction even when disabled; they stop spawning/drawing at low quality. This pass primarily reduces live work and startup module/UI work, not every possible allocation.
- No claim of 60 fps on an actual old laptop: native tests use an M5 Pro, software-GPU timings were heavily affected by concurrent builders, and real low-end GPU testing remains necessary.

## Decision-log paragraph for the lead's PLAN.md

2026-10-19: perfload adds repeatable production load/audio measurements and a native Metal benchmark option, defers photo/debug/test tooling (including lil-gui), and streams a 61 KB core audio set before a paced, demand/biome-prioritized background pack. Initial title resources are about 878 KB compressed; native Chromium's measured title/stage-1 first frames are 0.83/0.85 s (shader caches/parallel-build contention noted). Potato adds a 216p, zero-light preset without changing old save values; LOW removes newer decorative effects that bypassed its budget. AUTO starts conservatively and descends quickly on sustained slow frames. Details, quality benches, validation and retained synchronous systems are in notes/lanes/perfload.md.
