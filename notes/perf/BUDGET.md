# Gate 1 performance budget

The release target is 60 rendered frames per second during combat. LOW must sustain at least 30 fps with Chromium's 4× main-thread CPU throttle. Both gates run on a verified hardware Metal context.

| Per-scene limit | Native CPU | LOW, 4× CPU |
|---|---:|---:|
| Sustained rendered fps | ≥59¹ | ≥30 |
| Frame interval p95 / p99 | 17.5 / 34.5 ms | 34.5 / 51 ms |
| Missed 60 Hz render slots | ≤2% | reported |
| All simulation steps in one frame, p95 | 4 ms | 12 ms |
| Game presentation, p95 | 4 ms | 12 ms |
| GL submission and synchronous clip capture, p95 | 4 ms | 12 ms |
| Combined callback CPU, p95 | 10 ms | 28 ms |
| GPU elapsed time, p95 when supported | 12 ms | 12 ms |
| Draw calls / triangles, p95 over all passes | 420 / 650,000 | 420 / 650,000 |
| JS heap at sample end | 240 MiB | 240 MiB |

¹ A 60 Hz display can run at 59.94 Hz. Frame count divided by elapsed wall time also has to clear the floor, with one frame of boundary tolerance. Dropped slots are the sum of rounded 60 Hz intervals beyond one per rendered frame. These are application render deadlines. Physical display scanout is outside the measurement.

| Cold web budget | Limit |
|---|---:|
| Initial transferred HTML + JS + CSS + other assets, title and stage 1 | <5,000,000 B |
| Broadband title including fonts and two further animation frames | <3,000 ms |

## Reproduce

From the repository root on an Apple Silicon Mac with Node 22 and a graphical login, run the following commands. The default opens a headed Playwright Chromium with ANGLE Metal. Pass `--headless` for a GPU-backed headless run. An installed Chrome binary also works with `--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

```sh
npm install
npm run build
npm run bench:real -- --skip-build --check
```

The command writes paired Markdown and JSON under `notes/perf/real-YYYY-MM-DD`. Use `--output shots/perfreal/comparison` to preserve an earlier run. `--seconds 20 --warmup 4` extends each sample. `--profile` collects a CDP CPU profile for each row and saves the twenty highest self-time entries in milliseconds. Use a separate output for profile runs because sampling adds overhead. For a dedicated browser already listening on loopback, pass `--cdp http://127.0.0.1:PORT`. Each case opens and closes a fresh context.

For desktop, package the same dist locally with the installed Electron runtime, then pass the executable. The command uses the app's packaged file URL, an empty temporary player profile, and the ordinary desktop window. It runs all six scenes once at 1080p HIGH with shadows. It measures launch to the first submitted title frame, including process creation. macOS disk and GPU driver caches may already be warm.

```sh
npx electron-builder --mac dir --arm64 --publish never -c.electronDist=node_modules/electron/dist -c.directories.output=shots/perfreal/package -c.mac.identity=null
npm run bench:real -- --skip-build --check --electron shots/perfreal/package/mac-arm64/InfiniShoot.app/Contents/MacOS/InfiniShoot
```

An app in the default `release/mac-arm64/` or `release/mac/` directory is discovered automatically. Desktop launch failures appear in the report and fail a check with a supplied or discovered executable. The mandatory browser gate can be replayed against a saved measurement without a GPU. This assesses the recorded build only.

```sh
npm run bench:real -- --check --from-report notes/perf/real-2026-11-22.json
```

## Measurement protocol

- Use a quiet, visible browser, the default 60 Hz game cap and clean storage. The fixed seed is 42. Each scene warms up for two seconds and then samples five seconds by default. Full test links, actual viewport, game drawing buffer, effective quality and shadow light state are in the JSON.
- Six fixtures cover the existing meadow horde, a larger horde, Omega with explosion effects, four independently moving hero rigs with weapons, the Titan's beam fight, and a rainy Neon City night with forced fog and puddles. Each runs at 1280×720 and 1920×1080 on LOW, MEDIUM, HIGH and HIGH with shadows. Twelve additional LOW rows throttle the CPU 4×. LOW uses its ordinary fog/reflection settings. The four-hero fixture exercises local team simulation and presentation. Network synchronization has its own co-op suite.
- Spawn timers replenish live enemies every 500 ms and bullets every 100 ms. Combat continues throughout. Require a median of 150 enemies, or 300 in the larger horde. Projectiles must reach 500 or 1,000 and the median must stay within 5% below that target or higher. The Titan uses its own encounter population. An interrupted fight, missing boss, missing teammate, mismatched preset, software GPU or insufficient frames fails the check.
- Actual rendered timestamps come from the document animation timeline. This captures hitches beyond the simulation loop's 250 ms clamp. CPU phases come from the game's existing profiler. The browser's task, layout and style durations and start/end JS heap come from CDP. CPU and GPU work overlap. Deferred clip encoding occurs outside the callback and is reported in the phase breakdown.
- Every eighth rendered frame brackets game presentation and GL submission with an asynchronous WebGL2 elapsed-time query. At most four queries are pending. Disjoint results are discarded. Hardware without the extension reports an unavailable GPU column. A supported timer that produces no valid samples fails the check.
- Cold web runs use an empty context and disabled HTTP cache. CDP applies 20 Mbps / 40 ms broadband or 1.6 Mbps / 150 ms slow 4G in each direction. The two entry points are the normal title and direct stage 1. Initial bytes count completed transfers for requests that **started** by the first-frame mark, including the navigation response. The later offline install and gesture-triggered audio are outside this window. The cold-start marks time navigation to the first submitted WebGL frame. Readiness also waits for fonts and two animation frames.
- The release gate evaluates every measured row. Timing noise is grounds for one rerun with both observations retained. The benchmark does not select the faster sample automatically. Budgets are implemented in `scripts/benchRealBudget.mjs`.
