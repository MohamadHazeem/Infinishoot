# ci2 — regression checks and run replays

## Player changes

SETTINGS > HELP now has SAVE REPLAY, WATCH REPLAY and WATCH CRASH REPLAY,
localized in English and Arabic. Solo games and online hosts record; clients do
not. `.isr` is gzip-compressed versioned JSON, including the run seed, settings,
profile/unlocks, bindings, initial roster, exact polled input, authoritative menu
choices/remote messages, and render cadence. Watch mode reloads into an offline
session and protects the player's stored profile; EXIT REPLAY returns to normal
play. Handled JavaScript exceptions/rejections save a recovery replay through
safe storage. A tab/process/OS crash that prevents JavaScript running cannot be
recovered by the error handler. Browser quota still bounds local recovery;
downloaded files do not have the localStorage quota.

## Implementation decisions

All runtime behavior is in new `src/game/systems/ci2.ts`; `src/dev/replay.ts`
contains the pure tape/validation/hash helpers. Main only installs the system
and recognizes `?ci2` (manual-step automation; no normal RAF loop). No runtime
dependencies, save-version changes, network fields or external services added.
If another lane wraps update/render/startRun during main initialization, install
that wrapper before `installReplay`, and keep test links/loop startup afterward.

The authoritative callback gets a seeded fallback random stream and a simulation
clock. This fixes legacy `Math.random()` in Buster spread, lightning targeting,
pickup movement, enemy AI/spawn timers and boss patterns without a broad merge
across weapon/enemy lanes. Render, audio and particle/mesh randomness are
isolated so audio unlock and quality budgets cannot advance gameplay randomness.
Enemy pool ordering resets at run start, and playback restores the original uid
base. Hearing noise/hooks, the enemy recycling timer and the previous-world-event
exclusion reset between runs; replay checks exposed all three state leaks. Existing gameplay `game.rng` remains seeded.
Test-link seeds now apply before startup, instead of replacing only the RNG after
the arena, shop and run were already initialized.

The tape uses 16,384-value Float64 chunks (no per-step object snapshots), interned
strings for sparse actions, and lossless gzip on export. Exact camera matrices
are inputs because mouse aim depends on render interpolation, zoom and resize.
Checkpoints every 60 steps hash hero/enemy/projectile/pickup state and gameplay
RNG, plus a final checksum. Mismatches report the first failed checkpoint and
expected/actual diagnostic state. Replays are intended for the same build;
changing game logic should report a divergence rather than silently retarget it.
Render callbacks are replayed because current hit-stop and danger-zone timers
are partly render-driven. Normal async browser callbacks are not globally patched.

## Automation

- `npm run replay -- --record shots/run.isr --seconds 30`: deterministic bot recording.
- `npm run replay -- shots/run.isr`: headless resimulation, nonzero on divergence.
- Add `--host` to record an offline two-hero host with real incoming input/UI messages.
- Add `--prelude` to exercise a title demo and an earlier run before recording.
- `npm run visual`: twenty fixed-step, fixed-date, seeded screenshots; 24/255 channel tolerance and 1% changed-pixel limit. Actual/diff PNGs and JSON go in `shots/visual/`.
- `npm run visual -- --update`: intentionally refresh reviewed baselines. `--only help` selects one.
- `npm run balance`: four kits, god mode, normal, seed 4242, two complete stages each; per-stage kills, level, ranks and time must stay within 25% (absolute floors: 30 kills, 3 other units). `-- --update` updates the stored measurements.
- `npm run coop -- --offline`: the existing complete co-op test with in-process PeerJS signalling and local WebRTC host candidates, no public broker/STUN/TURN/API. Assertions/scenarios stay intact. COOP_LOW preserves saved settings across invite reloads instead of wiping the client's pet.

CI adds parallel visual and balance jobs with the lockfile's Playwright Chromium
installation. Failures upload images/reports/replays. The balance job also checks
fresh 360-second solo and 60-second host recordings/replays, both after title
attract mode and an earlier run.

## Files

New: `src/dev/replay.ts`, `src/game/systems/ci2.ts`, `scripts/replay.mjs`,
`scripts/visual.mjs`, `tests/ci2.test.ts`, `tests/visual/*`, this note.
Small integration edits: `src/main.ts`, `src/ui/screens.ts` (screen union),
`src/dev/testLinks.ts` (remove late RNG replacement), `src/i18n/en.ts` and
`ar.ts`, `package.json`, `.github/workflows/ci.yml`, `scripts/coop-test.mjs`.

## Verification and limits

Typecheck, Vite production build, all 72 unit-test files, smoke, the complete
offline WebRTC co-op suite, twenty visual comparisons and all four balance kits
passed. Screenshots of all fixtures, watch mode and the stage-2 drone link were
inspected. Replay verification includes solo and two-player host runs after a
title demo and an earlier run, deliberate corruption rejection, file import,
gzip download, crash recovery, offline watch completion and unchanged stored
profile. The extended solo replay matched all 21,600 steps; the host replay
matched all 3,600 steps. Another 18,000-step run with normal cinematic, boss
intro and finisher settings matched. Pausing, changing settings/bindings and
resuming also round-tripped.

Visual spot links: `?test&seed=42&stage=2&weapons=drones:5`,
`?test&seed=42&screen=replay-help`, `?test&seed=42&lang=ar&screen=settings`.
Baselines were generated and compared on macOS Chromium/SwiftShader; Linux CI
has not run locally. Review/refresh expected visual changes after integrating
the other lanes.

The final native-GPU heavy benchmark measured 61.5 FPS, 300 average / 346 peak
enemies, 516 average / 595 peak bullets, 0.81 ms simulation/step, 1.76 ms game
render and 1.00 ms WebGL submission (3.57 ms total CPU/frame). Per-phase profiler
clocks inside the deterministic scope read zero; the benchmark's outer CPU
measurements remain real wall time. The shared overnight machine was heavily
loaded; software-renderer timing was not representative of gameplay.

The replay command covers solo and host co-op. Local split-screen, PvP/Versus,
photo-mode editing, arbitrary dev-console mutations and timed custom test-link
callbacks are not a replay compatibility contract. New external actions should
be added to the small command-boundary allowlist. Replays include local names
and profile data; they are exported locally, never uploaded automatically.
