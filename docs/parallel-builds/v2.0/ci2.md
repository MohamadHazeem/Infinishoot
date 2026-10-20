LANE: ci2 — catch regressions automatically

1. Replay files: record a run as seed + settings + per-step inputs (solo; host-side for co-op) into a compact file (SETTINGS > HELP > SAVE REPLAY of the last run, and auto-save on crash); `npm run replay -- file` re-simulates headlessly and reports divergence; the game can play a replay back (watch mode). Determinism: find and fix sources of non-determinism in the simulation (Math.random in gameplay, time-based logic) found by replaying.
2. Visual regression: scripts/visual.mjs (`npm run visual`) takes a fixed set of ~20 screenshots from deterministic test links (seeded, frozen time) and compares them with baselines in tests/visual/ (pixel diff with a tolerance); `npm run visual -- --update` refreshes baselines.
3. Balance CI: a quick bot sweep (3-4 kits, god, 2 stages) in GitHub Actions that fails on big swings vs stored numbers (tolerance), plus the visual check, as separate parallel jobs in .github/workflows/ci.yml (needs Chromium in CI: install playwright's chromium in the job).
Owns: new src/dev/replay.ts, scripts/replay.mjs, scripts/visual.mjs, tests/visual/*, .github/workflows/ci.yml (additive jobs), tests/ci2.test.ts.
