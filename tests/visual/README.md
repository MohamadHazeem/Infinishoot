# Regression fixtures

Run `npm run visual` to compare twenty 960×540 screenshots against these PNGs.
`npm run visual -- --update` deliberately replaces the baselines; review the
images before committing. `--only dunes` selects one fixture for iteration.
Actual images, failed diffs and a report go in ignored `shots/visual/`.

Every page has fresh storage, seed 42, a pinned UTC date, LOW quality, a pinned
sky clock, and CSS animations/transitions disabled. The normal RAF loop never
starts (`?ci2`). The harness executes 240 fixed updates and 24 render callbacks,
sets shader time to 4 seconds, then submits one WebGL frame. No delayed test
links are used. Playwright Chromium + SwiftShader is used on all platforms.
A pixel differs when any RGB channel differs by more than 24/255; more than
1% changed pixels fails. Missing baselines, dimensions and page errors fail.
Use the Chromium revision provided by the lockfile (`npx playwright-core install
--with-deps chromium-headless-shell`). No runtime/image-diff dependency is needed.

`balance.json` records four normal-difficulty, god-mode, seed-4242 bot runs to
the end of stage 2. `npm run balance` compares each stage's cumulative kills,
level, track ranks and elapsed simulation time; a 25% change fails, with a
floor of 30 kills / 3 other units. Failure to finish two stages, a missing
baseline, invalid metrics, or a silently substituted loadout also fails.
`npm run balance -- --update` refreshes measured values. Both CI jobs run in
parallel and upload their reports/images on failure.
